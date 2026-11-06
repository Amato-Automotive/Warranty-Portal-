import { SET_KINDS, type SetKind, type Sets } from "./buyMoreReader";

/** Sell More Earn More: this one scheme is hardcoded (see the server's services/sellMoreEarnMore.ts). */
export const SELL_MORE_SCHEME_ID = "22dc9530-8c7e-4438-9230-4f7aa31d3e3d";

export interface MonthReward { status: "requested" | "sent"; note: string | null; requested_at: string; sent_at: string | null }
export interface RewardSlab { slab: number; points: number; to_next: number; sets: number; label: string; text: string }
export interface SellMoreDay { date: string; warranties: number; points: number; no_series?: number; store_points?: number }
export interface SeriesEarned { name: string; warranties: number; points: number }
export interface SellMoreMonth { key: string; label: string; warranties: number; points: number; future: boolean; can_request: boolean; target: number | null; pct: number | null; series: SeriesEarned[]; days: SellMoreDay[]; reward: MonthReward | null; reward_slab: RewardSlab | null; rewards_claimed: number }

/** What a store sees: its choice and its plain points. Never its store type or calculated score. */
export interface StoreSellMore {
    option: "sell_more" | "buy_more" | null; opted_at: string | null;
    total: number; warranties: number; months: SellMoreMonth[];
    buy_more?: StoreBuyMore | null;
    /* A distributor gets just this option, with no choice between the two. */
    only_option?: "buy_more" | null;
    assigned?: boolean;
}

/* ─── Option 2: Buy More Get More ─────────────────────────────────────────── */

export const SET_LABEL: Record<SetKind, string> = { velora: "Velora", doble: "Doble", signature: "Signature", emporio: "Emporio", other: "Any other" };

export interface BuyEligibility {
    total: number;
    offer1: { have: number; more: number; ready: boolean };
    offer2: { kind: Exclude<SetKind, "other">; have: number; need: number; more: number }[];
    offer2_ready: boolean;
}
export type Offer = "offer1" | "offer2";
export const OFFER_LABEL: Record<Offer, string> = { offer1: "Offer 1: Any 12 + 1 free", offer2: "Offer 2: Premium mix 7 + 1 free" };
export interface BuyMoreInvoice {
    id: string; invoice_no: string; invoice_date: string; files: { name: string; url: string }[]; sets: Sets; read_sets: Sets | null;
    status: "pending" | "approved" | "rejected"; review_note: string | null; reviewed_at: string | null; created_at: string;
}
export interface FreeSet { id: string; offer: Offer; used: Sets | null; status: "requested" | "approved" | "rejected"; note: string | null; requested_at: string; sent_at: string | null }
export interface StoreBuyMore {
    invoices: BuyMoreInvoice[]; approved: Sets; used: Sets; available: Sets; eligibility: BuyEligibility; rewards: number;
    waiting_sets: number; claims: FreeSet[]; products: string[];
}
export interface AdminBuyMoreInvoice extends BuyMoreInvoice { store_id: string; store_name: string; city: string | null }
export interface AdminFreeSet extends FreeSet { store_id: string; store_name: string; city: string | null; used: Sets; available: Sets }
export interface AdminBuyMoreStore {
    store_id: string; store_name: string; store_code: string | null; city: string | null; state: string | null; brand: string;
    opted_at: string; approved: Sets; used: Sets; available: Sets; eligibility: BuyEligibility; rewards: number; waiting_sets: number; requests: number;
}
export interface AdminBuyMore { stores: AdminBuyMoreStore[]; invoices: AdminBuyMoreInvoice[]; free_sets: AdminFreeSet[] }

/** The short version on the scheme's cards. */
export interface SellMoreCard { opted: boolean; option: "sell_more" | "buy_more" | null; total: number; month_label: string | null; month_points: number; free_sets: number; approved_sets: number }

export interface AdminMonthDetail { key: string; label: string; points: number; store_points: number; warranties: number; no_series: number; series: SeriesEarned[]; days: SellMoreDay[]; reward: MonthReward | null }
export interface AdminSellMoreStore {
    store_id: string; store_name: string; store_code: string | null; city: string | null; state: string | null; brand: string; opted_at: string;
    months: Record<string, { tier: string | null; target: number | null; calculated: number; store_points: number; warranties: number; no_series: number; reward: "requested" | "sent" | null }>;
}
export interface AdminSellMore {
    months: { key: string; label: string }[];
    tiers: { id: string; name: string }[];
    stores: AdminSellMoreStore[];
}
export type AudienceGroup = "AF" | "AC" | "AFAC" | "distributors";
export type AssignedOption = "sell_more" | "buy_more";
export interface Audience { groups: Record<AudienceGroup, boolean>; include: string[]; exclude: string[]; assignments: Record<string, AssignedOption> }
export interface ProgramStore { id: string; name: string; code: string | null; city: string | null; state: string | null; group: AudienceGroup; option: string | null; assignment?: AssignedOption | null }
export interface ProgramOverview {
    live: boolean; preview_stores: string[]; audience: Audience; stores: ProgramStore[];
    month_label: string; franchises: number; option1: number; option2: number;
    not_chosen: { id: string; name: string; code: string | null; city: string | null; state: string | null }[];
    invoices_waiting: number; oldest_invoice: string | null; redeem_waiting: number; free_given: number;
    reward_waiting: number; rewards_sent: number; no_target: number; month_points: number; no_series: number; sets_approved: number;
}

/** Sets in words, leaving out the kinds with none. */
export const setsLine = (s: Sets, other: string) => SET_KINDS.filter(k => s[k]).map(k => `${k === "other" ? other : SET_LABEL[k]} × ${s[k]}`).join(", ");

/** What a store would have, and could redeem, with these sets added. */
export function readyAfter(available: Sets, add: Sets) {
    const t = Object.fromEntries(SET_KINDS.map(k => [k, available[k] + (add[k] || 0)])) as Sets;
    const total = SET_KINDS.reduce((n, k) => n + t[k], 0);
    return { total, offer1: total >= 12, offer2: t.velora >= 4 && t.doble >= 1 && t.signature >= 1 && t.emporio >= 1 };
}

export interface ActivityRow {
    id: string; kind: "invoice" | "reward"; at: string; title: string; sets: Sets | null; balance: number | null;
    status: string; state: "waiting" | "good" | "bad"; note: string | null; invoice?: BuyMoreInvoice;
}

/**
 * Invoices and rewards as one list, newest first. The balance shows what the
 * store had once each approved row counted; rows waiting or rejected change nothing.
 */
export function buildActivity(invoices: BuyMoreInvoice[], claims: FreeSet[]): ActivityRow[] {
    const rows: ActivityRow[] = [
        ...invoices.map(i => ({
            id: i.id, kind: "invoice" as const, at: i.reviewed_at ?? i.created_at, title: i.invoice_no, sets: i.sets, balance: null,
            status: i.status === "approved" ? "Approved" : i.status === "rejected" ? "Rejected" : "Waiting",
            state: (i.status === "approved" ? "good" : i.status === "rejected" ? "bad" : "waiting") as ActivityRow["state"], note: i.review_note, invoice: i,
        })),
        ...claims.map(c => ({
            id: c.id, kind: "reward" as const, at: c.sent_at ?? c.requested_at, title: c.offer, sets: c.used, balance: null,
            status: c.status === "approved" ? "Reward approved" : c.status === "rejected" ? "Rejected" : "Requested",
            state: (c.status === "approved" ? "good" : c.status === "rejected" ? "bad" : "waiting") as ActivityRow["state"], note: c.note,
        })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    let balance = 0;
    for (const r of rows as ActivityRow[]) {
        if (r.state !== "good" || !r.sets) continue;
        const n = SET_KINDS.reduce((t, k) => t + r.sets![k], 0);
        balance += r.kind === "invoice" ? n : -n;
        r.balance = Math.max(0, balance);
    }
    return (rows as ActivityRow[]).reverse();
}

export const points = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const shortDay = (d: string, locale = "en-IN") =>
    new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** A timestamp as an IST day. */
export const stampDay = (v: string, locale = "en-IN") =>
    new Date(v).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
