import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSheetRow, sheetProblem, sheetStatus, sheetChargeable } from '../claimSheet.js';

const row = (p: Record<string, string | null> = {}) => ({
    'DATE': '2026-06-10', 'MODE': 'MAIL', 'STATUS': 'WIP', ' DEPOT NAME': 'JANAK DEPOT', 'PARTY NAME ': 'FOCUS COCHIN', 'EDD': '2026-06-25',
    'DESIGN ': 'Q2', 'MINOR': 'BLACK', 'MAJOR': 'RED', 'REMARKS': 'FRONT LEFT SIDE', 'VEHICLE': 'GLANZA SPL 22 SAB', 'REASON': 'PHYSICAL DAMAGE',
    'ALT NO': 'Y259', 'FOC': null, 'DIS.DATE': null, 'DOCKET NO.': null, 'HOLD REASON ': null, ...p,
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
