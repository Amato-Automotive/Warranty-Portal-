/**
 * Brings the open POSM request items (approved, WIP, on hold; not yet
 * dispatched) into POSM dispatch, once, when the request <-> dispatch sync goes live.
 *
 *   npx tsx src/scripts/linkOpenPosmRequests.ts            what it would do; writes nothing
 *   npx tsx src/scripts/linkOpenPosmRequests.ts --apply    writes it
 *
 *  - FRP / Sample jacket already on a plant line (from the plant sheet): the
 *    item is linked to that line, no new line. Where the quantities differ the
 *    plant's wins (decided 26 Nov). The item's depot becomes the line's depot.
 *  - FRP / Sample jacket not on any plant line: sent to the Ludhiana depot
 *    (decided 26 Nov) as a new plant line.
 *  - Everything else: a new Noida office line.
 */
import db from '../config/database.js';
import { posmRepository } from '../repositories/posm.repository.js';
import { stageOf } from '../services/posmLineFlow.js';
import { stageForStatus, isPlantItem, designOf } from '../services/posmSyncRules.js';
import { syncRequestToDispatch } from '../services/posmSync.service.js';

const apply = process.argv.includes('--apply');
const NEW_PLANT_DEPOT = 'ludhiana' as const;
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const dayOf = (v: any) => (v ? new Date(new Date(v).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : '');

const [reqs]: any = await db.query(`SELECT id, ticket_id, franchise_id, created_at FROM posm_requests WHERE items IS NOT NULL ORDER BY id`);
const used = new Set<string>();
const plan: { kind: 'link' | 'plant' | 'noida'; requestId: number; ticket: string; i: number; text: string; lineId?: string; depot?: string; qty?: number }[] = [];

for (const r of reqs) {
    const req: any = await posmRepository.findRequest(r.id);
    const lines: any[] = req.items ?? [];
    for (const [i, l] of lines.entries()) {
        if (!['approved', 'in_production', 'on_hold'].includes(stageOf(l))) continue;
        const [[already]]: any = await db.execute('SELECT id FROM posm_dispatch_history WHERE request_id = ? AND request_line = ?', [r.id, i]);
        if (already) continue;
        const what = `${r.ticket_id} ${req.store_name} · ${l.item_name}${designOf(l.display).design ? ` ${designOf(l.display).design}` : ''} ×${l.approved_qty ?? l.qty}`;
        if (!isPlantItem(l.item_id)) { plan.push({ kind: 'noida', requestId: r.id, ticket: r.ticket_id, i, text: what }); continue; }
        const item = l.item_id === 'frp' ? 'FRP' : 'Sample Jacket';
        const design = norm(designOf(l.display).design);
        const [cands]: any = await db.execute(
            `SELECT id, source, design, qty, status, request_date FROM posm_dispatch_history
              WHERE store_id = ? AND item = ? AND deleted_at IS NULL AND request_id IS NULL AND source LIKE 'Plant%'`, [r.franchise_id, item]);
        const open = cands.filter((c: any) => !used.has(c.id) && ['approved', 'in_production', 'on_hold'].includes(stageForStatus(c.status) ?? '')
            && (item === 'Sample Jacket' || (norm(c.design).slice(0, 4) && (design.includes(norm(c.design).slice(0, 4)) || norm(c.design).includes(design.slice(0, 4))))));
        /* The plant line asked for nearest the request's date. */
        const made = new Date(r.created_at).getTime();
        open.sort((a: any, b: any) => Math.abs(new Date(a.request_date ?? 0).getTime() - made) - Math.abs(new Date(b.request_date ?? 0).getTime() - made));
        const hit = open[0];
        if (hit) {
            used.add(hit.id);
            const depot = /Jaipur/i.test(hit.source) ? 'jaipur' : 'ludhiana';
            const qtyNote = Number(hit.qty) !== Number(l.approved_qty ?? l.qty) ? ` · quantity ${l.approved_qty ?? l.qty} → ${hit.qty} (plant's)` : '';
            plan.push({ kind: 'link', requestId: r.id, ticket: r.ticket_id, i, lineId: hit.id, depot, qty: Number(hit.qty), text: `${what} → ${hit.source.replace('Plant - ', '')} ${hit.design ?? ''} ×${hit.qty} ${hit.status} (asked ${dayOf(hit.request_date)})${qtyNote}` });
        } else {
            plan.push({ kind: 'plant', requestId: r.id, ticket: r.ticket_id, i, depot: NEW_PLANT_DEPOT, text: `${what} → new line, ${NEW_PLANT_DEPOT} depot` });
        }
    }
}

for (const k of ['link', 'plant', 'noida'] as const) {
    const p = plan.filter(x => x.kind === k);
    console.log(`\n${k === 'link' ? 'Link to the existing plant line' : k === 'plant' ? 'New plant line' : 'New Noida office line'} (${p.length}):`);
    for (const x of p) console.log('  ' + x.text);
}
if (!apply) { console.log('\nNothing written. Run again with --apply to write it.'); process.exit(0); }

const by = 'linkOpenPosmRequests';
for (const x of plan) {
    const req: any = await posmRepository.findRequest(x.requestId);
    const lines: any[] = req.items.map((l: any) => ({ ...l }));
    const l = lines[x.i];
    if (x.kind === 'link') {
        const qtyChanged = x.qty && x.qty !== Number(l.approved_qty ?? l.qty);
        lines[x.i] = { ...l, depot: x.depot, ...(qtyChanged ? { approved_qty: x.qty } : {}) };
        await db.execute('UPDATE posm_dispatch_history SET request_id = ?, request_line = ? WHERE id = ? AND request_id IS NULL', [x.requestId, x.i, x.lineId ?? null]);
        await posmRepository.updateRequest(x.requestId, {
            items: lines,
            history: [...(req.history ?? []), { action: 'item', status: req.status, at: new Date().toISOString(), by_role: 'admin', by: null, by_name: 'Head office',
                note: `${l.item_name}: linked to the plant's line${qtyChanged ? `; quantity ${l.approved_qty ?? l.qty} → ${x.qty}, as the plant is making` : ''}`, lines: [x.i] }],
        });
    } else {
        if (x.kind === 'plant') { lines[x.i] = { ...l, depot: x.depot }; await posmRepository.updateRequest(x.requestId, { items: lines }); }
        await syncRequestToDispatch(x.requestId, [x.i], null);
    }
    console.log('done:', x.text);
}
console.log(`\nWritten (${by}): ${plan.filter(x => x.kind === 'link').length} linked, ${plan.filter(x => x.kind === 'plant').length} new plant lines, ${plan.filter(x => x.kind === 'noida').length} new Noida lines.`);
process.exit(0);
