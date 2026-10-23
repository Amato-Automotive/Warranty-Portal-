import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctEntry } from '../schemeCorrection.js';
import type { SchemeField } from '../schemeRules.js';

const fields: SchemeField[] = [
    { id: 'inv', label: 'Invoice photo', type: 'file', required: true, formats: ['image', 'pdf'], max_files: 2 },
    { id: 'no', label: 'Invoice number', type: 'text', required: true },
    { id: 'qty', label: 'Quantity', type: 'number', required: false },
    { id: 'when', label: 'Invoice date', type: 'date', required: false },
    { id: 'size', label: 'Size', type: 'select', required: false, options: ['S', 'M'] },
];
const file = (name: string) => ({ name, url: `https://x/${name}`, size: 1, ext: 'jpg' });
const entry = { answers: { no: 'INV-1', qty: '4' }, files: { inv: [file('a.jpg')] }, store_id: 's1' };

test('answers change one field at a time, in words; empty clears', () => {
    const r = correctEntry(fields, entry, { answers: { no: 'INV-11', qty: '', when: '2026-10-14', size: 'M' } });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.answers, { no: 'INV-11', when: '2026-10-14', size: 'M' });
    assert.deepEqual(r.changes, ['Invoice number: INV-1 → INV-11', 'Quantity: 4 → (empty)', 'Invoice date: (empty) → 2026-10-14', 'Size: (empty) → M']);
    assert.deepEqual(correctEntry(fields, entry, { answers: { no: 'INV-1' } }).changes, [], 'the same value is no change');
});

test('wrong values are refused, field by field', () => {
    const r = correctEntry(fields, entry, { answers: { qty: 'four', when: '14/10/2026', size: 'XL', unknown: 'x' } });
    assert.deepEqual(r.problems, ['Quantity must be a number', 'Invoice date is not a date', 'Size: choose one of the options']);
    assert.deepEqual(r.answers, entry.answers);
});

test('files: remove one, add one, and the field limit holds', () => {
    const r = correctEntry(fields, entry, { remove: ['https://x/a.jpg'], added: { inv: [file('b.jpg')] } });
    assert.deepEqual(r.files.inv.map(f => f.name), ['b.jpg']);
    assert.deepEqual(r.changes, ['Invoice photo: removed a.jpg', 'Invoice photo: added b.jpg']);
    assert.match(correctEntry(fields, entry, { added: { inv: [file('b.jpg'), file('c.jpg')] } }).problems[0], /up to 2 files/);
    assert.match(correctEntry(fields, entry, { added: { no: [file('b.jpg')] } }).problems[0], /does not have/);
    assert.deepEqual(correctEntry(fields, entry, { remove: ['https://x/a.jpg'] }).files, {}, 'a field with no file left is dropped');
});

test('moving to another store is one change, said with both names', () => {
    const r = correctEntry(fields, entry, { store_id: 's2', store_names: { from: 'Alpha Motors', to: 'Beta Cars' } });
    assert.equal(r.store_id, 's2');
    assert.deepEqual(r.changes, ['Moved from Alpha Motors to Beta Cars']);
    assert.deepEqual(correctEntry(fields, entry, { store_id: 's1' }).changes, []);
});
