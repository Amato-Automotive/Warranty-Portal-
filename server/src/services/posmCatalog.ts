/**
 * POSM items a franchise can ask for, built by the admin, and the checks on
 * what a store sends.
 *
 * The admin keeps a list of items. Each item has its picture, how its
 * quantity is asked (a number, the sum of sizes, or always one), limits per
 * request, month and year, and the fields the store fills: text, number,
 * dropdown, choices, the store's brand, sizes with quantities, files, or a
 * design table whose other columns fill in from the row picked (FRP).
 *
 * A request is a list of lines, one per item. Each line keeps what the store
 * entered and a readable copy of it (`display`), so a request still reads the
 * same after the admin edits or deletes the item.
 *
 * Free of any database import, so it is tested directly.
 */

export type Brand = 'AF' | 'AC';
export const BRAND_LABEL: Record<Brand, string> = { AF: 'Autoform', AC: 'Autocruze' };

export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'chips' | 'brand' | 'sizes' | 'files' | 'table';
export const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'number', 'select', 'chips', 'brand', 'sizes', 'files', 'table'];

export interface TableRow { brand?: Brand | null; cells: string[] }

export interface PosmField {
    id: string;
    label: string;
    type: FieldType;
    required: boolean;
    help?: string;
    /** select, chips: the choices. sizes: the sizes. */
    options?: string[];
    /** chips, brand: more than one may be picked. */
    multiple?: boolean;
    /** files: how many. */
    max_files?: number;
    /** table: the first column is what the store picks; the rest fill in.
        With brand_split each row belongs to a brand, and the store sees the
        rows of the brand picked in the item's brand field. */
    columns?: string[];
    brand_split?: boolean;
    rows?: TableRow[];
}

export type QtyMode = 'number' | 'sizes' | 'one';

export interface PosmLimits { min?: number | null; max_request?: number | null; max_month?: number | null; max_year?: number | null }

export interface PosmItem {
    id: string;
    name: string;
    description?: string;
    /** A clip art from the built-in set, or an uploaded picture (image wins). */
    clipart?: string | null;
    image?: string | null;
    enabled: boolean;
    qty_mode: QtyMode;
    limits: PosmLimits;
    fields: PosmField[];
}

export interface PosmCatalog { items: PosmItem[] }

const SIZES = ['S', 'M', 'L', 'XL', 'XXL', '3XL'];
const frpRows = (brand: Brand, rows: [string, string, string, string][]): TableRow[] => rows.map(cells => ({ brand, cells }));

/* The starting set, from the Oct 2026 list and the FRP colour sheet. */
export const DEFAULT_CATALOG: PosmCatalog = {
    items: [
        { id: 'kit', name: 'POSM Kit', description: 'T-shirt, Pull/Push stickers, Demo stickers, Diesel/Petrol stickers, Danglers, Wobbler, Note pad / Pen, Brochure',
            clipart: 'kit', enabled: true, qty_mode: 'number', limits: { min: 1 }, fields: [] },
        { id: 'tshirt', name: 'T-shirt', description: 'Pick the sizes', clipart: 'tshirt', enabled: true, qty_mode: 'sizes', limits: {},
            fields: [{ id: 'sizes', label: 'Sizes', type: 'sizes', required: true, options: SIZES }] },
        { id: 'vcard', name: 'Visiting cards', description: 'Your details and a photo of your old card', clipart: 'vcard', enabled: true, qty_mode: 'number', limits: { min: 1 },
            fields: [
                { id: 'name', label: 'Name', type: 'text', required: true },
                { id: 'designation', label: 'Designation', type: 'text', required: false },
                { id: 'phone', label: 'Phone', type: 'text', required: true },
                { id: 'email', label: 'Email', type: 'text', required: false },
                { id: 'address', label: 'Address on the card', type: 'textarea', required: false },
                { id: 'photos', label: 'Photo of your old card or logo', type: 'files', required: false, max_files: 3 },
            ] },
        { id: 'catalogue', name: 'Catalogue', description: 'Autoform / Autocruze', clipart: 'catalogue', enabled: true, qty_mode: 'number', limits: { min: 1 },
            fields: [{ id: 'brand', label: 'Brand', type: 'brand', required: true, multiple: true }] },
        { id: 'cert', name: 'Franchise certificate', description: 'The name to print', clipart: 'certificate', enabled: true, qty_mode: 'one', limits: {},
            fields: [{ id: 'name', label: 'Name to print on the certificate', type: 'text', required: true }] },
        { id: 'shade', name: 'Shade book', description: 'Autoform / Autocruze', clipart: 'shadebook', enabled: true, qty_mode: 'number', limits: { min: 1 },
            fields: [{ id: 'brand', label: 'Brand', type: 'brand', required: true, multiple: true }] },
        { id: 'frp', name: 'FRP', description: 'Brand and design: colours and material come with the design', clipart: 'frp', enabled: true, qty_mode: 'number', limits: { min: 1 },
            fields: [
                { id: 'brand', label: 'Brand', type: 'brand', required: true, multiple: false },
                { id: 'design', label: 'Design', type: 'table', required: true, brand_split: true,
                    columns: ['Design', 'Major colour', 'Minor colour', 'Material'],
                    rows: [
                        ...frpRows('AF', [
                            ['U-Focus', 'Red', 'Black', 'Signature'], ['H Cross', 'Bl. White', 'Wine', 'Signature'],
                            ['U Sportz Crysta', 'Tan', 'Black', 'Emporio'], ['D3', 'Tan', 'Black', 'Lucenzo'],
                            ['U Arrow', 'Nutmeg', 'Maroon', 'Signature'], ['X Cross', 'Silver', 'Purple', 'Signature'],
                            ['U Navigation Plus', 'Silver', 'Burgundy', 'Signature'], ['U Ladder', 'Yellow-Red', 'Black', 'Signature'],
                            ['U Blade', 'Bl. White', 'Yellow', 'Signature'], ['U Volt', 'Nutmeg', 'Brown', 'Signature'],
                            ['Q2', 'Camel', 'Brown', 'Signature'], ['Polo', 'Olive Green', 'Olive Green', 'Signature'],
                        ]),
                        ...frpRows('AC', [
                            ['Amaze', 'Black', 'Silver stitch', 'Lucenzo'], ['Cheer', 'Silver', 'Blue', 'Lucenzo'],
                            ['E Cross', 'Brown', 'Bl. White stitch', 'Lucenzo'], ['Hammer', 'Red', 'Black', 'Lucenzo'],
                            ['Hunk Grill', 'Black', 'Burgundy', 'Lucenzo'], ['Hunk Perfo', 'Bl. White', 'Maroon', 'Lucenzo'],
                            ['Inspire', 'Burgundy', 'Burgundy', 'Lucenzo'], ['Track', 'Tan', 'Black', 'Lucenzo'],
                            ['Xpress', 'Tan', 'Black', 'Lucenzo'], ['Hunk', 'Black', 'V. Meg', 'Lucenzo'],
                            ['Amaze Duo', 'Silver', 'Black', 'Lucenzo'],
                        ]),
                    ] },
                { id: 'remarks', label: 'Remarks for the team', type: 'textarea', required: false, help: 'Anything else about this FRP' },
            ] },
        { id: 'jacket', name: 'Sample jacket', description: '', clipart: 'jacket', enabled: true, qty_mode: 'number', limits: { min: 1 }, fields: [] },
        { id: 'art', name: 'Art work', description: 'What it is, where it goes and its size', clipart: 'artwork', enabled: true, qty_mode: 'one', limits: {},
            fields: [
                { id: 'what', label: 'What is the art work?', type: 'textarea', required: true },
                { id: 'place', label: 'Where it will be used', type: 'select', required: true, options: ['Shop front', 'Inside wall', 'Counter', 'Glass door', 'Other'] },
                { id: 'width', label: 'Width', type: 'number', required: true },
                { id: 'height', label: 'Height', type: 'number', required: true },
                { id: 'unit', label: 'Unit', type: 'select', required: true, options: ['ft', 'inch', 'cm'] },
                { id: 'photos', label: 'Photos of the place', type: 'files', required: false, max_files: 5 },
            ] },
    ],
};

/* ---------- reading and checking the catalog the admin saves ---------- */

const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
const list = (v: unknown, max = 60) => (Array.isArray(v) ? v : []).map(x => str(x, max)).filter(Boolean);
const limitOf = (v: unknown) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : null; };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

function readField(f: any, i: number): PosmField {
    const type = (FIELD_TYPES as string[]).includes(f?.type) ? f.type as FieldType : 'text';
    const field: PosmField = { id: slug(str(f?.id) || str(f?.label) || `field_${i + 1}`) || `field_${i + 1}`, label: str(f?.label, 120) || `Field ${i + 1}`, type, required: !!f?.required };
    if (str(f?.help)) field.help = str(f.help, 200);
    if (type === 'select' || type === 'chips' || type === 'sizes') field.options = list(f?.options);
    if (type === 'chips' || type === 'brand') field.multiple = !!f?.multiple;
    if (type === 'files') field.max_files = Math.min(10, Math.max(1, Number(f?.max_files) || 3));
    if (type === 'table') {
        field.columns = list(f?.columns, 40);
        field.brand_split = !!f?.brand_split;
        // A row keeps its brand even while the table is not split by brand, so
        // switching the split off and on again loses nothing.
        field.rows = (Array.isArray(f?.rows) ? f.rows : []).map((r: any) => {
            const brand: Brand | null = r?.brand === 'AC' ? 'AC' : r?.brand === 'AF' ? 'AF' : field.brand_split ? 'AF' : null;
            return { ...(brand ? { brand } : {}), cells: (field.columns ?? []).map((_, c) => str(r?.cells?.[c], 80)) };
        }).filter((r: TableRow) => r.cells[0]);
    }
    return field;
}

/** A stored catalog, cleaned: unknown types become text, ids are unique. */
export function readCatalog(stored: unknown): PosmCatalog {
    const items = (stored as any)?.items;
    if (!Array.isArray(items)) return structuredClone(DEFAULT_CATALOG);
    const seen = new Set<string>();
    return {
        items: items.map((it: any, i: number): PosmItem => {
            let id = slug(str(it?.id) || str(it?.name)) || `item_${i + 1}`;
            while (seen.has(id)) id += '_2';
            seen.add(id);
            const fieldIds = new Set<string>();
            const fields = (Array.isArray(it?.fields) ? it.fields : []).map(readField).map((f: PosmField) => {
                while (fieldIds.has(f.id)) f.id += '_2';
                fieldIds.add(f.id);
                return f;
            });
            const mode: QtyMode = ['number', 'sizes', 'one'].includes(it?.qty_mode) ? it.qty_mode : 'number';
            return {
                id, name: str(it?.name, 80) || `Item ${i + 1}`, description: str(it?.description, 300),
                clipart: str(it?.clipart, 40) || null, image: str(it?.image, 500) || null,
                enabled: it?.enabled !== false, qty_mode: mode,
                limits: { min: limitOf(it?.limits?.min), max_request: limitOf(it?.limits?.max_request), max_month: limitOf(it?.limits?.max_month), max_year: limitOf(it?.limits?.max_year) },
                fields,
            };
        }),
    };
}

/** What would stop the admin's catalog from working, in words; null when it is fine. */
export function catalogProblem(c: PosmCatalog): string | null {
    for (const it of c.items) {
        const where = `"${it.name}"`;
        const { min, max_request, max_month, max_year } = it.limits;
        if (min != null && max_request != null && min > max_request) return `${where}: the minimum is more than the maximum per request`;
        if (max_request != null && max_month != null && max_request > max_month) return `${where}: the maximum per request is more than the maximum per month`;
        if (max_month != null && max_year != null && max_month > max_year) return `${where}: the maximum per month is more than the maximum per year`;
        const sizes = it.fields.filter(f => f.type === 'sizes');
        if (it.qty_mode === 'sizes' && sizes.length !== 1) return `${where}: "sum of sizes" needs exactly one sizes field`;
        for (const f of it.fields) {
            const fw = `${where} → "${f.label}"`;
            if ((f.type === 'select' || f.type === 'chips' || f.type === 'sizes') && !f.options?.length) return `${fw}: add at least one choice`;
            if (f.type === 'table') {
                if (!f.columns?.length) return `${fw}: add the table's columns`;
                if (!f.rows?.length) return `${fw}: add at least one row`;
                if (f.brand_split && !it.fields.some(x => x.type === 'brand')) return `${fw}: a table split by brand needs a Brand field on the item`;
                const keys = f.rows.map(r => `${r.brand ?? ''}|${r.cells[0].toLowerCase()}`);
                if (new Set(keys).size !== keys.length) return `${fw}: a row is listed twice`;
            }
        }
    }
    return null;
}

/** The brands a store sells: 'AFAC' is both; anything unset is Autoform, as elsewhere. */
export function storeBrands(allowed: string | null | undefined): Brand[] {
    const b = String(allowed ?? 'AF').toUpperCase();
    return b === 'AFAC' ? ['AF', 'AC'] : b === 'AC' ? ['AC'] : ['AF'];
}

/* ---------- a request ---------- */

export interface PosmLine {
    item_id: string;
    item_name: string;
    qty: number;
    values: Record<string, unknown>;
    /** What the store entered, in words, in field order. */
    display: { label: string; value: string }[];
    files?: string[];
    approved_qty?: number | null;
    line_status?: 'pending' | 'approved' | 'rejected';
}

/** How much of each item a store already has this month and year (rejected lines do not count). */
export type Usage = Record<string, { month: number; year: number }>;

const whole = (v: unknown) => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };
const MAX_QTY = 1000;

/** The rows of a table field the store may pick from, given the line's brand. */
export function tableRows(f: PosmField, brand: Brand | null): TableRow[] {
    return (f.rows ?? []).filter(r => !f.brand_split || r.brand === brand);
}

/**
 * Checks what a store sent and returns the lines to store, or the first
 * problem in words the store can act on. `fileCounts` is how many files came
 * with each line's file fields (key "line.field"); the files themselves are
 * added by the caller. A table pick takes its other columns from the row.
 */
export function validateLines(
    raw: unknown, catalog: PosmCatalog, brands: Brand[], usage: Usage = {}, fileCounts: Record<string, number> = {},
): { lines: PosmLine[] } | { error: string } {
    if (!Array.isArray(raw) || raw.length === 0) return { error: 'Add at least one item to the request' };
    if (raw.length > 30) return { error: 'A request can have up to 30 items' };
    const lines: PosmLine[] = [];

    for (const [i, r] of raw.entries()) {
        const item = catalog.items.find(x => x.id === String((r as any)?.item_id));
        if (!item || !item.enabled) return { error: `Item ${i + 1} cannot be requested right now` };
        const inValues = ((r as any)?.values ?? {}) as Record<string, unknown>;
        const values: Record<string, unknown> = {};
        const display: PosmLine['display'] = [];
        let sizesTotal = 0;
        // The brand a design-table pick belongs to: the line's Brand, one or a list of one.
        const brandField = item.fields.find(f => f.type === 'brand');

        for (const f of item.fields) {
            const v = inValues[f.id];
            const what = `${item.name}: ${f.label}`;
            const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
            if (f.type === 'files') {
                const n = fileCounts[`${i}.${f.id}`] ?? 0;
                if (f.required && !n) return { error: `${what} — attach at least one file` };
                if (n > (f.max_files ?? 3)) return { error: `${what} — up to ${f.max_files ?? 3} files` };
                continue;
            }
            if (f.type === 'sizes') {
                const sizes: Record<string, number> = {};
                for (const [size, q] of Object.entries((v ?? {}) as Record<string, unknown>)) {
                    if (!f.options?.includes(size)) return { error: `${what} — size ${size} is not offered` };
                    if (q === '' || q == null || Number(q) === 0) continue;
                    const n = whole(q);
                    if (!(n >= 1 && n <= MAX_QTY)) return { error: `${what} — enter 1 to ${MAX_QTY} for size ${size}` };
                    sizes[size] = n;
                }
                const total = Object.values(sizes).reduce((a, b) => a + b, 0);
                if (f.required && !total) return { error: `${what} — enter how many of at least one size` };
                if (total) {
                    values[f.id] = sizes; sizesTotal += total;
                    display.push({ label: f.label, value: Object.entries(sizes).map(([s, n]) => `${s} ×${n}`).join(', ') });
                }
                continue;
            }
            if (empty) {
                if (f.required) return { error: `${what} — this is required` };
                continue;
            }
            switch (f.type) {
                case 'text': case 'textarea': {
                    const s = str(v, f.type === 'text' ? 200 : 1000);
                    if (!s && f.required) return { error: `${what} — this is required` };
                    if (s) { values[f.id] = s; display.push({ label: f.label, value: s }); }
                    break;
                }
                case 'number': {
                    const n = Number(v);
                    if (!Number.isFinite(n) || n < 0 || n > 100000) return { error: `${what} — enter a number` };
                    values[f.id] = n; display.push({ label: f.label, value: String(n) });
                    break;
                }
                case 'select': {
                    const s = str(v, 80);
                    if (!f.options?.includes(s)) return { error: `${what} — choose from the list` };
                    values[f.id] = s; display.push({ label: f.label, value: s });
                    break;
                }
                case 'chips': {
                    const picked = [...new Set((Array.isArray(v) ? v : [v]).map(x => str(x, 80)))];
                    if (!picked.every(p => f.options?.includes(p))) return { error: `${what} — choose from the list` };
                    if (!f.multiple && picked.length > 1) return { error: `${what} — choose one` };
                    values[f.id] = f.multiple ? picked : picked[0]; display.push({ label: f.label, value: picked.join(', ') });
                    break;
                }
                case 'brand': {
                    const picked = [...new Set((Array.isArray(v) ? v : [v]).map(x => String(x).toUpperCase()))];
                    if (!picked.every(p => (brands as string[]).includes(p))) return { error: `${what} — choose a brand your store sells` };
                    if (!f.multiple && picked.length > 1) return { error: `${what} — choose one brand` };
                    values[f.id] = f.multiple ? picked : picked[0];
                    display.push({ label: f.label, value: picked.map(b => BRAND_LABEL[b as Brand]).join(' + ') });
                    break;
                }
                case 'table': {
                    // Read from what was sent, so the table works whatever the field order.
                    const raw = brandField ? inValues[brandField.id] : null;
                    const one = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : null) : raw;
                    const sent = one ? String(one).toUpperCase() as Brand : null;
                    const brand = f.brand_split && sent && brands.includes(sent) ? sent : null;
                    if (f.brand_split && !brand) return { error: `${item.name}: choose the brand first` };
                    const row = tableRows(f, brand).find(x => x.cells[0] === str(v, 80));
                    if (!row) return { error: `${what} — choose from the list` };
                    values[f.id] = row.cells[0];
                    (f.columns ?? []).forEach((c, k) => display.push({ label: k === 0 ? f.label : c, value: row.cells[k] }));
                    break;
                }
            }
        }

        let qty: number;
        if (item.qty_mode === 'one') qty = 1;
        else if (item.qty_mode === 'sizes') qty = sizesTotal;
        else {
            qty = whole((r as any)?.qty);
            if (!(qty >= 1 && qty <= MAX_QTY)) return { error: `${item.name} — enter a quantity from 1 to ${MAX_QTY}` };
        }
        if (qty < 1) return { error: `${item.name} — enter a quantity` };
        lines.push({ item_id: item.id, item_name: item.name, qty, values, display });
    }

    // Limits, by item over the whole request.
    const byItem = new Map<string, number>();
    for (const l of lines) byItem.set(l.item_id, (byItem.get(l.item_id) ?? 0) + l.qty);
    for (const [id, asked] of byItem) {
        const item = catalog.items.find(x => x.id === id)!;
        const { min, max_request, max_month, max_year } = item.limits;
        const u = usage[id] ?? { month: 0, year: 0 };
        if (min != null && asked < min) return { error: `${item.name}: at least ${min} per request` };
        if (max_request != null && asked > max_request) return { error: `${item.name}: up to ${max_request} per request` };
        if (max_month != null && u.month + asked > max_month) {
            const left = Math.max(0, max_month - u.month);
            return { error: `${item.name}: up to ${max_month} a month — ${left ? `you can ask for ${left} more this month` : 'none left this month'}` };
        }
        if (max_year != null && u.year + asked > max_year) {
            const left = Math.max(0, max_year - u.year);
            return { error: `${item.name}: up to ${max_year} a year — ${left ? `you can ask for ${left} more this year` : 'none left this year'}` };
        }
    }
    return { lines };
}

/** One line in words, for lists, search, export and notifications. */
export function lineSummary(l: PosmLine): string {
    return `${l.item_name} ×${l.qty}`;
}
export const requestSummary = (lines: PosmLine[]) => lines.map(lineSummary).join(' · ');

/** What a line counts against the limits: nothing once rejected, the approved quantity once decided. */
export const countedQty = (l: Partial<PosmLine>) =>
    l.line_status === 'rejected' ? 0 : Number(l.approved_qty ?? l.qty ?? 0) || 0;

/**
 * Adds up a store's earlier requests into usage per item, this month and this
 * year (IST calendar). Rejected requests and lines do not count.
 */
export function usageFrom(requests: { status: string; created_at: Date | string; items?: unknown }[], now = new Date()): Usage {
    const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString();
    const nowIst = ist(now);
    const out: Usage = {};
    for (const r of requests) {
        if (r.status === 'rejected' || !Array.isArray(r.items)) continue;
        const at = ist(new Date(r.created_at));
        const sameYear = at.slice(0, 4) === nowIst.slice(0, 4);
        if (!sameYear) continue;
        const sameMonth = at.slice(0, 7) === nowIst.slice(0, 7);
        for (const l of r.items as PosmLine[]) {
            if (!l?.item_id) continue;
            const u = (out[l.item_id] ??= { month: 0, year: 0 });
            const q = countedQty(l);
            u.year += q;
            if (sameMonth) u.month += q;
        }
    }
    return out;
}

/**
 * The admin's decision on each line: an approved quantity (0 is a rejection)
 * applied to the stored lines by position. Lines not mentioned are unchanged.
 */
export function applyDecisions(lines: PosmLine[], decisions: unknown): PosmLine[] | { error: string } {
    if (!Array.isArray(decisions)) return lines;
    const out = lines.map(l => ({ ...l }));
    for (const dRaw of decisions) {
        const d = dRaw as any;
        const i = whole(d?.index);
        if (!(i >= 0 && i < out.length)) return { error: 'An item in the decision does not exist on this request' };
        const status = d?.line_status;
        if (status !== undefined && !['pending', 'approved', 'rejected'].includes(status)) return { error: 'Unknown item status' };
        let q: number | null = null;
        if (d?.approved_qty !== undefined && d?.approved_qty !== null && d?.approved_qty !== '') {
            q = whole(d.approved_qty);
            if (!(q >= 0 && q <= MAX_QTY)) return { error: `Approved quantity must be 0 to ${MAX_QTY}` };
            out[i].approved_qty = q;
        }
        if (status) out[i].line_status = status;
        /* The quantity and the decision agree: 0 is a rejection, and a
           quantity above 0 approves a line that was rejected or decided. */
        if (out[i].line_status === 'rejected' && !(q != null && q > 0 && status !== 'rejected')) out[i].approved_qty = 0;
        else if (q === 0) out[i].line_status = 'rejected';
        else if (q != null && q > 0 && out[i].line_status !== 'pending') out[i].line_status = 'approved';
    }
    return out;
}
