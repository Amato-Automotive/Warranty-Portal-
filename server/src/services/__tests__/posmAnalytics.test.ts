import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lastMonths, posmDrill, posmOverview, type ALine, type StoreFacts } from '../posmAnalytics.js';

const TODAY = '2026-11-27';
let n = 0;
const L = (o: Partial<ALine>): ALine => ({
    id: `l${++n}`, source: 'Noida office', store_id: 's1', store_code: 'F1', store_name: 'Store One', item: 'Calendar', qty: 1, status: 'Delivered',
    request_date: null, dispatch_date: '2026-11-10', expected_dispatch: null, reason: null, flags: [], request_id: null, ...o,
});
const stores = new Map<string, StoreFacts>([['s1', { id: 's1', name: 'Store One', code: 'F1', city: 'Pune', state: 'MH', warranties6m: 2 }], ['s2', { id: 's2', name: 'Store Two', code: 'F2', city: null, state: null, warranties6m: 40 }]]);

describe('POSM analytics', () => {
    test('the 12 months run up to this one', () => {
        const m = lastMonths(TODAY);
        assert.equal(m.length, 12);
        assert.deepEqual([m[0], m[11]], ['2025-12', '2026-11']);
    });

    test('tiles, overdue and the risks behind them', () => {
        const lines = [
            L({ item: 'FRP', qty: 3, dispatch_date: '2026-10-01' }),                                                    // s1 over the FRP limit
            L({ source: 'Plant - Ludhiana depot', item: 'FRP', status: 'WIP', dispatch_date: null, request_date: '2026-10-01', expected_dispatch: '2026-11-01' }), // overdue, no reason
            L({ store_id: 's2', item: 'Sample Jacket', qty: 20, dispatch_date: '2026-11-20' }),                         // s2 reached, but sells well
            L({ store_id: null, store_name: 'Unknown', flags: ['qty_not_written'] }),
        ];
        const o = posmOverview(lines, new Map(), stores, [{ status: 'open' }, { status: 'in_production' }], TODAY);
        assert.equal(o.tiles.plant_open, 1);
        assert.equal(o.tiles.plant_overdue, 1);
        assert.equal(o.tiles.stores_over, 1);
        assert.equal(o.tiles.requests_waiting, 1);
        const r = Object.fromEntries(o.risks.map(x => [x.key, x.count]));
        assert.deepEqual([r.over, r.overdue, r.reason, r.reached, r.unlinked, r.qty, r.low_sales], [1, 1, 1, 1, 1, 1, 1]);
        assert.equal(o.risks[0].severity, 'critical');
        assert.deepEqual(o.ageing.find(a => a.bucket === '31-60')?.lines, 1);
    });

    test('high POSM, low sales: FRP sent in 6 months and under 5 warranties; a store selling well is not flagged', () => {
        const lines = [L({ item: 'FRP', qty: 1, dispatch_date: '2026-09-01' }), L({ store_id: 's2', item: 'FRP', qty: 1, dispatch_date: '2026-09-01' })];
        const d = posmDrill({ kind: 'risk', key: 'low_sales' }, lines, new Map(), stores, TODAY);
        assert.deepEqual(d.rows.map((x: any) => x.store), ['Store One']);
    });

    test('turnaround is days from asked to dispatched', () => {
        const lines = [10, 20, 30].map(k => L({ source: 'Plant - Jaipur depot', item: 'FRP', request_date: '2026-10-01', dispatch_date: `2026-10-${String(1 + k).padStart(2, '0')}`, status: 'Dispatched' }));
        const t = posmOverview(lines, new Map(), stores, [], TODAY).turnaround.find(x => x.source === 'Plant - Jaipur depot')!;
        assert.deepEqual([t.lines, t.median, t.p90], [3, 20, 30]);
    });

    test('a month bar drills to the lines sent that month from that source', () => {
        const lines = [L({ dispatch_date: '2026-10-05' }), L({ dispatch_date: '2026-11-05' }), L({ dispatch_date: '2026-10-07', source: 'Plant - Jaipur depot', item: 'FRP' })];
        assert.equal(posmDrill({ kind: 'month', month: '2026-10', source: 'Noida office' }, lines, new Map(), stores, TODAY).rows.length, 1);
    });
});
