/**
 * Each item of a POSM request moves on its own:
 *
 *   To approve → approve (a quantity) · hold · reject (a reason)
 *   Approved      → start production · dispatch · hold · reject
 *   In production → dispatch · hold · reject
 *   On hold       → resume (back to where it was held) · reject
 *   Dispatched    → deliver
 *   Rejected      → approve (approve instead)
 *   Any step can be undone, back to the one before; the quantity, the note
 *   to the store and the courier can be edited at any time.
 *
 * The request's own status follows from its items (requestStatus). Free of
 * any database import, so it is tested directly.
 */

export type LineStage = 'pending' | 'approved' | 'in_production' | 'on_hold' | 'dispatched' | 'delivered' | 'rejected';
export type LineAction = 'approve' | 'hold' | 'reject' | 'start' | 'dispatch' | 'deliver' | 'resume' | 'undo' | 'edit';

export interface LineDispatch { courier: string; tracking: string; date: string | null }

/** What a step changes on a line, kept so Undo can put it back. */
export interface LineSnapshot {
    line_status: LineStage;
    approved_qty: number | null;
    note: string | null;
    dispatch: LineDispatch | null;
    delivered_at: string | null;
    delivered_by: 'admin' | 'franchise' | null;
}

export interface FlowLine {
    item_name: string;
    qty: number;
    approved_qty?: number | null;
    line_status?: string;
    /** To the store: why fewer, why on hold, why not approved. */
    note?: string | null;
    dispatch?: LineDispatch | null;
    delivered_at?: string | null;
    delivered_by?: 'admin' | 'franchise' | null;
    /** The line before each step, newest last. */
    trail?: LineSnapshot[];
}

export interface LineInput {
    qty?: unknown;
    /** For edit: undefined keeps the note, '' clears it. */
    note?: unknown;
    dispatch?: unknown;
    by?: 'admin' | 'franchise';
}

const FROM: Record<Exclude<LineAction, 'undo' | 'edit'>, LineStage[]> = {
    approve: ['pending', 'rejected'],
    hold: ['pending', 'approved', 'in_production'],
    reject: ['pending', 'approved', 'in_production', 'on_hold'],
    start: ['approved'],
    dispatch: ['approved', 'in_production'],
    deliver: ['dispatched'],
    resume: ['on_hold'],
};

export const LINE_ACTIONS = [...Object.keys(FROM), 'undo', 'edit'] as LineAction[];
const MAX_QTY = 1000;

export const stageOf = (l: FlowLine): LineStage =>
    (['pending', 'approved', 'in_production', 'on_hold', 'dispatched', 'delivered', 'rejected'] as string[]).includes(String(l.line_status))
        ? l.line_status as LineStage : 'pending';

/** The steps open on a line now, in the order they are offered. */
export function lineActionsFor(l: FlowLine): LineAction[] {
    const s = stageOf(l);
    const out = (Object.keys(FROM) as (keyof typeof FROM)[]).filter(a => FROM[a].includes(s)) as LineAction[];
    if (l.trail?.length) out.push('undo');
    out.push('edit');
    return out;
}

const snap = (l: FlowLine): LineSnapshot => ({
    line_status: stageOf(l), approved_qty: l.approved_qty ?? null, note: l.note ?? null,
    dispatch: l.dispatch ?? null, delivered_at: l.delivered_at ?? null, delivered_by: l.delivered_by ?? null,
});

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const whole = (v: unknown) => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };

export function readDispatch(d: any): LineDispatch | { error: string } {
    const courier = text(d?.courier, 80);
    const tracking = text(d?.tracking, 80);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(d?.date ?? '')) ? String(d.date) : null;
    if (!courier) return { error: 'Enter how it was sent (courier, by hand, through the distributor…)' };
    return { courier, tracking, date };
}

function readQty(v: unknown, l: FlowLine): number | { error: string } {
    const q = whole(v);
    if (!(q >= 1 && q <= MAX_QTY)) return { error: `${l.item_name}: the quantity to send must be 1 to ${MAX_QTY}` };
    return q;
}

/** One step on one line: the line after it, or why it cannot be taken. */
export function applyLineAction<T extends FlowLine>(line: T, action: string, input: LineInput = {}, now = new Date()): { line: T } | { error: string } {
    const a = action as LineAction;
    if (!LINE_ACTIONS.includes(a)) return { error: 'Unknown action' };
    const s = stageOf(line);
    const trail = [...(line.trail ?? [])];
    const name = line.item_name;

    if (a === 'undo' || a === 'resume') {
        if (a === 'resume' && s !== 'on_hold') return { error: `${name} is not on hold` };
        const prev = trail.pop();
        if (!prev) return { error: `${name}: there is no step to undo` };
        return { line: { ...line, ...prev, trail } };
    }

    if (a === 'edit') {
        const out: T = { ...line };
        if (input.qty !== undefined && input.qty !== null && input.qty !== '') {
            if (s === 'rejected') return { error: `${name} is rejected: approve it instead to set a quantity` };
            const q = readQty(input.qty, line);
            if (typeof q !== 'number') return q;
            out.approved_qty = q;
        }
        if (input.note !== undefined) {
            const n = text(input.note, 500);
            if (s === 'rejected' && n.length < 3) return { error: `${name}: keep a reason for the store` };
            out.note = n || null;
        }
        if (input.dispatch !== undefined && input.dispatch !== null) {
            if (!['dispatched', 'delivered'].includes(s)) return { error: `${name} is not dispatched yet` };
            const d = readDispatch(input.dispatch);
            if ('error' in d) return d;
            out.dispatch = d;
        }
        return { line: out };
    }

    if (!FROM[a].includes(s)) return { error: `${name} is ${STAGE_TEXT[s].toLowerCase()}: it cannot be ${PAST[a]} now` };
    trail.push(snap(line));
    const note = input.note === undefined ? undefined : text(input.note, 500) || null;
    const out: T = { ...line, trail };

    switch (a) {
        case 'approve': {
            const asked = input.qty !== undefined && input.qty !== null && input.qty !== ''
                ? input.qty : (line.approved_qty && line.approved_qty > 0 ? line.approved_qty : line.qty);
            const q = readQty(asked, line);
            if (typeof q !== 'number') return q;
            return { line: { ...out, line_status: 'approved', approved_qty: q, note: note ?? null } };
        }
        case 'reject': {
            if (!note || note.length < 3) return { error: `${name}: give the reason, the store sees it` };
            return { line: { ...out, line_status: 'rejected', approved_qty: 0, note } };
        }
        case 'hold':
            return { line: { ...out, line_status: 'on_hold', note: note ?? null } };
        case 'start':
            return { line: { ...out, line_status: 'in_production', ...(note !== undefined ? { note } : {}) } };
        case 'dispatch': {
            const d = readDispatch(input.dispatch);
            if ('error' in d) return d;
            return { line: { ...out, line_status: 'dispatched', dispatch: d, approved_qty: line.approved_qty ?? line.qty } };
        }
        case 'deliver':
            return { line: { ...out, line_status: 'delivered', delivered_at: now.toISOString(), delivered_by: input.by ?? 'admin' } };
    }
}

const ORDER: LineStage[] = ['pending', 'approved', 'in_production', 'dispatched', 'delivered'];

/**
 * The request's status from its items: the least advanced item still going
 * (to approve first), on hold when every one left is held, rejected when all
 * are. A closed request stays closed while every item is still delivered.
 */
export function requestStatus(lines: FlowLine[], current: string): string {
    const live = lines.filter(l => stageOf(l) !== 'rejected');
    if (!live.length) return 'rejected';
    const moving = live.filter(l => stageOf(l) !== 'on_hold');
    if (!moving.length) return 'pending';
    const least = ORDER[Math.min(...moving.map(l => ORDER.indexOf(stageOf(l))))];
    if (least === 'pending') return 'open';
    if (least === 'delivered' && current === 'closed') return 'closed';
    return least;
}

/**
 * Lines saved before items moved on their own carry only pending / approved
 * / rejected; their real stage was the request's. Gives each its own stage,
 * once, from the request. Lines already on their own are unchanged.
 */
export function ownStages<T extends FlowLine>(lines: T[], req: {
    status: string; dispatch?: any; delivery?: any; heldFrom?: string;
}): T[] {
    const own = lines.some(l => ['in_production', 'on_hold', 'dispatched', 'delivered'].includes(String(l.line_status)) || l.trail);
    if (own) return lines;
    const st = req.status;
    return lines.map(l => {
        const s = stageOf(l);
        if (s === 'rejected') return l;
        if (st === 'rejected') return { ...l, line_status: 'rejected', approved_qty: 0 };
        if (st === 'pending') {
            const was = (req.heldFrom === 'approved' || req.heldFrom === 'in_production') ? req.heldFrom : 'pending';
            const before = { ...l, line_status: was === 'pending' ? s : was } as FlowLine;
            return { ...l, line_status: 'on_hold', trail: [snap(before)] };
        }
        const map: Record<string, LineStage> = { in_production: 'in_production', dispatched: 'dispatched', delivered: 'delivered', closed: 'delivered' };
        const to = map[st];
        if (!to || s !== 'approved') return l;
        const d = req.dispatch?.courier ? readDispatch(req.dispatch) : null;
        return {
            ...l, line_status: to,
            ...(to !== 'in_production' && d && !('error' in d) ? { dispatch: d } : {}),
            ...(to === 'delivered' ? { delivered_at: req.delivery?.at ?? null, delivered_by: req.delivery?.by ?? 'admin' } : {}),
        };
    });
}

export const STAGE_TEXT: Record<LineStage, string> = {
    pending: 'To approve', approved: 'Approved', in_production: 'In production', on_hold: 'On hold',
    dispatched: 'Dispatched', delivered: 'Delivered', rejected: 'Rejected',
};

const PAST: Record<keyof typeof FROM, string> = {
    approve: 'approved', hold: 'put on hold', reject: 'rejected', start: 'put into production',
    dispatch: 'dispatched', deliver: 'marked delivered', resume: 'resumed',
};

/** A step on some items in words, for the timeline and the store's notification. */
export function stepText(action: LineAction, names: string[], lines?: FlowLine[]): string {
    const who = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
    const verb: Record<LineAction, string> = {
        approve: 'approved', hold: 'put on hold', reject: 'not approved', start: 'in production', dispatch: 'dispatched',
        deliver: 'delivered', resume: 'resumed', undo: 'step undone', edit: 'updated',
    };
    let s = `${who}: ${verb[action]}`;
    if ((action === 'undo' || action === 'resume') && lines?.length) {
        const back = [...new Set(lines.map(stageOf))];
        if (back.length === 1) s = `${who}: back to ${back[0] === 'pending' ? 'waiting for approval' : STAGE_TEXT[back[0]].toLowerCase()}${action === 'undo' ? ' (undone)' : ''}`;
    }
    if (action === 'approve' && lines?.length === 1) {
        const l = lines[0];
        if ((l.approved_qty ?? l.qty) !== l.qty) s += ` (${l.approved_qty} of ${l.qty})`;
    }
    return s;
}
