import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LEAD_OPTIONS, readLeadOptions, leadOptionsProblem, addLeadChannels, outcomeAllowed, valueFrom, storeGroupOf } from '../leadOptions.js';

const none = { outcomes: {}, channels: {} };

test('nothing saved yet gives the lists in use today', () => {
    const o = readLeadOptions(null);
    assert.deepEqual(o, DEFAULT_LEAD_OPTIONS);
    assert.equal(o.outcomes.length, 7);
    assert.deepEqual(addLeadChannels(o), ['ivr', 'website', 'whatsapp_manual', 'instagram_dm', 'facebook_dm']);
});

test('a new channel and outcome get a value from their label', () => {
    const o = readLeadOptions({
        outcomes: [...DEFAULT_LEAD_OPTIONS.outcomes, { label: 'Visited store', tone: 'green' }],
        channels: [...DEFAULT_LEAD_OPTIONS.channels, { label: 'Google Ads', tone: 'nope' }],
    });
    assert.equal(o.outcomes.at(-1)!.value, 'visited_store');
    assert.equal(o.outcomes.at(-1)!.store_group, 'noanswer', 'a new outcome counts as No answer until the admin says');
    const g = o.channels.at(-1)!;
    assert.deepEqual(g, { value: 'google_ads', label: 'Google Ads', tone: 'slate', active: true, add_lead: true });
    assert.equal(valueFrom('Walk-in (shop)'), 'walk_in_shop');
    const fromScreen = readLeadOptions({ ...DEFAULT_LEAD_OPTIONS, channels: [...DEFAULT_LEAD_OPTIONS.channels, { value: 'new_1792130000000', label: 'Walk-in' }] });
    assert.equal(fromScreen.channels.at(-1)!.value, 'walk_in', 'a new entry gets its key from its name');
});

test('system channels cannot be removed, hidden or moved into Add Lead', () => {
    const o = readLeadOptions({ outcomes: DEFAULT_LEAD_OPTIONS.outcomes, channels: [
        { value: 'whatsapp', label: 'WA', active: false, add_lead: true },
        { value: 'website', label: 'Website' },
    ] });
    const wa = o.channels.find(c => c.value === 'whatsapp')!;
    assert.equal(wa.label, 'WA', 'renaming is allowed');
    assert.equal(wa.active, true);
    assert.equal(wa.add_lead, false);
    assert.equal(wa.auto_routed, true);
    assert.ok(o.channels.some(c => c.value === 'instagram') && o.channels.some(c => c.value === 'ivr'), 'missing system channels come back');
});

test('a value some lead uses can be hidden, not deleted', () => {
    const prev = readLeadOptions(null);
    const next = readLeadOptions({ ...prev, outcomes: prev.outcomes.filter(o => o.value !== 'follow_up') });
    assert.match(leadOptionsProblem(next, prev, { outcomes: { follow_up: 3 }, channels: {} })!, /"Follow up" is on 3 leads: hide it/);
    assert.equal(leadOptionsProblem(next, prev, none), null, 'unused: deleting is fine');
    const hidden = readLeadOptions({ ...prev, outcomes: prev.outcomes.map(o => o.value === 'follow_up' ? { ...o, active: false } : o) });
    assert.equal(leadOptionsProblem(hidden, prev, { outcomes: { follow_up: 3 }, channels: {} }), null);
    const noSite = readLeadOptions({ ...prev, channels: prev.channels.filter(c => c.value !== 'website') });
    assert.match(leadOptionsProblem(noSite, prev, { outcomes: {}, channels: { website: 16 } })!, /"Website" has 16 leads/);
});

test('at least one outcome shown and one Add Lead channel; no two with one name', () => {
    const prev = readLeadOptions(null);
    assert.match(leadOptionsProblem(readLeadOptions({ ...prev, outcomes: prev.outcomes.map(o => ({ ...o, active: false })) }), prev, none)!, /at least one review outcome/);
    assert.match(leadOptionsProblem(readLeadOptions({ ...prev, channels: prev.channels.map(c => ({ ...c, add_lead: false })) }), prev, none)!, /at least one channel in Add Lead/);
    assert.match(leadOptionsProblem(readLeadOptions({ ...prev, outcomes: [...prev.outcomes, { label: 'closed WON' }] }), prev, none)!, /Two review outcomes are called "closed won"/);
});

test("the store's group: chosen by the admin, the old one by default", () => {
    const o = readLeadOptions({ ...DEFAULT_LEAD_OPTIONS, outcomes: [...DEFAULT_LEAD_OPTIONS.outcomes, { label: 'Visited store', store_group: 'won' }] });
    assert.equal(storeGroupOf(o, 'visited_store'), 'won');
    assert.equal(storeGroupOf(o, 'closed_lost'), 'lost');
    assert.equal(storeGroupOf(o, null), 'pending');
    assert.equal(storeGroupOf(readLeadOptions({ outcomes: [{ value: 'follow_up', label: 'Call again' }], channels: [] }), 'follow_up'), 'follow', 'an older save keeps the old group');
});

test('a hidden outcome can stay on the lead that has it, but not be newly set', () => {
    const o = readLeadOptions({ ...DEFAULT_LEAD_OPTIONS, outcomes: DEFAULT_LEAD_OPTIONS.outcomes.map(x => x.value === 'switched_off' ? { ...x, active: false } : x) });
    assert.equal(outcomeAllowed(o, 'switched_off', 'switched_off'), true);
    assert.equal(outcomeAllowed(o, 'switched_off', 'follow_up'), false);
    assert.equal(outcomeAllowed(o, 'made_up', null), false);
    assert.equal(outcomeAllowed(o, 'closed_won', null), true);
});
