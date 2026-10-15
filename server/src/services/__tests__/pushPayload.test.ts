import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, deadTokens, pushBody } from '../pushPayload.js';

describe('pushBody', () => {
  it('strips announcement HTML and entities', () => {
    assert.equal(pushBody('<p>New <b>scheme</b>&nbsp;live<br/>Plan &amp; save</p>'), 'New scheme live Plan & save');
  });
  it('truncates long messages with an ellipsis', () => {
    const out = pushBody('word '.repeat(100));
    assert.ok(out.length <= 180);
    assert.ok(out.endsWith('…'));
  });
  it('handles empty input', () => {
    assert.equal(pushBody(''), '');
  });
});

describe('deadTokens', () => {
  it('returns only tokens FCM says are gone for good', () => {
    const tokens = ['a', 'b', 'c', 'd'];
    const responses = [
      { success: true },
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      { success: false, error: { code: 'messaging/internal-error' } },
      { success: false, error: { code: 'messaging/invalid-registration-token' } },
    ];
    assert.deepEqual(deadTokens(tokens, responses), ['b', 'd']);
  });
});

describe('chunk', () => {
  it('splits into fixed-size batches', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });
});
