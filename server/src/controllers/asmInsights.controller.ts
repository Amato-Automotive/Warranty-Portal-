import { Request, Response } from 'express';
import db from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { storesOfAsm } from '../services/asmStores.js';
import { SchemeController } from './scheme.controller.js';
import { SELL_MORE_ID, setsTotal, type Sets } from '../services/sellMoreEarnMore.js';
import { DEFAULT_SETTINGS, type StoreSettings } from '../services/posmHistory.js';
import { asmAlerts, posmByStore, type PLine } from '../services/asmInsights.js';
import { inAudience, monthOf, readFeedback, type FeedbackAnswer } from '../services/feedbackForm.js';
import { PERIOD_IDS, customPeriod, last12, periodOf, storeStat, totals, type PeriodId, type StoreCount } from '../services/asmWarrantyStats.js';

/**
 * The ASM's view of their stores' schemes, POSM and alerts. Read-only, and
 * only ever the ASM's own stores: every list is filtered to them.
 */

const json = <T>(v: unknown, d: T): T => { if (v == null) return d; if (typeof v !== 'string') return v as T; try { return JSON.parse(v) as T; } catch { return d; } };
/* A DATE / DATETIME comes back as a JS date in India time; the server runs on UTC, so read the day in India time. */
const day = (v: unknown) => (v instanceof Date ? new Date(v.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function asmIdFor(req: AuthRequest): Promise<string | null> {
    const [rows]: any = await db.execute('SELECT id FROM asms WHERE profile_id = ?', [req.user!.id]);
    return rows[0]?.id ?? null;
}

/** Runs one of head office's scheme reports and returns its JSON, so the ASM sees exactly the same numbers. */
function report(handler: (req: Request, res: Response) => Promise<unknown>, id: string): Promise<any> {
    return new Promise((resolve, reject) => {
        let code = 200;
        const res: any = { status(c: number) { code = c; return res; }, json(body: any) { (code >= 400 ? reject(new Error(body?.error ?? 'Report failed')) : resolve(body)); return res; } };
        handler({ params: { id }, query: {}, body: {} } as any, res).catch(reject);
    });
}

async function schemesFor(storeIds: Set<string>) {
    const [[s]]: any = await db.execute('SELECT title, status, settings, starts_on, ends_on FROM schemes WHERE id = ? AND deleted_at IS NULL', [SELL_MORE_ID]);
    if (!s || s.status === 'draft') return null;
    const live = s.status === 'published' && Boolean(json<any>(s.settings, {}).live);
    const [sell, buy] = await Promise.all([report(SchemeController.adminSellMore, SELL_MORE_ID), report(SchemeController.adminBuyMore, SELL_MORE_ID)]);
    const months: { key: string; label: string }[] = sell.months ?? [];
    const now = months[months.length - 1]?.key ?? null;
    const sellMore = (sell.stores ?? []).filter((x: any) => storeIds.has(x.store_id)).map((x: any) => {
        const m = now ? x.months?.[now] : null;
        return {
            store_id: x.store_id, store_name: x.store_name, city: x.city,
            month: now, target: m?.target ?? null, points: m?.calculated ?? 0, warranties: m?.warranties ?? 0,
            due_sets: m?.due_sets ?? 0, reward: m?.reward ?? null, reward_sets: m?.reward_sets ?? null,
            history: months.map(mm => ({ key: mm.key, label: mm.label, target: x.months?.[mm.key]?.target ?? null, points: x.months?.[mm.key]?.calculated ?? 0, reward: x.months?.[mm.key]?.reward ?? null })),
        };
    });
    const buyMore = (buy.stores ?? []).filter((x: any) => storeIds.has(x.store_id)).map((x: any) => ({
        store_id: x.store_id, store_name: x.store_name, city: x.city, distributors: x.distributors ?? [],
        approved_sets: setsTotal(x.approved as Sets), available_sets: x.eligibility?.total ?? 0,
        offer1: x.eligibility?.offer1 ?? null, offer2_ready: Boolean(x.eligibility?.offer2_ready),
        ready: Boolean(x.eligibility?.offer1?.ready || x.eligibility?.offer2_ready),
        free_sets: x.rewards ?? 0, waiting_sets: x.waiting_sets ?? 0, requests: x.requests ?? 0,
    }));
    const invoices = (buy.invoices ?? []).filter((i: any) => storeIds.has(i.store_id)).map((i: any) => ({
        id: i.id, store_id: i.store_id, store_name: i.store_name, invoice_no: i.invoice_no, invoice_date: i.invoice_date,
        sets: setsTotal(i.sets as Sets), status: i.status, review_note: i.review_note ?? null, added: day(i.created_at),
        added_by: i.added_by ? `Distributor: ${i.added_by}` : i.added_by_admin ? 'Head office' : 'Store',
    }));
    return { program: { title: s.title, live, starts_on: day(s.starts_on), ends_on: day(s.ends_on) }, month: months.find(m => m.key === now) ?? null, sell_more: sellMore, buy_more: buyMore, invoices };
}

async function posmFor(ids: string[], today: string) {
    if (!ids.length) return { rows: [], lines: [] as PLine[] };
    const [rows]: any = await db.query(
        `SELECT id, store_id, source, item, qty, status, request_date, dispatch_date, expected_dispatch, reason
           FROM posm_dispatch_history WHERE store_id IN (?) AND deleted_at IS NULL`, [ids]);
    const lines: PLine[] = rows.map((r: any) => ({
        id: String(r.id), store_id: String(r.store_id), source: r.source, item: r.item, qty: Number(r.qty) || 0, status: r.status,
        request_date: day(r.request_date), dispatch_date: day(r.dispatch_date), expected_dispatch: day(r.expected_dispatch), reason: r.reason ?? null,
    }));
    const [set]: any = await db.query('SELECT * FROM posm_store_settings WHERE store_id IN (?)', [ids]);
    const settings = new Map<string, StoreSettings>(set.map((s: any) => [String(s.store_id), {
        ...DEFAULT_SETTINGS, store_type: s.store_type === 'new' ? 'new' : 'old', type_assumed: Boolean(s.type_assumed), frp_limit: Number(s.frp_limit), jacket_limit: Number(s.jacket_limit),
    }]));
    const [w]: any = await db.query(
        `SELECT vendor_details_id AS id, COUNT(*) AS n FROM warranty_registrations
          WHERE vendor_details_id IN (?) AND created_at >= NOW() - INTERVAL 182 DAY AND status <> 'rejected' GROUP BY vendor_details_id`, [ids]);
    const w6 = new Map<string, number>(w.map((r: any) => [String(r.id), Number(r.n)]));
    return { rows: posmByStore(ids, lines, settings, w6, today), lines };
}

const fail = (res: Response, what: string, error: unknown) => { console.error(`[ASM insights] ${what}:`, error); res.status(500).json({ error: `Could not load ${what}` }); };

export class AsmInsightsController {
    /** GET /api/asm-portal/schemes — Sell More / Buy More for the ASM's stores. */
    static async schemes(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const stores = await storesOfAsm(asmId);
            const data = await schemesFor(new Set(stores.map((s: any) => String(s.vendor_details_id))));
            res.json({ success: true, ...(data ?? { program: null, month: null, sell_more: [], buy_more: [], invoices: [] }) });
        } catch (error) { fail(res, 'the schemes', error); }
    }

    /** GET /api/asm-portal/posm-sent — what each of the ASM's stores has been sent, and its limits. */
    static async posm(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const stores = await storesOfAsm(asmId);
            const names = new Map(stores.map((s: any) => [String(s.vendor_details_id), s]));
            const { rows } = await posmFor([...names.keys()], istToday());
            res.json({ success: true, stores: rows.map(r => ({ ...r, store_name: String(names.get(r.store_id)?.store_name ?? '').trim(), city: names.get(r.store_id)?.city ?? null })) });
        } catch (error) { fail(res, 'the POSM', error); }
    }

    /** GET /api/asm-portal/stores/:id/posm-sent — one store's POSM lines, newest first. */
    static async storePosm(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const [[mine]]: any = await db.execute('SELECT id FROM vendor_details WHERE id = ? AND asm_id = ?', [String(req.params.id), asmId]);
            if (!mine) return res.status(404).json({ error: 'Store not found' });
            const { rows, lines } = await posmFor([String(mine.id)], istToday());
            const key = (l: PLine) => l.dispatch_date ?? l.request_date ?? '';
            res.json({
                success: true, summary: rows[0] ?? null,
                lines: lines.sort((a, b) => key(b).localeCompare(key(a))).map(l => ({ ...l, from: l.source.replace('Plant - ', '').replace(' depot', ' depot') })),
            });
        } catch (error) { fail(res, 'the POSM', error); }
    }

    /** GET /api/asm-portal/audits — the store audits of the ASM's stores (latest first), and every store with its last audit. */
    static async audits(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const stores = await storesOfAsm(asmId);
            const ids = stores.map((s: any) => String(s.vendor_details_id));
            const [rows]: any = ids.length ? await db.query(
                `SELECT id, vendor_details_id, channel, audited_by_name, audit_date, audit_month, contact_person,
                        signage_status, online_presence, online_presence_other, footfall, seat_covers_stock, products_stocked,
                        last_month_business, staff_training, warranty_registration, support_needed, support_details, review_status, submitted_at
                   FROM store_audits WHERE vendor_details_id IN (?) ORDER BY COALESCE(audit_date, submitted_at) DESC`, [ids]) : [[]];
            const audits = rows.map((r: any) => ({ ...r, id: String(r.id), store_id: String(r.vendor_details_id), audit_date: day(r.audit_date) ?? day(r.submitted_at) }));
            const last = new Map<string, string>();
            for (const a of audits) if (!last.has(a.store_id)) last.set(a.store_id, a.audit_date);
            res.json({
                success: true, audits,
                stores: stores.map((s: any) => ({ store_id: String(s.vendor_details_id), store_name: String(s.store_name ?? '').trim(), city: s.city ?? null, live: Boolean(s.is_verified && s.is_active), last_audit: last.get(String(s.vendor_details_id)) ?? null })),
            });
        } catch (error) { fail(res, 'the audits', error); }
    }

    /** GET /api/asm-portal/orders — orders the ASM's stores placed with their distributors, newest first. */
    static async orders(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            /* store_orders.vendor_id is the store's login id. */
            const [rows]: any = await db.execute(
                `SELECT o.id, o.status, o.total_amount, o.created_at, o.updated_at, o.docket_id, o.decline_reason,
                        vd.id AS store_id, TRIM(vd.store_name) AS store_name, vd.city, d.name AS distributor,
                        (SELECT COUNT(*) FROM store_order_items i WHERE i.order_id = o.id) AS items,
                        (SELECT COALESCE(SUM(i.quantity), 0) FROM store_order_items i WHERE i.order_id = o.id) AS qty
                   FROM store_orders o JOIN vendor_details vd ON vd.user_id = o.vendor_id LEFT JOIN distributors d ON d.id = o.distributor_id
                  WHERE vd.asm_id = ? ORDER BY o.created_at DESC LIMIT 500`, [asmId]);
            res.json({ success: true, orders: rows.map((r: any) => ({ ...r, store_id: String(r.store_id), total_amount: Number(r.total_amount) || 0, items: Number(r.items), qty: Number(r.qty), created: day(r.created_at) })) });
        } catch (error) { fail(res, 'the orders', error); }
    }

    /** GET /api/asm-portal/feedback?month=YYYY-MM — the monthly review & feedback of the ASM's stores, and who has not filled it. */
    static async feedback(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month ?? '')) ? String(req.query.month) : monthOf();
            const [[f]]: any = await db.execute('SELECT settings FROM feedback_settings WHERE id = 1');
            const form = readFeedback(json(f?.settings, {}));
            const [rows]: any = await db.execute(
                `SELECT r.id, r.store_id, r.month, r.answers, r.submitted_at, TRIM(vd.store_name) AS store_name, vd.city
                   FROM feedback_responses r JOIN vendor_details vd ON vd.id = r.store_id
                  WHERE vd.asm_id = ? AND r.month = ? ORDER BY r.submitted_at DESC`, [asmId, month]);
            const responses = rows.map((r: any) => ({ id: String(r.id), store_id: String(r.store_id), store_name: r.store_name, city: r.city ?? null, submitted: day(r.submitted_at), answers: json<FeedbackAnswer[]>(r.answers, []) }));
            const answered = new Set(responses.map((r: any) => r.store_id));
            /* Waiting: the ASM's live franchise stores the form is for, with no answer this month. */
            const [stores]: any = await db.execute(
                `SELECT vd.id, TRIM(vd.store_name) AS store_name, vd.city, vd.state, vd.allowed_brands FROM vendor_details vd
                   JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1 AND vv.is_active = 1
                  WHERE vd.asm_id = ? AND vd.is_franchise = 1 ORDER BY vd.store_name`, [asmId]);
            const pending = stores.filter((s: any) => !answered.has(String(s.id)) && inAudience(form.audience, { id: String(s.id), state: s.state, allowed_brands: s.allowed_brands }))
                .map((s: any) => ({ store_id: String(s.id), store_name: s.store_name, city: s.city ?? null }));
            const [ms]: any = await db.execute('SELECT DISTINCT r.month FROM feedback_responses r JOIN vendor_details vd ON vd.id = r.store_id WHERE vd.asm_id = ? ORDER BY r.month DESC LIMIT 12', [asmId]);
            res.json({ success: true, month, enabled: form.enabled, months: [...new Set([monthOf(), ...ms.map((m: any) => m.month)])].sort().reverse(), responses, pending });
        } catch (error) { fail(res, 'the feedback', error); }
    }

    /**
     * GET /api/asm-portal/warranties — the warranties the ASM's stores registered.
     * Filters: status (pending | validated | rejected), store, from / to (India dates), q (UID, customer, car number); 50 a page.
     * The customer's number is masked: the ASM follows up with the store, not the customer.
     */
    static async warranties(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const q = req.query as Record<string, string | undefined>;
            const isDay = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
            const where = ['vd.asm_id = ?']; const params: unknown[] = [asmId];
            if (q.store) { where.push('vd.id = ?'); params.push(String(q.store)); }
            /* A named period (as on the by-store view) sets the dates, so both views count the same warranties. */
            if (PERIOD_IDS.includes(q.period as PeriodId)) { const p = periodOf(q.period as PeriodId, istToday()); q.from = p.from; q.to = p.to; }
            if (isDay(q.from)) { where.push('wr.created_at >= ?'); params.push(`${q.from} 00:00:00`); }
            if (isDay(q.to)) { where.push('wr.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${q.to} 00:00:00`); }
            const text = String(q.q ?? '').trim().slice(0, 60);
            if (text) { where.push("(wr.uid LIKE ? OR wr.customer_name LIKE ? OR REPLACE(wr.registration_number, ' ', '') LIKE ?)"); params.push(`%${text}%`, `%${text}%`, `%${text.replace(/\s+/g, '')}%`); }
            const FROM = `FROM warranty_registrations wr JOIN vendor_details vd ON vd.id = wr.vendor_details_id WHERE ${where.join(' AND ')}`;
            /* The counts ignore the status filter, so the tabs show what each holds. */
            const [counts]: any = await db.query(`SELECT wr.status, COUNT(*) AS n ${FROM} GROUP BY wr.status`, params);
            const [reasons]: any = await db.query(`SELECT wr.rejection_reason AS reason, COUNT(*) AS n ${FROM} AND wr.status = 'rejected' GROUP BY wr.rejection_reason ORDER BY n DESC LIMIT 5`, params);
            const status = ['pending', 'validated', 'rejected'].includes(String(q.status)) ? String(q.status) : null;
            const sWhere = status === 'pending' ? " AND wr.status IN ('pending', 'pending_vendor')" : status ? ' AND wr.status = ?' : '';
            const sParams = status && status !== 'pending' ? [status] : [];
            const page = Math.max(1, Math.min(1000, Number(q.page) || 1));
            const [rows]: any = await db.query(
                `SELECT wr.uid, wr.status, wr.rejection_reason, wr.created_at, wr.validated_at, wr.rejected_at, wr.purchase_date, wr.warranty_type, wr.product_type,
                        wr.customer_name, wr.customer_phone, wr.car_make, wr.car_model, wr.car_year, wr.registration_number,
                        JSON_UNQUOTE(JSON_EXTRACT(wr.product_details, '$.productName')) AS product_name,
                        JSON_UNQUOTE(JSON_EXTRACT(wr.product_details, '$.manpowerName')) AS fitted_by,
                        vd.id AS store_id, TRIM(vd.store_name) AS store_name, vd.city
                 ${FROM}${sWhere} ORDER BY wr.created_at DESC LIMIT 50 OFFSET ${(page - 1) * 50}`, [...params, ...sParams]);
            const n = (k: string) => counts.filter((c: any) => (k === 'pending' ? ['pending', 'pending_vendor'] : [k]).includes(c.status)).reduce((t: number, c: any) => t + Number(c.n), 0);
            const tally = { all: counts.reduce((t: number, c: any) => t + Number(c.n), 0), pending: n('pending'), validated: n('validated'), rejected: n('rejected') };
            const mask = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, '').slice(-10); return d.length >= 6 ? `${d.slice(0, 2)}xxxxx${d.slice(-3)}` : ''; };
            res.json({
                success: true, page, pages: Math.max(1, Math.ceil((status ? tally[status as 'pending'] : tally.all) / 50)), counts: tally,
                reasons: reasons.map((r: any) => ({ reason: r.reason || 'No reason written', n: Number(r.n) })),
                warranties: rows.map((r: any) => ({
                    uid: r.uid, status: r.status === 'pending_vendor' ? 'pending' : r.status, rejection_reason: r.rejection_reason ?? null,
                    registered: day(r.created_at), decided: day(r.validated_at ?? r.rejected_at), purchase_date: day(r.purchase_date), warranty_type: r.warranty_type ?? null,
                    product: r.product_name || r.product_type, customer: r.customer_name ?? null, phone: mask(r.customer_phone),
                    /* The year alone says nothing; newer registrations carry no make or model. */
                    car: r.car_make || r.car_model ? [r.car_make, r.car_model, r.car_year].filter(Boolean).join(' ') : null, registration_number: r.registration_number ?? null, fitted_by: r.fitted_by ?? null,
                    store_id: String(r.store_id), store_name: r.store_name, city: r.city ?? null,
                })),
            });
        } catch (error) { fail(res, 'the warranties', error); }
    }

    /**
     * GET /api/asm-portal/warranty-stats?period=mtd|last_month|last_90|custom (&from&to) — warranties by store:
     * this period against the one before, approval rate, rejections, segment; the ASM's
     * 12-month trend; and the rejection reasons with how many stores each hits.
     */
    static async warrantyStats(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const id = PERIOD_IDS.includes(req.query.period as PeriodId) ? (req.query.period as PeriodId) : 'mtd';
            const today = istToday();
            let p = periodOf(id, today);
            if (req.query.period === 'custom') {
                const c = customPeriod(String(req.query.from ?? ''), String(req.query.to ?? ''), today);
                if (!c) return res.status(400).json({ error: 'Pick a start and end date, up to a year apart and not after today' });
                p = c;
            }
            const stores = await storesOfAsm(asmId);
            const ids = stores.map((s: any) => String(s.vendor_details_id));
            const empty = { success: true, period: p, totals: totals([]), stores: [], trend: [], reasons: [] };
            if (!ids.length) return res.json(empty);

            /* created_at is India time (the pool runs at +05:30), so plain dates compare as India dates. */
            const [rows]: any = await db.query(
                `SELECT vendor_details_id AS store_id, created_at >= ? AS cur, status, COUNT(*) AS n
                   FROM warranty_registrations
                  WHERE vendor_details_id IN (?) AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
                    AND (created_at >= ? OR created_at < DATE_ADD(?, INTERVAL 1 DAY))
                  GROUP BY store_id, cur, status`,
                [p.from, ids, p.prevFrom, p.to, p.from, p.prevTo]);
            const counts = new Map<string, StoreCount>();
            for (const r of rows) {
                const k = String(r.store_id);
                const c = counts.get(k) ?? { store_id: k, cur: { approved: 0, rejected: 0, pending: 0 }, prev: 0 };
                const n = Number(r.n);
                if (Number(r.cur)) { if (r.status === 'validated') c.cur.approved += n; else if (r.status === 'rejected') c.cur.rejected += n; else c.cur.pending += n; }
                else c.prev += n;
                counts.set(k, c);
            }
            const stats = stores.map((s: any) => {
                const k = String(s.vendor_details_id);
                return {
                    ...storeStat(counts.get(k), k),
                    store_name: String(s.store_name ?? '').trim(), city: s.city ?? null,
                    live: Boolean(s.is_verified && s.is_active), weekly: s.weekly ?? [], last_warranty: day(s.last_warranty_at),
                };
            });

            const months = last12(today);
            const [trendRows]: any = await db.query(
                `SELECT DATE_FORMAT(created_at, '%Y-%m') AS m, status, COUNT(*) AS n FROM warranty_registrations
                  WHERE vendor_details_id IN (?) AND created_at >= ? GROUP BY m, status`, [ids, `${months[0]}-01`]);
            const trend = months.map(m => {
                const at = (f: (s: string) => boolean) => trendRows.filter((r: any) => r.m === m && f(r.status)).reduce((n: number, r: any) => n + Number(r.n), 0);
                return { month: m, approved: at(s => s === 'validated'), rejected: at(s => s === 'rejected'), pending: at(s => s !== 'validated' && s !== 'rejected') };
            });

            const [reasonRows]: any = await db.query(
                `SELECT COALESCE(NULLIF(TRIM(rejection_reason), ''), 'No reason written') AS reason, COUNT(*) AS n, COUNT(DISTINCT vendor_details_id) AS stores
                   FROM warranty_registrations
                  WHERE vendor_details_id IN (?) AND status = 'rejected' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
                  GROUP BY reason ORDER BY n DESC LIMIT 6`, [ids, p.from, p.to]);

            res.json({
                success: true, period: p, totals: totals(stats), stores: stats, trend,
                reasons: reasonRows.map((r: any) => ({ reason: r.reason, n: Number(r.n), stores: Number(r.stores) })),
            });
        } catch (error) { fail(res, 'the warranty numbers', error); }
    }

    /** GET /api/asm-portal/posm-requests — POSM requests of all the ASM's stores, newest first (head office's notes left out). */
    static async posmRequests(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const [rows]: any = await db.execute(
                `SELECT r.id, r.ticket_id, r.requirement, r.status, r.items, r.urgent, r.urgent_by, r.created_by_role, creator.name AS created_by_name, r.created_at, r.updated_at,
                        vd.id AS store_id, TRIM(vd.store_name) AS store_name, vd.city
                   FROM posm_requests r JOIN vendor_details vd ON vd.id = r.franchise_id
                   LEFT JOIN profiles creator ON creator.id = r.created_by
                  WHERE vd.asm_id = ? ORDER BY r.created_at DESC LIMIT 500`, [asmId]);
            res.json({
                success: true,
                requests: rows.map((r: any) => {
                    const items = json<any[] | null>(r.items, null);
                    return {
                        id: r.id, ticket_id: r.ticket_id, status: r.status ?? 'open', urgent: Boolean(r.urgent), urgent_by: r.urgent_by ?? null, created_by_role: r.created_by_role, created_by_name: r.created_by_name ?? null,
                        created: day(r.created_at), updated: day(r.updated_at), store_id: String(r.store_id), store_name: r.store_name, city: r.city ?? null,
                        what: Array.isArray(items) && items.length ? items.map(l => `${l.item_name ?? l.item_id}${l.qty ? ` × ${l.approved_qty && l.approved_qty > 0 ? l.approved_qty : l.qty}` : ''}`).join(', ') : String(r.requirement ?? '').slice(0, 160),
                    };
                }),
            });
        } catch (error) { fail(res, 'the POSM requests', error); }
    }

    /** GET /api/asm-portal/grievances — complaints of all the ASM's stores (raised by the store, a customer, head office or the ASM). */
    static async grievances(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            /* A store's grievance carries its store id, or (raised by the store itself) its login id as customer_id. */
            const [rows]: any = await db.execute(
                `SELECT g.id, g.ticket_id, g.source_type, g.category, g.sub_category, g.subject, g.status, g.priority, g.created_by_role,
                        creator.name AS created_by_name, g.created_at, g.updated_at, g.resolved_at,
                        vd.id AS store_id, TRIM(vd.store_name) AS store_name, vd.city
                   FROM vendor_details vd
                   JOIN grievances g ON g.id IN (SELECT id FROM grievances WHERE franchise_id = vd.id
                                                 UNION SELECT id FROM grievances WHERE source_type = 'franchise' AND customer_id = vd.user_id)
                   LEFT JOIN profiles creator ON creator.id = g.created_by
                  WHERE vd.asm_id = ? ORDER BY g.created_at DESC LIMIT 500`, [asmId]);
            res.json({
                success: true,
                grievances: rows.map((g: any) => ({
                    id: g.id, ticket_id: g.ticket_id, source_type: g.source_type, category: g.category ?? null, sub_category: g.sub_category ?? null, subject: g.subject ?? null,
                    status: g.status, priority: g.priority ?? null, created_by_role: g.created_by_role, created_by_name: g.created_by_name ?? null,
                    created: day(g.created_at), resolved: day(g.resolved_at), store_id: String(g.store_id), store_name: g.store_name, city: g.city ?? null,
                })),
            });
        } catch (error) { fail(res, 'the complaints', error); }
    }

    /** GET /api/asm-portal/alerts — which stores need the ASM, and why. */
    static async alerts(req: AuthRequest, res: Response) {
        try {
            const asmId = await asmIdFor(req);
            if (!asmId) return res.status(403).json({ error: 'Your ASM account was not found' });
            const stores = await storesOfAsm(asmId);
            const ids = stores.map((s: any) => String(s.vendor_details_id));
            const today = istToday();
            const [rej]: any = ids.length ? await db.query(
                `SELECT vendor_details_id AS id, COUNT(*) AS n FROM warranty_registrations
                  WHERE vendor_details_id IN (?) AND status = 'rejected' AND COALESCE(rejected_at, created_at) >= NOW() - INTERVAL 30 DAY GROUP BY vendor_details_id`, [ids]) : [[]];
            const rejected = new Map<string, number>(rej.map((r: any) => [String(r.id), Number(r.n)]));
            const [{ rows: posm }, schemes] = await Promise.all([posmFor(ids, today), schemesFor(new Set(ids)).catch(e => { console.error('[ASM insights] schemes for alerts:', e); return null; })]);
            const alerts = asmAlerts({
                today,
                stores: stores.map((s: any) => ({
                    store_id: String(s.vendor_details_id), store_name: String(s.store_name ?? '').trim(), city: s.city ?? null,
                    live: s.is_verified && s.is_active, pending_approval: !s.is_verified, is_franchise: s.is_franchise && !s.is_distributor,
                    last_warranty: day(s.last_warranty_at), rejected_30d: rejected.get(String(s.vendor_details_id)) ?? 0,
                })),
                posm,
                sellMore: schemes?.sell_more ?? [],
                buyMore: schemes?.buy_more ?? [],
                programLive: Boolean(schemes?.program?.live),
            });
            res.json({ success: true, alerts });
        } catch (error) { fail(res, 'the alerts', error); }
    }
}
