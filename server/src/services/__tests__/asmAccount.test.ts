import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAsmName } from '../asmAccount.service.js';

describe('cleanAsmName', () => {
    test('keeps a plain name and its case', () => {
        assert.equal(cleanAsmName('Haider Ali'), 'Haider Ali');
        assert.equal(cleanAsmName('PROSENJIT DAS'), 'PROSENJIT DAS');
    });

    test('collapses and trims whitespace', () => {
        assert.equal(cleanAsmName('  Syed   Tariq\tPeer '), 'Syed Tariq Peer');
    });

    test('allows dots, apostrophes and hyphens after the first letter', () => {
        assert.equal(cleanAsmName('Mr. A.K. Sharma'), 'Mr. A.K. Sharma');
        assert.equal(cleanAsmName("D'Souza-Rao"), "D'Souza-Rao");
    });

    test('allows names in Indian scripts', () => {
        assert.equal(cleanAsmName('अनिल शर्मा'), 'अनिल शर्मा');
    });

    test('refuses blank, too short and too long', () => {
        assert.equal(cleanAsmName(''), null);
        assert.equal(cleanAsmName('   '), null);
        assert.equal(cleanAsmName(undefined), null);
        assert.equal(cleanAsmName('A'), null);
        assert.equal(cleanAsmName('A'.repeat(61)), null);
    });

    test('refuses digits, symbols and a leading punctuation mark', () => {
        assert.equal(cleanAsmName('Anil 9876543210'), null);
        assert.equal(cleanAsmName('anil@autoform'), null);
        assert.equal(cleanAsmName('<b>Anil</b>'), null);
        assert.equal(cleanAsmName('.Anil'), null);
    });
});
