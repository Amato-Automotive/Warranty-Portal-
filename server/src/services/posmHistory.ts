/**
 * POSM dispatch history: what has been sent to each store (from the Noida
 * office and the plant's depots), and where each store stands on the FRP and
 * Sample Jacket limits.
 *
 *  - Sent: Dispatched, Delivered, In Transit. Pending at the plant: In
 *    production, Ready to dispatch, On hold, Not updated, Out of stock.
 *    Returned counts as neither.
 *  - Old stores: FRP 2 and Sample Jacket 20 each (changeable per store). At or
 *    over the limit, any more needs approval. Pending that would take the
 *    store over is shown as a warning.
 *  - New stores get FRP and Sample Jackets as requested, one time only; once
 *    they have had any, more needs approval.
 *
 * Free of any database import, so it is tested directly.
 */

export const POSM_ITEMS = [
    'FRP', 'Sample Jacket', 'Visiting Card', 'Franchise Certificate', 'T-Shirt', 'Swatch / Shade Book', 'Dr. Marq Stand', 'ACP Board',
    'QR Code Sticker / Sun', 'Push & Pull Sticker', 'Petrol/Diesel Sticker', 'Demo Sticker', 'Wobbler / Dangler', 'Notepad & Pen', 'Brochure', 'Calendar',
    /* Items stores order through POSM requests that the sheets had no column for. */
    'Catalogue', 'POSM Kit', 'Art work',
] as const;

export const POSM_STATUSES = ['Not updated', 'WIP', 'Ready to dispatch', 'On hold', 'Out of stock', 'Dispatched', 'In Transit', 'Delivered', 'Return'] as const;
export type PosmStatus = (typeof POSM_STATUSES)[number];

const SENT = new Set(['Dispatched', 'In Transit', 'Delivered']);
const PENDING = new Set(['Not updated', 'WIP', 'Ready to dispatch', 'On hold', 'Out of stock']);
export const isSent = (status: string) => SENT.has(status);
export const isPending = (status: string) => PENDING.has(status);

export type LineFlag = 'possible_duplicate' | 'qty_not_written' | 'check_match' | 'sent_to_asm';

export interface HistoryLine {
    item: string;
    qty: number;
    status: string;
    dispatch_date?: string | null;
    request_date?: string | null;
}

export interface StoreSettings {
    store_type: 'old' | 'new';
    type_assumed: boolean;
    frp_limit: number;
    jacket_limit: number;
}

export const DEFAULT_SETTINGS: StoreSettings = { store_type: 'old', type_assumed: true, frp_limit: 2, jacket_limit: 20 };

/** The usual limits by store type (27 Nov): FRP 2 for every store; Sample Jackets 20 for an old store, 30 for a new one. */
export const DEFAULT_LIMITS = { old: { frp_limit: 2, jacket_limit: 20 }, new: { frp_limit: 2, jacket_limit: 30 } } as const;

export type LimitState = 'ok' | 'pending_over' | 'reached' | 'over';

export interface LimitedItem { sent: number; pending: number; limit: number | null; left: number | null; state: LimitState }

/**
 * Where the store stands against its limits. (new_open / new_used were the old
 * one-time rule for new stores; since 27 Nov a new store has limits too.)
 */
export type Approval = 'within' | 'reached' | 'over' | 'new_open' | 'new_used';

export interface StoreSummary {
    sent: Record<string, number>;
    frp: LimitedItem;
    jacket: LimitedItem;
    approval: Approval;
    needs_approval: boolean;
    lines: number;
    last_dispatch: string | null;
}

function limited(lines: HistoryLine[], item: string, limit: number | null): LimitedItem {
    const mine = lines.filter(l => l.item === item);
    const sent = mine.filter(l => isSent(l.status)).reduce((n, l) => n + l.qty, 0);
    const pending = mine.filter(l => isPending(l.status)).reduce((n, l) => n + l.qty, 0);
    if (limit === null) return { sent, pending, limit: null, left: null, state: 'ok' };
    const state: LimitState = sent > limit ? 'over' : sent >= limit ? 'reached' : sent + pending > limit ? 'pending_over' : 'ok';
    return { sent, pending, limit, left: Math.max(0, limit - sent), state };
}

/** A store's totals and limits from its history lines and settings. */
export function summarise(lines: HistoryLine[], settings: StoreSettings = DEFAULT_SETTINGS): StoreSummary {
    const sent: Record<string, number> = {};
    for (const l of lines) if (isSent(l.status)) sent[l.item] = (sent[l.item] ?? 0) + l.qty;
    const frp = limited(lines, 'FRP', settings.frp_limit);
    const jacket = limited(lines, 'Sample Jacket', settings.jacket_limit);
    const approval: Approval = frp.state === 'over' || jacket.state === 'over' ? 'over' : frp.state === 'reached' || jacket.state === 'reached' ? 'reached' : 'within';
    const dates = lines.filter(l => isSent(l.status) && l.dispatch_date).map(l => l.dispatch_date as string).sort();
    return {
        sent, frp, jacket, approval,
        needs_approval: approval !== 'within',
        lines: lines.length,
        last_dispatch: dates.length ? dates[dates.length - 1] : null,
    };
}

export const APPROVAL_LABEL: Record<Approval, string> = {
    within: 'Within limit',
    reached: 'Limit reached: approval needed',
    over: 'Over limit: approval needed',
    new_open: 'New store: one-time request open',
    new_used: 'New store: one-time request used',
};

/** A store type as written in the combined sheet. */
export function readStoreType(v: unknown): Pick<StoreSettings, 'store_type' | 'type_assumed'> {
    const s = String(v ?? '').trim().toLowerCase();
    if (s.startsWith('new')) return { store_type: 'new', type_assumed: false };
    return { store_type: 'old', type_assumed: s !== 'old' };
}

/** A status as written in the sheet, or "Not updated" if it is not one of ours. */
export function readStatus(v: unknown): PosmStatus {
    /* "In production" is the old name of WIP. */
    const s = String(v ?? '').trim().toLowerCase().replace(/^in production$/, 'wip');
    return POSM_STATUSES.find(x => x.toLowerCase() === s) ?? 'Not updated';
}

/* ---------- Working in the portal: the plant and the Noida office ---------- */

export const DEPOTS = { ludhiana: 'Plant - Ludhiana depot', jaipur: 'Plant - Jaipur depot' } as const;
export type Depot = keyof typeof DEPOTS;
export const NOIDA_SOURCE = 'Noida office';
export const isPlantSource = (source: string) => /^Plant\b/i.test(source);

/** What the plant may change on a line; everything else is the Noida office's. */
export const PLANT_FIELDS = ['status', 'expected_dispatch', 'dispatch_date', 'docket_no', 'courier', 'reason', 'remarks'] as const;
export type PlantEdit = Partial<Record<(typeof PLANT_FIELDS)[number], string | null>>;

const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const clean = (v: unknown, max = 500) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

/**
 * The plant's change to a line, checked: only its fields, real dates, a known
 * status, a reason when a line is put on hold or is out of stock, and a
 * dispatch date (today if none) once it is dispatched.
 */
export function checkPlantEdit(was: { status: string; reason: string | null; dispatch_date: string | null }, body: Record<string, unknown>, today: string):
    { ok: true; set: PlantEdit; statusChanged: boolean } | { ok: false; error: string } {
    const set: PlantEdit = {};
    for (const f of PLANT_FIELDS) {
        if (!(f in body)) continue;
        const v = body[f];
        if (f === 'expected_dispatch' || f === 'dispatch_date') {
            if (v !== null && v !== '' && !isDay(v)) return { ok: false, error: 'Enter the date as a date' };
            set[f] = v ? String(v) : null;
        } else if (f === 'status') {
            if (!(POSM_STATUSES as readonly string[]).includes(String(v))) return { ok: false, error: 'Pick a status' };
            set.status = String(v);
        } else set[f] = clean(v, f === 'remarks' || f === 'reason' ? 1000 : 80);
    }
    const status = set.status ?? was.status;
    const reason = 'reason' in set ? set.reason : was.reason;
    if ((status === 'On hold' || status === 'Out of stock') && !reason) return { ok: false, error: `Give the reason it is ${status.toLowerCase()}` };
    if (status === 'Dispatched' && !('dispatch_date' in set ? set.dispatch_date : was.dispatch_date)) set.dispatch_date = today;
    if (set.dispatch_date && set.dispatch_date > today) return { ok: false, error: 'The dispatch date cannot be in the future' };
    return { ok: true, set, statusChanged: status !== was.status };
}

/** Whether a line needs a reason from the plant: on hold, out of stock, or past its expected date and not yet dispatched. */
export function needsReason(l: { status: string; reason: string | null; expected_dispatch: string | null }, today: string): boolean {
    if (l.reason) return false;
    if (l.status === 'On hold' || l.status === 'Out of stock') return true;
    return Boolean(l.expected_dispatch && l.expected_dispatch < today && isPending(l.status));
}

/**
 * Whether a new FRP or Sample Jacket order needs approval: an old store that
 * would go past its limit counting what is sent and already pending, or a new
 * store that has had its one-time request.
 */
export function orderNeedsApproval(lines: HistoryLine[], settings: StoreSettings, order: { item: string; qty: number }[]): string | null {
    const s = summarise(lines, settings);
    for (const [item, v, limit] of [['FRP', s.frp, settings.frp_limit], ['Sample Jacket', s.jacket, settings.jacket_limit]] as const) {
        const add = order.filter(o => o.item === item).reduce((n, o) => n + o.qty, 0);
        if (add && v.sent + v.pending + add > limit) return `${item}: ${v.sent} sent and ${v.pending} pending; ${add} more goes past the limit of ${limit}.`;
    }
    return null;
}

/** The Noida office's sheet has one row per dispatch: lines sharing a store, date, docket, courier, sender, status and delivery date are that row. */
export const noidaGroupKey = (l: { store_id: string | null; store_code: string | null; sheet_store_name: string | null; dispatch_date: string | null; docket_no: string | null; courier: string | null; dispatched_by: string | null; status: string; delivery_date: string | null }) =>
    [l.store_id ?? l.store_code ?? l.sheet_store_name ?? '', l.dispatch_date ?? '', l.docket_no ?? '', l.courier ?? '', l.dispatched_by ?? '', l.status, l.delivery_date ?? ''].join('|');
