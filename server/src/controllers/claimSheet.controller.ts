import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import type { AuthRequest } from '../middleware/auth.js';
import { spreadsheetId } from '../services/googleSheets.js';
import { listSources, serviceAccountEmail, syncSource, type SheetSource } from '../services/claimSheetSync.service.js';

/**
 * Claims › Sheet sync, for the admin: the production sheets the portal reads
 * (add, edit, remove, check, sync now) and who besides the plant sees the
 * claims that come from them.
 */

/** Who sees sheet claims besides the plant; each is on unless switched off. */
export const SHEET_SEEN_KEYS = { store: 'claims_sheet_store', distributor: 'claims_sheet_distributor' } as const;
export async function sheetSeen(): Promise<{ store: boolean; distributor: boolean }> {
    const [rows]: any = await db.execute('SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?)', [SHEET_SEEN_KEYS.store, SHEET_SEEN_KEYS.distributor]);
    const off = (k: string) => rows.find((r: any) => r.setting_key === k)?.setting_value === 'false';
    return { store: !off(SHEET_SEEN_KEYS.store), distributor: !off(SHEET_SEEN_KEYS.distributor) };
}

const bad = (res: Response, error: string, code = 400) => res.status(code).json({ success: false, error });

/** A sheet as typed: a name, a Google Sheet link, a tab, on or off. */
function readBody(b: any): { name: string; url: string; tab: string; active: boolean } | string {
    const name = String(b?.name ?? '').trim().slice(0, 120);
    const url = String(b?.url ?? '').trim().slice(0, 500);
    const tab = String(b?.tab ?? '').trim().slice(0, 120) || 'ALTERATION';
    if (!name) return 'Give the sheet a name, e.g. Production Nov 2026';
    if (!spreadsheetId(url)) return 'That does not look like a Google Sheet link';
    return { name, url, tab, active: b?.active !== false };
}

async function sourceById(id: string): Promise<SheetSource | null> {
    return (await listSources()).find(s => s.id === id) ?? null;
}

export default class ClaimSheetController {
    static async list(_req: AuthRequest, res: Response) {
        try {
            res.json({ success: true, sources: await listSources(), seen: await sheetSeen(), service_account: serviceAccountEmail() });
        } catch (e) {
            console.error('claimSheet.list', e);
            bad(res, 'Could not load the sheets', 500);
        }
    }

    static async add(req: AuthRequest, res: Response) {
        try {
            const b = readBody(req.body);
            if (typeof b === 'string') return bad(res, b);
            const id = uuidv4();
            await db.execute('INSERT INTO claim_sheet_sources (id, name, url, tab, active) VALUES (?, ?, ?, ?, ?)', [id, b.name, b.url, b.tab, b.active ? 1 : 0]);
            res.json({ success: true, source: await sourceById(id) });
        } catch (e) {
            console.error('claimSheet.add', e);
            bad(res, 'Could not add the sheet', 500);
        }
    }

    static async update(req: AuthRequest, res: Response) {
        try {
            const old = await sourceById(req.params.id);
            if (!old) return bad(res, 'Sheet not found', 404);
            const b = readBody({ ...old, ...req.body });
            if (typeof b === 'string') return bad(res, b);
            await db.execute('UPDATE claim_sheet_sources SET name = ?, url = ?, tab = ?, active = ? WHERE id = ?', [b.name, b.url, b.tab, b.active ? 1 : 0, old.id]);
            res.json({ success: true, source: await sourceById(old.id) });
        } catch (e) {
            console.error('claimSheet.update', e);
            bad(res, 'Could not save the sheet', 500);
        }
    }

    /** Stops reading a sheet; the claims it brought in stay. */
    static async remove(req: AuthRequest, res: Response) {
        try {
            const [r]: any = await db.execute('DELETE FROM claim_sheet_sources WHERE id = ?', [req.params.id]);
            if (!r.affectedRows) return bad(res, 'Sheet not found', 404);
            res.json({ success: true });
        } catch (e) {
            console.error('claimSheet.remove', e);
            bad(res, 'Could not remove the sheet', 500);
        }
    }

    /** Check (apply false): what a sync would do, writing nothing. Sync now (apply true): do it. */
    static async sync(req: AuthRequest, res: Response) {
        try {
            const s = await sourceById(req.params.id);
            if (!s) return bad(res, 'Sheet not found', 404);
            const report = await syncSource(s, req.body?.apply === true);
            res.json({ success: !report.error, report, ...(report.error ? { error: report.error } : {}) });
        } catch (e) {
            console.error('claimSheet.sync', e);
            bad(res, 'Could not read the sheet', 500);
        }
    }

    static async setSeen(req: AuthRequest, res: Response) {
        try {
            for (const [k, key] of Object.entries(SHEET_SEEN_KEYS)) {
                if (typeof req.body?.[k] !== 'boolean') continue;
                await db.execute(
                    `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`, [key, req.body[k] ? 'true' : 'false']);
            }
            res.json({ success: true, seen: await sheetSeen() });
        } catch (e) {
            console.error('claimSheet.setSeen', e);
            bad(res, 'Could not save', 500);
        }
    }
}
