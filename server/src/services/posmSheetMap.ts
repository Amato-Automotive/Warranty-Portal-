/**
 * The plant's and the Noida office's Google Sheets, read and written as POSM
 * dispatch lines (two-way sync, every 5 minutes).
 *
 *  - Columns are found by their header, so moving a column does not break it.
 *  - Each tab gets a "PORTAL ID" column the portal fills: a plant row holds
 *    its line's id; a Noida row (one dispatch, a quantity per item column)
 *    holds its dispatch group's id.
 *  - The plant writes its status as WIP / READY / HOLD R / DISPATCH.
 *  - Dates come as 01-01-2026, 16-11-2026, 16-January (no year), 06-Jan or
 *    18-Jan-2026; the plant's are written back as DD-MM-YYYY, the Noida
 *    office's as DD-Mon-YYYY, the way each sheet has them.
 *
 * Free of any database or network import, so it is tested directly.
 */

export const PORTAL_ID_HEADER = 'PORTAL ID';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const headerKey = (h: string) => String(h ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Column positions by header, matched loosely ("STATUS " = "Status"). `aliases` maps a field to the headers it may have. */
export function columnsOf(header: string[], aliases: Record<string, string[]>): Record<string, number> {
    const keys = header.map(headerKey);
    const out: Record<string, number> = {};
    for (const [field, names] of Object.entries(aliases)) {
        const i = keys.findIndex(k => names.some(n => headerKey(n) === k));
        if (i >= 0) out[field] = i;
    }
    return out;
}

/** A date as the sheets write it, as YYYY-MM-DD; a date with no year takes `year`. Null when it is not a date. */
export function readSheetDate(v: unknown, year = 2026): string | null {
    const s = String(v ?? '').trim();
    if (!s) return null;
    let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
    if (m) return iso(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), Number(m[2]), Number(m[1]));
    m = /^(\d{1,2})[-\s/.]?([A-Za-z]{3,9})(?:[-\s/.,]+(\d{2,4}))?$/.exec(s);
    if (m) {
        const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
        if (mon < 0) return null;
        return iso(m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : year, mon + 1, Number(m[1]));
    }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
    return null;
}
function iso(y: number, mo: number, d: number): string | null {
    if (!(y > 2000 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 2026-11-16 as the plant writes it: 16-11-2026. */
export const plantDate = (d: string | null) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '');
/** 2026-01-18 as the Noida office writes it: 18-Jan-2026. */
export const noidaDate = (d: string | null) => {
    if (!d) return '';
    const m = MONTHS[Number(d.slice(5, 7)) - 1];
    return `${d.slice(8, 10)}-${m[0].toUpperCase()}${m.slice(1)}-${d.slice(0, 4)}`;
};

/* ---------- The plant's status words ---------- */

const PLANT_TO_STATUS: Record<string, string> = {
    '': 'Not updated', DISPATCH: 'Dispatched', DISPATCHED: 'Dispatched', WIP: 'WIP', READY: 'Ready to dispatch',
    'HOLD R': 'On hold', HOLD: 'On hold', 'ON HOLD': 'On hold', 'OUT OF STOCK': 'Out of stock', 'IN TRANSIT': 'In Transit',
    DELIVERED: 'Delivered', RETURN: 'Return',
};
const STATUS_TO_PLANT: Record<string, string> = {
    'Not updated': '', Dispatched: 'DISPATCH', WIP: 'WIP', 'Ready to dispatch': 'READY', 'On hold': 'HOLD R',
    'Out of stock': 'OUT OF STOCK', 'In Transit': 'IN TRANSIT', Delivered: 'DELIVERED', Return: 'RETURN',
};
/** The plant's word as a portal status; an unknown word is kept as "Not updated". */
export const statusFromPlant = (v: unknown) => PLANT_TO_STATUS[String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ')] ?? 'Not updated';
export const statusToPlant = (s: string) => STATUS_TO_PLANT[s] ?? s.toUpperCase();

/** The Noida office writes statuses in words; the portal's are used as they are. */
const NOIDA_STATUSES = ['Not updated', 'WIP', 'Ready to dispatch', 'On hold', 'Out of stock', 'Dispatched', 'In Transit', 'Delivered', 'Return'];
export function statusFromNoida(v: unknown): string {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return 'Not updated';
    if (s === 'in production') return 'WIP';
    return NOIDA_STATUSES.find(x => x.toLowerCase() === s) ?? (s.startsWith('deliver') ? 'Delivered' : s.startsWith('dispatch') ? 'Dispatched' : 'Not updated');
}

/* ---------- Columns ---------- */

export const PLANT_COLUMNS: Record<string, string[]> = {
    request_date: ['DATE', 'AJAS'], key: ['MATCHING KEY'], address: ['PLACE BY CONCERN PERSON'], status: ['STATUS'],
    expected_dispatch: ['Expected Dis. Date (EDD)', 'EDD'], distributor: ['DISTRIBUTER', 'DISTRIBUTOR'], store: ['STORE NAME'],
    store_kind: ['STORE (OLD/NEW)'], item: ['FRP/ SAMPLE JACKETS', 'FRP/SAMPLE JACKETS'], design: ['DESIGN'], minor_colour: ['MINOR'],
    major_colour: ['MAJOR'], qty: ['QTY.', 'QTY'], brand: ['BRANDING'], note: ['NOTE'], remarks: ['REMARKS'],
    dispatch_date: ['DISPATCH DATE'], docket_no: ['DOCKET NUMBER'], courier: ['MODE'], portal_id: [PORTAL_ID_HEADER],
};

/** The plant's cells the portal writes back (the plant's own work on a line). */
export const PLANT_SYNCED = ['status', 'expected_dispatch', 'dispatch_date', 'docket_no', 'courier', 'remarks'] as const;

export const NOIDA_COLUMNS: Record<string, string[]> = {
    dispatch_date: ['DISPATCH DATE'], store: ['STORE NAME'], store_code: ['CODE'], distributor: ['DISTRIBUTOR'], asm: ['ASM'], state: ['STATE'],
    dispatched_by: ['DISPATCHED BY'], courier: ['COURIER / TRANSPORT', 'COURIER'], docket_no: ['DOCKET NO.', 'DOCKET NO'], delivery_date: ['DELIVERY DATE'],
    status: ['STATUS'], remarks: ['ANY REMARKS', 'REMARKS'], portal_id: [PORTAL_ID_HEADER],
};

/** The Noida sheet's item columns, as the portal names the items. */
export const NOIDA_ITEM_COLUMNS: Record<string, string[]> = {
    'T-Shirt': ['T-SHIRT'], 'Push & Pull Sticker': ['PUSH & PULL STICKER'], 'Petrol/Diesel Sticker': ['PETROL/DIESEL STICKER'], 'Demo Sticker': ['DEMO STICKER'],
    'Visiting Card': ['VISITING CARD'], 'Franchise Certificate': ['FRANCHISE CERTIFICATE'], 'QR Code Sticker / Sun': ['QC CODE STICKER/SUN', 'QR CODE STICKER/SUN'],
    'ACP Board': ['ACP BOARDS', 'ACP BOARD'], 'Wobbler / Dangler': ['WOBBLER/ DANGLER', 'WOBBLER/DANGLER'], 'Notepad & Pen': ['NOTEPAD & PEN'], Brochure: ['BROCHURE'],
    Catalogue: ['CATALOG', 'CATALOGUE'], 'Swatch / Shade Book': ['SHADE BOOK'], Calendar: ['CALENDER', 'CALENDAR'], 'Dr. Marq Stand': ['DR. MARQ STAND'],
};

/** A quantity cell: a whole number, or 0 when empty or not a number. */
export const qtyOf = (v: unknown) => { const m = /^\s*(\d+)/.exec(String(v ?? '')); const n = m ? Number(m[1]) : 0; return n > 0 ? n : 0; };

/* ---------- Matching a sheet row to a portal line (once, to fill PORTAL ID) ---------- */

/** Words of a design / colour text, spelled the way the combined sheet cleaned them. */
export function words(...parts: (string | null | undefined)[]): string[] {
    const fix: Record<string, string> = { TURQOISE: 'TURQUOISE', MEHROON: 'MAROON', HCROSS: 'H CROSS', XCROSS: 'X CROSS', ECROSS: 'E CROSS', AMEZ: 'AMAZE', CRYTSA: 'CRYSTA' };
    return parts.join(' ').toUpperCase().replace(/U-\s*/g, 'U ').replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
        .flatMap(w => (fix[w] ?? w).split(' ')).filter(w => !['STITCH', 'STITCHES', 'STICH', 'SC', 'WITH'].includes(w));
}

/** How well a plant row's design and colours fit a line's (0 to 1): the share of the line's words found in the row. */
export function designFit(rowWords: string[], lineWords: string[]): number {
    if (!lineWords.length) return rowWords.length ? 0.5 : 1;
    const row = new Set(rowWords);
    return lineWords.filter(w => row.has(w)).length / lineWords.length;
}

/**
 * One synced value after a change, from the sheet's and the portal's values
 * now and each side's own last value. Only a real edit on one side is copied;
 * an edit on both is the portal's; values that never matched (TRACKON /
 * Trackon) are left as they are until one side changes.
 */
export function decide(sheet: string, portal: string, lastSheet: string, lastPortal: string):
    { toPortal?: string; toSheet?: string; clash: boolean } {
    const sheetEdit = sheet !== lastSheet, portalEdit = portal !== lastPortal;
    if (portalEdit) return { ...(sheet !== portal ? { toSheet: portal } : {}), clash: sheetEdit && sheet !== portal };
    if (sheetEdit && sheet !== portal) return { toPortal: sheet, clash: false };
    return { clash: false };
}
