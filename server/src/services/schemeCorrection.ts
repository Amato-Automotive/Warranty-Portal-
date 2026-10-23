/**
 * Head office correcting an entry a store sent: its answers, its files, or
 * the store it is under. Works out the entry after the correction and, in
 * words, what changed — kept on the entry so the correction can be read
 * later. Free of any database import, so it is tested directly.
 */
import type { EntryFile, SchemeField } from './schemeRules.js';

export interface EntryEdit {
    at: string;
    by: string | null;
    by_name: string | null;
    changes: string[];
    note: string | null;
}

export interface CorrectionInput {
    /** Field id → new value; '' clears it. Fields not sent stay as they are. */
    answers?: Record<string, unknown>;
    /** URLs of files to take off the entry. */
    remove?: string[];
    /** Files just uploaded, by field id. */
    added?: Record<string, EntryFile[]>;
    store_id?: string | null;
    store_names?: { from: string; to: string };
}

export function correctEntry(
    fields: SchemeField[],
    entry: { answers: Record<string, string>; files: Record<string, EntryFile[]>; store_id: string },
    input: CorrectionInput,
): { answers: Record<string, string>; files: Record<string, EntryFile[]>; store_id: string; changes: string[]; problems: string[] } {
    const problems: string[] = [];
    const changes: string[] = [];
    const answers = { ...entry.answers };
    const byId = new Map(fields.map(f => [f.id, f]));

    for (const [id, raw] of Object.entries(input.answers ?? {})) {
        const f = byId.get(id);
        if (!f || f.type === 'file') continue;
        const value = String(raw ?? '').trim().slice(0, 500);
        const before = answers[id] ?? '';
        if (value === before) continue;
        if (f.type === 'number' && value && !Number.isFinite(Number(value))) { problems.push(`${f.label} must be a number`); continue; }
        if (f.type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) { problems.push(`${f.label} is not a date`); continue; }
        if (f.type === 'select' && value && f.options?.length && !f.options.includes(value)) { problems.push(`${f.label}: choose one of the options`); continue; }
        if (value) answers[id] = value; else delete answers[id];
        changes.push(`${f.label}: ${before || '(empty)'} → ${value || '(empty)'}`);
    }

    const remove = new Set(input.remove ?? []);
    const files: Record<string, EntryFile[]> = {};
    for (const [id, list] of Object.entries(entry.files)) {
        const kept = list.filter(x => !remove.has(x.url));
        for (const gone of list.filter(x => remove.has(x.url))) changes.push(`${byId.get(id)?.label ?? id}: removed ${gone.name}`);
        if (kept.length) files[id] = kept;
    }
    for (const [id, list] of Object.entries(input.added ?? {})) {
        const f = byId.get(id);
        if (!f || f.type !== 'file') { problems.push('A file was sent for a field this scheme does not have'); continue; }
        files[id] = [...(files[id] ?? []), ...list];
        for (const x of list) changes.push(`${f.label}: added ${x.name}`);
        const max = f.max_files ?? 1;
        if (files[id].length > max) problems.push(`${f.label} takes up to ${max} file${max === 1 ? '' : 's'}: remove one first`);
    }

    let storeId = entry.store_id;
    if (input.store_id && input.store_id !== entry.store_id) {
        storeId = input.store_id;
        changes.push(`Moved from ${input.store_names?.from ?? 'the store'} to ${input.store_names?.to ?? 'another store'}`);
    }
    return { answers, files, store_id: storeId, changes, problems };
}
