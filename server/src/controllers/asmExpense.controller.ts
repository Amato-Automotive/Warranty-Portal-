import { Response } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { urlToDiskPath } from '../config/localUpload.js';
import { AuthRequest } from '../middleware/auth.js';
import {
    validateExpenseClaim, decideExpenseClaim, ExpenseRuleError, type BillField,
    canChangeDecision, canMarkPaid, validatePayment, expenseUpdateValues,
} from '../services/asmExpenseRules.js';
import {
    quarterOf, parseQuarter, shiftQuarter, validateBudget, summariseBudget, claimBudgetPosition,
    BudgetRuleError, type BudgetClaim, type BudgetInput, type Quarter,
} from '../services/asmExpenseBudget.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';

/**
 * ASM expense claims — the ASM's side: file a claim, see their own.
 *
 * The rules live in asmExpenseRules (pure, tested); this stores what they
 * return. Head office then decides each claim from ASM Management: approve,
 * approve part (an approved amount per line, with a reason) or reject (with a
 * reason). The decision can be changed until the claim is marked paid.
 * status: submitted → approved | partially_approved | rejected → paid
 * (approved or partly approved only). The ASM hears of each step on WhatsApp.
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

    // One budget per ASM per quarter, set by HR. quarter is "2026-Q3" (FY start year).
    await db.execute(`
        CREATE TABLE IF NOT EXISTS asm_expense_budgets (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            asm_id VARCHAR(36) NOT NULL,
            quarter VARCHAR(7) NOT NULL,
            total_amount DECIMAL(12,2) NOT NULL,
            local_monthly DECIMAL(10,2) NOT NULL,
            set_by VARCHAR(36) NULL,
            set_by_name VARCHAR(100) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_asm_expense_budget (asm_id, quarter)
        )
    `);

    // CREATE TABLE IF NOT EXISTS leaves an older table as it was, so columns
    // added since the first version are added here when missing.
    const later: [string, string, string][] = [
        ['asm_expense_claims', 'approved_amount', 'DECIMAL(10,2) NULL AFTER total_amount'],
        ['asm_expense_claims', 'reviewed_by_name', 'VARCHAR(100) NULL AFTER reviewed_by'],
        ['asm_expense_items', 'approved_amount', 'DECIMAL(10,2) NULL AFTER amount'],
        ['asm_expense_claims', 'paid_on', 'DATE NULL AFTER reviewed_at'],
        ['asm_expense_claims', 'payment_ref', 'VARCHAR(100) NULL AFTER paid_on'],
        ['asm_expense_claims', 'paid_by', 'VARCHAR(36) NULL AFTER payment_ref'],
        ['asm_expense_claims', 'paid_by_name', 'VARCHAR(100) NULL AFTER paid_by'],
        ['asm_expense_claims', 'paid_at', 'DATETIME NULL AFTER paid_by_name'],
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

/** WhatsApp the ASM about their claim. Never fails the request it follows. */
function tellAsm(claim: any, opts: { changed?: boolean } = {}) {
    if (process.env.ENABLE_WHATSAPP !== 'true' || !claim?.asm_phone) return;
    const values = expenseUpdateValues({
        asm_name: claim.asm_name,
        claim_number: claim.claim_number,
        status: claim.status,
        total_amount: claim.total_amount,
        approved_amount: claim.approved_amount,
        note: claim.status === 'paid' ? claim.payment_ref : claim.review_note,
        changed: opts.changed,
        paid_on: claim.paid_on,
    });
    WhatsAppService.sendAsmExpenseUpdate(claim.asm_phone, values, claim.id)
        .catch(err => console.error('[ASM expense] WhatsApp failed:', err));
}

async function loadClaims(where: string, params: any[], limit = 200) {
    const [claims]: any = await db.execute(
        // DATEs as text: a DATE read back through the IST pool becomes a JS Date
        // at local midnight and serialises as the previous day in UTC.
        `SELECT c.*, a.name AS asm_name, a.phone_number AS asm_phone,
                DATE_FORMAT(c.start_date, '%Y-%m-%d') AS start_day, DATE_FORMAT(c.end_date, '%Y-%m-%d') AS end_day,
                DATE_FORMAT(c.paid_on, '%Y-%m-%d') AS paid_day
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
        paid_on: c.paid_day,
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

// ── Budgets ──────────────────────────────────────────────────────────────────

/** The quarter asked for, or today's. */
const quarterParam = (v: unknown): Quarter => parseQuarter(v) ?? quarterOf(istToday());

type StoredBudget = BudgetInput & { set_by_name: string | null; updated_at: string };

/** Budgets by asm_id for one quarter. */
async function loadBudgets(quarter: string, asmIds?: string[]): Promise<Map<string, StoredBudget>> {
    if (asmIds && !asmIds.length) return new Map();
    const [rows]: any = await db.execute(
        `SELECT asm_id, total_amount, local_monthly, set_by_name, updated_at FROM asm_expense_budgets
          WHERE quarter = ? ${asmIds ? 'AND asm_id IN (?)' : ''}`,
        asmIds ? [quarter, asmIds] : [quarter]
    );
    return new Map(rows.map((r: any) => [r.asm_id, {
        total: Number(r.total_amount), local_monthly: Number(r.local_monthly),
        set_by_name: r.set_by_name, updated_at: r.updated_at,
    }]));
}

/** What the budget maths needs from these ASMs' claims travelling between two dates. */
async function loadBudgetClaims(asmIds: string[], from: string, to: string): Promise<(BudgetClaim & { id: string; asm_id: string })[]> {
    if (!asmIds.length) return [];
    const [rows]: any = await db.execute(
        `SELECT id, asm_id, type, status, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, total_amount, approved_amount
           FROM asm_expense_claims WHERE asm_id IN (?) AND start_date BETWEEN ? AND ?`,
        [asmIds, from, to]
    );
    return rows.map((r: any) => ({
        ...r,
        total_amount: Number(r.total_amount),
        approved_amount: r.approved_amount === null ? null : Number(r.approved_amount),
    }));
}

/** Each claim's place in its pool, for HR to see beside the decision. */
async function attachBudgetPositions(claims: any[]) {
    if (!claims.length) return claims;
    const quarters = new Map<string, Quarter>();
    for (const c of claims) { const q = quarterOf(c.start_date); quarters.set(q.key, q); }
    const asmIds = [...new Set(claims.map(c => c.asm_id as string))];
    const budgets = new Map<string, BudgetInput>();
    for (const q of quarters.values()) {
        for (const [asm, b] of await loadBudgets(q.key, asmIds)) budgets.set(`${asm}|${q.key}`, b);
    }
    const ordered = [...quarters.values()].sort((a, b) => a.start.localeCompare(b.start));
    const all = await loadBudgetClaims(asmIds, ordered[0].start, ordered[ordered.length - 1].end);
    return claims.map(c => {
        const budget = budgets.get(`${c.asm_id}|${quarterOf(c.start_date).key}`) ?? null;
        return { ...c, budget: claimBudgetPosition(budget, all.filter(o => o.asm_id === c.asm_id), c) };
    });
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

    /** GET /api/asm-portal/expenses/budget?quarter= — the ASM's budget for a quarter (this one by default). */
    static async myBudget(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const quarter = quarterParam(req.query.quarter);
            const current = quarterOf(istToday());
            // The ASM looks back, never ahead: a future budget is HR's planning.
            if (quarter.start > current.start) return res.status(400).json({ error: 'That quarter has not started' });
            const budget = (await loadBudgets(quarter.key, [asmId])).get(asmId) ?? null;
            const claims = await loadBudgetClaims([asmId], quarter.start, quarter.end);
            res.json({
                success: true,
                budget: summariseBudget(budget, claims, quarter, istToday()),
                previous: shiftQuarter(quarter, -1).key,
                next: quarter.key === current.key ? null : shiftQuarter(quarter, 1).key,
            });
        } catch (error) {
            console.error('[ASM expense] budget failed:', error);
            res.status(500).json({ error: 'Could not load your budget' });
        }
    }

    // ── Head office ──────────────────────────────────────────────────────────

    /** GET /api/asm/expense-budgets?quarter= — every ASM's budget for one quarter, and where they stand. */
    static async adminBudgets(req: AuthRequest, res: Response) {
        try {
            const quarter = quarterParam(req.query.quarter);
            const today = istToday();
            const [asms]: any = await db.execute('SELECT id, name, is_active FROM asms ORDER BY name');
            const budgets = await loadBudgets(quarter.key);
            const claims = await loadBudgetClaims(asms.map((a: any) => a.id), quarter.start, quarter.end);
            res.json({
                success: true,
                quarter,
                previous: shiftQuarter(quarter, -1).key,
                next: shiftQuarter(quarter, 1).key,
                current: quarterOf(today).key,
                rows: asms
                    // An inactive ASM is listed only if the quarter holds something of theirs.
                    .filter((a: any) => a.is_active || budgets.has(a.id) || claims.some(c => c.asm_id === a.id))
                    .map((a: any) => {
                        const b = budgets.get(a.id) ?? null;
                        return {
                            asm_id: a.id,
                            name: a.name,
                            is_active: !!a.is_active,
                            set_by_name: b?.set_by_name ?? null,
                            updated_at: b?.updated_at ?? null,
                            summary: summariseBudget(b, claims.filter(c => c.asm_id === a.id), quarter, today),
                        };
                    }),
            });
        } catch (error) {
            console.error('[ASM expense] budgets failed:', error);
            res.status(500).json({ error: 'Could not load budgets' });
        }
    }

    /** PUT /api/asm/expense-budgets/:asmId/:quarter — { total, local_monthly }. Sets or changes it. */
    static async setBudget(req: AuthRequest, res: Response) {
        try {
            const quarter = parseQuarter(req.params.quarter);
            if (!quarter) return res.status(400).json({ error: 'Not a quarter' });
            const input = validateBudget(req.body);
            const [asms]: any = await db.execute('SELECT id, name FROM asms WHERE id = ?', [req.params.asmId]);
            if (!asms.length) return res.status(404).json({ error: 'ASM not found' });
            const asm = asms[0];

            const before = (await loadBudgets(quarter.key, [asm.id])).get(asm.id) ?? null;
            await db.execute(
                `INSERT INTO asm_expense_budgets (id, asm_id, quarter, total_amount, local_monthly, set_by, set_by_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE total_amount = VALUES(total_amount), local_monthly = VALUES(local_monthly),
                                         set_by = VALUES(set_by), set_by_name = VALUES(set_by_name)`,
                [uuidv4(), asm.id, quarter.key, input.total, input.local_monthly, req.user!.id, req.user!.name || null]
            );

            ActivityLogService.log({
                adminId: req.user!.id,
                adminName: req.user!.name,
                adminEmail: req.user!.email,
                actionType: before ? 'ASM_BUDGET_CHANGED' : 'ASM_BUDGET_SET',
                targetType: 'asm',
                targetId: asm.id,
                targetName: `${asm.name} · ${quarter.label}`,
                details: {
                    quarter: quarter.key,
                    total: input.total,
                    local_monthly: input.local_monthly,
                    ...(before ? {
                        changes: {
                            total: { from: before.total, to: input.total },
                            local_monthly: { from: before.local_monthly, to: input.local_monthly },
                        },
                    } : {}),
                },
                ipAddress: req.ip,
            }).catch(() => {});

            res.json({ success: true, message: `${quarter.label} budget ${before ? 'changed' : 'set'} for ${asm.name}` });
        } catch (error: any) {
            if (error instanceof BudgetRuleError) return res.status(400).json({ error: error.message });
            console.error('[ASM expense] set budget failed:', error);
            res.status(500).json({ error: 'Could not save the budget' });
        }
    }

    /** DELETE /api/asm/expense-budgets/:asmId/:quarter — take a budget off again. */
    static async removeBudget(req: AuthRequest, res: Response) {
        try {
            const quarter = parseQuarter(req.params.quarter);
            if (!quarter) return res.status(400).json({ error: 'Not a quarter' });
            const [asms]: any = await db.execute('SELECT id, name FROM asms WHERE id = ?', [req.params.asmId]);
            if (!asms.length) return res.status(404).json({ error: 'ASM not found' });
            const asm = asms[0];
            const before = (await loadBudgets(quarter.key, [asm.id])).get(asm.id);
            if (!before) return res.status(404).json({ error: 'No budget is set for this quarter' });

            await db.execute('DELETE FROM asm_expense_budgets WHERE asm_id = ? AND quarter = ?', [asm.id, quarter.key]);
            ActivityLogService.log({
                adminId: req.user!.id,
                adminName: req.user!.name,
                adminEmail: req.user!.email,
                actionType: 'ASM_BUDGET_REMOVED',
                targetType: 'asm',
                targetId: asm.id,
                targetName: `${asm.name} · ${quarter.label}`,
                details: { quarter: quarter.key, total: before.total, local_monthly: before.local_monthly },
                ipAddress: req.ip,
            }).catch(() => {});
            res.json({ success: true, message: `${quarter.label} budget removed for ${asm.name}` });
        } catch (error) {
            console.error('[ASM expense] remove budget failed:', error);
            res.status(500).json({ error: 'Could not remove the budget' });
        }
    }

    /**
     * GET /api/asm/expenses?status=&asm_id= — claims for review, newest first,
     * with the count in each status for the filter cards and the ASMs to filter by.
     */
    static async adminList(req: AuthRequest, res: Response) {
        try {
            const { status, asm_id } = req.query as Record<string, string>;
            const where: string[] = ['1 = 1'];
            const params: any[] = [];
            if (status && status !== 'all') { where.push('c.status = ?'); params.push(status); }
            if (asm_id) { where.push('c.asm_id = ?'); params.push(asm_id); }

            const claims = await attachBudgetPositions(await loadClaims(where.join(' AND '), params, 500));
            const countParams = asm_id ? [asm_id] : [];
            const [counts]: any = await db.execute(
                `SELECT status, COUNT(*) AS n, SUM(total_amount) AS claimed
                   FROM asm_expense_claims ${asm_id ? 'WHERE asm_id = ?' : ''}
                  GROUP BY status`,
                countParams
            );
            // Names for the ASM filter, here because HR has this screen but
            // not ASM Management, whose list carries far more than a name.
            const [asms]: any = await db.execute('SELECT id, name, is_active FROM asms ORDER BY name');
            res.json({
                success: true,
                claims,
                asms: asms.map((a: any) => ({ id: a.id, name: a.name, is_active: !!a.is_active })),
                counts: Object.fromEntries(counts.map((r: any) => [r.status, { n: Number(r.n), claimed: Number(r.claimed || 0) }])),
            });
        } catch (error) {
            console.error('[ASM expense] admin list failed:', error);
            res.status(500).json({ error: 'Could not load expense claims' });
        }
    }

    /**
     * PUT /api/asm/expenses/:id/decision — { action, note?, amounts? }.
     * Decides a submitted claim, or changes the decision on one not yet paid.
     */
    static async decide(req: AuthRequest, res: Response) {
        const { id } = req.params;
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const [rows]: any = await conn.execute(
                'SELECT id, claim_no, status, asm_id, total_amount, approved_amount FROM asm_expense_claims WHERE id = ? FOR UPDATE',
                [id]
            );
            if (!rows.length) {
                await conn.rollback();
                return res.status(404).json({ error: 'Claim not found' });
            }
            const claim = rows[0];
            const changing = claim.status !== 'submitted';
            if (changing && !canChangeDecision(claim.status)) {
                await conn.rollback();
                return res.status(409).json({
                    error: claim.status === 'paid' ? 'This claim has been paid, so its decision can no longer change' : 'This claim cannot be decided',
                });
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

            const [saved] = await attachBudgetPositions(await loadClaims('c.id = ?', [id]));
            ActivityLogService.log({
                adminId: req.user!.id,
                adminName: req.user!.name,
                adminEmail: req.user!.email,
                actionType: changing ? 'ASM_EXPENSE_DECISION_CHANGED' : `ASM_EXPENSE_${decision.status.toUpperCase()}`,
                targetType: 'asm_expense',
                targetId: id,
                targetName: `${saved.claim_number} · ${saved.asm_name ?? 'ASM'}`,
                details: {
                    claimed: Number(claim.total_amount),
                    approved: decision.approved_total,
                    ...(decision.note ? { reason: decision.note } : {}),
                    ...(changing ? {
                        changes: {
                            status: { from: claim.status, to: decision.status },
                            approved: {
                                from: claim.approved_amount === null ? null : Number(claim.approved_amount),
                                to: decision.approved_total,
                            },
                        },
                    } : {}),
                },
                ipAddress: req.ip,
            }).catch(() => {});

            tellAsm(saved, { changed: changing });

            const verb = { approved: 'approved', partially_approved: 'partly approved', rejected: 'rejected' }[decision.status];
            res.json({ success: true, claim: saved, message: `${saved.claim_number} ${changing ? `changed to ${verb}` : verb}` });
        } catch (error: any) {
            await conn.rollback().catch(() => {});
            if (error instanceof ExpenseRuleError) return res.status(400).json({ error: error.message });
            console.error('[ASM expense] decision failed:', error);
            res.status(500).json({ error: 'Could not save the decision' });
        } finally {
            conn.release();
        }
    }
    /**
     * PUT /api/asm/expenses/:id/paid — { paid_on, reference? }. Marks an
     * approved or partly approved claim paid; after that its decision is fixed.
     */
    static async markPaid(req: AuthRequest, res: Response) {
        const { id } = req.params;
        try {
            const payment = validatePayment(req.body, istToday());
            const [rows]: any = await db.execute('SELECT status FROM asm_expense_claims WHERE id = ?', [id]);
            if (!rows.length) return res.status(404).json({ error: 'Claim not found' });
            if (!canMarkPaid(rows[0].status)) {
                return res.status(409).json({
                    error: rows[0].status === 'paid' ? 'This claim is already marked paid' : 'Only an approved claim can be marked paid',
                });
            }
            // The status in the WHERE turns a second click, or a decision changed
            // meanwhile, into a no-op instead of a second payment record.
            const [result]: any = await db.execute(
                `UPDATE asm_expense_claims
                    SET status = 'paid', paid_on = ?, payment_ref = ?, paid_by = ?, paid_by_name = ?, paid_at = NOW()
                  WHERE id = ? AND status = ?`,
                [payment.paid_on, payment.reference, req.user!.id, req.user!.name || null, id, rows[0].status]
            );
            if (!result.affectedRows) return res.status(409).json({ error: 'This claim changed meanwhile. Reload and try again.' });

            const [saved] = await attachBudgetPositions(await loadClaims('c.id = ?', [id]));
            ActivityLogService.log({
                adminId: req.user!.id,
                adminName: req.user!.name,
                adminEmail: req.user!.email,
                actionType: 'ASM_EXPENSE_PAID',
                targetType: 'asm_expense',
                targetId: id,
                targetName: `${saved.claim_number} · ${saved.asm_name ?? 'ASM'}`,
                details: {
                    paid: saved.approved_amount,
                    paid_on: payment.paid_on,
                    ...(payment.reference ? { reference: payment.reference } : {}),
                },
                ipAddress: req.ip,
            }).catch(() => {});

            tellAsm(saved);
            res.json({ success: true, claim: saved, message: `${saved.claim_number} marked paid` });
        } catch (error: any) {
            if (error instanceof ExpenseRuleError) return res.status(400).json({ error: error.message });
            console.error('[ASM expense] mark paid failed:', error);
            res.status(500).json({ error: 'Could not mark the claim paid' });
        }
    }
}
