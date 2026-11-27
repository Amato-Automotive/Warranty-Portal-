import { Response } from 'express';
import db from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { posmDrill, posmOverview, type ALine, type Drill, type StoreFacts } from '../services/posmAnalytics.js';
import { DEFAULT_SETTINGS, type StoreSettings } from '../services/posmHistory.js';

/** POSM on the Analytics page: the overview, and the stores or lines behind a click. */

const json = <T>(v: unknown, d: T): T => { if (v == null) return d; if (typeof v !== 'string') return v as T; try { return JSON.parse(v) as T; } catch { return d; } };
/* A DATE comes back as India midnight; the server runs on UTC, so read it in India time. */
const day = (v: unknown) => (v instanceof Date ? new Date(v.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function load() {
    const [rows]: any = await db.query(
        `SELECT h.id, h.source, h.store_id, h.store_code, COALESCE(TRIM(vd.store_name), h.sheet_store_name) AS store_name, h.item, h.qty, h.status,
                h.request_date, h.dispatch_date, h.expected_dispatch, h.reason, h.flags, h.request_id
           FROM posm_dispatch_history h LEFT JOIN vendor_details vd ON vd.id = h.store_id WHERE h.deleted_at IS NULL`);
    const lines: ALine[] = rows.map((r: any) => ({
        id: String(r.id), source: r.source, store_id: r.store_id ? String(r.store_id) : null, store_code: r.store_code ?? null, store_name: r.store_name ?? null,
        item: r.item, qty: Number(r.qty) || 0, status: r.status, request_date: day(r.request_date), dispatch_date: day(r.dispatch_date),
        expected_dispatch: day(r.expected_dispatch), reason: r.reason ?? null, flags: json<string[]>(r.flags, []), request_id: r.request_id ?? null,
    }));
    const [set]: any = await db.query('SELECT * FROM posm_store_settings');
    const settings = new Map<string, StoreSettings>(set.map((s: any) => [String(s.store_id), {
        ...DEFAULT_SETTINGS, store_type: s.store_type === 'new' ? 'new' : 'old', type_assumed: Boolean(s.type_assumed), frp_limit: Number(s.frp_limit), jacket_limit: Number(s.jacket_limit),
    }]));
    const ids = [...new Set(lines.map(l => l.store_id).filter(Boolean))] as string[];
    const stores = new Map<string, StoreFacts>();
    if (ids.length) {
        const [st]: any = await db.query(
            `SELECT vd.id, TRIM(vd.store_name) AS name, vd.store_code, vd.city, vd.state,
                    (SELECT COUNT(*) FROM warranty_registrations w WHERE w.vendor_details_id = vd.id AND w.created_at >= NOW() - INTERVAL 182 DAY AND w.status <> 'rejected') AS w6
               FROM vendor_details vd WHERE vd.id IN (?)`, [ids]);
        for (const s of st) stores.set(String(s.id), { id: String(s.id), name: s.name, code: s.store_code ?? null, city: s.city ?? null, state: s.state ?? null, warranties6m: Number(s.w6) || 0 });
    }
    const [requests]: any = await db.query('SELECT status FROM posm_requests');
    return { lines, settings, stores, requests };
}

export class POSMAnalyticsController {
    static async overview(_req: AuthRequest, res: Response) {
        try {
            const d = await load();
            res.json({ success: true, ...posmOverview(d.lines, d.settings, d.stores, d.requests, istToday()) });
        } catch (error) {
            console.error('[POSM analytics] overview:', error);
            res.status(500).json({ success: false, error: 'Could not load the POSM analytics' });
        }
    }

    static async drill(req: AuthRequest, res: Response) {
        try {
            const q = req.query as Record<string, string | undefined>;
            const kind = String(q.kind ?? '');
            const drill: Drill | null =
                kind === 'risk' || kind === 'tile' ? { kind, key: String(q.key ?? '') }
                : kind === 'month' && /^\d{4}-\d{2}$/.test(String(q.month)) ? { kind, month: String(q.month), source: q.source || undefined }
                : kind === 'status' ? { kind, status: String(q.status ?? ''), source: q.source || undefined }
                : kind === 'age' ? { kind, bucket: String(q.bucket ?? '') }
                : kind === 'item' ? { kind, item: String(q.item ?? '') }
                : null;
            if (!drill) return res.status(400).json({ success: false, error: 'Unknown drill-down' });
            const d = await load();
            const out = posmDrill(drill, d.lines, d.settings, d.stores, istToday());
            res.json({ success: true, ...out, rows: out.rows.slice(0, 1000), total: out.rows.length });
        } catch (error) {
            console.error('[POSM analytics] drill:', error);
            res.status(500).json({ success: false, error: 'Could not load the details' });
        }
    }
}
