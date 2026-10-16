/**
 * The two lists Lead Management works from, kept by the admin: the review
 * outcomes (what calling the customer back found; the ASM's own outcome uses
 * the same list) and the channels a lead comes from.
 *
 * A value is the stored key and never changes once made; the label, colour,
 * order and whether it is shown are the admin's to change. A value some lead
 * uses cannot be deleted, only hidden, so every old lead keeps its label.
 *
 * WhatsApp, Instagram (the ad form) and IVR are system channels: the
 * integrations create those leads, so they can be renamed and recoloured but
 * not deleted or hidden. Every other channel is one the team adds by hand in
 * Add Lead and forwards like a WhatsApp enquiry added by hand.
 *
 * Free of any database import, so it is tested directly.
 */

/** The colours on offer; the screens map each to their own shades. */
export const TONES = ['slate', 'green', 'red', 'blue', 'amber', 'purple', 'teal', 'pink', 'orange', 'indigo', 'cyan', 'yellow'] as const;
export type Tone = typeof TONES[number];

/** The groups a store's My Leads sorts leads into ("pending" is a lead nobody has called). */
export const STORE_GROUPS = ['won', 'follow', 'lost', 'noanswer'] as const;
export type StoreGroup = typeof STORE_GROUPS[number];

export interface LeadOutcome { value: string; label: string; tone: Tone; active: boolean; store_group: StoreGroup }

/* The group an outcome counted in before the admin could choose. */
const groupByValue = (v: string): StoreGroup =>
    v === 'closed_won' ? 'won' : v === 'follow_up' ? 'follow' : v === 'closed_lost' ? 'lost' : 'noanswer';

export interface LeadChannel {
    value: string;
    label: string;
    tone: Tone;
    active: boolean;
    /** Offered in Add Lead. */
    add_lead: boolean;
    /** Created by an integration: cannot be deleted or hidden. */
    system?: boolean;
    /** Finds its own ASM or store (WhatsApp, the Instagram ad form). */
    auto_routed?: boolean;
}

export interface LeadOptions { outcomes: LeadOutcome[]; channels: LeadChannel[] }

export const SYSTEM_CHANNELS: LeadChannel[] = [
    { value: 'whatsapp', label: 'WhatsApp', tone: 'green', active: true, add_lead: false, system: true, auto_routed: true },
    { value: 'instagram', label: 'Instagram', tone: 'pink', active: true, add_lead: false, system: true, auto_routed: true },
    { value: 'ivr', label: 'IVR', tone: 'indigo', active: true, add_lead: true, system: true },
];

export const DEFAULT_LEAD_OPTIONS: LeadOptions = {
    outcomes: [
        { value: 'no_response', label: 'No response', tone: 'slate', active: true, store_group: 'noanswer' },
        { value: 'follow_up', label: 'Follow up', tone: 'blue', active: true, store_group: 'follow' },
        { value: 'closed_won', label: 'Closed won', tone: 'green', active: true, store_group: 'won' },
        { value: 'closed_lost', label: 'Closed lost', tone: 'red', active: true, store_group: 'lost' },
        { value: 'call_disconnected', label: 'Call disconnected', tone: 'slate', active: true, store_group: 'noanswer' },
        { value: 'switched_off', label: 'Switched off', tone: 'slate', active: true, store_group: 'noanswer' },
        { value: 'number_not_working', label: 'Number not working', tone: 'slate', active: true, store_group: 'noanswer' },
    ],
    channels: [
        ...SYSTEM_CHANNELS,
        { value: 'website', label: 'Website', tone: 'cyan', active: true, add_lead: true },
        { value: 'whatsapp_manual', label: 'WhatsApp (added)', tone: 'teal', active: true, add_lead: true },
        { value: 'instagram_dm', label: 'Instagram DM', tone: 'purple', active: true, add_lead: true },
        { value: 'facebook_dm', label: 'Facebook DM', tone: 'yellow', active: true, add_lead: true },
    ],
};

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
/** A stored key from a label: lower case, a–z 0–9 and _, at most 30 (the leads.source column). */
export const valueFrom = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
/* A new entry from the settings screen carries a temporary key ("new_…"): its
   real one is made from its label. */
const keyOf = (v: unknown, label: unknown) => {
    const k = str(v, 40);
    return valueFrom(/^new_\d+$/.test(k) || !k ? str(label, 60) : k);
};
const toneOf = (v: unknown, d: Tone): Tone => ((TONES as readonly string[]).includes(String(v)) ? v as Tone : d);

function unique<T extends { value: string }>(list: T[]): T[] {
    const seen = new Set<string>();
    return list.map(x => {
        let v = x.value;
        for (let n = 2; seen.has(v); n++) v = `${x.value.slice(0, 27)}_${n}`;
        seen.add(v);
        return { ...x, value: v };
    });
}

/**
 * A stored list, cleaned: unknown colours fall back, values are made unique,
 * and the system channels are always there (in the saved order, or first).
 */
export function readLeadOptions(stored: unknown): LeadOptions {
    const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<LeadOptions>;
    const outcomes = Array.isArray(s.outcomes)
        ? unique(s.outcomes.map((o: any, i) => {
            const value = keyOf(o?.value, o?.label) || `outcome_${i + 1}`;
            return {
                value,
                label: str(o?.label, 60) || `Outcome ${i + 1}`,
                tone: toneOf(o?.tone, 'slate'),
                active: o?.active !== false,
                store_group: (STORE_GROUPS as readonly string[]).includes(o?.store_group) ? o.store_group as StoreGroup : groupByValue(value),
            };
        }))
        : structuredClone(DEFAULT_LEAD_OPTIONS.outcomes);

    let channels: LeadChannel[] = Array.isArray(s.channels)
        ? unique(s.channels.map((c: any, i) => {
            const value = keyOf(c?.value, c?.label) || `channel_${i + 1}`;
            const sys = SYSTEM_CHANNELS.find(x => x.value === value);
            return {
                value,
                label: str(c?.label, 40) || sys?.label || `Channel ${i + 1}`,
                tone: toneOf(c?.tone, sys?.tone ?? 'slate'),
                // A system channel is always shown; its routing is the integration's.
                active: sys ? true : c?.active !== false,
                add_lead: sys ? (sys.value === 'ivr' ? c?.add_lead !== false : false) : c?.add_lead !== false,
                ...(sys ? { system: true, ...(sys.auto_routed ? { auto_routed: true } : {}) } : {}),
            };
        }))
        : structuredClone(DEFAULT_LEAD_OPTIONS.channels);
    const missing = SYSTEM_CHANNELS.filter(sc => !channels.some(c => c.value === sc.value));
    channels = [...missing.map(c => ({ ...c })), ...channels];
    return { outcomes, channels };
}

/**
 * What would stop the lists from working, in words; null when they are fine.
 * `inUse` is how many leads use each value (review or ASM outcome, source):
 * a value in use may be hidden but not deleted.
 */
export function leadOptionsProblem(next: LeadOptions, prev: LeadOptions, inUse: { outcomes: Record<string, number>; channels: Record<string, number> }): string | null {
    if (!next.outcomes.some(o => o.active)) return 'Keep at least one review outcome shown';
    if (!next.channels.some(c => c.active && c.add_lead)) return 'Keep at least one channel in Add Lead';
    for (const o of prev.outcomes) {
        if (!next.outcomes.some(x => x.value === o.value) && (inUse.outcomes[o.value] ?? 0) > 0) {
            return `"${o.label}" is on ${inUse.outcomes[o.value]} lead${inUse.outcomes[o.value] === 1 ? '' : 's'}: hide it instead of deleting it`;
        }
    }
    for (const c of prev.channels) {
        if (!next.channels.some(x => x.value === c.value) && (inUse.channels[c.value] ?? 0) > 0) {
            return `"${c.label}" has ${inUse.channels[c.value]} lead${inUse.channels[c.value] === 1 ? '' : 's'}: hide it instead of deleting it`;
        }
    }
    const labels = (list: { label: string }[]) => list.map(x => x.label.toLowerCase());
    for (const [what, list] of [['review outcome', labels(next.outcomes)], ['channel', labels(next.channels)]] as const) {
        const dup = list.find((l, i) => list.indexOf(l) !== i);
        if (dup) return `Two ${what}s are called "${dup}"`;
    }
    return null;
}

/** The channels Add Lead may file a lead under. */
export const addLeadChannels = (o: LeadOptions) => o.channels.filter(c => c.active && c.add_lead).map(c => c.value);

/** The store's group for a lead's outcome: "pending" until someone has called. */
export const storeGroupOf = (o: LeadOptions, value: string | null | undefined): StoreGroup | 'pending' =>
    !value || value === 'pending' ? 'pending' : o.outcomes.find(x => x.value === value)?.store_group ?? groupByValue(value);

/** Whether an outcome may be set on a lead now: a shown one, or the one it already has. */
export const outcomeAllowed = (o: LeadOptions, value: string, current?: string | null) =>
    o.outcomes.some(x => x.value === value && (x.active || x.value === current));
