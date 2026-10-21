/**
 * POSM items as the server's posmCatalog defines them: items the admin
 * builds (fields, limits, picture), and the lines of a request. The server
 * checks every request again, so nothing here is trusted.
 */

export type Brand = "AF" | "AC";
export const BRAND_LABEL: Record<Brand, string> = { AF: "Autoform", AC: "Autocruze" };

export type FieldType = "text" | "textarea" | "number" | "select" | "chips" | "brand" | "sizes" | "files" | "table";

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
    text: "Short text", textarea: "Long text / remarks", number: "Number", select: "Dropdown",
    chips: "Pick one / several", brand: "Brand (store's own)", sizes: "Sizes with quantity",
    files: "Photo / file upload", table: "Design table (auto-fill)",
};

export interface TableRow { brand?: Brand | null; cells: string[] }

export interface PosmField {
    id: string;
    label: string;
    type: FieldType;
    required: boolean;
    help?: string;
    options?: string[];
    multiple?: boolean;
    max_files?: number;
    columns?: string[];
    brand_split?: boolean;
    rows?: TableRow[];
}

export type QtyMode = "number" | "sizes" | "one";
export const QTY_MODE_LABEL: Record<QtyMode, string> = { number: "Number (− / +)", sizes: "Sum of sizes", one: "Always 1" };

export interface PosmLimits { min?: number | null; max_request?: number | null; max_month?: number | null; max_year?: number | null }

export interface PosmItem {
    id: string;
    name: string;
    description?: string;
    clipart?: string | null;
    image?: string | null;
    enabled: boolean;
    qty_mode: QtyMode;
    limits: PosmLimits;
    fields: PosmField[];
}

export interface PosmCatalog { items: PosmItem[] }

export type Usage = Record<string, { month: number; year: number }>;

export interface PosmLine {
    item_id: string;
    item_name: string;
    qty: number;
    values: Record<string, any>;
    display: { label: string; value: string }[];
    files?: string[];
    approved_qty?: number | null;
    line_status?: "pending" | "approved" | "rejected";
}

/** The limits of an item, in words, for its card. */
export function limitText(l: PosmLimits): string {
    const parts: string[] = [];
    if (l.max_request != null) parts.push(`max ${l.max_request} per request`);
    if (l.max_month != null) parts.push(`${l.max_month} a month`);
    if (l.max_year != null) parts.push(`${l.max_year} a year`);
    if (l.min != null && l.min > 1) parts.push(`min ${l.min}`);
    const s = parts.join(" · ");
    return s ? s[0].toUpperCase() + s.slice(1) : "";
}

/** How many more of an item this store can ask for now, or null when no limit applies. */
export function remaining(item: PosmItem, used?: { month: number; year: number }): number | null {
    const u = used ?? { month: 0, year: 0 };
    const caps = [
        item.limits.max_request,
        item.limits.max_month != null ? item.limits.max_month - u.month : null,
        item.limits.max_year != null ? item.limits.max_year - u.year : null,
    ].filter((x): x is number => x != null);
    return caps.length ? Math.max(0, Math.min(...caps)) : null;
}

/** The rows of a design table the store may pick from, given the brand picked. */
export const tableRows = (f: PosmField, brand: Brand | null) =>
    (f.rows ?? []).filter(r => !f.brand_split || r.brand === brand);

/** A line in words: what the store entered, without the empty parts. */
export const lineText = (l: PosmLine) => (l.display ?? []).map(d => `${d.label}: ${d.value}`).join(" · ");

/* The steps a request goes through, as the store reads them. */
export const PROGRESS = [
    { status: "open", label: "Sent" },
    { status: "approved", label: "Approved" },
    { status: "in_production", label: "In production" },
    { status: "dispatched", label: "Dispatched" },
    { status: "delivered", label: "Delivered" },
] as const;

export const STATUS_LABEL: Record<string, string> = {
    open: "Sent", under_review: "Under review", approved: "Approved", in_production: "In production",
    pending: "On hold", dispatched: "Dispatched", delivered: "Delivered", closed: "Closed", rejected: "Rejected",
};

/** How far along a request is, 0–1, for the progress bar on the list. */
export function progressOf(status: string): number {
    if (status === "delivered" || status === "closed") return 1;
    const i = PROGRESS.findIndex(p => p.status === status);
    return i < 0 ? 0.1 : (i + 1) / PROGRESS.length;
}

export const isDone = (status: string) => ["delivered", "closed", "rejected"].includes(status);

/**
 * A change to one line's decision, keeping the quantity and the decision in
 * step: 0 is Not approved, a quantity above 0 is Approved; Reject sets 0 and
 * Approve keeps the quantity (the asked one if it was 0).
 */
export function decideLine(l: PosmLine, p: Partial<Pick<PosmLine, "approved_qty" | "line_status">>): PosmLine {
    if (p.line_status === "rejected") return { ...l, line_status: "rejected", approved_qty: 0 };
    if (p.line_status === "approved") return { ...l, line_status: "approved", approved_qty: l.approved_qty && l.approved_qty > 0 ? l.approved_qty : l.qty };
    if (p.line_status === "pending") return { ...l, line_status: "pending", approved_qty: null };
    if (p.approved_qty !== undefined) {
        const q = p.approved_qty;
        if (q === null) return { ...l, approved_qty: null };
        return { ...l, approved_qty: q, line_status: q === 0 ? "rejected" : "approved" };
    }
    return l;
}

/* ---------- the admin's steps (the server's posmFlow decides; this mirrors it for the buttons) ---------- */

export type PosmAction = "approve" | "hold" | "reject" | "start" | "dispatch" | "resume" | "deliver" | "close" | "reopen";

export const ACTIONS_AT: Record<string, PosmAction[]> = {
    open: ["approve", "hold", "reject"], under_review: ["approve", "hold", "reject"],
    approved: ["start", "dispatch", "hold"], in_production: ["dispatch", "hold"],
    pending: ["resume", "reject"], dispatched: ["deliver"], delivered: ["close"],
    rejected: ["reopen"], closed: ["reopen"],
};

export const ACTION_LABEL: Record<PosmAction, string> = {
    approve: "Approve", hold: "Put on hold", reject: "Reject…", start: "Start production", dispatch: "Dispatch…",
    resume: "Resume", deliver: "Mark delivered", close: "Close", reopen: "Reopen",
};

export interface HistoryEntry {
    action: PosmAction | "sent" | "received" | "update";
    status: string;
    at: string;
    by_role: "admin" | "franchise";
    by_name?: string | null;
    note?: string | null;
}

export const HISTORY_TEXT: Record<HistoryEntry["action"], string> = {
    sent: "Sent", received: "Received by the store", update: "Quantities changed", approve: "Approved", hold: "Put on hold", reject: "Rejected",
    start: "Production started", dispatch: "Dispatched", resume: "Resumed", deliver: "Marked delivered", close: "Closed", reopen: "Reopened",
};

/** The admin's stage tabs and which statuses each holds. */
export const STAGES: { key: string; label: string; statuses: string[] }[] = [
    { key: "approve", label: "To approve", statuses: ["open", "under_review"] },
    { key: "approved", label: "Approved", statuses: ["approved"] },
    { key: "production", label: "In production", statuses: ["in_production"] },
    { key: "hold", label: "On hold", statuses: ["pending"] },
    { key: "dispatched", label: "Dispatched", statuses: ["dispatched"] },
    { key: "done", label: "Done", statuses: ["delivered", "closed", "rejected"] },
];
