import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseFollowUp, summariseFollowUps, followUpFigures, NOTE_MAX, DAY_MS } from '../leadFollowUp.js';

describe('parseFollowUp', () => {
    test('accepts a call with an outcome and tidies the note', () => {
        const r = parseFollowUp({ channel: 'call', outcome: 'interested', note: '  wants   SUV size \n tomorrow ' });
        assert.deepEqual(r, { ok: true, value: { channel: 'call', outcome: 'interested', note: 'wants SUV size tomorrow' } });
    });

    test('an empty note is stored as none', () => {
        const r = parseFollowUp({ channel: 'whatsapp', outcome: 'no_answer', note: '   ' });
        assert.equal(r.ok && r.value.note, null);
    });

    test('refuses an unknown channel or outcome', () => {
        assert.equal(parseFollowUp({ channel: 'email', outcome: 'interested' }).ok, false);
        assert.equal(parseFollowUp({ channel: 'call', outcome: 'maybe' }).ok, false);
        assert.equal(parseFollowUp({}).ok, false);
        assert.equal(parseFollowUp(null).ok, false);
    });

    test('refuses an overlong note', () => {
        assert.equal(parseFollowUp({ channel: 'visit', outcome: 'bought', note: 'x'.repeat(NOTE_MAX + 1) }).ok, false);
    });
});

describe('summariseFollowUps', () => {
    test('none gives nothing', () => assert.equal(summariseFollowUps([]), null));

    test('counts, first time and the latest, whatever order they arrive in', () => {
        const s = summariseFollowUps([
            { channel: 'call', outcome: 'interested', note: null, created_at: '2026-10-02T10:00:00Z' },
            { channel: 'whatsapp', outcome: 'no_answer', note: null, created_at: '2026-10-01T09:00:00Z' },
        ]);
        assert.equal(s?.count, 2);
        assert.equal(s?.first_at, '2026-10-01T09:00:00Z');
        assert.equal(s?.last.channel, 'call');
    });
});

describe('followUpFigures', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    const ago = (h: number) => new Date(now - h * 3600_000).toISOString();

    test('on time, late, and not yet due', () => {
        const f = followUpFigures([
            { received_at: ago(48), first_at: ago(40) },   // contacted within a day
            { received_at: ago(72), first_at: ago(20) },   // contacted, but late
            { received_at: ago(30), first_at: null },      // day is up, never contacted
            { received_at: ago(5), first_at: null },       // still in time: not counted yet
        ], now);
        assert.deepEqual(f, { sent: 4, contacted: 2, within_24h: 1, due: 3, within_24h_pct: 33 });
    });

    test('exactly a day counts as on time', () => {
        const got = now - 2 * DAY_MS;
        const f = followUpFigures([{ received_at: new Date(got), first_at: new Date(got + DAY_MS) }], now);
        assert.equal(f.within_24h, 1);
    });

    test('nothing due gives no percentage', () => {
        assert.equal(followUpFigures([{ received_at: ago(2), first_at: null }], now).within_24h_pct, null);
        assert.equal(followUpFigures([], now).within_24h_pct, null);
    });
});
