/**
 * An ASM's expense budget for a quarter, and how much of it is left.
 *
 * Pure — no database — so it is tested directly; the controller loads the
 * budget and the claims and hands them here.
 *
 * Head office sets two numbers per ASM per quarter: the total, and a fixed
 * amount a month for local conveyance. Local for the quarter is three times
 * that, and the rest of the total is for outstation tours:
 *
 *   total ₹90,000, local ₹8,000/month → local ₹24,000, tours ₹66,000
 *
 * The rules (owner's decisions, 26 Oct 2026):
 *  - A claim counts once head office approves it, at the approved amount.
 *    Submitted claims are shown apart, as "awaiting approval".
 *  - Local is a cap per month. What a month leaves unspent lapses when the
 *    month ends; it does not roll into the next month or into tours. So the
 *    quarter's remaining budget comes down month by month even if unspent.
 *  - The pools are separate: going over on local does not eat into tours, or
 *    the other way. Going over is allowed — the ASM is warned and HR decides.
 *  - A claim belongs to the month (and quarter) of its travel date — the
 *    start date for a tour — not the day it was filed or approved.
 *
 * Quarters are the Indian financial year's: Q1 Apr–Jun, Q2 Jul–Sep,
 * Q3 Oct–Dec, Q4 Jan–Mar. FY 2026-27 starts April 2026, so "Q3 26-27" is
 * Oct–Dec 2026 and "Q4 26-27" is Jan–Mar 2027. A quarter's key is the FY's
 * first year and the quarter: "2026-Q3".
 */

export class BudgetRuleError extends Error {}
const fail = (msg: string): never => { throw new BudgetRuleError(msg); };

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_BUDGET = 10_000_000;

export interface QuarterMonth {
    /** YYYY-MM */
    key: string;
    label: string;
}

export interface Quarter {
    key: string;
    fy: number;
    q: 1 | 2 | 3 | 4;
    /** "Q3 26-27" */
    label: string;
    /** "Oct – Dec 2026" */
    span: string;
    start: string;
    end: string;
    months: QuarterMonth[];
}

const pad = (n: number) => String(n).padStart(2, '0');

function build(fy: number, q: 1 | 2 | 3 | 4): Quarter {
    // Q1 starts in April of the FY's first year; Q4 is January–March of the next.
    const firstMonth = ((q - 1) * 3 + 3) % 12; // 0-based: Apr=3, Jul=6, Oct=9, Jan=0
    const year = q === 4 ? fy + 1 : fy;
    const months = [0, 1, 2].map(i => ({
        key: `${year}-${pad(firstMonth + i + 1)}`,
        label: MONTH_NAMES[firstMonth + i],
    }));
    const lastDay = new Date(Date.UTC(year, firstMonth + 3, 0)).getUTCDate();
    return {
        key: `${fy}-Q${q}`,
        fy,
        q,
        label: `Q${q} ${String(fy % 100).padStart(2, '0')}-${String((fy + 1) % 100).padStart(2, '0')}`,
        span: `${months[0].label} – ${months[2].label} ${year}`,
        start: `${months[0].key}-01`,
        end: `${months[2].key}-${pad(lastDay)}`,
        months,
    };
}

/** The quarter a date (YYYY-MM-DD) falls in. */
export function quarterOf(iso: string): Quarter {
    const [y, m] = iso.split('-').map(Number);
    if (!y || !m) fail('Not a date');
    const fy = m >= 4 ? y : y - 1;
    const q = (m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4) as 1 | 2 | 3 | 4;
    return build(fy, q);
}

/** "2026-Q3" → the quarter, or null if it isn't one. */
export function parseQuarter(key: unknown): Quarter | null {
    const m = /^(\d{4})-Q([1-4])$/.exec(String(key ?? ''));
    if (!m) return null;
    const fy = Number(m[1]);
    if (fy < 2020 || fy > 2100) return null;
    return build(fy, Number(m[2]) as 1 | 2 | 3 | 4);
}

/** The quarter `n` quarters after this one (before, if negative). */
export function shiftQuarter(quarter: Quarter, n: number): Quarter {
    const index = quarter.fy * 4 + (quarter.q - 1) + n;
    return build(Math.floor(index / 4), ((index % 4) + 1) as 1 | 2 | 3 | 4);
}

export interface BudgetInput {
    total: number;
    local_monthly: number;
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const paise = (n: number) => Math.round(n * 100);
const exact = (n: number) => paise(n) / 100;

function amount(v: unknown, label: string, allowZero: boolean): number {
    const s = String(v ?? '').trim().replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) fail(`${label}: enter an amount in rupees`);
    const n = Number(s);
    if (!allowZero && n <= 0) fail(`${label} must be more than ₹0`);
    if (n > MAX_BUDGET) fail(`${label} is over ${rupees(MAX_BUDGET)} — please check it`);
    return n;
}

/** Head office setting a budget. Local for three months must fit in the total. */
export function validateBudget(input: any): BudgetInput {
    const total = amount(input?.total, 'Total budget', false);
    const local = amount(input?.local_monthly, 'Local conveyance per month', true);
    if (paise(local) * 3 > paise(total)) {
        fail(`Local for the quarter (3 × ${rupees(local)} = ${rupees(exact(local * 3))}) is more than the total of ${rupees(total)}`);
    }
    return { total, local_monthly: local };
}

/** What the summary needs from a claim. */
export interface BudgetClaim {
    id?: string;
    type: 'local' | 'tour';
    status: string;
    /** Travel date (a tour's start), YYYY-MM-DD. */
    start_date: string;
    total_amount: number;
    approved_amount: number | null;
}

const COUNTED = ['approved', 'partially_approved', 'paid'];

/** What a claim takes from the budget: the approved amount, once approved. */
export const usedBy = (c: BudgetClaim) => COUNTED.includes(c.status) ? Number(c.approved_amount ?? 0) : 0;
/** What it may take: the amount claimed, while it waits. */
export const pendingBy = (c: BudgetClaim) => c.status === 'submitted' ? Number(c.total_amount) : 0;

export interface Pool {
    allocated: number;
    /** Approved. */
    used: number;
    /** Submitted, not yet decided. */
    pending: number;
    /** allocated − used, never below 0. */
    left: number;
    /** used beyond allocated. */
    over: number;
}

export interface MonthPool extends Pool {
    key: string;
    label: string;
    state: 'past' | 'current' | 'future';
    /** For a past month: what it left unspent, now gone. */
    lapsed: number;
}

export interface BudgetSummary {
    quarter: Quarter;
    /** False when head office hasn't set this quarter's budget. */
    set: boolean;
    total: number;
    local_monthly: number;
    local_quarter: number;
    tour: Pool;
    months: MonthPool[];
    /** Approved across both pools. */
    used: number;
    pending: number;
    /** Local that past months left unspent, and tours' too once the quarter is over. */
    lapsed: number;
    /** Still available to spend: tours left + this month's local left + months to come. */
    remaining: number;
    /** Approved beyond a pool's allocation, both pools together. */
    over: number;
}

function pool(allocated: number, used: number, pending: number): Pool {
    return {
        allocated: exact(allocated),
        used: exact(used),
        pending: exact(pending),
        left: exact(Math.max(0, allocated - used)),
        over: exact(Math.max(0, used - allocated)),
    };
}

/**
 * Where an ASM stands for a quarter. `claims` may hold any of theirs; only the
 * quarter's are counted. `today` is the IST date and decides which months have
 * ended.
 */
export function summariseBudget(
    budget: BudgetInput | null,
    claims: BudgetClaim[],
    quarter: Quarter,
    today: string,
): BudgetSummary {
    const total = budget?.total ?? 0;
    const localMonthly = budget?.local_monthly ?? 0;
    const thisMonth = today.slice(0, 7);
    const inQuarter = claims.filter(c => c.start_date >= quarter.start && c.start_date <= quarter.end);

    const months: MonthPool[] = quarter.months.map(m => {
        const own = inQuarter.filter(c => c.type === 'local' && c.start_date.startsWith(m.key));
        const p = pool(localMonthly,
            own.reduce((t, c) => t + usedBy(c), 0),
            own.reduce((t, c) => t + pendingBy(c), 0));
        const state = m.key < thisMonth ? 'past' : m.key === thisMonth ? 'current' : 'future';
        return { ...p, key: m.key, label: m.label, state, lapsed: state === 'past' ? p.left : 0 };
    });

    const tours = inQuarter.filter(c => c.type === 'tour');
    const tour = pool(total - localMonthly * 3,
        tours.reduce((t, c) => t + usedBy(c), 0),
        tours.reduce((t, c) => t + pendingBy(c), 0));

    const ended = quarter.end < today;
    const sum = (f: (p: Pool) => number) => exact(f(tour) + months.reduce((t, m) => t + f(m), 0));

    return {
        quarter,
        set: !!budget,
        total: exact(total),
        local_monthly: exact(localMonthly),
        local_quarter: exact(localMonthly * 3),
        tour,
        months,
        used: sum(p => p.used),
        pending: sum(p => p.pending),
        // Once the quarter is over, what tours left lapses with it.
        lapsed: exact(months.reduce((t, m) => t + m.lapsed, 0) + (ended ? tour.left : 0)),
        remaining: ended ? 0 : exact(tour.left + months.filter(m => m.state !== 'past').reduce((t, m) => t + m.left, 0)),
        over: sum(p => p.over),
    };
}

export interface ClaimBudgetPosition {
    pool: 'local' | 'tour';
    /** "Oct local" or "Q3 26-27 tours" */
    label: string;
    allocated: number;
    /** Approved on the pool's other claims. */
    used_by_others: number;
    /** This claim: approved amount if decided, else the amount claimed. */
    this_claim: number;
    /** How far the pool goes over with this claim in it (0 if it fits). */
    over: number;
}

/**
 * For HR reviewing a claim: the pool it draws on, what the ASM's other
 * approved claims have used, and whether this one takes it over. Null when no
 * budget is set for that quarter.
 */
export function claimBudgetPosition(
    budget: BudgetInput | null,
    claims: BudgetClaim[],
    claim: BudgetClaim & { id: string },
): ClaimBudgetPosition | null {
    if (!budget) return null;
    const quarter = quarterOf(claim.start_date);
    const month = claim.start_date.slice(0, 7);
    const samePool = (c: BudgetClaim) => claim.type === 'local'
        ? c.type === 'local' && c.start_date.startsWith(month)
        : c.type === 'tour' && c.start_date >= quarter.start && c.start_date <= quarter.end;
    const others = claims.filter(c => c.id !== claim.id && samePool(c)).reduce((t, c) => t + usedBy(c), 0);
    const allocated = claim.type === 'local' ? budget.local_monthly : budget.total - budget.local_monthly * 3;
    const mine = claim.status === 'submitted' ? Number(claim.total_amount) : usedBy(claim);
    const monthLabel = quarter.months.find(m => m.key === month)?.label ?? month;
    return {
        pool: claim.type,
        label: claim.type === 'local' ? `${monthLabel} local` : `${quarter.label} tours`,
        allocated: exact(allocated),
        used_by_others: exact(others),
        this_claim: exact(mine),
        over: exact(Math.max(0, others + mine - allocated)),
    };
}
