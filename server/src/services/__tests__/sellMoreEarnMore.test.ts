import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earned, eligibility, invoiceProblems, isSellMore, noSets, optionOf, rateFor, readSets, redeemProblem, SELL_MORE_ID, seriesInMonth, setsForOffer, storeScaleTarget, setsTotal, subtractSets, tierIdForMonth, usedProblem, worthOf } from '../sellMoreEarnMore.js';
import { periodsOf } from '../schemeTargets.js';

const rule = {
    series: [
        { id: 'a', name: 'Amaze', points: 0.5, products: ['AMAZE+'] },
        { id: 's', name: 'Signature', points: 1.25, products: ['D3 (Signature)'] },
    ],
    tiers: [{ id: 'r', name: 'Regular', times: 1 }, { id: 'b', name: 'Big Daddy', times: 2 }],
};
const months = periodsOf('2026-11-01', '2027-03-31', 'month').slice(0, 2);
const go = (rows: any[], tier: any = null) => earned(rows, worthOf(rule, tier), months, '2026-11-01', '2027-03-31');

test('points add up by day and by month, newest day first', () => {
    const e = go([
        { d: '2026-11-03', pn: 'amaze+', n: 2 },
        { d: '2026-11-05', pn: 'd3 (signature)', n: 1 },
        { d: '2026-11-03', pn: 'd3 (signature)', n: 1 },
        { d: '2026-12-01', pn: 'amaze+', n: 1 },
    ]);
    assert.equal(e.total, 4);
    assert.equal(e.warranties, 5);
    assert.deepEqual(e.months.map(m => m.points), [3.5, 0.5]);
    assert.deepEqual(e.months[0].days.map(d => [d.date, d.points, d.warranties]), [['2026-11-05', 1.25, 1], ['2026-11-03', 2.25, 3]]);
});

test('a store type multiplies, unless the admin set that series itself', () => {
    const rows = [{ d: '2026-11-03', pn: 'amaze+', n: 2 }, { d: '2026-11-03', pn: 'd3 (signature)', n: 2 }];
    assert.equal(go(rows).total, 3.5);
    assert.equal(go(rows, rule.tiers[1]).total, 7);
    const set = { ...rule.tiers[1], rates: { a: 3 } };
    assert.equal(rateFor(set, rule.series[0]), 3);
    assert.equal(rateFor(set, rule.series[1]), 2.5);
    assert.equal(go(rows, set).total, 11);
});

test('a product in no series earns nothing and is counted apart', () => {
    const e = go([{ d: '2026-11-03', pn: 'd3', n: 4 }, { d: '2026-11-03', pn: 'amaze+', n: 1 }]);
    assert.equal(e.total, 0.5);
    assert.equal(e.warranties, 1);
    assert.equal(e.no_series, 4);
    assert.equal(e.months[0].days[0].no_series, 4);
});

test('warranties outside the program or the months shown are left out', () => {
    const e = go([{ d: '2026-10-31', pn: 'amaze+', n: 9 }, { d: '2027-01-02', pn: 'amaze+', n: 9 }]);
    assert.equal(e.total, 0);
    assert.equal(e.warranties, 0);
});

test('a store with no warranties reads as zero for every month', () => {
    const e = go([]);
    assert.equal(e.total, 0);
    assert.deepEqual(e.months.map(m => m.key), ['2026-11', '2026-12']);
});

test('only an opted store is on the option', () => {
    assert.equal(optionOf(null), null);
    assert.equal(optionOf({ reward: 'test', target: 200 }), null);
    assert.equal(optionOf({ option: 'sell_more' }), 'sell_more');
    assert.equal(optionOf({ option: 'buy_more' }), 'buy_more');
    assert.equal(optionOf({ option: 'other' }), null);
});

test('a month is asked for once, after its target is reached, with points in it', () => {
    const open = { points: 10, can_request: true };
    assert.ok(redeemProblem(null, open, false));
    assert.ok(redeemProblem('sell_more', null, false));
    assert.ok(redeemProblem('sell_more', { points: 10, can_request: false }, false));
    assert.ok(redeemProblem('sell_more', { points: 0, can_request: true }, false));
    assert.ok(redeemProblem('sell_more', open, true));
    assert.equal(redeemProblem('sell_more', open, false), null);
});

test('a target is shown on the store\'s own scale', () => {
    assert.equal(storeScaleTarget(null, 10, 10, 1), null);
    assert.equal(storeScaleTarget(40, 31, 31, 1), 40);
    assert.equal(storeScaleTarget(80, 42.75, 85.5, 2), 40);
    assert.equal(storeScaleTarget(80, 0, 0, 2), 40);
});

test('a category carries on from the nearest earlier month', () => {
    const all = periodsOf('2026-11-01', '2027-03-31', 'month');
    assert.equal(tierIdForMonth({}, all, '2027-01', 'r'), 'r');
    assert.equal(tierIdForMonth({ '2026-11': 'b' }, all, '2027-01', 'r'), 'b');
    assert.equal(tierIdForMonth({ '2026-11': 'b', '2026-12': 'r' }, all, '2027-01', undefined), 'r');
    assert.equal(tierIdForMonth({ '2027-02': 'b' }, all, '2027-01', 'r'), 'r');
});

test('each series shows what it earned in the month', () => {
    const rows = [{ d: '2026-11-03', pn: 'amaze+', n: 2 }, { d: '2026-12-03', pn: 'amaze+', n: 9 }, { d: '2026-11-04', pn: 'd3', n: 5 }];
    assert.deepEqual(seriesInMonth(rows, rule, '2026-11', '2026-11-01', '2027-03-31'), [{ name: 'Amaze', warranties: 2, points: 1 }, { name: 'Signature', warranties: 0, points: 0 }]);
    assert.equal(seriesInMonth(rows, rule, '2026-11', '2026-11-01', '2027-03-31', rule.tiers[1])[0].points, 2);
});

const sets = (o: Partial<ReturnType<typeof noSets>>) => ({ ...noSets(), ...o });

test('Offer 1 is ready at any 12 sets and says how many more', () => {
    assert.deepEqual(eligibility(sets({ other: 11 })).offer1, { have: 11, more: 1, ready: false });
    assert.deepEqual(eligibility(sets({ other: 7, velora: 5 })).offer1, { have: 12, more: 0, ready: true });
    assert.deepEqual(eligibility(sets({ other: 30 })).offer1, { have: 12, more: 0, ready: true });
});

test('Offer 2 is ready at the mix and says what is missing', () => {
    assert.equal(eligibility(sets({ velora: 4, doble: 1, signature: 1, emporio: 1 })).offer2_ready, true);
    const e = eligibility(sets({ velora: 3, doble: 1, emporio: 2 }));
    assert.equal(e.offer2_ready, false);
    assert.deepEqual(e.offer2.map(r => [r.kind, r.have, r.more]), [['velora', 3, 1], ['doble', 1, 0], ['signature', 0, 1], ['emporio', 1, 0]]);
});

test('Offer 2 uses its mix and the rest carries forward', () => {
    const have = sets({ velora: 6, doble: 2, signature: 1, emporio: 1, other: 3 });
    const used = setsForOffer(have, 'offer2');
    assert.deepEqual(used, sets({ velora: 4, doble: 1, signature: 1, emporio: 1 }));
    assert.deepEqual(subtractSets(have, used), sets({ velora: 2, doble: 1, other: 3 }));
});

test('Offer 1 uses other sets first, then spare premium ones', () => {
    assert.deepEqual(setsForOffer(sets({ other: 15 }), 'offer1'), sets({ other: 12 }));
    const used = setsForOffer(sets({ other: 8, velora: 8, doble: 1, signature: 1, emporio: 1 }), 'offer1');
    assert.deepEqual(used, sets({ other: 8, velora: 4 }));
    assert.equal(setsTotal(used), 12);
});

test('a reward can only use sets the store has', () => {
    const have = sets({ other: 12 });
    assert.equal(usedProblem(sets({ other: 12 }), have), null);
    assert.ok(usedProblem(noSets(), have));
    assert.ok(usedProblem(sets({ velora: 1 }), have));
    assert.ok(usedProblem(sets({ other: 13 }), have));
});

test('sets as sent are cleaned', () => {
    assert.deepEqual(readSets('{"velora":"4","doble":-1,"signature":2.9,"emporio":9999,"junk":5}'), { velora: 4, doble: 0, signature: 2, emporio: 500, other: 0 });
    assert.deepEqual(readSets('not json'), noSets());
});

test('an invoice needs a file, its number, a date in the program and sets', () => {
    const ok = { invoice_no: 'A1', invoice_date: '2026-11-02', sets: sets({ other: 1 }), files: 1 };
    const run = (o = {}) => invoiceProblems({ ...ok, ...o }, '2026-11-01', '2027-03-31', '2026-11-03');
    assert.deepEqual(run(), []);
    assert.equal(run({ files: 0 }).length, 1);
    assert.equal(run({ invoice_no: ' ' }).length, 1);
    assert.equal(run({ invoice_date: '2026-10-31' }).length, 1);
    assert.equal(run({ invoice_date: '2026-11-04' }).length, 1);
    assert.equal(run({ sets: noSets() }).length, 1);
});

test('only the one scheme runs this way', () => {
    assert.ok(isSellMore(SELL_MORE_ID));
    assert.ok(!isSellMore('8ecf2030-ff0b-437b-88a1-81ac354df46a'));
});
