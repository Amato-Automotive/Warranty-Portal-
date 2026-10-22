import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLineAction, lineActionsFor, requestStatus, ownStages, type FlowLine } from '../posmLineFlow.js';
import { undoTarget, type HistoryEntry } from '../posmFlow.js';

const line = (p: Partial<FlowLine> = {}): FlowLine => ({ item_name: 'T-shirts', qty: 12, line_status: 'pending', approved_qty: null, ...p });
const ok = (r: ReturnType<typeof applyLineAction>) => { if ('error' in r) throw new Error(r.error); return r.line; };
const err = (r: ReturnType<typeof applyLineAction>) => ('error' in r ? r.error : 'no error');
const ship = { courier: 'DTDC', tracking: 'D1', date: '2026-10-20' };

test('an item goes approve → production → dispatch → deliver, each step undoable', () => {
    const a = ok(applyLineAction(line(), 'approve', { qty: 10, note: 'Only 10 in stock' }));
    assert.equal(a.line_status, 'approved');
    assert.equal(a.approved_qty, 10);
    assert.equal(a.note, 'Only 10 in stock');
    const p = ok(applyLineAction(a, 'start'));
    assert.equal(p.line_status, 'in_production');
    assert.equal(p.note, 'Only 10 in stock', 'the note stays');
    const d = ok(applyLineAction(p, 'dispatch', { dispatch: ship }));
    assert.equal(d.line_status, 'dispatched');
    assert.equal(d.dispatch?.courier, 'DTDC');
    const v = ok(applyLineAction(d, 'deliver', { by: 'franchise' }));
    assert.equal(v.line_status, 'delivered');
    assert.equal(v.delivered_by, 'franchise');

    const u1 = ok(applyLineAction(v, 'undo'));
    assert.equal(u1.line_status, 'dispatched');
    assert.equal(u1.delivered_at, null);
    const u2 = ok(applyLineAction(u1, 'undo'));
    assert.equal(u2.line_status, 'in_production');
    assert.equal(u2.dispatch, null, 'undoing a dispatch takes the courier off');
    const u4 = ok(applyLineAction(ok(applyLineAction(u2, 'undo')), 'undo'));
    assert.equal(u4.line_status, 'pending');
    assert.equal(u4.approved_qty, null);
    assert.equal(u4.note, null);
    assert.match(err(applyLineAction(u4, 'undo')), /no step to undo/);
});

test('approve uses the asked quantity, and a quantity of 0 or over the cap is refused', () => {
    assert.equal(ok(applyLineAction(line(), 'approve')).approved_qty, 12);
    assert.match(err(applyLineAction(line(), 'approve', { qty: 0 })), /1 to 1000/);
    assert.match(err(applyLineAction(line(), 'approve', { qty: 5000 })), /1 to 1000/);
});

test('reject needs a reason; a rejected item can be approved instead or undone', () => {
    assert.match(err(applyLineAction(line(), 'reject')), /reason/);
    const r = ok(applyLineAction(line(), 'reject', { note: 'Reprint due in November' }));
    assert.equal(r.line_status, 'rejected');
    assert.equal(r.approved_qty, 0);
    assert.deepEqual(lineActionsFor(r), ['approve', 'undo', 'edit']);
    const again = ok(applyLineAction(r, 'approve', { qty: 3 }));
    assert.equal(again.line_status, 'approved');
    assert.equal(again.note, null, 'the reason goes once it is approved');
    assert.equal(ok(applyLineAction(r, 'undo')).line_status, 'pending');
});

test('hold returns to where it was held, by Resume', () => {
    const a = ok(applyLineAction(line(), 'approve'));
    const h = ok(applyLineAction(a, 'hold', { note: 'New edition next week' }));
    assert.equal(h.line_status, 'on_hold');
    assert.deepEqual(lineActionsFor(h), ['reject', 'resume', 'undo', 'edit']);
    const back = ok(applyLineAction(h, 'resume'));
    assert.equal(back.line_status, 'approved');
    assert.equal(back.note, null);
});

test('steps not open at a stage are refused', () => {
    assert.match(err(applyLineAction(line(), 'dispatch', { dispatch: ship })), /cannot be dispatched/);
    const d = ok(applyLineAction(ok(applyLineAction(line(), 'approve')), 'dispatch', { dispatch: ship }));
    assert.match(err(applyLineAction(d, 'reject', { note: 'nope nope' })), /cannot be rejected/);
    assert.match(err(applyLineAction(ok(applyLineAction(line(), 'approve')), 'dispatch', {})), /how it was sent/);
});

test('edit changes the quantity, note and courier at any stage without a step', () => {
    const a = ok(applyLineAction(line(), 'approve'));
    const e = ok(applyLineAction(a, 'edit', { qty: 8, note: 'Short on L' }));
    assert.equal(e.approved_qty, 8);
    assert.equal(e.note, 'Short on L');
    assert.equal(e.trail?.length, a.trail?.length, 'an edit is not a step to undo');
    assert.equal(ok(applyLineAction(e, 'edit', { note: '' })).note, null);
    assert.match(err(applyLineAction(e, 'edit', { dispatch: ship })), /not dispatched/);
    const d = ok(applyLineAction(e, 'dispatch', { dispatch: ship }));
    assert.equal(ok(applyLineAction(d, 'edit', { dispatch: { courier: 'Blue Dart', tracking: 'B2' } })).dispatch?.courier, 'Blue Dart');
    const r = ok(applyLineAction(line(), 'reject', { note: 'No stock' }));
    assert.match(err(applyLineAction(r, 'edit', { note: '' })), /reason/);
    assert.match(err(applyLineAction(r, 'edit', { qty: 3 })), /approve it instead/);
});

test("the request's status follows its items", () => {
    const L = (line_status: string) => line({ line_status });
    assert.equal(requestStatus([L('pending'), L('dispatched')], 'dispatched'), 'open');
    assert.equal(requestStatus([L('approved'), L('in_production')], 'open'), 'approved');
    assert.equal(requestStatus([L('dispatched'), L('rejected')], 'open'), 'dispatched');
    assert.equal(requestStatus([L('on_hold'), L('rejected')], 'open'), 'pending');
    assert.equal(requestStatus([L('on_hold'), L('dispatched')], 'open'), 'dispatched');
    assert.equal(requestStatus([L('rejected'), L('rejected')], 'open'), 'rejected');
    assert.equal(requestStatus([L('delivered')], 'closed'), 'closed');
    assert.equal(requestStatus([L('delivered')], 'dispatched'), 'delivered');
});

test('older requests give each item the request stage, once', () => {
    const items = [line({ line_status: 'approved', approved_qty: 10 }), line({ line_status: 'rejected', approved_qty: 0 })];
    const d = ownStages(items, { status: 'dispatched', dispatch: ship });
    assert.equal(d[0].line_status, 'dispatched');
    assert.equal(d[0].dispatch?.courier, 'DTDC');
    assert.equal(d[1].line_status, 'rejected');
    assert.deepEqual(ownStages(d, { status: 'open' }), d, 'lines already on their own are left alone');

    const held = ownStages([line({ line_status: 'approved', approved_qty: 5 })], { status: 'pending', heldFrom: 'in_production' });
    assert.equal(held[0].line_status, 'on_hold');
    assert.equal(ok(applyLineAction(held[0], 'resume')).line_status, 'in_production');
    assert.equal(ownStages([line()], { status: 'rejected' })[0].line_status, 'rejected');
    assert.equal(ownStages([line({ line_status: 'approved' })], { status: 'closed', delivery: { at: 'x', by: 'admin' } })[0].line_status, 'delivered');
});

test('undo on a request without items goes back one step at a time', () => {
    const h = (action: HistoryEntry['action'], status: HistoryEntry['status'], extra: Partial<HistoryEntry> = {}): HistoryEntry =>
        ({ action, status, at: '', by_role: 'admin', ...extra });
    const hist = [h('sent', 'open'), h('approve', 'approved'), h('dispatch', 'dispatched')];
    const u = undoTarget(hist);
    assert.ok(!('error' in u));
    if ('error' in u) return;
    assert.equal(u.status, 'approved');
    assert.equal(u.undid.action, 'dispatch');
    const after = [...hist.map((e, i) => i === u.index ? { ...e, undone: true } : e), h('undo', 'approved')];
    const u2 = undoTarget(after);
    assert.ok(!('error' in u2) && u2.status === 'open');
    assert.ok('error' in undoTarget([h('sent', 'open')]));
});
