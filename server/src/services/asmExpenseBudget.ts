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
 * The rules (owner's decisions, 26-27 Oct 2026):
 *  - Local is a fixed allowance, not claimed: each month's amount is deducted
 *    in full on the 1st. Months still to come are the only local left. Local
 *    claims filed before this changed are not counted.
 *  - Tours are claimed. A claim counts once head office approves it, at the
 *    approved amount; submitted ones are shown apart as "awaiting approval".
 *    It belongs to the quarter of its start date, not the day it was filed.
 *  - Going over the tour pool is allowed — the ASM is warned and HR decides.
 *    It never eats into local. When the quarter ends, unused tour money lapses.
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

export interface LocalMonth {
    key: string;
    label: string;
    state: 'past' | 'current' | 'future';
    allocated: number;
    /** Deducted on the 1st: true for this month and those before it. */
    deducted: boolean;
}

export interface BudgetSummary {
    quarter: Quarter;
    /** False when head office hasn't set this quarter's budget. */
    set: boolean;
    total: number;
    local_monthly: number;
    local_quarter: number;
    tour: Pool;
    months: LocalMonth[];
    /** Local deducted so far: the months that have started. */
    local_deducted: number;
    /** Local still to come: the months that haven't. */
    local_upcoming: number;
    /** Deducted local plus approved tours. */
    used: number;
    /** Tour claims awaiting approval. */
    pending: number;
    /** Tour money left unused when the quarter ended. */
    lapsed: number;
    /** Still to come: tours left + local for the months not yet started. */
    remaining: number;
    /** Approved tours beyond the tour pool. */
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

    const months: LocalMonth[] = quarter.months.map(m => {
        const state = m.key < thisMonth ? 'past' : m.key === thisMonth ? 'current' : 'future';
        return { key: m.key, label: m.label, state, allocated: exact(localMonthly), deducted: state !== 'future' };
    });
    const localDeducted = exact(months.filter(m => m.deducted).length * localMonthly);
    const localUpcoming = exact(months.filter(m => !m.deducted).length * localMonthly);

    const tours = inQuarter.filter(c => c.type === 'tour');
    const tour = pool(total - localMonthly * 3,
        tours.reduce((t, c) => t + usedBy(c), 0),
        tours.reduce((t, c) => t + pendingBy(c), 0));

    const ended = quarter.end < today;
    return {
        quarter,
        set: !!budget,
        total: exact(total),
        local_monthly: exact(localMonthly),
        local_quarter: exact(localMonthly * 3),
        tour,
        months,
        local_deducted: localDeducted,
        local_upcoming: localUpcoming,
        used: exact(localDeducted + tour.used),
        pending: tour.pending,
        lapsed: ended ? tour.left : 0,
        remaining: ended ? 0 : exact(tour.left + localUpcoming),
        over: tour.over,
    };
}

export interface ClaimBudgetPosition {
    pool: 'tour';
    /** "Q3 26-27 tours" */
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
 * For HR reviewing a tour claim: the quarter's tour pool, what the ASM's other
 * approved tours have used, and whether this one takes it over. Null when no
 * budget is set for that quarter, and for a local claim — local is a fixed
 * allowance, so a local claim draws on no pool.
 */
export function claimBudgetPosition(
    budget: BudgetInput | null,
    claims: BudgetClaim[],
    claim: BudgetClaim & { id: string },
): ClaimBudgetPosition | null {
    if (!budget || claim.type !== 'tour') return null;
    const quarter = quarterOf(claim.start_date);
    const inPool = (c: BudgetClaim) => c.type === 'tour' && c.start_date >= quarter.start && c.start_date <= quarter.end;
    const others = claims.filter(c => c.id !== claim.id && inPool(c)).reduce((t, c) => t + usedBy(c), 0);
    const allocated = budget.total - budget.local_monthly * 3;
    const mine = claim.status === 'submitted' ? Number(claim.total_amount) : usedBy(claim);
    return {
        pool: 'tour',
        label: `${quarter.label} tours`,
        allocated: exact(allocated),
        used_by_others: exact(others),
        this_claim: exact(mine),
        over: exact(Math.max(0, others + mine - allocated)),
    };
}
