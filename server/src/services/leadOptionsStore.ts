/**
 * Where the admin's lead lists live (lead_options, one row), read with a short
 * cache: they are read on every lead list and save, and change rarely.
 */
import db from '../config/database.js';
import { readLeadOptions, leadOptionsProblem, type LeadOptions } from './leadOptions.js';

const TTL_MS = 60_000;
let cached: { at: number; options: LeadOptions } | null = null;

export async function loadLeadOptions(): Promise<LeadOptions> {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.options;
    const [rows]: any = await db.execute('SELECT options FROM lead_options WHERE id = 1');
    const raw = rows[0]?.options;
    const options = readLeadOptions(typeof raw === 'string' ? JSON.parse(raw) : raw);
    cached = { at: Date.now(), options };
    return options;
}

/** How many leads use each outcome (review or ASM) and each channel. */
export async function leadOptionsInUse(): Promise<{ outcomes: Record<string, number>; channels: Record<string, number> }> {
    const [rv]: any = await db.query('SELECT review_status v, COUNT(*) n FROM leads WHERE review_status IS NOT NULL GROUP BY review_status');
    const [ls]: any = await db.query('SELECT lead_status v, COUNT(*) n FROM leads WHERE lead_status IS NOT NULL GROUP BY lead_status');
    const [src]: any = await db.query('SELECT source v, COUNT(*) n FROM leads GROUP BY source');
    const outcomes: Record<string, number> = {};
    for (const r of [...rv, ...ls]) outcomes[r.v] = (outcomes[r.v] ?? 0) + Number(r.n);
    return { outcomes, channels: Object.fromEntries(src.map((r: any) => [r.v, Number(r.n)])) };
}

/** Saves the lists, or returns why not. */
export async function saveLeadOptions(input: unknown, adminId: string | null): Promise<{ options: LeadOptions } | { error: string }> {
    const next = readLeadOptions(input);
    cached = null;
    const prev = await loadLeadOptions();
    const problem = leadOptionsProblem(next, prev, await leadOptionsInUse());
    if (problem) return { error: problem };
    await db.execute(
        `INSERT INTO lead_options (id, options, updated_by) VALUES (1, ?, ?)
         ON DUPLICATE KEY UPDATE options = VALUES(options), updated_by = VALUES(updated_by)`,
        [JSON.stringify(next), adminId]
    );
    cached = { at: Date.now(), options: next };
    return { options: next };
}
