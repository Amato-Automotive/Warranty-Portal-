/**
 * How a POSM request moves: which action is allowed from which stage, and
 * where it leads. The admin acts on a request; the store can only confirm a
 * dispatched one arrived.
 *
 *   To approve (open / under_review) → approve · hold · reject
 *   Approved      → start production · dispatch · hold
 *   In production → dispatch · hold
 *   On hold       → resume (back to the stage it was held at) · reject
 *   Dispatched    → deliver
 *   Delivered     → close
 *   Rejected, Closed → reopen
 *
 * Free of any database import, so it is tested directly.
 */

export type PosmStatus = 'open' | 'under_review' | 'approved' | 'in_production' | 'pending' | 'dispatched' | 'delivered' | 'closed' | 'rejected';
export type PosmAction = 'approve' | 'hold' | 'reject' | 'start' | 'dispatch' | 'resume' | 'deliver' | 'close' | 'reopen';

export interface HistoryEntry {
    action: PosmAction | 'sent' | 'received' | 'update';
    status: PosmStatus;
    at: string;
    by_role: 'admin' | 'franchise';
    by?: string | null;
    by_name?: string | null;
    note?: string | null;
    /** On a hold: the stage it was held at, where Resume returns. */
    from?: PosmStatus;
}

const FROM: Record<PosmAction, PosmStatus[]> = {
    approve: ['open', 'under_review'],
    hold: ['open', 'under_review', 'approved', 'in_production'],
    reject: ['open', 'under_review', 'pending'],
    start: ['approved'],
    dispatch: ['approved', 'in_production'],
    resume: ['pending'],
    deliver: ['dispatched'],
    close: ['delivered'],
    reopen: ['rejected', 'closed'],
};

export const ACTIONS = Object.keys(FROM) as PosmAction[];

/** The actions open to the admin at this stage, in the order they are offered. */
export const actionsFor = (status: string): PosmAction[] => ACTIONS.filter(a => FROM[a].includes(status as PosmStatus));

/** The stage a request was held at: the last hold in its history. */
export function heldFrom(history: HistoryEntry[] | null | undefined): PosmStatus {
    const lastHold = [...(history ?? [])].reverse().find(h => h.action === 'hold');
    const prev = lastHold?.from;
    return prev && prev !== 'pending' ? prev : 'open';
}

/** Where an action leads from the current stage, or why it cannot be taken. */
export function nextStatus(current: string, action: string, history?: HistoryEntry[] | null): { status: PosmStatus } | { error: string } {
    const a = action as PosmAction;
    if (!FROM[a]) return { error: 'Unknown action' };
    if (!FROM[a].includes(current as PosmStatus)) return { error: `This request is ${current.replace('_', ' ')}: it cannot be ${PAST[a]} now` };
    switch (a) {
        case 'approve': return { status: 'approved' };
        case 'hold': return { status: 'pending' };
        case 'reject': return { status: 'rejected' };
        case 'start': return { status: 'in_production' };
        case 'dispatch': return { status: 'dispatched' };
        case 'resume': return { status: heldFrom(history) };
        case 'deliver': return { status: 'delivered' };
        case 'close': return { status: 'closed' };
        case 'reopen': return { status: 'open' };
    }
}

const PAST: Record<PosmAction, string> = {
    approve: 'approved', hold: 'put on hold', reject: 'rejected', start: 'put into production', dispatch: 'dispatched',
    resume: 'resumed', deliver: 'marked delivered', close: 'closed', reopen: 'reopened',
};

/** The words for a step, for the timeline and the store's notification. */
export const ACTION_TEXT: Record<HistoryEntry['action'], string> = {
    sent: 'Sent', received: 'Received by the store', update: 'Quantities changed',
    approve: 'Approved', hold: 'Put on hold', reject: 'Rejected', start: 'Production started', dispatch: 'Dispatched',
    resume: 'Resumed', deliver: 'Marked delivered', close: 'Closed', reopen: 'Reopened',
};
