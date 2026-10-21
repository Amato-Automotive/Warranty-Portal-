import { Response } from 'express';
import db from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { leadPincode } from '../services/leadRouting.js';
import { coverageOf } from '../services/asmTerritoryQuery.js';
import { storesOfAsm, storeDetailForAsm } from '../services/asmStores.js';
import { cleanAsmName } from '../services/asmAccount.service.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { fieldChanges } from '../services/profileChanges.js';
import { urlToDiskPath, UPLOADS_BASE_DIR } from '../config/localUpload.js';
import fs from 'fs';
import path from 'path';

/** Deletes an old profile photo. Only ever inside uploads/asm-photos; best effort. */
function removeUpload(url: string) {
    const file = path.resolve(urlToDiskPath(url));
    if (!file.startsWith(path.resolve(UPLOADS_BASE_DIR, 'asm-photos') + path.sep)) return;
    fs.promises.unlink(file).catch(() => {});
}

/**
 * The ASM's own view of their work: the leads routed to them, the areas they
 * cover, the stores assigned to them, and a summary for their home screen.
 *
 * Entirely read-only: ASMs do not record lead outcomes (head office does).
 */

/*
 * Leads the ASM was actually given. A duplicate or throttled enquiry carries
 * the ASM's id (it matched their area) but was never sent to them.
 */
const MINE = "l.asm_id = ? AND l.status NOT IN ('duplicate', 'throttled')";

async function asmIdFor(req: AuthRequest): Promise<string | null> {
    const [rows]: any = await db.execute('SELECT id FROM asms WHERE profile_id = ?', [req.user!.id]);
    return rows[0]?.id ?? null;
}

export class AsmPortalController {
    /** GET /api/asm-portal/summary — the numbers on the ASM's home screen. */
    static async summary(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });

            const [[leads]]: any = await db.execute(
                /* created_at is UTC, as the leads screen reads it; days and months are IST's. */
                `SELECT COUNT(*) AS total,
                        SUM(DATE(CONVERT_TZ(l.created_at, '+00:00', '+05:30'))
                            = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))) AS today,
                        SUM(DATE(CONVERT_TZ(l.created_at, '+00:00', '+05:30'))
                            >= DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) - INTERVAL 6 DAY) AS week,
                        SUM(DATE_FORMAT(CONVERT_TZ(l.created_at, '+00:00', '+05:30'), '%Y-%m')
                            = DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'), '%Y-%m')) AS this_month
                   FROM leads l WHERE ${MINE}`,
                [asmId]
            );
            const [[areas]]: any = await db.execute('SELECT COUNT(*) AS n FROM asm_areas WHERE asm_id = ?', [asmId]);
            const [[stores]]: any = await db.execute('SELECT COUNT(*) AS n FROM vendor_details WHERE asm_id = ?', [asmId]);
            let claims = { pending: 0, amount: 0 };
            try {
                const [[c]]: any = await db.execute(
                    `SELECT COUNT(*) AS pending, COALESCE(SUM(total_amount), 0) AS amount
                       FROM asm_expense_claims WHERE asm_id = ? AND status = 'submitted'`,
                    [asmId]
                );
                claims = { pending: Number(c.pending), amount: Number(c.amount) };
            } catch { /* expense tables not created yet */ }

            res.json({
                success: true,
                leads: {
                    total: Number(leads.total || 0),
                    today: Number(leads.today || 0),
                    week: Number(leads.week || 0),
                    this_month: Number(leads.this_month || 0),
                },
                areas: Number(areas.n || 0),
                stores: Number(stores.n || 0),
                claims,
            });
        } catch (error) {
            console.error('[ASM portal] summary failed:', error);
            res.status(500).json({ error: 'Could not load your summary' });
        }
    }

    /** GET /api/asm-portal/leads — the ASM's leads, newest first. */
    static async leads(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const [rows]: any = await db.execute(
                `SELECT l.id, l.created_at, l.source, l.customer_name, l.customer_phone, l.product, l.car_model,
                        l.state, l.raw_area, l.matched_area, l.raw_payload
                   FROM leads l
                  WHERE ${MINE}
                  ORDER BY l.created_at DESC
                  LIMIT 1000`,
                [asmId]
            );
            res.json({
                success: true,
                leads: rows.map(({ raw_payload, ...l }: any) => ({
                    ...l,
                    pincode: leadPincode(raw_payload, l.raw_area),
                })),
            });
        } catch (error) {
            console.error('[ASM portal] leads failed:', error);
            res.status(500).json({ error: 'Could not load your leads' });
        }
    }

    /** GET /api/asm-portal/stores — the franchises and distributors assigned to the ASM. */
    static async stores(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            res.json({ success: true, stores: await storesOfAsm(asmId) });
        } catch (error) {
            console.error('[ASM portal] stores failed:', error);
            res.status(500).json({ error: 'Could not load your stores' });
        }
    }

    /** GET /api/asm-portal/stores/:id — one of the ASM's stores, with its POSM requests and grievances. */
    static async storeDetail(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const detail = await storeDetailForAsm(asmId, String(req.params.id));
            // Another ASM's store reads as missing, not forbidden.
            if (!detail) return res.status(404).json({ error: 'Store not found' });
            res.json({ success: true, ...detail });
        } catch (error) {
            console.error('[ASM portal] store detail failed:', error);
            res.status(500).json({ error: 'Could not load this store' });
        }
    }

    /** GET /api/asm-portal/profile — the ASM's own details for the Profile tab. */
    static async profile(req: AuthRequest, res: Response) {
        try {
            const [rows]: any = await db.execute(
                'SELECT id, name, phone_number, email, photo_url FROM asms WHERE profile_id = ?',
                [req.user!.id]
            );
            if (!rows.length) return res.status(403).json({ error: 'Your ASM account was not found' });
            res.json({ success: true, profile: rows[0] });
        } catch (error) {
            console.error('[ASM portal] profile failed:', error);
            res.status(500).json({ error: 'Could not load your profile' });
        }
    }

    /**
     * PUT /api/asm-portal/profile — the ASM corrects the spelling of their name.
     * Only the name: the number is their login and the email belongs to head
     * office, so neither is read from the body. Nothing is keyed on the name
     * (stores, leads and claims all hang off asms.id), so a rename is safe.
     */
    static async updateName(req: AuthRequest, res: Response) {
        const name = cleanAsmName(req.body?.name);
        if (!name) {
            return res.status(400).json({ error: 'Enter your name as 2 to 60 letters (spaces, dots, apostrophes and hyphens are fine)' });
        }
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const [rows]: any = await conn.execute(
                'SELECT id, name FROM asms WHERE profile_id = ? FOR UPDATE',
                [req.user!.id]
            );
            if (!rows.length) {
                await conn.rollback();
                return res.status(403).json({ error: 'Your ASM account was not found' });
            }
            const before = rows[0];
            if (before.name === name) {
                await conn.rollback();
                return res.json({ success: true, name });
            }
            // Both copies: asms is what head office sees, profiles is the login.
            await conn.execute('UPDATE asms SET name = ? WHERE id = ?', [name, before.id]);
            await conn.execute('UPDATE profiles SET name = ? WHERE id = ?', [name, req.user!.id]);
            await conn.commit();

            await ActivityLogService.log({
                adminId: req.user!.id,
                adminName: name,
                adminEmail: req.user!.email,
                actionType: 'ASM_NAME_CHANGED',
                targetType: 'ASM',
                targetId: before.id,
                targetName: name,
                details: { by: 'asm', changes: fieldChanges({ name: before.name }, { name }) },
                ipAddress: req.ip || req.socket?.remoteAddress,
            });
            res.json({ success: true, name });
        } catch (error) {
            await conn.rollback().catch(() => {});
            console.error('[ASM portal] name change failed:', error);
            res.status(500).json({ error: 'Could not save your name' });
        } finally {
            conn.release();
        }
    }

    /** POST /api/asm-portal/profile/photo — set or replace the ASM's photo (field "photo"). */
    static async setPhoto(req: AuthRequest, res: Response) {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file?.path) return res.status(400).json({ error: 'Choose a photo to upload' });
        try {
            const [rows]: any = await db.execute('SELECT id, photo_url FROM asms WHERE profile_id = ?', [req.user!.id]);
            if (!rows.length) {
                removeUpload(file.path);
                return res.status(403).json({ error: 'Your ASM account was not found' });
            }
            await db.execute('UPDATE asms SET photo_url = ? WHERE id = ?', [file.path, rows[0].id]);
            if (rows[0].photo_url) removeUpload(rows[0].photo_url);
            res.json({ success: true, photo_url: file.path });
        } catch (error) {
            console.error('[ASM portal] photo upload failed:', error);
            res.status(500).json({ error: 'Could not save your photo' });
        }
    }

    /** DELETE /api/asm-portal/profile/photo — back to initials. */
    static async removePhoto(req: AuthRequest, res: Response) {
        try {
            const [rows]: any = await db.execute('SELECT id, photo_url FROM asms WHERE profile_id = ?', [req.user!.id]);
            if (!rows.length) return res.status(403).json({ error: 'Your ASM account was not found' });
            await db.execute('UPDATE asms SET photo_url = NULL WHERE id = ?', [rows[0].id]);
            if (rows[0].photo_url) removeUpload(rows[0].photo_url);
            res.json({ success: true });
        } catch (error) {
            console.error('[ASM portal] photo removal failed:', error);
            res.status(500).json({ error: 'Could not remove your photo' });
        }
    }

    /** GET /api/asm-portal/areas — the places the ASM covers, with how many pincodes each holds. */
    static async areas(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const [rows]: any = await db.execute(
                `SELECT id, area_label, kind, state, district, pincode
                   FROM asm_areas WHERE asm_id = ? ORDER BY state, kind, area_label`,
                [asmId]
            );
            const counts = await coverageOf(rows).catch(() => rows.map(() => 0));
            res.json({ success: true, areas: rows.map((a: any, i: number) => ({ ...a, pincodes: counts[i] })) });
        } catch (error) {
            console.error('[ASM portal] areas failed:', error);
            res.status(500).json({ error: 'Could not load your areas' });
        }
    }
}
