import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    schemeProblems, schemeState, canSubmit, isEligible, entryProblems, entryScore, standings,
    openWindow, nextWindow, windowSpan, nextMonth, linesScore, clubFor,
    type SchemeField, type RewardRule,
} from '../schemeRules.js';

const QTY: SchemeField = { id: 'qty', label: 'Quantity sold', type: 'number', required: true };
const INV: SchemeField = { id: 'inv', label: 'Invoice photo', type: 'file', required: true, formats: ['image', 'pdf'], max_files: 2, max_mb: 5 };
const PRODUCT: SchemeField = { id: 'prod', label: 'Product', type: 'select', required: false, options: ['D5', 'U-Sports'] };

const scheme = (over: Partial<Parameters<typeof schemeProblems>[0]> = {}) => ({
    title: 'Diwali target', category: 'sales',
    windows: [{ start: '2026-10-05T10:00', end: '2026-10-07T18:00' }, { start: '2026-11-05T10:00', end: '2026-11-07T18:00' }],
    fields: [QTY, INV, PRODUCT], score: { mode: 'sum', field_id: 'qty' } as const,
    rewards: { mode: 'slabs', slabs: [{ min: 25, max: 49, reward: '₹2,000' }, { min: 50, max: null, reward: '₹5,000' }] } as RewardRule,
    eligibility: { mode: 'all' } as const, entries_per_store: 'many',
    ...over,
});

describe('saving a scheme', () => {
    test('a complete scheme has no problems', () => {
        assert.deepEqual(schemeProblems(scheme()), []);
    });
    test('the usual mistakes are named', () => {
        const p = schemeProblems(scheme({
            title: ' ', windows: [{ start: '2026-10-07T18:00', end: '2026-10-05T10:00' }],
            score: { mode: 'sum', field_id: 'inv' },
            rewards: { mode: 'slabs', slabs: [{ min: 10, max: 30, reward: 'A' }, { min: 25, max: null, reward: 'B' }] },
            eligibility: { mode: 'states', states: [] },
        }));
        assert.ok(p.includes('Give the scheme a title'));
        assert.ok(p.includes('A window ends before it starts'));
        assert.ok(p.includes('The score adds up a field that is not a number field'));
        assert.ok(p.includes('Slabs 10+ and 25+ overlap'));
        assert.ok(p.includes('Pick at least one state'));
    });
    test('an upload field needs formats; a dropdown needs options', () => {
        const p = schemeProblems(scheme({
            fields: [QTY, { ...INV, formats: [] }, { ...PRODUCT, options: [] }],
        }));
        assert.ok(p.includes('"Invoice photo": pick at least one file format'));
        assert.ok(p.includes('"Product" needs at least one option'));
    });
    test('a score-based reward needs a score', () => {
        assert.ok(schemeProblems(scheme({ score: { mode: 'none' } })).includes('Slab, per-unit, rank and club rewards need a score'));
        assert.deepEqual(schemeProblems(scheme({ category: 'offer', score: { mode: 'none' }, rewards: { mode: 'none' } })), []);
    });
});

describe('windows: when a scheme runs and takes entries', () => {
    const windows = [{ start: '2026-11-05T10:00', end: '2026-11-07T18:00' }, { start: '2026-10-05T10:00', end: '2026-10-07T18:00' }];
    test('state: upcoming before the first window, live until the last ends', () => {
        assert.equal(schemeState('draft', windows, '2026-10-06T12:00'), 'draft');
        assert.equal(schemeState('published', windows, '2026-10-05T09:59'), 'upcoming');
        assert.equal(schemeState('published', windows, '2026-10-05T10:00'), 'live');
        assert.equal(schemeState('published', windows, '2026-10-20T12:00'), 'live');      // between windows
        assert.equal(schemeState('published', windows, '2026-11-07T18:01'), 'closed');
        assert.equal(schemeState('ended', windows, '2026-10-06T12:00'), 'closed');
    });
    test('entries only while a window is open, to the minute', () => {
        assert.equal(canSubmit('published', windows, '2026-10-05T10:00'), true);
        assert.equal(canSubmit('published', windows, '2026-10-07T18:00'), true);
        assert.equal(canSubmit('published', windows, '2026-10-07T18:01'), false);
        assert.equal(canSubmit('published', windows, '2026-10-20T12:00'), false);
        assert.equal(canSubmit('published', windows, '2026-11-06T09:00'), true);
        assert.equal(canSubmit('ended', windows, '2026-11-06T09:00'), false);
    });
    test('the open and next windows, and the span', () => {
        assert.deepEqual(openWindow(windows, '2026-10-06T12:00'), windows[1]);
        assert.equal(openWindow(windows, '2026-10-20T12:00'), null);
        assert.deepEqual(nextWindow(windows, '2026-10-20T12:00'), windows[0]);
        assert.deepEqual(windowSpan(windows), { starts_on: '2026-10-05', ends_on: '2026-11-07' });
    });
    test('overlapping or missing windows are named', () => {
        assert.ok(schemeProblems(scheme({ windows: [] })).includes('Add at least one window — a start and an end date and time'));
        assert.ok(schemeProblems(scheme({ windows: [{ start: '2026-10-05T10:00', end: '2026-10-08T10:00' }, { start: '2026-10-07T10:00', end: '2026-10-09T10:00' }] })).includes('Two windows overlap'));
    });
    test('repeat monthly keeps the days and times; a short month clamps', () => {
        assert.deepEqual(nextMonth({ start: '2026-10-05T10:00', end: '2026-10-07T18:00' }), { start: '2026-11-05T10:00', end: '2026-11-07T18:00' });
        assert.deepEqual(nextMonth({ start: '2026-12-30T09:00', end: '2026-12-31T21:00' }), { start: '2027-01-30T09:00', end: '2027-01-31T21:00' });
        assert.deepEqual(nextMonth({ start: '2027-01-31T09:00', end: '2027-01-31T21:00' }), { start: '2027-02-28T09:00', end: '2027-02-28T21:00' });
    });
});

describe('scoring by products', () => {
    const products = [{ id: 'p1', name: 'U-Sports', points: 10 }, { id: 'p2', name: 'D5', points: 5 }];
    test('quantity × points, added up', () => {
        const r = linesScore(products, [{ product_id: 'p1', qty: 2 }, { product_id: 'p2', qty: 3 }]);
        assert.equal(r.score, 35);
        assert.deepEqual(r.problems, []);
        assert.deepEqual(r.lines.map(l => l.subtotal), [20, 15]);
    });
    test('an unknown product, a missing quantity, or no lines at all', () => {
        assert.ok(linesScore(products, [{ product_id: 'x', qty: 1 }]).problems.includes('A line names a product this scheme does not have'));
        assert.ok(linesScore(products, [{ product_id: 'p1', qty: 0 }]).problems.includes('Give a quantity for U-Sports'));
        assert.ok(linesScore(products, []).problems.includes('Add at least one product from the invoice'));
    });
    test('the scheme needs named products with points', () => {
        const p = schemeProblems(scheme({ score: { mode: 'products', products: [{ id: 'a', name: 'D5', points: 0 }, { id: 'b', name: 'd5', points: 3 }] } }));
        assert.ok(p.includes('Set the points for "D5"'));
        assert.ok(p.includes('"d5" is listed twice'));
        assert.deepEqual(schemeProblems(scheme({ score: { mode: 'products', products } })), []);
    });
});

describe('who a scheme is for', () => {
    const store = { id: 's1', state: 'UTTAR PRADESH', allowed_brands: 'AF' };
    test('all, by state (spelt any way), or named stores', () => {
        assert.equal(isEligible({ mode: 'all' }, store), true);
        assert.equal(isEligible({ mode: 'states', states: ['Uttar Pradesh'] }, store), true);
        assert.equal(isEligible({ mode: 'states', states: ['Punjab'] }, store), false);
        assert.equal(isEligible({ mode: 'stores', store_ids: ['s1'] }, store), true);
        assert.equal(isEligible({ mode: 'stores', store_ids: ['s2'] }, store), false);
    });
    test('brand: AF stores see AF schemes, AFAC stores see both', () => {
        assert.equal(isEligible({ mode: 'all', brand: 'AC' }, store), false);
        assert.equal(isEligible({ mode: 'all', brand: 'AF' }, store), true);
        assert.equal(isEligible({ mode: 'all', brand: 'AC' }, { ...store, allowed_brands: 'AFAC' }), true);
    });
});

describe('an entry', () => {
    const file = (name: string, size = 1000) => ({ name, url: `/u/${name}`, size, ext: name.split('.').pop()!.toLowerCase() });
    test('a good entry passes', () => {
        assert.deepEqual(entryProblems([QTY, INV, PRODUCT], { qty: '6', prod: 'D5' }, { inv: [file('bill.jpg')] }), []);
    });
    test('missing, wrong format, too many, too big, not a number, not an option', () => {
        const p = entryProblems([QTY, INV, PRODUCT], { qty: 'six', prod: 'X9' },
            { inv: [file('a.mp4'), file('b.jpg', 6 * 1024 * 1024), file('c.png')] });
        assert.ok(p.includes('"Quantity sold" must be a number'));
        assert.ok(p.includes('"Product": pick one of the options'));
        assert.ok(p.some(x => x.startsWith('"a.mp4" is not an allowed format')));
        assert.ok(p.includes('"b.jpg" is over 5 MB'));
        assert.ok(p.includes('"Invoice photo": at most 2 files'));
        assert.ok(entryProblems([QTY, INV], {}, {}).includes('Upload "Invoice photo"'));
    });
    test('the score it would add', () => {
        assert.equal(entryScore({ mode: 'sum', field_id: 'qty' }, { qty: '6' }), 6);
        assert.equal(entryScore({ mode: 'sum', field_id: 'qty' }, { qty: 'x' }), 0);
        assert.equal(entryScore({ mode: 'count' }, {}), 1);
        assert.equal(entryScore({ mode: 'points' }, {}), 0);
    });
});

describe('standings', () => {
    const rows = [
        { store_id: 'a', score: 60, approved: 5 },
        { store_id: 'b', score: 30, approved: 3 },
        { store_id: 'c', score: 30, approved: 2 },
        { store_id: 'd', score: 10, approved: 1 },
        { store_id: 'e', score: 0, approved: 0 },
    ];
    test('ties share a rank; nobody without an approved entry is ranked', () => {
        const s = standings(rows, { mode: 'none' });
        assert.deepEqual(s.map(x => [x.store_id, x.rank]), [['a', 1], ['b', 2], ['c', 2], ['d', 4]]);
    });
    test('slabs: the one reached, none below the first', () => {
        const s = standings(rows, { mode: 'slabs', slabs: [{ min: 25, max: 49, reward: '₹2,000' }, { min: 50, max: null, reward: '₹5,000' }] });
        assert.deepEqual(s.map(x => x.reward), ['₹5,000', '₹2,000', '₹2,000', null]);
    });
    test('per unit, by rank, per approved entry', () => {
        assert.equal(standings(rows, { mode: 'per_unit', amount: 50 })[0].reward, '₹3,000');
        assert.deepEqual(standings(rows, { mode: 'rank', prizes: [{ from: 1, to: 1, reward: 'TV' }, { from: 2, to: 3, reward: 'Watch' }] }).map(x => x.reward),
            ['TV', 'Watch', 'Watch', null]);
        assert.equal(standings(rows, { mode: 'per_entry', reward: 'Gift' })[0].reward, 'Gift × 5');
    });
});

describe('clubs', () => {
    const clubs = [
        { id: 'g', name: 'Gold', min: 300, icon: 'crown', color: 'gold' },
        { id: 'b', name: 'Bronze', min: 0, icon: 'medal', color: 'bronze' },
        { id: 's', name: 'Silver', min: 180, icon: 'award', color: 'silver' },
    ];
    test('the highest club the score reaches', () => {
        assert.equal(clubFor(179, clubs)?.name, 'Bronze');
        assert.equal(clubFor(180, clubs)?.name, 'Silver');
        assert.equal(clubFor(450, clubs)?.name, 'Gold');
        assert.equal(clubFor(50, clubs.filter(c => c.min > 0)), null);
    });
    test('standings carry the club', () => {
        const s = standings([{ store_id: 'a', score: 200, approved: 3 }, { store_id: 'b', score: 20, approved: 1 }], { mode: 'none' }, clubs);
        assert.deepEqual(s.map(x => x.club?.name), ['Silver', 'Bronze']);
    });
    test('clubs need names, distinct starting scores, and a score to count', () => {
        const p = schemeProblems(scheme({ clubs: [{ id: '1', name: 'Silver', min: 180, icon: 'award', color: 'silver' }, { id: '2', name: 'silver', min: 180, icon: 'award', color: 'silver' }] }));
        assert.ok(p.includes('Two clubs are called "silver"'));
        assert.ok(p.includes('Two clubs start at 180'));
        assert.ok(schemeProblems(scheme({ score: { mode: 'none' }, rewards: { mode: 'none' }, clubs })).includes('Clubs need a score'));
        assert.deepEqual(schemeProblems(scheme({ clubs })), []);
    });
});
