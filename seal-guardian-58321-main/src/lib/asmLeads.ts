/** One time an ASM called, WhatsApped or visited a lead's customer. */
export interface FollowUp {
    id: number;
    channel: string;
    outcome: string;
    note: string | null;
    created_at: string;
    asm_name?: string | null;
}

/** A lead as the ASM portal sees it. The ASM logs their follow-ups; the outcome proper stays head office's. */
export interface AsmLead {
    id: string;
    created_at: string;
    source: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    product: string | null;
    car_model: string | null;
    state: string | null;
    raw_area: string | null;
    matched_area: string | null;
    pincode: string | null;
    /** Newest first. */
    followups?: FollowUp[];
    followup?: { count: number; first_at: string; last: FollowUp } | null;
}

/* The same lists as the server's (server/src/services/leadFollowUp.ts). */
export const FOLLOW_UP_CHANNELS = [
    { id: "call", label: "Call" },
    { id: "whatsapp", label: "WhatsApp" },
    { id: "visit", label: "Visit" },
] as const;
export type FollowUpChannel = typeof FOLLOW_UP_CHANNELS[number]["id"];

export const FOLLOW_UP_OUTCOMES = [
    { id: "interested", label: "Reached – interested", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    { id: "not_interested", label: "Reached – not interested", tone: "bg-rose-50 text-rose-700 border-rose-200" },
    { id: "no_answer", label: "No answer", tone: "bg-slate-100 text-slate-600 border-slate-200" },
    { id: "sent_to_store", label: "Sent to a store", tone: "bg-sky-50 text-sky-700 border-sky-200" },
    { id: "bought", label: "Bought", tone: "bg-emerald-600 text-white border-emerald-600" },
] as const;

export const channelLabel = (id: string) => FOLLOW_UP_CHANNELS.find(c => c.id === id)?.label ?? id;
export const outcomeOf = (id: string) => FOLLOW_UP_OUTCOMES.find(o => o.id === id) ?? { id, label: id, tone: "bg-slate-100 text-slate-600 border-slate-200" };

/** "just now", "2h ago", "3 days ago". */
export function ago(iso: string, now = Date.now()) {
    const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** The customer's number as 10 digits, for tel: and WhatsApp links. */
export const phoneTail = (raw: string | null) => (raw || "").replace(/\D/g, "").slice(-10);

/** Products arrive already labelled ("Seat Covers", "Mats", "Accessories"). */
export const PRODUCTS = ["Seat Covers", "Mats", "Accessories"] as const;

export const SOURCE_LABEL: Record<string, string> = {
    whatsapp: "WhatsApp", instagram: "Instagram", ivr: "Phone call", website: "Website", sheet: "Lead sheet",
};
