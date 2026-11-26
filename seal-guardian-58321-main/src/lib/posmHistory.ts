/** POSM dispatch history, as the server sends it (see server/src/services/posmHistory.ts). */

export type Approval = "within" | "reached" | "over" | "new_open" | "new_used";
export type LimitState = "ok" | "pending_over" | "reached" | "over";
export type LineFlag = "possible_duplicate" | "qty_not_written" | "check_match" | "sent_to_asm";

export interface LimitedItem { sent: number; pending: number; limit: number | null; left: number | null; state: LimitState }
export interface StoreSettings { store_type: "old" | "new"; type_assumed: boolean; frp_limit: number; jacket_limit: number }
export interface StoreSummary {
    sent: Record<string, number>; frp: LimitedItem; jacket: LimitedItem; approval: Approval; needs_approval: boolean; lines: number; last_dispatch: string | null;
}

export interface HistoryStoreRow {
    key: string; linked: boolean; distributor: string | null; asm: string | null; courier: string | null; sent_from: string[]; by_status: Record<string, number>; sent_to_asm: boolean;
    store_id: string | null; store_code: string | null; store_name: string; city: string | null; state: string | null; brand: string | null;
    settings: StoreSettings; summary: StoreSummary; approval_label: string; flagged: number;
}
export interface HistoryTotals {
    stores: number; unlinked_stores: number; lines: number; unlinked: number; within: number; reached: number; over: number; new_open: number; new_used: number; pending_over: number; flagged: number;
}

export interface HistoryLine {
    id: string; source: string; store_id: string | null; store_code: string | null; sheet_store_name: string | null;
    city: string | null; state: string | null; distributor: string | null; asm: string | null;
    item: string; design: string | null; major_colour: string | null; minor_colour: string | null; brand: string | null; store_kind: string | null;
    qty: number; status: string;
    request_date: string | null; dispatch_date: string | null; delivery_date: string | null; expected_dispatch: string | null; status_changed_on: string | null;
    courier: string | null; docket_no: string | null; dispatched_by: string | null; reason: string | null; remarks: string | null; address?: string | null; match_note: string | null;
    flags: LineFlag[];
    portal_store_name?: string | null;
}

export interface UnlinkedGroup {
    key: string; store_code: string | null; sheet_store_name: string | null; sources: string[]; distributor: string | null; city: string | null; state: string | null;
    sent_to_asm: boolean; lines: HistoryLine[];
}

/** The items in the order the sheet's Stores tab has them. */
export const POSM_ITEMS = [
    "FRP", "Sample Jacket", "Visiting Card", "Franchise Certificate", "T-Shirt", "Swatch / Shade Book", "Dr. Marq Stand", "ACP Board",
    "QR Code Sticker / Sun", "Push & Pull Sticker", "Petrol/Diesel Sticker", "Demo Sticker", "Wobbler / Dangler", "Notepad & Pen", "Brochure", "Calendar",
] as const;

export const POSM_STATUSES = ["Not updated", "In production", "Ready to dispatch", "On hold", "Out of stock", "Dispatched", "In Transit", "Delivered", "Return"] as const;
export const SENT_STATUSES = new Set(["Dispatched", "In Transit", "Delivered"]);

export const FLAG_LABEL: Record<LineFlag, string> = {
    possible_duplicate: "Possible duplicate",
    qty_not_written: "Qty not written",
    check_match: "Check the store",
    sent_to_asm: "Sent to ASM",
};

export const APPROVAL_TONE: Record<Approval, string> = {
    within: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    reached: "bg-amber-50 text-amber-800 ring-amber-200",
    over: "bg-rose-50 text-rose-700 ring-rose-200",
    new_open: "bg-sky-50 text-sky-700 ring-sky-200",
    new_used: "bg-violet-50 text-violet-700 ring-violet-200",
};
export const APPROVAL_SHORT: Record<Approval, string> = {
    within: "Within limit", reached: "Limit reached", over: "Over limit", new_open: "New: one-time open", new_used: "New: one-time used",
};

export const STATUS_TONE = (s: string) =>
    SENT_STATUSES.has(s) ? "bg-emerald-50 text-emerald-700" : s === "Return" ? "bg-slate-100 text-slate-600" : s === "On hold" || s === "Out of stock" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800";

/** "U FOCUS · Black / White" */
export const designLine = (l: Pick<HistoryLine, "design" | "major_colour" | "minor_colour">) =>
    [l.design, [l.major_colour, l.minor_colour].filter(Boolean).join(" / ")].filter(Boolean).join(" · ");

export const shortDate = (d: string | null) =>
    d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
