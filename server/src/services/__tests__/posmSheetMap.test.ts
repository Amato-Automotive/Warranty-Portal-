import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { columnsOf, designFit, noidaDate, plantDate, qtyOf, readSheetDate, statusFromNoida, statusFromPlant, statusToPlant, words, PLANT_COLUMNS } from '../posmSheetMap.js';

describe('the plant and Noida sheets', () => {
    test('columns are found by header, however spaced or cased', () => {
        const h = ['DATE', 'MATCHING KEY', 'PLACE BY CONCERN PERSON ', 'STATUS ', 'Expected Dis. Date (EDD)', 'DISTRIBUTER', 'STORE NAME', 'STORE (OLD/NEW)', 'FRP/ SAMPLE JACKETS', 'DESIGN', 'MINOR ', 'MAJOR', 'QTY.', 'BRANDING ', 'NOTE', 'REMARKS', 'DISPATCH DATE ', 'DOCKET NUMBER ', 'MODE '];
        const c = columnsOf(h, PLANT_COLUMNS);
        assert.deepEqual([c.status, c.expected_dispatch, c.minor_colour, c.qty, c.courier, c.portal_id], [3, 4, 10, 12, 18, undefined]);
        assert.equal(columnsOf(['AJAS', 'MATCHING KEY'], PLANT_COLUMNS).request_date, 0);
    });

    test('dates in every way the sheets write them', () => {
        assert.equal(readSheetDate('01-01-2026'), '2026-01-01');
        assert.equal(readSheetDate('16-11-2026'), '2026-11-16');
        assert.equal(readSheetDate('16-January'), '2026-01-16');
        assert.equal(readSheetDate('06-Jan'), '2026-01-06');
        assert.equal(readSheetDate('18-Jan-2026'), '2026-01-18');
        assert.equal(readSheetDate('24-Nov-26'), '2026-11-24');
        assert.equal(readSheetDate('hello'), null);
        assert.equal(readSheetDate(''), null);
        assert.equal(plantDate('2026-11-16'), '16-11-2026');
        assert.equal(noidaDate('2026-01-18'), '18-Jan-2026');
    });

    test('the plant status words both ways', () => {
        assert.equal(statusFromPlant('DISPATCH'), 'Dispatched');
        assert.equal(statusFromPlant('hold r'), 'On hold');
        assert.equal(statusFromPlant(''), 'Not updated');
        assert.equal(statusToPlant('Ready to dispatch'), 'READY');
        assert.equal(statusToPlant('Not updated'), '');
        for (const w of ['DISPATCH', 'WIP', 'READY', 'HOLD R']) assert.equal(statusToPlant(statusFromPlant(w)), w);
        assert.equal(statusFromNoida('Delivered'), 'Delivered');
        assert.equal(statusFromNoida('In production'), 'WIP');
    });

    test('quantities and design words', () => {
        assert.equal(qtyOf('200'), 200);
        assert.equal(qtyOf(''), 0);
        assert.equal(qtyOf('1 HEADREST'), 1);
        assert.deepEqual(words('XCROSS'), ['X', 'CROSS']);
        assert.deepEqual(words('U-FOCUS BLACK / WHITE STITCHES'), ['U', 'FOCUS', 'BLACK', 'WHITE']);
        assert.equal(designFit(words('U FOCUS BLACK / WHITE STITCHES', '', ''), words('U FOCUS', 'BLACK', 'WHITE')), 1);
        assert.ok(designFit(words('Q2 BLACK/ RED STITCHES'), words('U FOCUS', 'BLACK', 'WHITE')) < 0.5);
    });
});

import { decide } from '../posmSheetMap.js';

describe('two-way sync: what moves where', () => {
    test('nothing changed, or values that were always different: nothing moves', () => {
        assert.deepEqual(decide('WIP', 'WIP', 'WIP', 'WIP'), { clash: false });
        assert.deepEqual(decide('TRACKON', 'Trackon', 'TRACKON', 'Trackon'), { clash: false });
    });
    test('the plant changed the sheet: the portal takes it', () => {
        assert.deepEqual(decide('DISPATCH', 'WIP', 'WIP', 'WIP'), { toPortal: 'DISPATCH', clash: false });
        assert.deepEqual(decide('DTDC', 'Trackon', 'TRACKON', 'Trackon'), { toPortal: 'DTDC', clash: false });
    });
    test('the portal changed: the sheet takes it', () => {
        assert.deepEqual(decide('WIP', 'Dispatched', 'WIP', 'WIP'), { toSheet: 'Dispatched', clash: false });
    });
    test('both changed to the same: nothing to write; to different: the portal wins', () => {
        assert.deepEqual(decide('X', 'X', 'A', 'A'), { clash: false });
        assert.deepEqual(decide('S', 'P', 'A', 'A'), { toSheet: 'P', clash: true });
    });
    test('a sheet edit back to what the portal already has moves nothing', () => {
        assert.deepEqual(decide('Trackon', 'Trackon', 'TRACKON', 'Trackon'), { clash: false });
    });
});
