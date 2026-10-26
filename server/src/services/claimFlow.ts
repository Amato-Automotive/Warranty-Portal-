/**
 * A warranty claim or alteration, from the customer to the plant (MFU):
 *
 *   verify      → the store checks it, adds remarks, corrects the details
 *   review      → the plant decides: approve (FOC or chargeable), reject,
 *                 put on hold, or ask the store for more
 *   on_hold     → the plant is waiting on something; it decides from here
 *   consent     → chargeable: the customer agrees (or the store, for them)
 *   repair      → the store repairs it on site
 *   plan        → the plant sets the EDD and the alteration number
 *   production  → being prepared; the plant marks it ready
 *   ready       → made; the plant dispatches it (date, docket)
 *   dispatched  → on the way; the store confirms it reached and was fitted
 *   closed / rejected / declined
 *
 * Plant steps are per person: the super admin gives each one the rights they
 * need (decide, plan, dispatch, edit). Everyone else with access only views.
 * Every step keeps the claim as it was before it, so it can be undone, and
 * edits and undos need a reason. Free of any database import, so it is tested
 * directly.
 */

export type ClaimStatus = 'verify' | 'review' | 'on_hold' | 'consent' | 'repair' | 'plan' | 'production' | 'ready' | 'dispatched' | 'closed' | 'rejected' | 'declined';
export type ClaimAction = 'verify' | 'ask_more' | 'hold' | 'approve' | 'reject' | 'consent' | 'decline' | 'plan' | 'ready' | 'dispatch' | 'fitted' | 'edit' | 'undo';
export type ClaimKind = 'warranty' | 'alteration';
export type Actor = 'customer' | 'vendor' | 'admin';
/** What a plant person may do, beyond seeing every claim. */
export type PlantRight = 'decide' | 'plan' | 'dispatch' | 'edit';
export const PLANT_RIGHTS: PlantRight[] = ['decide', 'plan', 'dispatch', 'edit'];

/** Who is acting: the customer, the store, or a plant person and their rights. */
export interface Who { actor: Actor; rights?: PlantRight[] }

/**
 * Whether the plant also tracks the defective part (back to the plant or
 * scrapped). Off for now; the question stays in the decision so it can be
 * switched on without reworking the flow.
 */
export const OLD_PART_ENABLED = false;

export interface Vehicle { make: string; model: string; airbags: 'with' | 'without' | null }

export interface Verification { remarks: string | null; corrections: string[]; photos: string[]; at: string }
export interface Hold { reason: string; note: string | null; at: string }

export interface Decision {
    outcome: 'repair_store' | 'send_material' | 'reject';
    charge: 'foc' | 'chargeable' | null;
    item: string | null;
    source: 'plant' | 'distributor' | null;
    old_part: 'return' | 'scrap' | null;
    reason: string | null;
    remarks: string | null;
    at: string;
}

export interface Consent { agreed: boolean; by: 'customer' | 'store'; note: string | null; at: string }
export interface Plan { edd: string; alteration_no: string | null; at: string }
export interface Dispatch { date: string; docket: string; courier: string | null; at: string }
export interface Fitted { note: string | null; photos: string[]; at: string; by: Actor }

/** What a step changes, kept so Undo can put it back. */
export interface ClaimSnapshot {
    status: ClaimStatus;
    problem: string;
    description: string | null;
    vehicle: Vehicle | null;
    verification: Verification | null;
    hold: Hold | null;
    decision: Decision | null;
    consent: Consent | null;
    plan: Plan | null;
    dispatch: Dispatch | null;
    fitted: Fitted | null;
}

export interface FlowClaim extends ClaimSnapshot {
    kind: ClaimKind;
    product_type?: string | null;
    trail?: ClaimSnapshot[];
}

export interface ClaimInput {
    [k: string]: unknown;
    photos?: string[];
}

/* ─── What can be claimed ─────────────────────────────────────────────────── */

/**
 * The issue a claim is raised for. A placeholder until the plant's full list
 * (about 70) arrives; 'alteration' is what makes a claim an alteration.
 */
export const PROBLEMS: Record<string, { label: string; hint: string; group: string }> = {
    // Peel and PU
    peel_off: { label: 'Peel off', hint: 'Surface or PU is peeling', group: 'Peel and PU' },
    pu_tear: { label: 'PU tear', hint: 'The PU has torn', group: 'Peel and PU' },
    pu_crack: { label: 'PU crack', hint: 'The PU has cracked', group: 'Peel and PU' },
    perfo_issue: { label: 'Perfo tear / perfo issue', hint: 'Perforated panel torn or faulty', group: 'Peel and PU' },
    wrinkles: { label: 'Wrinkles', hint: 'Cover has wrinkled', group: 'Peel and PU' },
    // Stitching
    stitch_issue: { label: 'Stitch issue', hint: 'Thread or seam has come open', group: 'Stitching' },
    tear_stitch: { label: 'Tear at the stitch', hint: 'Torn along a seam', group: 'Stitching' },
    // Damage and marks
    cut_mark: { label: 'Cut / hook mark', hint: 'A cut or hook mark on the cover', group: 'Damage and marks' },
    hole: { label: 'Hole', hint: 'A hole in the cover', group: 'Damage and marks' },
    mark: { label: 'Mark (ink, tape, wire)', hint: 'A mark on the cover', group: 'Damage and marks' },
    damaged: { label: 'Physical damage', hint: 'Damaged in use', group: 'Damage and marks' },
    transit_damage: { label: 'Damaged in transport', hint: 'Arrived damaged', group: 'Damage and marks' },
    colour_issue: { label: 'Colour issue / colour difference', hint: 'Colour bleeding, fading or a mismatch in a new set', group: 'Damage and marks' },
    // Fitting and size
    fitting_issue: { label: 'Fitting issue / loose fitting', hint: 'Does not sit right', group: 'Fitting and size' },
    size_issue: { label: 'Size issue', hint: 'Wrong size', group: 'Fitting and size' },
    short: { label: 'Short', hint: 'A piece is too short (e.g. rear arm rest)', group: 'Fitting and size' },
    airbag_fitting: { label: 'Airbag fitting issue', hint: 'Airbag opening wrong, one-sided or with a gap', group: 'Fitting and size' },
    chain_defect: { label: 'Chain / zip defect', hint: 'Chain or zip faulty', group: 'Fitting and size' },
    // Wrong or missing
    missing: { label: 'Missing part', hint: 'A part (e.g. head rest kit) is missing from the set', group: 'Wrong or missing' },
    wrong_received: { label: 'Wrong item received', hint: 'Different design, colour or item', group: 'Wrong or missing' },
    model_wrong: { label: 'Wrong model', hint: 'Made for a different car model', group: 'Wrong or missing' },
    // Other
    manufacturing_defect: { label: 'Manufacturing defect', hint: 'Describe what is wrong', group: 'Other' },
    alteration: { label: 'Alteration needed', hint: 'Describe what needs to change', group: 'Other' },
    other: { label: 'Other', hint: 'Describe the problem', group: 'Other' },
};

/** Issues that need the customer's own words. */
export const NEEDS_DESCRIPTION = ['manufacturing_defect', 'alteration', 'other'];

/**
 * The issues offered on a warranty: all of them while it is in warranty, only
 * an alteration after.
 */
export function problemsFor(_productType: string | null | undefined, covered = true): string[] {
    return covered ? Object.keys(PROBLEMS) : ['alteration'];
}

/** A claim is an alteration when that is the issue chosen. */
export const kindOf = (problem: string): ClaimKind => (problem === 'alteration' ? 'alteration' : 'warranty');

/** Airbags matter only where a seat cover sits over them. */
export const asksAirbags = (productType: string | null | undefined) => productType === 'seat-cover';

/** Why a claim is not approved, from the T&C's exclusions. */
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

/** Why the plant has put a claim on hold. */
export const HOLD_REASONS: Record<string, string> = {
    model: 'Model or model year to confirm',
    airbags: 'With or without airbag to confirm',
    design_colour: 'Design or colour to confirm',
    details: 'Waiting for more photos or details',
    party: "Waiting for the store's confirmation",
    component: 'Component not available',
    checking: 'Checking with production',
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

/* ─── Reading what was sent ───────────────────────────────────────────────── */

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const pick = <T extends string>(v: unknown, ok: readonly T[]): T | null => (ok as readonly string[]).includes(String(v)) ? v as T : null;
const yes = (v: unknown) => v === true || v === 'true' || v === 'yes' || v === '1' || v === 'on';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The car as the customer or store gave it, or why it is not complete. */
export function readVehicle(input: ClaimInput, productType: string | null | undefined): Vehicle | { error: string } {
    const make = text(input.vehicle_make, 60);
    const model = text(input.vehicle_model, 60);
    if (!make) return { error: 'Enter the vehicle make' };
    if (!model) return { error: 'Enter the vehicle model' };
    const airbags = pick(input.airbags, ['with', 'without'] as const);
    if (asksAirbags(productType) && !airbags) return { error: 'Choose with or without airbags' };
    return { make, model, airbags: asksAirbags(productType) ? airbags : null };
}

/** A new claim's issue and description, or why they are not complete. */
export function readProblem(input: ClaimInput, covered: boolean): { problem: string; description: string | null } | { error: string } {
    const problem = String(input.problem ?? '');
    if (!PROBLEMS[problem]) return { error: 'Choose the issue' };
    if (!problemsFor(null, covered).includes(problem)) return { error: 'Out of warranty: only an alteration can be requested' };
    const description = text(input.description, 2000);
    if (NEEDS_DESCRIPTION.includes(problem) && description.length < 5) return { error: 'Describe the problem' };
    return { problem, description: description || null };
}

const vehicleText = (v: Vehicle | null) => v ? [v.make, v.model, v.airbags ? `${v.airbags} airbags` : null].filter(Boolean).join(' · ') : '(none)';

/**
 * The claim's details as corrected, and the changes in words. Only the fields
 * sent are changed; a correction that leaves something invalid is refused.
 */
function correctDetails(c: FlowClaim, input: ClaimInput): { patch: Partial<ClaimSnapshot>; kind: ClaimKind; changes: string[] } | { error: string } {
    const changes: string[] = [];
    const patch: Partial<ClaimSnapshot> = {};
    let kind = c.kind;
    if (input.vehicle_make !== undefined || input.vehicle_model !== undefined || input.airbags !== undefined) {
        const v = readVehicle({
            vehicle_make: input.vehicle_make ?? c.vehicle?.make, vehicle_model: input.vehicle_model ?? c.vehicle?.model,
            airbags: input.airbags ?? c.vehicle?.airbags,
        }, c.product_type);
        if ('error' in v) return v;
        if (vehicleText(v) !== vehicleText(c.vehicle)) {
            changes.push(`Vehicle: ${vehicleText(c.vehicle)} → ${vehicleText(v)}`);
            patch.vehicle = v;
        }
    }
    if (input.problem !== undefined && input.problem !== c.problem) {
        const problem = String(input.problem);
        if (!PROBLEMS[problem]) return { error: 'Choose the issue' };
        changes.push(`Issue: ${PROBLEMS[c.problem]?.label ?? c.problem} → ${PROBLEMS[problem].label}`);
        patch.problem = problem;
        kind = kindOf(problem);
    }
    if (input.description !== undefined) {
        const d = text(input.description, 2000) || null;
        if (d !== (c.description ?? null)) {
            changes.push('Description corrected');
            patch.description = d;
        }
    }
    const problem = patch.problem ?? c.problem;
    const description = patch.description !== undefined ? patch.description : c.description;
    if (NEEDS_DESCRIPTION.includes(problem) && (description ?? '').length < 5) return { error: 'Describe the problem' };
    return { patch, kind, changes };
}

function readDecision(input: ClaimInput, at: string): Decision | { error: string } {
    const outcome = pick(input.outcome, ['repair_store', 'send_material'] as const);
    if (!outcome) return { error: 'Choose repair at the store or send material' };
    const charge = pick(input.charge, ['foc', 'chargeable'] as const);
    if (!charge) return { error: 'Choose free of cost or chargeable' };
    let item: string | null = null;
    let source: Decision['source'] = null;
    if (outcome === 'send_material') {
        item = text(input.item, 200) || null;
        source = pick(input.source, ['plant', 'distributor'] as const) ?? 'plant';
    }
    let old_part: Decision['old_part'] = null;
    if (OLD_PART_ENABLED && input.old_part) {
        old_part = pick(input.old_part, ['return', 'scrap'] as const);
        if (!old_part) return { error: 'Choose return to plant or scrap for the old part' };
    }
    return { outcome, charge, item, source, old_part, reason: null, remarks: text(input.remarks ?? input.note, 1000) || null, at };
}

function readPlan(input: ClaimInput, at: string): Plan | { error: string } {
    const edd = String(input.edd ?? '');
    if (!DATE.test(edd)) return { error: 'Enter the expected delivery date (EDD)' };
    return { edd, alteration_no: text(input.alteration_no, 60) || null, at };
}

function readDispatch(input: ClaimInput, at: string): Dispatch | { error: string } {
    const date = String(input.dispatch_date ?? '');
    if (!DATE.test(date)) return { error: 'Enter the dispatch date' };
    const docket = text(input.docket, 60);
    if (!docket) return { error: 'Enter the docket number' };
    return { date, docket, courier: text(input.courier, 80) || null, at };
}

/* ─── Steps ───────────────────────────────────────────────────────────────── */

type StepAction = Exclude<ClaimAction, 'edit' | 'undo'>;

const FROM: Record<StepAction, ClaimStatus[]> = {
    verify: ['verify'],
    ask_more: ['review', 'on_hold'],
    hold: ['review'],
    approve: ['review', 'on_hold'],
    reject: ['verify', 'review', 'on_hold'],
    consent: ['consent'],
    decline: ['consent'],
    plan: ['plan'],
    ready: ['production'],
    // Ready is the usual way in, but a set sent straight off the line can skip it.
    dispatch: ['plan', 'production', 'ready'],
    fitted: ['repair', 'dispatched'],
};

/** Who may take each step: the customer, the store, or a plant right. */
const WHO: Record<ClaimAction, (Actor | PlantRight)[]> = {
    verify: ['vendor'],
    ask_more: ['decide'], hold: ['decide'], approve: ['decide'], reject: ['decide'],
    consent: ['customer', 'vendor'], decline: ['customer', 'vendor'],
    plan: ['plan'], ready: ['plan'], dispatch: ['dispatch'],
    fitted: ['vendor', 'edit'],
    edit: ['edit'], undo: ['edit'],
};

export const CLAIM_ACTIONS = Object.keys(WHO) as ClaimAction[];

export function mayTake(action: ClaimAction, who: Who): boolean {
    return WHO[action].some(w => w === who.actor || (who.actor === 'admin' && (who.rights ?? []).includes(w as PlantRight)));
}

/** The steps open on a claim now for this person, in the order they are offered. */
export function actionsFor(c: FlowClaim, who: Who): ClaimAction[] {
    const out = (Object.keys(FROM) as StepAction[]).filter(a => FROM[a].includes(c.status) && mayTake(a, who)) as ClaimAction[];
    if (mayTake('edit', who) && c.status !== 'rejected') out.push('edit');
    if (mayTake('undo', who) && c.trail?.length) out.push('undo');
    return out;
}

/** Whose turn it is, in words, for lists and the tracker. */
export function waitingOn(status: ClaimStatus): string | null {
    switch (status) {
        case 'verify': return 'Store to verify';
        case 'review': return 'Plant to decide';
        case 'on_hold': return 'Plant (on hold)';
        case 'consent': return "Customer's agreement to the charge";
        case 'repair': return 'Store to repair';
        case 'plan': return 'Plant to set EDD';
        case 'production': return 'Plant: being prepared';
        case 'ready': return 'Plant to dispatch';
        case 'dispatched': return 'Store to confirm fitted';
        default: return null;
    }
}

const snap = (c: FlowClaim): ClaimSnapshot => ({
    status: c.status, problem: c.problem, description: c.description ?? null, vehicle: c.vehicle ?? null,
    verification: c.verification ?? null, hold: c.hold ?? null, decision: c.decision ?? null, consent: c.consent ?? null,
    plan: c.plan ?? null, dispatch: c.dispatch ?? null, fitted: c.fitted ?? null,
});

/** Where an approved claim goes next: the customer's agreement, the store's repair, or the plant's plan. */
const afterApproval = (d: Decision): ClaimStatus => d.charge === 'chargeable' ? 'consent' : afterConsent(d);
const afterConsent = (d: Decision): ClaimStatus => d.outcome === 'repair_store' ? 'repair' : 'plan';

/**
 * One step on a claim: the claim after it, what changed (for corrections and
 * edits), or why it cannot be taken.
 */
export function applyClaimAction<T extends FlowClaim>(claim: T, action: string, who: Who, input: ClaimInput = {}, now = new Date()):
    { claim: T; changes: string[] } | { error: string } {
    const a = action as ClaimAction;
    if (!CLAIM_ACTIONS.includes(a)) return { error: 'Unknown action' };
    if (!mayTake(a, who)) return { error: 'You cannot take this step' };
    const at = now.toISOString();
    const trail = [...(claim.trail ?? [])];
    const note = text(input.note, 1000);

    if (a === 'undo') {
        if (note.length < 3) return { error: 'Write why this step is being undone' };
        const prev = trail.pop();
        if (!prev) return { error: 'There is no step to undo' };
        return { claim: { ...claim, ...prev, kind: kindOf(prev.problem), trail }, changes: [] };
    }

    if (a === 'edit') {
        if (claim.status === 'rejected') return { error: 'A rejected claim cannot be edited: undo the rejection first' };
        if (note.length < 3) return { error: 'Write why this is being changed' };
        const fixed = correctDetails(claim, input);
        if ('error' in fixed) return fixed;
        const out: T = { ...claim, ...fixed.patch, kind: fixed.kind };
        const changes = [...fixed.changes];

        const d = claim.decision;
        if (d && d.outcome !== 'reject') {
            const nd = { ...d };
            if (input.remarks !== undefined) {
                const r = text(input.remarks, 1000) || null;
                if (r !== d.remarks) { changes.push('Plant remarks changed'); nd.remarks = r; }
            }
            if (input.item !== undefined && d.outcome === 'send_material') {
                const item = text(input.item, 200) || null;
                if (item !== d.item) { changes.push(`Material: ${d.item ?? '(none)'} → ${item ?? '(none)'}`); nd.item = item; }
            }
            out.decision = nd;
        }
        if (claim.plan && (input.edd !== undefined || input.alteration_no !== undefined)) {
            const p = readPlan({ edd: input.edd ?? claim.plan.edd, alteration_no: input.alteration_no ?? claim.plan.alteration_no }, claim.plan.at);
            if ('error' in p) return p;
            if (p.edd !== claim.plan.edd) changes.push(`EDD: ${claim.plan.edd} → ${p.edd}`);
            if (p.alteration_no !== claim.plan.alteration_no) changes.push(`Alteration no.: ${claim.plan.alteration_no ?? '(none)'} → ${p.alteration_no ?? '(none)'}`);
            out.plan = p;
        }
        if (claim.dispatch && (input.dispatch_date !== undefined || input.docket !== undefined || input.courier !== undefined)) {
            const p = readDispatch({
                dispatch_date: input.dispatch_date ?? claim.dispatch.date, docket: input.docket ?? claim.dispatch.docket,
                courier: input.courier ?? claim.dispatch.courier,
            }, claim.dispatch.at);
            if ('error' in p) return p;
            if (p.date !== claim.dispatch.date) changes.push(`Dispatch date: ${claim.dispatch.date} → ${p.date}`);
            if (p.docket !== claim.dispatch.docket) changes.push(`Docket: ${claim.dispatch.docket} → ${p.docket}`);
            if (p.courier !== claim.dispatch.courier) changes.push(`Courier: ${claim.dispatch.courier ?? '(none)'} → ${p.courier ?? '(none)'}`);
            out.dispatch = p;
        }
        if (!changes.length) return { error: 'Nothing was changed' };
        // An edit is a step too, so it can be undone like any other.
        return { claim: { ...out, trail: [...trail, snap(claim)] }, changes };
    }

    if (!FROM[a].includes(claim.status)) return { error: `This claim is ${STATUS_TEXT[claim.status].toLowerCase()}: it cannot be ${PAST[a]} now` };
    trail.push(snap(claim));
    const out: T = { ...claim, trail };

    switch (a) {
        case 'verify': {
            const fixed = correctDetails(claim, input);
            if ('error' in fixed) return fixed;
            const photos = (input.photos ?? []).filter(Boolean).slice(0, 10);
            return {
                claim: {
                    ...out, ...fixed.patch, kind: fixed.kind, status: 'review', hold: null,
                    verification: { remarks: note || null, corrections: fixed.changes, photos: [...(claim.verification?.photos ?? []), ...photos].slice(0, 10), at },
                },
                changes: fixed.changes,
            };
        }
        case 'ask_more':
            if (note.length < 3) return { error: 'Tell the store what more is needed' };
            return { claim: { ...out, status: 'verify' }, changes: [] };
        case 'hold': {
            const reason = pick(input.reason, Object.keys(HOLD_REASONS));
            if (!reason) return { error: 'Choose why it is on hold' };
            if (reason === 'other' && note.length < 3) return { error: 'Write why it is on hold' };
            return { claim: { ...out, status: 'on_hold', hold: { reason, note: note || null, at } }, changes: [] };
        }
        case 'approve': {
            const d = readDecision(input, at);
            if ('error' in d) return d;
            return { claim: { ...out, status: afterApproval(d), decision: d, hold: null }, changes: [] };
        }
        case 'reject': {
            const reason = pick(input.reason, Object.keys(REJECT_REASONS));
            if (!reason) return { error: 'Choose the reason from the T&C' };
            if (reason === 'other' && note.length < 3) return { error: 'Write the reason, the customer sees it' };
            return {
                claim: {
                    ...out, status: 'rejected', hold: null,
                    decision: { outcome: 'reject', charge: null, item: null, source: null, old_part: null, reason, remarks: note || null, at },
                },
                changes: [],
            };
        }
        case 'consent': {
            // The store agrees for the customer only with their say-so, and says so.
            if (!yes(input.agree)) return { error: who.actor === 'vendor' ? "Tick that the customer has agreed to the charge" : 'Tick that you agree to the charge' };
            const by = who.actor === 'customer' ? 'customer' : 'store';
            return { claim: { ...out, status: afterConsent(claim.decision!), consent: { agreed: true, by, note: note || null, at } }, changes: [] };
        }
        case 'decline': {
            const by = who.actor === 'customer' ? 'customer' : 'store';
            return { claim: { ...out, status: 'declined', consent: { agreed: false, by, note: note || null, at } }, changes: [] };
        }
        case 'ready':
            return { claim: { ...out, status: 'ready' }, changes: [] };
        case 'plan': {
            const p = readPlan(input, at);
            if ('error' in p) return p;
            return { claim: { ...out, status: 'production', plan: p }, changes: [] };
        }
        case 'dispatch': {
            const d = readDispatch(input, at);
            if ('error' in d) return d;
            return { claim: { ...out, status: 'dispatched', dispatch: d }, changes: [] };
        }
        case 'fitted':
            return { claim: { ...out, status: 'closed', fitted: { note: note || null, photos: (input.photos ?? []).slice(0, 5), at, by: who.actor } }, changes: [] };
    }
}

/* ─── Words ───────────────────────────────────────────────────────────────── */

export const STATUS_TEXT: Record<ClaimStatus, string> = {
    verify: 'With the store', review: 'With the plant', on_hold: 'On hold', consent: 'Waiting for customer to agree',
    repair: 'To repair at the store', plan: 'Approved', production: 'Being prepared', ready: 'Ready to dispatch', dispatched: 'Dispatched',
    closed: 'Fitted and closed', rejected: 'Not approved', declined: 'Customer declined the charge',
};

const PAST: Record<StepAction, string> = {
    verify: 'verified', ask_more: 'sent back to the store', hold: 'put on hold', approve: 'approved', reject: 'rejected',
    consent: 'agreed to', decline: 'declined', plan: 'planned', ready: 'marked ready', dispatch: 'dispatched', fitted: 'marked fitted',
};

/** A step in words, for the timeline and the notifications. */
export function stepText(action: ClaimAction, c: FlowClaim): string {
    const d = c.decision;
    switch (action) {
        case 'verify': return c.verification?.corrections.length ? `Store verified and corrected ${c.verification.corrections.length} detail${c.verification.corrections.length === 1 ? '' : 's'}` : 'Store verified';
        case 'ask_more': return 'Plant asked the store for more';
        case 'hold': return `On hold: ${HOLD_REASONS[c.hold?.reason ?? ''] ?? 'see note'}`;
        case 'approve': {
            const what = d?.outcome === 'repair_store' ? 'repair at the store' : `material from the ${d?.source === 'distributor' ? 'distributor' : 'plant'}`;
            return `Approved: ${what}, ${d?.charge === 'chargeable' ? 'chargeable' : 'free of cost'}`;
        }
        case 'reject': return `Not approved: ${REJECT_REASONS[d?.reason ?? ''] ?? 'see note'}`;
        case 'consent': return c.consent?.by === 'customer' ? 'Customer agreed to the charge' : 'Store confirmed the customer agreed to the charge';
        case 'decline': return c.consent?.by === 'customer' ? 'Customer declined the charge' : 'Store recorded that the customer declined the charge';
        case 'plan': return `Expected by ${c.plan?.edd}${c.plan?.alteration_no ? ` · alteration no. ${c.plan.alteration_no}` : ''}`;
        case 'ready': return 'Ready to dispatch';
        case 'dispatch': return `Dispatched on ${c.dispatch?.date} · docket ${c.dispatch?.docket}${c.dispatch?.courier ? ` · ${c.dispatch.courier}` : ''}`;
        case 'fitted': return d?.outcome === 'repair_store' ? 'Repaired at the store' : 'Reached the store and fitted';
        case 'undo': return `Step undone: back to ${STATUS_TEXT[c.status].toLowerCase()}`;
        case 'edit': return 'Details edited';
    }
}
