import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_CATALOG, readCatalog, catalogProblem, storeBrands, validateLines, requestSummary,
    applyDecisions, usageFrom, type PosmLine, type PosmCatalog,
} from '../posmCatalog.js';

const ok = (r: ReturnType<typeof validateLines>) => {
    if ('error' in r) throw new Error(r.error);
    return r.lines;
};
const err = (r: ReturnType<typeof validateLines>) => ('error' in r ? r.error : '');
const withLimits = (id: string, limits: object): PosmCatalog => {
    const c = structuredClone(DEFAULT_CATALOG);
    c.items.find(i => i.id === id)!.limits = limits;
    return c;
};

test('store brands: AFAC is both, unset is Autoform', () => {
    assert.deepEqual(storeBrands('AFAC'), ['AF', 'AC']);
    assert.deepEqual(storeBrands('ac'), ['AC']);
    assert.deepEqual(storeBrands(null), ['AF']);
});

test('the starting catalog is valid and has the FRP sheet', () => {
    const c = readCatalog(DEFAULT_CATALOG);
    assert.equal(catalogProblem(c), null);
    assert.equal(c.items.length, 9);
    const design = c.items.find(i => i.id === 'frp')!.fields.find(f => f.id === 'design')!;
    assert.equal(design.rows!.filter(r => r.brand === 'AF').length, 12);
    assert.equal(design.rows!.filter(r => r.brand === 'AC').length, 11);
    assert.deepEqual(readCatalog(null), DEFAULT_CATALOG, 'nothing saved yet → defaults');
});

test('FRP: colours and material come from the design row; remarks are kept', () => {
    const [l] = ok(validateLines([{ item_id: 'frp', qty: 2, values: { brand: 'AF', design: 'U-Focus', remarks: 'For the new counter' } }], DEFAULT_CATALOG, ['AF']));
    assert.deepEqual(l.display, [
        { label: 'Brand', value: 'Autoform' }, { label: 'Design', value: 'U-Focus' }, { label: 'Major colour', value: 'Red' },
        { label: 'Minor colour', value: 'Black' }, { label: 'Material', value: 'Signature' }, { label: 'Remarks for the team', value: 'For the new counter' },
    ]);
    assert.equal(l.qty, 2);
});

test("FRP: a brand the store does not sell, or another brand's design, is refused", () => {
    assert.match(err(validateLines([{ item_id: 'frp', qty: 1, values: { brand: 'AC', design: 'Amaze' } }], DEFAULT_CATALOG, ['AF'])), /brand/);
    assert.match(err(validateLines([{ item_id: 'frp', qty: 1, values: { brand: 'AF', design: 'Amaze' } }], DEFAULT_CATALOG, ['AF', 'AC'])), /choose from the list/);
});

test('T-shirts: quantity is the sum of sizes; unknown size refused', () => {
    const [l] = ok(validateLines([{ item_id: 'tshirt', values: { sizes: { M: 4, L: '6', XL: '', S: 0 } } }], DEFAULT_CATALOG, ['AF']));
    assert.equal(l.qty, 10);
    assert.deepEqual(l.values, { sizes: { M: 4, L: 6 } });
    assert.ok(err(validateLines([{ item_id: 'tshirt', values: { sizes: { XS: 1 } } }], DEFAULT_CATALOG, ['AF'])));
    assert.ok(err(validateLines([{ item_id: 'tshirt', values: { sizes: {} } }], DEFAULT_CATALOG, ['AF'])));
});

test('required fields and required files', () => {
    assert.match(err(validateLines([{ item_id: 'vcard', qty: 1, values: { name: 'Rohit' } }], DEFAULT_CATALOG, ['AF'])), /Phone — this is required/);
    const c = structuredClone(DEFAULT_CATALOG);
    c.items.find(i => i.id === 'vcard')!.fields.find(f => f.id === 'photos')!.required = true;
    const line = [{ item_id: 'vcard', qty: 1, values: { name: 'Rohit', phone: '9811023344' } }];
    assert.match(err(validateLines(line, c, ['AF'])), /attach at least one file/);
    assert.equal(ok(validateLines(line, c, ['AF'], {}, { '0.photos': 1 })).length, 1);
    assert.match(err(validateLines(line, DEFAULT_CATALOG, ['AF'], {}, { '0.photos': 4 })), /up to 3 files/);
});

test('a switched-off or unknown item is refused; "always 1" ignores the quantity sent', () => {
    const c = structuredClone(DEFAULT_CATALOG);
    c.items.find(i => i.id === 'kit')!.enabled = false;
    assert.ok(err(validateLines([{ item_id: 'kit', qty: 1 }], c, ['AF'])));
    assert.ok(err(validateLines([{ item_id: 'nope', qty: 1 }], DEFAULT_CATALOG, ['AF'])));
    const [l] = ok(validateLines([{ item_id: 'cert', qty: 9, values: { name: 'Car Plus Noida' } }], DEFAULT_CATALOG, ['AF']));
    assert.equal(l.qty, 1);
});

test('limits: min and max per request, over every line of the item', () => {
    const c = withLimits('jacket', { min: 2, max_request: 3 });
    assert.match(err(validateLines([{ item_id: 'jacket', qty: 1 }], c, ['AF'])), /at least 2/);
    assert.match(err(validateLines([{ item_id: 'jacket', qty: 2 }, { item_id: 'jacket', qty: 2 }], c, ['AF'])), /up to 3 per request/);
    assert.equal(ok(validateLines([{ item_id: 'jacket', qty: 3 }], c, ['AF'])).length, 1);
});

test('limits: month and year count what the store already has', () => {
    const c = withLimits('kit', { max_month: 2, max_year: 5 });
    assert.match(err(validateLines([{ item_id: 'kit', qty: 2 }], c, ['AF'], { kit: { month: 1, year: 1 } })), /1 more this month/);
    assert.match(err(validateLines([{ item_id: 'kit', qty: 1 }], c, ['AF'], { kit: { month: 2, year: 2 } })), /none left this month/);
    assert.match(err(validateLines([{ item_id: 'kit', qty: 1 }], c, ['AF'], { kit: { month: 0, year: 5 } })), /none left this year/);
    assert.equal(ok(validateLines([{ item_id: 'kit', qty: 1 }], c, ['AF'], { kit: { month: 1, year: 4 } })).length, 1);
});

test('usage: this month and year in IST; rejected requests and lines do not count', () => {
    const now = new Date('2026-10-15T10:00:00Z');
    const line = (q: number, extra: Partial<PosmLine> = {}) => ({ item_id: 'kit', item_name: 'POSM Kit', qty: q, values: {}, display: [], ...extra });
    const u = usageFrom([
        { status: 'open', created_at: '2026-10-02T05:00:00Z', items: [line(2)] },
        { status: 'approved', created_at: '2026-09-20T05:00:00Z', items: [line(3, { approved_qty: 1, line_status: 'approved' })] },
        { status: 'rejected', created_at: '2026-10-03T05:00:00Z', items: [line(9)] },
        { status: 'open', created_at: '2026-10-04T05:00:00Z', items: [line(4, { line_status: 'rejected' })] },
        { status: 'open', created_at: '2025-12-31T20:00:00Z', items: [line(7)] }, // 1 Jan 2026 IST
        { status: 'open', created_at: '2025-12-31T17:00:00Z', items: [line(8)] }, // still 2025 in IST
    ], now);
    assert.deepEqual(u.kit, { month: 2, year: 10 });
});

test('the admin catalog: problems are named', () => {
    const c = readCatalog({ items: [{ name: 'Banner', limits: { min: 5, max_request: 2 }, fields: [] }] });
    assert.match(catalogProblem(c)!, /minimum is more than the maximum/);
    const t = readCatalog({ items: [{ name: 'Mats', qty_mode: 'sizes', fields: [{ label: 'Note', type: 'text' }] }] });
    assert.match(catalogProblem(t)!, /exactly one sizes field/);
    const s = readCatalog({ items: [{ name: 'Seat', fields: [{ label: 'Design', type: 'table', brand_split: true, columns: ['Design'], rows: [{ brand: 'AF', cells: ['A'] }] }] }] });
    assert.match(catalogProblem(s)!, /needs a Brand field/);
    const ids = readCatalog({ items: [{ name: 'Flag' }, { name: 'Flag' }] });
    assert.notEqual(ids.items[0].id, ids.items[1].id, 'two items with one name still get their own ids');
});

test('FRP with a "both brands" Brand field: each line carries the brand of its design', () => {
    const c = structuredClone(DEFAULT_CATALOG);
    c.items.find(i => i.id === 'frp')!.fields.find(f => f.id === 'brand')!.multiple = true;
    assert.equal(catalogProblem(c), null);
    const lines = ok(validateLines([
        { item_id: 'frp', qty: 1, values: { brand: ['AF'], design: 'U-Focus' } },
        { item_id: 'frp', qty: 1, values: { brand: ['AC'], design: 'Amaze' } },
    ], c, ['AF', 'AC']));
    assert.equal(lines[0].display.find(d => d.label === 'Material')!.value, 'Signature');
    assert.equal(lines[1].display.find(d => d.label === 'Material')!.value, 'Lucenzo');
    assert.ok('error' in validateLines([{ item_id: 'frp', qty: 1, values: { brand: ['AF'], design: 'Amaze' } }], c, ['AF', 'AC']));
});

test('switching a table off "per brand" keeps each row\'s brand', () => {
    const c = structuredClone(DEFAULT_CATALOG);
    c.items.find(i => i.id === 'frp')!.fields.find(f => f.id === 'design')!.brand_split = false;
    const back = readCatalog(JSON.parse(JSON.stringify(c)));
    const rows = back.items.find(i => i.id === 'frp')!.fields.find(f => f.id === 'design')!.rows!;
    assert.equal(rows.filter(r => r.brand === 'AF').length, 12);
    assert.equal(rows.filter(r => r.brand === 'AC').length, 11);
});

test('a request in words', () => {
    const lines = ok(validateLines([
        { item_id: 'kit', qty: 2 },
        { item_id: 'cert', values: { name: 'Car Plus Noida' } },
    ], DEFAULT_CATALOG, ['AF']));
    assert.equal(requestSummary(lines), 'POSM Kit ×2 · Franchise certificate ×1');
});

test('admin decisions: approved quantity per line, rejection sets it to 0', () => {
    const lines = ok(validateLines([{ item_id: 'jacket', qty: 2 }, { item_id: 'kit', qty: 1 }], DEFAULT_CATALOG, ['AF']));
    const out = applyDecisions(lines, [{ index: 0, approved_qty: 1, line_status: 'approved' }, { index: 1, line_status: 'rejected' }]) as PosmLine[];
    assert.equal(out[0].approved_qty, 1);
    assert.equal(out[1].approved_qty, 0);
    assert.equal(lines[0].approved_qty, undefined, 'the stored lines are not changed in place');
    assert.ok('error' in (applyDecisions(lines, [{ index: 5, approved_qty: 1 }]) as any));
});

test('admin decisions: a quantity of 0 rejects the line, even when "approve" was picked', () => {
    const lines = ok(validateLines([{ item_id: 'tshirt', values: { sizes: { M: 3 } } }, { item_id: 'kit', qty: 2 }], DEFAULT_CATALOG, ['AF']));
    const out = applyDecisions(lines, [{ index: 0, approved_qty: 0, line_status: 'approved' }, { index: 1, approved_qty: 0 }]) as PosmLine[];
    assert.equal(out[0].line_status, 'rejected');
    assert.equal(out[0].approved_qty, 0);
    assert.equal(out[1].line_status, 'rejected');
    const back = applyDecisions(out, [{ index: 0, approved_qty: 2 }]) as PosmLine[];
    assert.equal(back[0].line_status, 'approved', 'a quantity above 0 approves a rejected line again');
    assert.equal(back[0].approved_qty, 2);
});

test('an item for one brand: only stores of that brand see it or may order it', async () => {
    const { storeCatalog, itemBrands } = await import('../posmCatalog.js');
    const cat: PosmCatalog = readCatalog({ items: [
        { id: 'ac_banner', name: 'AC banner', enabled: true, qty_mode: 'number', brands: ['AC'], limits: {},
          fields: [{ id: 'brand', label: 'Brand', type: 'brand', required: true }] },
        { id: 'both', name: 'Both', enabled: true, qty_mode: 'number', brands: ['AF', 'AC'], limits: {}, fields: [] },
    ] });
    assert.deepEqual(cat.items[0].brands, ['AC']);
    assert.equal(cat.items[1].brands, undefined, 'both brands is the same as every brand');
    assert.deepEqual(storeCatalog(cat, ['AF']).items.map(i => i.id), ['both']);
    assert.deepEqual(storeCatalog(cat, ['AF', 'AC']).items.map(i => i.id), ['ac_banner', 'both']);
    assert.deepEqual(itemBrands(cat.items[0], ['AF', 'AC']), ['AC']);
    assert.match(err(validateLines([{ item_id: 'ac_banner', qty: 1, values: { brand: 'AC' } }], cat, ['AF'])), /not available for your brand/);
    assert.match(err(validateLines([{ item_id: 'ac_banner', qty: 1, values: { brand: 'AF' } }], cat, ['AF', 'AC'])), /brand this item is available for/);
    ok(validateLines([{ item_id: 'ac_banner', qty: 1, values: { brand: 'AC' } }], cat, ['AF', 'AC']));
});

test('a choice for one brand: offered only for that brand', () => {
    const cat: PosmCatalog = readCatalog({ items: [
        { id: 'tee', name: 'T-shirt', enabled: true, qty_mode: 'sizes', limits: {}, fields: [
            { id: 'brand', label: 'Brand', type: 'brand', required: true },
            { id: 'sizes', label: 'Sizes', type: 'sizes', required: true, options: ['M', 'XL'], option_brands: { XL: 'AC', M: 'nope' } },
        ] },
    ] });
    assert.deepEqual(cat.items[0].fields[1].option_brands, { XL: 'AC' });
    // An AFAC store ordering for Autoform cannot have the Autocruze-only size; for Autocruze it can.
    assert.match(err(validateLines([{ item_id: 'tee', values: { brand: 'AF', sizes: { XL: 2 } } }], cat, ['AF', 'AC'])), /size XL is not offered/);
    ok(validateLines([{ item_id: 'tee', values: { brand: 'AC', sizes: { XL: 2 } } }], cat, ['AF', 'AC']));
    ok(validateLines([{ item_id: 'tee', values: { brand: 'AF', sizes: { M: 1 } } }], cat, ['AF']));
    assert.match(err(validateLines([{ item_id: 'tee', values: { brand: 'AF', sizes: { XL: 1 } } }], cat, ['AF'])), /not offered/);
});
