import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isStoresLead, storeLeadView, type StoreLeadRow } from '../storeLeads.js';

const STORE = '73d0d048-f038-4384-8c23-8723b8b40914';
const OTHER = '47d0ba03-1f9b-4626-b6a2-0f49751ab57a';

const row = (over: Partial<StoreLeadRow> = {}): StoreLeadRow => ({
    id: 'lead-1', created_ist: '2026-09-30 14:05', customer_name: 'Ravi K', customer_phone: '9876543210',
    product: 'Seat Covers', car_model: 'Hyundai Creta', raw_area: '201301', state: 'Uttar Pradesh',
    store_id: null, store_sent_by: null, review_status: null, reviewed_at: null, raw_payload: {},
    ...over,
});

describe('which leads a store sees', () => {
    test('a store the customer picked on WhatsApp (alert recorded)', () => {
        const r = row({ raw_payload: { locator: { notified: [`store:${STORE}`] } } });
        assert.equal(isStoresLead(r, STORE), true);
        assert.equal(isStoresLead(r, OTHER), false);
    });

    test('a customer who picked two stores: both see it', () => {
        const r = row({ store_id: OTHER, store_sent_by: 'customer', raw_payload: JSON.stringify({ locator: { notified: [`store:${STORE}`, `store:${OTHER}`] } }) });
        assert.equal(isStoresLead(r, STORE), true);
        assert.equal(isStoresLead(r, OTHER), true);
    });

    test('a store the team sent from Lead Management', () => {
        assert.equal(isStoresLead(row({ store_id: STORE, store_sent_by: 'admin-uuid' }), STORE), true);
    });

    test('only suggested, never sent: not the store\'s', () => {
        const r = row({ raw_payload: { locator: { options: [{ id: STORE, name: 'x' }] } } });
        assert.equal(isStoresLead(r, STORE), false);
        assert.equal(storeLeadView(r, STORE), null);
    });
});

describe('what the store sees about a lead', () => {
    test('how it came: the customer\'s pick, or sent by Autoform', () => {
        const picked = storeLeadView(row({ store_id: STORE, store_sent_by: 'customer', raw_payload: { locator: { notified: [`store:${STORE}`] } } }), STORE);
        assert.equal(picked?.via, 'customer');
        const sent = storeLeadView(row({ store_id: STORE, store_sent_by: 'admin-uuid' }), STORE);
        assert.equal(sent?.via, 'autoform');
        // The customer later picked another store: this one was still their pick.
        const earlier = storeLeadView(row({ store_id: OTHER, store_sent_by: 'customer', raw_payload: { locator: { notified: [`store:${STORE}`, `store:${OTHER}`] } } }), STORE);
        assert.equal(earlier?.via, 'customer');
    });

    test('the auditor\'s status, never the reason or notes; unreviewed is pending', () => {
        const v = storeLeadView(row({ store_id: STORE, store_sent_by: 'a', review_status: 'closed_won', reviewed_at: '2026-10-01T05:00:00Z' }), STORE)!;
        assert.equal(v.status, 'closed_won');
        assert.equal(v.status_at, '2026-10-01T05:00:00Z');
        assert.equal('review_reason' in v, false);
        assert.equal('internal_notes' in v, false);
        const p = storeLeadView(row({ store_id: STORE, store_sent_by: 'a', review_status: null, reviewed_at: '2026-10-01T05:00:00Z' }), STORE)!;
        assert.deepEqual([p.status, p.status_at], ['pending', null]);
    });

    test('the pincode comes from the payload or the area', () => {
        assert.equal(storeLeadView(row({ store_id: STORE, store_sent_by: 'a', raw_area: '201301' }), STORE)?.pincode, '201301');
        assert.equal(storeLeadView(row({ store_id: STORE, store_sent_by: 'a', raw_area: 'Noida', raw_payload: { pincode: '201304' } }), STORE)?.pincode, '201304');
    });
});
