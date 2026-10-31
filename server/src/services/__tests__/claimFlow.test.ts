import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyClaimAction, actionsFor, coverage, warrantyYears, problemsFor, kindOf, readVehicle, readProblem, waitingOn,
    type FlowClaim, type Who,
} from '../claimFlow.js';

const claim = (p: Partial<FlowClaim> = {}): FlowClaim => ({
    kind: 'warranty', product_type: 'seat-cover', status: 'verify', problem: 'stitch_issue', description: null,
    vehicle: { make: 'Hyundai', model: 'Creta', airbags: 'with', major_colour: 'Black', minor_colour: 'Red' },
    verification: null, hold: null, decision: null, consent: null, plan: null, dispatch: null, fitted: null, ...p,
});
const ok = (r: ReturnType<typeof applyClaimAction>) => { if ('error' in r) throw new Error(r.error); return r.claim; };
const err = (r: ReturnType<typeof applyClaimAction>) => ('error' in r ? r.error : 'no error');

const store: Who = { actor: 'vendor' };
const customer: Who = { actor: 'customer' };
const anuka: Who = { actor: 'admin', rights: ['decide', 'plan', 'dispatch', 'edit'] };
const viewer: Who = { actor: 'admin', rights: [] };

const verified = () => ok(applyClaimAction(claim(), 'verify', store, { note: 'Seam open 15 cm' }));
const approved = (charge: 'foc' | 'chargeable', outcome = 'send_material') =>
    ok(applyClaimAction(verified(), 'approve', anuka, { outcome, charge, remarks: 'Replace front seat' }));

test('warranty years from the text, and cover from the purchase date', () => {
    assert.equal(warrantyYears('1+1 year'), 2);
    assert.equal(warrantyYears('2 + 1 year'), 3);
    assert.equal(warrantyYears(null), 0);
    const now = new Date('2026-10-22');
    const c = coverage({ status: 'validated', warranty_type: '1+1 year', purchase_date: '2025-03-12' }, now);
    assert.equal(c.end, '2027-03-12');
    assert.equal(c.covered, true);
    assert.equal(coverage({ status: 'validated', warranty_type: '1+1 year', purchase_date: '2024-01-01' }, now).why, 'Warranty period is over');
    assert.equal(coverage({ status: 'pending', warranty_type: '1+1 year', purchase_date: '2026-01-01' }, now).covered, false);
});

test('issues: all while covered, only alteration after; the description where it is needed', () => {
    assert.ok(problemsFor('seat-cover').includes('stitch_issue'));
    assert.deepEqual(problemsFor('seat-cover', false), ['alteration']);
    assert.equal(kindOf('alteration'), 'alteration');
    assert.match(String((readProblem({ problem: 'stitch_issue' }, false) as any).error), /only an alteration/);
    assert.match(String((readProblem({ problem: 'other', description: 'x' }, true) as any).error), /Describe/);
    assert.deepEqual(readProblem({ problem: 'colour_issue' }, true), { problem: 'colour_issue', description: null });
});

test('vehicle: make and model always, airbags only for seat covers', () => {
    assert.match(String((readVehicle({ vehicle_make: 'Kia' }, 'seat-cover') as any).error), /model/);
    assert.match(String((readVehicle({ vehicle_make: 'Kia', vehicle_model: 'Seltos' }, 'seat-cover') as any).error), /airbags/);
    assert.deepEqual(readVehicle({ vehicle_make: 'Kia', vehicle_model: 'Seltos', airbags: 'with' }, 'ppf'), { make: 'Kia', model: 'Seltos', year: null, airbags: null });
    // The year, when given, must be a year.
    assert.deepEqual(readVehicle({ vehicle_make: 'Kia', vehicle_model: 'Seltos', vehicle_year: '2022' }, 'ppf'), { make: 'Kia', model: 'Seltos', year: 2022, airbags: null });
    assert.match(String((readVehicle({ vehicle_make: 'Kia', vehicle_model: 'Seltos', vehicle_year: '22' }, 'ppf') as any).error), /year/);
    assert.match(String((readVehicle({ vehicle_make: 'Kia', vehicle_model: 'Seltos', airbags: 'sab' }, 'seat-cover') as any).error), /major colour/);
    assert.deepEqual(readVehicle({ vehicle_make: 'Kia', vehicle_model: 'Seltos', airbags: 'sab', major_colour: 'Beige' }, 'seat-cover'),
        { make: 'Kia', model: 'Seltos', year: null, airbags: 'sab', major_colour: 'Beige', minor_colour: null });
});

test('the store verifies, correcting details in words', () => {
    const c = ok(applyClaimAction(claim(), 'verify', store, { note: 'Checked', vehicle_model: 'Creta N Line', problem: 'colour_issue' }));
    assert.equal(c.status, 'review');
    assert.deepEqual(c.verification?.corrections, [
        'Vehicle: Hyundai · Creta · with airbags · Black/Red → Hyundai · Creta N Line · with airbags · Black/Red',
        'Issue: Stitch issue → Colour issue / colour difference',
    ]);
    assert.equal(c.problem, 'colour_issue');
    assert.match(err(applyClaimAction(claim(), 'verify', anuka, {})), /cannot take/);
});

test('the plant holds, asks for more, rejects; a viewer can do none of it', () => {
    const v = verified();
    assert.deepEqual(actionsFor(v, viewer), []);
    assert.match(err(applyClaimAction(v, 'approve', viewer, { outcome: 'repair_store', charge: 'foc' })), /cannot take/);
    const held = ok(applyClaimAction(v, 'hold', anuka, { reason: 'component' }));
    assert.equal(held.status, 'on_hold');
    assert.equal(waitingOn(held.status), 'Plant (on hold)');
    assert.equal(ok(applyClaimAction(held, 'ask_more', anuka, { note: 'Send a closer photo' })).status, 'verify');
    assert.match(err(applyClaimAction(v, 'reject', anuka, {})), /reason/);
    assert.equal(ok(applyClaimAction(held, 'reject', anuka, { reason: 'fading' })).status, 'rejected');
});

test('free of cost goes straight on; chargeable waits for the customer, or the store with their say-so', () => {
    assert.equal(approved('foc').status, 'plan');
    assert.equal(approved('foc', 'repair_store').status, 'repair');
    const ch = approved('chargeable');
    assert.equal(ch.status, 'consent');
    assert.deepEqual(actionsFor(ch, customer), ['consent', 'decline', 'ask_change']);
    assert.match(err(applyClaimAction(ch, 'consent', store, {})), /customer has agreed/);
    const agreed = ok(applyClaimAction(ch, 'consent', store, { agree: true }));
    assert.equal(agreed.status, 'plan');
    assert.equal(agreed.consent?.by, 'store');
    assert.equal(ok(applyClaimAction(ch, 'decline', customer, {})).status, 'declined');
});

test('EDD and alteration no., then dispatch date and docket, then the store confirms fitted', () => {
    const planRight: Who = { actor: 'admin', rights: ['plan'] };
    const a = approved('foc');
    assert.match(err(applyClaimAction(a, 'plan', planRight, {})), /alteration no/);
    assert.match(err(applyClaimAction(a, 'plan', { actor: 'admin', rights: ['dispatch'] }, { edd: '2026-11-02' })), /cannot take/);
    assert.match(err(applyClaimAction(a, 'plan', planRight, { edd: '2026-11-02' })), /alteration no/);
    assert.equal(ok(applyClaimAction(a, 'plan', planRight, { alteration_no: 'ALT-9' })).plan?.edd, null);
    const p = ok(applyClaimAction(a, 'plan', planRight, { edd: '2026-11-02', alteration_no: 'ALT-9' }));
    assert.equal(p.status, 'production');
    assert.match(err(applyClaimAction(p, 'ready', { actor: 'admin', rights: ['dispatch'] }, {})), /cannot take/);
    const r = ok(applyClaimAction(p, 'ready', planRight, {}));
    assert.equal(r.status, 'ready');
    assert.equal(waitingOn(r.status), 'Plant to dispatch');
    assert.match(err(applyClaimAction(r, 'dispatch', anuka, { dispatch_date: '2026-11-01' })), /docket/);
    const d = ok(applyClaimAction(r, 'dispatch', anuka, { dispatch_date: '2026-11-01', docket: 'DTDC 123' }));
    assert.equal(d.status, 'dispatched');
    assert.equal(ok(applyClaimAction(d, 'fitted', store, {})).status, 'closed');
});

test('edits and undos need a reason, list their changes, and can themselves be undone', () => {
    const d = ok(applyClaimAction(ok(applyClaimAction(approved('foc'), 'plan', anuka, { edd: '2026-11-02', alteration_no: 'ALT-1' })), 'dispatch', anuka, { dispatch_date: '2026-11-01', docket: 'D1' }));
    assert.match(err(applyClaimAction(d, 'edit', anuka, { docket: 'D2' })), /why/);
    assert.match(err(applyClaimAction(d, 'edit', anuka, { docket: 'D1', note: 'no change' })), /Nothing/);
    const r = applyClaimAction(d, 'edit', anuka, { docket: 'D2', edd: '2026-11-05', note: 'Courier re-booked' });
    if ('error' in r) throw new Error(r.error);
    assert.deepEqual(r.changes, ['EDD: 2026-11-02 → 2026-11-05', 'Docket: D1 → D2']);
    assert.equal(r.claim.status, 'dispatched');
    const back = ok(applyClaimAction(r.claim, 'undo', anuka, { note: 'Wrong claim' }));
    assert.equal(back.dispatch?.docket, 'D1');
    assert.match(err(applyClaimAction(back, 'undo', anuka, {})), /why/);
    assert.equal(ok(applyClaimAction(back, 'undo', anuka, { note: 'Not sent yet' })).status, 'production');
});

test('before the plant decides: the customer edits (back to the store once verified), the store edits while with the plant', () => {
    const c = claim();
    assert.ok(actionsFor(c, customer).includes('change'));
    assert.ok(!actionsFor(c, store).includes('change'));
    assert.match(err(applyClaimAction(c, 'change', customer, { description: null as any })), /Nothing/);
    const e = ok(applyClaimAction(c, 'change', customer, { vehicle_model: 'Venue', photos: ['a.jpg'] }));
    assert.equal(e.status, 'verify');
    assert.equal(e.vehicle?.model, 'Venue');
    assert.deepEqual(e.media, ['a.jpg']);
    const v = verified();
    assert.equal(ok(applyClaimAction(v, 'change', customer, { problem: 'hole' })).status, 'verify');
    const s = ok(applyClaimAction(v, 'change', store, { problem: 'hole' }));
    assert.equal(s.status, 'review');
    assert.equal(s.problem, 'hole');
    assert.ok(!actionsFor(approved('foc'), customer).includes('change'));
});

test('after approval a change is asked for, one at a time, and the plant approves or refuses it', () => {
    const a = approved('foc');
    assert.ok(actionsFor(a, store).includes('ask_change'));
    assert.match(err(applyClaimAction(a, 'ask_change', store, { problem: 'hole' })), /why/);
    const r = applyClaimAction(a, 'ask_change', store, { problem: 'hole', note: 'Wrong issue chosen' });
    if ('error' in r) throw new Error(r.error);
    assert.equal(r.claim.problem, 'stitch_issue');
    assert.equal(r.claim.change_request?.by, 'vendor');
    assert.ok(!actionsFor(r.claim, customer).includes('ask_change'));
    assert.ok(actionsFor(r.claim, anuka).includes('change_ok'));
    assert.match(err(applyClaimAction(r.claim, 'change_ok', store, {})), /cannot take/);
    const yes = ok(applyClaimAction(r.claim, 'change_ok', anuka, {}));
    assert.equal(yes.problem, 'hole');
    assert.equal(yes.change_request, null);
    assert.equal(yes.status, a.status);
    assert.match(err(applyClaimAction(r.claim, 'change_no', anuka, {})), /why/);
    const no = ok(applyClaimAction(r.claim, 'change_no', anuka, { note: 'Photos show a stitch issue' }));
    assert.equal(no.problem, 'stitch_issue');
    assert.equal(no.change_request, null);
});

test('a rejected claim is edited and sent again: the store to the plant, the customer to the store', () => {
    const rej = ok(applyClaimAction(verified(), 'reject', anuka, { reason: 'altered' }));
    assert.ok(actionsFor(rej, store).includes('resend'));
    assert.match(err(applyClaimAction(rej, 'resend', store, {})), /what you changed/);
    const s = ok(applyClaimAction(rej, 'resend', store, { note: 'New photos of the seam', photos: ['b.jpg'] }));
    assert.equal(s.status, 'review');
    assert.equal(s.decision, null);
    assert.equal(ok(applyClaimAction(rej, 'resend', customer, { note: 'Added a video' })).status, 'verify');
});

test('the plant changes its decision: what and who pays before the alteration no., only remarks after; a rejection its reason', () => {
    const a = approved('foc');
    assert.equal(a.status, 'plan');
    assert.match(err(applyClaimAction(a, 'edit', anuka, { charge: 'chargeable' })), /why/);
    const r = applyClaimAction(a, 'edit', anuka, { charge: 'chargeable', note: 'Out of T&C, chargeable' });
    if ('error' in r) throw new Error(r.error);
    assert.deepEqual(r.changes, ['Charge: Free of cost → Chargeable']);
    assert.equal(r.claim.status, 'consent');
    const rep = ok(applyClaimAction(a, 'edit', anuka, { outcome: 'repair_store', note: 'Store can fix it' }));
    assert.equal(rep.status, 'repair');
    assert.equal(rep.decision?.item, null);
    const wip = ok(applyClaimAction(a, 'plan', anuka, { alteration_no: 'ALT-3' }));
    assert.match(err(applyClaimAction(wip, 'edit', anuka, { charge: 'chargeable', note: 'late' })), /before the alteration no/);
    assert.equal(ok(applyClaimAction(wip, 'edit', anuka, { remarks: 'New remark', note: 'typo' })).decision?.remarks, 'New remark');
    const rej = ok(applyClaimAction(verified(), 'reject', anuka, { reason: 'altered' }));
    assert.ok(actionsFor(rej, anuka).includes('edit'));
    const fixed = ok(applyClaimAction(rej, 'edit', anuka, { reason: 'fading', note: 'Wrong reason picked' }));
    assert.equal(fixed.decision?.reason, 'fading');
    assert.equal(fixed.status, 'rejected');
});

test('the plant takes its decision again: approve, hold, reject or ask the store, with a reason, and one undo puts it back', () => {
    const a = approved('foc');
    assert.ok(actionsFor(a, anuka).includes('redecide'));
    assert.match(err(applyClaimAction(a, 'redecide', anuka, { choice: 'reject', reason: 'fading' })), /why/);
    const r = applyClaimAction(a, 'redecide', anuka, { choice: 'reject', reason: 'fading', change_reason: 'Photos show fading' });
    if ('error' in r) throw new Error(r.error);
    assert.equal(r.claim.status, 'rejected');
    assert.deepEqual(r.changes, ['Decision changed: Not approved: Fading from sun exposure or chemicals']);
    assert.equal(ok(applyClaimAction(r.claim, 'undo', anuka, { note: 'Mistake' })).status, 'plan');
    const back = ok(applyClaimAction(r.claim, 'redecide', anuka, { choice: 'approve', outcome: 'repair_store', charge: 'chargeable', change_reason: 'Rechecked' }));
    assert.equal(back.status, 'consent');
    assert.equal(ok(applyClaimAction(a, 'redecide', anuka, { choice: 'hold', reason: 'checking', change_reason: 'Checking stock' })).status, 'on_hold');
    assert.equal(ok(applyClaimAction(a, 'redecide', anuka, { choice: 'ask_more', note: 'Send a video', change_reason: 'Need more' })).status, 'verify');
    const wip = ok(applyClaimAction(a, 'plan', anuka, { alteration_no: 'ALT-4' }));
    assert.ok(!actionsFor(wip, anuka).includes('redecide'));
    assert.match(err(applyClaimAction(a, 'redecide', { actor: 'admin', rights: ['plan'] }, { choice: 'hold', reason: 'checking', change_reason: 'x x x' })), /cannot take/);
});

test('dispatch columns are filled one at a time; a date and a docket make it dispatched; changing a filled one needs a reason', () => {
    const wip = ok(applyClaimAction(approved('foc'), 'plan', anuka, { alteration_no: 'ALT-7' }));
    const team: Who = { actor: 'admin', rights: ['dispatch'] };
    assert.ok(actionsFor(wip, team).includes('dispatch_info'));
    const c1 = ok(applyClaimAction(wip, 'dispatch_info', team, { courier: 'DTDC' }));
    assert.equal(c1.status, 'production');
    assert.equal(c1.dispatch?.courier, 'DTDC');
    const c2 = ok(applyClaimAction(c1, 'dispatch_info', team, { dispatch_date: '2026-10-28' }));
    assert.equal(c2.status, 'production');
    const c3 = ok(applyClaimAction(c2, 'dispatch_info', team, { docket: 'D-55' }));
    assert.equal(c3.status, 'dispatched');
    assert.match(err(applyClaimAction(c3, 'dispatch_info', team, { docket: 'D-56' })), /why/);
    assert.equal(ok(applyClaimAction(c3, 'dispatch_info', team, { docket: 'D-56', note: 'Re-booked' })).dispatch?.docket, 'D-56');
    assert.equal(ok(applyClaimAction(c3, 'undo', anuka, { note: 'Mistake' })).status, 'production');
    assert.ok(!actionsFor(verified(), team).includes('dispatch_info'));
});
