/**
 * Brings the Old Warranty Placement page's decisions into the portal (28 Nov
 * 2026): every old store name (name + email as the old portal wrote them),
 * whether it is placed on a store, has no store in the portal, or is still
 * open, with the suggested stores and notes; then links the placed names'
 * warranties to their stores (store_id; store_name stays as written, so it
 * can be undone). From then on Admin › Old Warranties places and moves them.
 *
 * The plan file: JSON array of { id, name, email, rows, first, last, state,
 * store_id, grade, candidates, note, decided_at }.
 *
 *   npx tsx src/scripts/importOldWarrantyGroups.ts plan_groups.json           (dry run)
 *   npx tsx src/scripts/importOldWarrantyGroups.ts plan_groups.json --apply
 */
import fs from 'fs';
import db from '../config/database.js';
import { GROUP_MATCH, groupArgs } from '../services/oldWarrantyGroups.js';

const file = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!file) { console.error('Give the plan file'); process.exit(1); }
type G = { id: string; name: string | null; email: string | null; rows: number; first: string | null; last: string | null; state: 'placed' | 'no_store' | 'open'; store_id: string | null; grade: string | null; candidates: unknown[]; note: string | null; decided_at: string | null };
const plan: G[] = JSON.parse(fs.readFileSync(file, 'utf8'));

const stores = [...new Set(plan.filter(g => g.store_id).map(g => g.store_id!))];
const [ok]: any = await db.query('SELECT id FROM vendor_details WHERE id IN (?)', [stores]);
const known = new Set(ok.map((r: any) => String(r.id)));
const missing = stores.filter(s => !known.has(s));
if (missing.length) { console.error('Stores not found:', missing.join(', ')); process.exit(1); }
const [[had]]: any = await db.query('SELECT COUNT(*) AS n FROM old_warranty_groups');
if (Number(had.n) && APPLY) { console.error(`old_warranty_groups already has ${had.n} rows: this import runs once.`); process.exit(1); }

let linked = 0, differ = 0;
const tally = { placed: 0, no_store: 0, open: 0 } as Record<string, number>;
for (const g of plan) {
    const k = { store_name: g.name, store_email: g.email };
    const [[c]]: any = await db.query(`SELECT COUNT(*) AS n FROM old_warranties_seatcovers WHERE ${GROUP_MATCH}`, groupArgs(k));
    if (Number(c.n) !== g.rows) { differ++; console.log(`  rows differ: ${g.name} | ${g.email ?? '(no email)'}: plan ${g.rows}, table ${c.n}`); }
    tally[g.state] += Number(c.n);
    if (!APPLY) { if (g.state === 'placed') linked += Number(c.n); continue; }
    await db.query(
        `INSERT INTO old_warranty_groups (id, store_name, store_email, rows_count, period_first, period_last, state, store_id, grade, candidates, note, decided_by, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Placement page', ?)`,
        [g.id, g.name, g.email, Number(c.n), g.first, g.last, g.state, g.store_id, g.grade, JSON.stringify(g.candidates ?? []), g.note, g.decided_at ? new Date(g.decided_at) : null]);
    if (g.state === 'placed') {
        const [r]: any = await db.query(`UPDATE old_warranties_seatcovers SET store_id = ?, store_linked_at = NOW() WHERE ${GROUP_MATCH} AND store_id IS NULL`, [g.store_id, ...groupArgs(k)]);
        linked += r.affectedRows;
    }
}
console.log(`${APPLY ? 'Imported' : 'Would import'} ${plan.length} old store names; ${APPLY ? 'linked' : 'would link'} ${linked} warranties to ${stores.length} stores. Rows: placed ${tally.placed}, no store ${tally.no_store}, open ${tally.open}. Names whose count differs: ${differ}.`);
process.exit(0);
