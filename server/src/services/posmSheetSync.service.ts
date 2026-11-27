import axios from 'axios';
import jwt from 'jsonwebtoken';
import db from '../config/database.js';
import { readServiceAccount } from './googleSheets.js';

import {
    NOIDA_COLUMNS, NOIDA_ITEM_COLUMNS, PLANT_COLUMNS, columnsOf, designFit, qtyOf, readSheetDate, words,
} from './posmSheetMap.js';

/**
 * Two-way sync between POSM dispatch and the plant's / Noida office's
 * sheets. This part reads the sheets and matches their rows to portal lines.
 */

export const PLANT_SHEET = '16rtvrWdt_aqORgFha7FhjVvIyWupV9-eAd1UflEdawI';
export const NOIDA_SHEET = '1mZs2kworTZXcEP1FCg6r_bdv_flFzrFxhS722wd-5_A';
export const PLANT_TABS = [{ match: /LUDHIANA/i, depot: 'ludhiana', source: 'Plant - Ludhiana depot' }, { match: /JAIPUR/i, depot: 'jaipur', source: 'Plant - Jaipur depot' }] as const;
export const NOIDA_TAB = /^\s*POSM\s*$/i;

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

let cached: { token: string; until: number } | null = null;
/** A token that may read and write the sheets. */
export async function sheetsToken(): Promise<string> {
    if (cached && cached.until > Date.now() + 60_000) return cached.token;
    const a = readServiceAccount();
    if (!a) throw new Error('No Google service account configured');
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }, a.private_key, { algorithm: 'RS256' });
    const r = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(), { timeout: 20_000 });
    cached = { token: r.data.access_token, until: Date.now() + 3500_000 };
    return cached.token;
}

/** A sheet's tab titles and ids. */
export async function tabsOf(sheetId: string): Promise<{ title: string; id: number }[]> {
    const t = await sheetsToken();
    const r = await axios.get(`${SHEETS}/${sheetId}?fields=sheets(properties(title,sheetId))`, { headers: { Authorization: `Bearer ${t}` }, timeout: 30_000 });
    return r.data.sheets.map((s: any) => ({ title: s.properties.title, id: s.properties.sheetId }));
}

/** A tab's rows as people see them (dates as written), padded to the widest row. */
export async function readTab(sheetId: string, title: string): Promise<string[][]> {
    const t = await sheetsToken();
    const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
    const r = await axios.get(`${SHEETS}/${sheetId}/values/${range}`, { params: { valueRenderOption: 'FORMATTED_VALUE' }, headers: { Authorization: `Bearer ${t}` }, timeout: 60_000 });
    const values: unknown[][] = r.data?.values ?? [];
    const width = values.reduce((w, row) => Math.max(w, row.length), 0);
    return values.map(row => { const c = row.map(v => (v == null ? '' : String(v))); while (c.length < width) c.push(''); return c; });
}

const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const day = (v: unknown) => (v instanceof Date ? new Date(v.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

export interface PlantMatch { row: number; lineId: string | null; why: string }

/**
 * A plant tab's rows matched to that depot's portal lines (once, to fill
 * PORTAL ID): same store (as written), same request date, same quantity, and
 * the closest design and colours; each line is used once.
 */
export async function matchPlantTab(rows: string[][], source: string, onlyRows?: Set<number>, exclude?: Set<string>): Promise<{ matches: PlantMatch[]; unmatchedLines: any[]; cols: Record<string, number> }> {
    const cols = columnsOf(rows[0] ?? [], PLANT_COLUMNS);
    const [lines]: any = await db.execute(
        `SELECT id, sheet_store_name, distributor, item, design, major_colour, minor_colour, qty, flags, request_date, status FROM posm_dispatch_history
          WHERE source = ? AND deleted_at IS NULL AND import_batch IS NOT NULL AND import_batch <> 'request'`, [source]);
    const pool = lines.filter((l: any) => !exclude?.has(String(l.id))).map((l: any) => ({ ...l, req: day(l.request_date), store: norm(l.sheet_store_name), w: words(l.design, l.major_colour, l.minor_colour), blankQty: String(l.flags ?? '').includes('qty_not_written') }));
    const used = new Set<string>();
    const matches: PlantMatch[] = [];
    for (let r = 1; r < rows.length; r++) {
        if (onlyRows && !onlyRows.has(r + 1)) continue;
        const row = rows[r];
        const store = norm(row[cols.store]);
        const item = /JACKET|BAG/i.test(`${row[cols.item] ?? ''} ${row[cols.design] ?? ''}`) ? 'Sample Jacket' : 'FRP';
        if (!store && !row[cols.design] && !row[cols.qty]) continue; // an empty row
        const req = readSheetDate(row[cols.request_date]);
        const qty = qtyOf(row[cols.qty]);
        const rw = words(row[cols.design], row[cols.minor_colour], row[cols.major_colour]);
        const cands = pool.filter((l: any) => !used.has(l.id) && l.store === store && l.item === item && (qty ? Number(l.qty) === qty : l.blankQty) && (l.req ?? null) === (req ?? null));
        let best: any = null, score = -1;
        for (const l of cands) { const s = item === 'Sample Jacket' ? 1 : designFit(rw, l.w); if (s > score) { best = l; score = s; } }
        if (best && score >= 0.5) { used.add(best.id); matches.push({ row: r + 1, lineId: best.id, why: score === 1 ? 'exact' : 'close' }); }
        else matches.push({ row: r + 1, lineId: null, why: cands.length ? 'design differs' : 'no line with that store, date and quantity' });
    }
    /* Second pass: a row left alone with exactly one line left for its store and date (spelling, or a note in the quantity cell) takes it. */
    for (const m of matches) {
        if (m.lineId) continue;
        const row = rows[m.row - 1];
        const req = readSheetDate(row[cols.request_date]);
        const left = pool.filter((l: any) => !used.has(l.id) && l.store === norm(row[cols.store]) && (l.req ?? null) === (req ?? null));
        if (left.length === 1) { used.add(left[0].id); m.lineId = left[0].id; m.why = 'only one left'; }
    }
    return { matches, unmatchedLines: pool.filter((l: any) => !used.has(l.id)), cols };
}

export interface NoidaMatch { row: number; lineIds: string[]; why: string }

/**
 * The Noida tab's rows matched to the Noida office's portal lines, item by
 * item: a row takes, for each item it has, an unused line of that store,
 * dispatch date and docket with that item (the same quantity first). Each
 * row becomes its own dispatch, as in the sheet.
 */
export async function matchNoidaTab(rows: string[][], onlyRows?: Set<number>, exclude?: Set<string>): Promise<{ matches: NoidaMatch[]; unmatchedLines: any[]; cols: Record<string, number>; itemCols: Record<string, number> }> {
    const cols = columnsOf(rows[0] ?? [], NOIDA_COLUMNS);
    const itemCols = columnsOf(rows[0] ?? [], NOIDA_ITEM_COLUMNS);
    const [lines]: any = await db.execute(
        `SELECT id, store_code, sheet_store_name, dispatch_date, docket_no, item, qty FROM posm_dispatch_history
          WHERE source = 'Noida office' AND deleted_at IS NULL AND import_batch IS NOT NULL AND import_batch <> 'request' ORDER BY sheet_row`);
    const keyOf = (code: string, name: string, date: string | null, docket: string) => [code || name, date ?? '', docket].join('|');
    const byKey = new Map<string, any[]>();
    /* Also by store name, for rows written without a store code. */
    const byName = new Map<string, any[]>();
    for (const l of lines) {
        if (exclude?.has(String(l.id))) continue;
        const one = { ...l, qty: Number(l.qty) };
        const k = keyOf(norm(l.store_code), norm(l.sheet_store_name), day(l.dispatch_date), norm(l.docket_no));
        byKey.set(k, [...(byKey.get(k) ?? []), one]);
        const n = keyOf('', norm(l.sheet_store_name), day(l.dispatch_date), norm(l.docket_no));
        byName.set(n, [...(byName.get(n) ?? []), one]);
    }
    const used = new Set<string>();
    const matches: NoidaMatch[] = [];
    for (let r = 1; r < rows.length; r++) {
        if (onlyRows && !onlyRows.has(r + 1)) continue;
        const row = rows[r];
        const items: [string, number][] = [];
        for (const [name, c] of Object.entries(itemCols)) { const q = qtyOf(row[c]); if (q) items.push([name, q]); }
        if (!row[cols.store] && !row[cols.store_code] && !items.length) continue;
        if (!items.length) { matches.push({ row: r + 1, lineIds: [], why: 'no items on the row' }); continue; }
        const rowDate = readSheetDate(row[cols.dispatch_date]), rowDocket = norm(row[cols.docket_no]);
        const pool = byKey.get(keyOf(norm(row[cols.store_code]), norm(row[cols.store]), rowDate, rowDocket))
            ?? (norm(row[cols.store_code]) ? [] : byName.get(keyOf('', norm(row[cols.store]), rowDate, rowDocket)) ?? []);
        const ids: string[] = [];
        let exact = true;
        for (const [item, q] of items) {
            const free = pool.filter(l => !used.has(l.id) && l.item === item);
            const hit = free.find(l => l.qty === q) ?? free[0];
            if (!hit) { exact = false; continue; }
            if (hit.qty !== q) exact = false;
            used.add(hit.id); ids.push(hit.id);
        }
        matches.push({ row: r + 1, lineIds: ids, why: !ids.length ? 'no dispatch with that store, date and docket' : exact ? 'exact' : 'items differ' });
    }
    return { matches, unmatchedLines: lines.filter((l: any) => !used.has(l.id) && !exclude?.has(String(l.id))), cols, itemCols };
}
