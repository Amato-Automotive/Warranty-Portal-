/**
 * Offers & Schemes: the shapes and labels the admin and franchise screens
 * share. The rules themselves live on the server (services/schemeRules.ts).
 */

export type SchemeCategory = "sales" | "display" | "contest" | "offer";
export type FieldType = "number" | "text" | "date" | "select" | "file" | "distributor";
export type FileFormat = "image" | "pdf" | "video" | "excel";
export type SchemeState = "draft" | "upcoming" | "live" | "closed";

export interface SchemeField {
    id: string;
    label: string;
    type: FieldType;
    required: boolean;
    options?: string[];
    formats?: FileFormat[];
    max_files?: number;
    max_mb?: number;
}

export type ScoreRule =
    | { mode: "sum"; field_id: string }
    | { mode: "count" }
    | { mode: "points" }
    | { mode: "products"; products: ProductPoints[] }
    | { mode: "none" };

/** A club a store reaches by its score, e.g. Silver from 180. Icon and colour are names from ClubBadge. */
export interface Club { id: string; name: string; min: number; icon: string; color: string; reward?: string }

/** A product the admin scores, and what one unit of it is worth. */
export interface ProductPoints { id: string; name: string; points: number }
/** A product line the admin read off an approved entry. */
export interface EntryLine { product_id: string; name: string; points: number; qty: number; subtotal: number }
/** When a scheme takes entries: IST, "YYYY-MM-DDTHH:mm". */
export interface SchemeWindow { start: string; end: string }

export interface Slab { min: number; max: number | null; reward: string }
export interface RankPrize { from: number; to: number; reward: string }

export type RewardRule =
    | { mode: "none" }
    | { mode: "slabs"; slabs: Slab[] }
    | { mode: "per_unit"; amount: number; unit_label?: string }
    | { mode: "rank"; prizes: RankPrize[] }
    | { mode: "per_entry"; reward: string }
    | { mode: "clubs" };

export interface Eligibility {
    mode: "all" | "states" | "stores";
    states?: string[];
    store_ids?: string[];
    /** Only stores of this brand: AF only, AC only, or those with both (AFAC); none is every store. */
    brand?: "AF" | "AC" | "AFAC" | null;
}

export interface Scheme {
    id: string;
    title: string;
    category: SchemeCategory;
    summary: string | null;
    banner_url: string | null;
    instructions: string | null;
    terms: string | null;
    starts_on: string;
    ends_on: string;
    windows: SchemeWindow[];
    open_window: SchemeWindow | null;
    next_window: SchemeWindow | null;
    eligibility: Eligibility;
    fields: SchemeField[];
    entries_per_store: "one" | "many";
    score_rule: ScoreRule;
    rewards: RewardRule;
    leaderboard: { show: boolean; names: boolean };
    clubs: Club[];
    contact: SchemeContact | null;
    settings: SchemeSettings;
    status: "draft" | "published" | "ended";
    state: SchemeState;
}

/**
 * How a scheme runs (same as the server's services/schemeTargets.ts). "entries":
 * stores submit and the admin approves. "targets": the admin adds franchises,
 * sets each one's target per period and types what it achieved; reaching a
 * step (a share of the target) earns that step's benefit.
 */
export type RunMode = "entries" | "targets";
export type TargetPeriod = "whole" | "month" | "quarter" | "window";
export type BenefitKind = "per_unit" | "percent" | "fixed";
/** Where achievement comes from: typed by the admin, or counted from the store's approved warranties. */
export type TargetSource = "manual" | "warranties";
/** Approved warranties only, or every one registered (not rejected); dated by registration or by purchase. */
export type WarrantyCount = "approved" | "registered";
export type WarrantyDate = "registered" | "purchase";
export interface TargetStep { pct: number; amount?: number; reward?: string }
export interface TargetVisibility { target: boolean; achieved: boolean; percent: boolean; steps: boolean; to_next: boolean }
/** Counting in points (same as the server): each warranty is worth its series' points, times the store type's multiplier. */
export type Measure = "warranties" | "points";
export interface PointSeries { id: string; name: string; points: number; products: string[] }
export interface StoreTier { id: string; name: string; times: number }
export interface PointsRule { series: PointSeries[]; tiers: StoreTier[] }
export interface SchemeSettings {
    measure?: Measure; points?: PointsRule;
    run: RunMode; source: TargetSource; baseline_months: number; count: WarrantyCount; date_by: WarrantyDate; unit: string; period: TargetPeriod; benefit: BenefitKind; steps: TargetStep[]; show: TargetVisibility;
}
export const DEFAULT_SETTINGS: SchemeSettings = {
    measure: "warranties", points: { series: [], tiers: [] },
    run: "entries", source: "manual", baseline_months: 3, count: "approved", date_by: "registered", unit: "sets", period: "month", benefit: "per_unit", steps: [],
    show: { target: true, achieved: true, percent: true, steps: true, to_next: false },
};
export const PERIOD_LABEL: Record<TargetPeriod, string> = { whole: "Whole scheme", month: "Monthly", quarter: "Quarterly", window: "Each window" };
export const BENEFIT_LABEL: Record<BenefitKind, string> = {
    per_unit: "₹ off per unit (on every unit achieved)", percent: "% off the price", fixed: "A reward (written)",
};
/** "₹100 off / set", "5% off", or the reward, for one step. */
export function stepBenefit(s: TargetStep, benefit: BenefitKind, unit: string): string {
    if (benefit === "per_unit") return s.amount ? `₹${s.amount.toLocaleString("en-IN")} off / ${unit.replace(/s$/, "")}` : "—";
    if (benefit === "percent") return s.amount ? `${s.amount}% off` : "—";
    return s.reward || "—";
}
/** Where a franchise stands for one period (the server's targetResult). */
export interface TargetResult {
    pct: number | null; step: TargetStep | null; step_no: number | null;
    benefit: string | null; benefit_rupees: number | null; next: TargetStep | null; to_next: number | null;
}
export interface TargetHistory { at: string; by: string | null; field: "target" | "achieved" | "paid"; from: number | string | null; to: number | string | null; reason: string | null }
export interface TargetFigures { target: number | null; achieved: number | null; pending: number | null; paid_at: string | null; updated_at: string; history: TargetHistory[]; result: TargetResult }
export interface TargetStore {
    store_id: string; store_name: string; city: string | null; state: string | null;
    own_steps: TargetStep[] | null; note: string | null; joined_at: string;
    /* Counted from warranties: the growth over its average and its reward; the store never sees the growth. */
    growth_pct: number | null; reward: string | null; stats: WarrantyStats | null;
    /* The average the growth was put on, and its value then. */
    basis: AverageBasis | null; basis_average: number | null;
    /* Counted in points: its store type, that type's multiplier, and the target typed for every period. */
    tier?: string | null; times?: number; target_points?: number | null;
    figures: Record<string, TargetFigures>;
}
export interface Period { key: string; label: string; months: string[]; from?: string; to?: string; days?: number }
/** A store's warranties per month before the scheme, and its average of approved ones. */
/** Which average the admin looks at: every warranty so far, the last 3 or 6 full months, or a range of days. */
export interface AverageBasis { mode: "overall" | "m3" | "m6" | "custom"; from?: string; to?: string }
export const BASIS_LABEL: Record<AverageBasis["mode"], string> = { overall: "Overall", m3: "Last 3 months", m6: "Last 6 months", custom: "Custom dates" };
export interface Averages { overall: number; m3: number; m6: number; custom: number | null }
/** A store's warranties: the last 12 months by status, and its average a month on each basis. */
export interface WarrantyStats { months: { month: string; approved: number; pending: number; rejected: number }[]; averages: Averages; first_day: string | null }
export const averageOn = (a: Averages | null | undefined, b: AverageBasis) => (a ? (b.mode === "custom" ? a.custom ?? 0 : a[b.mode]) : 0);
/** The target a growth makes (same as the server's growthTarget). */
export const growthTarget = (average: number, pct: number, months: number) => Math.ceil(average * months * (1 + pct / 100) - 1e-9);

/** Who stores ask about the scheme. */
export interface SchemeContact { name: string; role: string; phone: string; email: string }

export interface EntryFile { name: string; url: string; size: number; ext: string }

export const CATEGORY_LABEL: Record<SchemeCategory, string> = {
    sales: "Sales", display: "Display", contest: "Contest", offer: "Offer",
};

export const STATE_META: Record<SchemeState, { label: string; tone: string }> = {
    live: { label: "Live", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    upcoming: { label: "Upcoming", tone: "bg-sky-50 text-sky-700 border-sky-200" },
    draft: { label: "Draft", tone: "bg-slate-100 text-slate-600 border-slate-200" },
    closed: { label: "Closed", tone: "bg-slate-50 text-slate-500 border-slate-200" },
};

export const ENTRY_META: Record<string, { label: string; tone: string }> = {
    pending: { label: "Under review", tone: "bg-amber-50 text-amber-700 border-amber-200" },
    approved: { label: "Approved", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    rejected: { label: "Not approved", tone: "bg-rose-50 text-rose-700 border-rose-200" },
};

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
    number: "Number", text: "Text", date: "Date", select: "Dropdown", file: "File upload", distributor: "Distributor (store picks)",
};

export const FORMAT_LABEL: Record<FileFormat, string> = {
    image: "Photo (JPG, PNG)", pdf: "PDF", video: "Video", excel: "Excel / CSV",
};

/* What the file picker accepts for a field, so the store only sees allowed files. */
export const FORMAT_ACCEPT: Record<FileFormat, string> = {
    image: "image/*,.heic,.heif",
    pdf: "application/pdf,.pdf",
    video: "video/*",
    excel: ".xls,.xlsx,.csv",
};

export const formatDay = (d: string | null | undefined) =>
    d ? new Date(d.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/** "Score 18 · Slab ₹2,000" style line of what a store has achieved. */
export function rewardSummary(r: RewardRule): string {
    switch (r.mode) {
        case "slabs": return r.slabs.map(s => `${s.min}${s.max === null ? "+" : `–${s.max}`} → ${s.reward}`).join(" · ");
        case "per_unit": return `₹${r.amount} per ${r.unit_label || "unit"}`;
        case "rank": return r.prizes.map(p => `${p.from === p.to ? `#${p.from}` : `#${p.from}–${p.to}`} → ${p.reward}`).join(" · ");
        case "per_entry": return `${r.reward} per approved entry`;
        case "clubs": return "Reward by club";
        default: return "";
    }
}

/** "5 Oct, 10:00 am" from "2026-10-05T10:00". */
export function formatStamp(stamp: string): string {
    const [d, t = "00:00"] = stamp.split("T");
    const date = new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
    const [h, m] = t.split(":").map(Number);
    return `${date}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "5 Oct, 10:00 am → 7 Oct, 6:00 pm" */
export const formatWindow = (w: SchemeWindow) => `${formatStamp(w.start)} → ${formatStamp(w.end)}`;

/** The same window a month later (same as the server's nextMonth). A day past a short month's end clamps to its last day. */
export function nextMonthWindow(w: SchemeWindow): SchemeWindow {
    const shift = (stamp: string) => {
        const [d, t] = stamp.split("T");
        const [y, m, day] = d.split("-").map(Number);
        const ny = m === 12 ? y + 1 : y;
        const nm = m === 12 ? 1 : m + 1;
        const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
        return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}T${t}`;
    };
    return { start: shift(w.start), end: shift(w.end) };
}

/** "Oct 2026" from "2026-10". */
export const formatMonth = (m: string) =>
    new Date(m + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
