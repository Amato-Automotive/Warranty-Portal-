import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeriod, buildOverview, buildStoreDetail, lastMonths, average, type RatingRow, type StoreInfo } from '../ratingStats.js';

const TODAY = '2026-11-13';
const st = (id: string, name: string): StoreInfo => ({ store_id: id, name, brand: 'AF', state: 'Delhi', city: 'Delhi' });
const r = (store_id: string, stars: number, day: string): RatingRow => ({ store_id, stars, day, product: 'Seat cover' });

describe('periods', () => {
    test('last 7 days ends today and the period before is the 7 days ahead of it', () => {
        const p = resolvePeriod('7', null, null, TODAY);
        assert.deepEqual([p.start, p.end, p.prevStart, p.prevEnd], ['2026-11-07', '2026-11-13', '2026-10-31', '2026-11-06']);
    });
    test('today is one day, overall has no earlier period', () => {
        assert.deepEqual([resolvePeriod('today', null, null, TODAY).start, resolvePeriod('today', null, null, TODAY).prevEnd], ['2026-11-13', '2026-11-12']);
        const o = resolvePeriod('overall', null, null, TODAY);
        assert.deepEqual([o.start, o.end, o.prevStart], [null, null, null]);
    });
    test('a custom range is kept; a backwards or unreadable one falls back to 30 days', () => {
        const c = resolvePeriod('custom', '2026-10-01', '2026-10-10', TODAY);
        assert.deepEqual([c.key, c.start, c.end, c.prevStart, c.prevEnd], ['custom', '2026-10-01', '2026-10-10', '2026-09-21', '2026-09-30']);
        assert.equal(resolvePeriod('custom', '2026-10-10', '2026-10-01', TODAY).start, '2026-10-15');
        assert.equal(resolvePeriod('nonsense', null, null, TODAY).key, '30');
    });
    test('six months end with the current one', () => {
        assert.deepEqual(lastMonths(TODAY), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
        assert.deepEqual(lastMonths('2026-02-10', 3), ['2025-12', '2026-01', '2026-02']);
    });
});

describe('overview', () => {
    const stores = [st('a', 'Alpha'), st('b', 'Beta'), st('c', 'Gamma')];
    const rows = [
        r('a', 5, '2026-11-10'), r('a', 4, '2026-11-11'),
        r('b', 3, '2026-11-12'), r('b', 3, '2026-11-09'), r('b', 4, '2026-11-02'),
        r('c', 5, '2026-09-01'),
    ];
    test('the summary is over the period, and a store with no rating in it is not counted as rated', () => {
        const o = buildOverview(rows, stores, resolvePeriod('15', null, null, TODAY), TODAY, { warrantiesInPeriod: 10 });
        assert.equal(o.summary.ratings, 5);
        assert.equal(o.summary.average, 3.8);
        assert.equal(o.summary.stores_rated, 2);
        assert.equal(o.summary.stores_total, 3);
        assert.equal(o.summary.below_low, 1);
        assert.equal(o.summary.warranties_rated_pct, 50);
    });
    test('a store shows its change against the period before, and is flagged when low', () => {
        const o = buildOverview(rows, stores, resolvePeriod('7', null, null, TODAY), TODAY, { minCount: 2 });
        const b = o.stores.find(s => s.store_id === 'b')!;
        assert.equal(b.period_average, 3);
        assert.equal(b.previous_average, 4);
        assert.equal(b.change, -1);
        assert.equal(b.needs_attention, true);
        assert.equal(o.stores.find(s => s.store_id === 'a')!.needs_attention, false);
    });
    test('a flag needs the minimum number of ratings in the period', () => {
        const o = buildOverview(rows, stores, resolvePeriod('7', null, null, TODAY), TODAY, { minCount: 5 });
        assert.equal(o.stores.find(s => s.store_id === 'b')!.needs_attention, false);
    });
    test('the average band narrows the stores, and the split counts the period', () => {
        const o = buildOverview(rows, stores, resolvePeriod('15', null, null, TODAY), TODAY, { band: 'below4' });
        assert.deepEqual(o.stores.map(s => s.store_id), ['b']);
        assert.deepEqual(o.split, { 1: 0, 2: 0, 3: 2, 4: 2, 5: 1 });
    });
    test('with no ratings at all nothing breaks', () => {
        const o = buildOverview([], stores, resolvePeriod('30', null, null, TODAY), TODAY);
        assert.equal(o.summary.average, null);
        assert.equal(o.summary.warranties_rated_pct, null);
        assert.equal(o.stores.length, 3);
    });
});

describe('one store', () => {
    test('shows its average against the network, masks the phone and lists newest first', () => {
        const mine: RatingRow[] = [
            { ...r('b', 1, '2026-11-09'), customer_name: 'R. Verma', customer_phone: '9811221234', warranty_uid: 'W1' },
            { ...r('b', 5, '2026-11-02'), customer_name: ' ', customer_phone: '123' },
        ];
        const network = [...mine, r('a', 5, '2026-11-01'), r('a', 5, '2026-11-03')];
        const d = buildStoreDetail(st('b', 'Beta'), mine, network, resolvePeriod('30', null, null, TODAY), TODAY);
        assert.equal(d.average, 3);
        assert.equal(d.network_average, 4);
        assert.deepEqual(d.low, { count: 1, of: 2 });
        assert.equal(d.list[0].phone, '98••••1234');
        assert.equal(d.list[0].customer, 'R. Verma');
        assert.equal(d.list[1].customer, 'Customer');
        assert.equal(d.list[1].phone, '');
        const nov = d.by_month.find(m => m.month === '2026-11')!;
        assert.deepEqual([nov.store, nov.network], [3, 4]);
    });
    test('average of nothing is null', () => assert.equal(average([]), null));
});
