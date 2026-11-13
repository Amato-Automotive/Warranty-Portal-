import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestIdFromCallback, starsFromButton } from '../storeRatingButtons.js';

const ID = '0b6c1c9e-4f7a-4d51-9a55-2f1f3c7e8a10';

test('the request id comes out of the callback data, and nothing else is taken for one', () => {
    assert.equal(requestIdFromCallback(`store_experience_rating_${ID}`), ID);
    assert.equal(requestIdFromCallback(`store_experience_rating_${ID.toUpperCase()}`), ID);
    assert.equal(requestIdFromCallback('franchise_verify_123'), null);
    assert.equal(requestIdFromCallback('store_experience_rating_'), null);
    assert.equal(requestIdFromCallback('store_experience_rating_abc'), null);
    assert.equal(requestIdFromCallback(undefined), null);
});

test('stars are read from a digit, star symbols or a word', () => {
    assert.equal(starsFromButton('5'), 5);
    assert.equal(starsFromButton('4 ★'), 4);
    assert.equal(starsFromButton('★★★'), 3);
    assert.equal(starsFromButton('⭐⭐⭐⭐⭐'), 5);
    assert.equal(starsFromButton('Excellent'), 5);
    assert.equal(starsFromButton('Very good'), 4);
    assert.equal(starsFromButton('Okay'), 3);
    assert.equal(starsFromButton('Poor'), 2);
    assert.equal(starsFromButton('Terrible'), 1);
    assert.equal(starsFromButton('1 star'), 1);
});

test('a label that is not stars is not a rating', () => {
    assert.equal(starsFromButton(''), null);
    assert.equal(starsFromButton(null), null);
    assert.equal(starsFromButton('Rate now'), null);
    assert.equal(starsFromButton('6'), null);
    assert.equal(starsFromButton('Approve Installation'), null);
});
