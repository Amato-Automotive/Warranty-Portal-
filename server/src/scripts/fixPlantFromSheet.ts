/**
 * One-off (27 Nov 2026): make the portal's plant lines match the plant sheet
 * where the first link copied nothing — real updates the plant had already
 * made (Sahajanand, Car India, Pit House) and look-alike rows linked crosswise.
 *
 * For every line bound to a plant row (PORTAL ID), the sheet's status,
 * dispatch date, docket and EDD win where they differ. The line's sync
 * snapshot is set to the new values on both sides, so the next sync sees no
 * change. Nothing is written to the sheet.
 *
 *   npx tsx src/scripts/fixPlantFromSheet.ts            (dry run: lists what would change)
 *   npx tsx src/scripts/fixPlantFromSheet.ts --apply
 */
import db from '../config/database.js';
import { readTab, tabsOf, PLANT_SHEET, PLANT_TABS } from '../services/posmSheetSync.service.js';
import { columnsOf, PLANT_COLUMNS, statusFromPlant, readSheetDate } from '../services/posmSheetMap.js';
import { syncDispatchToRequest } from '../services/posmSync.service.js';

const APPLY = process.argv.includes('--apply');
const txt = (v: unknown) => String(v ?? '').trim();
const day = (v: unknown) => (v instanceof Date ? new Date(v.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '');
const json = (v: unknown) => { if (v == null) return null; if (typeof v !== 'string') return v as any; try { return JSON.parse(v); } catch { return null; } };

const FIELDS = ['status', 'dispatch_date', 'docket_no', 'expected_dispatch'] as const;
let changed = 0;
const tabs = await tabsOf(PLANT_SHEET);
for (const d of PLANT_TABS) {
    const tab = tabs.find(t => d.match.test(t.title));
    if (!tab) continue;
    const rows = await readTab(PLANT_SHEET, tab.title);
    const c = columnsOf(rows[0], PLANT_COLUMNS);
    const [lines]: any = await db.query('SELECT * FROM posm_dispatch_history WHERE source = ? AND deleted_at IS NULL', [d.source]);
    const byId = new Map<string, any>(lines.map((l: any) => [String(l.id), l]));
    console.log(`\n== ${tab.title.trim()}`);
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const l = byId.get(txt(row[c.portal_id]));
        if (!l) continue;
        const year = Number((readSheetDate(row[c.request_date]) ?? '2026').slice(0, 4));
        const sheet: Record<(typeof FIELDS)[number], string> = {
            status: statusFromPlant(row[c.status]), dispatch_date: readSheetDate(row[c.dispatch_date], year) ?? '',
            docket_no: txt(row[c.docket_no]), expected_dispatch: readSheetDate(row[c.expected_dispatch], year) ?? '',
        };
        const portal: Record<(typeof FIELDS)[number], string> = { status: l.status, dispatch_date: day(l.dispatch_date), docket_no: txt(l.docket_no), expected_dispatch: day(l.expected_dispatch) };
        const diff = FIELDS.filter(f => sheet[f] !== portal[f]);
        if (!diff.length) continue;
        changed++;
        console.log(`  row ${r + 1} ${txt(row[c.store]).slice(0, 26)} ${txt(row[c.design]).slice(0, 16)}: ${diff.map(f => `${f} "${portal[f] || '—'}" -> "${sheet[f] || '—'}"`).join(', ')}${l.request_id ? '  [request-linked]' : ''}`);
        if (!APPLY) continue;
        const snap = json(l.sheet_snapshot) ?? { s: {}, p: {} };
        for (const f of diff) { snap.s = { ...snap.s, [f]: sheet[f] }; snap.p = { ...snap.p, [f]: sheet[f] }; }
        await db.execute(
            `UPDATE posm_dispatch_history SET ${diff.map(f => `${f} = ?`).join(', ')}, sheet_snapshot = ?, sheet_synced_at = NOW()
                ${diff.includes('status') ? ', status_changed_on = CURDATE(), updated_by = NULL' : ''} WHERE id = ?`,
            [...diff.map(f => sheet[f] === '' ? null : sheet[f]), JSON.stringify(snap), l.id]);
        if (l.request_id) await syncDispatchToRequest(String(l.id), { id: null, name: 'Plant sheet' }, 'plant').catch(e => console.error('    -> request:', e?.message ?? e));
    }
}
console.log(`\n${changed} line(s) ${APPLY ? 'updated' : 'would change (dry run; add --apply)'}.`);
process.exit(0);
