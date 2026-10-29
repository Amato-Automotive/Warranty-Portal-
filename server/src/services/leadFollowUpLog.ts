import db from '../config/database.js';
import { summariseFollowUps, type FollowUpInput } from './leadFollowUp.js';

/**
 * Where an ASM's follow-ups on leads are kept (rules in ./leadFollowUp.ts).
 * One row per contact; nothing is edited or deleted, so the log stays a true
 * record of who did what and when.
 */

/** The column type of a live id, so the new table joins without a COLLATE. */
async function idType(table: string): Promise<string> {
    const [rows]: any = await db.execute(
        `SELECT COLUMN_TYPE AS type, CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'id'`,
        [table]
    );
    const c = rows[0];
    if (!c) return 'VARCHAR(36)';
    return c.cs ? `${c.type} CHARACTER SET ${c.cs} COLLATE ${c.coll}` : c.type;
}

/** Created at boot. channel/outcome are VARCHAR so a new choice needs no ALTER. */
export async function ensureLeadFollowUpTable() {
    const [exists]: any = await db.execute("SHOW TABLES LIKE 'lead_asm_followups'");
    if (exists.length) return;
    const [leadId, asmId] = await Promise.all([idType('leads'), idType('asms')]);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS lead_asm_followups (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            lead_id ${leadId} NOT NULL,
            asm_id ${asmId} NOT NULL,
            channel VARCHAR(20) NOT NULL,
            outcome VARCHAR(30) NOT NULL,
            note TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_lead_followups_lead (lead_id, created_at),
            KEY idx_lead_followups_asm (asm_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ Migration: Created lead_asm_followups.');
}

export async function addFollowUp(leadId: string, asmId: string, f: FollowUpInput) {
    await db.execute(
        'INSERT INTO lead_asm_followups (lead_id, asm_id, channel, outcome, note) VALUES (?, ?, ?, ?, ?)',
        [leadId, asmId, f.channel, f.outcome, f.note]
    );
}

/** Every follow-up on these leads, newest first, grouped by lead. */
export async function followUpsFor(leadIds: string[]) {
    const out = new Map<string, any[]>();
    for (let i = 0; i < leadIds.length; i += 1000) {
        const ids = leadIds.slice(i, i + 1000);
        if (!ids.length) continue;
        const [rows]: any = await db.query(
            `SELECT f.id, f.lead_id, f.channel, f.outcome, f.note, f.created_at, a.name AS asm_name
               FROM lead_asm_followups f
               LEFT JOIN asms a ON a.id = f.asm_id
              WHERE f.lead_id IN (?)
              ORDER BY f.created_at DESC, f.id DESC`,
            [ids]
        );
        for (const r of rows) {
            const { lead_id, ...entry } = r;
            if (!out.has(lead_id)) out.set(lead_id, []);
            out.get(lead_id)!.push(entry);
        }
    }
    return out;
}

/**
 * Puts each lead's follow-ups on it: `followups` (newest first) and
 * `followup` (count, first time, latest), or null when nobody has been in
 * touch. A missing table (before the boot migration has run) reads as none.
 */
export async function attachFollowUps(rows: any[]) {
    let map = new Map<string, any[]>();
    try {
        map = await followUpsFor(rows.map(r => r.id));
    } catch (e: any) {
        if (e?.code !== 'ER_NO_SUCH_TABLE') throw e;
    }
    for (const r of rows) {
        r.followups = map.get(r.id) ?? [];
        r.followup = summariseFollowUps(r.followups);
    }
}
