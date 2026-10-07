import { Response } from 'express';
import db from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { leadPincode } from '../services/leadRouting.js';
import { coverageOf } from '../services/asmTerritoryQuery.js';

/**
 * The ASM's own view of their work: the leads routed to them, the areas they
 * cover, and a summary for their home screen.
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
