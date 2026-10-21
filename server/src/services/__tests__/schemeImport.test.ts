import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    standings, schemeProblems, monthlyPoints, readDate, findProduct, planImport, productForWarranty, sellThrough,
    type RewardRule,
} from '../schemeRules.js';

/* The July 2026 – March 2027 Reward Point Program, as the poster sets it. */
const PRODUCTS = [
    { id: 'p_amaze', name: 'Amaze Series', points: 0.5 },
    { id: 'p_sportz', name: 'Sportz Series', points: 2 },
    { id: 'p_doble', name: 'Doble Series', points: 2.5 },
    { id: 'p_sig', name: 'Signature Series', points: 3.5 },
    { id: 'p_emp', name: 'Emporio Series', points: 3.5 },
    { id: 'p_uarrow', name: 'U Max Arrow', points: 1 },
    { id: 'p_uprem', name: 'U Max Premium', points: 2.5 },
];
const CLUBS = [
    { id: 's', name: 'Silver Club', min: 180, icon: 'shield', color: 'silver', reward: '4 sets Signature 2 Row' },
    { id: 'g', name: 'Gold Club', min: 270, icon: 'shield-check', color: 'gold', reward: '7 sets Signature 2 Row' },
    { id: 'p', name: 'Platinum Club', min: 360, icon: 'diamond', color: 'platinum', reward: '12 sets Signature 2 Row' },
    { id: 'd', name: 'Diamond Club', min: 540, icon: 'crown', color: 'violet', reward: '20 sets Signature 2 Row' },
    { id: 'l', name: 'Legend Club', min: 720, icon: 'star', color: 'gold', reward: '30 sets Signature 2 Row' },
];

describe('club rewards', () => {
    test('each store earns its club\'s reward; below Silver earns nothing', () => {
        const s = standings([
            { store_id: 'a', score: 725, approved: 9 },
            { store_id: 'b', score: 300, approved: 5 },
            { store_id: 'c', score: 179.5, approved: 4 },
        ], { mode: 'clubs' }, CLUBS);
        assert.deepEqual(s.map(x => [x.club?.name ?? null, x.reward]), [
            ['Legend Club', '30 sets Signature 2 Row'],
            ['Gold Club', '7 sets Signature 2 Row'],
            [null, null],
        ]);
    });
    test('club rewards need clubs, each with a reward', () => {
        const base = {
            title: 'Reward Point Program', category: 'sales', fields: [],
            windows: [{ start: '2026-10-14T00:00', end: '2026-10-14T23:59' }],
            score: { mode: 'products' as const, products: PRODUCTS }, rewards: { mode: 'clubs' } as RewardRule,
            eligibility: { mode: 'all' as const },
        };
        assert.deepEqual(schemeProblems({ ...base, clubs: CLUBS }), []);
        assert.ok(schemeProblems({ ...base, clubs: [] }).includes('Add the clubs whose rewards stores earn'));
        assert.ok(schemeProblems({ ...base, clubs: [{ ...CLUBS[0], reward: '' }] }).includes('Set the reward for Silver Club'));
    });
});

describe('points by month', () => {
    test('approved points per IST month', () => {
        const m = monthlyPoints([
            { created_at: '2026-07-15T06:00:00Z', score: 40, status: 'approved' },
            { created_at: '2026-07-15T19:00:00Z', score: 5, status: 'approved' },    // 16 Jul 00:30 IST — still July
            { created_at: '2026-07-31T19:00:00Z', score: 7, status: 'approved' },    // 1 Aug 00:30 IST
            { created_at: '2026-08-12T06:00:00Z', score: 9, status: 'rejected' },
        ]);
        assert.deepEqual(m, [{ month: '2026-07', points: 45 }, { month: '2026-08', points: 7 }]);
    });
});

describe('reading a sheet', () => {
    test('dates in every way people type them', () => {
        for (const [v, want] of [
            ['2026-07-15', '2026-07-15'], ['15-07-2026', '2026-07-15'], ['15/7/2026', '2026-07-15'],
            ['15.07.26', '2026-07-15'], ['15 Jul 2026', '2026-07-15'], ['15th July 2026', '2026-07-15'],
            [46218, '2026-07-15'],
        ] as const) assert.equal(readDate(v), want, String(v));
        for (const v of ['31-02-2026', 'tomorrow', '', null]) assert.equal(readDate(v), null, String(v));
    });
    test('a series by its name, with or without "Series"', () => {
        assert.equal(findProduct('Amaze Series', PRODUCTS)?.id, 'p_amaze');
        assert.equal(findProduct('amaze', PRODUCTS)?.id, 'p_amaze');
        assert.equal(findProduct('  SIGNATURE ', PRODUCTS)?.id, 'p_sig');
        assert.equal(findProduct('u max premium', PRODUCTS)?.id, 'p_uprem');
        assert.equal(findProduct('Sportz Pro', PRODUCTS), null);
    });
});

describe('planning an import', () => {
    const stores = [
        { id: 's1', code: 'AF-101', name: 'Car Studio' },
        { id: 's2', code: 'AF-102', name: 'Auto World' },
        { id: 's3', code: 'AF-103', name: 'Auto World' },
    ];
    test('rows of one store, day and invoice make one entry, quantities added', () => {
        const { entries, problems } = planImport([
            { row: 2, store: 'AF-101', date: '15-07-2026', product: 'Amaze', qty: 10, invoice: 'INV-9' },
            { row: 3, store: 'af-101', date: '2026-07-15', product: 'Signature Series', qty: 4, invoice: 'INV-9' },
            { row: 4, store: 'Car Studio', date: '15/07/2026', product: 'amaze series', qty: 2, invoice: 'INV-9' },
            { row: 5, store: 'AF-101', date: '12-08-2026', product: 'Doble', qty: 3 },
        ], stores, PRODUCTS);
        assert.deepEqual(problems, []);
        assert.equal(entries.length, 2);
        assert.deepEqual(entries[0], {
            store_id: 's1', day: '2026-07-15', invoice: 'INV-9',
            lines: [{ product_id: 'p_amaze', qty: 12 }, { product_id: 'p_sig', qty: 4 }], rows: [2, 3, 4],
        });
    });
    test('every unusable row is named', () => {
        const { entries, problems } = planImport([
            { row: 2, store: 'XX-1', date: '15-07-2026', product: 'Amaze', qty: 1 },
            { row: 3, store: 'Auto World', date: '15-07-2026', product: 'Amaze', qty: 1 },
            { row: 4, store: 'AF-101', date: '31-02-2026', product: 'Amaze', qty: 1 },
            { row: 5, store: 'AF-101', date: '15-07-2026', product: 'Mats', qty: 1 },
            { row: 6, store: 'AF-101', date: '15-07-2026', product: 'Amaze', qty: 0 },
        ], stores, PRODUCTS);
        assert.equal(entries.length, 0);
        assert.deepEqual(problems.map(p => p.row), [2, 3, 4, 5, 6]);
        assert.match(problems[1].message, /2 stores — use the store code/);
    });
});

describe('sell-through', () => {
    test('a warranty product belongs to its series', () => {
        assert.equal(productForWarranty('AMAZE', PRODUCTS)?.id, 'p_amaze');
        assert.equal(productForWarranty('AMAZE DUO', PRODUCTS)?.id, 'p_amaze');
        assert.equal(productForWarranty('U MAX PREMIUM', PRODUCTS)?.id, 'p_uprem');
        assert.equal(productForWarranty('HUNK PERFO', PRODUCTS), null);
    });
    test('bought against sold, per month', () => {
        const r = sellThrough(
            [{ month: '2026-07', product_id: 'p_amaze', qty: 10 }, { month: '2026-07', product_id: 'p_sig', qty: 10 }],
            [{ month: '2026-07', product: 'AMAZE DUO', count: 12 }, { month: '2026-07', product: 'SIGNATURE', count: 6 },
             { month: '2026-07', product: 'HUNK PERFO', count: 50 }, { month: '2026-08', product: 'AMAZE', count: 3 }],
            PRODUCTS,
        );
        assert.deepEqual(r, [
            { month: '2026-07', bought: 20, sold: 18, pct: 90 },
            { month: '2026-08', bought: 0, sold: 3, pct: null },
        ]);
    });
});
