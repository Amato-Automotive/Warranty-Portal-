/**
 * Schemes run by targets ("More You Sell, Less It Costs"): free of any
 * database import so they are tested directly.
 *
 * A scheme's `settings` say how it runs. The default, `run: 'entries'`, is
 * every scheme so far: stores submit, the admin approves, points add up. With
 * `run: 'targets'` the admin adds the franchises, gives each a target per
 * period (in sets, say) and types what it achieved; reaching a step — a share
 * of the target — earns that step's benefit, e.g. 100% → ₹100 off every set.
 * A franchise may have its own steps instead of the scheme's. What the store
 * sees of all this is switched per scheme.
 *
 * New ways of running a scheme are new values here, read with defaults, so a
 * scheme saved before them reads exactly as it did.
 */

export type RunMode = 'entries' | 'targets';
/* 'window': a target for each of the scheme's windows (e.g. each month it is open). */
export type TargetPeriod = 'whole' | 'month' | 'quarter' | 'window';
/** How a step's benefit is given: ₹ off each unit achieved, a % off the price, or a reward in words. */
export type BenefitKind = 'per_unit' | 'percent' | 'fixed';

/** A step: reach `pct`% of the target to earn `amount` (₹ per unit, or % off) or `reward` (fixed). */
export interface TargetStep { pct: number; amount?: number; reward?: string }

/** What a store sees of its target on a target scheme. */
export interface TargetVisibility {
    target: boolean; achieved: boolean; percent: boolean; steps: boolean;
    /* How many more units reach the next step: off unless the admin turns it on. */
    to_next: boolean;
}

/**
 * Where achievement comes from: typed by the admin, or counted from the
 * store's approved warranties registered in the period.
 */
export type TargetSource = 'manual' | 'warranties';
/** Which warranties count: approved only, or every one registered (not rejected). */
export type WarrantyCount = 'approved' | 'registered';
/** Which date places a warranty in a month and a window: when it was registered, or the purchase date on it. */
export type WarrantyDate = 'registered' | 'purchase';

/**
 * Counting in points: each warranty is worth its series' points (Amaze 0.5,
 * Signature 1.25…), times the store type's multiplier (Big Daddy ×2). The
 * admin names the series, their points and products, and the store types.
 */
export type Measure = 'warranties' | 'points';
/** A series: the warranty products (by name) in it and the points each is worth. */
export interface PointSeries { id: string; name: string; points: number; products: string[] }
/** A kind of store and what its points are multiplied by. */
export interface StoreTier { id: string; name: string; times: number }
export interface PointsRule { series: PointSeries[]; tiers: StoreTier[] }

export interface SchemeSettings {
    run: RunMode;
    measure: Measure;
    points: PointsRule;
    source: TargetSource;
    /* Warranties: the store's monthly average is taken over this many full months before the scheme starts. */
    baseline_months: number;
    count: WarrantyCount;
    date_by: WarrantyDate;
    unit: string;
    period: TargetPeriod;
    benefit: BenefitKind;
    steps: TargetStep[];
    show: TargetVisibility;
}

export const DEFAULT_SETTINGS: SchemeSettings = {
    run: 'entries',
    measure: 'warranties',
    points: { series: [], tiers: [] },
    source: 'manual',
    baseline_months: 3,
    count: 'approved',
    date_by: 'registered',
    unit: 'sets',
    period: 'month',
    benefit: 'per_unit',
    steps: [],
    show: { target: true, achieved: true, percent: true, steps: true, to_next: false },
};

/**
 * A franchise's own terms on a target scheme. With warranties, the admin
 * gives each store a growth over its average and a reward for reaching the
 * target that growth makes; the store sees the number, never the growth.
 */
export interface StoreTerms {
    steps?: TargetStep[]; note?: string; growth_pct?: number; reward?: string;
    /* The average the growth was put on, as the admin chose to see it, and its value then. */
    basis?: AverageBasis; average?: number;
    /* Counting in points: the store's type (its multiplier) and the target typed for every period. */
    tier?: string; target?: number;
}

/** What one store's points are multiplied by: its type's, else the first type's, else 1. */
export function tierOf(rule: PointsRule, tierId: string | undefined): StoreTier | null {
    return rule.tiers.find(t => t.id === tierId) ?? rule.tiers[0] ?? null;
}

/** Each product's points, by its name in lower case (a product in two series counts once, at the first). */
export function pointsByProduct(rule: PointsRule): Map<string, number> {
    const out = new Map<string, number>();
    for (const s of rule.series) for (const p of s.products) {
        const k = p.trim().toLowerCase();
        if (k && !out.has(k)) out.set(k, s.points);
    }
    return out;
}

/** Points to two decimals, so 0.5 + 0.25 adds up cleanly. */
export const roundPoints = (n: number) => Math.round(n * 100) / 100;

/** The points rule as typed, cleaned: names trimmed, numbers read, products listed once. */
export function readPoints(raw: any): PointsRule {
    const id = (v: unknown, prefix: string, i: number) => String(v ?? '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || `${prefix}${i + 1}`;
    const series = (Array.isArray(raw?.series) ? raw.series : []).slice(0, 30).map((s: any, i: number) => ({
        id: id(s?.id, 's', i),
        name: String(s?.name ?? '').trim().slice(0, 40),
        points: Number(s?.points),
        products: [...new Set<string>((Array.isArray(s?.products) ? s.products : []).map((p: unknown) => String(p ?? '').trim().slice(0, 120)).filter(Boolean))].slice(0, 300),
    }));
    const tiers = (Array.isArray(raw?.tiers) ? raw.tiers : []).slice(0, 10).map((t: any, i: number) => ({
        id: id(t?.id, 't', i),
        name: String(t?.name ?? '').trim().slice(0, 40),
        times: Number(t?.times),
    }));
    return { series, tiers };
}

/** Problems with a points rule, in words. */
export function pointsProblems(rule: PointsRule): string[] {
    const p: string[] = [];
    if (!rule.series.length) p.push('Add at least one series with its points');
    const owner = new Map<string, string>();
    for (const s of rule.series) {
        if (!s.name) p.push('Every series needs a name');
        if (!Number.isFinite(s.points) || s.points <= 0 || s.points > 10000) p.push(`Give ${s.name || 'every series'} its points (more than 0)`);
        for (const prod of s.products) {
            const k = prod.toLowerCase();
            if (owner.has(k) && owner.get(k) !== s.name) p.push(`${prod} is in both ${owner.get(k)} and ${s.name}`);
            owner.set(k, s.name);
        }
    }
    if (!rule.tiers.length) p.push('Add at least one store type, e.g. Regular ×1');
    for (const t of rule.tiers) {
        if (!t.name) p.push('Every store type needs a name');
        if (!Number.isFinite(t.times) || t.times <= 0 || t.times > 100) p.push(`Give ${t.name || 'every store type'} a multiplier above 0`);
    }
    return p;
}

/** The steps and benefit kind one store is judged by: its reward, its own steps, or the scheme's. */
export function stepsFor(terms: StoreTerms, s: SchemeSettings): { steps: TargetStep[]; benefit: BenefitKind } {
    if (terms.reward) return { steps: [{ pct: 100, reward: terms.reward }], benefit: 'fixed' };
    if (terms.steps?.length) return { steps: terms.steps, benefit: s.benefit };
    return { steps: s.steps, benefit: s.benefit };
}

/** The months a scheme's average is taken over: the `n` full months before its start month, oldest first. */
export function baselineMonths(startsOn: string, n: number): string[] {
    let [y, m] = startsOn.slice(0, 7).split('-').map(Number);
    const out: string[] = [];
    for (let i = 0; i < Math.max(1, Math.min(n, 24)); i++) {
        m--; if (m < 1) { m = 12; y--; }
        out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    }
    return out;
}

/** The average per month over these months, from counts by month (a month with none counts as 0). */
export function monthlyAverage(counts: Record<string, number>, months: string[]): number {
    if (!months.length) return 0;
    return months.reduce((n, m) => n + (counts[m] ?? 0), 0) / months.length;
}

/* ─── A store's average, as the admin chooses to see it ─────────────────── */

/** Which average: every warranty so far, the last 3 or 6 full months, or a range the admin picks. */
export interface AverageBasis { mode: 'overall' | 'm3' | 'm6' | 'custom'; from?: string; to?: string }

export const DAYS_PER_MONTH = 365.25 / 12;
const dayMs = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs) + 1;
const shiftMonths = (ym: string, by: number) => {
    let [y, m] = ym.split('-').map(Number);
    m += by;
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    return `${y}-${String(m).padStart(2, '0')}`;
};
const lastDay = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** A basis as days: the last 3 or 6 full months before this month, from the first warranty, or the admin's range. */
export function basisRange(b: AverageBasis, today: string, firstDay: string | null): { from: string; to: string } | null {
    const thisMonth = today.slice(0, 7);
    if (b.mode === 'm3' || b.mode === 'm6') {
        const n = b.mode === 'm3' ? 3 : 6;
        return { from: `${shiftMonths(thisMonth, -n)}-01`, to: lastDay(shiftMonths(thisMonth, -1)) };
    }
    if (b.mode === 'custom') return b.from && b.to && b.from <= b.to ? { from: b.from, to: b.to } : null;
    return firstDay && firstDay <= today ? { from: firstDay, to: today } : null;
}

/** Warranties a month over a range of days, from counts by day ("YYYY-MM-DD"), to one decimal. */
export function averagePerMonth(daily: Record<string, number>, range: { from: string; to: string } | null): number {
    if (!range) return 0;
    let total = 0;
    for (const [d, n] of Object.entries(daily)) if (d >= range.from && d <= range.to) total += n;
    /* At least a month: a store with two days of warranties is not stretched into a month of them. */
    const months = Math.max(1, daysBetween(range.from, range.to) / DAYS_PER_MONTH);
    return Math.round((total / months) * 10) / 10;
}

/** Each window of a scheme as a period: from its first to its last day; about how many months it spans. */
export function windowPeriods(windows: { start: string; end: string }[]): (Period & { from: string; to: string; days: number })[] {
    return windows.filter(w => w.start && w.end).map(w => ({ from: w.start.slice(0, 10), to: w.end.slice(0, 10) }))
        .sort((a, b) => a.from.localeCompare(b.from))
        .map(({ from, to }) => {
            const days = daysBetween(from, to);
            const label = (d: string, year: boolean) => {
                const [y, m, dd] = d.split('-').map(Number);
                return `${dd} ${MONTHS[m - 1]}${year ? ` ${y}` : ''}`;
            };
            return {
                key: from, from, to, days,
                label: `${label(from, from.slice(0, 4) !== to.slice(0, 4))} – ${label(to, true)}`,
                months: Array.from({ length: Math.max(1, Math.round(days / DAYS_PER_MONTH)) }, (_, i) => shiftMonths(from.slice(0, 7), i)),
            };
        });
}

/** The target a growth makes: the average × the months in the period × (1 + growth), rounded up. */
export function growthTarget(average: number, growthPct: number, monthsInPeriod: number): number {
    return Math.ceil(average * monthsInPeriod * (1 + growthPct / 100) - 1e-9);
}

const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Steps as typed, cleaned: in order of share, numbers read, text trimmed. */
export function readSteps(raw: unknown): TargetStep[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 10).map((s: any) => ({
        pct: Number(s?.pct),
        ...(num(s?.amount) !== null ? { amount: num(s.amount)! } : {}),
        ...(String(s?.reward ?? '').trim() ? { reward: String(s.reward).trim().slice(0, 160) } : {}),
    })).sort((a, b) => a.pct - b.pct);
}

/** A scheme's settings from what was saved (or sent), every missing piece at its default. */
export function readSettings(raw: unknown): SchemeSettings {
    const s: any = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : (raw ?? {});
    const d = DEFAULT_SETTINGS;
    return {
        run: s.run === 'targets' ? 'targets' : 'entries',
        measure: s.measure === 'points' ? 'points' : 'warranties',
        points: readPoints(s.points),
        source: s.source === 'warranties' ? 'warranties' : 'manual',
        baseline_months: [1, 3, 6, 12].includes(Number(s.baseline_months)) ? Number(s.baseline_months) : d.baseline_months,
        count: s.count === 'registered' ? 'registered' : 'approved',
        date_by: s.date_by === 'purchase' ? 'purchase' : 'registered',
        unit:String(s.unit ?? '').trim().slice(0, 20) || d.unit,
        period: (['whole', 'month', 'quarter', 'window'] as const).includes(s.period) ? s.period : d.period,
        benefit: (['per_unit', 'percent', 'fixed'] as const).includes(s.benefit) ? s.benefit : d.benefit,
        steps: readSteps(s.steps),
        show: {
            target: s.show?.target ?? d.show.target, achieved: s.show?.achieved ?? d.show.achieved,
            percent: s.show?.percent ?? d.show.percent, steps: s.show?.steps ?? d.show.steps,
            to_next: s.show?.to_next ?? d.show.to_next,
        },
    };
}

/** Problems with a set of steps for this kind of benefit, in words. */
export function stepProblems(steps: TargetStep[], benefit: BenefitKind): string[] {
    const p: string[] = [];
    if (!steps.length) p.push('Add at least one step, e.g. 100% of the target');
    const seen = new Set<number>();
    for (const s of steps) {
        if (!Number.isFinite(s.pct) || s.pct <= 0 || s.pct > 1000) { p.push('Every step needs a share of the target above 0%'); continue; }
        if (seen.has(s.pct)) p.push(`Two steps are at ${s.pct}%`);
        seen.add(s.pct);
        if (benefit === 'fixed') { if (!s.reward) p.push(`Write the reward for ${s.pct}%`); }
        else if (s.amount === undefined || !Number.isFinite(s.amount) || s.amount <= 0) p.push(`Give the ${benefit === 'percent' ? '% off' : '₹ off per unit'} for ${s.pct}%`);
        else if (benefit === 'percent' && s.amount > 100) p.push(`${s.pct}%: the discount can't be more than 100%`);
    }
    return p;
}

/** Problems with a target scheme's settings; none for a scheme run by entries. */
export function settingsProblems(s: SchemeSettings): string[] {
    if (s.run !== 'targets') return [];
    if (s.measure === 'points') return s.source === 'warranties' ? pointsProblems(s.points) : ['Points are counted from warranties'];
    /* Counted from warranties, each store gets its own reward; scheme steps are optional. */
    if (s.source === 'warranties' && !s.steps.length) return [];
    return stepProblems(s.steps, s.benefit);
}

/* ─── Periods ─────────────────────────────────────────────────────────────── */

/** A period, and the months ("2026-10") it is made of. */
export interface Period { key: string; label: string; months: string[] }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;

/**
 * The periods a target is kept for, from the scheme's first to last day
 * ("YYYY-MM-DD"): one for the whole scheme ("all"), each month ("2026-10"),
 * or each three months counted from the start month ("Q2026-10", Oct–Dec).
 */
export function periodsOf(startsOn: string, endsOn: string, period: TargetPeriod): Period[] {
    let [y, m] = startsOn.slice(0, 7).split('-').map(Number);
    const [ey, em] = endsOn.slice(0, 7).split('-').map(Number);
    if (!y || !m || !ey || !em) return [];
    const months: [number, number][] = [];
    while ((y < ey || (y === ey && m <= em)) && months.length < 120) {
        months.push([y, m]);
        m++; if (m > 12) { m = 1; y++; }
    }
    const key = ([yy, mm]: [number, number]) => `${yy}-${String(mm).padStart(2, '0')}`;
    if (period === 'whole') return [{ key: 'all', label: 'Whole scheme', months: months.map(key) }];
    if (period === 'month') return months.map(x => ({ key: key(x), label: monthLabel(x[0], x[1]), months: [key(x)] }));
    const out: Period[] = [];
    for (let i = 0; i < months.length; i += 3) {
        const part = months.slice(i, i + 3);
        const a = part[0], b = part[part.length - 1];
        out.push({ key: `Q${key(a)}`, label: a[0] === b[0] ? `${MONTHS[a[1] - 1]}–${monthLabel(b[0], b[1])}` : `${monthLabel(a[0], a[1])}–${monthLabel(b[0], b[1])}`, months: part.map(key) });
    }
    return out;
}

/* ─── Where a store stands against its target ─────────────────────────────── */

export interface TargetResult {
    /* Share of the target achieved, 0 decimals; null with no target or nothing achieved yet. */
    pct: number | null;
    /* The highest step reached, or null. */
    step: TargetStep | null;
    step_no: number | null;
    /* The benefit in words ("₹10,500" / "5% off" / the reward), and ₹ when it is a sum. */
    benefit: string | null;
    benefit_rupees: number | null;
    /* The next step and the units still needed to reach it, or nulls at the top. */
    next: TargetStep | null;
    to_next: number | null;
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * A store's standing for one period. The highest step whose share of the
 * target is reached counts, and only that one: with ₹ off per unit, every
 * unit achieved earns the step's amount (100 sets at ₹100 → ₹10,000).
 */
export function targetResult(target: number | null, achieved: number | null, steps: TargetStep[], benefit: BenefitKind): TargetResult {
    const empty: TargetResult = { pct: null, step: null, step_no: null, benefit: null, benefit_rupees: null, next: null, to_next: null };
    const sorted = [...steps].sort((a, b) => a.pct - b.pct);
    if (!target || target <= 0) return empty;
    const done = achieved ?? 0;
    const share = (done / target) * 100;
    let idx = -1;
    sorted.forEach((s, i) => { if (share + 1e-9 >= s.pct) idx = i; });
    const step = idx >= 0 ? sorted[idx] : null;
    const next = sorted[idx + 1] ?? null;
    let text: string | null = null;
    let sum: number | null = null;
    if (step) {
        if (benefit === 'per_unit') { sum = done * (step.amount ?? 0); text = rupees(sum); }
        else if (benefit === 'percent') text = `${step.amount}% off`;
        else text = step.reward ?? null;
    }
    return {
        pct: achieved === null ? null : Math.round(share),
        step, step_no: step ? idx + 1 : null,
        benefit: text, benefit_rupees: sum,
        next, to_next: next ? Math.max(Math.ceil((next.pct / 100) * target - done - 1e-9), 0) : null,
    };
}

/* ─── Excel import ────────────────────────────────────────────────────────── */

export interface TargetImportRow { row: number; store: string; period: unknown; target: unknown; achieved: unknown }
export interface StoreRef { id: string; code: string | null; name: string; email?: string | null }
export interface TargetChange { store_id: string; period: string; target?: number | null; achieved?: number | null }

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The period a typed cell means, among the scheme's: its key, its label, "Oct 2026", "10/2026", "2026-10". */
export function readPeriod(v: unknown, periods: Period[]): string | null {
    if (periods.length === 1 && periods[0].key === 'all') return 'all';
    const t = String(v ?? '').trim();
    if (!t) return null;
    const hit = periods.find(p => norm(p.key) === norm(t) || norm(p.label) === norm(t));
    if (hit) return hit.key;
    let m = t.match(/^(\d{4})[-/.](\d{1,2})/) ?? null;
    let key: string | null = m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
    if (!key) { m = t.match(/^(\d{1,2})[-/.](\d{4})$/); if (m) key = `${m[2]}-${m[1].padStart(2, '0')}`; }
    if (!key) {
        m = t.match(/^([a-z]{3})[a-z]*[\s\-']*(\d{2,4})$/i);
        const mi = m ? MONTHS.findIndex(x => x.toLowerCase() === m![1].toLowerCase()) : -1;
        if (m && mi >= 0) key = `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${String(mi + 1).padStart(2, '0')}`;
    }
    if (!key) return null;
    return periods.find(p => p.key === key)?.key ?? periods.find(p => p.key.startsWith('Q') && p.key.slice(1) === key)?.key ?? null;
}

/**
 * Rows from a sheet as changes: each row names a store (its code, email or
 * exact name), a period, and a target and/or achieved figure. A blank cell
 * changes nothing. Problems are per row, so the admin sees what to fix.
 */
export function planTargetImport(rows: TargetImportRow[], stores: StoreRef[], periods: Period[]) {
    const byKey = new Map<string, StoreRef>();
    for (const s of stores) {
        if (s.code) byKey.set(norm(s.code), s);
        if (s.email) byKey.set(norm(s.email), s);
    }
    const byName = new Map<string, StoreRef[]>();
    for (const s of stores) byName.set(norm(s.name), [...(byName.get(norm(s.name)) ?? []), s]);

    const changes: TargetChange[] = [];
    const problems: { row: number; problem: string }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
        const typed = norm(r.store);
        if (!typed) { problems.push({ row: r.row, problem: 'No store' }); continue; }
        const named = byName.get(typed) ?? [];
        const store = byKey.get(typed) ?? (named.length === 1 ? named[0] : null);
        if (!store) { problems.push({ row: r.row, problem: named.length > 1 ? `"${r.store}" matches ${named.length} stores — use the store code` : `No store "${r.store}"` }); continue; }
        const period = readPeriod(r.period, periods);
        if (!period) { problems.push({ row: r.row, problem: `"${String(r.period ?? '')}" is not a period of this scheme` }); continue; }
        const target = num(r.target), achieved = num(r.achieved);
        if ((r.target !== '' && r.target != null && target === null) || (target !== null && target < 0)) { problems.push({ row: r.row, problem: 'Target is not a number' }); continue; }
        if ((r.achieved !== '' && r.achieved != null && achieved === null) || (achieved !== null && achieved < 0)) { problems.push({ row: r.row, problem: 'Achieved is not a number' }); continue; }
        if (target === null && achieved === null) { problems.push({ row: r.row, problem: 'No target or achieved figure' }); continue; }
        const k = `${store.id}|${period}`;
        if (seen.has(k)) { problems.push({ row: r.row, problem: `${store.name} appears twice for the same period` }); continue; }
        seen.add(k);
        changes.push({ store_id: store.id, period, ...(target !== null ? { target } : {}), ...(achieved !== null ? { achieved } : {}) });
    }
    return { changes, problems };
}
