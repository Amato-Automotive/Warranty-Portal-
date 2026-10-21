import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spreadsheetId, normaliseKey, readServiceAccount, matchTabTitle } from '../googleSheets.js';

/**
 * The parts that can be checked without calling Google.
 *
 * Every case here is a way the configuration goes wrong in practice: a URL
 * pasted from the browser rather than an id, a private key that lost its
 * newlines passing through an .env file.
 */

describe('spreadsheetId', () => {
    test('reads the id out of a pasted edit URL', () => {
        assert.equal(
            spreadsheetId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBd/edit#gid=0'),
            '1BxiMVs0XRA5nFMdKvBd',
        );
    });

    test('reads it from a link with query parameters', () => {
        assert.equal(
            spreadsheetId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBd/edit?usp=sharing'),
            '1BxiMVs0XRA5nFMdKvBd',
        );
    });

    test('a bare id is accepted as it is', () => {
        assert.equal(spreadsheetId('1BxiMVs0XRA5nFMdKvBdabcdefghij'), '1BxiMVs0XRA5nFMdKvBdabcdefghij');
    });

    // Refused rather than guessed: a wrong id reads somebody else's sheet or
    // nothing, and both are worse than saying so.
    test('anything that is not one is refused', () => {
        assert.equal(spreadsheetId(''), null);
        assert.equal(spreadsheetId('   '), null);
        assert.equal(spreadsheetId('not a link'), null);
        assert.equal(spreadsheetId('https://example.com/file/d/abc'), null);
        assert.equal(spreadsheetId('short'), null);
    });
});

describe('normaliseKey', () => {
    // PEM parsing fails on "\n" written as two characters, and says neither
    // which variable nor why.
    test('escaped newlines become real ones', () => {
        assert.equal(
            normaliseKey('-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----'),
            '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
        );
    });

    test('a key that already has real newlines is left alone', () => {
        const key = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';
        assert.equal(normaliseKey(key), key);
    });
});

describe('readServiceAccount', () => {
    test('reads the whole JSON blob', () => {
        const account = readServiceAccount({
            GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
                client_email: 'sync@project.iam.gserviceaccount.com',
                private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
            }),
        } as NodeJS.ProcessEnv);

        assert.equal(account?.client_email, 'sync@project.iam.gserviceaccount.com');
        assert.ok(account?.private_key.includes('\n'));
    });

    test('falls back to the two separate variables', () => {
        const account = readServiceAccount({
            GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sync@project.iam.gserviceaccount.com',
            GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
        } as NodeJS.ProcessEnv);

        assert.equal(account?.client_email, 'sync@project.iam.gserviceaccount.com');
        assert.ok(account?.private_key.includes('\n'));
    });

    test('nothing configured is null, not a crash', () => {
        assert.equal(readServiceAccount({} as NodeJS.ProcessEnv), null);
    });

    // Malformed JSON must not take down whatever asked for the credentials.
    test('a broken blob is null, not a throw', () => {
        assert.equal(readServiceAccount({
            GOOGLE_SERVICE_ACCOUNT_JSON: '{not json',
        } as NodeJS.ProcessEnv), null);
    });

    test('a blob missing either field is refused', () => {
        assert.equal(readServiceAccount({
            GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b.com' }),
        } as NodeJS.ProcessEnv), null);
    });
});

describe('matchTabTitle', () => {
    const tabs = ['AD1', 'Ad New 1 '];
    test('an exact name wins', () => assert.equal(matchTabTitle(tabs, 'AD1'), 'AD1'));
    test('a trailing space nobody can see does not matter', () => assert.equal(matchTabTitle(tabs, 'Ad New 1'), 'Ad New 1 '));
    test('nor do capitals or doubled spaces', () => assert.equal(matchTabTitle(tabs, 'ad  new 1'), 'Ad New 1 '));
    test('no match is null', () => assert.equal(matchTabTitle(tabs, 'Ad New 2'), null));
});
