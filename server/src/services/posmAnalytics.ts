/**
 * POSM analytics for the Analytics page: what has been sent, what the plant
 * has open and for how long, how quickly orders turn round, the item mix, and
 * the risks worth acting on, each with the stores or lines behind it.
 *
 * Free of any database import, so it is tested directly.
 */
import { isPending, isSent, needsReason, summarise, DEFAULT_SETTINGS, type StoreSettings } from './posmHistory.js';

export interface ALine {
    id: string; source: string; store_id: string | null; store_code: string | null; store_name: string | null; item: string; qty: number; status: string;
    request_date: string | null; dispatch_date: string | null; expected_dispatch: string | null; reason: string | null; flags: string[]; request_id: number | null;
}

export type Severity = 'critical' | 'serious' | 'warning';
export interface Risk { key: string; label: string; severity: Severity; count: number; unit: 'stores' | 'lines'; why: string; action: string }

const SOURCES = ['Noida office', 'Plant - Ludhiana depot', 'Plant - Jaipur depot'] as const;
const isPlant = (s: string) => s.startsWith('Plant');
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const monthOf = (d: string) => d.slice(0, 7);
const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1) + 0.5))]; };

/** The 12 months up to `today`, oldest first. */
export function lastMonths(today: string, n = 12): string[] {
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    return Array.from({ length: n }, (_, i) => { const k = (y * 12 + m - 1) - (n - 1 - i); return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`; });
}

export const AGE_BUCKETS = [{ key: '0-7', min: 0, max: 7 }, { key: '8-15', min: 8, max: 15 }, { key: '16-30', min: 16, max: 30 }, { key: '31-60', min: 31, max: 60 }, { key: '60+', min: 61, max: Infinity }] as const;
const bucketOf = (n: number) => AGE_BUCKETS.find(b => n >= b.min && n <= b.max)!.key;

/** Which lines or stores a drill-down shows. */
export type Drill =
    | { kind: 'risk'; key: string }
    | { kind: 'month'; month: string; source?: string }
    | { kind: 'status'; status: string; source?: string }
    | { kind: 'age'; bucket: string }
    | { kind: 'item'; item: string }
    | { kind: 'tile'; key: string };

export interface StoreFacts { id: string; name: string; code: string | null; city: string | null; state: string | null; warranties6m: number }

/** Everything the POSM section shows. */
export function posmOverview(lines: ALine[], settings: Map<string, StoreSettings>, stores: Map<string, StoreFacts>, requests: { status: string }[], today: string) {
    const live = lines;
    const sent = live.filter(l => isSent(l.status));
    const months = lastMonths(today);
    const thisMonth = monthOf(today), lastMonth = months[months.length - 2];
    const qty = (ls: ALine[]) => ls.reduce((n, l) => n + l.qty, 0);
    const plantOpen = live.filter(l => isPlant(l.source) && isPending(l.status));
    const overdue = plantOpen.filter(l => l.expected_dispatch && l.expected_dispatch < today);
    const reasonMissing = live.filter(l => needsReason(l, today));

    /* Per store: totals and limits, and the "high POSM, low sales" check over the last 6 months. */
    const byStore = new Map<string, ALine[]>();
    for (const l of live) if (l.store_id) byStore.set(l.store_id, [...(byStore.get(l.store_id) ?? []), l]);
    const sixMonthsAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 182 * 86400000).toISOString().slice(0, 10);
    const storeRows = [...byStore.entries()].map(([id, ls]) => {
        const sum = summarise(ls, settings.get(id) ?? DEFAULT_SETTINGS);
        const recentKit = ls.filter(l => isSent(l.status) && (l.dispatch_date ?? '') >= sixMonthsAgo && (l.item === 'FRP' || l.item === 'Sample Jacket'));
        return { id, sum, recentFrp: qty(recentKit.filter(l => l.item === 'FRP')), recentJackets: qty(recentKit.filter(l => l.item === 'Sample Jacket')), facts: stores.get(id) };
    });
    const lowSales = storeRows.filter(s => (s.recentFrp >= 1 || s.recentJackets >= 20) && (s.facts?.warranties6m ?? 0) < 5);

    const risks: Risk[] = [
        { key: 'over', label: 'Over the FRP / jacket limit', severity: 'critical', unit: 'stores', count: storeRows.filter(s => s.sum.approval === 'over').length,
            why: 'These stores have been sent more FRP or Sample Jackets than their limit (FRP 2; jackets 20 for an old store, 30 for a new one).', action: 'Check why, and hold further FRP / jackets unless approved.' },
        { key: 'overdue', label: 'Overdue at the plant', severity: 'critical', unit: 'lines', count: overdue.length,
            why: 'Past the expected dispatch date and still not dispatched.', action: 'Follow up with the depot; the store is waiting.' },
        { key: 'low_sales', label: 'High POSM, low sales', severity: 'serious', unit: 'stores', count: lowSales.length,
            why: 'Got FRP or 20+ jackets in the last 6 months but registered fewer than 5 warranties in that time.', action: 'Ask the ASM to check the display is up and the store is selling.' },
        { key: 'reason', label: 'Held or late with no reason', severity: 'serious', unit: 'lines', count: reasonMissing.length,
            why: 'On hold, out of stock, or past the expected date, and the plant has not written why.', action: 'Ask the plant to fill in the reason.' },
        { key: 'pending_over', label: 'Plant order would cross the limit', severity: 'serious', unit: 'stores', count: storeRows.filter(s => s.sum.frp.state === 'pending_over' || s.sum.jacket.state === 'pending_over').length,
            why: 'What the plant is making now would take the store past its FRP / jacket limit.', action: 'Confirm it was approved before it is dispatched.' },
        { key: 'reached', label: 'Limit reached', severity: 'warning', unit: 'stores', count: storeRows.filter(s => s.sum.approval === 'reached' || s.sum.approval === 'new_used').length,
            why: 'Any more FRP or jackets for these stores needs approval.', action: 'Approve or decline new FRP / jacket requests from them.' },
        { key: 'duplicate', label: 'Possible duplicate lines', severity: 'warning', unit: 'lines', count: live.filter(l => l.flags.includes('possible_duplicate')).length,
            why: 'Two lines in the sheets look the same (same store, item, day and docket). Totals count both.', action: 'Open the store and remove the extra copy, or mark it not a duplicate.' },
        { key: 'qty', label: 'Quantity not written', severity: 'warning', unit: 'lines', count: live.filter(l => l.flags.includes('qty_not_written')).length,
            why: 'The sheet had no quantity; the portal counted 1.', action: 'Enter the real quantity on the line.' },
        { key: 'unlinked', label: 'Not linked to a store', severity: 'warning', unit: 'lines', count: live.filter(l => !l.store_id).length,
            why: 'Sent to a name the portal could not match to a store, so it counts for no store.', action: 'Link them in POSM Dispatch → Unlinked.' },
        { key: 'row_missing', label: 'Row missing in the sheet', severity: 'warning', unit: 'lines', count: live.filter(l => l.flags.includes('row_missing')).length,
            why: 'The line\'s row is no longer in the plant / Noida sheet.', action: 'Check whether it was deleted on purpose.' },
    ];

    /* Monthly dispatches by source: lines and quantity, by dispatch date. */
    const monthly = months.map(m => {
        const row: Record<string, number | string> = { month: m };
        for (const s of SOURCES) { const ls = sent.filter(l => l.source === s && (l.dispatch_date ?? '').startsWith(m)); row[s] = qty(ls); row[`${s} lines`] = ls.length; }
        return row;
    });

    /* The plant's open lines by status and depot. */
    const pipelineStatuses = ['Not updated', 'WIP', 'Ready to dispatch', 'On hold', 'Out of stock'];
    const pipeline = pipelineStatuses.map(st => ({
        status: st,
        'Plant - Ludhiana depot': plantOpen.filter(l => l.status === st && l.source === 'Plant - Ludhiana depot').length,
        'Plant - Jaipur depot': plantOpen.filter(l => l.status === st && l.source === 'Plant - Jaipur depot').length,
    }));

    /* How long the open plant lines have waited since asked. */
    const ageing = AGE_BUCKETS.map(b => ({ bucket: b.key, lines: plantOpen.filter(l => l.request_date && bucketOf(days(l.request_date, today)) === b.key).length }));

    /* Asked -> dispatched, per depot, over the last 6 months. */
    const turnaround = SOURCES.filter(isPlant).map(s => {
        const ds = sent.filter(l => l.source === s && l.request_date && l.dispatch_date && l.dispatch_date >= sixMonthsAgo).map(l => days(l.request_date!, l.dispatch_date!)).filter(d => d >= 0 && d < 400);
        return { source: s, lines: ds.length, median: pct(ds, 50), p90: pct(ds, 90) };
    });

    /* Quantity sent per item, most first. */
    const itemsMap = new Map<string, { qty: number; stores: Set<string> }>();
    for (const l of sent) { const x = itemsMap.get(l.item) ?? { qty: 0, stores: new Set() }; x.qty += l.qty; if (l.store_id) x.stores.add(l.store_id); itemsMap.set(l.item, x); }
    const items = [...itemsMap.entries()].map(([item, x]) => ({ item, qty: x.qty, stores: x.stores.size })).sort((a, b) => b.qty - a.qty);

    const sentThis = sent.filter(l => (l.dispatch_date ?? '').startsWith(thisMonth)), sentLast = sent.filter(l => (l.dispatch_date ?? '').startsWith(lastMonth));
    return {
        today,
        tiles: {
            items_sent: qty(sent), lines_sent: sent.length, stores_served: new Set(sent.map(l => l.store_id).filter(Boolean)).size,
            sent_this_month: qty(sentThis), sent_last_month: qty(sentLast),
            plant_open: plantOpen.length, plant_overdue: overdue.length,
            requests_waiting: requests.filter(r => ['open', 'under_review', 'pending'].includes(r.status)).length,
            requests_wip: requests.filter(r => r.status === 'in_production' || r.status === 'approved').length,
            stores_over: storeRows.filter(s => s.sum.approval === 'over').length,
        },
        risks: risks.sort((a, b) => ['critical', 'serious', 'warning'].indexOf(a.severity) - ['critical', 'serious', 'warning'].indexOf(b.severity) || b.count - a.count),
        monthly, pipeline, ageing, turnaround, items,
        sources: [...SOURCES],
    };
}

export interface DrillStore { store_id: string; store: string; code: string | null; place: string; frp: string; jackets: string; detail: string }
export interface DrillLine { id: string; store_id: string | null; store: string; code: string | null; source: string; item: string; qty: number; status: string; asked: string | null; dispatched: string | null; expected: string | null; detail: string }

const lineRow = (l: ALine, detail = ''): DrillLine => ({
    id: l.id, store_id: l.store_id, store: l.store_name ?? '(no store)', code: l.store_code, source: l.source.replace('Plant - ', '').replace(' depot', ''),
    item: l.item, qty: l.qty, status: l.status, asked: l.request_date, dispatched: l.dispatch_date, expected: l.expected_dispatch, detail,
});

/** The stores or lines behind one tile, bar, bucket or risk. */
export function posmDrill(d: Drill, lines: ALine[], settings: Map<string, StoreSettings>, stores: Map<string, StoreFacts>, today: string):
    { title: string; why?: string; type: 'stores' | 'lines'; rows: (DrillStore | DrillLine)[] } {
    const plantOpen = lines.filter(l => isPlant(l.source) && isPending(l.status));
    const storeRows = () => {
        const by = new Map<string, ALine[]>();
        for (const l of lines) if (l.store_id) by.set(l.store_id, [...(by.get(l.store_id) ?? []), l]);
        return [...by.entries()].map(([id, ls]) => ({ id, ls, sum: summarise(ls, settings.get(id) ?? DEFAULT_SETTINGS), f: stores.get(id) }));
    };
    const storeRow = (s: ReturnType<typeof storeRows>[number], detail: string): DrillStore => ({
        store_id: s.id, store: s.f?.name ?? s.ls[0]?.store_name ?? '', code: s.f?.code ?? null, place: [s.f?.city, s.f?.state].filter(Boolean).join(', '),
        frp: `${s.sum.frp.sent}${s.sum.frp.limit !== null ? ` / ${s.sum.frp.limit}` : ''}${s.sum.frp.pending ? ` (+${s.sum.frp.pending})` : ''}`,
        jackets: `${s.sum.jacket.sent}${s.sum.jacket.limit !== null ? ` / ${s.sum.jacket.limit}` : ''}${s.sum.jacket.pending ? ` (+${s.sum.jacket.pending})` : ''}`, detail,
    });
    if (d.kind === 'risk' || d.kind === 'tile') {
        const k = d.key;
        const six = new Date(Date.parse(`${today}T00:00:00Z`) - 182 * 86400000).toISOString().slice(0, 10);
        if (k === 'over' || k === 'stores_over') return { title: 'Over the FRP / jacket limit', type: 'stores', rows: storeRows().filter(s => s.sum.approval === 'over').map(s => storeRow(s, s.sum.frp.state === 'over' && s.sum.jacket.state === 'over' ? 'FRP and jackets over' : s.sum.frp.state === 'over' ? 'FRP over' : 'Jackets over')) };
        if (k === 'reached') return { title: 'Limit reached', type: 'stores', rows: storeRows().filter(s => s.sum.approval === 'reached' || s.sum.approval === 'new_used').map(s => storeRow(s, s.sum.approval === 'new_used' ? 'New store: one-time request used' : 'At the limit')) };
        if (k === 'pending_over') return { title: 'Plant order would cross the limit', type: 'stores', rows: storeRows().filter(s => s.sum.frp.state === 'pending_over' || s.sum.jacket.state === 'pending_over').map(s => storeRow(s, 'Pending at the plant would take it over')) };
        if (k === 'low_sales') return {
            title: 'High POSM, low sales', type: 'stores',
            rows: storeRows().map(s => {
                const kit = s.ls.filter(l => isSent(l.status) && (l.dispatch_date ?? '') >= six);
                const frp = kit.filter(l => l.item === 'FRP').reduce((n, l) => n + l.qty, 0), jk = kit.filter(l => l.item === 'Sample Jacket').reduce((n, l) => n + l.qty, 0);
                return { s, frp, jk };
            }).filter(x => (x.frp >= 1 || x.jk >= 20) && (x.s.f?.warranties6m ?? 0) < 5)
                .sort((a, b) => (a.s.f?.warranties6m ?? 0) - (b.s.f?.warranties6m ?? 0))
                .map(x => storeRow(x.s, `6 months: ${x.frp} FRP, ${x.jk} jackets sent · ${x.s.f?.warranties6m ?? 0} warranties`)),
        };
        if (k === 'overdue' || k === 'plant_overdue') return { title: 'Overdue at the plant', type: 'lines', rows: plantOpen.filter(l => l.expected_dispatch && l.expected_dispatch < today).sort((a, b) => (a.expected_dispatch ?? '').localeCompare(b.expected_dispatch ?? '')).map(l => lineRow(l, `${days(l.expected_dispatch!, today)} days late${l.reason ? ` · ${l.reason}` : ''}`)) };
        if (k === 'reason') return { title: 'Held or late with no reason', type: 'lines', rows: lines.filter(l => needsReason(l, today)).map(l => lineRow(l, l.status === 'On hold' || l.status === 'Out of stock' ? l.status : 'Past the expected date')) };
        if (k === 'plant_open') return { title: 'Open at the plant', type: 'lines', rows: plantOpen.map(l => lineRow(l, l.reason ?? '')) };
        if (k === 'duplicate' || k === 'qty' || k === 'row_missing') {
            const flag = k === 'duplicate' ? 'possible_duplicate' : k === 'qty' ? 'qty_not_written' : 'row_missing';
            return { title: k === 'duplicate' ? 'Possible duplicate lines' : k === 'qty' ? 'Quantity not written' : 'Row missing in the sheet', type: 'lines', rows: lines.filter(l => l.flags.includes(flag)).map(l => lineRow(l)) };
        }
        if (k === 'unlinked') return { title: 'Not linked to a store', type: 'lines', rows: lines.filter(l => !l.store_id).map(l => lineRow(l)) };
        if (k === 'items_sent' || k === 'stores_served') return { title: 'Stores served', type: 'stores', rows: storeRows().filter(s => s.ls.some(l => isSent(l.status))).map(s => storeRow(s, `${s.ls.filter(l => isSent(l.status)).reduce((n, l) => n + l.qty, 0)} items sent`)) };
        if (k === 'sent_this_month') return { title: 'Sent this month', type: 'lines', rows: lines.filter(l => isSent(l.status) && (l.dispatch_date ?? '').startsWith(today.slice(0, 7))).map(l => lineRow(l)) };
        return { title: 'Nothing to show', type: 'lines', rows: [] };
    }
    if (d.kind === 'month') return { title: `Sent in ${d.month}${d.source ? ` · ${d.source}` : ''}`, type: 'lines', rows: lines.filter(l => isSent(l.status) && (l.dispatch_date ?? '').startsWith(d.month) && (!d.source || l.source === d.source)).map(l => lineRow(l)) };
    if (d.kind === 'status') return { title: `Open at the plant: ${d.status}${d.source ? ` · ${d.source.replace('Plant - ', '')}` : ''}`, type: 'lines', rows: plantOpen.filter(l => l.status === d.status && (!d.source || l.source === d.source)).map(l => lineRow(l, l.reason ?? '')) };
    if (d.kind === 'age') return { title: `Open at the plant, asked ${d.bucket} days ago`, type: 'lines', rows: plantOpen.filter(l => l.request_date && bucketOf(days(l.request_date, today)) === d.bucket).sort((a, b) => (a.request_date ?? '').localeCompare(b.request_date ?? '')).map(l => lineRow(l, `${days(l.request_date!, today)} days`)) };
    if (d.kind === 'item') {
        const by = new Map<string, number>();
        for (const l of lines) if (isSent(l.status) && l.item === d.item && l.store_id) by.set(l.store_id, (by.get(l.store_id) ?? 0) + l.qty);
        return { title: `${d.item}: stores that got it`, type: 'stores', rows: storeRows().filter(s => by.has(s.id)).sort((a, b) => (by.get(b.id) ?? 0) - (by.get(a.id) ?? 0)).map(s => storeRow(s, `${by.get(s.id)} sent`)) };
    }
    return { title: 'Nothing to show', type: 'lines', rows: [] };
}
