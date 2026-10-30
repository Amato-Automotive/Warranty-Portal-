import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    baselineMonths, growthTarget, monthlyAverage, periodsOf, planTargetImport, readPeriod, readSettings, settingsProblems, stepsFor, targetResult,
    type TargetStep,
} from '../schemeTargets.js';

const steps: TargetStep[] = [{ pct: 80, amount: 50 }, { pct: 100, amount: 100 }, { pct: 120, amount: 150 }];

test('a scheme saved before settings reads as run by entries', () => {
    const s = readSettings(null);
    assert.equal(s.run, 'entries');
    assert.equal(s.show.to_next, false);
    assert.deepEqual(settingsProblems(s), []);
});

test('the highest step reached counts, on every unit achieved', () => {
    const r = targetResult(100, 105, steps, 'per_unit');
    assert.equal(r.pct, 105);
    assert.equal(r.step_no, 2);
    assert.equal(r.benefit_rupees, 10500);
    assert.equal(r.benefit, '₹10,500');
    assert.equal(r.next?.pct, 120);
    assert.equal(r.to_next, 15);
});

test('below the first step earns nothing; exactly on a step reaches it', () => {
    assert.equal(targetResult(100, 79, steps, 'per_unit').step, null);
    assert.equal(targetResult(100, 79, steps, 'per_unit').to_next, 1);
    assert.equal(targetResult(60, 48, steps, 'per_unit').step_no, 1);
    assert.equal(targetResult(100, 130, steps, 'per_unit').next, null);
});

test('no target, or nothing achieved yet, has no share', () => {
    assert.equal(targetResult(null, 50, steps, 'per_unit').pct, null);
    assert.equal(targetResult(100, null, steps, 'per_unit').pct, null);
});

test('% off and written rewards', () => {
    assert.equal(targetResult(10, 10, [{ pct: 100, amount: 5 }], 'percent').benefit, '5% off');
    assert.equal(targetResult(10, 12, [{ pct: 100, reward: '1 set free' }], 'fixed').benefit, '1 set free');
});

test('steps need a share and a benefit, each share once', () => {
    const p = settingsProblems(readSettings({ run: 'targets', benefit: 'per_unit', steps: [{ pct: 100, amount: 0 }, { pct: 100, amount: 5 }] }));
    assert.ok(p.some(x => x.includes('₹ off')));
    assert.ok(p.some(x => x.includes('Two steps')));
    assert.ok(settingsProblems(readSettings({ run: 'targets', steps: [] })).length > 0);
});

test('periods: whole, months and quarters from the start month', () => {
    const w = periodsOf('2026-10-01', '2027-03-31', 'whole');
    assert.equal(w.length, 1);
    assert.equal(w[0].key, 'all');
    assert.equal(w[0].months.length, 6);
    const m = periodsOf('2026-11-15', '2027-02-10', 'month');
    assert.deepEqual(m.map(p => p.key), ['2026-11', '2026-12', '2027-01', '2027-02']);
    assert.equal(m[0].label, 'Nov 2026');
    const q = periodsOf('2026-11-01', '2027-03-31', 'quarter');
    assert.deepEqual(q.map(p => p.key), ['Q2026-11', 'Q2027-02']);
    assert.equal(q[0].label, 'Nov 2026–Jan 2027');
    assert.deepEqual(q[1].months, ['2027-02', '2027-03']);
});

test('warranty growth: the average before the start, grown, makes the target', () => {
    assert.deepEqual(baselineMonths('2026-11-05', 3), ['2026-08', '2026-09', '2026-10']);
    assert.deepEqual(baselineMonths('2026-02-01', 2), ['2025-12', '2026-01']);
    const avg = monthlyAverage({ '2026-08': 20, '2026-10': 25 }, ['2026-08', '2026-09', '2026-10']);
    assert.equal(avg, 15);
    assert.equal(growthTarget(avg, 20, 1), 18);
    assert.equal(growthTarget(avg, 20, 3), 54);
    assert.equal(growthTarget(10.1, 0, 1), 11);
    assert.equal(growthTarget(10, 0, 1), 10);
});

test('a store with its own reward is judged on reaching its target', () => {
    const s = readSettings({ run: 'targets', source: 'warranties' });
    assert.deepEqual(settingsProblems(s), []);
    const { steps: st, benefit } = stepsFor({ reward: '₹5,000', growth_pct: 20 }, s);
    assert.equal(targetResult(18, 17, st, benefit).benefit, null);
    assert.equal(targetResult(18, 18, st, benefit).benefit, '₹5,000');
});

test('a typed period is read in its common forms', () => {
    const m = periodsOf('2026-10-01', '2026-12-31', 'month');
    for (const t of ['2026-11', 'Nov 2026', 'November 2026', '11/2026', "Nov'26", 'nov-26']) assert.equal(readPeriod(t, m), '2026-11', t);
    assert.equal(readPeriod('2027-01', m), null);
    assert.equal(readPeriod('anything', periodsOf('2026-10-01', '2026-12-31', 'whole')), 'all');
    assert.equal(readPeriod('Oct 2026', periodsOf('2026-10-01', '2026-12-31', 'quarter')), 'Q2026-10');
});

test('an import matches stores by code, email or one exact name, and says what is wrong per row', () => {
    const stores = [
        { id: 's1', code: 'AF-101', name: 'Sample Auto', email: 'a@x.in' },
        { id: 's2', code: null, name: 'Twin Store' }, { id: 's3', code: null, name: 'Twin Store' },
    ];
    const periods = periodsOf('2026-10-01', '2026-11-30', 'month');
    const { changes, problems } = planTargetImport([
        { row: 2, store: 'af-101', period: 'Oct 2026', target: 100, achieved: '' },
        { row: 3, store: 'a@x.in', period: 'Nov 2026', target: '', achieved: 40 },
        { row: 4, store: 'Twin Store', period: 'Oct 2026', target: 5, achieved: 1 },
        { row: 5, store: 'Sample Auto', period: 'Oct 2026', target: 120, achieved: '' },
        { row: 6, store: 'AF-101', period: 'Dec 2026', target: 1, achieved: '' },
        { row: 7, store: 'Nobody', period: 'Oct 2026', target: 1, achieved: '' },
    ], stores, periods);
    assert.deepEqual(changes, [
        { store_id: 's1', period: '2026-10', target: 100 },
        { store_id: 's1', period: '2026-11', achieved: 40 },
    ]);
    assert.deepEqual(problems.map(p => p.row), [4, 5, 6, 7]);
});

test('averages the admin can look at: last 3 / 6 full months, overall, or a range', async () => {
    const { basisRange, averagePerMonth, windowPeriods } = await import('../schemeTargets.js');
    assert.deepEqual(basisRange({ mode: 'm3' }, '2026-11-10', null), { from: '2026-08-01', to: '2026-10-31' });
    assert.deepEqual(basisRange({ mode: 'm6' }, '2026-02-03', null), { from: '2025-08-01', to: '2026-01-31' });
    assert.equal(basisRange({ mode: 'custom', from: '2026-09-01', to: '2026-08-01' }, '2026-11-10', null), null);
    assert.equal(basisRange({ mode: 'overall' }, '2026-11-10', null), null);
    const daily = { '2026-08-05': 30, '2026-09-10': 30, '2026-10-20': 30, '2026-11-01': 99 };
    assert.equal(averagePerMonth(daily, basisRange({ mode: 'm3' }, '2026-11-10', null)), 29.8);
    const w = windowPeriods([{ start: '2026-12-01T00:00', end: '2026-12-31T23:59' }, { start: '2026-11-01T00:00', end: '2026-11-30T23:59' }]);
    assert.deepEqual(w.map(p => p.key), ['2026-11-01', '2026-12-01']);
    assert.equal(w[0].label, '1 Nov – 30 Nov 2026');
    assert.equal(w[0].months.length, 1);
});

test('a store new to the portal is never stretched past its warranties', async () => {
    const { basisRange, averagePerMonth } = await import('../schemeTargets.js');
    // One warranty, the first one yesterday: 1 a month, not 15.
    assert.equal(averagePerMonth({ '2026-10-26': 1 }, basisRange({ mode: 'overall' }, '2026-10-27', '2026-10-26')), 1);
    assert.equal(averagePerMonth({ '2026-10-20': 4 }, { from: '2026-10-20', to: '2026-10-22' }), 4);
});

test('a scheme saved before points counts warranties', () => {
    const s = readSettings({ run: 'targets', source: 'warranties' });
    assert.equal(s.measure, 'warranties');
    assert.deepEqual(s.points, { series: [], tiers: [] });
});

test('points: each product is worth its series, a store type multiplies', async () => {
    const { pointsByProduct, tierOf, pointsProblems, roundPoints } = await import('../schemeTargets.js');
    const s = readSettings({
        run: 'targets', source: 'warranties', measure: 'points',
        points: {
            series: [{ id: 'amaze', name: 'Amaze', points: '0.5', products: ['AMAZE', ' amaze+ ', 'AMAZE'] }, { id: 'sig', name: 'Signature', points: 1.25, products: ['D3 (Signature)'] }],
            tiers: [{ id: 'reg', name: 'Regular', times: 1 }, { id: 'bd', name: 'Big Daddy', times: 2 }],
        },
    });
    assert.deepEqual(settingsProblems(s), []);
    assert.deepEqual(s.points.series[0].products, ['AMAZE', 'amaze+']);
    const worth = pointsByProduct(s.points);
    assert.equal(worth.get('amaze+'), 0.5);
    assert.equal(worth.get('d3 (signature)'), 1.25);
    assert.equal(tierOf(s.points, 'bd')?.times, 2);
    assert.equal(tierOf(s.points, undefined)?.name, 'Regular');
    assert.equal(roundPoints(0.1 + 0.2), 0.3);
    assert.match(pointsProblems({ series: [{ id: 'a', name: 'A', points: 1, products: ['X'] }, { id: 'b', name: 'B', points: 2, products: ['x'] }], tiers: [{ id: 't', name: 'R', times: 1 }] })[0], /both A and B/);
    assert.ok(pointsProblems({ series: [], tiers: [] }).length >= 2);
});

test('a monthly target scheme lists its months', () => {
    assert.deepEqual(periodsOf('2026-11-01', '2027-01-31', 'month').map(p => p.key), ['2026-11', '2026-12', '2027-01']);
});
