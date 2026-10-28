/**
 * Warranty and alteration claims, as the screens read them. The rules live in
 * the server's claimFlow; the lists here mirror its words.
 *
 * Customer → store (verifies) → plant (decides, plans, dispatches) → store
 * (confirms fitted). Distributors and the plant's viewers only watch.
 */

export type ClaimStatus = 'verify' | 'review' | 'on_hold' | 'consent' | 'repair' | 'plan' | 'production' | 'ready' | 'dispatched' | 'closed' | 'rejected' | 'declined';
export type ClaimAction = 'verify' | 'ask_more' | 'hold' | 'approve' | 'reject' | 'consent' | 'decline' | 'plan' | 'ready' | 'dispatch' | 'fitted'
    | 'change' | 'resend' | 'ask_change' | 'change_ok' | 'change_no' | 'redecide' | 'dispatch_info' | 'edit' | 'undo';
export type ClaimKind = 'warranty' | 'alteration';
export type PlantRight = 'decide' | 'plan' | 'dispatch' | 'edit';

export interface ClaimHistory {
    action: string; status: ClaimStatus; text: string; note?: string | null; changes?: string[]; at: string;
    by_role: 'customer' | 'vendor' | 'admin'; by_name?: string | null; undone?: boolean;
}

export interface Vehicle { make: string; model: string; airbags: 'with' | 'sab' | 'without' | null; major_colour?: string | null; minor_colour?: string | null }

export interface Claim {
    id: number;
    claim_no: string;
    kind: ClaimKind;
    warranty_uid: string;
    store_id: string | null;
    store_name?: string | null;
    store_city?: string | null;
    store_phone?: string | null;
    raised_by_role: 'customer' | 'vendor' | 'admin';
    raised_via: string;
    problem: string;
    problem_text: string;
    description: string | null;
    vehicle: Vehicle | null;
    media: string[] | null;
    snapshot: {
        product_type: string; product_name: string; customer_name: string; customer_phone: string;
        car: string | null; registration_number: string | null; warranty_type: string; cover_start: string | null; cover_end: string | null; fitted_store: string | null;
        /** A row brought in from the plant's production sheet: its depot, row and FOC note. */
        source?: string; depot?: string | null; sheet_row?: number; foc_note?: string | null;
    } | null;
    status: ClaimStatus;
    status_text: string;
    waiting_on: string | null;
    verification: { remarks: string | null; corrections: string[]; photos: string[]; at: string } | null;
    hold: { reason: string; note: string | null; at: string } | null;
    decision: {
        outcome: 'repair_store' | 'send_material' | 'reject'; charge: 'foc' | 'chargeable' | null;
        item: string | null; source: 'plant' | 'distributor' | null; old_part: 'return' | 'scrap' | null;
        reason: string | null; remarks: string | null; at: string;
    } | null;
    consent: { agreed: boolean; by: 'customer' | 'store'; note: string | null; at: string } | null;
    plan: { edd: string | null; alteration_no: string | null; at: string } | null;
    dispatch: { date: string; docket: string; courier: string | null; at: string } | null;
    fitted: { note: string | null; photos: string[]; at: string } | null;
    /** A change the store or customer asked for after approval, waiting for the plant. */
    change_request?: { by: 'customer' | 'vendor' | 'admin'; changes: string[]; photos: string[]; note: string; at: string } | null;
    history: ClaimHistory[] | null;
    actions: ClaimAction[];
    /** A distributor's view of a store's claim: nothing to do, only to watch. */
    watching?: boolean;
    trail_length?: number;
    counts?: { on_warranty: number; approved_before: number; rejected_before: number; customer_total: number };
    /** The warranty as registered, for the store and the plant to compare with. */
    registration?: Registration | null;
    created_at: string;
    updated_at: string;
}

export interface Registration {
    uid: string; status: string; product_type: string; product_name: string;
    rolls: { serial: string; sqft: number; area: string }[] | null;
    customer_name: string; customer_phone: string; customer_email: string | null; customer_address: string | null;
    car: string | null; car_colour: string | null; registration_number: string | null; warranty_type: string;
    fitted_on: string | null; registered_on: string; approved_on: string | null; cover_start: string | null; cover_end: string | null;
    fitted_store: string | null; fitted_city: string | null; installer: string | null;
    photos: { label: string; url: string }[];
    checks: { tone: 'ok' | 'warn' | 'info'; text: string }[];
    fraud_score?: number | null;
    remarks?: { admin_name: string; remark: string; created_at: string }[];
    row?: any;
}

/** A warranty as the claim screens list it. */
export interface ClaimWarranty {
    uid: string; product_type: string; product_name: string; customer_name: string; customer_phone: string;
    car: string | null; registration_number: string | null; warranty_type: string; cover_start: string | null; cover_end: string | null;
    fitted_store: string | null; status: string; store_id: string | null; covered: boolean; why: string | null;
    /** Approved: something can be raised on it (out of warranty, only an alteration). */
    claimable: boolean;
    problems: string[];
    asks_airbags: boolean;
}

/** The issues: the plant's alteration-sheet reasons, merged and grouped. Mirrors the server. */
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
export const NEEDS_DESCRIPTION = ['manufacturing_defect', 'alteration', 'other'];

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

export const NOT_COVERED_LINE = 'Not covered as per T&C: tears or cuts from sharp objects, sun fading, stains, oil or chemical spills, cleaning with prohibited products, commercial use.';

/** The status in each person's words, with its colour. */
export const STATUS: Record<ClaimStatus, { admin: string; store: string; customer: string; tone: string }> = {
    verify: { admin: 'With store', store: 'To verify', customer: 'Store is checking', tone: 'bg-amber-100 text-amber-800' },
    review: { admin: 'To decide', store: 'With the plant', customer: 'Being reviewed', tone: 'bg-orange-100 text-orange-800' },
    on_hold: { admin: 'On hold', store: 'On hold at the plant', customer: 'On hold', tone: 'bg-yellow-100 text-yellow-800' },
    consent: { admin: 'Customer to agree', store: 'Customer to agree', customer: 'Please agree to the charge', tone: 'bg-purple-100 text-purple-800' },
    repair: { admin: 'Store to repair', store: 'To repair', customer: 'Approved: repair at store', tone: 'bg-blue-100 text-blue-800' },
    plan: { admin: 'To set alteration no.', store: 'Approved', customer: 'Approved', tone: 'bg-blue-100 text-blue-800' },
    production: { admin: 'WIP', store: 'Being prepared', customer: 'Being prepared', tone: 'bg-indigo-100 text-indigo-800' },
    ready: { admin: 'Ready to dispatch', store: 'Ready to dispatch', customer: 'Ready to dispatch', tone: 'bg-violet-100 text-violet-800' },
    dispatched: { admin: 'Dispatched', store: 'Dispatched: confirm when fitted', customer: 'On the way', tone: 'bg-sky-100 text-sky-800' },
    closed: { admin: 'Closed', store: 'Fitted', customer: 'Done', tone: 'bg-emerald-100 text-emerald-800' },
    rejected: { admin: 'Rejected', store: 'Not approved', customer: 'Not approved', tone: 'bg-red-100 text-red-800' },
    declined: { admin: 'Charge declined', store: 'Customer declined', customer: 'You declined the charge', tone: 'bg-gray-100 text-gray-700' },
};

/** The steps of a claim, for the tracker everyone sees; reachedAt: the statuses that mean the step is done. */
export function trackerSteps(c: Claim): { label: string; short: string; at?: string | null; edd?: string | null; done: boolean; current: boolean; detail?: string }[] {
    const repair = c.decision?.outcome === 'repair_store';
    const ready = [...(c.history ?? [])].reverse().find(h => h.action === 'ready' && !h.undone);
    const steps: { label: string; short: string; at?: string | null; edd?: string | null; reachedAt: ClaimStatus[]; detail?: string }[] = [
        { label: 'Claim requested', short: 'Requested', at: c.created_at, reachedAt: [] },
        { label: 'Verified by the store', short: 'Verified', at: c.verification?.at, reachedAt: ['review', 'on_hold'] },
        { label: 'Approved by the plant', short: 'Approved', at: c.decision?.at, reachedAt: ['consent', 'repair', 'plan'], detail: c.decision && c.decision.outcome !== 'reject' ? (c.decision.charge === 'chargeable' ? 'Chargeable' : 'Free of cost') : undefined },
    ];
    if (c.decision?.charge === 'chargeable') steps.push({ label: 'Customer agreed to the charge', short: 'Agreed', at: c.consent?.at, reachedAt: repair ? ['repair'] : ['plan'] });
    if (!repair) {
        steps.push({ label: 'Being prepared', short: 'Being prepared', at: c.plan?.at, edd: c.plan?.edd, reachedAt: ['ready'], detail: c.plan?.edd ? `Expected by ${day(c.plan.edd)}` : undefined });
        steps.push({ label: 'Ready to dispatch', short: 'Ready', at: ready?.at, reachedAt: ['dispatched'] });
        steps.push({ label: 'Dispatched', short: 'Dispatched', at: c.dispatch?.date, reachedAt: ['dispatched'], detail: c.dispatch ? `${day(c.dispatch.date)} · docket ${c.dispatch.docket}` : undefined });
    }
    steps.push({ label: repair ? 'Repaired at the store' : 'Reached the store and fitted', short: repair ? 'Repaired' : 'Fitted', at: c.fitted?.at, reachedAt: ['closed'] });

    // A step is done once the claim has reached any status that comes after it;
    // the first step not yet done is the one it is on.
    const order: ClaimStatus[] = ['verify', 'review', 'on_hold', 'consent', 'repair', 'plan', 'production', 'ready', 'dispatched', 'closed'];
    const pos = order.indexOf(c.status);
    const done = steps.map((s, i) => i === 0 || c.status === 'closed' || s.reachedAt.some(st => order.indexOf(st) <= pos));
    const current = done.indexOf(false);
    return steps.map((s, i) => ({ label: s.label, short: s.short, at: s.at, edd: s.edd, done: done[i], current: i === current, detail: s.detail }));
}

export const isPhoto = (url: string) => /\.(jpe?g|png|webp|heic|heif)(\?|$)/i.test(url);
export const isVideo = (url: string) => /\.(mp4|mov|webm|3gp|m4v)(\?|$)/i.test(url);
export const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const AIRBAGS = { with: 'With airbags', sab: 'SAB', without: 'Without airbags' } as const;
export const vehicleText = (v: Vehicle | null | undefined) => v ? [v.make, v.model, v.airbags ? AIRBAGS[v.airbags] : null,
    [v.major_colour, v.minor_colour].filter(Boolean).join(' / ') || null].filter(Boolean).join(' · ') : null;

/** What the plant decided, in one line. */
export function decisionText(c: Claim): string | null {
    const d = c.decision;
    if (!d) return null;
    if (d.outcome === 'reject') return `Not approved: ${REJECT_REASONS[d.reason ?? ''] ?? 'see note'}`;
    const what = d.outcome === 'repair_store' ? 'Repair at the store'
        : `Material${d.item ? ` (${d.item})` : ''} from the ${d.source === 'distributor' ? 'distributor' : 'plant'}`;
    return `${what} · ${d.charge === 'chargeable' ? 'Chargeable' : 'Free of cost'}`;
}
