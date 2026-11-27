/**
 * Warranties for the ASM, by store: each store's count this period against
 * the same stretch before it, its approval rate and rejections, and the
 * segment it falls in (growing, dropping, silent). Free of any database
 * import, so it is tested directly.
 */

export type PeriodId = 'mtd' | 'last_month' | 'last_90';
export const PERIOD_IDS: PeriodId[] = ['mtd', 'last_month', 'last_90'];

export interface Period { id: PeriodId | 'custom'; from: string; to: string; prevFrom: string; prevTo: string; label: string; prevLabel: string }

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(D(s).getTime() + n * 86400000));
const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
const monthEnd = (s: string) => { const d = D(monthStart(s)); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };
const prevMonth = (s: string) => { const d = D(monthStart(s)); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))); };
const short = (s: string) => D(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthName = (s: string) => D(s).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * The period and the one it is compared with, both inclusive. "This month" is
 * compared with the same days of last month, so the 27th is not set against a
 * whole month.
 */
export function periodOf(id: PeriodId, today: string): Period {
    if (id === 'last_month') {
        const from = prevMonth(today), to = monthEnd(from), prevFrom = prevMonth(from), prevTo = monthEnd(prevFrom);
        return { id, from, to, prevFrom, prevTo, label: monthName(from), prevLabel: monthName(prevFrom) };
    }
    if (id === 'last_90') {
        const from = addDays(today, -89), prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -89);
        return { id, from, to: today, prevFrom, prevTo, label: 'Last 90 days', prevLabel: 'the 90 days before' };
    }
    const from = monthStart(today), prevFrom = prevMonth(today);
    const day = Number(today.slice(8, 10)), prevTo = addDays(prevFrom, Math.min(day, Number(monthEnd(prevFrom).slice(8, 10))) - 1);
    return { id: 'mtd', from, to: today, prevFrom, prevTo, label: `${short(from)} – ${short(today)}`, prevLabel: `${short(prevFrom)} – ${short(prevTo)}` };
}

/**
 * A range the ASM picks, both days included, compared with the same number of
 * days just before it. Null when the dates are not real days, run backwards,
 * reach past today or span more than a year.
 */
export function customPeriod(from: string, to: string, today: string): Period | null {
    const ok = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(D(v)) === v;
    if (!ok(from) || !ok(to) || from > to || to > today) return null;
    const days = Math.round((D(to).getTime() - D(from).getTime()) / 86400000) + 1;
    if (days > 366) return null;
    const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
    const label = from === to ? short(from) : `${short(from)} – ${short(to)}`;
    const prevLabel = prevFrom === prevTo ? short(prevFrom) : `${short(prevFrom)} – ${short(prevTo)}`;
    return { id: 'custom', from, to, prevFrom, prevTo, label, prevLabel };
}

export interface StoreCount { store_id: string; cur: { approved: number; rejected: number; pending: number }; prev: number }
export type Segment = 'growing' | 'dropping' | 'silent' | 'steady' | 'new';

export interface StoreStat {
    store_id: string; current: number; previous: number; change: number | null;
    approved: number; rejected: number; pending: number; approval_rate: number | null; segment: Segment;
}

/**
 * One store's numbers and its segment. A drop or rise counts only when it is
 * real: at least 3 warranties and a quarter of the earlier count, so 1 → 2 is
 * not "growing 100%".
 */
export function storeStat(c: StoreCount | undefined, storeId: string): StoreStat {
    const cur = c?.cur ?? { approved: 0, rejected: 0, pending: 0 };
    const current = cur.approved + cur.rejected + cur.pending, previous = c?.prev ?? 0;
    const decided = cur.approved + cur.rejected;
    const diff = current - previous;
    const big = Math.abs(diff) >= 3 && Math.abs(diff) >= previous * 0.25;
    const segment: Segment = current === 0 ? 'silent' : previous === 0 ? 'new' : big && diff > 0 ? 'growing' : big && diff < 0 ? 'dropping' : 'steady';
    return {
        store_id: storeId, current, previous, change: previous ? Math.round((diff / previous) * 100) : null,
        approved: cur.approved, rejected: cur.rejected, pending: cur.pending,
        approval_rate: decided ? Math.round((cur.approved / decided) * 100) : null, segment,
    };
}

/** The ASM's totals for the period and the change against the one before. */
export function totals(stats: StoreStat[]) {
    const sum = (f: (s: StoreStat) => number) => stats.reduce((n, s) => n + f(s), 0);
    const current = sum(s => s.current), previous = sum(s => s.previous), approved = sum(s => s.approved), rejected = sum(s => s.rejected);
    return {
        current, previous, change: previous ? Math.round(((current - previous) / previous) * 100) : null,
        approved, rejected, pending: sum(s => s.pending),
        approval_rate: approved + rejected ? Math.round((approved / (approved + rejected)) * 100) : null,
        active_stores: stats.filter(s => s.current > 0).length,
    };
}

/** The 12 months up to `today`, oldest first, as YYYY-MM. */
export function last12(today: string): string[] {
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    return Array.from({ length: 12 }, (_, i) => { const k = y * 12 + (m - 1) - (11 - i); return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`; });
}
