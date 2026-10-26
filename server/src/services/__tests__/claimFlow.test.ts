import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyClaimAction, actionsFor, coverage, warrantyYears, problemsFor, kindOf, readVehicle, readProblem, waitingOn,
    type FlowClaim, type Who,
} from '../claimFlow.js';

const claim = (p: Partial<FlowClaim> = {}): FlowClaim => ({
    kind: 'warranty', product_type: 'seat-cover', status: 'verify', problem: 'stitch_issue', description: null,
    vehicle: { make: 'Hyundai', model: 'Creta', airbags: 'with' },
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
    assert.deepEqual(readVehicle({ vehicle_make: 'Kia', vehicle_model: 'Seltos', airbags: 'with' }, 'ppf'), { make: 'Kia', model: 'Seltos', airbags: null });
});

test('the store verifies, correcting details in words', () => {
    const c = ok(applyClaimAction(claim(), 'verify', store, { note: 'Checked', vehicle_model: 'Creta N Line', problem: 'colour_issue' }));
    assert.equal(c.status, 'review');
    assert.deepEqual(c.verification?.corrections, [
        'Vehicle: Hyundai · Creta · with airbags → Hyundai · Creta N Line · with airbags',
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
    assert.deepEqual(actionsFor(ch, customer), ['consent', 'decline']);
    assert.match(err(applyClaimAction(ch, 'consent', store, {})), /customer has agreed/);
    const agreed = ok(applyClaimAction(ch, 'consent', store, { agree: true }));
    assert.equal(agreed.status, 'plan');
    assert.equal(agreed.consent?.by, 'store');
    assert.equal(ok(applyClaimAction(ch, 'decline', customer, {})).status, 'declined');
});

test('EDD and alteration no., then dispatch date and docket, then the store confirms fitted', () => {
    const planRight: Who = { actor: 'admin', rights: ['plan'] };
    const a = approved('foc');
    assert.match(err(applyClaimAction(a, 'plan', planRight, { alteration_no: 'ALT-9' })), /EDD/);
    assert.match(err(applyClaimAction(a, 'plan', { actor: 'admin', rights: ['dispatch'] }, { edd: '2026-11-02' })), /cannot take/);
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
    const d = ok(applyClaimAction(ok(applyClaimAction(approved('foc'), 'plan', anuka, { edd: '2026-11-02' })), 'dispatch', anuka, { dispatch_date: '2026-11-01', docket: 'D1' }));
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
