/**
 * Warranty and alteration claims, as the screens read them. The rules live in
 * the server's claimFlow; the lists here mirror its words.
 */

export type ClaimStatus = 'inspect' | 'decide' | 'payment' | 'repair' | 'send' | 'dispatched' | 'fixed' | 'closed' | 'rejected';
export type ClaimAction = 'inspect' | 'ask_more' | 'approve' | 'reject' | 'paid' | 'dispatch' | 'fixed' | 'close' | 'undo' | 'edit';
export type ClaimKind = 'warranty' | 'alteration';

export interface ClaimHistory {
    action: string; status: ClaimStatus; text: string; note?: string | null; at: string;
    by_role: 'customer' | 'vendor' | 'admin'; by_name?: string | null; undone?: boolean;
}

export interface Claim {
    id: number;
    claim_no: string;
    kind: ClaimKind;
    warranty_uid: string;
    store_id: string | null;
    store_name?: string | null;
    store_city?: string | null;
    raised_by_role: 'customer' | 'vendor' | 'admin';
    raised_via: string;
    problem: string;
    problem_text: string;
    description: string | null;
    media: string[] | null;
    snapshot: {
        product_type: string; product_name: string; customer_name: string; customer_phone: string;
        car: string | null; registration_number: string | null; warranty_type: string; cover_start: string | null; cover_end: string | null; fitted_store: string | null;
    } | null;
    status: ClaimStatus;
    status_text: string;
    inspection: { covered: boolean; reason: string | null; suggest: 'repair_store' | 'send_material'; note: string; photos: string[]; at: string } | null;
    decision: {
        outcome: 'repair_store' | 'send_material' | 'reject'; material: 'replacement' | 'repaired' | 'alteration' | null; item: string | null;
        source: 'plant' | 'distributor' | null; distributor: string | null; charge: 'foc' | 'chargeable' | null; amount: number | null;
        old_part: 'return' | 'scrap' | null; reason: string | null; note: string | null; at: string;
    } | null;
    payment: { mode: string; ref: string; at: string } | null;
    dispatch: { courier: string; tracking: string; date: string | null } | null;
    fixed: { note: string | null; photos: string[]; at: string } | null;
    old_part: { done: 'returned' | 'scrapped'; courier: string | null; tracking: string | null; note: string | null; photos: string[]; at: string } | null;
    history: ClaimHistory[] | null;
    actions: ClaimAction[];
    counts?: { on_warranty: number; approved_before: number; rejected_before: number; customer_total: number };
    /** The warranty as registered, for the store and head office to compare with. */
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
}

export const PROBLEMS: Record<string, { label: string; hint: string }> = {
    stitching_defect: { label: 'Stitching defect', hint: 'Thread or seam has come open' },
    colour_bleeding: { label: 'Colour bleeding', hint: 'Colour is running or spreading' },
    rubbing_fastness: { label: 'Rubbing fastness', hint: 'Colour comes off on clothes when rubbed' },
    product_defect: { label: 'Manufacturing defect', hint: 'Describe what is wrong' },
    alteration: { label: 'Alteration needed', hint: 'Describe what needs to change' },
};

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

export const NOT_COVERED_LINE = 'Not covered as per T&C: tears or cuts from sharp objects, sun fading, stains, oil or chemical spills, cleaning with prohibited products, commercial use.';

/** The status in each person's words, with its colour. */
export const STATUS: Record<ClaimStatus, { admin: string; store: string; customer: string; tone: string }> = {
    inspect: { admin: 'With store', store: 'To check', customer: 'Store will check', tone: 'bg-amber-100 text-amber-800' },
    decide: { admin: 'To decide', store: 'With head office', customer: 'Being reviewed', tone: 'bg-orange-100 text-orange-800' },
    payment: { admin: 'Awaiting payment', store: 'Awaiting payment', customer: 'Payment needed', tone: 'bg-purple-100 text-purple-800' },
    repair: { admin: 'Store to repair', store: 'To repair', customer: 'Approved: repair', tone: 'bg-blue-100 text-blue-800' },
    send: { admin: 'To send', store: 'Approved: material coming', customer: 'Approved', tone: 'bg-blue-100 text-blue-800' },
    dispatched: { admin: 'On the way', store: 'On the way: to fit', customer: 'On the way', tone: 'bg-sky-100 text-sky-800' },
    fixed: { admin: 'Fixed', store: 'Fixed: customer to confirm', customer: 'Fixed: please confirm', tone: 'bg-emerald-100 text-emerald-800' },
    closed: { admin: 'Closed', store: 'Closed', customer: 'Closed', tone: 'bg-gray-100 text-gray-700' },
    rejected: { admin: 'Rejected', store: 'Not approved', customer: 'Not approved', tone: 'bg-red-100 text-red-800' },
};

/** The steps a customer follows, for the tracker. */
export function trackerSteps(c: Claim): { label: string; done: boolean; current: boolean }[] {
    const send = c.decision?.outcome === 'send_material';
    const labels = ['Claim raised', 'Store checked the car', 'Approved by head office'];
    if (c.decision?.charge === 'chargeable') labels.push('Payment received');
    if (send) labels.push('Material on the way');
    labels.push(send ? 'Fitted at the store' : 'Repaired at the store', 'Closed');
    const reached: Record<ClaimStatus, number> = {
        inspect: 1, decide: 2, payment: 3, repair: 3, send: 3, dispatched: 4, fixed: 5, closed: 6, rejected: 2,
    };
    let at = reached[c.status];
    if (c.decision?.charge === 'chargeable' && ['repair', 'send', 'dispatched', 'fixed', 'closed'].includes(c.status)) at += 1;
    if (!send && ['fixed', 'closed'].includes(c.status)) at -= 1;
    if (c.status === 'closed') at = labels.length;
    return labels.map((label, i) => ({ label, done: i < at, current: i === at }));
}

export const isPhoto = (url: string) => /\.(jpe?g|png|webp|heic|heif)(\?|$)/i.test(url);
export const isVideo = (url: string) => /\.(mp4|mov|webm|3gp|m4v)(\?|$)/i.test(url);
export const rupees = (n: number | null | undefined) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;
export const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** What head office decided, in one line. */
export function decisionText(c: Claim): string | null {
    const d = c.decision;
    if (!d) return null;
    if (d.outcome === 'reject') return `Not approved: ${REJECT_REASONS[d.reason ?? ''] ?? 'see note'}`;
    const what = d.outcome === 'repair_store' ? 'Repair at the store'
        : `${d.material === 'repaired' ? 'Repaired product' : d.material === 'alteration' ? 'Alteration material' : 'Replacement'}${d.item ? ` (${d.item})` : ''} from the ${d.source === 'distributor' ? `distributor${d.distributor ? `, ${d.distributor}` : ''}` : 'plant'}`;
    return `${what} · ${d.charge === 'chargeable' ? `Chargeable ${rupees(d.amount)}` : 'FOC'}`;
}
