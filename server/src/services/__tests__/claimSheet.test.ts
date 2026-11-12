import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designBrand, materialFromRemarks, readSheetRow, sheetProblem, sheetStatus, sheetChargeable } from '../claimSheet.js';

const row = (p: Record<string, string | null> = {}) => ({
    'DATE': '2026-06-10', 'MODE': 'MAIL', 'STATUS': 'WIP', ' DEPOT NAME': 'JANAK DEPOT', 'PARTY NAME ': 'FOCUS COCHIN', 'EDD': '2026-06-25',
    'DESIGN ': 'Q2', 'MINOR': 'BLACK', 'MAJOR': 'RED', 'REMARKS': 'FRONT LEFT SIDE', 'VEHICLE': 'GLANZA SPL 22 SAB', 'REASON': 'PHYSICAL DAMAGE',
    'ALT NO': 'Y259', 'FOC': null, 'DIS.DATE': null, 'DOCKET NO.': null, 'HOLD REASON ': null, ...p,
});

test('a sheet design takes its brand from the warranty products', () => {
    const products = [
        { name: 'AMAZE', brand: 'AC' }, { name: 'AMAZE+', brand: 'AF' }, { name: 'AMAZE DUO', brand: 'AC' }, { name: 'AMAZE DUO +', brand: 'AF' },
        { name: 'D3', brand: 'AF' }, { name: 'D3 (Signature)', brand: 'AF' }, { name: 'INSPIRE', brand: 'AC' }, { name: 'SPECTRA (SERIES)', brand: 'AC' },
        { name: 'U-Sports (Series)', brand: 'AF' }, { name: 'U-FOCUS', brand: 'AF' }, { name: 'LE SERIES (Signature)', brand: 'AF' }, { name: 'H-CROSS', brand: null },
        { name: 'BOTH ONE', brand: 'AFAC' }, { name: 'CLASH', brand: 'AF' }, { name: 'CLASH (Signature)', brand: 'AC' },
    ];
    const read = (d: string) => designBrand(d, products);
    // Every U- design is Autoform, whatever it says after.
    for (const d of ['U-SPORTZ PERFO', 'U SPORTZ OE', 'U-AMAZE', 'U-AMAZE DUO PLUS', 'U-SPECTRA OE', 'U-ZEST', 'USPORTZ OE EMPORIO', 'u-zest']) assert.equal(read(d), 'AF', d);
    // Read through its spelling to the product.
    assert.equal(read('AMAZE PLUS'), 'AF');
    assert.equal(read('AMAZE DUO PLUS'), 'AF');
    assert.equal(read('OLD AMAZE PLUS'), 'AF');
    assert.equal(read('AMAZE'), 'AC');
    assert.equal(read('AMAZE DUO'), 'AC');
    assert.equal(read('D3 PERFO'), 'AF');
    assert.equal(read('D3 OLD PERFO'), 'AF');
    assert.equal(read('D3PERFO'), null);
    assert.equal(read('INSPIRE PERFO'), 'AC');
    assert.equal(read('SPORTZ PERFO'), 'AF');
    assert.equal(read('FOCUS'), 'AF');
    assert.equal(read('SIGNATURE LE'), 'AF');
    assert.equal(read('H-CROSS'), 'AF');
    assert.equal(read('BOTH ONE'), 'AFAC');
    // No real design, not on the list, or two brands under one name: no brand.
    for (const d of ['SAME AS PIC', 'AS PER PIC', 'DESIGN AS PER PIC', 'SAME AS ATTACH IMAGE', 'Seat cover', '', 'THSP03', 'CLASH']) assert.equal(read(d), null, d);
});

test('the material comes from the remarks, whatever its spelling', () => {
    const list = ['Signature', 'Lucenzo', 'Lucenzo Pro', 'Lucenzo Pro +', 'Emporio', 'Doble', 'Velora'];
    const read = (t: string) => materialFromRemarks(t, list);
    assert.equal(read('LUCENZO, REAR HEAD'), 'Lucenzo');
    assert.equal(read('OLD LUCENZO,DRIVER SEAT'), 'Lucenzo');
    assert.equal(read('LUCENZO PRO,DRIVER BACK'), 'Lucenzo Pro');
    assert.equal(read('LUCENZO PRO +,REAR BACK'), 'Lucenzo Pro +');
    assert.equal(read('LUCENZO PRO+ REAR BACK'), 'Lucenzo Pro +');
    for (const slip of ['LUCEZNO', 'LUCEZNNO', 'LUCEZNZO']) assert.equal(read(`${slip} A4 PERFO`), 'Lucenzo');
    assert.equal(read('SIG,1 PIECE FRONT ARMREST'), 'Signature');
    assert.equal(read('SIGANTURE DRIVER SEAT'), 'Signature');
    assert.equal(read('VELLORA, DRIVER BACK'), 'Velora');
    assert.equal(read('EMPORIO DRIVER SEAT AND BACK'), 'Emporio');
    // Not materials, or not on the list.
    for (const none of ['A1 PERFO DRIVER SEAT', 'LEGACY', 'CRYSTA TYPE, MIDDLE ROW', 'DRIVER BACK', 'NAPA DRIVER SEAT', 'DESIGNATURE', '']) assert.equal(read(none), null);
    assert.equal(materialFromRemarks('NAPPA, 1 PIECE', ['Napa']), 'Napa');
    // The list may call it Old Lucenzo: both ways of writing it read as that, and Pro stays Pro.
    const renamed = ['Old Lucenzo', 'Lucenzo Pro', 'Lucenzo Pro +'];
    assert.equal(materialFromRemarks('LUCENZO, REAR HEAD', renamed), 'Old Lucenzo');
    assert.equal(materialFromRemarks('OLD LUCENZO,DRIVER SEAT', renamed), 'Old Lucenzo');
    assert.equal(materialFromRemarks('LUCEZNO A4 PERFO', renamed), 'Old Lucenzo');
    assert.equal(materialFromRemarks('LUCENZO PRO,DRIVER BACK', renamed), 'Lucenzo Pro');
    assert.equal(materialFromRemarks('LUCENZO PRO +,REAR BACK', renamed), 'Lucenzo Pro +');
    assert.equal(materialFromRemarks('MFD, DRIVER SIDE SEAT', ['MDF']), 'MDF');
    assert.equal(materialFromRemarks('MDF/ DRIVER SIDE SEAT', ['MDF']), 'MDF');
    assert.equal(materialFromRemarks('LUCENZO', []), null);
});

test('one REMARKS note goes to the plant\'s columns: the part of the seat to Component, the other notes to Remarks', async () => {
    const { splitRemarks } = await import('../claimSheet.js');
    const mats = ['Signature', 'Lucenzo', 'Lucenzo Pro', 'Lucenzo Pro +', 'Emporio', 'Velora', 'MDF'];
    const split = (t: string, comps: string[] = []) => splitRemarks(t, mats, comps);
    // The row that was reported: the Decision showed all of it.
    assert.deepEqual(split('SILVER STITCH, OLD LUCENZO A4 PERFO, DRIVER SEAT AND CO DRIVER SEAT'),
        { component: 'DRIVER SEAT AND CO DRIVER SEAT', remarks: 'SILVER STITCH, A4 PERFO' });
    assert.deepEqual(split('OLD LUCENZO,DRIVER SEAT'), { component: 'DRIVER SEAT', remarks: null });
    assert.deepEqual(split('LUCENZO PRO +,REAR BACK'), { component: 'REAR BACK', remarks: null });
    assert.deepEqual(split('SIG,1 PIECE FRONT ARMREST'), { component: '1 PIECE FRONT ARMREST', remarks: null });
    assert.deepEqual(split('EMPORIO DRIVER SEAT AND BACK'), { component: 'DRIVER SEAT AND BACK', remarks: null });
    assert.deepEqual(split('MDF/ DRIVER SIDE SEAT'), { component: 'DRIVER SIDE SEAT', remarks: null });
    assert.deepEqual(split('A1 PERFO DRIVER SEAT'), { component: 'DRIVER SEAT', remarks: 'A1 PERFO' });
    assert.deepEqual(split('CRYSTA TYPE, MIDDLE ROW'), { component: 'MIDDLE ROW', remarks: 'CRYSTA TYPE' });
    // A note that is no material and no part is kept, not dropped.
    assert.deepEqual(split('LEGACY'), { component: null, remarks: 'LEGACY' });
    assert.deepEqual(split('LUCEZNO A4 PERFO'), { component: null, remarks: 'A4 PERFO' });
    assert.deepEqual(split(''), { component: null, remarks: null });
    // The words that go with a part come along; a long note is kept as written.
    assert.equal(split('METAL LOGO, EMPORIO, FULL REAR AND DICCI PORTION -9 SET').component, 'FULL REAR AND DICCI PORTION -9 SET');
    assert.equal(split('SILVER STITCH, LUCENZO,Co driver front back only').component, 'Co driver front back only');
    assert.equal(split('40% SEAT, SILVER STITCH').component, '40% SEAT');
    assert.equal(split('REAR FULL SEAT, STITCH BROWN & BROWN PU OERDER 3mtr. LAMINTED WITH 4MM FOAM IN SIGNATURE MATERIAL .').remarks,
        'STITCH BROWN & BROWN PU OERDER 3mtr. LAMINTED WITH 4MM FOAM IN SIGNATURE MATERIAL .');
    // The same parts in other words are the admin's entry.
    assert.equal(split('SILVER STITCH, OLD LUCENZO A4 PERFO, DRIVER SEAT AND CO DRIVER SEAT', ['Driver and Co Driver Back', 'Driver and Co Driver Seat']).component, 'Driver and Co Driver Seat');
    assert.equal(split('CO-DRIVER SEAT', ['Driver and Co Driver Seat', 'Co Driver Seat']).component, 'Co Driver Seat');
    assert.deepEqual(split('MDF ,BOTH DRIVER SEAT AND BACK, SAME AS PIC'), { component: 'BOTH DRIVER SEAT AND BACK', remarks: 'SAME AS PIC' });
    assert.deepEqual(split('REQUIRED F/S ( SIGNATURE )'), { component: null, remarks: 'REQUIRED F/S' });
    // A part the admin lists is written as the list spells it.
    assert.equal(split('DRIVER SEAT', ['Driver Seat', 'Rear Back']).component, 'Driver Seat');
    // No material list yet: the material words stay in the remarks rather than being lost.
    assert.deepEqual(splitRemarks('OLD LUCENZO, DRIVER SEAT', []), { component: 'DRIVER SEAT', remarks: 'OLD LUCENZO' });
});

test('the sheet\'s reasons, however they are spelt, to the issue they mean', () => {
    for (const r of ['PEEL OFF', 'PILL OFF', 'PHELL OFF', 'PEEL OFF/CHARGEABLE']) assert.equal(sheetProblem(r), 'peel_off');
    for (const r of ['SITTCH ISSUE', 'STICHING PROBLM', 'STITCH ISSUE']) assert.equal(sheetProblem(r), 'stitch_issue');
    assert.equal(sheetProblem('CRACK ON PU'), 'pu_crack');
    assert.ok(sheetChargeable('CHAREABLE'));
    assert.equal(sheetProblem('CUT MARK/HOOK MARK'), 'cut_mark');
    assert.equal(sheetProblem('FOC BASIS( PU TEAR OFF)'), 'pu_tear');
    assert.equal(sheetProblem('LOOSE FITTING'), 'fitting_issue');
    assert.equal(sheetProblem('CHARGEABLE'), 'alteration');
    assert.equal(sheetProblem('SOMETHING ELSE'), 'other');
    assert.ok(sheetChargeable('CHARGABLE'));
    assert.ok(sheetChargeable('PAID BASIS'));
    assert.ok(!sheetChargeable('FOC BASIS(MANUFACTURING DEFECT)'));
});

test('status: dispatched is done, blank is WIP', () => {
    assert.equal(sheetStatus('DISPATCH'), 'closed');
    assert.equal(sheetStatus('READY'), 'ready');
    assert.equal(sheetStatus('HOLD R'), 'on_hold');
    assert.equal(sheetStatus('WIP'), 'production');
    assert.equal(sheetStatus(''), 'production');
});

test('a row becomes a claim with the plant\'s columns; one without an alteration no. is left out', () => {
    const c = readSheetRow(row(), 4);
    if ('skip' in c) throw new Error(c.skip);
    assert.equal(c.key, 'Y259|2026-06-10|FOCUS COCHIN');
    assert.equal(c.problem, 'damaged');
    assert.equal(c.decision.charge, 'foc');
    assert.equal(c.decision.item, 'FRONT LEFT SIDE');
    assert.deepEqual(c.plan, { edd: '2026-06-25', alteration_no: 'Y259', at: '2026-06-10T00:00:00.000Z' });
    assert.equal(c.vehicle.airbags, 'sab');
    const w = readSheetRow(row({ VEHICLE: 'CITY 14 EX W/O ABF' }), 8);
    assert.equal('skip' in w ? null : w.vehicle.airbags, 'without');
    assert.equal(c.vehicle.major_colour, 'RED');
    assert.equal(c.snapshot.fitted_store, 'FOCUS COCHIN');
    assert.equal(c.dispatch, null);
    const d = readSheetRow(row({ STATUS: 'DISPATCH', 'DIS.DATE': '2026-09-28', 'DOCKET NO.': '232845437', REASON: 'CHARGEABLE', FOC: 'UNITED AUTO' }), 5);
    if ('skip' in d) throw new Error(d.skip);
    assert.equal(d.status, 'closed');
    assert.equal(d.kind, 'alteration');
    assert.equal(d.decision.charge, 'chargeable');
    assert.equal(d.decision.remarks, 'FOC: UNITED AUTO');
    assert.deepEqual(d.dispatch, { date: '2026-09-28', docket: '232845437', courier: null, at: '2026-09-28T00:00:00.000Z' });
    const h = readSheetRow(row({ STATUS: 'HOLD R', 'HOLD REASON ': 'ABF /W/O ABF?' }), 6);
    if ('skip' in h) throw new Error(h.skip);
    assert.deepEqual(h.hold, { reason: 'airbags', note: 'ABF /W/O ABF?', at: '2026-06-10T00:00:00.000Z' });
    assert.deepEqual(readSheetRow(row({ 'ALT NO': null }), 7), { skip: 'row 7: no alteration no.' });
});

test('dates as a Google sheet shows them, day first', async () => {
    const { sheetDate } = await import('../claimSheet.js');
    assert.equal(sheetDate('2026-10-28'), '2026-10-28');
    assert.equal(sheetDate('28/10/2026'), '2026-10-28');
    assert.equal(sheetDate('8-1-26'), '2026-01-08');
    assert.equal(sheetDate('28.10.2026'), '2026-10-28');
    assert.equal(sheetDate('28-Oct-2026'), '2026-10-28');
    assert.equal(sheetDate('28 October 26'), '2026-10-28');
    assert.equal(sheetDate('46323'), '2026-10-28');
    assert.equal(sheetDate('31/02/2026'), null);
    assert.equal(sheetDate('DISPATCHED'), null);
    // The live sheet shows no year.
    const nov = new Date('2026-11-04T00:00:00Z');
    assert.equal(sheetDate('11-Mar', nov), '2026-03-11');
    assert.equal(sheetDate('10-June', nov), '2026-06-10');
    assert.equal(sheetDate('4-Nov', nov), '2026-11-04');
    assert.equal(sheetDate('2-Dec', nov), '2026-12-02');
    assert.equal(sheetDate('20-Dec', nov), '2025-12-20');
    assert.equal(sheetDate('15-Oct', new Date('2027-01-10T00:00:00Z')), '2026-10-15');
    assert.equal(sheetDate('31-Feb', nov), null);
    assert.equal(sheetDate('12-Foo', nov), null);
    assert.equal(sheetDate(''), null);
});

test('a tab as rows by column: the header found below title rows, empty rows dropped', async () => {
    const { rowsFromGrid } = await import('../claimSheet.js');
    const rows = rowsFromGrid([
        ['PRODUCTION NOV 2026', '', ''],
        ['DATE', 'ALT NO', 'PARTY NAME '],
        ['01/11/2026', 'Y300', 'FOCUS COCHIN'],
        ['', '', ''],
        ['02/11/2026', 'Y301', 'AUTO CHOICE'],
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]._row, '3');
    assert.equal(rows[1]._row, '5');
    const c = readSheetRow(rows[0], Number(rows[0]._row));
    assert.ok(!('skip' in c));
    if (!('skip' in c)) { assert.equal(c.created_at.slice(0, 10), '2026-11-01'); assert.equal(c.key, 'Y300|2026-11-01|FOCUS COCHIN'); }
    assert.deepEqual(rowsFromGrid([['no', 'header']]), []);
});
