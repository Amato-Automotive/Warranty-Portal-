import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    quarterOf, parseQuarter, shiftQuarter, validateBudget, summariseBudget, claimBudgetPosition,
    BudgetRuleError, type BudgetClaim,
} from '../asmExpenseBudget.js';

const Q3 = parseQuarter('2026-Q3')!;
const BUDGET = { total: 90000, local_monthly: 8000 };

const claim = (type: 'local' | 'tour', start_date: string, status: string, total: number, approved: number | null = null, id = `${type}-${start_date}-${total}`): BudgetClaim & { id: string } =>
    ({ id, type, start_date, status, total_amount: total, approved_amount: approved });

describe('quarters follow the financial year', () => {
    test('each quarter covers the right months', () => {
        assert.deepEqual(parseQuarter('2026-Q1')!.months.map(m => m.key), ['2026-04', '2026-05', '2026-06']);
        assert.deepEqual(parseQuarter('2026-Q2')!.months.map(m => m.key), ['2026-07', '2026-08', '2026-09']);
        assert.deepEqual(Q3.months.map(m => m.key), ['2026-10', '2026-11', '2026-12']);
        assert.deepEqual(parseQuarter('2026-Q4')!.months.map(m => m.key), ['2027-01', '2027-02', '2027-03']);
    });

    test('labels read as the business writes them', () => {
        assert.equal(parseQuarter('2026-Q2')!.label, 'Q2 26-27');
        assert.equal(Q3.span, 'Oct – Dec 2026');
        assert.equal(parseQuarter('2026-Q4')!.span, 'Jan – Mar 2027');
        assert.equal(parseQuarter('2099-Q4')!.label, 'Q4 99-00');
    });

    test('a date finds its quarter, January–March in the previous FY', () => {
        assert.equal(quarterOf('2026-10-26').key, '2026-Q3');
        assert.equal(quarterOf('2026-04-01').key, '2026-Q1');
        assert.equal(quarterOf('2026-03-31').key, '2025-Q4');
        assert.equal(quarterOf('2027-02-14').key, '2026-Q4');
    });

    test('start and end dates, including a leap February', () => {
        assert.equal(Q3.start, '2026-10-01');
        assert.equal(Q3.end, '2026-12-31');
        assert.equal(parseQuarter('2026-Q2')!.end, '2026-09-30');
        assert.equal(parseQuarter('2027-Q4')!.end, '2028-03-31');
    });

    test('shifting crosses financial years', () => {
        assert.equal(shiftQuarter(Q3, 1).key, '2026-Q4');
        assert.equal(shiftQuarter(Q3, 2).key, '2027-Q1');
        assert.equal(shiftQuarter(Q3, -3).key, '2025-Q4');
    });

    test('anything else is not a quarter', () => {
        for (const k of ['2026-Q5', '2026-Q0', '26-Q3', '2026Q3', '', null, undefined, '2026-Q3; DROP']) {
            assert.equal(parseQuarter(k), null, String(k));
        }
    });
});

describe('setting a budget', () => {
    const rejects = (input: any, pattern: RegExp) =>
        assert.throws(() => validateBudget(input), (e: any) => e instanceof BudgetRuleError && pattern.test(e.message));

    test('total and local per month', () => {
        assert.deepEqual(validateBudget({ total: '90000', local_monthly: '8000' }), BUDGET);
        assert.deepEqual(validateBudget({ total: '90,000', local_monthly: 0 }), { total: 90000, local_monthly: 0 });
    });

    test('local for the quarter may use the whole total, not more', () => {
        assert.deepEqual(validateBudget({ total: 24000, local_monthly: 8000 }), { total: 24000, local_monthly: 8000 });
        rejects({ total: 20000, local_monthly: 8000 }, /3 × ₹8,000 = ₹24,000.*₹20,000/);
    });

    test('refuses a missing, zero or nonsense amount', () => {
        rejects({ total: '', local_monthly: 8000 }, /Total budget/);
        rejects({ total: 0, local_monthly: 0 }, /more than ₹0/);
        rejects({ total: '-5', local_monthly: 0 }, /Total budget/);
        rejects({ total: 90000, local_monthly: 'abc' }, /Local conveyance/);
        rejects({ total: 1e9, local_monthly: 0 }, /please check/);
    });
});

describe('the quarter summary', () => {
    test("the owner's example: ₹90K total, ₹8K local a month", () => {
        const s = summariseBudget(BUDGET, [], Q3, '2026-10-05');
        assert.equal(s.set, true);
        assert.equal(s.local_quarter, 24000);
        assert.equal(s.tour.allocated, 66000);
        assert.equal(s.remaining, 90000);
        assert.deepEqual(s.months.map(m => [m.label, m.allocated, m.state]), [['Oct', 8000, 'current'], ['Nov', 8000, 'future'], ['Dec', 8000, 'future']]);
    });

    test('only approved amounts are used; submitted ones wait; rejected count for nothing', () => {
        const s = summariseBudget(BUDGET, [
            claim('local', '2026-10-03', 'approved', 1200, 1200),
            claim('local', '2026-10-04', 'partially_approved', 1000, 600),
            claim('local', '2026-10-05', 'submitted', 500),
            claim('local', '2026-10-06', 'rejected', 900, 0),
            claim('tour', '2026-10-10', 'paid', 20000, 18000),
            claim('tour', '2026-10-12', 'submitted', 7000),
        ], Q3, '2026-10-20');
        assert.deepEqual([s.months[0].used, s.months[0].pending, s.months[0].left], [1800, 500, 6200]);
        assert.deepEqual([s.tour.used, s.tour.pending, s.tour.left], [18000, 7000, 48000]);
        assert.equal(s.used, 19800);
        assert.equal(s.pending, 7500);
        assert.equal(s.remaining, 48000 + 6200 + 8000 + 8000);
    });

    test("a month's unused local lapses when it ends, so remaining falls even unspent", () => {
        const claims = [claim('local', '2026-10-03', 'approved', 5000, 5000)];
        const inOct = summariseBudget(BUDGET, claims, Q3, '2026-10-31');
        const inNov = summariseBudget(BUDGET, claims, Q3, '2026-11-01');
        assert.equal(inOct.remaining, 66000 + 3000 + 16000);
        assert.equal(inNov.lapsed, 3000);
        assert.equal(inNov.months[0].state, 'past');
        assert.equal(inNov.remaining, 66000 + 16000);
    });

    test('going over on local does not eat into tours', () => {
        const s = summariseBudget(BUDGET, [claim('local', '2026-10-03', 'approved', 11000, 11000)], Q3, '2026-10-20');
        assert.deepEqual([s.months[0].left, s.months[0].over], [0, 3000]);
        assert.equal(s.tour.left, 66000);
        assert.equal(s.over, 3000);
        assert.equal(s.remaining, 66000 + 16000);
    });

    test('claims count by travel date, and only the quarter’s', () => {
        const s = summariseBudget(BUDGET, [
            claim('tour', '2026-09-28', 'approved', 9000, 9000),   // Q2
            claim('tour', '2026-12-30', 'approved', 4000, 4000),   // Q3, though it ends in January
            claim('local', '2026-11-02', 'approved', 700, 700),
        ], Q3, '2026-11-10');
        assert.equal(s.tour.used, 4000);
        assert.deepEqual(s.months.map(m => m.used), [0, 700, 0]);
    });

    test('a past quarter has every month ended; a future one none', () => {
        const past = summariseBudget(BUDGET, [], parseQuarter('2026-Q2')!, '2026-10-26');
        assert.ok(past.months.every(m => m.state === 'past'));
        assert.equal(past.remaining, 0);
        assert.equal(past.lapsed, 90000);
        const next = summariseBudget(BUDGET, [], parseQuarter('2026-Q4')!, '2026-10-26');
        assert.ok(next.months.every(m => m.state === 'future'));
        assert.equal(next.remaining, 90000);
    });

    test('no budget set: everything is zero, and it says so', () => {
        const s = summariseBudget(null, [claim('tour', '2026-10-10', 'approved', 5000, 5000)], Q3, '2026-10-20');
        assert.equal(s.set, false);
        assert.equal(s.remaining, 0);
        assert.equal(s.tour.used, 5000);
    });

    test('paise stay exact', () => {
        const s = summariseBudget({ total: 1000, local_monthly: 100.1 }, [
            claim('local', '2026-10-01', 'approved', 0.1, 0.1),
            claim('local', '2026-10-02', 'approved', 0.2, 0.2),
        ], Q3, '2026-10-20');
        assert.equal(s.months[0].used, 0.3);
        assert.equal(s.months[0].left, 99.8);
        assert.equal(s.tour.allocated, 699.7);
    });
});

describe("a claim's place in the budget, for HR", () => {
    const claims = [
        claim('local', '2026-10-03', 'approved', 6000, 6000, 'a'),
        claim('local', '2026-11-03', 'approved', 7000, 7000, 'b'),
        claim('tour', '2026-10-10', 'approved', 60000, 60000, 'c'),
    ];

    test('a submitted local claim that takes its month over', () => {
        const c = claim('local', '2026-10-20', 'submitted', 3000, null, 'x');
        assert.deepEqual(claimBudgetPosition(BUDGET, [...claims, c], c), {
            pool: 'local', label: 'Oct local', allocated: 8000, used_by_others: 6000, this_claim: 3000, over: 1000,
        });
    });

    test('a tour that fits', () => {
        const c = claim('tour', '2026-11-15', 'submitted', 5000, null, 'y');
        const p = claimBudgetPosition(BUDGET, [...claims, c], c)!;
        assert.deepEqual([p.label, p.allocated, p.used_by_others, p.over], ['Q3 26-27 tours', 66000, 60000, 0]);
    });

    test('a decided claim counts at its approved amount, never twice', () => {
        const p = claimBudgetPosition(BUDGET, claims, claims[2])!;
        assert.deepEqual([p.used_by_others, p.this_claim, p.over], [0, 60000, 0]);
    });

    test('nothing to show without a budget', () => {
        assert.equal(claimBudgetPosition(null, claims, claims[0]), null);
    });
});
