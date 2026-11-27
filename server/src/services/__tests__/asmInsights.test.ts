import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { asmAlerts, posmByStore, type AlertInput, type PLine } from '../asmInsights.js';

const TODAY = '2026-11-27';
let n = 0;
const L = (o: Partial<PLine>): PLine => ({ id: `l${++n}`, store_id: 's1', source: 'Noida office', item: 'Calendar', qty: 1, status: 'Delivered', request_date: null, dispatch_date: '2026-10-01', expected_dispatch: null, reason: null, ...o });

describe('ASM: POSM by store', () => {
    test('sent, limits, plant still owing, overdue and the low-sales check', () => {
        const lines = [
            L({ item: 'FRP', qty: 3, dispatch_date: '2026-09-01' }),
            L({ source: 'Plant - Ludhiana depot', item: 'Sample Jacket', qty: 10, status: 'WIP', dispatch_date: null, expected_dispatch: '2026-11-01' }),
            L({ store_id: 's2', item: 'FRP', qty: 1, dispatch_date: '2026-09-01' }),
        ];
        const [a, b] = posmByStore(['s1', 's2'], lines, new Map(), new Map([['s1', 2], ['s2', 30]]), TODAY);
        assert.deepEqual([a.frp.sent, a.approval, a.plant_open, a.overdue, a.items_sent], [3, 'over', 1, 1, 3]);
        assert.deepEqual(a.low_sales, { frp: 3, jackets: 0, warranties: 2 });
        assert.equal(b.low_sales, null);
    });
});

describe('ASM: alerts', () => {
    const base = (o: Partial<AlertInput> = {}): AlertInput => ({
        today: TODAY, programLive: true, posm: [], sellMore: [], buyMore: [],
        stores: [
            { store_id: 's1', store_name: 'Quiet', city: 'Pune', live: true, pending_approval: false, is_franchise: true, last_warranty: '2026-10-01', rejected_30d: 0 },
            { store_id: 's2', store_name: 'Busy', city: null, live: true, pending_approval: false, is_franchise: true, last_warranty: '2026-11-26', rejected_30d: 2 },
            { store_id: 's3', store_name: 'New', city: null, live: false, pending_approval: true, is_franchise: true, last_warranty: null, rejected_30d: 0 },
        ],
        ...o,
    });
    const get = (a: ReturnType<typeof asmAlerts>, k: string) => a.find(x => x.key === k)!.stores.map(s => s.store_name);

    test('quiet stores, rejections, waiting approval; a store that has not gone live is not "quiet"', () => {
        const a = asmAlerts(base());
        assert.deepEqual(get(a, 'quiet'), ['Quiet']);
        assert.deepEqual(get(a, 'rejected'), ['Busy']);
        assert.deepEqual(get(a, 'pending_approval'), ['New']);
        assert.deepEqual(get(a, 'never'), []);
    });

    test('program: stores not joined, and rewards ready; nothing about joining while the program is not live', () => {
        const a = asmAlerts(base({ sellMore: [{ store_id: 's1', due_sets: 2, target: 12, points: 20 }], buyMore: [{ store_id: 's2', ready: true, requests: 1, waiting_sets: 0 }] }));
        assert.deepEqual(get(a, 'not_in_program'), []);
        assert.deepEqual(a.find(x => x.key === 'reward_ready')!.stores.map(s => s.detail), ['Sell More: 2 sets']);
        assert.deepEqual(get(asmAlerts(base({ programLive: false })), 'not_in_program'), []);
        assert.deepEqual(get(asmAlerts(base()), 'not_in_program'), ['Quiet', 'Busy']);
    });

    test('critical first', () => {
        assert.equal(asmAlerts(base())[0].severity, 'critical');
    });
});
