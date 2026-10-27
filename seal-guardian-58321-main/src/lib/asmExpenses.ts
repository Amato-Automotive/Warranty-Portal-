/** Shared by the ASM portal and the admin view of ASM expense claims. */

export interface ExpenseItem {
    id: string;
    kind: "trip" | "onward" | "return" | "hotel" | "other";
    from_place: string | null;
    to_place: string | null;
    description: string | null;
    amount: number;
    approved_amount: number | null;
    attachment_url: string | null;
}

export interface ExpenseClaim {
    id: string;
    claim_number: string;
    type: "local" | "tour";
    status: string;
    start_date: string;
    end_date: string;
    from_place: string | null;
    to_place: string | null;
    travel_mode: string | null;
    tickets_by: string | null;
    one_way: boolean;
    hotel_stay: boolean;
    hotel_nights: number | null;
    hotel_persons: number | null;
    total_amount: number;
    approved_amount: number | null;
    remarks: string | null;
    review_note: string | null;
    reviewed_by_name: string | null;
    reviewed_at: string | null;
    paid_on?: string | null;
    payment_ref?: string | null;
    paid_by_name?: string | null;
    paid_at?: string | null;
    asm_name?: string | null;
    asm_phone?: string | null;
    created_at: string;
    items: ExpenseItem[];
    /** Head office's list only: the pool this claim draws on. Null when no budget is set. */
    budget?: ClaimBudgetPosition | null;
}

// ── Quarterly budgets (server: services/asmExpenseBudget.ts) ─────────────────

export interface BudgetPool {
    allocated: number;
    used: number;
    pending: number;
    left: number;
    over: number;
}

/** Local is a fixed allowance: each month's amount comes off on the 1st. */
export interface BudgetMonth {
    key: string;
    label: string;
    state: "past" | "current" | "future";
    allocated: number;
    deducted: boolean;
}

export interface BudgetQuarter {
    key: string;
    label: string;
    span: string;
    start: string;
    end: string;
}

export interface BudgetSummary {
    quarter: BudgetQuarter;
    set: boolean;
    total: number;
    local_monthly: number;
    local_quarter: number;
    tour: BudgetPool;
    months: BudgetMonth[];
    local_deducted: number;
    local_upcoming: number;
    used: number;
    pending: number;
    lapsed: number;
    remaining: number;
    over: number;
}

export interface ClaimBudgetPosition {
    pool: "tour";
    label: string;
    allocated: number;
    used_by_others: number;
    this_claim: number;
    over: number;
}

/**
 * How far a new tour claim would take the tour pool over, counting what is
 * already approved and awaiting approval — 0 if it fits, null if the budget
 * doesn't cover that date. Over is allowed; the ASM is only told.
 */
export function budgetOverspend(budget: BudgetSummary | null, date: string, amount: number) {
    if (!budget?.set || date < budget.quarter.start || date > budget.quarter.end) return null;
    const pool = budget.tour;
    return Math.max(0, Math.round((pool.used + pool.pending + amount - pool.allocated) * 100) / 100);
}

export const EXPENSE_STATUS: Record<string, { label: string; tone: string }> = {
    submitted: { label: "Submitted", tone: "bg-blue-50 text-blue-700 border-blue-200" },
    approved: { label: "Approved", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    partially_approved: { label: "Partly approved", tone: "bg-amber-50 text-amber-700 border-amber-200" },
    rejected: { label: "Rejected", tone: "bg-rose-50 text-rose-700 border-rose-200" },
    paid: { label: "Paid", tone: "bg-slate-800 text-white border-slate-800" },
};

/** Head office has decided it — approved, partly approved or rejected (or since paid). */
export const isDecided = (status: string) => ['approved', 'partially_approved', 'rejected', 'paid'].includes(status);

/** Less was approved than claimed (and the claim was not simply rejected). */
export const isCut = (c: Pick<ExpenseClaim, "status" | "approved_amount" | "total_amount">) =>
    c.status !== "rejected" && c.approved_amount !== null && c.approved_amount < c.total_amount;

export const MODE_LABEL: Record<string, string> = {
    train: "Train", bus: "Bus", flight: "Flight", cab: "Cab", own_vehicle: "Own vehicle",
};

export const rupees = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const formatDay = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export const claimDates = (c: Pick<ExpenseClaim, "start_date" | "end_date">) =>
    c.start_date === c.end_date ? formatDay(c.start_date) : `${formatDay(c.start_date)} – ${formatDay(c.end_date)}`;
