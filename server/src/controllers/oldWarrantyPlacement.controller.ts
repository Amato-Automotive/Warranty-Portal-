import { Response } from 'express';
import db from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { GROUP_MATCH, groupArgs, periodText } from '../services/oldWarrantyGroups.js';

/**
 * Admin › Old Warranties: which store each old store name went to, the names
 * with no store in the portal, the ones still to confirm, and placing or
 * moving a name's warranties onto a store.
 */

const json = <T>(v: unknown, d: T): T => { if (v == null) return d; if (typeof v !== 'string') return v as T; try { return JSON.parse(v) as T; } catch { return d; } };
const brandText = (b: string | null) => (b === 'AFAC' ? 'AF+AC' : b || 'AF');
const fail = (res: Response, what: string, e: unknown) => { console.error(`[Old warranties] ${what}:`, e); res.status(500).json({ success: false, error: `Could not load ${what}` }); };

export class OldWarrantyPlacementController {
    /** GET /api/admin/old-warranties/placement/summary — the tab counts. */
    static async summary(_req: AuthRequest, res: Response) {
        try {
            const [[t]]: any = await db.query('SELECT COUNT(*) AS n, SUM(store_id IS NOT NULL) AS placed, COUNT(DISTINCT store_id) AS stores FROM old_warranties_seatcovers');
            const [g]: any = await db.query('SELECT state, COUNT(*) AS names_n, SUM(rows_count) AS n FROM old_warranty_groups GROUP BY state');
            const of = (s: string) => g.find((x: any) => x.state === s) ?? { names_n: 0, n: 0 };
            res.json({
                success: true, total: Number(t.n), placed: Number(t.placed || 0), stores: Number(t.stores || 0),
                no_store: { names: Number(of('no_store').names_n), rows: Number(of('no_store').n || 0) },
                open: { names: Number(of('open').names_n), rows: Number(of('open').n || 0) },
            });
        } catch (e) { fail(res, 'the counts', e); }
    }

    /** GET /placement/stores?q=&page= — stores with old warranties, most first. */
    static async stores(req: AuthRequest, res: Response) {
        try {
            const q = String(req.query.q ?? '').trim().slice(0, 60);
            const page = Math.max(1, Number(req.query.page) || 1);
            const where = q ? 'WHERE (vd.store_name LIKE ? OR vd.city LIKE ? OR vd.store_code LIKE ?)' : '';
            const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
            const [rows]: any = await db.query(
                `SELECT s.store_id, s.n, s.first_d, s.last_d, TRIM(vd.store_name) AS store_name, vd.store_code, vd.city, vd.state, vd.allowed_brands,
                        (SELECT GROUP_CONCAT(DISTINCT g.store_name ORDER BY g.rows_count DESC SEPARATOR ', ') FROM old_warranty_groups g WHERE g.store_id = s.store_id) AS names
                   FROM (SELECT store_id, COUNT(*) AS n, MIN(purchase_date) AS first_d, MAX(purchase_date) AS last_d FROM old_warranties_seatcovers WHERE store_id IS NOT NULL GROUP BY store_id) s
                   JOIN vendor_details vd ON vd.id = s.store_id ${where}
                  ORDER BY s.n DESC LIMIT 25 OFFSET ${(page - 1) * 25}`, params);
            const [[c]]: any = await db.query(
                `SELECT COUNT(*) AS n FROM (SELECT DISTINCT store_id FROM old_warranties_seatcovers WHERE store_id IS NOT NULL) s JOIN vendor_details vd ON vd.id = s.store_id ${where}`, params);
            const ym = (d: unknown) => (d instanceof Date ? new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 7) : d ? String(d).slice(0, 7) : null);
            res.json({
                success: true, page, pages: Math.max(1, Math.ceil(Number(c.n) / 25)), total: Number(c.n),
                stores: rows.map((r: any) => ({
                    store_id: String(r.store_id), store_name: r.store_name, store_code: r.store_code ?? null, city: r.city ?? null, state: r.state ?? null,
                    brand: brandText(r.allowed_brands), rows: Number(r.n), period: periodText(ym(r.first_d), ym(r.last_d)), names: r.names ?? '',
                })),
            });
        } catch (e) { fail(res, 'the stores', e); }
    }

    /** GET /placement/stores/:id — one store: the old names placed on it, and its counts by year. */
    static async store(req: AuthRequest, res: Response) {
        try {
            const id = String(req.params.id);
            const [[s]]: any = await db.query('SELECT id, TRIM(store_name) AS store_name, store_code, city, state, allowed_brands FROM vendor_details WHERE id = ? OR user_id = ? LIMIT 1', [id, id]);
            if (!s) return res.status(404).json({ success: false, error: 'Store not found' });
            const [groups]: any = await db.query('SELECT id, store_name, store_email, rows_count, period_first, period_last FROM old_warranty_groups WHERE store_id = ? ORDER BY rows_count DESC', [s.id]);
            const [years]: any = await db.query('SELECT YEAR(purchase_date) AS y, COUNT(*) AS n FROM old_warranties_seatcovers WHERE store_id = ? GROUP BY y ORDER BY y', [s.id]);
            res.json({
                success: true,
                store: { store_id: String(s.id), store_name: s.store_name, store_code: s.store_code ?? null, city: s.city ?? null, state: s.state ?? null, brand: brandText(s.allowed_brands) },
                total: years.reduce((n: number, y: any) => n + Number(y.n), 0),
                years: years.filter((y: any) => y.y).map((y: any) => ({ year: Number(y.y), n: Number(y.n) })),
                groups: groups.map((g: any) => ({ id: g.id, name: g.store_name, email: g.store_email, rows: Number(g.rows_count), period: periodText(g.period_first, g.period_last) })),
            });
        } catch (e) { fail(res, 'the store', e); }
    }

    /** GET /placement/groups?state=no_store|open — old names with no store, or still to confirm, with the suggested stores. */
    static async groups(req: AuthRequest, res: Response) {
        try {
            const state = req.query.state === 'open' ? 'open' : 'no_store';
            const [rows]: any = await db.query('SELECT * FROM old_warranty_groups WHERE state = ? ORDER BY rows_count DESC', [state]);
            const ids = [...new Set(rows.flatMap((r: any) => json<any[]>(r.candidates, []).map(c => String(c.id))))];
            const [stores]: any = ids.length ? await db.query('SELECT id, TRIM(store_name) AS store_name, city, store_code FROM vendor_details WHERE id IN (?)', [ids]) : [[]];
            const named = new Map<string, any>(stores.map((s: any) => [String(s.id), s]));
            res.json({
                success: true,
                groups: rows.map((g: any) => ({
                    id: g.id, name: g.store_name, email: g.store_email, rows: Number(g.rows_count), period: periodText(g.period_first, g.period_last), note: g.note ?? null,
                    candidates: json<any[]>(g.candidates, []).filter(c => named.has(String(c.id))).slice(0, 4)
                        .map(c => ({ store_id: String(c.id), store_name: named.get(String(c.id)).store_name, city: named.get(String(c.id)).city ?? null, why: c.why ?? null })),
                })),
            });
        } catch (e) { fail(res, 'the names', e); }
    }

    /**
     * POST /placement/groups/:id/place — { store_id } places (or moves) an old
     * name's warranties onto a store; { store_id: null } marks it as having no
     * store in the portal. The store id may be the store's or its login's.
     */
    static async place(req: AuthRequest, res: Response) {
        try {
            const [[g]]: any = await db.query('SELECT * FROM old_warranty_groups WHERE id = ?', [String(req.params.id)]);
            if (!g) return res.status(404).json({ success: false, error: 'Old store name not found' });
            const raw = req.body?.store_id == null || req.body.store_id === '' ? null : String(req.body.store_id);
            let store: any = null;
            if (raw) {
                [[store]] = await db.query('SELECT id, TRIM(store_name) AS store_name FROM vendor_details WHERE id = ? OR user_id = ? ORDER BY id = ? DESC LIMIT 1', [raw, raw, raw]) as any;
                if (!store) return res.status(400).json({ success: false, error: 'Pick a store' });
            }
            const by = String((req.user as any)?.name ?? 'Admin').slice(0, 120);
            await db.query('UPDATE old_warranty_groups SET state = ?, store_id = ?, decided_by = ?, decided_at = NOW() WHERE id = ?', [store ? 'placed' : 'no_store', store ? String(store.id) : null, by, g.id]);
            const [r]: any = await db.query(`UPDATE old_warranties_seatcovers SET store_id = ?, store_linked_at = NOW() WHERE ${GROUP_MATCH}`, [store ? String(store.id) : null, ...groupArgs(g)]);
            await ActivityLogService.log({
                adminId: req.user!.id, adminName: (req.user as any)?.name, adminEmail: (req.user as any)?.email,
                actionType: store ? 'OLD_WARRANTIES_PLACED' : 'OLD_WARRANTIES_NO_STORE', targetType: 'OLD_WARRANTY_GROUP', targetId: g.id, targetName: g.store_name ?? '(no name)',
                details: { email: g.store_email, rows: r.affectedRows, from_store: g.store_id ?? null, to_store: store ? String(store.id) : null, to_name: store?.store_name ?? null },
                ipAddress: req.ip || req.socket?.remoteAddress,
            }).catch(() => {});
            res.json({ success: true, moved: r.affectedRows, store: store ? { store_id: String(store.id), store_name: store.store_name } : null });
        } catch (e) {
            console.error('[Old warranties] place:', e);
            res.status(500).json({ success: false, error: 'Could not save it' });
        }
    }
}
