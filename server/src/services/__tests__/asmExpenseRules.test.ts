import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateExpenseClaim, decideExpenseClaim, ExpenseRuleError } from '../asmExpenseRules.js';

const TODAY = '2026-10-06';
const rejects = (input: any, pattern: RegExp) =>
    assert.throws(() => validateExpenseClaim(input, TODAY), (e: any) => e instanceof ExpenseRuleError && pattern.test(e.message));

const local = (over: any = {}) => ({
    type: 'local', date: '2026-10-05',
    trips: [{ from: 'Office', to: 'Sector 18 store', amount: '120' }, { from: 'Sector 18', to: 'Office', amount: '99.50' }],
    ...over,
});

const tour = (over: any = {}) => ({
    type: 'tour', startDate: '2026-10-01', endDate: '2026-10-04',
    fromCity: 'Noida', toCity: 'Jaipur', travelMode: 'train', ticketsBy: 'self',
    onwardAmount: '650', returnAmount: '700',
    hotelStay: true, hotelNights: '3', hotelPersons: '1', hotelAmount: '4500',
    others: [{ description: 'Local cab', amount: '300' }],
    ...over,
});

describe('local conveyance', () => {
    test('adds up the trips, needs no bills', () => {
        const c = validateExpenseClaim(local(), TODAY);
        assert.equal(c.total_amount, 219.5);
        assert.equal(c.items.length, 2);
        assert.deepEqual(c.required_bills, []);
        assert.equal(c.start_date, c.end_date);
    });

    test('today and exactly seven days back are allowed', () => {
        validateExpenseClaim(local({ date: TODAY }), TODAY);
        validateExpenseClaim(local({ date: '2026-09-29' }), TODAY);
    });

    test('eight days back is refused', () => rejects(local({ date: '2026-09-28' }), /within 7 days/));
    test('a future date is refused', () => rejects(local({ date: '2026-10-07' }), /future/));
    test('needs at least one trip', () => rejects(local({ trips: [] }), /at least one trip/));
    test('every trip needs from, to and an amount', () => {
        rejects(local({ trips: [{ from: '', to: 'B', amount: '10' }] }), /Trip 1: From/);
        rejects(local({ trips: [{ from: 'A', to: 'B', amount: '0' }] }), /more than ₹0/);
        rejects(local({ trips: [{ from: 'A', to: 'B', amount: '12.345' }] }), /amount in rupees/);
    });
});

describe('outstation tour', () => {
    test('self-booked tickets, hotel and other costs', () => {
        const c = validateExpenseClaim(tour(), TODAY);
        assert.equal(c.total_amount, 650 + 700 + 4500 + 300);
        assert.deepEqual(c.required_bills, ['onward_ticket', 'return_ticket', 'hotel_bill']);
        assert.deepEqual(c.items.map(i => i.kind), ['onward', 'return', 'hotel', 'other']);
    });

    test('company-booked tickets claim no fare and need no ticket', () => {
        const c = validateExpenseClaim(tour({ ticketsBy: 'company', onwardAmount: '', returnAmount: '' }), TODAY);
        assert.deepEqual(c.required_bills, ['hotel_bill']);
        assert.ok(!c.items.some(i => i.kind === 'onward' || i.kind === 'return'));
    });

    test('one way drops the return journey', () => {
        const c = validateExpenseClaim(tour({ oneWay: true, returnAmount: '' }), TODAY);
        assert.deepEqual(c.required_bills, ['onward_ticket', 'hotel_bill']);
    });

    test('own vehicle needs no bill; a cab does', () => {
        assert.deepEqual(validateExpenseClaim(tour({ travelMode: 'own_vehicle', hotelStay: false }), TODAY).required_bills, []);
        assert.deepEqual(
            validateExpenseClaim(tour({ travelMode: 'cab', ticketsBy: undefined, hotelStay: false }), TODAY).required_bills,
            ['onward_ticket', 'return_ticket']
        );
    });

    test('the window is on the return date, so a long tour can still be claimed', () => {
        validateExpenseClaim(tour({ startDate: '2026-09-20', endDate: '2026-10-02', hotelNights: '5' }), TODAY);
        rejects(tour({ startDate: '2026-09-20', endDate: '2026-09-27' }), /within 7 days/);
    });

    test('dates must run forwards', () => rejects(tour({ startDate: '2026-10-05', endDate: '2026-10-03' }), /before the start/));

    test('hotel nights cannot exceed the tour', () => {
        rejects(tour({ hotelNights: '4' }), /between 1 and 3/);
        // A same-day return still allows one night.
        validateExpenseClaim(tour({ startDate: '2026-10-04', endDate: '2026-10-04', hotelNights: '1' }), TODAY);
    });

    test('ticketed modes must say who booked', () => rejects(tour({ ticketsBy: undefined }), /who booked/));
    test('an unknown mode is refused', () => rejects(tour({ travelMode: 'rocket' }), /mode of travel/));

    test('a tour with nothing to claim is refused', () =>
        rejects(tour({ ticketsBy: 'company', hotelStay: false, others: [] }), /Nothing to claim/));
});

test('an unknown claim type is refused', () => rejects({ type: 'other' }, /Local Conveyance or Outstation Tour/));

describe('head office decision', () => {
    const items = [{ id: 'a', amount: 650 }, { id: 'b', amount: 700 }, { id: 'c', amount: 4500 }];
    const decide = (input: any) => decideExpenseClaim(items, input);
    const refuses = (input: any, pattern: RegExp) =>
        assert.throws(() => decide(input), (e: any) => e instanceof ExpenseRuleError && pattern.test(e.message));

    test('approve takes every line in full, reason optional', () => {
        const d = decide({ action: 'approve' });
        assert.equal(d.status, 'approved');
        assert.equal(d.approved_total, 5850);
        assert.equal(d.note, null);
    });

    test('reject approves nothing and needs a reason', () => {
        refuses({ action: 'reject', note: '  ' }, /Reason is required/);
        const d = decide({ action: 'reject', note: 'Duplicate of EXP-0040' });
        assert.equal(d.status, 'rejected');
        assert.equal(d.approved_total, 0);
        assert.deepEqual(d.approved, { a: 0, b: 0, c: 0 });
    });

    test('partial approves line by line, with a reason', () => {
        const d = decide({ action: 'partial', note: 'Hotel capped at 3000', amounts: { a: '650', b: 700, c: '3000.50' } });
        assert.equal(d.status, 'partially_approved');
        assert.equal(d.approved_total, 4350.5);
        assert.equal(d.approved.c, 3000.5);
    });

    test('partial needs a reason and an amount for every line', () => {
        refuses({ action: 'partial', amounts: { a: '1', b: '1', c: '1' } }, /Reason is required/);
        refuses({ action: 'partial', note: 'x', amounts: { a: '1', b: '1' } }, /Line 3/);
    });

    test('partial cannot approve more than was claimed', () =>
        refuses({ action: 'partial', note: 'x', amounts: { a: '651', b: '0', c: '0' } }, /more than was claimed/));

    test('cutting nothing is an approval, cutting everything a rejection', () => {
        refuses({ action: 'partial', note: 'x', amounts: { a: '650', b: '700', c: '4500' } }, /use Approve/);
        refuses({ action: 'partial', note: 'x', amounts: { a: '0', b: '0', c: '0' } }, /use Reject/);
    });

    test('an unknown action is refused', () => refuses({ action: 'maybe' }, /approve, approve part or reject/));
});
