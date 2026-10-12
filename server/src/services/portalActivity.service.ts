import db from '../config/database.js';

/**
 * What franchises and distributors do in their portal, and for how long.
 *
 * The portal reports three things (POST /vendor/activity):
 *   open  — the portal was opened (a login, or coming back with a saved login)
 *   page  — a page (module) was opened: home, warranty, leads, orders…
 *   beat  — once a minute while the tab is open, visible and in use
 *
 * Time spent is the number of distinct minutes with a beat, so two tabs open
 * at once still count a minute once per page, and a tab left open in the
 * background counts nothing. Rows are one per user, kind, page and minute —
 * the unique key turns repeats into no-ops.
 *
 * Everything else on the timeline (warranties, orders, POSM, schemes,
 * manpower) is read from the tables that already hold it, so it has history
 * from before this tracker existed. Times are IST: the pool session is +05:30.
 */

export const PORTAL_ACTIVITY_TABLE = `CREATE TABLE IF NOT EXISTS portal_activity (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    kind VARCHAR(10) NOT NULL,
    module VARCHAR(40) NOT NULL DEFAULT '',
    at DATETIME NOT NULL,
    UNIQUE KEY uq_portal_activity (user_id, kind, module, at),
    KEY idx_portal_activity_at (at),
    KEY idx_portal_activity_user (user_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const KINDS = ['open', 'page', 'beat'] as const;
export type ActivityKind = typeof KINDS[number];

/** Page ids the portal uses, kept short and safe; anything else is filed as "other". */
const clean = (module: unknown) => {
    const m = String(module ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
    return m || 'other';
};

export async function recordActivity(userId: string, kind: string, module: unknown): Promise<void> {
    if (!KINDS.includes(kind as ActivityKind)) return;
    await db.execute(
        `INSERT IGNORE INTO portal_activity (user_id, kind, module, at)
         VALUES (?, ?, ?, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:00'))`,
        [userId, kind, kind === 'open' ? '' : clean(module)]
    );
}

/* ─── Reading it back ────────────────────────────────────────────────────── */

export const PAGE_LABEL: Record<string, string> = {
    home: 'Home', warranty: 'Warranties', leads: 'My Leads', orders: 'Orders', offers: 'Offers & Schemes',
    posm: 'POSM', ecatalogue: 'E-Catalogue', catalogue: 'Catalogue', news: 'News & Alerts', grievances: 'Grievances',
    manpower: 'Manpower', audit: 'Audit', profile: 'Profile', terms: 'Terms', 'claim-process': 'Claim Process',
    targets: 'Targets', other: 'Other',
};

const days = (n: unknown, fallback = 30) => Math.min(365, Math.max(1, Math.round(Number(n) || fallback)));

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const istYmd = (t: number) => new Date(t + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * The days a report covers, IST and both included: `from`/`to` (YYYY-MM-DD)
 * when given, else the last `days` days up to today. Capped at a year.
 */
export function reportRange(opts: { days?: unknown; from?: unknown; to?: unknown }) {
    let from = YMD.test(String(opts.from ?? '')) ? String(opts.from) : '';
    let to = YMD.test(String(opts.to ?? '')) ? String(opts.to) : '';
    if (!from || !to) {
        const n = days(opts.days);
        to = istYmd(Date.now());
        from = istYmd(Date.now() - (n - 1) * 86_400_000);
    }
    if (from > to) [from, to] = [to, from];
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (span > 366) from = istYmd(Date.parse(`${to}T00:00:00Z`) - 365 * 86_400_000 - 5.5 * 3600_000);
    return { from, to, days: Math.min(span, 366), params: [`${from} 00:00:00`, `${to} 23:59:59`] as [string, string] };
}

interface StoreRow {
    id: string; user_id: string; store_name: string; city: string | null; state: string | null;
    is_franchise: number; is_distributor: number; distributor_ref: number | null;
}

async function stores(role: string): Promise<StoreRow[]> {
    const where = role === 'distributor' ? 'vd.is_distributor = 1'
        : role === 'franchise' ? 'vd.is_franchise = 1'
            : '(vd.is_franchise = 1 OR vd.is_distributor = 1)';
    const [rows]: any = await db.execute(
        `SELECT vd.id, vd.user_id, vd.store_name, vd.city, vd.state, vd.is_franchise, vd.is_distributor,
                (SELECT d.id FROM distributors d WHERE d.profile_id = vd.user_id LIMIT 1) AS distributor_ref
           FROM vendor_details vd WHERE ${where}`
    );
    return rows;
}

const byKey = (rows: any[], key: string) => new Map<string, any>(rows.map(r => [String(r[key]), r]));

/**
 * Every franchise and distributor with their activity over the last `n` days:
 * time in the portal (and over the last 7), active days, portal opens, last
 * seen, and what they did — warranties at the store, warranties they verified,
 * orders they placed, and (distributors) orders they received.
 */
export async function activityOverview(opts: { days?: unknown; from?: unknown; to?: unknown; role?: string }) {
    const range = reportRange(opts);
    const RG = range.params;
    const list = await stores(opts.role ?? 'all');

    const [portal]: any = await db.execute(
        `SELECT user_id,
                COUNT(DISTINCT CASE WHEN kind = 'beat' THEN at END) AS minutes,
                COUNT(DISTINCT DATE(at)) AS active_days,
                SUM(kind = 'open') AS opens,
                MAX(at) AS last_portal
           FROM portal_activity WHERE at BETWEEN ? AND ? GROUP BY user_id`, RG);
    const [everSeen]: any = await db.execute(`SELECT user_id, MAX(at) AS last_portal FROM portal_activity GROUP BY user_id`);
    const [codes]: any = await db.execute(
        `SELECT o.user_id, MAX(o.created_at) AS last_code,
                SUM(o.created_at BETWEEN ? AND ?) AS codes
           FROM otp_codes o JOIN vendor_details vd ON vd.user_id = o.user_id GROUP BY o.user_id`, RG);
    const [warr]: any = await db.execute(
        `SELECT vendor_details_id AS id,
                SUM(created_at BETWEEN ? AND ?) AS registered,
                SUM(vendor_approved_at BETWEEN ? AND ?) AS verified,
                GREATEST(COALESCE(MAX(created_at), '1970-01-01'), COALESCE(MAX(vendor_approved_at), '1970-01-01')) AS last_warranty
           FROM warranty_registrations WHERE vendor_details_id IS NOT NULL GROUP BY vendor_details_id`, [...RG, ...RG]);
    const [placed]: any = await db.execute(
        `SELECT vendor_id AS uid, SUM(created_at BETWEEN ? AND ?) AS orders, MAX(created_at) AS last_order
           FROM store_orders GROUP BY vendor_id`, RG);
    const [received]: any = await db.execute(
        `SELECT distributor_id AS did, SUM(created_at BETWEEN ? AND ?) AS incoming FROM store_orders GROUP BY distributor_id`, RG);

    const P = byKey(portal, 'user_id'), E = byKey(everSeen, 'user_id'), C = byKey(codes, 'user_id');
    const W = byKey(warr, 'id'), O = byKey(placed, 'uid'), R = byKey(received, 'did');
    const latest = (...ds: any[]) => {
        const t = ds.map(d => (d ? new Date(d).getTime() : 0)).filter(x => x > 0 && x > Date.UTC(2000, 0, 1));
        return t.length ? new Date(Math.max(...t)).toISOString() : null;
    };

    return {
        days: range.days, from: range.from, to: range.to,
        stores: list.map(s => {
            const p = P.get(s.user_id), c = C.get(s.user_id), w = W.get(String(s.id)), o = O.get(s.user_id);
            const r = s.distributor_ref != null ? R.get(String(s.distributor_ref)) : undefined;
            return {
                id: s.id, name: s.store_name, city: s.city, state: s.state,
                is_franchise: Boolean(s.is_franchise), is_distributor: Boolean(s.is_distributor),
                minutes: Number(p?.minutes ?? 0),
                active_days: Number(p?.active_days ?? 0), opens: Number(p?.opens ?? 0),
                login_codes: Number(c?.codes ?? 0),
                warranties: Number(w?.registered ?? 0), verified: Number(w?.verified ?? 0),
                orders: Number(o?.orders ?? 0), incoming: Number(r?.incoming ?? 0),
                /* Last sign of life anywhere: the portal, a login code, a warranty, an order. */
                last_active: latest(E.get(s.user_id)?.last_portal, c?.last_code, w?.last_warranty, o?.last_order),
                last_portal: E.get(s.user_id)?.last_portal ? new Date(E.get(s.user_id).last_portal).toISOString() : null,
            };
        }).map(r => ({
            ...r,
            /* Did anything in the range: portal use, a login code, a warranty, an order. */
            active_in_range: Boolean(r.minutes || r.opens || r.login_codes || r.warranties || r.verified || r.orders || r.incoming),
        })),
    };
}

export interface TimelineItem { at: string; kind: string; title: string; detail?: string | null }

/**
 * One store over the last `n` days: the totals, minutes per day and per page,
 * and a timeline of everything it did, newest first.
 */
export async function storeActivity(vendorId: string, opts: { days?: unknown; from?: unknown; to?: unknown }) {
    const range = reportRange(opts);
    const [[s]]: any = await db.execute(
        `SELECT vd.id, vd.user_id, vd.store_name, vd.city, vd.state, vd.is_franchise, vd.is_distributor,
                (SELECT d.id FROM distributors d WHERE d.profile_id = vd.user_id LIMIT 1) AS distributor_ref
           FROM vendor_details vd WHERE vd.id = ?`, [vendorId]);
    if (!s) return null;

    const since = range.params;
    const [rows]: any = await db.execute(
        `SELECT kind, module, at FROM portal_activity WHERE user_id = ? AND at BETWEEN ? AND ? ORDER BY at`,
        [s.user_id, ...since]);

    // Minutes per day and per page, from the beats.
    const perDay = new Map<string, number>();
    const perPage = new Map<string, number>();
    const seenMinute = new Set<string>();
    for (const r of rows) {
        if (r.kind !== 'beat') continue;
        const at = new Date(r.at);
        const minuteKey = at.toISOString();
        const day = new Date(at.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
        perPage.set(r.module, (perPage.get(r.module) ?? 0) + 1);
        if (seenMinute.has(minuteKey)) continue;   // two pages in one minute: the day counts it once
        seenMinute.add(minuteKey);
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }

    /* Page visits on the timeline: each "page" event with the minutes spent on
       that page until the next page or portal open. */
    const timeline: TimelineItem[] = [];
    const nav = rows.filter((r: any) => r.kind !== 'beat');
    for (let i = 0; i < nav.length; i++) {
        const r = nav[i];
        const at = new Date(r.at).toISOString();
        if (r.kind === 'open') { timeline.push({ at, kind: 'open', title: 'Opened the portal' }); continue; }
        const until = nav[i + 1] ? new Date(nav[i + 1].at).getTime() : Infinity;
        const mins = rows.filter((b: any) => b.kind === 'beat' && b.module === r.module
            && new Date(b.at).getTime() >= new Date(r.at).getTime() && new Date(b.at).getTime() < until).length;
        timeline.push({ at, kind: 'page', title: `Viewed ${PAGE_LABEL[r.module] ?? r.module}`, detail: mins ? `${mins} min` : null });
    }

    const add = (list: any[], kind: string, title: (r: any) => string, detail?: (r: any) => string | null) =>
        list.forEach(r => r.at && timeline.push({ at: new Date(r.at).toISOString(), kind, title: title(r), detail: detail?.(r) ?? null }));

    const [codes]: any = await db.execute(
        `SELECT created_at AS at FROM otp_codes WHERE user_id = ? AND created_at BETWEEN ? AND ?`, [s.user_id, ...since]);
    add(codes, 'login', () => 'Login code sent');

    const [registered]: any = await db.execute(
        `SELECT created_at AS at, customer_name, product_type, uid FROM warranty_registrations
          WHERE vendor_details_id = ? AND created_at BETWEEN ? AND ?`, [s.id, ...since]);
    add(registered, 'warranty', r => `Warranty registered · ${r.customer_name || 'Customer'}`,
        r => [r.product_type === 'seat-cover' ? 'Seat cover' : r.product_type === 'ev-products' ? 'PPF' : r.product_type, r.uid].filter(Boolean).join(' · '));

    const [verified]: any = await db.execute(
        `SELECT vendor_approved_at AS at, customer_name, uid FROM warranty_registrations
          WHERE vendor_details_id = ? AND vendor_approved_at BETWEEN ? AND ?`, [s.id, ...since]);
    add(verified, 'verify', r => `Verified a warranty · ${r.customer_name || 'Customer'}`, r => r.uid);

    const [orders]: any = await db.execute(
        `SELECT o.created_at AS at, o.id, o.status, d.name AS distributor,
                (SELECT COALESCE(SUM(quantity), 0) FROM store_order_items i WHERE i.order_id = o.id) AS units
           FROM store_orders o LEFT JOIN distributors d ON d.id = o.distributor_id
          WHERE o.vendor_id = ? AND o.created_at BETWEEN ? AND ?`, [s.user_id, ...since]);
    add(orders, 'order', r => `Placed an order · ${Number(r.units)} unit${Number(r.units) === 1 ? '' : 's'}`,
        r => [r.distributor, String(r.id).slice(0, 8).toUpperCase(), r.status].filter(Boolean).join(' · '));

    if (s.distributor_ref != null) {
        const [incoming]: any = await db.execute(
            `SELECT o.created_at AS at, o.id, vd.store_name FROM store_orders o
               LEFT JOIN vendor_details vd ON vd.user_id = o.vendor_id
              WHERE o.distributor_id = ? AND o.created_at BETWEEN ? AND ?`, [s.distributor_ref, ...since]);
        add(incoming, 'incoming', r => `Received an order · ${r.store_name || 'Franchise'}`, r => String(r.id).slice(0, 8).toUpperCase());
    }

    const [posm]: any = await db.execute(
        `SELECT created_at AS at, ticket_id, requirement FROM posm_requests
          WHERE franchise_id = ? AND created_at BETWEEN ? AND ? AND (created_by_role IS NULL OR created_by_role <> 'admin')`, [s.id, ...since]);
    add(posm, 'posm', r => `Raised a POSM request${r.ticket_id ? ` · #${r.ticket_id}` : ''}`, r => String(r.requirement ?? '').slice(0, 80) || null);

    const [entries]: any = await db.execute(
        `SELECT e.created_at AS at, s.title FROM scheme_entries e LEFT JOIN schemes s ON s.id = e.scheme_id
          WHERE e.store_id = ? AND e.created_at BETWEEN ? AND ? AND (e.source IS NULL OR e.source = 'store')`, [s.id, ...since]);
    add(entries, 'scheme', () => 'Submitted a scheme entry', r => r.title);

    const [team]: any = await db.execute(
        `SELECT created_at AS at, name FROM manpower WHERE vendor_id = ? AND created_at BETWEEN ? AND ?`, [s.id, ...since]);
    add(team, 'manpower', r => `Added manpower · ${r.name}`);

    timeline.sort((a, b) => b.at.localeCompare(a.at));

    const minutes = [...perDay.values()].reduce((a, b) => a + b, 0);
    const activeDays = new Set(rows.map((r: any) => new Date(new Date(r.at).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10))).size;
    return {
        days: range.days, from: range.from, to: range.to,
        store: {
            id: s.id, name: s.store_name, city: s.city, state: s.state,
            is_franchise: Boolean(s.is_franchise), is_distributor: Boolean(s.is_distributor),
        },
        summary: {
            minutes,
            active_days: activeDays,
            opens: rows.filter((r: any) => r.kind === 'open').length,
            login_codes: codes.length,
            warranties: registered.length, verified: verified.length, orders: orders.length,
            last_portal: rows.length ? new Date(rows[rows.length - 1].at).toISOString() : null,
            tracking_since: null as string | null,
        },
        per_day: [...perDay].map(([day, m]) => ({ day, minutes: m })).sort((a, b) => a.day.localeCompare(b.day)),
        per_page: [...perPage].map(([module, m]) => ({ module, label: PAGE_LABEL[module] ?? module, minutes: m }))
            .sort((a, b) => b.minutes - a.minutes),
        timeline: timeline.slice(0, 300),
    };
}

/** The first day anything was tracked, so screens can say "since 8 Oct". */
export async function trackingSince(): Promise<string | null> {
    const [[r]]: any = await db.execute(`SELECT MIN(at) AS first FROM portal_activity`);
    return r?.first ? new Date(r.first).toISOString() : null;
}
