import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { designOf, dispatchItemName, isPlantItem, nextLineStatus, pickDepot, stageForStatus, statusForStage } from '../posmSyncRules.js';

describe('POSM requests and dispatch lines', () => {
    test('FRP and Sample jacket go to the plant; the rest to the Noida office', () => {
        assert.equal(isPlantItem('frp'), true);
        assert.equal(isPlantItem('jacket'), true);
        assert.equal(isPlantItem('tshirt'), false);
        assert.equal(dispatchItemName('frp', 'FRP Cover'), 'FRP');
        assert.equal(dispatchItemName('vcard', 'Visiting cards'), 'Visiting Card');
        assert.equal(dispatchItemName('newthing', 'Standee'), 'Standee');
    });

    test('a step and a status map both ways', () => {
        assert.equal(statusForStage('pending'), null);
        assert.equal(statusForStage('rejected'), null);
        assert.equal(statusForStage('in_production'), 'WIP');
        assert.equal(stageForStatus('WIP'), 'in_production');
        assert.equal(stageForStatus('Ready to dispatch'), 'in_production');
        assert.equal(stageForStatus('Out of stock'), 'on_hold');
        assert.equal(stageForStatus('In Transit'), 'dispatched');
        assert.equal(stageForStatus('Return'), null);
        for (const s of ['approved', 'in_production', 'on_hold', 'dispatched', 'delivered'] as const) assert.equal(stageForStatus(statusForStage(s)!), s);
    });

    test("the admin's step keeps a status that already means it", () => {
        assert.equal(nextLineStatus('Ready to dispatch', 'in_production'), 'Ready to dispatch');
        assert.equal(nextLineStatus('Ready to dispatch', 'dispatched'), 'Dispatched');
        assert.equal(nextLineStatus(null, 'approved'), 'Not updated');
        assert.equal(nextLineStatus('WIP', 'rejected'), null);
    });

    test('FRP design, colours and where to send it come from the line', () => {
        const d = designOf([{ label: 'Brand', value: 'Autoform' }, { label: 'Design', value: 'U-Focus' }, { label: 'Major colour', value: 'Black' }, { label: 'Minor colour', value: 'White' }, { label: 'Dispatch to', value: 'Direct dispatch to Franchise' }]);
        assert.deepEqual(d, { design: 'U-Focus', major_colour: 'Black', minor_colour: 'White', dispatch_to: 'Direct dispatch to Franchise' });
        assert.deepEqual(designOf(undefined), { design: null, major_colour: null, minor_colour: null, dispatch_to: null });
    });
});

describe('pickDepot', () => {
    test('the store\'s last depot wins', () => {
        assert.equal(pickDepot({ last: 'jaipur', ludhiana: 3, jaipur: 1 }, { name: 'X', ludhiana: 9, jaipur: 0 })?.depot, 'jaipur');
    });
    test('no history: the distributor\'s only depot', () => {
        assert.equal(pickDepot({ last: null, ludhiana: 0, jaipur: 0 }, { name: 'X', ludhiana: 0, jaipur: 4 })?.depot, 'jaipur');
    });
    test('a distributor served by both depots, or none: the admin picks', () => {
        assert.equal(pickDepot({ last: null, ludhiana: 0, jaipur: 0 }, { name: 'Aman', ludhiana: 12, jaipur: 30 }), null);
        assert.equal(pickDepot({ last: null, ludhiana: 0, jaipur: 0 }, null), null);
    });
});
