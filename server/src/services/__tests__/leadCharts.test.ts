import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadCharts, TOP_N, type ChartRow } from '../leadCharts.js';

const row = (over: Partial<ChartRow> = {}): ChartRow => ({
    ist_day: '2026-09-30', source: 'ivr', product: null, state: null, asm_id: null, asm_name: null,
    review_status: null, forward_kinds: [], stores: [], ...over,
});

describe('buildLeadCharts', () => {
    test('days are split by channel, oldest first; unknown channels are "other"', () => {
        const c = buildLeadCharts([
            row({ ist_day: '2026-09-30', source: 'whatsapp' }),
            row({ ist_day: '2026-09-29', source: 'ivr' }),
            row({ ist_day: '2026-09-30', source: 'ivr' }),
            row({ ist_day: '2026-09-30', source: 'manual' }),
        ]);
        assert.equal(c.total, 4);
        assert.deepEqual(c.by_day.map(d => d.day), ['2026-09-29', '2026-09-30']);
        assert.deepEqual(c.by_day[1], { day: '2026-09-30', whatsapp: 1, instagram: 0, ivr: 1, website: 0, whatsapp_manual: 0, instagram_dm: 0, facebook_dm: 0, other: 1 });
    });

    test('products always list all three plus "not given"', () => {
        const c = buildLeadCharts([row({ product: 'Mats' }), row({ product: 'PPF' }), row({})]);
        assert.deepEqual(c.product.map(p => [p.key, p.count]), [['Seat Covers', 0], ['Mats', 1], ['Accessories', 0], ['none', 2]]);
    });

    test('where it went: each kind once per lead, and "none" when nobody', () => {
        const c = buildLeadCharts([
            row({ forward_kinds: ['store', 'store'] }),
            row({ forward_kinds: ['asm'] }),
            row({ forward_kinds: [] }),
        ]);
        const got = Object.fromEntries(c.went_to.map(w => [w.key, w.count]));
        assert.deepEqual(got, { store: 1, asm: 1, distributor: 0, support: 0, none: 1 });
    });

    test('states: the top ones, then Others, then Not known', () => {
        const rows = Array.from({ length: TOP_N + 2 }, (_, i) => row({ state: `State ${i}` }));
        rows.push(row({ state: 'State 0' }), row({ state: null }));
        const c = buildLeadCharts(rows);
        assert.equal(c.states[0].label, 'State 0');
        assert.equal(c.states[0].count, 2);
        assert.equal(c.states.length, TOP_N + 2);
        assert.deepEqual(c.states.at(-2), { key: '__others', label: 'Others', count: 2 });
        assert.deepEqual(c.states.at(-1), { key: 'none', label: 'Not known', count: 1 });
    });

    test('ASMs and stores are counted by id, named by name', () => {
        const c = buildLeadCharts([
            row({ asm_id: 'a1', asm_name: 'Atul', stores: [{ id: 's1', name: 'Car Studio' }] }),
            row({ asm_id: 'a1', asm_name: 'Atul', stores: [{ id: 's1', name: 'Car Studio' }, { id: 's2', name: 'Auto World' }] }),
        ]);
        assert.deepEqual(c.asms, [{ key: 'a1', label: 'Atul', count: 2 }]);
        assert.deepEqual(c.stores.map(s => [s.key, s.count]), [['s1', 2], ['s2', 1]]);
    });

    test('review: pending first, every outcome listed', () => {
        const c = buildLeadCharts([row({ review_status: 'follow_up' }), row({}), row({ review_status: 'odd' })]);
        assert.equal(c.review[0].key, 'pending');
        assert.equal(c.review[0].count, 2);
        assert.equal(c.review.find(r => r.key === 'follow_up')?.count, 1);
        assert.equal(c.review.length, 8);
    });
});
