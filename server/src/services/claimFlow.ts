/**
 * A warranty or alteration claim, from the customer or store to head office:
 *
 *   inspect    → the store checks the car (photos, finding, suggestion)
 *   decide     → head office approves (FOC or chargeable), rejects, or asks
 *                the store for more
 *   payment    → a chargeable claim waits for the customer's payment
 *   repair     → the store repairs it on site
 *   send       → the plant or a distributor sends material to the store
 *   dispatched → on the way; the store fits it
 *   fixed      → done at the store; the customer (or head office) closes it
 *   closed / rejected
 *
 * Every step keeps the claim as it was before it, so head office can undo.
 * The defective part (return to plant or scrap) is recorded beside the steps.
 * Free of any database import, so it is tested directly.
 */

export type ClaimStatus = 'inspect' | 'decide' | 'payment' | 'repair' | 'send' | 'dispatched' | 'fixed' | 'closed' | 'rejected';
export type ClaimAction = 'inspect' | 'ask_more' | 'approve' | 'reject' | 'paid' | 'dispatch' | 'fixed' | 'close' | 'undo' | 'edit';
export type ClaimKind = 'warranty' | 'alteration';
export type Actor = 'customer' | 'vendor' | 'admin';

export interface Inspection {
    covered: boolean;
    reason: string | null;
    suggest: 'repair_store' | 'send_material';
    note: string;
    photos: string[];
    at: string;
}

export interface Decision {
    outcome: 'repair_store' | 'send_material' | 'reject';
    material: 'replacement' | 'repaired' | 'alteration' | null;
    item: string | null;
    source: 'plant' | 'distributor' | null;
    distributor: string | null;
    charge: 'foc' | 'chargeable' | null;
    amount: number | null;
    old_part: 'return' | 'scrap' | null;
    reason: string | null;
    note: string | null;
    at: string;
}

export interface Payment { mode: 'upi' | 'bank' | 'cash' | 'other'; ref: string; at: string }
export interface Dispatch { courier: string; tracking: string; date: string | null }
export interface Fixed { note: string | null; photos: string[]; at: string; by: Actor }

/** What a step changes, kept so Undo can put it back. */
export interface ClaimSnapshot {
    status: ClaimStatus;
    inspection: Inspection | null;
    decision: Decision | null;
    payment: Payment | null;
    dispatch: Dispatch | null;
    fixed: Fixed | null;
}

export interface FlowClaim extends ClaimSnapshot {
    kind: ClaimKind;
    trail?: ClaimSnapshot[];
}

export interface ClaimInput {
    covered?: unknown; reason?: unknown; suggest?: unknown; note?: unknown; photos?: string[];
    outcome?: unknown; material?: unknown; item?: unknown; source?: unknown; distributor?: unknown;
    charge?: unknown; amount?: unknown; old_part?: unknown;
    mode?: unknown; ref?: unknown;
    courier?: unknown; tracking?: unknown; date?: unknown;
}

/* ─── What can be claimed ─────────────────────────────────────────────────── */

/** The problems a claim can be raised for, as the T&C cover them. */
export const PROBLEMS: Record<string, { label: string; hint: string }> = {
    stitching_defect: { label: 'Stitching defect', hint: 'Thread or seam has come open' },
    colour_bleeding: { label: 'Colour bleeding', hint: 'Colour is running or spreading' },
    rubbing_fastness: { label: 'Rubbing fastness', hint: 'Colour comes off on clothes when rubbed' },
    product_defect: { label: 'Manufacturing defect', hint: 'Describe what is wrong' },
    alteration: { label: 'Alteration needed', hint: 'Describe what needs to change' },
};

/**
 * One list for warranty claims and alterations: the T&C's problems need the
 * warranty in its period, an alteration only an approved registration.
 */
export function problemsFor(productType: string | null | undefined, covered = true): string[] {
    const tc = productType === 'seat-cover' ? ['stitching_defect', 'colour_bleeding', 'rubbing_fastness'] : ['product_defect'];
    return [...(covered ? tc : []), 'alteration'];
}

/** A claim is an alteration when that is the problem chosen. */
export const kindOf = (problem: string): ClaimKind => (problem === 'alteration' ? 'alteration' : 'warranty');

/** Why a claim is not covered, from the T&C's exclusions. */
export const REJECT_REASONS: Record<string, string> = {
    sharp_object: 'Torn or cut by a sharp object',
    fading: 'Fading from sun exposure or chemicals',
    spill_stain: 'Oil or chemical spill, dirt or food stains',
    cleaning: 'Cleaned with prohibited products',
    commercial: 'Commercial, fleet or rental use',
    altered: 'Altered or repaired after sale',
    disaster: 'Fire, flood or natural disaster',
    installation: 'Physical damage during or after installation',
    expired: 'Warranty period is over',
    wrong_info: 'Information found incorrect or incomplete',
    other: 'Other',
};

/** Years of cover from the warranty's text: "1+1 year" → 2, "2 + 1 year" → 3, "7 years" → 7. */
export function warrantyYears(text: string | null | undefined): number {
    const nums = String(text ?? '').match(/\d+/g);
    if (!nums) return 0;
    return nums.map(Number).reduce((a, b) => a + b, 0);
}

/**
 * Whether a warranty can be claimed on now. Cover starts at the purchase date
 * (the T&C's "date of online warranty punching"), else the registration.
 */
export function coverage(w: { status: string; warranty_type?: string | null; purchase_date?: string | Date | null; created_at?: string | Date | null }, now = new Date()):
    { years: number; start: string | null; end: string | null; covered: boolean; why: string | null } {
    const years = warrantyYears(w.warranty_type);
    const base = w.purchase_date || w.created_at;
    const start = base ? new Date(base) : null;
    if (!start || Number.isNaN(start.getTime())) return { years, start: null, end: null, covered: false, why: 'No start date on the warranty' };
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + years);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (w.status !== 'validated') return { years, start: iso(start), end: iso(end), covered: false, why: 'Warranty is not approved yet' };
    if (!years) return { years, start: iso(start), end: iso(end), covered: false, why: 'Warranty period is not known' };
    if (end < now) return { years, start: iso(start), end: iso(end), covered: false, why: 'Warranty period is over' };
    return { years, start: iso(start), end: iso(end), covered: true, why: null };
}

/* ─── Steps ───────────────────────────────────────────────────────────────── */

const FROM: Record<Exclude<ClaimAction, 'undo' | 'edit'>, ClaimStatus[]> = {
    inspect: ['inspect'],
    ask_more: ['decide'],
    approve: ['decide'],
    reject: ['inspect', 'decide'],
    paid: ['payment'],
    dispatch: ['send'],
    fixed: ['repair', 'dispatched'],
    close: ['fixed'],
};

/** Who may take each step. */
const WHO: Record<ClaimAction, Actor[]> = {
    inspect: ['vendor'], ask_more: ['admin'], approve: ['admin'], reject: ['admin'], paid: ['admin'],
    dispatch: ['admin'], fixed: ['vendor', 'admin'], close: ['customer', 'admin'], undo: ['admin'], edit: ['admin'],
};

export const CLAIM_ACTIONS = Object.keys(WHO) as ClaimAction[];

/** The steps open on a claim now for this person, in the order they are offered. */
export function actionsFor(c: FlowClaim, actor: Actor): ClaimAction[] {
    const out = (Object.keys(FROM) as (keyof typeof FROM)[])
        .filter(a => FROM[a].includes(c.status) && WHO[a].includes(actor)) as ClaimAction[];
    if (actor === 'admin' && c.trail?.length) out.push('undo');
    if (actor === 'admin' && c.decision && c.decision.outcome !== 'reject') out.push('edit');
    return out;
}

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const pick = <T extends string>(v: unknown, ok: readonly T[]): T | null => (ok as readonly string[]).includes(String(v)) ? v as T : null;
const MAX_AMOUNT = 500000;

const snap = (c: FlowClaim): ClaimSnapshot => ({
    status: c.status, inspection: c.inspection ?? null, decision: c.decision ?? null,
    payment: c.payment ?? null, dispatch: c.dispatch ?? null, fixed: c.fixed ?? null,
});

function readAmount(v: unknown): number | { error: string } {
    const n = Math.round(Number(v) * 100) / 100;
    if (!(n > 0 && n <= MAX_AMOUNT)) return { error: 'Enter the amount the customer pays' };
    return n;
}

function readDispatch(input: ClaimInput): Dispatch | { error: string } {
    const courier = text(input.courier, 80);
    if (!courier) return { error: 'Enter how it was sent (courier, by hand, through the distributor…)' };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? '')) ? String(input.date) : null;
    return { courier, tracking: text(input.tracking, 80), date };
}

/** Head office's decision from what was sent: the decision, or why it is not complete. */
function readDecision(input: ClaimInput, kind: ClaimKind, at: string): Decision | { error: string } {
    const outcome = pick(input.outcome, ['repair_store', 'send_material'] as const);
    if (!outcome) return { error: 'Choose repair at the store or send material' };
    const charge = pick(input.charge, ['foc', 'chargeable'] as const);
    if (!charge) return { error: 'Choose FOC or chargeable' };
    let amount: number | null = null;
    if (charge === 'chargeable') {
        const a = readAmount(input.amount);
        if (typeof a !== 'number') return a;
        amount = a;
    }
    let material: Decision['material'] = null, item: string | null = null, source: Decision['source'] = null, distributor: string | null = null;
    if (outcome === 'send_material') {
        material = pick(input.material, ['replacement', 'repaired', 'alteration'] as const) ?? (kind === 'alteration' ? 'alteration' : 'replacement');
        item = text(input.item, 200);
        if (!item) return { error: 'Enter what is being sent' };
        source = pick(input.source, ['plant', 'distributor'] as const) ?? 'plant';
        if (source === 'distributor') {
            distributor = text(input.distributor, 120);
            if (!distributor) return { error: 'Enter which distributor sends it' };
        }
    }
    const old_part = input.old_part === undefined || input.old_part === null || input.old_part === ''
        ? null : pick(input.old_part, ['return', 'scrap'] as const);
    if (input.old_part && !old_part) return { error: 'Choose return to plant or scrap for the old part' };
    return { outcome, material, item, source, distributor, charge, amount, old_part, reason: null, note: text(input.note, 1000) || null, at };
}

/** One step on a claim: the claim after it, or why it cannot be taken. */
export function applyClaimAction<T extends FlowClaim>(claim: T, action: string, actor: Actor, input: ClaimInput = {}, now = new Date()):
    { claim: T } | { error: string } {
    const a = action as ClaimAction;
    if (!CLAIM_ACTIONS.includes(a)) return { error: 'Unknown action' };
    if (!WHO[a].includes(actor)) return { error: 'You cannot take this step' };
    const at = now.toISOString();
    const trail = [...(claim.trail ?? [])];

    if (a === 'undo') {
        const prev = trail.pop();
        if (!prev) return { error: 'There is no step to undo' };
        return { claim: { ...claim, ...prev, trail } };
    }

    if (a === 'edit') {
        const d = claim.decision;
        if (!d || d.outcome === 'reject') return { error: 'Nothing to edit before a decision' };
        const out: T = { ...claim, decision: { ...d } };
        if (input.note !== undefined) out.decision!.note = text(input.note, 1000) || null;
        if (input.item !== undefined && d.outcome === 'send_material') {
            const item = text(input.item, 200);
            if (!item) return { error: 'Enter what is being sent' };
            out.decision!.item = item;
        }
        if (input.amount !== undefined && input.amount !== null && input.amount !== '') {
            if (d.charge !== 'chargeable') return { error: 'This claim is FOC' };
            if (claim.status !== 'payment') return { error: 'The payment is already in: undo it to change the amount' };
            const amt = readAmount(input.amount);
            if (typeof amt !== 'number') return amt;
            out.decision!.amount = amt;
        }
        if (input.courier !== undefined) {
            if (!claim.dispatch) return { error: 'Not dispatched yet' };
            const disp = readDispatch(input);
            if ('error' in disp) return disp;
            out.dispatch = disp;
        }
        return { claim: out };
    }

    if (!FROM[a].includes(claim.status)) return { error: `This claim is ${STATUS_TEXT[claim.status].toLowerCase()}: it cannot be ${PAST[a]} now` };
    trail.push(snap(claim));
    const out: T = { ...claim, trail };
    const note = text(input.note, 1000);

    switch (a) {
        case 'inspect': {
            const photos = (input.photos ?? []).filter(Boolean);
            if (!photos.length && !(claim.inspection?.photos?.length)) return { error: 'Add at least one photo from your inspection' };
            const covered = input.covered === true || input.covered === 'true' || input.covered === 'yes';
            const reason = covered ? null : pick(input.reason, Object.keys(REJECT_REASONS));
            if (!covered && !reason) return { error: 'Choose why it is not covered' };
            const suggest = pick(input.suggest, ['repair_store', 'send_material'] as const) ?? 'send_material';
            if (note.length < 3) return { error: 'Write what you found' };
            return { claim: { ...out, status: 'decide', inspection: { covered, reason, suggest, note, photos: [...(claim.inspection?.photos ?? []), ...photos].slice(0, 10), at } } };
        }
        case 'ask_more':
            if (note.length < 3) return { error: 'Tell the store what more is needed' };
            return { claim: { ...out, status: 'inspect' } };
        case 'approve': {
            const d = readDecision(input, claim.kind, at);
            if ('error' in d) return d;
            const next: ClaimStatus = d.charge === 'chargeable' ? 'payment' : d.outcome === 'repair_store' ? 'repair' : 'send';
            return { claim: { ...out, status: next, decision: d } };
        }
        case 'reject': {
            const reason = pick(input.reason, Object.keys(REJECT_REASONS));
            if (!reason) return { error: 'Choose the reason from the T&C' };
            if (reason === 'other' && note.length < 3) return { error: 'Write the reason, the customer sees it' };
            return {
                claim: {
                    ...out, status: 'rejected',
                    decision: { outcome: 'reject', material: null, item: null, source: null, distributor: null, charge: null, amount: null, old_part: null, reason, note: note || null, at },
                },
            };
        }
        case 'paid': {
            const mode = pick(input.mode, ['upi', 'bank', 'cash', 'other'] as const);
            if (!mode) return { error: 'Choose how it was paid' };
            const next: ClaimStatus = claim.decision?.outcome === 'repair_store' ? 'repair' : 'send';
            return { claim: { ...out, status: next, payment: { mode, ref: text(input.ref, 120), at } } };
        }
        case 'dispatch': {
            const d = readDispatch(input);
            if ('error' in d) return d;
            return { claim: { ...out, status: 'dispatched', dispatch: d } };
        }
        case 'fixed':
            return { claim: { ...out, status: 'fixed', fixed: { note: note || null, photos: (input.photos ?? []).slice(0, 5), at, by: actor } } };
        case 'close':
            return { claim: { ...out, status: 'closed' } };
    }
}

/* ─── Words ───────────────────────────────────────────────────────────────── */

export const STATUS_TEXT: Record<ClaimStatus, string> = {
    inspect: 'With the store', decide: 'With head office', payment: 'Waiting for payment', repair: 'To repair at store',
    send: 'To send', dispatched: 'On the way', fixed: 'Fixed', closed: 'Closed', rejected: 'Not approved',
};

const PAST: Record<keyof typeof FROM, string> = {
    inspect: 'inspected', ask_more: 'sent back to the store', approve: 'approved', reject: 'rejected', paid: 'marked paid',
    dispatch: 'dispatched', fixed: 'marked fixed', close: 'closed',
};

/** A step in words, for the timeline and the notifications. */
export function stepText(action: ClaimAction, c: FlowClaim): string {
    const d = c.decision;
    switch (action) {
        case 'inspect': return c.inspection?.covered ? 'Store checked: covered' : `Store checked: not covered (${REJECT_REASONS[c.inspection?.reason ?? ''] ?? 'see note'})`;
        case 'ask_more': return 'Head office asked the store for more';
        case 'approve': {
            const what = d?.outcome === 'repair_store' ? 'repair at the store' : `${d?.material === 'repaired' ? 'repaired product' : d?.material === 'alteration' ? 'alteration material' : 'replacement'} from the ${d?.source === 'distributor' ? 'distributor' : 'plant'}`;
            return `Approved: ${what}, ${d?.charge === 'chargeable' ? `chargeable ₹${d.amount}` : 'FOC'}`;
        }
        case 'reject': return `Not approved: ${REJECT_REASONS[d?.reason ?? ''] ?? 'see note'}`;
        case 'paid': return 'Payment received';
        case 'dispatch': return `Dispatched · ${[c.dispatch?.courier, c.dispatch?.tracking].filter(Boolean).join(' · ')}`;
        case 'fixed': return c.decision?.outcome === 'repair_store' ? 'Repaired at the store' : 'Fitted at the store';
        case 'close': return 'Claim closed';
        case 'undo': return `Step undone: back to ${STATUS_TEXT[c.status].toLowerCase()}`;
        case 'edit': return 'Decision edited';
    }
}
