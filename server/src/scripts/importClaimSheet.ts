/**
 * Brings the production sheet's ALTERATION rows in as claims.
 *
 *   npx tsx src/scripts/importClaimSheet.ts <rows.json>            what it would do; writes nothing
 *   npx tsx src/scripts/importClaimSheet.ts <rows.json> --apply    writes it
 *
 * <rows.json> is the tab as a list of { column: value } rows (each with _row,
 * its row in the sheet). A row already brought in (same alteration no. and
 * date) is updated from the sheet, not added again. --apply also removes the
 * three test claims on the test warranty. Nobody is told: these are old rows.
 */
import fs from 'fs';
import db from '../config/database.js';
import { readSheetRow, type SheetClaim } from '../services/claimSheet.js';
import { PROBLEMS } from '../services/claimFlow.js';

const TEST_WARRANTY = '99990000000001';
const TEST_CLAIMS = ['WC-0003', 'WC-0004', 'WC-0005'];

const [file, flag] = process.argv.slice(2);
const apply = flag === '--apply';
const rows: any[] = JSON.parse(fs.readFileSync(file, 'utf-8'));

const [stores]: any = await db.execute('SELECT id, store_name FROM vendor_details');
const norm = (s: string) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** The one store a sheet name means, or none when it matches no store or several. */
function storeOf(name: string): string | null {
    const k = norm(name);
    if (k.length < 3) return null;
    const exact = stores.filter((s: any) => norm(s.store_name) === k);
    if (exact.length === 1) return exact[0].id;
    const near = stores.filter((s: any) => { const n = norm(s.store_name); return n.length > 4 && (n.includes(k) || k.includes(n)); });
    return near.length === 1 ? near[0].id : null;
}

const claims: (SheetClaim & { store_id: string | null })[] = [];
const skipped: string[] = [];
// One alteration no. can cover two parts on the same day: the second is "#2", in sheet order.
const seen = new Map<string, number>();
for (const r of rows) {
    const c = readSheetRow(r, r._row);
    if ('skip' in c) { skipped.push(c.skip); continue; }
    const n = (seen.get(c.key) ?? 0) + 1;
    seen.set(c.key, n);
    const key = n > 1 ? `${c.key}#${n}` : c.key;
    claims.push({ ...c, key, snapshot: { ...c.snapshot, sheet_key: key }, store_id: storeOf(c.store_name) });
}

const [had]: any = await db.execute(`SELECT id, JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.sheet_key')) AS k FROM warranty_claims WHERE raised_via = 'sheet'`);
const existing = new Map<string, number>(had.map((x: any) => [x.k, x.id]));
const [tests]: any = await db.execute(
    `SELECT id, claim_no FROM warranty_claims WHERE warranty_uid = ? AND claim_no IN (${TEST_CLAIMS.map(() => '?').join(',')})`, [TEST_WARRANTY, ...TEST_CLAIMS]);

const count = (f: (c: typeof claims[number]) => string) => Object.entries(claims.reduce<Record<string, number>>((a, c) => { const k = f(c); a[k] = (a[k] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
const dupKeys = claims.length - new Set(claims.map(c => c.key)).size;
console.log(`\nSheet rows: ${rows.length} · to bring in: ${claims.length} · left out: ${skipped.length}${dupKeys ? ` · repeated keys: ${dupKeys}` : ''}`);
skipped.forEach(s => console.log('  left out:', s));
console.log(`New: ${claims.filter(c => !existing.has(c.key)).length} · already in, to update: ${claims.filter(c => existing.has(c.key)).length}`);
console.log('Status:', count(c => c.status));
console.log('Charge:', count(c => c.decision.charge ?? ''));
console.log('Issue:', count(c => PROBLEMS[c.problem]?.label ?? c.problem));
console.log(`Store found: ${claims.filter(c => c.store_id).length} · kept as the sheet's name only: ${claims.filter(c => !c.store_id).length}`);
console.log('Dispatch details:', claims.filter(c => c.dispatch).length, '· on hold:', claims.filter(c => c.hold).length);
console.log('Test claims to remove:', tests.map((t: any) => t.claim_no).join(', ') || 'none');
console.log('Reasons read as "Other":', [...new Set(claims.filter(c => c.problem === 'other').map(c => c.description))].join(' | ') || 'none');

if (!apply) { console.log('\nDry run: nothing written. Run with --apply to write.'); process.exit(0); }

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
const conn = await (db as any).getConnection();
try {
    await conn.beginTransaction();
    if (tests.length) await conn.execute(`DELETE FROM warranty_claims WHERE id IN (${tests.map(() => '?').join(',')})`, tests.map((t: any) => t.id));
    let added = 0, updated = 0;
    for (const c of claims) {
        const fields = [c.kind, c.store_id, c.problem, c.description, json(c.vehicle), json(c.snapshot), c.status, json(c.decision), json(c.plan), json(c.dispatch), json(c.hold)];
        const id = existing.get(c.key);
        if (id) {
            await conn.execute(`UPDATE warranty_claims SET kind = ?, store_id = ?, problem = ?, description = ?, vehicle = ?, snapshot = ?, status = ?,
                decision = ?, plan_info = ?, dispatch = ?, hold_info = ? WHERE id = ?`, [...fields, id]);
            updated++;
            continue;
        }
        const history = [{ action: 'raised', status: c.status, text: `Brought in from the production sheet (row ${c.snapshot.sheet_row})`, at: c.created_at, by_role: 'admin', by_name: 'Production sheet' }];
        const [r]: any = await conn.execute(
            `INSERT INTO warranty_claims (kind, store_id, problem, description, vehicle, snapshot, status, decision, plan_info, dispatch, hold_info,
                warranty_uid, raised_by_role, raised_via, media, history, trail, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'admin', 'sheet', '[]', ?, '[]', ?)`,
            [...fields, json(history), c.created_at.slice(0, 10) + ' 00:00:00']);
        await conn.execute('UPDATE warranty_claims SET claim_no = ? WHERE id = ?', [`WC-${String(r.insertId).padStart(4, '0')}`, r.insertId]);
        added++;
    }
    await conn.commit();
    console.log(`\nWritten: ${added} added, ${updated} updated, ${tests.length} test claims removed.`);
} catch (e) {
    await conn.rollback();
    console.error('Nothing written:', e);
    process.exitCode = 1;
} finally {
    conn.release();
}
process.exit();
