import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import {
    matchNoidaTab, matchPlantTab, readTab, sheetsToken, tabsOf, NOIDA_SHEET, NOIDA_TAB, PLANT_SHEET, PLANT_TABS,
} from './posmSheetSync.service.js';
import {
    NOIDA_COLUMNS, NOIDA_ITEM_COLUMNS, PLANT_COLUMNS, PORTAL_ID_HEADER, columnsOf, noidaDate, plantDate, qtyOf, readSheetDate,
    statusFromNoida, statusFromPlant, statusToPlant, decide,
} from './posmSheetMap.js';
import { syncDispatchToRequest } from './posmSync.service.js';

/**
 * Two-way sync of POSM dispatch with the plant's and the Noida office's
 * sheets, every 5 minutes.
 *
 *  - Rows are known by their PORTAL ID cell (a plant row: its line's id; a
 *    Noida row: its dispatch group). Rows without one are matched to the
 *    portal's lines once, or, if nothing matches, become new portal lines.
 *  - Each synced value is compared three ways: the sheet now, the portal now,
 *    and each side's own last value (sheet_snapshot { s, p }). Only the sheet
 *    changed: the portal takes it. Only the portal changed: the sheet takes
 *    it. Both: the portal wins. The first time a row and a line are matched,
 *    the sheet wins (the portal's lines were imported from it).
 *  - A line made in the portal (an order, an approved request, a Noida
 *    dispatch) is added to the sheet as a new row.
 *  - An imported line whose row is gone is flagged, never deleted.
 */

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const IMPORTED = (batch: unknown) => typeof batch === 'string' && batch.startsWith('combined');
const json = <T>(v: unknown, d: T): T => { if (v == null) return d; if (typeof v !== 'string') return v as T; try { return JSON.parse(v) as T; } catch { return d; } };
const day = (v: unknown) => (v instanceof Date ? new Date(v.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const txt = (v: unknown) => String(v ?? '').trim();
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const col = (i: number) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const q = (title: string) => `'${title.replace(/'/g, "''")}'`;

export interface SyncReport {
    dryRun: boolean;
    tabs: { tab: string; rows: number; bound: number; matchedNow: number; newFromSheet: number; addedToSheet: number; toPortal: number; toSheet: number; conflicts: number; missing: number; notes: string[]; fields: Record<string, number>; samples: string[] }[];
}

/** Cell writes and new rows for one spreadsheet, sent together (or only counted in a dry run). */
class Writer {
    cells: { range: string; values: unknown[][] }[] = [];
    appends: { tab: string; rows: unknown[][] }[] = [];
    constructor(private sheetId: string, private dry: boolean) {}
    set(tab: string, row: number, c: number, v: unknown) { this.cells.push({ range: `${q(tab)}!${col(c)}${row}`, values: [[v ?? '']] }); }
    add(tab: string, row: unknown[]) { let a = this.appends.find(x => x.tab === tab); if (!a) { a = { tab, rows: [] }; this.appends.push(a); } a.rows.push(row); }
    async flush() {
        if (this.dry) return;
        const t = await sheetsToken();
        const H = { headers: { Authorization: `Bearer ${t}` }, timeout: 120_000 };
        for (let i = 0; i < this.cells.length; i += 500) {
            await axios.post(`${SHEETS}/${this.sheetId}/values:batchUpdate`, { valueInputOption: 'RAW', data: this.cells.slice(i, i + 500) }, H);
        }
        for (const a of this.appends) {
            await axios.post(`${SHEETS}/${this.sheetId}/values/${encodeURIComponent(q(a.tab))}:append`, { values: a.rows }, { ...H, params: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' } });
        }
    }
}

/** Makes sure a tab has a PORTAL ID column; its position. */
async function portalIdColumn(sheetId: string, tab: { title: string; id: number }, header: string[], width: number, w: Writer, dry: boolean): Promise<number> {
    const at = header.findIndex(h => norm(h) === norm(PORTAL_ID_HEADER));
    if (at >= 0) return at;
    const c = Math.max(width, header.length);
    if (!dry) {
        const t = await sheetsToken();
        const meta = await axios.get(`${SHEETS}/${sheetId}?fields=sheets(properties(sheetId,gridProperties))`, { headers: { Authorization: `Bearer ${t}` } });
        const grid = meta.data.sheets.find((s: any) => s.properties.sheetId === tab.id)?.properties.gridProperties;
        if (grid && grid.columnCount <= c) {
            await axios.post(`${SHEETS}/${sheetId}:batchUpdate`, { requests: [{ appendDimension: { sheetId: tab.id, dimension: 'COLUMNS', length: c - grid.columnCount + 1 } }] }, { headers: { Authorization: `Bearer ${t}` } });
        }
    }
    w.set(tab.title, 1, c, PORTAL_ID_HEADER);
    return c;
}

/* ---------------- Plant ---------------- */

/** The plant values kept in step, in the portal's form (ISO dates, portal statuses). */
const PLANT_FIELDS = ['status', 'expected_dispatch', 'dispatch_date', 'docket_no', 'courier', 'reason', 'remarks', 'qty', 'design', 'major_colour', 'minor_colour', 'address'] as const;
type PlantVals = Record<(typeof PLANT_FIELDS)[number], string>;

function plantFromRow(row: string[], c: Record<string, number>): PlantVals {
    const req = readSheetDate(row[c.request_date]);
    const year = req ? Number(req.slice(0, 4)) : 2026;
    return {
        status: statusFromPlant(row[c.status]), expected_dispatch: readSheetDate(row[c.expected_dispatch], year) ?? '',
        dispatch_date: readSheetDate(row[c.dispatch_date], year) ?? '', docket_no: txt(row[c.docket_no]), courier: txt(row[c.courier]),
        reason: txt(row[c.note]), remarks: txt(row[c.remarks]), qty: String(qtyOf(row[c.qty]) || ''), design: txt(row[c.design]),
        major_colour: txt(row[c.major_colour]), minor_colour: txt(row[c.minor_colour]), address: txt(row[c.address]),
    };
}
function plantFromLine(l: any): PlantVals {
    return {
        status: l.status, expected_dispatch: day(l.expected_dispatch) ?? '', dispatch_date: day(l.dispatch_date) ?? '', docket_no: txt(l.docket_no), courier: txt(l.courier),
        reason: txt(l.reason), remarks: txt(l.remarks), qty: String(Number(l.qty) || ''), design: txt(l.design), major_colour: txt(l.major_colour),
        minor_colour: txt(l.minor_colour), address: txt(l.address),
    };
}
/** A plant value as the sheet writes it. */
function plantCell(f: keyof PlantVals, v: string): unknown {
    if (f === 'status') return statusToPlant(v);
    if (f === 'expected_dispatch' || f === 'dispatch_date') return plantDate(v || null);
    if (f === 'qty') return v ? Number(v) : '';
    return v;
}
const PLANT_COL: Record<keyof PlantVals, string> = {
    status: 'status', expected_dispatch: 'expected_dispatch', dispatch_date: 'dispatch_date', docket_no: 'docket_no', courier: 'courier', reason: 'note',
    remarks: 'remarks', qty: 'qty', design: 'design', major_colour: 'major_colour', minor_colour: 'minor_colour', address: 'address',
};

/** A new plant row for a line made in the portal. */
function plantRow(l: any, c: Record<string, number>, width: number): unknown[] {
    const row: unknown[] = Array(width).fill('');
    const put = (k: string, v: unknown) => { if (c[k] !== undefined) row[c[k]] = v ?? ''; };
    const item = l.item === 'Sample Jacket' ? 'SAMPLE JACKET' : 'FRP';
    put('request_date', plantDate(day(l.request_date))); put('status', statusToPlant(l.status)); put('expected_dispatch', plantDate(day(l.expected_dispatch)));
    put('distributor', l.distributor); put('store', l.sheet_store_name); put('store_kind', (l.store_kind ?? '').toUpperCase()); put('item', item);
    put('design', l.design ?? (item === 'SAMPLE JACKET' ? 'SAMPLE JACKETS' : '')); put('minor_colour', l.minor_colour); put('major_colour', l.major_colour);
    put('qty', Number(l.qty)); put('brand', l.brand); put('address', l.address); put('note', l.reason);
    put('remarks', [l.dispatch_to, l.remarks].filter(Boolean).join(' · ')); put('dispatch_date', plantDate(day(l.dispatch_date))); put('docket_no', l.docket_no); put('courier', l.courier);
    put('key', [l.distributor, l.sheet_store_name, l.design, l.minor_colour, l.major_colour, l.qty].map(v => v ?? '').join('|'));
    put('portal_id', l.id);
    return row;
}

async function storeIdForName(name: string): Promise<string | null> {
    const [[hit]]: any = await db.execute('SELECT store_id FROM posm_dispatch_history WHERE store_id IS NOT NULL AND UPPER(TRIM(sheet_store_name)) = ? LIMIT 1', [txt(name).toUpperCase()]);
    return hit?.store_id ? String(hit.store_id) : null;
}

async function syncPlantTab(tab: { title: string; id: number }, depot: (typeof PLANT_TABS)[number], w: Writer, dry: boolean, rep: SyncReport['tabs'][number]) {
    const rows = await readTab(PLANT_SHEET, tab.title);
    const header = rows[0] ?? [];
    const c = columnsOf(header, PLANT_COLUMNS);
    c.portal_id = await portalIdColumn(PLANT_SHEET, tab, header, header.length, w, dry);
    const width = Math.max(header.length, c.portal_id + 1);
    rep.rows = rows.length - 1;

    const [lineRows]: any = await db.execute(`SELECT * FROM posm_dispatch_history WHERE source = ? AND deleted_at IS NULL`, [depot.source]);
    const lines = new Map<string, any>(lineRows.map((l: any) => [String(l.id), l]));
    const rowOf = new Map<string, number>();
    for (let r = 1; r < rows.length; r++) { const id = txt(rows[r][c.portal_id]); if (id && lines.has(id)) rowOf.set(id, r); }
    rep.bound = rowOf.size;

    /* Rows without a PORTAL ID: the imported line they are, or a new line. */
    const unbound = new Set<number>();
    for (let r = 1; r < rows.length; r++) if (!txt(rows[r][c.portal_id]) && (txt(rows[r][c.store]) || txt(rows[r][c.design]))) unbound.add(r + 1);
    const firstBind = new Set<string>();
    if (unbound.size) {
        const m = await matchPlantTab(rows, depot.source, unbound, new Set(rowOf.keys()));
        for (const x of m.matches) {
            if (!unbound.has(x.row)) continue;
            if (x.lineId) { rowOf.set(x.lineId, x.row - 1); firstBind.add(x.lineId); w.set(tab.title, x.row, c.portal_id, x.lineId); rep.matchedNow++; continue; }
            /* A row typed in the sheet: a new portal line. */
            const row = rows[x.row - 1];
            const v = plantFromRow(row, c);
            const id = uuidv4();
            rep.newFromSheet++;
            if (!dry) {
                await db.execute(
                    `INSERT INTO posm_dispatch_history (id, source, store_id, sheet_store_name, distributor, item, design, major_colour, minor_colour, brand, store_kind, qty, status,
                        request_date, expected_dispatch, dispatch_date, courier, docket_no, reason, remarks, address, flags, import_batch, sheet_snapshot, sheet_synced_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sheet', ?, NOW())`,
                    [id, depot.source, await storeIdForName(row[c.store]), txt(row[c.store]) || null, txt(row[c.distributor]) || null,
                        /JACKET|BAG/i.test(`${row[c.item]} ${row[c.design]}`) ? 'Sample Jacket' : 'FRP', v.design || null, v.major_colour || null, v.minor_colour || null,
                        txt(row[c.brand]) || null, txt(row[c.store_kind]) || null, Number(v.qty) || 1, v.status, readSheetDate(row[c.request_date]),
                        v.expected_dispatch || null, v.dispatch_date || null, v.courier || null, v.docket_no || null, v.reason || null, v.remarks || null, v.address || null,
                        JSON.stringify(Number(v.qty) ? [] : ['qty_not_written']), JSON.stringify({ s: v, p: v })]);
            }
            w.set(tab.title, x.row, c.portal_id, id);
        }
    }

    /*
     * Rows and lines that are each other. The snapshot keeps each side's own
     * last value ({ s, p }): the sheet's raw text and the portal's cleaned one
     * may differ for good (TRACKON / Trackon, "U FOCUS BLACK / WHITE" / U FOCUS
     * + colours). Only a real edit on one side, against that side's own last
     * value, is copied to the other; at the first match nothing is copied.
     */
    for (const [id, r] of rowOf) {
        const l = lines.get(id);
        const s = plantFromRow(rows[r], c);
        const p = plantFromLine(l);
        const b = firstBind.has(id) ? null : json<{ s: PlantVals; p: PlantVals } | null>(l.sheet_snapshot, null);
        const toPortal: Partial<PlantVals> = {};
        const nextS: PlantVals = { ...s }, nextP: PlantVals = { ...p };
        if (b?.s && b?.p) for (const f of PLANT_FIELDS) {
            const d = decide(s[f], p[f], b.s[f] ?? '', b.p[f] ?? '');
            if (d.clash) { rep.conflicts++; rep.notes.push(`${l.sheet_store_name} ${l.design ?? l.item}: ${f} changed in both; the portal's "${p[f]}" kept over the sheet's "${s[f]}"`); }
            if (d.toSheet !== undefined) { w.set(tab.title, r + 1, c[PLANT_COL[f]], plantCell(f, p[f])); nextS[f] = p[f]; rep.toSheet++; }
            else if (d.toPortal !== undefined) {
                toPortal[f] = s[f]; nextP[f] = s[f];
                rep.fields[f] = (rep.fields[f] ?? 0) + 1;
                if (rep.samples.length < 30) rep.samples.push(`${l.sheet_store_name}: ${f} "${p[f]}" -> "${s[f]}" (from the sheet)`);
            }
        }
        if (Object.keys(toPortal).length) rep.toPortal++;
        if (dry) continue;
        const snap = { s: nextS, p: nextP };
        const sets = Object.entries(toPortal).map(([f, v]) => [f, f === 'qty' ? (Number(v) || Number(l.qty)) : (v === '' ? null : v)] as const);
        await db.execute(
            `UPDATE posm_dispatch_history SET ${sets.map(([f]) => `${f} = ?`).concat(['sheet_snapshot = ?', 'sheet_synced_at = NOW()']).join(', ')}
                ${toPortal.status && toPortal.status !== l.status ? ', status_changed_on = CURDATE(), updated_by = NULL' : ''} WHERE id = ?`,
            [...sets.map(([, v]) => v), JSON.stringify(snap), id]);
        if (Object.keys(toPortal).length && l.request_id) await syncDispatchToRequest(id, { id: null, name: 'Plant sheet' }, 'plant').catch(e => console.error('[POSM sheets] -> request:', e));
    }

    /* Lines not in the sheet: made in the portal (add a row), or imported and their row is gone (flag). */
    for (const l of lines.values()) {
        if (rowOf.has(String(l.id))) continue;
        if (IMPORTED(l.import_batch) || l.import_batch === 'sheet') {
            const flags = json<string[]>(l.flags, []);
            if (!flags.includes('row_missing')) { rep.missing++; if (!dry) await db.execute('UPDATE posm_dispatch_history SET flags = ? WHERE id = ?', [JSON.stringify([...flags, 'row_missing']), l.id]); }
            continue;
        }
        const newRow = plantRow(l, c, width);
        w.add(tab.title, newRow); rep.addedToSheet++;
        if (!dry) await db.execute('UPDATE posm_dispatch_history SET sheet_snapshot = ?, sheet_synced_at = NOW() WHERE id = ?', [JSON.stringify({ s: plantFromRow(newRow.map(v => String(v ?? '')), c), p: plantFromLine(l) }), l.id]);
    }
}

/* ---------------- Noida office ---------------- */

const NOIDA_SHARED = ['dispatch_date', 'dispatched_by', 'courier', 'docket_no', 'delivery_date', 'status', 'remarks'] as const;
type NoidaVals = Record<(typeof NOIDA_SHARED)[number], string>;

function noidaFromRow(row: string[], c: Record<string, number>): NoidaVals {
    return {
        dispatch_date: readSheetDate(row[c.dispatch_date]) ?? '', dispatched_by: txt(row[c.dispatched_by]), courier: txt(row[c.courier]), docket_no: txt(row[c.docket_no]),
        delivery_date: readSheetDate(row[c.delivery_date]) ?? '', status: statusFromNoida(row[c.status]), remarks: txt(row[c.remarks]),
    };
}
function noidaFromLine(l: any): NoidaVals {
    return {
        dispatch_date: day(l.dispatch_date) ?? '', dispatched_by: txt(l.dispatched_by), courier: txt(l.courier), docket_no: txt(l.docket_no),
        delivery_date: day(l.delivery_date) ?? '', status: l.status, remarks: txt(l.remarks),
    };
}
const noidaCell = (f: keyof NoidaVals, v: string) => (f === 'dispatch_date' || f === 'delivery_date' ? noidaDate(v || null) : v);
const itemsOfRow = (row: string[], ic: Record<string, number>) => { const o: Record<string, number> = {}; for (const [k, i] of Object.entries(ic)) { const n = qtyOf(row[i]); if (n) o[k] = n; } return o; };

function noidaRow(g: any[], c: Record<string, number>, ic: Record<string, number>, width: number, group: string): unknown[] {
    const l = g[0];
    const row: unknown[] = Array(width).fill('');
    const put = (k: string, v: unknown) => { if (c[k] !== undefined) row[c[k]] = v ?? ''; };
    put('dispatch_date', noidaDate(day(l.dispatch_date))); put('store', l.sheet_store_name); put('store_code', l.store_code); put('distributor', l.distributor); put('asm', l.asm);
    put('state', l.state); put('dispatched_by', l.dispatched_by); put('courier', l.courier); put('docket_no', l.docket_no); put('delivery_date', noidaDate(day(l.delivery_date)));
    put('status', l.status); put('remarks', l.remarks); put('portal_id', group);
    for (const x of g) if (ic[x.item] !== undefined) row[ic[x.item]] = Number(x.qty);
    return row;
}

async function syncNoidaTab(tab: { title: string; id: number }, w: Writer, dry: boolean, rep: SyncReport['tabs'][number]) {
    const rows = await readTab(NOIDA_SHEET, tab.title);
    const header = rows[0] ?? [];
    const c = columnsOf(header, NOIDA_COLUMNS);
    const ic = columnsOf(header, NOIDA_ITEM_COLUMNS);
    c.portal_id = await portalIdColumn(NOIDA_SHEET, tab, header, header.length, w, dry);
    const width = Math.max(header.length, c.portal_id + 1);
    rep.rows = rows.length - 1;

    const [lineRows]: any = await db.execute(`SELECT * FROM posm_dispatch_history WHERE source = 'Noida office' AND deleted_at IS NULL`);
    const groups = new Map<string, any[]>();
    for (const l of lineRows) if (l.dispatch_group) groups.set(String(l.dispatch_group), [...(groups.get(String(l.dispatch_group)) ?? []), l]);
    const rowOf = new Map<string, number>();
    for (let r = 1; r < rows.length; r++) { const id = txt(rows[r][c.portal_id]); if (id && groups.has(id)) rowOf.set(id, r); }
    rep.bound = rowOf.size;

    const firstBind = new Set<string>();
    const matchedIds = new Set<string>();
    const unbound = new Set<number>();
    for (let r = 1; r < rows.length; r++) if (!txt(rows[r][c.portal_id]) && Object.keys(itemsOfRow(rows[r], ic)).length) unbound.add(r + 1);
    if (unbound.size) {
        const taken = new Set<string>(lineRows.filter((l: any) => l.dispatch_group).map((l: any) => String(l.id)));
        const m = await matchNoidaTab(rows, unbound, taken);
        for (const x of m.matches) {
            if (!unbound.has(x.row)) continue;
            const group = uuidv4();
            if (x.lineIds.length) {
                for (const id of x.lineIds) matchedIds.add(String(id));
                if (!dry) await db.query('UPDATE posm_dispatch_history SET dispatch_group = ? WHERE id IN (?)', [group, x.lineIds]);
                groups.set(group, lineRows.filter((l: any) => x.lineIds.includes(String(l.id))).map((l: any) => ({ ...l, dispatch_group: group })));
                rowOf.set(group, x.row - 1); firstBind.add(group); rep.matchedNow++;
            } else {
                /* A dispatch typed in the sheet: new portal lines, one per item. */
                const row = rows[x.row - 1];
                const v = noidaFromRow(row, c);
                const storeId = await storeIdForName(row[c.store]);
                rep.newFromSheet++;
                if (!dry) {
                    for (const [item, qty] of Object.entries(itemsOfRow(row, ic))) {
                        await db.execute(
                            `INSERT INTO posm_dispatch_history (id, source, store_id, store_code, sheet_store_name, distributor, asm, state, item, qty, status, dispatch_date, delivery_date,
                                dispatched_by, courier, docket_no, remarks, flags, import_batch, dispatch_group, sheet_snapshot, sheet_synced_at)
                             VALUES (?, 'Noida office', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'sheet', ?, ?, NOW())`,
                            [uuidv4(), storeId, txt(row[c.store_code]) || null, txt(row[c.store]) || null, txt(row[c.distributor]) || null, txt(row[c.asm]) || null, txt(row[c.state]) || null,
                                item, qty, v.status, v.dispatch_date || null, v.delivery_date || null, v.dispatched_by || null, v.courier || null, v.docket_no || null, v.remarks || null,
                                group, JSON.stringify({ s: { ...v, qty: String(qty) }, p: { ...v, qty: String(qty) } })]);
                    }
                }
            }
            w.set(tab.title, x.row, c.portal_id, group);
        }
    }

    /*
     * Rows and dispatches that are each other. Each line keeps { s, p }: the
     * sheet's and the portal's own last values (shared columns, and its item's
     * quantity). Only a real edit on one side is copied; at the first match nothing is.
     */
    for (const [group, r] of rowOf) {
        const g = groups.get(group) ?? [];
        if (!g.length) continue;
        const s = noidaFromRow(rows[r], c);
        const p = noidaFromLine(g[0]);
        const bs = firstBind.has(group) ? null : (g.map(l => json<any>(l.sheet_snapshot, null)).find(x => x?.s && x?.p) ?? null);
        const toPortal: Partial<NoidaVals> = {};
        const nextS: NoidaVals = { ...s }, nextP: NoidaVals = { ...p };
        if (bs) for (const f of NOIDA_SHARED) {
            const d = decide(s[f], p[f], bs.s[f] ?? '', bs.p[f] ?? '');
            if (d.clash) { rep.conflicts++; rep.notes.push(`${g[0].sheet_store_name} ${s.dispatch_date}: ${f} changed in both; the portal's kept`); }
            if (d.toSheet !== undefined) { w.set(tab.title, r + 1, c[f], noidaCell(f, p[f])); nextS[f] = p[f]; rep.toSheet++; }
            else if (d.toPortal !== undefined) {
                toPortal[f] = s[f]; nextP[f] = s[f];
                rep.fields[f] = (rep.fields[f] ?? 0) + 1;
                if (rep.samples.length < 30) rep.samples.push(`${g[0].sheet_store_name}: ${f} "${p[f]}" -> "${s[f]}" (from the sheet)`);
            }
        }
        /* Items: each column's quantity against its line's, the same way. */
        const sheetItems = itemsOfRow(rows[r], ic);
        const portalItems: Record<string, any> = Object.fromEntries(g.map(l => [l.item, l]));
        const sheetQtyAfter: Record<string, number> = { ...sheetItems };
        const itemChanges: { line?: any; item: string; qty: number }[] = [];
        if (bs) for (const item of new Set([...Object.keys(sheetItems), ...Object.keys(portalItems)])) {
            const line = portalItems[item];
            const sq = sheetItems[item] ?? 0, pq = line ? Number(line.qty) : 0;
            const ls = line ? json<any>(line.sheet_snapshot, null) : null;
            const bsq = Number(ls?.s?.qty ?? 0), bpq = Number(ls?.p?.qty ?? 0);
            const sheetEdit = sq !== bsq, portalEdit = line ? pq !== bpq : false;
            if (portalEdit) {
                if (sq !== pq && ic[item] !== undefined) { w.set(tab.title, r + 1, ic[item], pq || ''); sheetQtyAfter[item] = pq; rep.toSheet++; }
            } else if (sheetEdit && sq !== pq) {
                if (line?.request_id && !sq) { if (ic[item] !== undefined) { w.set(tab.title, r + 1, ic[item], pq); sheetQtyAfter[item] = pq; rep.toSheet++; } continue; } // a request line is removed on the request
                itemChanges.push({ line, item, qty: sq });
                rep.fields[`qty:${item}`] = (rep.fields[`qty:${item}`] ?? 0) + 1;
            }
        }
        if (Object.keys(toPortal).length || itemChanges.length) rep.toPortal++;
        if (dry) continue;
        const sets = Object.entries(toPortal).map(([f, v]) => [f, v === '' ? null : v] as const);
        for (const l of g) {
            const ch = itemChanges.find(x => x.line?.id === l.id);
            if (ch && !ch.qty) { await db.execute('UPDATE posm_dispatch_history SET deleted_at = NOW(), updated_by = NULL WHERE id = ?', [l.id]); continue; }
            const qtyNow = ch ? ch.qty : Number(l.qty);
            const snap = { s: { ...nextS, qty: String(sheetQtyAfter[l.item] ?? 0) }, p: { ...nextP, qty: String(qtyNow) } };
            await db.execute(
                `UPDATE posm_dispatch_history SET ${sets.map(([f]) => `${f} = ?`).concat(['qty = ?', 'sheet_snapshot = ?', 'sheet_synced_at = NOW()']).join(', ')}
                    ${toPortal.status && toPortal.status !== l.status ? ', status_changed_on = CURDATE(), updated_by = NULL' : ''} WHERE id = ?`,
                [...sets.map(([, v]) => v), qtyNow, JSON.stringify(snap), l.id]);
            if ((sets.length || ch) && l.request_id) await syncDispatchToRequest(String(l.id), { id: null, name: 'Noida sheet' }, 'noida').catch(e => console.error('[POSM sheets] -> request:', e));
        }
        for (const ch of itemChanges.filter(x => !x.line && x.qty)) {
            const l = g[0];
            const v = { ...nextP, qty: String(ch.qty) };
            await db.execute(
                `INSERT INTO posm_dispatch_history (id, source, store_id, store_code, sheet_store_name, city, state, distributor, asm, item, qty, status, dispatch_date, delivery_date,
                    dispatched_by, courier, docket_no, remarks, flags, import_batch, dispatch_group, sheet_snapshot, sheet_synced_at)
                 VALUES (?, 'Noida office', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'sheet', ?, ?, NOW())`,
                [uuidv4(), l.store_id, l.store_code, l.sheet_store_name, l.city, l.state, l.distributor, l.asm, ch.item, ch.qty, nextP.status, nextP.dispatch_date || null,
                    nextP.delivery_date || null, nextP.dispatched_by || null, nextP.courier || null, nextP.docket_no || null, nextP.remarks || null, group,
                    JSON.stringify({ s: { ...nextS, qty: String(ch.qty) }, p: v })]);
        }
    }

    /* Lines not in the sheet: portal-made dispatches get a row; imported ones whose row is gone are flagged. */
    const fresh = new Map<string, any[]>();
    for (const l of lineRows) {
        if (matchedIds.has(String(l.id)) || (l.dispatch_group && rowOf.has(String(l.dispatch_group)))) continue;
        if (IMPORTED(l.import_batch) || l.import_batch === 'sheet') {
            const flags = json<string[]>(l.flags, []);
            if (!flags.includes('row_missing')) { rep.missing++; if (!dry) await db.execute('UPDATE posm_dispatch_history SET flags = ? WHERE id = ?', [JSON.stringify([...flags, 'row_missing']), l.id]); }
            continue;
        }
        const g = l.dispatch_group ? String(l.dispatch_group) : `new:${l.id}`;
        fresh.set(g, [...(fresh.get(g) ?? []), l]);
    }
    for (const [g, ls] of fresh) {
        const group = g.startsWith('new:') ? uuidv4() : g;
        w.add(tab.title, noidaRow(ls, c, ic, width, group)); rep.addedToSheet++;
        if (dry) continue;
        for (const l of ls) { const v = { ...noidaFromLine(l), qty: String(Number(l.qty)) }; await db.execute('UPDATE posm_dispatch_history SET dispatch_group = ?, sheet_snapshot = ?, sheet_synced_at = NOW() WHERE id = ?', [group, JSON.stringify({ s: v, p: v }), l.id]); }
    }
}

let running = false;

/** One sync of both sheets. With `dryRun`, reports what it would do and writes nothing anywhere. */
export async function runPosmSheetSync(opts: { dryRun?: boolean } = {}): Promise<SyncReport> {
    const dry = Boolean(opts.dryRun);
    if (running) throw new Error('A sheet sync is already running');
    running = true;
    const [[lock]]: any = await db.query("SELECT GET_LOCK('posm_sheet_sync', 0) AS ok");
    if (!lock?.ok) { running = false; throw new Error('A sheet sync is already running elsewhere'); }
    const report: SyncReport = { dryRun: dry, tabs: [] };
    const [run]: any = dry ? [{ insertId: null }] : await db.execute('INSERT INTO posm_sheet_sync_runs () VALUES ()');
    try {
        const blank = (tab: string) => ({ tab, rows: 0, bound: 0, matchedNow: 0, newFromSheet: 0, addedToSheet: 0, toPortal: 0, toSheet: 0, conflicts: 0, missing: 0, notes: [] as string[], fields: {} as Record<string, number>, samples: [] as string[] });
        const plantTabs = await tabsOf(PLANT_SHEET);
        const pw = new Writer(PLANT_SHEET, dry);
        for (const d of PLANT_TABS) {
            const tab = plantTabs.find(t => d.match.test(t.title));
            if (!tab) continue;
            const rep = blank(tab.title.trim()); report.tabs.push(rep);
            await syncPlantTab(tab, d, pw, dry, rep);
        }
        await pw.flush();
        const noidaTab = (await tabsOf(NOIDA_SHEET)).find(t => NOIDA_TAB.test(t.title));
        if (noidaTab) {
            const nw = new Writer(NOIDA_SHEET, dry);
            const rep = blank(noidaTab.title.trim()); report.tabs.push(rep);
            await syncNoidaTab(noidaTab, nw, dry, rep);
            await nw.flush();
        }
        for (const t of report.tabs) t.notes = t.notes.slice(0, 50);
        if (!dry) await db.execute('UPDATE posm_sheet_sync_runs SET finished_at = NOW(), ok = 1, report = ? WHERE id = ?', [JSON.stringify(report), run.insertId]);
        return report;
    } catch (e: any) {
        const msg = e?.response?.data?.error?.message ?? e?.message ?? String(e);
        if (!dry) await db.execute('UPDATE posm_sheet_sync_runs SET finished_at = NOW(), ok = 0, error = ? WHERE id = ?', [String(msg).slice(0, 2000), run.insertId]).catch(() => {});
        throw new Error(msg);
    } finally {
        running = false;
        await db.query("SELECT RELEASE_LOCK('posm_sheet_sync')").catch(() => {});
    }
}
