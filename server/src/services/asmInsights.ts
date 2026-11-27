/**
 * What an ASM sees about their own stores beyond leads and warranties:
 * the POSM each store has been sent, and the alerts that tell them which
 * store needs a visit or a call. Free of any database import, so it is
 * tested directly.
 */
import { APPROVAL_LABEL, DEFAULT_SETTINGS, isPending, isSent, summarise, type Approval, type StoreSettings } from './posmHistory.js';

export interface PLine {
    id: string; store_id: string; source: string; item: string; qty: number; status: string;
    request_date: string | null; dispatch_date: string | null; expected_dispatch: string | null; reason: string | null;
}

const isPlant = (s: string) => /^Plant\b/i.test(s);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const minusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

/** "High POSM, low sales": FRP or 20+ jackets sent in 6 months, under 5 warranties in that time. */
export const LOW_SALES = { months: 6, jackets: 20, warranties: 5 } as const;

export interface PosmStoreRow {
    store_id: string;
    sent: Record<string, number>;
    items_sent: number;
    frp: { sent: number; limit: number | null; pending: number };
    jacket: { sent: number; limit: number | null; pending: number };
    approval: Approval; approval_label: string;
    plant_open: number; overdue: number;
    last_sent: string | null;
    low_sales: { frp: number; jackets: number; warranties: number } | null;
}

/** Each store's POSM: what it has had, its FRP / jacket limits, what the plant still owes, and the low-sales check. */
export function posmByStore(storeIds: string[], lines: PLine[], settings: Map<string, StoreSettings>, warranties6m: Map<string, number>, today: string): PosmStoreRow[] {
    const six = minusDays(today, 182);
    return storeIds.map(id => {
        const ls = lines.filter(l => l.store_id === id);
        const sum = summarise(ls, settings.get(id) ?? DEFAULT_SETTINGS);
        const open = ls.filter(l => isPlant(l.source) && isPending(l.status));
        const recent = ls.filter(l => isSent(l.status) && (l.dispatch_date ?? '') >= six);
        const frp6 = recent.filter(l => l.item === 'FRP').reduce((n, l) => n + l.qty, 0);
        const jk6 = recent.filter(l => l.item === 'Sample Jacket').reduce((n, l) => n + l.qty, 0);
        const w = warranties6m.get(id) ?? 0;
        return {
            store_id: id, sent: sum.sent, items_sent: Object.values(sum.sent).reduce((a, b) => a + b, 0),
            frp: { sent: sum.frp.sent, limit: sum.frp.limit, pending: sum.frp.pending },
            jacket: { sent: sum.jacket.sent, limit: sum.jacket.limit, pending: sum.jacket.pending },
            approval: sum.approval, approval_label: APPROVAL_LABEL[sum.approval],
            plant_open: open.length, overdue: open.filter(l => l.expected_dispatch && l.expected_dispatch < today).length,
            last_sent: sum.last_dispatch,
            low_sales: (frp6 >= 1 || jk6 >= LOW_SALES.jackets) && w < LOW_SALES.warranties ? { frp: frp6, jackets: jk6, warranties: w } : null,
        };
    });
}

/* ---------- Alerts on the ASM's home ---------- */

export type Severity = 'critical' | 'serious' | 'warning' | 'good';
export interface AlertStore { store_id: string; store_name: string; city: string | null; detail: string }
export interface Alert { key: string; label: string; severity: Severity; why: string; action: string; stores: AlertStore[] }

export interface AlertInput {
    today: string;
    stores: { store_id: string; store_name: string; city: string | null; live: boolean; pending_approval: boolean; is_franchise: boolean; last_warranty: string | null; rejected_30d: number }[];
    posm: PosmStoreRow[];
    /** Sell More (Option 1) stores: the reward they can ask for now, in sets. */
    sellMore: { store_id: string; due_sets: number; target: number | null; points: number }[];
    /** Buy More (Option 2) stores. */
    buyMore: { store_id: string; ready: boolean; requests: number; waiting_sets: number }[];
    /** Whether the program is open to stores (published and running). */
    programLive: boolean;
}

/** Quiet means no warranty for this many days. */
export const QUIET_DAYS = 30;

export function asmAlerts(x: AlertInput): Alert[] {
    const byId = new Map(x.stores.map(s => [s.store_id, s]));
    const row = (id: string, detail: string): AlertStore => ({ store_id: id, store_name: byId.get(id)?.store_name ?? '', city: byId.get(id)?.city ?? null, detail });
    const live = x.stores.filter(s => s.live);
    const inProgram = new Set([...x.sellMore.map(s => s.store_id), ...x.buyMore.map(s => s.store_id)]);
    const alerts: Alert[] = [
        {
            key: 'plant_overdue', label: 'POSM late from the plant', severity: 'critical',
            why: 'FRP or jackets past the date the plant gave, still not sent.', action: 'Tell the store it is on the way; head office is following up.',
            stores: x.posm.filter(p => p.overdue > 0).map(p => row(p.store_id, `${p.overdue} item${p.overdue === 1 ? '' : 's'} late`)),
        },
        {
            key: 'quiet', label: `No warranty in ${QUIET_DAYS}+ days`, severity: 'serious',
            why: 'Live stores that have stopped registering warranties.', action: 'Call or visit: check stock, display and staff.',
            stores: live.filter(s => s.last_warranty && daysBetween(s.last_warranty, x.today) >= QUIET_DAYS)
                .sort((a, b) => (a.last_warranty ?? '').localeCompare(b.last_warranty ?? ''))
                .map(s => row(s.store_id, `Last one ${daysBetween(s.last_warranty!, x.today)} days ago`)),
        },
        {
            key: 'never', label: 'No warranty yet', severity: 'serious',
            why: 'Live stores that have never registered a warranty.', action: 'Visit and show them how to register one.',
            stores: live.filter(s => !s.last_warranty).map(s => row(s.store_id, 'Never registered')),
        },
        {
            key: 'low_sales', label: 'High POSM, low sales', severity: 'serious',
            why: `Got FRP or ${LOW_SALES.jackets}+ jackets in the last ${LOW_SALES.months} months but registered under ${LOW_SALES.warranties} warranties.`,
            action: 'Check the display is up and the store is selling.',
            stores: x.posm.filter(p => p.low_sales).map(p => row(p.store_id, `${p.low_sales!.frp} FRP, ${p.low_sales!.jackets} jackets · ${p.low_sales!.warranties} warranties in 6 months`)),
        },
        {
            key: 'rejected', label: 'Warranties rejected (30 days)', severity: 'warning',
            why: 'Head office rejected warranties from these stores in the last 30 days.', action: 'Help the store fix the photos or invoice and register again.',
            stores: x.stores.filter(s => s.rejected_30d > 0).sort((a, b) => b.rejected_30d - a.rejected_30d).map(s => row(s.store_id, `${s.rejected_30d} rejected`)),
        },
        {
            key: 'posm_limit', label: 'POSM limit reached or over', severity: 'warning',
            why: 'More FRP or jackets for these stores needs head office approval.', action: 'Raise a request only if the store really needs more.',
            stores: x.posm.filter(p => p.approval === 'over' || p.approval === 'reached' || p.approval === 'new_used').map(p => row(p.store_id, p.approval_label)),
        },
        {
            key: 'pending_approval', label: 'Waiting for head office approval', severity: 'warning',
            why: 'Registered on the portal but not approved yet, so they cannot register warranties.', action: 'Check their details are complete.',
            stores: x.stores.filter(s => s.pending_approval).map(s => row(s.store_id, 'Not approved yet')),
        },
        {
            key: 'reward_ready', label: 'Reward ready to claim', severity: 'good',
            why: 'These stores have earned a Sell More / Buy More reward they have not asked for yet.', action: 'Remind them to claim it in Offers & Schemes.',
            stores: [
                ...x.sellMore.filter(s => s.due_sets > 0).map(s => row(s.store_id, `Sell More: ${s.due_sets} set${s.due_sets === 1 ? '' : 's'}`)),
                ...x.buyMore.filter(s => s.ready && !s.requests).map(s => row(s.store_id, 'Buy More: free set ready')),
            ],
        },
        {
            key: 'not_in_program', label: 'Not in the Sell More program', severity: 'warning',
            why: 'Live franchise stores that are not in Sell More or Buy More. Head office adds stores to the program.', action: 'If the store should be in it, ask head office to add it.',
            stores: x.programLive ? live.filter(s => s.is_franchise && !inProgram.has(s.store_id)).map(s => row(s.store_id, 'Not joined')) : [],
        },
    ];
    const order: Severity[] = ['critical', 'serious', 'warning', 'good'];
    return alerts.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}
