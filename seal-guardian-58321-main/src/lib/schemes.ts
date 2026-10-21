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
    brand?: "AF" | "AC" | null;
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
    status: "draft" | "published" | "ended";
    state: SchemeState;
}

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
