import test from 'node:test';
import assert from 'node:assert/strict';
import { withScreenPermissions } from '../adminScreenPermissions.js';

test('a new screen starts with the access of the screen it used to share', () => {
    const { perms, changed } = withScreenPermissions({
        vendors: { read: true, write: false },
        feedback: { read: true, write: true },
        warranties: { read: false, write: false },
    });
    assert.equal(changed, true);
    assert.deepEqual(perms.portal_activity, { read: true, write: false });
    assert.deepEqual(perms.manpower, { read: true, write: false });
    assert.deepEqual(perms.store_ratings, { read: true, write: true });
    assert.deepEqual(perms.franchise_forms, { read: true, write: true });
    assert.deepEqual(perms.ppf_rolls, { read: false, write: false });
    assert.deepEqual(perms.whatsapp_settings, { read: false, write: false });
});

test('the sourcing map follows distributors or orders, whichever the admin had', () => {
    assert.deepEqual(withScreenPermissions({ order_management: { read: true, write: true } }).perms.sourcing_map, { read: true, write: true });
    assert.deepEqual(withScreenPermissions({ distributors: { read: true, write: false } }).perms.sourcing_map, { read: true, write: false });
    assert.deepEqual(withScreenPermissions({}).perms.sourcing_map, { read: false, write: false });
});

test('a switch that already exists is never overwritten, and a second run changes nothing', () => {
    const first = withScreenPermissions({ vendors: { read: true, write: true }, manpower: { read: false, write: false } });
    assert.deepEqual(first.perms.manpower, { read: false, write: false });
    const second = withScreenPermissions(first.perms);
    assert.equal(second.changed, false);
    assert.deepEqual(second.perms, first.perms);
});
