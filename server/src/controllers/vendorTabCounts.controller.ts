import { Response } from 'express';
import db from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';

/**
 * GET /api/admin/vendors/:id/tab-counts — how many of each thing a franchise
 * has, for the counts beside its tabs. Each count follows the rule its tab
 * lists by, so the number matches what opens. :id is the store's
 * vendor_details id or its login (profiles) id.
 */
export class VendorTabCountsController {
    static async counts(req: AuthRequest, res: Response) {
        try {
            const id = String(req.params.id);
            const [[s]]: any = await db.execute(
                `SELECT vd.id, vd.user_id, vd.store_email, p.phone_number
                   FROM vendor_details vd LEFT JOIN profiles p ON p.id = vd.user_id
                  WHERE vd.id = ? OR vd.user_id = ? LIMIT 1`, [id, id]);
            if (!s) return res.status(404).json({ success: false, error: 'Store not found' });
            const vd = String(s.id), uid = String(s.user_id ?? '');
            const n = async (sql: string, params: unknown[]) => {
                try { const [[r]]: any = await db.query(sql, params); return Number(r?.n ?? 0); }
                catch (e) { console.error('[Tab counts]', sql.slice(0, 60), e); return null; }
            };
            const last10 = String(s.phone_number ?? '').replace(/\D/g, '').slice(-10);
            const email = String(s.store_email ?? '');
            const [oldWarranties, orders, posmRequests, posmShipments, complaints, audits, sourcing, claims, announcements] = await Promise.all([
                n('SELECT COUNT(*) AS n FROM old_warranties_seatcovers WHERE store_id = ?', [vd]),
                uid ? n('SELECT COUNT(*) AS n FROM store_orders WHERE vendor_id = ?', [uid]) : 0,
                n('SELECT COUNT(*) AS n FROM posm_requests WHERE franchise_id = ?', [vd]),
                n('SELECT COUNT(*) AS n FROM posm_dispatch_history WHERE store_id = ? AND deleted_at IS NULL', [vd]),
                uid ? n("SELECT COUNT(*) AS n FROM grievances WHERE source_type = 'franchise' AND customer_id = ?", [uid]) : 0,
                n('SELECT COUNT(*) AS n FROM store_audits WHERE vendor_details_id = ?', [vd]),
                uid ? n('SELECT COUNT(*) AS n FROM franchise_distributors WHERE franchise_user_id = ?', [uid]) : 0,
                n('SELECT COUNT(*) AS n FROM warranty_claims WHERE store_id = ?', [vd]),
                last10 || email ? n(
                    `SELECT LEAST(COUNT(*), 100) AS n FROM message_logs ml
                      WHERE ml.context = 'admin_broadcast'
                        AND (RIGHT(REGEXP_REPLACE(COALESCE(ml.recipient_phone, ''), '[^0-9]', ''), 10) = ? OR (? <> '' AND ml.recipient_email = ?))`,
                    [last10 || '-', email, email]) : 0,
            ]);
            res.json({
                success: true,
                counts: { old_warranties: oldWarranties, orders, posm_requests: posmRequests, posm_shipments: posmShipments, complaints, audits, sourcing, claims, announcements },
            });
        } catch (e) {
            console.error('[Tab counts]', e);
            res.status(500).json({ success: false, error: 'Could not load the counts' });
        }
    }
}
