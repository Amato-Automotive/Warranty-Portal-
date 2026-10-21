/**
 * Lead Management's lists the admin keeps (server: services/leadOptions):
 * the review outcomes and the channels, with their colours. Loaded once and
 * shared; saving them refreshes everyone on the page.
 */
import { useEffect, useState } from "react";
import api from "@/lib/api";

export const TONES = ["slate", "green", "red", "blue", "amber", "purple", "teal", "pink", "orange", "indigo", "cyan", "yellow"] as const;
export type Tone = typeof TONES[number];

export type StoreGroup = "won" | "follow" | "lost" | "noanswer";
export const STORE_GROUP_LABEL: Record<StoreGroup, string> = { won: "Won", follow: "Follow up", lost: "Lost", noanswer: "No answer" };
export interface LeadOutcome { value: string; label: string; tone: Tone; active: boolean; store_group: StoreGroup }
export interface LeadChannel {
    value: string; label: string; tone: Tone; active: boolean; add_lead: boolean;
    system?: boolean; auto_routed?: boolean;
}
export interface LeadOptions { outcomes: LeadOutcome[]; channels: LeadChannel[] }

/* Each colour as a badge, as a number on a tile, and for a chart. */
export const TONE_BADGE: Record<Tone, string> = {
    slate: "bg-slate-50 text-slate-600 border-slate-200", green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-rose-50 text-rose-700 border-rose-200", blue: "bg-blue-50 text-blue-700 border-blue-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200", purple: "bg-purple-50 text-purple-700 border-purple-200",
    teal: "bg-teal-50 text-teal-700 border-teal-200", pink: "bg-pink-50 text-pink-700 border-pink-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200", indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
    cyan: "bg-cyan-50 text-cyan-700 border-cyan-200", yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
};
export const TONE_TEXT: Record<Tone, string> = {
    slate: "text-slate-700", green: "text-emerald-700", red: "text-rose-600", blue: "text-blue-600", amber: "text-amber-600",
    purple: "text-purple-600", teal: "text-teal-600", pink: "text-pink-500", orange: "text-orange-600", indigo: "text-indigo-600",
    cyan: "text-cyan-600", yellow: "text-yellow-600",
};
export const TONE_HEX: Record<Tone, string> = {
    slate: "#94a3b8", green: "#047857", red: "#e11d48", blue: "#2563eb", amber: "#d97706", purple: "#9333ea",
    teal: "#5eead4", pink: "#f472b6", orange: "#ea580c", indigo: "#4f46e5", cyan: "#0891b2", yellow: "#ca8a04",
};

/* What the screens show before the lists arrive: the lists as they were. */
export const DEFAULT_LEAD_OPTIONS: LeadOptions = {
    outcomes: [
        { value: "no_response", label: "No response", tone: "slate", active: true, store_group: "noanswer" },
        { value: "follow_up", label: "Follow up", tone: "blue", active: true, store_group: "follow" },
        { value: "closed_won", label: "Closed won", tone: "green", active: true, store_group: "won" },
        { value: "closed_lost", label: "Closed lost", tone: "red", active: true, store_group: "lost" },
        { value: "call_disconnected", label: "Call disconnected", tone: "slate", active: true, store_group: "noanswer" },
        { value: "switched_off", label: "Switched off", tone: "slate", active: true, store_group: "noanswer" },
        { value: "number_not_working", label: "Number not working", tone: "slate", active: true, store_group: "noanswer" },
    ],
    channels: [
        { value: "whatsapp", label: "WhatsApp", tone: "green", active: true, add_lead: false, system: true, auto_routed: true },
        { value: "instagram", label: "Instagram", tone: "pink", active: true, add_lead: false, system: true, auto_routed: true },
        { value: "ivr", label: "IVR", tone: "indigo", active: true, add_lead: true, system: true },
        { value: "website", label: "Website", tone: "cyan", active: true, add_lead: true },
        { value: "whatsapp_manual", label: "WhatsApp (added)", tone: "teal", active: true, add_lead: true },
        { value: "instagram_dm", label: "Instagram DM", tone: "purple", active: true, add_lead: true },
        { value: "facebook_dm", label: "Facebook DM", tone: "yellow", active: true, add_lead: true },
    ],
};

let current: LeadOptions = DEFAULT_LEAD_OPTIONS;
let loading: Promise<void> | null = null;
const listeners = new Set<(o: LeadOptions) => void>();

const publish = (o: LeadOptions) => { current = o; listeners.forEach(l => l(o)); };

export function reloadLeadOptions() {
    loading = api.get("/asm/leads/options").then(r => publish(r.data.options)).catch(() => { /* keep what we have */ }).finally(() => { loading = null; });
    return loading;
}
export const setLeadOptions = (o: LeadOptions) => publish(o);

/** The lists, loaded once for the page and kept in step after a save. */
export function useLeadOptions(): LeadOptions {
    const [o, setO] = useState(current);
    useEffect(() => {
        listeners.add(setO);
        if (current === DEFAULT_LEAD_OPTIONS && !loading) reloadLeadOptions();
        return () => { listeners.delete(setO); };
    }, []);
    return o;
}

export const outcomeLabel = (o: LeadOptions, v?: string | null) => (v ? o.outcomes.find(x => x.value === v)?.label ?? v.replace(/_/g, " ") : "");
export const channelLabel = (o: LeadOptions, v?: string | null) => (v ? o.channels.find(x => x.value === v)?.label ?? v.replace(/_/g, " ") : "");
