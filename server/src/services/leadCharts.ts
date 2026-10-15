/**
 * The numbers behind the Lead Management charts, from the same filtered leads
 * the table shows — so a chart, the tiles and the list always agree. Built from
 * rows the list already has in memory: no extra query, no extra request.
 *
 * Free of any database import, so it is tested directly.
 */

/* whatsapp_manual, instagram_dm, facebook_dm: an enquiry the team took on
   WhatsApp, an Instagram DM or a Facebook DM and added by hand. 'instagram'
   is the Instagram ad form, which comes in by itself. */
export const CHART_CHANNELS = ['whatsapp', 'instagram', 'ivr', 'website', 'whatsapp_manual', 'instagram_dm', 'facebook_dm'] as const;
/** The channels Add Lead offers; anything else is filed as IVR. */
export const MANUAL_CHANNELS: readonly string[] = ['ivr', 'website', 'whatsapp_manual', 'instagram_dm', 'facebook_dm'];
type Channel = typeof CHART_CHANNELS[number];
export const CHART_PRODUCTS = ['Seat Covers', 'Mats', 'Accessories'] as const;
export const FORWARD_KINDS = ['store', 'asm', 'distributor', 'support'] as const;
export const REVIEW_OUTCOMES = [
    'follow_up', 'closed_won', 'closed_lost', 'no_response',
    'call_disconnected', 'switched_off', 'number_not_working',
] as const;

/** How many names a "top" chart lists; the rest are summed into "Others". */
export const TOP_N = 8;

export interface ChartRow {
    /** The IST calendar day, "2026-09-30". */
    ist_day: string | null;
    source: string | null;
    product: string | null;
    state: string | null;
    asm_id: string | null;
    asm_name: string | null;
    review_status: string | null;
    /** Who the lead went to: store, asm, distributor, support (forwardKinds). */
    forward_kinds: string[];
    /** The stores it went to (leadStores). */
    stores: { id: string; name: string }[];
}

export interface Named { key: string; label: string; count: number }

export interface LeadCharts {
    total: number;
    /** One entry per day with a lead, oldest first; channels outside CHART_CHANNELS are "other". */
    by_day: Array<{ day: string; other: number } & Record<Channel, number>>;
    product: Named[];
    /** A lead that went to two kinds of recipient counts under both; "none" is not forwarded yet. */
    went_to: Named[];
    /** Top states, then "Others" and "unknown" when they have any. */
    states: Named[];
    asms: Named[];
    stores: Named[];
    /** "pending" is not reviewed yet. */
    review: Named[];
}

function top(counts: Map<string, { label: string; count: number }>, others = true): Named[] {
    const sorted = [...counts].map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    if (!others || sorted.length <= TOP_N) return sorted;
    const rest = sorted.slice(TOP_N).reduce((n, x) => n + x.count, 0);
    return [...sorted.slice(0, TOP_N), { key: '__others', label: 'Others', count: rest }];
}

function bump(map: Map<string, { label: string; count: number }>, key: string, label: string) {
    const e = map.get(key) ?? { label, count: 0 };
    e.count++;
    map.set(key, e);
}

export function buildLeadCharts(rows: ChartRow[]): LeadCharts {
    const days = new Map<string, LeadCharts['by_day'][number]>();
    const product = new Map<string, number>();
    const wentTo = new Map<string, number>();
    const states = new Map<string, { label: string; count: number }>();
    const asms = new Map<string, { label: string; count: number }>();
    const stores = new Map<string, { label: string; count: number }>();
    const review = new Map<string, number>();
    let unknownState = 0;

    for (const r of rows) {
        if (r.ist_day) {
            const d = days.get(r.ist_day)
                ?? { day: r.ist_day, ...Object.fromEntries(CHART_CHANNELS.map(c => [c, 0])) as Record<Channel, number>, other: 0 };
            const ch = (CHART_CHANNELS as readonly string[]).includes(String(r.source)) ? String(r.source) as Channel : 'other';
            d[ch]++;
            days.set(r.ist_day, d);
        }

        const p = (CHART_PRODUCTS as readonly string[]).includes(String(r.product)) ? String(r.product) : 'none';
        product.set(p, (product.get(p) ?? 0) + 1);

        const kinds = r.forward_kinds.filter(k => (FORWARD_KINDS as readonly string[]).includes(k));
        if (!kinds.length) wentTo.set('none', (wentTo.get('none') ?? 0) + 1);
        for (const k of new Set(kinds)) wentTo.set(k, (wentTo.get(k) ?? 0) + 1);

        if (r.state) bump(states, r.state, r.state);
        else unknownState++;

        // An asm_id with no name: the ASM was removed from the roster.
        if (r.asm_id) bump(asms, r.asm_id, r.asm_name || 'Removed ASM');
        for (const s of r.stores) bump(stores, s.id, s.name);

        const rv = r.review_status && (REVIEW_OUTCOMES as readonly string[]).includes(r.review_status) ? r.review_status : 'pending';
        review.set(rv, (review.get(rv) ?? 0) + 1);
    }

    const stateList = top(states);
    if (unknownState) stateList.push({ key: 'none', label: 'Not known', count: unknownState });

    return {
        total: rows.length,
        by_day: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
        product: [...CHART_PRODUCTS, 'none'].map(k => ({ key: k, label: k === 'none' ? 'Not given' : k, count: product.get(k) ?? 0 })),
        went_to: [...FORWARD_KINDS, 'none'].map(k => ({ key: k, label: k, count: wentTo.get(k) ?? 0 })),
        states: stateList,
        asms: top(asms),
        stores: top(stores),
        review: ['pending', ...REVIEW_OUTCOMES].map(k => ({ key: k, label: k, count: review.get(k) ?? 0 })),
    };
}
