import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, nextStatus, heldFrom, type HistoryEntry } from '../posmFlow.js';

const to = (r: ReturnType<typeof nextStatus>) => ('status' in r ? r.status : `error: ${r.error}`);

test('the actions offered at each stage', () => {
    assert.deepEqual(actionsFor('open'), ['approve', 'hold', 'reject']);
    assert.deepEqual(actionsFor('under_review'), ['approve', 'hold', 'reject']);
    assert.deepEqual(actionsFor('approved'), ['hold', 'start', 'dispatch']);
    assert.deepEqual(actionsFor('in_production'), ['hold', 'dispatch']);
    assert.deepEqual(actionsFor('pending'), ['reject', 'resume']);
    assert.deepEqual(actionsFor('dispatched'), ['deliver']);
    assert.deepEqual(actionsFor('delivered'), ['close']);
    assert.deepEqual(actionsFor('rejected'), ['reopen']);
    assert.deepEqual(actionsFor('closed'), ['reopen']);
});

test('the happy path: approve → production → dispatch → deliver → close', () => {
    assert.equal(to(nextStatus('open', 'approve')), 'approved');
    assert.equal(to(nextStatus('approved', 'start')), 'in_production');
    assert.equal(to(nextStatus('in_production', 'dispatch')), 'dispatched');
    assert.equal(to(nextStatus('dispatched', 'deliver')), 'delivered');
    assert.equal(to(nextStatus('delivered', 'close')), 'closed');
    assert.equal(to(nextStatus('approved', 'dispatch')), 'dispatched', 'production can be skipped');
});

test('steps out of order are refused', () => {
    assert.match(to(nextStatus('open', 'dispatch')), /cannot be dispatched now/);
    assert.match(to(nextStatus('dispatched', 'approve')), /cannot be approved now/);
    assert.match(to(nextStatus('delivered', 'reject')), /error/);
    assert.match(to(nextStatus('open', 'fly')), /Unknown action/);
});

test('resume returns to the stage the request was held at', () => {
    const h = (from: string): HistoryEntry[] => [
        { action: 'sent', status: 'open', at: '', by_role: 'franchise' },
        { action: 'hold', status: 'pending', at: '', by_role: 'admin', from: from as HistoryEntry['from'] },
    ];
    assert.equal(to(nextStatus('pending', 'resume', h('in_production'))), 'in_production');
    assert.equal(to(nextStatus('pending', 'resume', h('approved'))), 'approved');
    assert.equal(heldFrom(null), 'open', 'an older request with no history goes back to To approve');
});

test('reopen sends a rejected or closed request back to To approve', () => {
    assert.equal(to(nextStatus('rejected', 'reopen')), 'open');
    assert.equal(to(nextStatus('closed', 'reopen')), 'open');
});
