import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { repeatInfo, compareLeads, firstLeadCampaign, type RepeatLead } from '../leadRepeat.js';

const lead = (id: string, at: string, over: Partial<RepeatLead> = {}): RepeatLead => ({
    id, created_at: at, source: 'whatsapp', product: 'Seat Covers', car_model: 'Hyundai Creta',
    customer_name: 'Ravi Kumar', phone_key: '9876543210', pincode: '110001', ...over,
});

describe('repeatInfo', () => {
    test('a first lead is not a repeat; the second points back to it', () => {
        const info = repeatInfo([lead('b', '2026-11-10T10:30:00Z'), lead('a', '2026-11-10T10:00:00Z')]);
        assert.equal(info.has('a'), false);
        const b = info.get('b')!;
        assert.equal(b.nth, 2); assert.equal(b.total, 2); assert.equal(b.prev.id, 'a');
        assert.equal(b.gap_hours, 0.5); assert.equal(b.reason, 'same'); assert.deepEqual(b.changed, []);
    });
    test('different numbers are different customers', () => {
        const info = repeatInfo([lead('a', '2026-11-10T10:00:00Z'), lead('b', '2026-11-10T10:05:00Z', { phone_key: '9876543211' })]);
        assert.equal(info.size, 0);
    });
    test('the same details after more than three days: came back', () => {
        const info = repeatInfo([lead('a', '2026-10-01T10:00:00Z'), lead('b', '2026-10-20T10:00:00Z')]);
        assert.equal(info.get('b')!.reason, 'came-back');
    });
    test('a reply to a campaign within 48 h, whatever changed', () => {
        const info = repeatInfo(
            [lead('a', '2026-10-15T10:00:00Z', { source: 'instagram' }), lead('b', '2026-11-17T06:46:00Z', { pincode: '635109' })],
            new Map([['9876543210', [{ phone: '9876543210', at: '2026-11-17T06:45:27Z', name: 'instagram_campaign_audit_leads_october_inorganic' }]]]),
        );
        const b = info.get('b')!;
        assert.equal(b.reason, 'campaign');
        assert.equal(b.campaign?.follow_up, true);
        assert.deepEqual(b.changed.map(c => c.field), ['pincode', 'channel']);
    });
    test('a campaign older than 48 h does not count', () => {
        const info = repeatInfo(
            [lead('a', '2026-10-01T10:00:00Z'), lead('b', '2026-10-10T10:00:00Z')],
            new Map([['9876543210', [{ phone: '9876543210', at: '2026-10-07T10:00:00Z', name: 'Diwali_Campaign_Customer' }]]]),
        );
        assert.equal(info.get('b')!.campaign, null);
    });
});

describe('compareLeads', () => {
    const a = lead('a', '2026-11-10T10:00:00Z');
    test('the same car written differently is not a change', () => {
        assert.deepEqual(compareLeads(a, { ...a, car_model: 'creta (2025)' }), []);
        assert.deepEqual(compareLeads(a, { ...a, car_model: null }), []);
    });
    test('a hand-added WhatsApp lead is the same channel', () => {
        assert.deepEqual(compareLeads(a, { ...a, source: 'whatsapp_manual' }), []);
    });
    test('each real change is named, from → to', () => {
        const ch = compareLeads(a, { ...a, product: 'Mats', car_model: 'Tata Nexon', pincode: '122018', customer_name: 'Sunita', source: 'ivr' });
        assert.deepEqual(ch.map(c => c.field), ['product', 'vehicle', 'pincode', 'name', 'channel']);
        assert.deepEqual(ch[0], { field: 'product', from: 'Seat Covers', to: 'Mats' });
    });
});

describe('firstLeadCampaign', () => {
    test('a first lead that answered a campaign is tagged, with no previous lead', () => {
        const f = firstLeadCampaign(lead('a', '2026-11-17T06:46:00Z'),
            [{ phone: '9876543210', at: '2026-11-17T06:45:27Z', name: 'instagram_campaign_audit_leads_october_inorganic' }])!;
        assert.equal(f.nth, 1); assert.equal(f.prev, null); assert.equal(f.reason, 'campaign');
    });
    test('no campaign in the 48 h before: not tagged', () => {
        assert.equal(firstLeadCampaign(lead('a', '2026-11-17T06:46:00Z'), []), null);
        assert.equal(firstLeadCampaign(lead('a', '2026-11-17T06:46:00Z'),
            [{ phone: '9876543210', at: '2026-11-10T06:45:27Z', name: 'x_audit' }]), null);
    });
});
