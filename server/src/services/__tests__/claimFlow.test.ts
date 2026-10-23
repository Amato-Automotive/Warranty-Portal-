import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyClaimAction, actionsFor, coverage, warrantyYears, problemsFor, kindOf, stepText, type FlowClaim } from '../claimFlow.js';

const claim = (p: Partial<FlowClaim> = {}): FlowClaim => ({
    kind: 'warranty', status: 'inspect', inspection: null, decision: null, payment: null, dispatch: null, fixed: null, ...p,
});
const ok = (r: ReturnType<typeof applyClaimAction>) => { if ('error' in r) throw new Error(r.error); return r.claim; };
const err = (r: ReturnType<typeof applyClaimAction>) => ('error' in r ? r.error : 'no error');
const inspected = () => ok(applyClaimAction(claim(), 'inspect', 'vendor', { covered: true, suggest: 'send_material', note: 'Seam open 15 cm', photos: ['a.jpg'] }));

test('warranty years from the text, and cover from the purchase date', () => {
    assert.equal(warrantyYears('1+1 year'), 2);
    assert.equal(warrantyYears('2 + 1 year'), 3);
    assert.equal(warrantyYears('7 years'), 7);
    assert.equal(warrantyYears(null), 0);
    const now = new Date('2026-10-22');
    const c = coverage({ status: 'validated', warranty_type: '1+1 year', purchase_date: '2025-03-12' }, now);
    assert.equal(c.end, '2027-03-12');
    assert.equal(c.covered, true);
    assert.equal(coverage({ status: 'validated', warranty_type: '1+1 year', purchase_date: '2024-01-01' }, now).why, 'Warranty period is over');
    assert.equal(coverage({ status: 'pending', warranty_type: '1+1 year', purchase_date: '2026-01-01' }, now).covered, false);
    assert.equal(coverage({ status: 'validated', warranty_type: '1+1', purchase_date: null, created_at: '2026-01-05' }, now).start, '2026-01-05');
});

test('the problems follow the T&C for each product', () => {
    assert.deepEqual(problemsFor('seat-cover'), ['stitching_defect', 'colour_bleeding', 'rubbing_fastness', 'alteration']);
    assert.deepEqual(problemsFor('ev-products'), ['product_defect', 'alteration']);
    assert.deepEqual(problemsFor('seat-cover', false), ['alteration'], 'out of warranty, only an alteration');
    assert.equal(kindOf('alteration'), 'alteration');
    assert.equal(kindOf('stitching_defect'), 'warranty');
});

test('the store inspects with photos and a note; not covered needs a T&C reason', () => {
    assert.match(err(applyClaimAction(claim(), 'inspect', 'vendor', { covered: true, note: 'ok ok' })), /photo/);
    assert.match(err(applyClaimAction(claim(), 'inspect', 'vendor', { covered: false, note: 'cut mark', photos: ['a'] })), /not covered/);
    assert.match(err(applyClaimAction(claim(), 'inspect', 'admin', { covered: true, note: 'x', photos: ['a'] })), /cannot take/);
    const c = inspected();
    assert.equal(c.status, 'decide');
    assert.equal(c.inspection?.suggest, 'send_material');
    const back = ok(applyClaimAction(c, 'ask_more', 'admin', { note: 'Photo of the seat back please' }));
    assert.equal(back.status, 'inspect');
    const again = ok(applyClaimAction(back, 'inspect', 'vendor', { covered: true, note: 'Added seat back', photos: ['b.jpg'] }));
    assert.deepEqual(again.inspection?.photos, ['a.jpg', 'b.jpg'], 'photos add up across inspections');
});

test('FOC replacement: send → dispatched → fitted → closed, each step undoable', () => {
    const a = ok(applyClaimAction(inspected(), 'approve', 'admin', { outcome: 'send_material', charge: 'foc', item: 'U-CREST driver seat set', old_part: 'return' }));
    assert.equal(a.status, 'send');
    assert.equal(a.decision?.source, 'plant');
    assert.equal(a.decision?.material, 'replacement');
    assert.equal(a.decision?.old_part, 'return');
    assert.match(stepText('approve', a), /replacement from the plant, FOC/);
    assert.match(err(applyClaimAction(a, 'dispatch', 'admin', {})), /how it was sent/);
    const d = ok(applyClaimAction(a, 'dispatch', 'admin', { courier: 'DTDC', tracking: 'D1', date: '2026-10-21' }));
    assert.equal(d.status, 'dispatched');
    const f = ok(applyClaimAction(d, 'fixed', 'vendor', { note: 'Fitted' }));
    assert.equal(f.status, 'fixed');
    assert.deepEqual(actionsFor(f, 'customer'), ['close']);
    const cl = ok(applyClaimAction(f, 'close', 'customer'));
    assert.equal(cl.status, 'closed');

    const u = ok(applyClaimAction(ok(applyClaimAction(cl, 'undo', 'admin')), 'undo', 'admin'));
    assert.equal(u.status, 'dispatched');
    assert.equal(u.fixed, null);
    const u2 = ok(applyClaimAction(u, 'undo', 'admin'));
    assert.equal(u2.status, 'send');
    assert.equal(u2.dispatch, null);
    assert.match(err(applyClaimAction(u2, 'undo', 'vendor')), /cannot take/);
});

test('chargeable waits for payment, then goes on to repair or send', () => {
    const base = inspected();
    assert.match(err(applyClaimAction(base, 'approve', 'admin', { outcome: 'repair_store', charge: 'chargeable' })), /amount/);
    const p = ok(applyClaimAction(base, 'approve', 'admin', { outcome: 'repair_store', charge: 'chargeable', amount: '1500' }));
    assert.equal(p.status, 'payment');
    assert.equal(p.decision?.amount, 1500);
    const e = ok(applyClaimAction(p, 'edit', 'admin', { amount: 1200, note: 'Labour only' }));
    assert.equal(e.decision?.amount, 1200);
    assert.equal(e.trail?.length, p.trail?.length, 'an edit is not a step');
    assert.match(err(applyClaimAction(p, 'paid', 'admin', {})), /how it was paid/);
    const r = ok(applyClaimAction(e, 'paid', 'admin', { mode: 'upi', ref: 'UTR123' }));
    assert.equal(r.status, 'repair');
    assert.match(err(applyClaimAction(r, 'edit', 'admin', { amount: 900 })), /payment is already in/);
    const s = ok(applyClaimAction(ok(applyClaimAction(base, 'approve', 'admin', { outcome: 'send_material', charge: 'chargeable', amount: 800, item: 'Mat set', source: 'distributor', distributor: 'Shree Auto' })), 'paid', 'admin', { mode: 'bank' }));
    assert.equal(s.status, 'send');
    assert.equal(s.decision?.distributor, 'Shree Auto');
});

test('reject needs a T&C reason; other needs words; steps out of turn are refused', () => {
    const base = inspected();
    assert.match(err(applyClaimAction(base, 'reject', 'admin', {})), /reason/);
    assert.match(err(applyClaimAction(base, 'reject', 'admin', { reason: 'other' })), /Write the reason/);
    const r = ok(applyClaimAction(base, 'reject', 'admin', { reason: 'sharp_object', note: 'Cut mark on the seat' }));
    assert.equal(r.status, 'rejected');
    assert.match(stepText('reject', r), /sharp object/);
    assert.ok(!actionsFor(r, 'admin').includes('edit'));
    assert.match(err(applyClaimAction(r, 'dispatch', 'admin', { courier: 'x' })), /cannot be dispatched/);
    assert.match(err(applyClaimAction(base, 'approve', 'admin', { outcome: 'send_material', charge: 'foc' })), /what is being sent/);
    assert.match(err(applyClaimAction(base, 'approve', 'admin', { outcome: 'send_material', charge: 'foc', item: 'x', source: 'distributor' })), /which distributor/);
});

test('an alteration sends alteration material by default', () => {
    const c = ok(applyClaimAction({ ...inspected(), kind: 'alteration' }, 'approve', 'admin', { outcome: 'send_material', charge: 'chargeable', amount: 600, item: 'Headrest covers' }));
    assert.equal(c.decision?.material, 'alteration');
    assert.equal(c.status, 'payment');
});
