import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { customPeriod, last12, periodOf, storeStat, totals } from '../asmWarrantyStats.js';

describe('ASM warranties by store', () => {
    test('this month is compared with the same days of last month', () => {
        const p = periodOf('mtd', '2026-11-27');
        assert.deepEqual([p.from, p.to, p.prevFrom, p.prevTo], ['2026-11-01', '2026-11-27', '2026-10-01', '2026-10-27']);
        /* 31 March: February has only 28 days. */
        const m = periodOf('mtd', '2026-03-31');
        assert.deepEqual([m.prevFrom, m.prevTo], ['2026-02-01', '2026-02-28']);
    });

    test('last month and last 90 days', () => {
        const l = periodOf('last_month', '2026-01-15');
        assert.deepEqual([l.from, l.to, l.prevFrom, l.prevTo], ['2025-12-01', '2025-12-31', '2025-11-01', '2025-11-30']);
        const n = periodOf('last_90', '2026-11-27');
        assert.deepEqual([n.from, n.to, n.prevTo], ['2026-08-30', '2026-11-27', '2026-08-29']);
        assert.equal(n.prevFrom, '2026-06-01');
    });

    test('custom dates are compared with as many days just before', () => {
        const c = customPeriod('2026-11-10', '2026-11-19', '2026-11-27')!;
        assert.deepEqual([c.from, c.to, c.prevFrom, c.prevTo], ['2026-11-10', '2026-11-19', '2026-10-31', '2026-11-09']);
        assert.equal(customPeriod('2026-11-05', '2026-11-05', '2026-11-27')!.prevFrom, '2026-11-04');
        assert.equal(customPeriod('2026-11-20', '2026-11-10', '2026-11-27'), null);
        assert.equal(customPeriod('2026-11-20', '2026-11-28', '2026-11-27'), null);
        assert.equal(customPeriod('2026-02-30', '2026-03-01', '2026-11-27'), null);
        assert.equal(customPeriod('2025-01-01', '2026-11-01', '2026-11-27'), null);
    });

    test('segments: a real drop, a small wobble, silent, new', () => {
        const s = (cur: number, prev: number) => storeStat({ store_id: 'x', cur: { approved: cur, rejected: 0, pending: 0 }, prev }, 'x').segment;
        assert.equal(s(10, 20), 'dropping');
        assert.equal(s(30, 20), 'growing');
        assert.equal(s(2, 1), 'steady');
        assert.equal(s(0, 5), 'silent');
        assert.equal(s(4, 0), 'new');
        assert.equal(storeStat(undefined, 'y').segment, 'silent');
    });

    test('approval rate counts only decided warranties; totals add up', () => {
        const a = storeStat({ store_id: 'a', cur: { approved: 9, rejected: 1, pending: 5 }, prev: 10 }, 'a');
        assert.deepEqual([a.current, a.approval_rate, a.change], [15, 90, 50]);
        const t = totals([a, storeStat(undefined, 'b')]);
        assert.deepEqual([t.current, t.previous, t.active_stores, t.approval_rate], [15, 10, 1, 90]);
    });

    test('12 months end with this one', () => {
        assert.deepEqual([last12('2026-11-27')[0], last12('2026-11-27')[11]], ['2025-12', '2026-11']);
    });
});
