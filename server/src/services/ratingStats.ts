/**
 * The numbers behind the admin's store ratings screens: the network overview
 * and one store. Plain rows in, plain figures out, with no database import, so
 * the arithmetic can be tested on its own.
 */

export interface RatingRow {
    store_id: string;
    stars: number;
    /** IST calendar day, YYYY-MM-DD. */
    day: string;
    product: string | null;
    customer_name?: string | null;
    customer_phone?: string | null;
    warranty_uid?: string | null;
}

export interface StoreInfo {
    store_id: string;
    name: string;
    brand: string;
    state: string | null;
    city: string | null;
}

export type PeriodKey = 'today' | '7' | '15' | '30' | 'overall' | 'custom';
export interface Period { key: PeriodKey; start: string | null; end: string | null; prevStart: string | null; prevEnd: string | null; label: string }

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toMs(v));

/**
 * A period ending today (IST), and the period of the same length just before
 * it, for "change vs the period before". Overall has no earlier period. A
 * custom range with a bad or backwards date falls back to the last 30 days.
 */
export function resolvePeriod(key: unknown, from: unknown, to: unknown, today: string): Period {
    const spans: Record<string, [number, string]> = { today: [1, 'Today'], '7': [7, 'Last 7 days'], '15': [15, 'Last 15 days'], '30': [30, 'Last 30 days'] };
    let k = String(key ?? '30');
    if (k === 'overall') return { key: 'overall', start: null, end: null, prevStart: null, prevEnd: null, label: 'Overall' };
    let start: string; let end: string; let label: string;
    if (k === 'custom' && isDay(from) && isDay(to) && from <= to) { start = from; end = to; label = `${from} to ${to}`; }
    else {
        if (!spans[k]) k = '30';
        const [n, text] = spans[k];
        end = today; start = toDay(toMs(today) - (n - 1) * DAY); label = text;
    }
    const length = Math.round((toMs(end) - toMs(start)) / DAY) + 1;
    const prevEnd = toDay(toMs(start) - DAY);
    const prevStart = toDay(toMs(start) - length * DAY);
    return { key: (k === 'custom' && label.includes(' to ') ? 'custom' : (k as PeriodKey)), start, end, prevStart, prevEnd, label };
}

const within = (day: string, a: string | null, b: string | null) => (a === null || day >= a) && (b === null || day <= b);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
export function average(rows: { stars: number }[]): number | null {
    return rows.length ? round2(rows.reduce((t, r) => t + r.stars, 0) / rows.length) : null;
}

export function split(rows: { stars: number }[]): Record<1 | 2 | 3 | 4 | 5, number> {
    const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of rows) if (r.stars >= 1 && r.stars <= 5) out[r.stars as 1 | 2 | 3 | 4 | 5]++;
    return out;
}

/** The last `n` calendar months ending with the month of `today`, oldest first, as YYYY-MM. */
export function lastMonths(today: string, n = 6): string[] {
    const [y, m] = today.split('-').map(Number);
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
        const t = new Date(Date.UTC(y, m - 1 - i, 1));
        out.push(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return out;
}

const byMonth = (rows: RatingRow[], months: string[]) =>
    months.map(month => ({ month, average: average(rows.filter(r => r.day.startsWith(month))), count: rows.filter(r => r.day.startsWith(month)).length }));

export const LOW_AVERAGE = 4.0;
export type AverageBand = 'any' | 'below4' | '4to45' | 'above45';
const inBand = (avg: number | null, band: AverageBand) => {
    if (band === 'any') return true;
    if (avg === null) return false;
    return band === 'below4' ? avg < 4 : band === '4to45' ? avg >= 4 && avg <= 4.5 : avg > 4.5;
};

export interface OverviewStore {
    store_id: string; name: string; brand: string; state: string | null; city: string | null;
    average: number | null; ratings: number;
    period_average: number | null; period_ratings: number; previous_average: number | null; change: number | null;
    needs_attention: boolean;
}

export interface Overview {
    summary: { average: number | null; ratings: number; stores_rated: number; stores_total: number; below_low: number; warranties_rated_pct: number | null };
    by_month: { month: string; average: number | null; count: number }[];
    split: Record<1 | 2 | 3 | 4 | 5, number>;
    stores: OverviewStore[];
}

/**
 * The network overview. `ratings` and `stores` are already narrowed by brand,
 * state and product. The summary is over the period; each store's own average
 * and count are all-time, with its average in the period and how that moved
 * against the period before it.
 */
export function buildOverview(
    ratings: RatingRow[], stores: StoreInfo[], period: Period, today: string,
    opts: { band?: AverageBand; minCount?: number; warrantiesInPeriod?: number | null } = {}
): Overview {
    const band = opts.band ?? 'any';
    const minCount = Math.max(1, opts.minCount ?? 1);
    const inPeriod = ratings.filter(r => within(r.day, period.start, period.end));
    const rowsOf = new Map<string, RatingRow[]>();
    for (const r of ratings) (rowsOf.get(r.store_id) ?? rowsOf.set(r.store_id, []).get(r.store_id)!).push(r);

    const all: OverviewStore[] = stores.map(s => {
        const mine = rowsOf.get(s.store_id) ?? [];
        const now = mine.filter(r => within(r.day, period.start, period.end));
        const before = period.prevStart ? mine.filter(r => within(r.day, period.prevStart, period.prevEnd)) : [];
        const pa = average(now);
        const prev = average(before);
        const change = pa !== null && prev !== null ? round1(pa - prev) : null;
        return {
            ...s, average: average(mine), ratings: mine.length,
            period_average: pa, period_ratings: now.length, previous_average: prev, change,
            needs_attention: pa !== null && pa < LOW_AVERAGE && now.length >= minCount,
        };
    });
    const list = all.filter(s => inBand(period.key === 'overall' ? s.average : s.period_average, band));
    const periodAverages = all.filter(s => s.period_average !== null);
    const warranties = opts.warrantiesInPeriod ?? null;
    return {
        summary: {
            average: average(inPeriod), ratings: inPeriod.length,
            stores_rated: periodAverages.length, stores_total: stores.length,
            below_low: periodAverages.filter(s => (s.period_average as number) < LOW_AVERAGE).length,
            warranties_rated_pct: warranties && warranties > 0 ? Math.min(100, Math.round((inPeriod.length / warranties) * 100)) : null,
        },
        by_month: byMonth(ratings, lastMonths(today)),
        split: split(inPeriod),
        stores: list,
    };
}

const maskPhone = (p: string | null | undefined) => {
    const d = String(p ?? '').replace(/\D/g, '');
    return d.length >= 6 ? `${d.slice(0, 2)}••••${d.slice(-4)}` : '';
};

export interface StoreDetail {
    store: StoreInfo;
    average: number | null; ratings: number;
    period: { average: number | null; ratings: number; previous_average: number | null; change: number | null };
    low: { count: number; of: number };
    network_average: number | null;
    split: Record<1 | 2 | 3 | 4 | 5, number>;
    by_month: { month: string; store: number | null; network: number | null }[];
    list: { day: string; stars: number; customer: string; phone: string; product: string | null; warranty_uid: string | null }[];
}

/** One store: its ratings against the network's, month by month, and every rating with the customer's number masked. */
export function buildStoreDetail(store: StoreInfo, mine: RatingRow[], network: RatingRow[], period: Period, today: string): StoreDetail {
    const now = mine.filter(r => within(r.day, period.start, period.end));
    const before = period.prevStart ? mine.filter(r => within(r.day, period.prevStart, period.prevEnd)) : [];
    const pa = average(now); const prev = average(before);
    const months = lastMonths(today);
    const own = byMonth(mine, months); const net = byMonth(network, months);
    return {
        store, average: average(mine), ratings: mine.length,
        period: { average: pa, ratings: now.length, previous_average: prev, change: pa !== null && prev !== null ? round1(pa - prev) : null },
        low: { count: mine.filter(r => r.stars <= 2).length, of: mine.length },
        network_average: average(network),
        split: split(mine),
        by_month: months.map((month, i) => ({ month, store: own[i].average, network: net[i].average })),
        list: [...mine].sort((a, b) => b.day.localeCompare(a.day)).map(r => ({
            day: r.day, stars: r.stars, customer: String(r.customer_name ?? '').trim() || 'Customer', phone: maskPhone(r.customer_phone),
            product: r.product ?? null, warranty_uid: r.warranty_uid ?? null,
        })),
    };
}
