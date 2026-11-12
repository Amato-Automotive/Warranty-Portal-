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
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ymd = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d || y < 2000 || y > 2100) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/**
 * A date as the sheet holds it, as "YYYY-MM-DD": already so (the Excel
 * import), day first as typed in India ("28/10/2026", "28-10-26", "28.10.2026"),
 * with the month in words ("28-Oct-2026", "28 Oct 26"), or a spreadsheet's day
 * number (46323). Anything else is no date.
 */
export function sheetDate(v: unknown, now: Date = new Date()): string | null {
    const s = clean(v);
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
    if (m) return ymd(+m[3], +m[2], +m[1]);
    m = s.match(/^(\d{1,2})[\s\-/.]*([A-Za-z]{3})[A-Za-z]*[\s\-/.,]*(\d{2}|\d{4})$/);
    if (m && MONTHS.includes(m[2].toUpperCase())) return ymd(+m[3], MONTHS.indexOf(m[2].toUpperCase()) + 1, +m[1]);
    // The live sheet shows "11-Mar" or "10-June" with no year: this year, unless
    // that is more than a month ahead, when it was last year's.
    m = s.match(/^(\d{1,2})[\s\-/.]*([A-Za-z]{3})[A-Za-z]*$/);
    if (m && MONTHS.includes(m[2].toUpperCase())) {
        const month = MONTHS.indexOf(m[2].toUpperCase()) + 1;
        const year = now.getUTCFullYear();
        const soon = now.getTime() + 31 * 86_400_000;
        const later = Date.UTC(year, month - 1, +m[1]) > soon;
        return ymd(later ? year - 1 : year, month, +m[1]);
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) {
        const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000);
        return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    }
    return null;
}
const date = sheetDate;

/**
 * A tab as Google gives it (rows of cells) as rows by column name, each with
 * its row number in the sheet. The header is the first row naming both
 * ALT NO and DATE, so title rows above it are fine; empty rows are dropped.
 */
export function rowsFromGrid(grid: string[][]): SheetRow[] {
    const name = (c: unknown) => clean(c).toUpperCase();
    const at = grid.slice(0, 30).findIndex(r => r.some(c => name(c) === 'ALT NO') && r.some(c => name(c) === 'DATE'));
    if (at < 0) return [];
    const head = grid[at].map(clean);
    const out: SheetRow[] = [];
    for (let i = at + 1; i < grid.length; i++) {
        const cells = grid[i];
        if (!cells.some(c => clean(c))) continue;
        const row: SheetRow = { _row: String(i + 1) };
        head.forEach((h, j) => { if (h && !(h in row)) row[h] = cells[j] ?? ''; });
        out.push(row);
    }
    return out;
}
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

/** How the sheet spells a material, so a typing slip still reads as the name it means. */
const materialSpelling = (v: string) => clean(v).toUpperCase()
    .replace(/\bLUC[A-Z]*[ZS][A-Z]*\b/g, 'LUCENZO')
    // The plant writes the same material as LUCENZO or OLD LUCENZO.
    .replace(/\bOLD\s+LUCENZO\b/g, 'LUCENZO')
    .replace(/\bSIG\b|\bSIG[A-Z]*TURE\b/g, 'SIGNATURE')
    .replace(/\bVEL+ORA\b/g, 'VELORA')
    .replace(/\bNAP+A\b/g, 'NAPA')
    .replace(/\bMFD\b/g, 'MDF');

/**
 * The material a row's remarks name, from the admin's list: the longest name
 * found, so LUCENZO PRO + is not read as Lucenzo. "OLD LUCENZO" is Lucenzo. No
 * name found is null; perforation and the like are the work, not a material.
 */
export function materialFromRemarks(remarks: unknown, list: string[]): string | null {
    const text = materialSpelling(String(remarks ?? ''));
    if (!text) return null;
    const names = list.map(name => ({ name, spelt: materialSpelling(name) })).filter(x => x.spelt).sort((a, b) => b.spelt.length - a.spelt.length);
    for (const { name, spelt } of names) {
        const words = spelt.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
        if (new RegExp(`(?<![A-Z0-9])${words}(?![A-Z0-9])`).test(text)) return name;
    }
    return null;
}

/** Words that say which part of the seat a note is about. */
const COMPONENT_WORD = /^(DRIVER|CO-?DRIVER|CODRIVER|PASSENGER|SEATS?|BACK|BACKREST|HEAD|HEADREST|REST|ARM|ARMREST|ROW|MIDDLE|REAR|FRONT|THIRD|SECOND|3RD|2ND|BOLSTER|CUSHION|PIECES?|PCS|PORTION|SIDE|CENTRE|CENTER|BASE|BOTTOM|LEFT|RIGHT|LHS|RHS)$/;

/** The text without the material it names (and the "OLD" before it), or null when it names none. */
function withoutMaterial(text: string, list: string[]): string | null {
    // A long note is kept as written; only a short one is read for the material in it.
    if (text.split(/\s+/).length > 5) return null;
    const spelt = materialSpelling(text);
    const names = list.map(name => materialSpelling(name)).filter(Boolean).sort((a, b) => b.length - a.length);
    for (const name of names) {
        const words = name.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
        const re = new RegExp(`(?<![A-Z0-9])${words}(?![A-Z0-9])`);
        if (re.test(spelt)) return spelt.replace(re, ' ').replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return null;
}

/** A part as a set of words, so "DRIVER SEAT AND CO DRIVER SEAT" is the list's "Driver and Co Driver Seat". */
const partWords = (v: string) => [...new Set(v.toUpperCase().replace(/CO-?DRIVER/g, 'CO DRIVER').split(/[^A-Z0-9%]+/).filter(w => w && w !== 'THE'))].sort().join(' ');

/**
 * A sheet row's REMARKS in the plant's columns. The sheet writes one note, such as
 * "SILVER STITCH, OLD LUCENZO A4 PERFO, DRIVER SEAT AND CO DRIVER SEAT"; the portal
 * keeps the material, the component and the remaining notes apart. Nothing is
 * dropped: whatever is neither a listed material nor a part of the seat stays in
 * the remarks.
 */
export function splitRemarks(remarks: unknown, materials: string[], components: string[] = []): { component: string | null; remarks: string | null } {
    const notes: string[] = [];
    const parts: string[] = [];
    for (const segment of clean(remarks).split(/,|;|(?<=\w\w)\s*\/\s*(?=\w\w)/).map(s => s.trim()).filter(Boolean)) {
        const words = segment.split(/\s+/);
        let at = words.findIndex(w => COMPONENT_WORD.test(w.toUpperCase().replace(/[^A-Z0-9-]/g, '')));
        // "1 PIECE FRONT ARMREST", "40% SEAT", "FULL REAR", "CO DRIVER": these belong to the part.
        while (at > 0 && /^(\d+%?|FULL|CO|BOTH)$/i.test(words[at - 1])) at--;
        const before = (at < 0 ? words : words.slice(0, at)).join(' ');
        const part = at < 0 ? '' : words.slice(at).join(' ');
        if (before) {
            const rest = withoutMaterial(before, materials);
            const keep = rest === null ? before : rest;
            if (keep) notes.push(keep);
        }
        if (part) {
            const rest = withoutMaterial(part, materials);
            const keep = rest === null ? part : rest;
            if (keep) parts.push(keep);
        }
    }
    const joined = parts.join(', ');
    const listed = joined ? components.find(x => partWords(x) === partWords(joined)) : undefined;
    return {
        component: (listed ?? joined).slice(0, 80) || null,
        remarks: notes.join(', ').slice(0, 500) || null,
    };
}

/** A sheet design or a warranty product by its name alone: no U-, finish, age or material words, however it is spelt. */
const designKey = (v: unknown) => clean(v).toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^U[\s-]+/, '')
    .replace(/^USPORT/, 'SPORT')
    .replace(/\bS(PORTZ|PROTZ|POTZ|PORTS)\b/g, 'SPORTS')
    .replace(/\bPLUS\b/g, '+')
    .replace(/\b(OLD|PERFO|OEM|OE|CUSTOM|DG|SERIES|SIGNATURE|EMPORIO|DOBLE|UNICO)\b/g, ' ')
    .replace(/[^A-Z0-9+]+/g, '');

/**
 * The brand a sheet design belongs to, from the warranty products. Every U-
 * design is Autoform. A row with no real design ("SAME AS PIC"), or one not on
 * the list, has none, and two products of different brands under one name say
 * nothing either.
 */
export function designBrand(design: unknown, products: { name: string; brand?: string | null }[]): 'AF' | 'AC' | 'AFAC' | null {
    const text = clean(design).toUpperCase();
    if (!text || /\b(SAME AS|AS PER|ATTACH|IMAGE|PIC)\b|^SEAT COVER$/.test(text)) return null;
    if (/^U[\s-]|^USPORT/.test(text)) return 'AF';
    const key = designKey(text);
    if (!key) return null;
    const brands = new Set(products.filter(p => designKey(p.name) === key).map(p => (p.brand === 'AC' || p.brand === 'AFAC' ? p.brand : 'AF')));
    return brands.size === 1 ? [...brands][0] as 'AF' | 'AC' | 'AFAC' : null;
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
