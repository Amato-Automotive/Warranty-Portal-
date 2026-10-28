/**
 * The plant's production sheet ("ALTERATION" tab) as claims. One row is one
 * alteration the plant made: no customer or warranty, just the party, the
 * design, the colours, the vehicle, the reason and the plant's own columns
 * (alteration no., EDD, dispatch). The same reading is used for the one-time
 * import and, later, for keeping the live sheet in step. Free of any database
 * import, so it is tested directly.
 */
import type { ClaimStatus, Decision, Dispatch, Hold, Plan, Vehicle } from './claimFlow.js';

export type SheetRow = Record<string, string | null | undefined>;

export interface SheetClaim {
    /** The row's key in the sheet: its alteration no., date and party, so a repeated alteration no. stays two claims. */
    key: string;
    created_at: string;
    status: ClaimStatus;
    kind: 'warranty' | 'alteration';
    problem: string;
    description: string | null;
    vehicle: Vehicle;
    snapshot: Record<string, unknown>;
    decision: Decision;
    plan: Plan;
    dispatch: Dispatch | null;
    hold: Hold | null;
    store_name: string;
}

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown) => { const s = clean(v).slice(0, 10); return DATE.test(s) ? s : null; };
const get = (r: SheetRow, name: string) => {
    const k = Object.keys(r).find(x => x.trim().toUpperCase() === name);
    return k ? clean(r[k]) : '';
};

/** The sheet's reason, spelt as it is typed, to the issue it means. */
const REASONS: [RegExp, string][] = [
    [/P(E|I|HE)+L+ ?OFF|PEAL/, 'peel_off'],
    [/PU ?TEAR/, 'pu_tear'],
    [/CRACK/, 'pu_crack'],
    [/PERFO/, 'perfo_issue'],
    [/WRINKL/, 'wrinkles'],
    [/TEAR.*STITCH|STITCH.*TEAR/, 'tear_stitch'],
    [/S(T)?I+T*C?H/, 'stitch_issue'],
    [/HOOK|CUT/, 'cut_mark'],
    [/HOLE/, 'hole'],
    [/MARK|INK|TAPE/, 'mark'],
    [/TRANSPORT|TRANSIT/, 'transit_damage'],
    [/DAMAGE/, 'damaged'],
    [/COLOU?R/, 'colour_issue'],
    [/LOOSE|FITTING/, 'fitting_issue'],
    [/SIZE/, 'size_issue'],
    [/SHORT/, 'short'],
    [/AIR ?BAG|ABF/, 'airbag_fitting'],
    [/CHAIN|ZIP/, 'chain_defect'],
    [/MISSING/, 'missing'],
    [/WRONG MODEL|MODEL WRONG/, 'model_wrong'],
    [/WRONG/, 'wrong_received'],
    [/MANUFACTUR/, 'manufacturing_defect'],
];
export function sheetProblem(reason: string): string {
    const r = reason.toUpperCase();
    for (const [re, p] of REASONS) if (re.test(r)) return p;
    // "Chargeable", "Paid basis", "FOC": how it is paid, not what is wrong.
    return /CHAR(G|E)|PAID|FOC/.test(r) ? 'alteration' : 'other';
}
export const sheetChargeable = (reason: string) => /CHAR(G|EA)|PAID/.test(reason.toUpperCase());

const HOLDS: [RegExp, string][] = [
    [/ABF|AIR ?BAG/, 'airbags'], [/MODEL/, 'model'], [/COLOU?R|DESIGN/, 'design_colour'],
    [/COMPONENT/, 'component'], [/DETAIL/, 'details'], [/PARTY|CONFIRM/, 'party'],
];
const holdReason = (text: string) => HOLDS.find(([re]) => re.test(text.toUpperCase()))?.[1] ?? 'other';

/** The sheet's status in the portal's words; a blank one is WIP, a dispatched one is done. */
export function sheetStatus(status: string): ClaimStatus {
    const s = status.toUpperCase();
    if (s.startsWith('DISPATCH')) return 'closed';
    if (s.startsWith('READY')) return 'ready';
    if (s.startsWith('HOLD')) return 'on_hold';
    return 'production';
}

/** One sheet row as a claim, or why it is left out. */
export function readSheetRow(r: SheetRow, row: number): SheetClaim | { skip: string } {
    const altNo = get(r, 'ALT NO');
    const raised = date(get(r, 'DATE'));
    if (!altNo) return { skip: `row ${row}: no alteration no.` };
    if (!raised) return { skip: `row ${row}: no date` };
    const reason = get(r, 'REASON');
    const problem = sheetProblem(reason);
    const party = get(r, 'PARTY NAME');
    const depot = get(r, 'DEPOT NAME');
    const status = sheetStatus(get(r, 'STATUS'));
    const at = `${raised}T00:00:00.000Z`;
    const disDate = date(get(r, 'DIS.DATE'));
    const docket = get(r, 'DOCKET NO.');
    const holdText = get(r, 'HOLD REASON');
    const vehicleText = get(r, 'VEHICLE');
    const foc = get(r, 'FOC');

    return {
        key: `${altNo}|${raised}|${party}`,
        created_at: at,
        status,
        kind: problem === 'alteration' ? 'alteration' : 'warranty',
        problem,
        description: reason || null,
        vehicle: {
            make: '', model: vehicleText,
            airbags: /\bSAB\b/i.test(vehicleText) ? 'sab' : /W\/?O\.? ?ABF|WITHOUT ?ABF/i.test(vehicleText) ? 'without' : /\bABF\b/i.test(vehicleText) ? 'with' : null,
            major_colour: get(r, 'MAJOR') || null, minor_colour: get(r, 'MINOR') || null,
        },
        snapshot: {
            product_type: 'seat-cover', product_name: get(r, 'DESIGN') || 'Seat cover', customer_name: null, customer_phone: null,
            car: vehicleText || null, registration_number: null, warranty_type: null, cover_start: null, cover_end: null,
            fitted_store: party || depot || null, depot: depot || null, mode: get(r, 'MODE') || null,
            source: 'sheet', sheet_row: row, sheet_key: `${altNo}|${raised}|${party}`, foc_note: foc || null,
        },
        decision: {
            outcome: 'send_material', charge: sheetChargeable(reason) ? 'chargeable' : 'foc', item: get(r, 'REMARKS') || null,
            source: 'plant', old_part: null, reason: null, remarks: foc ? `FOC: ${foc}` : null, at,
        },
        plan: { edd: date(get(r, 'EDD')), alteration_no: altNo, at },
        dispatch: disDate || docket ? { date: disDate ?? raised, docket: docket, courier: null, at: disDate ? `${disDate}T00:00:00.000Z` : at } : null,
        hold: status === 'on_hold' ? { reason: holdReason(holdText), note: holdText || null, at } : null,
        store_name: party,
    };
}
