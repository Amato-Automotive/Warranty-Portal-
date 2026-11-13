import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMinRatings, showableRating, DEFAULT_MIN_RATINGS } from '../storeRatingRules.js';

test('an average shows only from the minimum number of ratings', () => {
    assert.equal(showableRating(4.6, 5, 5), 4.6);
    assert.equal(showableRating(4.6, 4, 5), null);
    assert.equal(showableRating(5, 1, 5), null);
    assert.equal(showableRating(0, 0, 5), null);
    assert.equal(showableRating('4.64', '128', 5), 4.6);
    assert.equal(showableRating(null, 9, 5), null);
});

test('the minimum is a whole number from 1 to 100, else 5', () => {
    assert.equal(cleanMinRatings(10), 10);
    assert.equal(cleanMinRatings('3'), 3);
    assert.equal(cleanMinRatings(0), 1);
    assert.equal(cleanMinRatings(500), 100);
    assert.equal(cleanMinRatings(undefined), DEFAULT_MIN_RATINGS);
    assert.equal(cleanMinRatings('abc'), DEFAULT_MIN_RATINGS);
});

test('rounding happens once, and 5.0 means every rating is a 5', () => {
    assert.equal(showableRating(4.449, 10, 1), 4.4);
    assert.equal(showableRating(4.45, 10, 1), 4.5);
    assert.equal(showableRating(4.96, 10, 1), 4.9);
    assert.equal(showableRating(4.95, 10, 1), 4.9);
    assert.equal(showableRating(5, 3, 1), 5);
    assert.equal(showableRating(3.04, 10, 1), 3);
});
