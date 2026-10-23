import type { Scheme, EntryFile, EntryLine, Club } from "@/lib/schemes";

/** One scheme as the admin sees it (GET /schemes/admin/:id). */

export interface AdminEntry {
    id: string; store_id: string; store_name: string; city: string | null; state: string | null; answers: Record<string, string>;
    files: Record<string, EntryFile[]>; score: number; lines: EntryLine[] | null; claimed_lines: EntryLine[] | null;
    source: "store" | "admin" | "import"; invoice_no: string | null;
    /** Approved invoice by invoice: each invoice's number, its files (pages) and what was on it. */
    invoices: { invoice_no: string; files: string[]; lines: EntryLine[]; points: number }[] | null;
    status: "pending" | "approved" | "rejected";
    review_note: string | null; reviewed_at: string | null; created_at: string;
    /** Head office's corrections to what the store sent, oldest first. */
    edits?: { at: string; by_name: string | null; changes: string[]; note: string | null }[];
}
export interface BoardRow {
    store_id: string; store_name: string; city: string | null; state: string | null;
    score: number; approved: number; rank: number; reward: string | null; club: Club | null; paid_at: string | null; payout_note: string | null;
    delivery: "dispatched" | "delivered" | null; dispatched_at: string | null; delivered_at: string | null;
    months: { month: string; points: number }[];
}
export interface AdminDetail {
    scheme: Scheme; entries: AdminEntry[]; leaderboard: BoardRow[];
    participants: { store_id: string; store_name: string; city: string | null; state: string | null; joined_at: string }[];
    /** Verified franchises that have not joined; `can_see` is whether the scheme is open to them. */
    not_joined?: { store_id: string; store_code: string | null; store_name: string; city: string | null; state: string | null; can_see: boolean }[];
    adjustments: { id: string; store_id: string; store_name: string; points: number; note: string; created_at: string }[];
}

/* States are written every way in the stores table ("RAJASTHAN", "Rajasthan "); one key each. */
export const stateKey = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();
export const stateLabel = (v: string) => v.replace(/\b[a-z]/g, c => c.toUpperCase());
export const istDay = (d: string) => new Date(new Date(d).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
