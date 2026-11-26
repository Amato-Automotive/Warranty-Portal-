import { Response } from 'express';
import db from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { vendorRepository } from '../repositories/vendor.repository.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { v4 as uuidv4 } from 'uuid';
import {
    APPROVAL_LABEL, DEFAULT_SETTINGS, DEPOTS, NOIDA_SOURCE, POSM_ITEMS, POSM_STATUSES, checkPlantEdit, needsReason, noidaGroupKey, orderNeedsApproval, readStatus, summarise,
    type Depot, type LineFlag, type StoreSettings,
} from '../services/posmHistory.js';

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const isDayStr = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const txt = (v: unknown, max: number) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

/** A portal store with the distributor and ASM its latest POSM line gave. */
async function storeInfo(id: string) {
    if (!id) return null;
    const [[s]]: any = await db.execute(`SELECT id, store_code, store_name, city, state, COALESCE(allowed_brands, 'AF') AS brand FROM vendor_details WHERE id = ?`, [id]);
    if (!s) return null;
    const [[last]]: any = await db.execute(
        `SELECT distributor, asm FROM posm_dispatch_history WHERE store_id = ? AND deleted_at IS NULL AND (distributor IS NOT NULL OR asm IS NOT NULL) ORDER BY COALESCE(dispatch_date, request_date) DESC LIMIT 1`, [id]);
    return { id: String(s.id), store_code: s.store_code ?? null, store_name: String(s.store_name ?? '').trim(), city: s.city ?? null, state: s.state ?? null, brand: s.brand, distributor: last?.distributor ?? null, asm: last?.asm ?? null };
}

/**
 * POSM dispatch history: what has been sent to each store, its FRP and
 * Sample Jacket limits, lines not yet linked to a store, and each store's
 * own view of what it has received.
 */

const json = <T>(v: unknown, fallback: T): T => {
    if (v == null) return fallback;
    if (typeof v !== 'string') return v as T;
    try { return JSON.parse(v) as T; } catch { return fallback; }
};
/* A DATE comes back as India midnight (the pool is +05:30); the server itself runs on UTC, so read it in India time. */
const day = (v: unknown) => {
    if (!v) return null;
    if (v instanceof Date) return new Date(v.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    return String(v).slice(0, 10);
};

const LINE_COLS = `id, source, store_id, store_code, sheet_store_name, city, state, distributor, asm, item, design, major_colour, minor_colour, brand, store_kind,
    qty, status, request_date, dispatch_date, delivery_date, expected_dispatch, status_changed_on, courier, docket_no, dispatched_by, reason, remarks, address, match_note, flags, updated_at`;

const readLine = (r: any) => ({
    id: r.id, source: r.source, store_id: r.store_id ? String(r.store_id) : null, store_code: r.store_code, sheet_store_name: r.sheet_store_name,
    city: r.city, state: r.state, distributor: r.distributor, asm: r.asm,
    item: r.item, design: r.design, major_colour: r.major_colour, minor_colour: r.minor_colour, brand: r.brand, store_kind: r.store_kind,
    qty: Number(r.qty), status: r.status,
    request_date: day(r.request_date), dispatch_date: day(r.dispatch_date), delivery_date: day(r.delivery_date), expected_dispatch: day(r.expected_dispatch), status_changed_on: day(r.status_changed_on),
    courier: r.courier, docket_no: r.docket_no, dispatched_by: r.dispatched_by, reason: r.reason, remarks: r.remarks, address: r.address, match_note: r.match_note,
    flags: json<LineFlag[]>(r.flags, []), updated_at: r.updated_at,
});

const readSettings = (r: any): StoreSettings => r
    ? { store_type: r.store_type === 'new' ? 'new' : 'old', type_assumed: Boolean(r.type_assumed), frp_limit: Number(r.frp_limit), jacket_limit: Number(r.jacket_limit) }
    : DEFAULT_SETTINGS;

const log = (req: AuthRequest, actionType: string, details: Record<string, unknown>) =>
    ActivityLogService.log({ adminId: req.user?.id ?? '', actionType, details }).catch(() => {});

async function settingsFor(storeIds: string[]) {
    const out = new Map<string, StoreSettings>();
    if (!storeIds.length) return out;
    const [rows]: any = await db.query('SELECT * FROM posm_store_settings WHERE store_id IN (?)', [storeIds]);
    for (const r of rows) out.set(String(r.store_id), readSettings(r));
    return out;
}

export class POSMHistoryController {
    /**
     * Every store with POSM history, like the sheet's Stores tab: what it has had
     * of each item, its limits and whether more needs approval, its distributor,
     * ASM, courier, delivery status and where it was sent from. Lines not linked
     * to a store are listed too, one row per code or name the sheet gave.
     */
    static async stores(req: AuthRequest, res: Response) {
        try {
            const [lines]: any = await db.query(
                `SELECT store_id, store_code, sheet_store_name, city, state, distributor, asm, source, courier, store_kind, item, qty, status, dispatch_date, request_date, flags
                   FROM posm_dispatch_history WHERE deleted_at IS NULL ORDER BY COALESCE(dispatch_date, request_date)`);
            const groups = new Map<string, any[]>();
            let unlinked = 0;
            for (const l of lines) {
                const key = l.store_id ? `store:${l.store_id}` : l.store_code ? `code:${l.store_code}` : `name:${l.sheet_store_name ?? ''}`;
                if (!l.store_id) unlinked++;
                groups.set(key, [...(groups.get(key) ?? []), { ...l, qty: Number(l.qty), dispatch_date: day(l.dispatch_date), request_date: day(l.request_date), flags: json<string[]>(l.flags, []) }]);
            }
            const ids = [...groups.keys()].filter(k => k.startsWith('store:')).map(k => k.slice(6));
            const [stores]: any = ids.length ? await db.query(
                `SELECT vd.id, vd.store_code, vd.store_name, vd.city, vd.state, COALESCE(vd.allowed_brands, 'AF') AS brand FROM vendor_details vd WHERE vd.id IN (?)`, [ids]) : [[]];
            const storeOf = new Map<string, any>(stores.map((s: any) => [String(s.id), s]));
            const settings = await settingsFor(ids);
            /* The latest value a line gave (lines are oldest first). */
            const latest = (ls: any[], f: string) => { for (let i = ls.length - 1; i >= 0; i--) if (ls[i][f]) return String(ls[i][f]); return null; };
            const rows = [...groups.entries()].map(([key, ls]) => {
                const linked = key.startsWith('store:');
                const s = linked ? storeOf.get(key.slice(6)) : null;
                const kind = latest(ls, 'store_kind');
                const set = linked ? (settings.get(key.slice(6)) ?? DEFAULT_SETTINGS)
                    : { ...DEFAULT_SETTINGS, ...(kind ? { store_type: /^new/i.test(kind) ? 'new' as const : 'old' as const, type_assumed: false } : {}) };
                const sum = summarise(ls, set);
                const byStatus: Record<string, number> = {};
                for (const l of ls) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
                return {
                    key, linked, store_id: linked ? key.slice(6) : null,
                    store_code: s?.store_code ?? ls[0].store_code ?? null,
                    store_name: String(s?.store_name ?? ls[0].sheet_store_name ?? '').trim() || '(no store name in the sheet)',
                    city: s?.city ?? latest(ls, 'city'), state: s?.state ?? latest(ls, 'state'), brand: s?.brand ?? null,
                    distributor: latest(ls, 'distributor'), asm: latest(ls, 'asm'), courier: latest(ls, 'courier'),
                    sent_from: [...new Set(ls.map(l => String(l.source)))],
                    by_status: byStatus,
                    sent_to_asm: ls.some(l => (l.flags as string[]).includes('sent_to_asm')),
                    settings: set, summary: sum, approval_label: APPROVAL_LABEL[sum.approval],
                    flagged: ls.filter(l => (l.flags as string[]).length).length,
                };
            });
            const mine = rows.filter(r => r.linked);
            const count = (a: string) => mine.filter((r: any) => r.summary.approval === a).length;
            res.json({
                success: true, stores: rows,
                totals: {
                    stores: mine.length, unlinked_stores: rows.length - mine.length, lines: lines.length, unlinked,
                    within: count('within'), reached: count('reached'), over: count('over'), new_open: count('new_open'), new_used: count('new_used'),
                    pending_over: mine.filter((r: any) => r.summary.frp.state === 'pending_over' || r.summary.jacket.state === 'pending_over').length,
                    flagged: rows.reduce((n: number, r: any) => n + r.flagged, 0),
                },
            });
        } catch (error) {
            console.error('[POSM history] stores:', error);
            res.status(500).json({ success: false, error: 'Could not load the POSM history' });
        }
    }

    /** Every line, like the sheet's All Dispatches tab, with the store it is linked to. */
    static async lines(req: AuthRequest, res: Response) {
        try {
            const [rows]: any = await db.query(
                `SELECT h.${LINE_COLS.split(',').map(c => c.trim()).join(', h.')}, vd.store_name AS portal_store_name
                   FROM posm_dispatch_history h LEFT JOIN vendor_details vd ON vd.id = h.store_id
                  WHERE h.deleted_at IS NULL ORDER BY COALESCE(h.dispatch_date, h.request_date) DESC, h.sheet_row`);
            res.json({ success: true, lines: rows.map((r: any) => ({ ...readLine(r), portal_store_name: r.portal_store_name ? String(r.portal_store_name).trim() : null })) });
        } catch (error) {
            console.error('[POSM history] lines:', error);
            res.status(500).json({ success: false, error: 'Could not load the lines' });
        }
    }

    /** One store: its settings, totals and every line, newest first. */
    static async store(req: AuthRequest, res: Response) {
        try {
            const storeId = String(req.params.storeId);
            const [[store]]: any = await db.execute('SELECT id, store_code, store_name, city, state FROM vendor_details WHERE id = ?', [storeId]);
            if (!store) return res.status(404).json({ success: false, error: 'Store not found' });
            const [rows]: any = await db.execute(
                `SELECT ${LINE_COLS} FROM posm_dispatch_history WHERE store_id = ? AND deleted_at IS NULL ORDER BY COALESCE(dispatch_date, request_date) DESC, item`, [storeId]);
            const lines = rows.map(readLine);
            const settings = (await settingsFor([storeId])).get(storeId) ?? DEFAULT_SETTINGS;
            const summary = summarise(lines, settings);
            res.json({ success: true, store: { ...store, store_name: String(store.store_name ?? '').trim() }, settings, summary, approval_label: APPROVAL_LABEL[summary.approval], lines });
        } catch (error) {
            console.error('[POSM history] store:', error);
            res.status(500).json({ success: false, error: 'Could not load the store' });
        }
    }

    /** A store's type and limits. */
    static async saveSettings(req: AuthRequest, res: Response) {
        try {
            const storeId = String(req.params.storeId);
            const [[store]]: any = await db.execute('SELECT id, store_name FROM vendor_details WHERE id = ?', [storeId]);
            if (!store) return res.status(404).json({ success: false, error: 'Store not found' });
            const type = req.body?.store_type === 'new' ? 'new' : 'old';
            const lim = (v: unknown, d: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : d; };
            const frp = lim(req.body?.frp_limit, 2), jacket = lim(req.body?.jacket_limit, 20);
            const [[before]]: any = await db.execute('SELECT * FROM posm_store_settings WHERE store_id = ?', [storeId]);
            await db.execute(
                `INSERT INTO posm_store_settings (store_id, store_type, type_assumed, frp_limit, jacket_limit, updated_by) VALUES (?, ?, 0, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE store_type = VALUES(store_type), type_assumed = 0, frp_limit = VALUES(frp_limit), jacket_limit = VALUES(jacket_limit), updated_by = VALUES(updated_by)`,
                [storeId, type, frp, jacket, req.user?.id ?? null]);
            log(req, 'POSM_STORE_SETTINGS', { store_id: storeId, store: store.store_name, before: readSettings(before), after: { store_type: type, frp_limit: frp, jacket_limit: jacket } });
            res.json({ success: true });
        } catch (error) {
            console.error('[POSM history] settings:', error);
            res.status(500).json({ success: false, error: 'Could not save' });
        }
    }

    /** Lines with no store, grouped by the code or name the sheet gave. */
    static async unlinked(req: AuthRequest, res: Response) {
        try {
            const [rows]: any = await db.query(`SELECT ${LINE_COLS} FROM posm_dispatch_history WHERE store_id IS NULL AND deleted_at IS NULL ORDER BY sheet_store_name, item`);
            const groups = new Map<string, any>();
            for (const r of rows.map(readLine)) {
                const key = r.store_code ? `code:${r.store_code}` : `name:${r.sheet_store_name ?? ''}`;
                const g = groups.get(key) ?? { key, store_code: r.store_code, sheet_store_name: r.sheet_store_name, sources: new Set<string>(), distributor: r.distributor, city: r.city, state: r.state, sent_to_asm: false, lines: [] as any[] };
                g.sources.add(r.source); g.lines.push(r);
                if (r.flags.includes('sent_to_asm')) g.sent_to_asm = true;
                groups.set(key, g);
            }
            res.json({ success: true, groups: [...groups.values()].map(g => ({ ...g, sources: [...g.sources] })) });
        } catch (error) {
            console.error('[POSM history] unlinked:', error);
            res.status(500).json({ success: false, error: 'Could not load the lines' });
        }
    }

    /** Links lines to a store: a whole group (same code or same sheet name) or chosen lines. */
    static async link(req: AuthRequest, res: Response) {
        try {
            const storeId = String(req.body?.store_id ?? '');
            const [[store]]: any = await db.execute('SELECT id, store_code, store_name FROM vendor_details WHERE id = ?', [storeId]);
            if (!store) return res.status(400).json({ success: false, error: 'Pick the store' });
            const ids: string[] = Array.isArray(req.body?.line_ids) ? req.body.line_ids.map(String).slice(0, 2000) : [];
            const key = String(req.body?.group_key ?? '');
            let result: any;
            if (ids.length) {
                [result] = await db.query('UPDATE posm_dispatch_history SET store_id = ?, updated_by = ? WHERE id IN (?) AND store_id IS NULL AND deleted_at IS NULL', [storeId, req.user?.id ?? null, ids]);
            } else if (key.startsWith('code:')) {
                [result] = await db.execute('UPDATE posm_dispatch_history SET store_id = ?, updated_by = ? WHERE store_code = ? AND store_id IS NULL AND deleted_at IS NULL', [storeId, req.user?.id ?? null, key.slice(5)]);
            } else if (key.startsWith('name:')) {
                [result] = await db.execute('UPDATE posm_dispatch_history SET store_id = ?, updated_by = ? WHERE store_code IS NULL AND COALESCE(sheet_store_name, \'\') = ? AND store_id IS NULL AND deleted_at IS NULL', [storeId, req.user?.id ?? null, key.slice(5)]);
            } else return res.status(400).json({ success: false, error: 'Nothing to link' });
            log(req, 'POSM_HISTORY_LINKED', { store_id: storeId, store: store.store_name, group_key: key || null, lines: result?.affectedRows ?? 0 });
            res.json({ success: true, linked: result?.affectedRows ?? 0 });
        } catch (error) {
            console.error('[POSM history] link:', error);
            res.status(500).json({ success: false, error: 'Could not link the lines' });
        }
    }

    /** Corrects a line's quantity or status, or clears a flag once checked. */
    static async updateLine(req: AuthRequest, res: Response) {
        try {
            const [[line]]: any = await db.execute(`SELECT ${LINE_COLS} FROM posm_dispatch_history WHERE id = ? AND deleted_at IS NULL`, [req.params.id]);
            if (!line) return res.status(404).json({ success: false, error: 'Line not found' });
            const was = readLine(line);
            const qty = req.body?.qty === undefined ? was.qty : Math.floor(Number(req.body.qty));
            if (!Number.isFinite(qty) || qty < 1 || qty > 100000) return res.status(400).json({ success: false, error: 'Enter a quantity of 1 or more' });
            const status = req.body?.status === undefined ? was.status : readStatus(req.body.status);
            if (req.body?.status !== undefined && !POSM_STATUSES.includes(req.body.status)) return res.status(400).json({ success: false, error: 'Pick a status' });
            const clear: string[] = Array.isArray(req.body?.clear_flags) ? req.body.clear_flags.map(String) : [];
            let flags = was.flags.filter(f => !clear.includes(f));
            if (req.body?.qty !== undefined) flags = flags.filter(f => f !== 'qty_not_written');
            await db.execute(
                `UPDATE posm_dispatch_history SET qty = ?, status = ?, flags = ?, updated_by = ?${status !== was.status ? ', status_changed_on = CURDATE()' : ''} WHERE id = ?`,
                [qty, status, JSON.stringify(flags), req.user?.id ?? null, was.id]);
            log(req, 'POSM_HISTORY_LINE_EDITED', { line_id: was.id, store_id: was.store_id, item: was.item, before: { qty: was.qty, status: was.status, flags: was.flags }, after: { qty, status, flags } });
            res.json({ success: true });
        } catch (error) {
            console.error('[POSM history] update line:', error);
            res.status(500).json({ success: false, error: 'Could not save the line' });
        }
    }

    /** Removes a line (e.g. a duplicate). Kept in the table, out of every total; can be brought back. */
    static async removeLine(req: AuthRequest, res: Response) {
        try {
            const restore = req.query.restore === '1';
            const [result]: any = await db.execute(
                `UPDATE posm_dispatch_history SET deleted_at = ${restore ? 'NULL' : 'NOW()'}, updated_by = ? WHERE id = ? AND deleted_at IS ${restore ? 'NOT NULL' : 'NULL'}`,
                [req.user?.id ?? null, req.params.id]);
            if (!result.affectedRows) return res.status(404).json({ success: false, error: 'Line not found' });
            log(req, restore ? 'POSM_HISTORY_LINE_RESTORED' : 'POSM_HISTORY_LINE_REMOVED', { line_id: req.params.id });
            res.json({ success: true });
        } catch (error) {
            console.error('[POSM history] remove line:', error);
            res.status(500).json({ success: false, error: 'Could not remove the line' });
        }
    }

    /* ---------- The plant: FRP and Sample Jackets from the depots ---------- */

    /** The plant's lines, oldest open first, with who last changed each and whether it needs a reason. */
    static async plantLines(req: AuthRequest, res: Response) {
        try {
            const [rows]: any = await db.query(
                `SELECT h.${LINE_COLS.split(',').map(c => c.trim()).join(', h.')}, vd.store_name AS portal_store_name, p.name AS updated_by_name
                   FROM posm_dispatch_history h
                   LEFT JOIN vendor_details vd ON vd.id = h.store_id
                   LEFT JOIN profiles p ON p.id = h.updated_by
                  WHERE h.deleted_at IS NULL AND h.source LIKE 'Plant%'
                  ORDER BY COALESCE(h.request_date, h.dispatch_date) DESC, h.sheet_row`);
            const today = istToday();
            res.json({
                success: true, today,
                lines: rows.map((r: any) => {
                    const l = readLine(r);
                    return { ...l, address: r.address ?? null, portal_store_name: r.portal_store_name ? String(r.portal_store_name).trim() : null, updated_by_name: r.updated_by_name ?? null, needs_reason: needsReason(l, today) };
                }),
            });
        } catch (error) {
            console.error('[POSM plant] lines:', error);
            res.status(500).json({ success: false, error: 'Could not load the plant lines' });
        }
    }

    /** The plant updates production and dispatch on a line: status, dates, docket, courier, reason, remarks. */
    static async plantUpdate(req: AuthRequest, res: Response) {
        try {
            const [[row]]: any = await db.execute(`SELECT ${LINE_COLS} FROM posm_dispatch_history WHERE id = ? AND deleted_at IS NULL AND source LIKE 'Plant%'`, [req.params.id]);
            if (!row) return res.status(404).json({ success: false, error: 'Line not found' });
            const was = readLine(row);
            const r = checkPlantEdit(was, req.body ?? {}, istToday());
            if (!r.ok) return res.status(400).json({ success: false, error: r.error });
            const fields = Object.keys(r.set) as (keyof typeof r.set)[];
            if (!fields.length) return res.json({ success: true });
            await db.execute(
                `UPDATE posm_dispatch_history SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_by = ?${r.statusChanged ? ', status_changed_on = ?' : ''} WHERE id = ?`,
                [...fields.map(f => r.set[f] ?? null), req.user?.id ?? null, ...(r.statusChanged ? [istToday()] : []), was.id]);
            log(req, 'POSM_PLANT_LINE_UPDATED', { line_id: was.id, store_id: was.store_id, item: was.item, before: Object.fromEntries(fields.map(f => [f, (was as any)[f]])), after: r.set });
            res.json({ success: true });
        } catch (error) {
            console.error('[POSM plant] update:', error);
            res.status(500).json({ success: false, error: 'Could not save the line' });
        }
    }

    /**
     * The Noida office places an FRP / Sample Jacket order with a depot: one
     * line per design. Past a store's limit it needs an approval note.
     */
    static async plantOrder(req: AuthRequest, res: Response) {
        try {
            const depot = String(req.body?.depot ?? '') as Depot;
            if (!DEPOTS[depot]) return res.status(400).json({ success: false, error: 'Pick the depot' });
            const store = await storeInfo(String(req.body?.store_id ?? ''));
            if (!store) return res.status(400).json({ success: false, error: 'Pick the store' });
            const items = (Array.isArray(req.body?.lines) ? req.body.lines : []).slice(0, 50).map((l: any) => ({
                item: l?.item === 'Sample Jacket' ? 'Sample Jacket' : 'FRP',
                design: txt(l?.design, 100), major_colour: txt(l?.major_colour, 50), minor_colour: txt(l?.minor_colour, 50),
                qty: Math.floor(Number(l?.qty)),
            }));
            if (!items.length) return res.status(400).json({ success: false, error: 'Add at least one line' });
            if (items.some((i: any) => !Number.isFinite(i.qty) || i.qty < 1 || i.qty > 1000)) return res.status(400).json({ success: false, error: 'Each line needs a quantity of 1 or more' });
            if (items.some((i: any) => i.item === 'FRP' && !i.design)) return res.status(400).json({ success: false, error: 'Each FRP line needs its design' });
            const [existing]: any = await db.execute(`SELECT item, qty, status FROM posm_dispatch_history WHERE store_id = ? AND deleted_at IS NULL`, [store.id]);
            const settings = (await settingsFor([store.id])).get(store.id) ?? DEFAULT_SETTINGS;
            const approvalNeeded = orderNeedsApproval(existing.map((e: any) => ({ ...e, qty: Number(e.qty) })), settings, items);
            const approval = txt(req.body?.approval_note, 300);
            if (approvalNeeded && !approval) return res.status(409).json({ success: false, needs_approval: true, error: `${approvalNeeded} Write who approved it.` });
            const brand = txt(req.body?.brand, 30) ?? (store.brand === 'AC' ? 'AUTOCRUZE' : 'AUTOFORM');
            const remarks = [approval ? `Approved: ${approval}` : null, txt(req.body?.remarks, 800)].filter(Boolean).join(' · ') || null;
            const requestDate = isDayStr(req.body?.request_date) ? String(req.body.request_date) : istToday();
            for (const i of items) {
                await db.execute(
                    `INSERT INTO posm_dispatch_history (id, source, store_id, store_code, sheet_store_name, city, state, distributor, asm, item, design, major_colour, minor_colour, brand, store_kind, qty, status, request_date, address, remarks, flags, updated_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Not updated', ?, ?, ?, '[]', ?)`,
                    [uuidv4(), DEPOTS[depot], store.id, store.store_code, store.store_name, store.city, store.state, store.distributor, store.asm, i.item, i.design, i.major_colour, i.minor_colour,
                        brand, settings.store_type === 'new' ? 'New' : 'Old', i.qty, requestDate, txt(req.body?.address, 1000), remarks, req.user?.id ?? null]);
            }
            log(req, 'POSM_PLANT_ORDER', { store_id: store.id, store: store.store_name, depot, lines: items, approval });
            res.json({ success: true, added: items.length });
        } catch (error) {
            console.error('[POSM plant] order:', error);
            res.status(500).json({ success: false, error: 'Could not place the order' });
        }
    }

    /* ---------- The Noida office: one dispatch, many items ---------- */

    /** The Noida office's dispatches, one row each like its sheet, with a quantity per item. */
    static async noidaDispatches(req: AuthRequest, res: Response) {
        try {
            const [rows]: any = await db.query(
                `SELECT h.${LINE_COLS.split(',').map(c => c.trim()).join(', h.')}, vd.store_name AS portal_store_name
                   FROM posm_dispatch_history h LEFT JOIN vendor_details vd ON vd.id = h.store_id
                  WHERE h.deleted_at IS NULL AND h.source = ? ORDER BY h.dispatch_date DESC, h.sheet_row`, [NOIDA_SOURCE]);
            const groups = new Map<string, any>();
            for (const r of rows) {
                const l = readLine(r);
                const key = noidaGroupKey(l);
                const g = groups.get(key) ?? {
                    key, line_ids: [] as string[], store_id: l.store_id, store_code: l.store_code, store_name: r.portal_store_name ? String(r.portal_store_name).trim() : l.sheet_store_name,
                    distributor: l.distributor, asm: l.asm, state: l.state, dispatch_date: l.dispatch_date, dispatched_by: l.dispatched_by, courier: l.courier, docket_no: l.docket_no,
                    delivery_date: l.delivery_date, status: l.status, remarks: l.remarks, items: {} as Record<string, number>, flags: [] as string[],
                };
                g.line_ids.push(l.id);
                g.items[l.item] = (g.items[l.item] ?? 0) + l.qty;
                if (!g.remarks && l.remarks) g.remarks = l.remarks;
                for (const f of l.flags) if (!g.flags.includes(f)) g.flags.push(f);
                groups.set(key, g);
            }
            res.json({ success: true, dispatches: [...groups.values()] });
        } catch (error) {
            console.error('[POSM noida] list:', error);
            res.status(500).json({ success: false, error: 'Could not load the dispatches' });
        }
    }

    /**
     * Saves a Noida office dispatch: new (no line_ids) or an existing one. The
     * shared details go on every line; each item's quantity updates its line,
     * adds one, or removes it at 0.
     */
    static async noidaSave(req: AuthRequest, res: Response) {
        try {
            const b = req.body ?? {};
            const ids: string[] = Array.isArray(b.line_ids) ? b.line_ids.map(String).slice(0, 100) : [];
            const status = String(b.status ?? 'Dispatched');
            if (!(POSM_STATUSES as readonly string[]).includes(status)) return res.status(400).json({ success: false, error: 'Pick a status' });
            for (const f of ['dispatch_date', 'delivery_date']) if (b[f] && !isDayStr(b[f])) return res.status(400).json({ success: false, error: 'Enter the date as a date' });
            if (b.dispatch_date && b.dispatch_date > istToday()) return res.status(400).json({ success: false, error: 'The dispatch date cannot be in the future' });
            const items: Record<string, number> = {};
            for (const [k, v] of Object.entries(b.items ?? {})) {
                const n = Math.floor(Number(v));
                if (!(POSM_ITEMS as readonly string[]).includes(k)) continue;
                if (!Number.isFinite(n) || n < 0 || n > 100000) return res.status(400).json({ success: false, error: `Enter a quantity for ${k}` });
                if (n > 0) items[k] = n;
            }
            if (!Object.keys(items).length) return res.status(400).json({ success: false, error: 'Enter at least one item' });
            const shared = {
                dispatch_date: b.dispatch_date || null, delivery_date: b.delivery_date || null, status,
                dispatched_by: txt(b.dispatched_by, 80), courier: txt(b.courier, 80), docket_no: txt(b.docket_no, 80), remarks: txt(b.remarks, 1000),
            };
            let existing: any[] = [];
            if (ids.length) {
                const [found]: any = await db.query(`SELECT ${LINE_COLS} FROM posm_dispatch_history WHERE id IN (?) AND deleted_at IS NULL AND source = ?`, [ids, NOIDA_SOURCE]);
                existing = found;
                if (!existing.length) return res.status(404).json({ success: false, error: 'Dispatch not found' });
            }
            const was = existing.map(readLine);
            const store = was[0]?.store_id ? await storeInfo(was[0].store_id) : await storeInfo(String(b.store_id ?? ''));
            if (!was.length && !store) return res.status(400).json({ success: false, error: 'Pick the store' });
            const first = was[0];
            const conn = await db.getConnection();
            try {
                await conn.beginTransaction();
                const byItem = new Map<string, any[]>();
                for (const l of was) byItem.set(l.item, [...(byItem.get(l.item) ?? []), l]);
                /* Each item keeps one line with the new quantity; any other line of it (or all, at 0) is removed. */
                for (const [item, ls] of byItem) {
                    const keep = items[item] ? ls[0] : null;
                    if (keep) {
                        await conn.execute(`UPDATE posm_dispatch_history SET qty = ?, status = ?, dispatch_date = ?, delivery_date = ?, dispatched_by = ?, courier = ?, docket_no = ?, remarks = ?, updated_by = ?${keep.status !== status ? ', status_changed_on = CURDATE()' : ''} WHERE id = ?`,
                            [items[item], shared.status, shared.dispatch_date, shared.delivery_date, shared.dispatched_by, shared.courier, shared.docket_no, shared.remarks, req.user?.id ?? null, keep.id]);
                    }
                    for (const x of ls) {
                        if (x === keep) continue;
                        await conn.execute('UPDATE posm_dispatch_history SET deleted_at = NOW(), updated_by = ? WHERE id = ?', [req.user?.id ?? null, x.id]);
                    }
                }
                for (const [item, qty] of Object.entries(items)) {
                    if (byItem.has(item)) continue;
                    await conn.execute(
                        `INSERT INTO posm_dispatch_history (id, source, store_id, store_code, sheet_store_name, city, state, distributor, asm, item, qty, status, dispatch_date, delivery_date, dispatched_by, courier, docket_no, remarks, flags, updated_by)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
                        [uuidv4(), NOIDA_SOURCE, store?.id ?? first?.store_id ?? null, store?.store_code ?? first?.store_code ?? null, store?.store_name ?? first?.sheet_store_name ?? null,
                            store?.city ?? first?.city ?? null, store?.state ?? first?.state ?? null, store?.distributor ?? first?.distributor ?? null, store?.asm ?? first?.asm ?? null,
                            item, qty, shared.status, shared.dispatch_date, shared.delivery_date, shared.dispatched_by, shared.courier, shared.docket_no, shared.remarks, req.user?.id ?? null]);
                }
                await conn.commit();
            } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
            log(req, ids.length ? 'POSM_NOIDA_DISPATCH_EDITED' : 'POSM_NOIDA_DISPATCH_ADDED', { store_id: store?.id ?? first?.store_id ?? null, line_ids: ids, items, ...shared });
            res.json({ success: true });
        } catch (error) {
            console.error('[POSM noida] save:', error);
            res.status(500).json({ success: false, error: 'Could not save the dispatch' });
        }
    }

    /** A store's own view: what it has received and what is on the way. */
    static async mine(req: AuthRequest, res: Response) {
        try {
            const vendor = req.user?.id ? await vendorRepository.findByUserId(req.user.id) : null;
            if (!vendor) return res.status(404).json({ success: false, error: 'Store not found' });
            const storeId = String(vendor.id);
            const [rows]: any = await db.execute(
                `SELECT ${LINE_COLS} FROM posm_dispatch_history WHERE store_id = ? AND deleted_at IS NULL ORDER BY COALESCE(dispatch_date, request_date) DESC, item`, [storeId]);
            /* The store sees what was sent and when, not head office's notes. */
            const lines = rows.map(readLine).map(({ id, item, design, major_colour, minor_colour, qty, status, request_date, dispatch_date, delivery_date, courier, docket_no }: any) =>
                ({ id, item, design, major_colour, minor_colour, qty, status, request_date, dispatch_date, delivery_date, courier, docket_no }));
            const settings = (await settingsFor([storeId])).get(storeId) ?? DEFAULT_SETTINGS;
            const summary = summarise(lines, settings);
            res.json({ success: true, summary, store_type: settings.store_type, lines });
        } catch (error) {
            console.error('[POSM history] mine:', error);
            res.status(500).json({ success: false, error: 'Could not load what you have received' });
        }
    }
}
