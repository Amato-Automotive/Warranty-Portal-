import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { posmRepository } from '../repositories/posm.repository.js';
import { NotificationService } from './notification.service.js';
import { requestStatus, stageOf, STAGE_TEXT, type LineStage } from './posmLineFlow.js';
import { DEPOTS, NOIDA_SOURCE, type Depot } from './posmHistory.js';
import { designOf, dispatchItemName, isPlantItem, nextLineStatus, stageForStatus } from './posmSyncRules.js';

/**
 * Keeps POSM request items and POSM dispatch lines in step, both ways
 * (rules in posmSyncRules). A dispatch line made from a request item carries
 * request_id and request_line.
 */

const istDay = (v: Date | string = new Date()) => new Date(new Date(v).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const day = (v: unknown) => (v instanceof Date ? istDay(v) : v ? String(v).slice(0, 10) : null);

/** The store's code, name, place, and the distributor / ASM its latest POSM line gave. */
async function storeFor(storeId: string) {
    const [[s]]: any = await db.execute('SELECT id, store_code, store_name, city, state FROM vendor_details WHERE id = ?', [storeId]);
    if (!s) return null;
    const [[last]]: any = await db.execute(
        `SELECT distributor, asm FROM posm_dispatch_history WHERE store_id = ? AND deleted_at IS NULL AND (distributor IS NOT NULL OR asm IS NOT NULL)
          ORDER BY COALESCE(dispatch_date, request_date) DESC LIMIT 1`, [storeId]);
    let distributor = last?.distributor ?? null;
    if (!distributor) {
        const [[d]]: any = await db.execute(
            `SELECT GROUP_CONCAT(d.name ORDER BY d.name SEPARATOR ', ') AS names FROM franchise_distributors fd JOIN distributors d ON d.id = fd.distributor_id
               JOIN vendor_details vd ON vd.user_id = fd.franchise_user_id WHERE vd.id = ?`, [storeId]);
        distributor = d?.names ?? null;
    }
    return { id: String(s.id), store_code: s.store_code ?? null, store_name: String(s.store_name ?? '').trim(), city: s.city ?? null, state: s.state ?? null, distributor, asm: last?.asm ?? null };
}

/**
 * The admin's steps on a request's items, onto their dispatch lines: a line
 * is made when an item is approved, follows its step, quantity and shipment,
 * and is taken out (kept, marked deleted) when the item is rejected or sent
 * back to waiting. `indexes` limits it to the items just touched.
 */
export async function syncRequestToDispatch(requestId: number, indexes?: number[], byUser: string | null = null) {
    const r: any = await posmRepository.findRequest(requestId);
    const lines: any[] = Array.isArray(r?.items) ? r.items : [];
    if (!r || !lines.length) return;
    let store: Awaited<ReturnType<typeof storeFor>> | undefined;
    for (const i of indexes ?? lines.map((_, k) => k)) {
        const line = lines[i];
        if (!line) continue;
        const stage = stageOf(line);
        const [[row]]: any = await db.execute('SELECT * FROM posm_dispatch_history WHERE request_id = ? AND request_line = ?', [requestId, i]);
        const status = nextLineStatus(row && !row.deleted_at ? row.status : null, stage);
        if (!status) {
            if (row && !row.deleted_at) await db.execute('UPDATE posm_dispatch_history SET deleted_at = NOW(), updated_by = ? WHERE id = ?', [byUser, row.id]);
            continue;
        }
        const plant = isPlantItem(line.item_id);
        const source = plant ? DEPOTS[line.depot as Depot] : NOIDA_SOURCE;
        if (!source) { console.warn(`[POSM sync] ${r.ticket_id} item ${i}: no depot picked, not sent to the plant`); continue; }
        const d = designOf(line.display);
        const qty = Number(line.approved_qty ?? line.qty) || 1;
        const ship = line.dispatch?.courier ? line.dispatch : null;
        const shipped = stage === 'dispatched' || stage === 'delivered';
        const dispatchDate = shipped ? (ship?.date ?? day(row?.dispatch_date) ?? istDay()) : day(row?.dispatch_date);
        const deliveryDate = stage === 'delivered' ? (line.delivered_at ? istDay(line.delivered_at) : day(row?.delivery_date) ?? istDay()) : null;
        const reason = stage === 'on_hold' ? (line.note ?? row?.reason ?? null) : (row?.reason ?? null);
        if (row) {
            await db.execute(
                `UPDATE posm_dispatch_history SET status = ?, qty = ?, dispatch_date = ?, delivery_date = ?, courier = ?, docket_no = ?, reason = ?, deleted_at = NULL, updated_by = ?
                    ${row.status !== status ? ', status_changed_on = ?' : ''} WHERE id = ?`,
                [status, qty, dispatchDate, deliveryDate, ship?.courier ?? (shipped ? row.courier : row.courier), ship?.tracking ?? row.docket_no ?? null, reason, byUser,
                    ...(row.status !== status ? [istDay()] : []), row.id]);
        } else {
            store ??= await storeFor(String(r.franchise_id));
            await db.execute(
                `INSERT INTO posm_dispatch_history (id, source, store_id, store_code, sheet_store_name, city, state, distributor, asm, item, design, major_colour, minor_colour,
                    qty, status, request_date, dispatch_date, delivery_date, courier, docket_no, reason, remarks, dispatch_to, flags, import_batch, request_id, request_line, updated_by, status_changed_on)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'request', ?, ?, ?, ?)`,
                [uuidv4(), source, store?.id ?? r.franchise_id, store?.store_code ?? null, store?.store_name ?? r.store_name ?? null, store?.city ?? null, store?.state ?? null,
                    store?.distributor ?? null, store?.asm ?? null, dispatchItemName(line.item_id, line.item_name),
                    plant ? d.design : null, plant ? d.major_colour : null, plant ? d.minor_colour : null,
                    qty, status, istDay(r.created_at), dispatchDate, deliveryDate, ship?.courier ?? null, ship?.tracking || null, reason,
                    `Request ${r.ticket_id}${line.note && stage !== 'on_hold' ? ` · ${line.note}` : ''}`.slice(0, 1000), d.dispatch_to,
                    requestId, i, byUser, istDay()]);
        }
    }
}

const WHO: Record<string, string> = { plant: 'the plant', noida: 'the Noida office', admin: 'head office' };

/**
 * A change on a dispatch line made from a request, back onto the request's
 * item: its step (with the reason or the shipment), its quantity, its
 * shipment details. Written on the request's timeline as who did it; the
 * store is told when it is dispatched, delivered or put on hold.
 */
export async function syncDispatchToRequest(lineId: string, by: { id: string | null; name: string | null }, side: 'plant' | 'noida' | 'admin') {
    const [[row]]: any = await db.execute('SELECT * FROM posm_dispatch_history WHERE id = ?', [lineId]);
    if (!row?.request_id || row.deleted_at) return;
    const r: any = await posmRepository.findRequest(Number(row.request_id));
    const lines: any[] = Array.isArray(r?.items) ? r.items.map((l: any) => ({ ...l })) : [];
    const i = Number(row.request_line);
    const line = lines[i];
    if (!r || !line) return;
    const cur = stageOf(line);
    if (cur === 'pending' || cur === 'rejected') return;
    const stage = stageForStatus(row.status) as LineStage | null;
    const out = { ...line };
    const said: string[] = [];
    const qty = Number(row.qty);
    if (qty && qty !== Number(line.approved_qty ?? line.qty)) { out.approved_qty = qty; said.push(`quantity ${line.approved_qty ?? line.qty} → ${qty}`); }
    const dispatchDay = day(row.dispatch_date);
    const ship = { courier: row.courier || line.dispatch?.courier || 'By the plant', tracking: row.docket_no || '', date: dispatchDay };
    if (stage && stage !== cur) {
        out.trail = [...(line.trail ?? []), { line_status: cur, approved_qty: line.approved_qty ?? null, note: line.note ?? null, dispatch: line.dispatch ?? null, delivered_at: line.delivered_at ?? null, delivered_by: line.delivered_by ?? null }];
        out.line_status = stage;
        if (stage === 'on_hold') out.note = row.reason || line.note || null;
        if (stage === 'dispatched' || stage === 'delivered') out.dispatch = ship;
        if (stage === 'delivered') { out.delivered_at = row.delivery_date ? `${day(row.delivery_date)}T12:00:00+05:30` : new Date().toISOString(); out.delivered_by = 'admin'; }
        else { out.delivered_at = null; out.delivered_by = null; }
        said.unshift(STAGE_TEXT[stage].toLowerCase());
    } else if ((cur === 'dispatched' || cur === 'delivered') && (line.dispatch?.courier !== ship.courier || (line.dispatch?.tracking ?? '') !== ship.tracking || (line.dispatch?.date ?? null) !== ship.date)) {
        out.dispatch = ship;
        said.push('shipment updated');
    }
    if (!said.length) return;
    lines[i] = out;
    const status = requestStatus(lines, r.status);
    let note = `${line.item_name}: ${said.join(', ')} (by ${WHO[side]})`;
    if (stage === 'dispatched' && stage !== cur) note += ` · ${[ship.courier, ship.tracking].filter(Boolean).join(' · ')}`;
    if (stage === 'on_hold' && stage !== cur && out.note) note += ` · ${String(out.note).slice(0, 200)}`;
    const shipped = [...lines].reverse().find((l: any) => l.dispatch?.courier);
    await posmRepository.updateRequest(r.id, {
        items: lines, ...(status !== r.status ? { status } : {}), dispatch: shipped?.dispatch ? { ...shipped.dispatch } : null,
        history: [...(r.history ?? []), { action: 'item', status, at: new Date().toISOString(), by_role: 'admin', by: by.id, by_name: by.name, note, lines: [i] }],
    });
    if (stage && stage !== cur && ['dispatched', 'delivered', 'on_hold'].includes(stage) && r.store_user_id) {
        try { await NotificationService.notify(r.store_user_id, { title: `POSM ${r.ticket_id}: ${line.item_name} ${STAGE_TEXT[stage].toLowerCase()}`.slice(0, 180), message: note.slice(0, 300), type: 'posm' }); }
        catch (e) { console.error('[POSM sync] could not notify the store:', e); }
    }
}
