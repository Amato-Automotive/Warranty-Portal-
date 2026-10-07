import { Response } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { urlToDiskPath } from '../config/localUpload.js';
import { AuthRequest } from '../middleware/auth.js';
import { validateExpenseClaim, decideExpenseClaim, ExpenseRuleError, type BillField } from '../services/asmExpenseRules.js';
import { ActivityLogService } from '../services/activity-log.service.js';

/**
 * ASM expense claims — the ASM's side: file a claim, see their own.
 *
 * The rules live in asmExpenseRules (pure, tested); this stores what they
 * return. Head office then decides each claim once, from ASM Management:
 * approve, approve part (an approved amount per line, with a reason) or
 * reject (with a reason). status: submitted → approved | partially_approved |
 * rejected.
 */

/** Created at boot. status/type are VARCHAR, not ENUM, so the review flow can add states without an ALTER. */
export async function ensureAsmExpenseTables() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS asm_expense_claims (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            claim_no INT UNSIGNED NOT NULL AUTO_INCREMENT,
            asm_id VARCHAR(36) NOT NULL,
            type VARCHAR(10) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'submitted',
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            from_place VARCHAR(120) NULL,
            to_place VARCHAR(120) NULL,
            travel_mode VARCHAR(20) NULL,
            tickets_by VARCHAR(10) NULL,
            one_way TINYINT(1) NOT NULL DEFAULT 0,
            hotel_stay TINYINT(1) NOT NULL DEFAULT 0,
            hotel_nights INT NULL,
            hotel_persons INT NULL,
            total_amount DECIMAL(10,2) NOT NULL,
            approved_amount DECIMAL(10,2) NULL,
            remarks TEXT NULL,
            review_note TEXT NULL,
            reviewed_by VARCHAR(36) NULL,
            reviewed_by_name VARCHAR(100) NULL,
            reviewed_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_asm_expense_claim_no (claim_no),
            KEY idx_asm_expense_asm (asm_id, created_at),
            KEY idx_asm_expense_status (status, created_at)
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS asm_expense_items (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            claim_id VARCHAR(36) NOT NULL,
            kind VARCHAR(10) NOT NULL,
            from_place VARCHAR(120) NULL,
            to_place VARCHAR(120) NULL,
            description VARCHAR(200) NULL,
            amount DECIMAL(10,2) NOT NULL,
            approved_amount DECIMAL(10,2) NULL,
            attachment_url VARCHAR(500) NULL,
            sort_order INT NOT NULL DEFAULT 0,
            KEY idx_asm_expense_items_claim (claim_id),
            CONSTRAINT fk_asm_expense_items_claim FOREIGN KEY (claim_id)
                REFERENCES asm_expense_claims (id) ON DELETE CASCADE
        )
    `);

    // CREATE TABLE IF NOT EXISTS leaves an older table as it was, so columns
    // added since the first version are added here when missing.
    const later: [string, string, string][] = [
        ['asm_expense_claims', 'approved_amount', 'DECIMAL(10,2) NULL AFTER total_amount'],
        ['asm_expense_claims', 'reviewed_by_name', 'VARCHAR(100) NULL AFTER reviewed_by'],
        ['asm_expense_items', 'approved_amount', 'DECIMAL(10,2) NULL AFTER amount'],
    ];
    for (const [table, column, definition] of later) {
        const [found]: any = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
        if (found.length === 0) {
            await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
            console.log(`✅ Migration: Added ${column} to ${table}.`);
        }
    }
}

/** Today's date in IST, as the rules want it. */
const istToday = () => new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata', hour12: false }).split(',')[0];

const BILL_FIELDS: BillField[] = ['onward_ticket', 'return_ticket', 'hotel_bill'];

type UploadedFiles = Partial<Record<BillField, Express.Multer.File[]>>;

/** Remove this request's uploads — the claim was refused, so nothing will point at them. */
async function discardUploads(files: UploadedFiles) {
    await Promise.allSettled(
        Object.values(files).flat().filter(Boolean).map(f =>
            fs.promises.unlink(urlToDiskPath((f as Express.Multer.File).path)).catch(() => {}))
    );
}

/** The ASM behind this session. authenticateAnySession has already checked they are active. */
async function asmIdFor(req: AuthRequest): Promise<string | null> {
    const [rows]: any = await db.execute('SELECT id FROM asms WHERE profile_id = ?', [req.user!.id]);
    return rows[0]?.id ?? null;
}

const claimNo = (n: number) => `EXP-${String(n).padStart(4, '0')}`;

async function loadClaims(where: string, params: any[], limit = 200) {
    const [claims]: any = await db.execute(
        // DATEs as text: a DATE read back through the IST pool becomes a JS Date
        // at local midnight and serialises as the previous day in UTC.
        `SELECT c.*, a.name AS asm_name, a.phone_number AS asm_phone,
                DATE_FORMAT(c.start_date, '%Y-%m-%d') AS start_day, DATE_FORMAT(c.end_date, '%Y-%m-%d') AS end_day
           FROM asm_expense_claims c
           LEFT JOIN asms a ON a.id = c.asm_id
          WHERE ${where} ORDER BY c.created_at DESC LIMIT ${limit}`,
        params
    );
    if (!claims.length) return [];
    const ids = claims.map((c: any) => c.id);
    const [items]: any = await db.execute(
        `SELECT * FROM asm_expense_items WHERE claim_id IN (?) ORDER BY sort_order`,
        [ids]
    );
    return claims.map((c: any) => ({
        ...c,
        start_date: c.start_day,
        end_date: c.end_day,
        claim_number: claimNo(c.claim_no),
        total_amount: Number(c.total_amount),
        approved_amount: c.approved_amount === null ? null : Number(c.approved_amount),
        one_way: !!c.one_way,
        hotel_stay: !!c.hotel_stay,
        items: items
            .filter((i: any) => i.claim_id === c.id)
            .map((i: any) => ({
                ...i,
                amount: Number(i.amount),
                approved_amount: i.approved_amount === null ? null : Number(i.approved_amount),
            })),
    }));
}

export class AsmExpenseController {
    /** POST /api/asm-portal/expenses — multipart: `claim` (JSON) + bill files. */
    static async submit(req: AuthRequest, res: Response) {
        const files = (req.files || {}) as UploadedFiles;
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) {
                await discardUploads(files);
                return res.status(403).json({ error: 'Your ASM account was not found' });
            }

            let input: any;
            try {
                input = typeof req.body?.claim === 'string' ? JSON.parse(req.body.claim) : req.body?.claim;
            } catch {
                await discardUploads(files);
                return res.status(400).json({ error: 'Claim details could not be read' });
            }

            const claim = validateExpenseClaim(input, istToday());

            const missing = claim.required_bills.filter(f => !files[f]?.[0]);
            if (missing.length) {
                await discardUploads(files);
                const names: Record<BillField, string> = {
                    onward_ticket: 'onward ticket', return_ticket: 'return ticket', hotel_bill: 'hotel bill',
                };
                return res.status(400).json({ error: `Attach the ${missing.map(m => names[m]).join(', ')}` });
            }
            // A bill this claim has no use for (say, a ticket after switching
            // to company-booked) is dropped rather than stored unreferenced.
            const unused = BILL_FIELDS.filter(f => files[f]?.[0] && !claim.required_bills.includes(f));
            await discardUploads(Object.fromEntries(unused.map(f => [f, files[f]])) as UploadedFiles);

            const id = uuidv4();
            const conn = await db.getConnection();
            try {
                await conn.beginTransaction();
                await conn.execute(
                    `INSERT INTO asm_expense_claims
                       (id, asm_id, type, start_date, end_date, from_place, to_place, travel_mode, tickets_by,
                        one_way, hotel_stay, hotel_nights, hotel_persons, total_amount, remarks)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, asmId, claim.type, claim.start_date, claim.end_date, claim.from_place, claim.to_place,
                        claim.travel_mode, claim.tickets_by, claim.one_way ? 1 : 0, claim.hotel_stay ? 1 : 0,
                        claim.hotel_nights, claim.hotel_persons, claim.total_amount, claim.remarks]
                );
                for (const [i, item] of claim.items.entries()) {
                    await conn.execute(
                        `INSERT INTO asm_expense_items
                           (id, claim_id, kind, from_place, to_place, description, amount, attachment_url, sort_order)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [uuidv4(), id, item.kind, item.from_place, item.to_place, item.description, item.amount,
                            item.bill ? files[item.bill]![0].path : null, i]
                    );
                }
                await conn.commit();
            } catch (error) {
                await conn.rollback().catch(() => {});
                throw error;
            } finally {
                conn.release();
            }

            const [saved] = await loadClaims('c.id = ?', [id]);
            res.status(201).json({ success: true, claim: saved, message: `Claim ${saved.claim_number} submitted` });
        } catch (error: any) {
            await discardUploads(files);
            if (error instanceof ExpenseRuleError) return res.status(400).json({ error: error.message });
            console.error('[ASM expense] submit failed:', error);
            res.status(500).json({ error: 'Could not submit the claim. Please try again.' });
        }
    }

    /** GET /api/asm-portal/expenses — the ASM's own claims, newest first. */
    static async listMine(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            res.json({ success: true, claims: await loadClaims('c.asm_id = ?', [asmId]) });
        } catch (error) {
            console.error('[ASM expense] list failed:', error);
            res.status(500).json({ error: 'Could not load your claims' });
        }
    }

    // ── Head office ──────────────────────────────────────────────────────────

    /**
     * GET /api/asm/expenses?status=&asm_id= — claims for review, newest first,
     * with the count in each status for the filter cards.
     */
    static async adminList(req: AuthRequest, res: Response) {
        try {
            const { status, asm_id } = req.query as Record<string, string>;
            const where: string[] = ['1 = 1'];
            const params: any[] = [];
            if (status && status !== 'all') { where.push('c.status = ?'); params.push(status); }
            if (asm_id) { where.push('c.asm_id = ?'); params.push(asm_id); }

            const claims = await loadClaims(where.join(' AND '), params, 500);
            const countParams = asm_id ? [asm_id] : [];
            const [counts]: any = await db.execute(
                `SELECT status, COUNT(*) AS n, SUM(total_amount) AS claimed
                   FROM asm_expense_claims ${asm_id ? 'WHERE asm_id = ?' : ''}
                  GROUP BY status`,
                countParams
            );
            res.json({
                success: true,
                claims,
                counts: Object.fromEntries(counts.map((r: any) => [r.status, { n: Number(r.n), claimed: Number(r.claimed || 0) }])),
            });
        } catch (error) {
            console.error('[ASM expense] admin list failed:', error);
            res.status(500).json({ error: 'Could not load expense claims' });
        }
    }

    /**
     * PUT /api/asm/expenses/:id/decision — { action, note?, amounts? }.
     * A claim is decided once, while it is still submitted.
     */
    static async decide(req: AuthRequest, res: Response) {
        const { id } = req.params;
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const [rows]: any = await conn.execute(
                'SELECT id, claim_no, status, asm_id, total_amount FROM asm_expense_claims WHERE id = ? FOR UPDATE',
                [id]
            );
            if (!rows.length) {
                await conn.rollback();
                return res.status(404).json({ error: 'Claim not found' });
            }
            const claim = rows[0];
            if (claim.status !== 'submitted') {
                await conn.rollback();
                return res.status(409).json({ error: 'This claim has already been decided' });
            }
            const [items]: any = await conn.execute(
                'SELECT id, amount FROM asm_expense_items WHERE claim_id = ? ORDER BY sort_order',
                [id]
            );
            const decision = decideExpenseClaim(
                items.map((i: any) => ({ id: i.id, amount: Number(i.amount) })),
                req.body
            );

            for (const item of items) {
                await conn.execute('UPDATE asm_expense_items SET approved_amount = ? WHERE id = ?', [decision.approved[item.id], item.id]);
            }
            await conn.execute(
                `UPDATE asm_expense_claims
                    SET status = ?, approved_amount = ?, review_note = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = NOW()
                  WHERE id = ?`,
                [decision.status, decision.approved_total, decision.note, req.user!.id, req.user!.name || null, id]
            );
            await conn.commit();

            const [saved] = await loadClaims('c.id = ?', [id]);
            ActivityLogService.log({
                adminId: req.user!.id,
                adminName: req.user!.name,
                adminEmail: req.user!.email,
                actionType: `ASM_EXPENSE_${decision.status.toUpperCase()}`,
                targetType: 'asm_expense',
                targetId: id,
                targetName: `${saved.claim_number} · ${saved.asm_name ?? 'ASM'}`,
                details: {
                    claimed: Number(claim.total_amount),
                    approved: decision.approved_total,
                    ...(decision.note ? { reason: decision.note } : {}),
                },
                ipAddress: req.ip,
            }).catch(() => {});

            const verb = { approved: 'approved', partially_approved: 'partly approved', rejected: 'rejected' }[decision.status];
            res.json({ success: true, claim: saved, message: `${saved.claim_number} ${verb}` });
        } catch (error: any) {
            await conn.rollback().catch(() => {});
            if (error instanceof ExpenseRuleError) return res.status(400).json({ error: error.message });
            console.error('[ASM expense] decision failed:', error);
            res.status(500).json({ error: 'Could not save the decision' });
        } finally {
            conn.release();
        }
    }
}
