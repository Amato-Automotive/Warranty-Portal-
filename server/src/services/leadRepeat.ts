/*
 * Repeated leads: the same customer — the same phone number, never a name or
 * pincode match — filed as a lead more than once. Each later lead is compared
 * with that customer's lead just before it, to show what made it a new lead:
 * a reply to a campaign, a different product / vehicle / pincode / name /
 * channel, coming back after a while, or nothing at all (the same details
 * again — a real duplicate).
 *
 * Pure: the lead list and the audit script feed it rows and campaign sends.
 */
import { isFollowUpCampaign, FOLLOW_UP_HOURS } from './locatorConversation.js';

export interface RepeatLead {
    id: string;
    created_at: string | Date;
    source: string | null;
    product: string | null;
    car_model: string | null;
    customer_name: string | null;
    phone_key: string | null;
    pincode: string | null;
}

/** An Interakt campaign that reached a number. */
export interface CampaignSend { phone: string; at: string | Date; name: string }

export type RepeatField = 'product' | 'vehicle' | 'pincode' | 'name' | 'channel';

/*
 * Why this lead is a new one, most telling first:
 *   campaign   — the customer was replying to a broadcast that reached them
 *   changed    — something they told us is different this time
 *   came-back  — the same details, after a gap of more than three days
 *   same       — the same details within three days: a duplicate
 */
export type RepeatReason = 'campaign' | 'changed' | 'came-back' | 'same';

export interface RepeatInfo {
    /** 2 for the customer's second lead, and so on; 1 for a first lead that answered a campaign. */
    nth: number;
    /** All this customer's leads. */
    total: number;
    first_at: string;
    /** The lead before, or null on a first lead. */
    prev: {
        id: string; created_at: string; source: string | null; product: string | null;
        car_model: string | null; customer_name: string | null; pincode: string | null;
    } | null;
    gap_hours: number | null;
    changed: { field: RepeatField; from: string | null; to: string | null }[];
    campaign: { name: string; at: string; follow_up: boolean } | null;
    reason: RepeatReason;
}

/** Days within which the same details again count as a duplicate (as the sheet import uses). */
export const SAME_WINDOW_HOURS = 72;

const iso = (d: string | Date) => (d instanceof Date ? d : new Date(String(d).replace(' ', 'T'))).toISOString();
const ms = (d: string | Date) => Date.parse(iso(d));

/* "Hyundai Creta (2025)" and "creta" are the same car; "" says nothing. */
const words = (s: string | null | undefined) =>
    String(s ?? '').toLowerCase().replace(/\(\s*\d{4}\s*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function sameText(a: string | null | undefined, b: string | null | undefined): boolean | null {
    const x = words(a), y = words(b);
    if (!x || !y) return null;                       // one side unknown: not a change
    if (x === y) return true;
    const sx = x.replace(/ /g, ''), sy = y.replace(/ /g, '');
    return sx.includes(sy) || sy.includes(sx);
}
/* The chat files a 2-wheeler as "2-Wheeler …"; the product word alone is enough. */
const productOf = (p: string | null) => words(p).replace(/s$/, '') || null;

/* The channel family: a hand-added WhatsApp lead is still WhatsApp. */
const channelOf = (s: string | null) => String(s ?? '').replace(/_manual$/, '') || null;

export function compareLeads(prev: RepeatLead, cur: RepeatLead): RepeatInfo['changed'] {
    const out: RepeatInfo['changed'] = [];
    const p1 = productOf(prev.product), p2 = productOf(cur.product);
    if (p1 && p2 && p1 !== p2) out.push({ field: 'product', from: prev.product, to: cur.product });
    if (sameText(prev.car_model, cur.car_model) === false) out.push({ field: 'vehicle', from: prev.car_model, to: cur.car_model });
    if (prev.pincode && cur.pincode && prev.pincode !== cur.pincode) out.push({ field: 'pincode', from: prev.pincode, to: cur.pincode });
    if (sameText(prev.customer_name, cur.customer_name) === false) out.push({ field: 'name', from: prev.customer_name, to: cur.customer_name });
    if (channelOf(prev.source) !== channelOf(cur.source)) out.push({ field: 'channel', from: prev.source, to: cur.source });
    return out;
}

/** The latest campaign that reached this number in the FOLLOW_UP_HOURS before the lead. */
export function campaignBefore(sends: CampaignSend[] | undefined, at: string | Date): RepeatInfo['campaign'] {
    if (!sends?.length) return null;
    const t = ms(at);
    let best: CampaignSend | null = null;
    for (const s of sends) {
        const st = ms(s.at);
        if (st <= t && t - st <= FOLLOW_UP_HOURS * 3600_000 && (!best || st > ms(best.at))) best = s;
    }
    return best ? { name: best.name, at: iso(best.at), follow_up: isFollowUpCampaign(best.name) } : null;
}

/**
 * Repeat details for every lead that is not its customer's first.
 *
 * `history` holds every lead of the phones concerned (any date), so the 2nd
 * lead is found even when the 1st is outside the range on screen.
 * `campaigns` maps phone_key → the campaign sends to it.
 */
export function repeatInfo(
    history: RepeatLead[],
    campaigns: Map<string, CampaignSend[]> = new Map(),
): Map<string, RepeatInfo> {
    const byPhone = new Map<string, RepeatLead[]>();
    for (const l of history) {
        if (!l.phone_key || l.phone_key.length !== 10) continue;
        const list = byPhone.get(l.phone_key) ?? [];
        list.push(l);
        byPhone.set(l.phone_key, list);
    }
    const out = new Map<string, RepeatInfo>();
    for (const [phone, list] of byPhone) {
        if (list.length < 2) continue;
        list.sort((a, b) => ms(a.created_at) - ms(b.created_at) || String(a.id).localeCompare(String(b.id)));
        for (let i = 1; i < list.length; i++) {
            const cur = list[i], prev = list[i - 1];
            const gap = (ms(cur.created_at) - ms(prev.created_at)) / 3600_000;
            const changed = compareLeads(prev, cur);
            const campaign = campaignBefore(campaigns.get(phone), cur.created_at);
            const reason: RepeatReason = campaign ? 'campaign'
                : changed.length ? 'changed'
                : gap > SAME_WINDOW_HOURS ? 'came-back' : 'same';
            out.set(cur.id, {
                nth: i + 1,
                total: list.length,
                first_at: iso(list[0].created_at),
                prev: {
                    id: prev.id, created_at: iso(prev.created_at), source: prev.source, product: prev.product,
                    car_model: prev.car_model, customer_name: prev.customer_name, pincode: prev.pincode,
                },
                gap_hours: Math.round(gap * 10) / 10,
                changed,
                campaign,
                reason,
            });
        }
    }
    return out;
}

/*
 * A customer's first lead (in our table) that came in reply to a campaign —
 * an October lead from before the import, say, answering the 17 Nov audit.
 * Tagged like a repeat so the campaign replies can all be seen together.
 */
export function firstLeadCampaign(lead: RepeatLead, sends: CampaignSend[] | undefined): RepeatInfo | null {
    const campaign = campaignBefore(sends, lead.created_at);
    if (!campaign) return null;
    return {
        nth: 1, total: 1, first_at: iso(lead.created_at), prev: null, gap_hours: null,
        changed: [], campaign, reason: 'campaign',
    };
}
