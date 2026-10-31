import db from '../config/database.js';
import { readSheet, readServiceAccount } from './googleSheets.js';
import { readSheetRow, rowsFromGrid, type SheetClaim } from './claimSheet.js';

/**
 * Keeps the plant's production sheets and the portal's claims in step.
 *
 * The admin adds each sheet (link + tab) in Claims › Sheet sync; every one
 * switched on is read every few minutes with the service account. A new row
 * becomes a claim (raised_via 'sheet'); a row already in updates its claim, as
 * the sheet is the master for these. Rows are never removed, and nobody is
 * messaged. How a row reads is services/claimSheet.ts.
 */

const INTERVAL_MS = 10 * 60 * 1000;

export interface SheetSource {
    id: string; name: string; url: string; tab: string; active: boolean;
    last_sync_at: string | null; last_result: SyncReport | null; created_at: string;
}
export interface SyncReport {
    at: string; applied: boolean; error?: string;
    rows: number; claims: number; added: number; updated: number; unchanged: number;
    store_found: number; skipped: string[];
}

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
const parse = (v: unknown) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v);
/** The same value whatever order its keys are in (MySQL hands JSON back reordered). */
const stable = (v: unknown): string => {
    const x = parse(v);
    if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
    if (x && typeof x === 'object') return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${stable((x as any)[k])}`).join(',')}}`;
    return JSON.stringify(x ?? null);
};

export async function listSources(): Promise<SheetSource[]> {
    const [rows]: any = await db.execute('SELECT * FROM claim_sheet_sources ORDER BY created_at');
    return rows.map((r: any) => ({ ...r, active: Boolean(r.active), last_result: parse(r.last_result) ?? null }));
}

/** Whom to share a sheet with, as a Viewer. */
export const serviceAccountEmail = () => readServiceAccount()?.client_email ?? null;

/**
 * The one portal store a sheet's party name is, by the same name (spaces, dots
 * and case aside), or none. Never a close name: "CAR FASHION BIKANER" is not
 * "CAR FASHION", and a wrong link would show one store another's claim.
 */
async function storeMatcher() {
    const [stores]: any = await db.execute('SELECT id, store_name FROM vendor_details');
    const norm = (s: string) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return (name: string): string | null => {
        const k = norm(name);
        if (k.length < 3) return null;
        const exact = stores.filter((s: any) => norm(s.store_name) === k);
        return exact.length === 1 ? String(exact[0].id) : null;
    };
}

/**
 * Read one sheet and, with `apply`, write it: new rows added, changed rows
 * updated. Without `apply` it only counts, for the admin's Check.
 */
export async function syncSource(source: SheetSource, apply: boolean): Promise<SyncReport> {
    const report: SyncReport = { at: new Date().toISOString(), applied: apply, rows: 0, claims: 0, added: 0, updated: 0, unchanged: 0, store_found: 0, skipped: [] };
    try {
        const rows = rowsFromGrid(await readSheet(source.url, source.tab));
        report.rows = rows.length;
        const storeOf = await storeMatcher();
        const claims: (SheetClaim & { store_id: string | null })[] = [];
        // One alteration no. can cover two parts on the same day: the second is "#2", in sheet order.
        const seen = new Map<string, number>();
        for (const r of rows) {
            const c = readSheetRow(r, Number(r._row));
            if ('skip' in c) { report.skipped.push(c.skip); continue; }
            const n = (seen.get(c.key) ?? 0) + 1;
            seen.set(c.key, n);
            const key = n > 1 ? `${c.key}#${n}` : c.key;
            claims.push({ ...c, key, snapshot: { ...c.snapshot, sheet_key: key, sheet_source: source.id, sheet_name: source.name }, store_id: storeOf(c.store_name) });
        }
        report.claims = claims.length;
        report.store_found = claims.filter(c => c.store_id).length;

        const [had]: any = await db.execute(
            `SELECT id, kind, store_id, problem, description, vehicle, snapshot, status, decision, plan_info, dispatch, hold_info, history,
                    JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.sheet_key')) AS k
               FROM warranty_claims WHERE raised_via = 'sheet'`);
        const existing = new Map<string, any>(had.map((x: any) => [x.k, x]));

        const conn = apply ? await (db as any).getConnection() : null;
        try {
            if (conn) await conn.beginTransaction();
            for (const c of claims) {
                const fields = [c.kind, c.store_id, c.problem, c.description, json(c.vehicle), json(c.snapshot), c.status, json(c.decision), json(c.plan), json(c.dispatch), json(c.hold)];
                const old = existing.get(c.key);
                if (old) {
                    const was = [old.kind, old.store_id ? String(old.store_id) : null, old.problem, old.description, old.vehicle, old.snapshot, old.status, old.decision, old.plan_info, old.dispatch, old.hold_info];
                    if (fields.every((f, i) => stable(f) === stable(was[i]))) { report.unchanged++; continue; }
                    report.updated++;
                    if (!conn) continue;
                    const history = parse(old.history) ?? [];
                    if (old.status !== c.status) history.push({ action: 'sheet_update', status: c.status, text: `Updated from the sheet (row ${c.snapshot.sheet_row})`, at: new Date().toISOString(), by_role: 'admin', by_name: source.name });
                    await conn.execute(
                        `UPDATE warranty_claims SET kind = ?, store_id = ?, problem = ?, description = ?, vehicle = ?, snapshot = ?, status = ?,
                            decision = ?, plan_info = ?, dispatch = ?, hold_info = ?, history = ? WHERE id = ?`,
                        [...fields, json(history), old.id]);
                    continue;
                }
                report.added++;
                if (!conn) continue;
                const history = [{ action: 'raised', status: c.status, text: `From the sheet "${source.name}" (row ${c.snapshot.sheet_row})`, at: c.created_at, by_role: 'admin', by_name: source.name }];
                const [r]: any = await conn.execute(
                    `INSERT INTO warranty_claims (kind, store_id, problem, description, vehicle, snapshot, status, decision, plan_info, dispatch, hold_info,
                        warranty_uid, raised_by_role, raised_via, media, history, trail, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'admin', 'sheet', '[]', ?, '[]', ?)`,
                    [...fields, json(history), c.created_at.slice(0, 10) + ' 00:00:00']);
                await conn.execute('UPDATE warranty_claims SET claim_no = ? WHERE id = ?', [`WC-${String(r.insertId).padStart(4, '0')}`, r.insertId]);
                existing.set(c.key, { id: r.insertId });
            }
            if (conn) await conn.commit();
        } catch (e) {
            if (conn) await conn.rollback();
            throw e;
        } finally {
            conn?.release();
        }
    } catch (e: any) {
        report.error = e?.message || 'Could not read the sheet';
    }
    report.skipped = report.skipped.slice(0, 50);
    if (apply) await db.execute('UPDATE claim_sheet_sources SET last_sync_at = NOW(), last_result = ? WHERE id = ?', [JSON.stringify(report), source.id]);
    return report;
}

let running = false;
/** Every sheet switched on, in turn. */
export async function syncAllSources(): Promise<void> {
    if (running) return;
    running = true;
    try {
        for (const s of (await listSources()).filter(x => x.active)) {
            const r = await syncSource(s, true);
            if (r.error) console.error(`[ClaimSheet] ${s.name}: ${r.error}`);
            else if (r.added || r.updated) console.log(`[ClaimSheet] ${s.name}: ${r.added} added, ${r.updated} updated`);
        }
    } catch (e: any) {
        console.error('[ClaimSheet] sync failed:', e?.message);
    } finally {
        running = false;
    }
}

export function startClaimSheetSchedule(): void {
    setTimeout(() => { void syncAllSources(); }, 90_000);
    const timer = setInterval(() => { void syncAllSources(); }, INTERVAL_MS);
    timer.unref?.();
}
