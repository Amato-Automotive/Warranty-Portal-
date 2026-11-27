import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readStatus, readStoreType, summarise, DEFAULT_SETTINGS, DEFAULT_LIMITS, checkPlantEdit, needsReason, orderNeedsApproval, noidaGroupKey, type HistoryLine } from '../posmHistory.js';

const L = (item: string, qty: number, status: string, dispatch_date: string | null = null): HistoryLine => ({ item, qty, status, dispatch_date });

describe('POSM dispatch history', () => {
    test('only Dispatched, In Transit and Delivered count as sent; Return counts as nothing', () => {
        const s = summarise([L('Visiting Card', 200, 'Delivered'), L('Visiting Card', 100, 'Return'), L('Calendar', 1, 'WIP'), L('Calendar', 2, 'In Transit')]);
        assert.deepEqual(s.sent, { 'Visiting Card': 200, Calendar: 2 });
    });

    test('an old store within its limits needs no approval', () => {
        const s = summarise([L('FRP', 1, 'Delivered'), L('Sample Jacket', 10, 'Dispatched')]);
        assert.equal(s.approval, 'within');
        assert.equal(s.needs_approval, false);
        assert.deepEqual([s.frp.left, s.jacket.left], [1, 10]);
    });

    test('reaching the limit exactly means approval is needed for more', () => {
        const s = summarise([L('FRP', 2, 'Delivered')]);
        assert.equal(s.frp.state, 'reached');
        assert.equal(s.approval, 'reached');
        assert.equal(s.needs_approval, true);
    });

    test('over the limit is over, even if the other item is only reached', () => {
        const s = summarise([L('FRP', 2, 'Delivered'), L('Sample Jacket', 25, 'Dispatched')]);
        assert.equal(s.jacket.state, 'over');
        assert.equal(s.approval, 'over');
    });

    test('pending that would take a store over is a warning, not yet over', () => {
        const s = summarise([L('FRP', 1, 'Delivered'), L('FRP', 2, 'WIP')]);
        assert.equal(s.frp.state, 'pending_over');
        assert.equal(s.approval, 'within');
        assert.equal(s.frp.pending, 2);
    });

    test('a store limit can be changed', () => {
        const s = summarise([L('FRP', 2, 'Delivered')], { ...DEFAULT_SETTINGS, frp_limit: 4 });
        assert.equal(s.frp.state, 'ok');
        assert.equal(s.frp.left, 2);
    });

    test('a new store has limits too: FRP 2, Sample Jackets 30', () => {
        const fresh = { ...DEFAULT_SETTINGS, store_type: 'new' as const, type_assumed: false, ...DEFAULT_LIMITS.new };
        assert.equal(summarise([L('Sample Jacket', 25, 'Delivered')], fresh).approval, 'within');
        assert.equal(summarise([L('Sample Jacket', 30, 'Delivered')], fresh).approval, 'reached');
        assert.equal(summarise([L('Sample Jacket', 25, 'Delivered')], DEFAULT_SETTINGS).approval, 'over');
        assert.equal(summarise([L('FRP', 3, 'Delivered')], fresh).frp.state, 'over');
    });

    test('the last dispatch is the latest sent line', () => {
        const s = summarise([L('FRP', 1, 'Delivered', '2026-03-11'), L('FRP', 1, 'Delivered', '2026-09-02'), L('Calendar', 1, 'WIP', '2026-11-01')]);
        assert.equal(s.last_dispatch, '2026-09-02');
    });

    test('the plant can only change its own fields', () => {
        const r = checkPlantEdit({ status: 'WIP', reason: null, dispatch_date: null }, { status: 'Ready to dispatch', qty: 9, design: 'X', remarks: ' ok ' }, '2026-11-26');
        assert.ok(r.ok);
        assert.deepEqual(r.ok && r.set, { status: 'Ready to dispatch', remarks: 'ok' });
    });

    test('on hold or out of stock needs a reason', () => {
        const was = { status: 'WIP', reason: null, dispatch_date: null };
        assert.equal(checkPlantEdit(was, { status: 'On hold' }, '2026-11-26').ok, false);
        assert.equal(checkPlantEdit(was, { status: 'On hold', reason: 'Pattern delay' }, '2026-11-26').ok, true);
    });

    test('dispatched gets today as its dispatch date if none; a future or malformed date is refused', () => {
        const was = { status: 'WIP', reason: null, dispatch_date: null };
        const r = checkPlantEdit(was, { status: 'Dispatched' }, '2026-11-26');
        assert.ok(r.ok && r.set.dispatch_date === '2026-11-26' && r.statusChanged);
        assert.equal(checkPlantEdit(was, { dispatch_date: '2026-12-01' }, '2026-11-26').ok, false);
        assert.equal(checkPlantEdit(was, { expected_dispatch: '26-11-2026' }, '2026-11-26').ok, false);
    });

    test('a line needs a reason when held, out of stock, or past its expected date', () => {
        assert.equal(needsReason({ status: 'On hold', reason: null, expected_dispatch: null }, '2026-11-26'), true);
        assert.equal(needsReason({ status: 'WIP', reason: null, expected_dispatch: '2026-11-20' }, '2026-11-26'), true);
        assert.equal(needsReason({ status: 'Dispatched', reason: null, expected_dispatch: '2026-11-20' }, '2026-11-26'), false);
        assert.equal(needsReason({ status: 'On hold', reason: 'Stock', expected_dispatch: null }, '2026-11-26'), false);
    });

    test('a new order past the limit, counting what is pending, needs approval', () => {
        assert.match(orderNeedsApproval([L('FRP', 1, 'Delivered'), L('FRP', 1, 'WIP')], DEFAULT_SETTINGS, [{ item: 'FRP', qty: 1 }])!, /past the limit of 2/);
        assert.equal(orderNeedsApproval([L('FRP', 1, 'Delivered')], DEFAULT_SETTINGS, [{ item: 'FRP', qty: 1 }]), null);
        const fresh = { ...DEFAULT_SETTINGS, store_type: 'new' as const, type_assumed: false, ...DEFAULT_LIMITS.new };
        assert.equal(orderNeedsApproval([L('Sample Jacket', 20, 'Delivered')], fresh, [{ item: 'Sample Jacket', qty: 10 }]), null);
        assert.match(orderNeedsApproval([L('Sample Jacket', 20, 'Delivered')], fresh, [{ item: 'Sample Jacket', qty: 11 }])!, /past the limit of 30/);
    });

    test('Noida lines of one dispatch share a key', () => {
        const base = { store_id: 's1', store_code: 'F1', sheet_store_name: 'A', dispatch_date: '2026-03-11', docket_no: 'D1', courier: 'Trackon', dispatched_by: 'Ashish', status: 'Delivered', delivery_date: null };
        assert.equal(noidaGroupKey(base), noidaGroupKey({ ...base }));
        assert.notEqual(noidaGroupKey(base), noidaGroupKey({ ...base, docket_no: 'D2' }));
    });

    test('store types and statuses as written in the sheet', () => {
        assert.deepEqual(readStoreType('Old (assumed)'), { store_type: 'old', type_assumed: true });
        assert.deepEqual(readStoreType('Old'), { store_type: 'old', type_assumed: false });
        assert.deepEqual(readStoreType('New'), { store_type: 'new', type_assumed: false });
        assert.equal(readStatus('in transit'), 'In Transit');
        assert.equal(readStatus('DISPATCH'), 'Not updated');
    });
});
