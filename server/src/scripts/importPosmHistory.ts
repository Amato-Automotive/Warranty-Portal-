/**
 * Brings the POSM dispatch history in from the combined sheet.
 *
 *   npx tsx src/scripts/importPosmHistory.ts <posm_import.json>            what it would do; writes nothing
 *   npx tsx src/scripts/importPosmHistory.ts <posm_import.json> --apply    writes it
 *
 * <posm_import.json> is built from POSM_Dispatch_Combined.xlsx: { lines, settings }.
 * Each line is linked to a store by its store code, looked up again here so it
 * matches the portal as it is now. Lines with no portal store go in with no
 * store ("Unlinked"). A store's type and limits are only added where it has
 * none yet, so nothing an admin set is overwritten. One batch runs once.
 */
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { readStatus, readStoreType, summarise, DEFAULT_SETTINGS, POSM_ITEMS } from '../services/posmHistory.js';

const BATCH = 'combined-2026-11-26';
const [file, flag] = process.argv.slice(2);
const apply = flag === '--apply';
const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
const lines: any[] = data.lines;

const [[done]]: any = await db.execute('SELECT COUNT(*) AS n FROM posm_dispatch_history WHERE import_batch = ?', [BATCH]);
if (Number(done.n) > 0) { console.log(`Batch ${BATCH} is already in (${done.n} lines). Nothing to do.`); process.exit(0); }

const [stores]: any = await db.execute('SELECT id, store_code FROM vendor_details WHERE store_code IS NOT NULL');
const byCode = new Map<string, string>(stores.map((s: any) => [String(s.store_code).trim().toUpperCase(), String(s.id)]));
const [existing]: any = await db.execute('SELECT store_id FROM posm_store_settings');
const hasSettings = new Set(existing.map((r: any) => String(r.store_id)));

const unknownItems = new Set<string>();
const rows = lines.map(l => {
    if (!(POSM_ITEMS as readonly string[]).includes(l.item)) unknownItems.add(l.item);
    return { ...l, store_id: l.store_code ? byCode.get(String(l.store_code).toUpperCase()) ?? null : null, status: readStatus(l.status), qty: Math.max(1, Math.floor(Number(l.qty) || 1)) };
});
const settings = (data.settings as any[])
    .map(s => ({ ...s, store_id: byCode.get(String(s.store_code).toUpperCase()) ?? null, ...readStoreType(s.type) }))
    .filter(s => s.store_id && !hasSettings.has(s.store_id));

/* What it would do. */
const by = (f: (r: any) => string) => rows.reduce((m: Record<string, number>, r) => { const k = f(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const linked = rows.filter(r => r.store_id);
const perStore = new Map<string, any[]>();
for (const r of linked) perStore.set(r.store_id, [...(perStore.get(r.store_id) ?? []), r]);
const setOf = new Map(settings.map(s => [s.store_id, { store_type: s.store_type, type_assumed: s.type_assumed, frp_limit: s.frp_limit, jacket_limit: s.jacket_limit }]));
const approval: Record<string, number> = {};
for (const [id, ls] of perStore) { const a = summarise(ls, (setOf.get(id) as any) ?? DEFAULT_SETTINGS).approval; approval[a] = (approval[a] ?? 0) + 1; }
const flags: Record<string, number> = {};
for (const r of rows) for (const f of r.flags) flags[f] = (flags[f] ?? 0) + 1;

console.log(`Batch ${BATCH} from ${data.built_from}`);
console.log(`Lines: ${rows.length} (linked to a store ${linked.length}, unlinked ${rows.length - linked.length})`);
console.log('By source:', by(r => r.source));
console.log('By status:', by(r => r.status));
console.log(`Stores with history: ${perStore.size}; their position:`, approval);
console.log('Flags:', flags);
console.log(`Store settings to add: ${settings.length} (old ${settings.filter(s => s.store_type === 'old' && !s.type_assumed).length}, old assumed ${settings.filter(s => s.type_assumed).length}, new ${settings.filter(s => s.store_type === 'new').length}); already set, left alone: ${hasSettings.size}`);
if (unknownItems.size) console.log('Items not in the list (kept as written):', [...unknownItems]);

if (!apply) { console.log('\nNothing written. Run again with --apply to write it.'); process.exit(0); }

const conn = await db.getConnection();
try {
    await conn.beginTransaction();
    const cols = ['id', 'source', 'store_id', 'store_code', 'sheet_store_name', 'city', 'state', 'distributor', 'asm', 'item', 'design', 'major_colour', 'minor_colour', 'brand', 'store_kind',
        'qty', 'status', 'request_date', 'dispatch_date', 'delivery_date', 'expected_dispatch', 'status_changed_on', 'courier', 'docket_no', 'dispatched_by', 'reason', 'remarks', 'address', 'match_note',
        'flags', 'import_batch', 'sheet_row'];
    for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200).map(r => cols.map(c =>
            c === 'id' ? uuidv4() : c === 'flags' ? JSON.stringify(r.flags ?? []) : c === 'import_batch' ? BATCH : (r[c] ?? null)));
        await conn.query(`INSERT INTO posm_dispatch_history (${cols.join(', ')}) VALUES ?`, [chunk]);
    }
    for (const s of settings) {
        await conn.execute('INSERT IGNORE INTO posm_store_settings (store_id, store_type, type_assumed, frp_limit, jacket_limit) VALUES (?, ?, ?, ?, ?)',
            [s.store_id, s.store_type, s.type_assumed ? 1 : 0, s.frp_limit, s.jacket_limit]);
    }
    await conn.commit();
    console.log(`\nWritten: ${rows.length} lines, ${settings.length} store settings (batch ${BATCH}).`);
} catch (e) {
    await conn.rollback();
    console.error('Failed, nothing written:', e);
    process.exitCode = 1;
} finally {
    conn.release();
}
process.exit();
