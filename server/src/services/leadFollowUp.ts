/**
 * An ASM's follow-up on a lead: each time they call, WhatsApp or visit the
 * customer, what came of it. A log, not a flag, so head office can see who
 * worked a lead, how and when — three tries over two days reads differently
 * from one.
 *
 * Separate from the lead's own review_status / lead_status, which are head
 * office's call-back outcomes and never touched by an ASM.
 *
 * Pure: no database, so the rules are tested on their own. The ASM portal's
 * form mirrors these lists (seal-guardian-58321-main/src/lib/asmLeads.ts).
 */

export const FOLLOW_UP_CHANNELS = ['call', 'whatsapp', 'visit'] as const;
export type FollowUpChannel = typeof FOLLOW_UP_CHANNELS[number];

export const FOLLOW_UP_OUTCOMES = ['interested', 'not_interested', 'no_answer', 'sent_to_store', 'bought'] as const;
export type FollowUpOutcome = typeof FOLLOW_UP_OUTCOMES[number];

export const NOTE_MAX = 500;

export interface FollowUpInput { channel: FollowUpChannel; outcome: FollowUpOutcome; note: string | null }

/** Checks what the ASM sent. Returns the cleaned entry, or the reason it was refused. */
export function parseFollowUp(body: unknown): { ok: true; value: FollowUpInput } | { ok: false; error: string } {
    const b = (body ?? {}) as Record<string, unknown>;
    const channel = String(b.channel ?? '');
    const outcome = String(b.outcome ?? '');
    if (!(FOLLOW_UP_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: 'Say how you contacted the customer' };
    if (!(FOLLOW_UP_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, error: 'Pick what happened' };
    const note = typeof b.note === 'string' ? b.note.trim().replace(/\s+/g, ' ') : '';
    if (note.length > NOTE_MAX) return { ok: false, error: `Keep the note under ${NOTE_MAX} characters` };
    return { ok: true, value: { channel: channel as FollowUpChannel, outcome: outcome as FollowUpOutcome, note: note || null } };
}

export interface FollowUpEntry { channel: string; outcome: string; note: string | null; created_at: string | Date; asm_name?: string | null }

/** One lead's follow-ups summarised: how many, when the first was, and the latest. */
export function summariseFollowUps(entries: FollowUpEntry[]) {
    if (!entries.length) return null;
    const byTime = [...entries].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return { count: byTime.length, first_at: byTime[0].created_at, last: byTime[byTime.length - 1] };
}

export const DAY_MS = 86_400_000;

/**
 * Of the leads an ASM was sent, how many they have contacted, and how many
 * within a day of receiving them. A lead received less than a day ago that
 * nobody has contacted yet is still in time, so it counts in neither the
 * on-time nor the late figure until its day is up.
 */
export function followUpFigures(leads: { received_at: string | Date; first_at: string | Date | null }[], now = Date.now()) {
    let contacted = 0, within24h = 0, due = 0;
    for (const l of leads) {
        const got = new Date(l.received_at).getTime();
        const first = l.first_at ? new Date(l.first_at).getTime() : null;
        if (first !== null) contacted++;
        const dayUp = now - got >= DAY_MS;
        if (first !== null && first - got <= DAY_MS) { within24h++; due++; }
        else if (dayUp) due++;
    }
    return { sent: leads.length, contacted, within_24h: within24h, due, within_24h_pct: due ? Math.round((within24h / due) * 100) : null };
}
