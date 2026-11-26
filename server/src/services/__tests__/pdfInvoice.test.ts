import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isEncryptedPdf, isPdfUpload, looksLikePdf, pdfProblem, PDF_MAX_BYTES } from '../pdfInvoice.js';

const pdf = (body = '') => Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n${body}\ntrailer << /Root 1 0 R >>\n%%EOF`, 'latin1');

describe('invoice PDFs', () => {
    test('a PDF is known by its name, its type or its first bytes', () => {
        assert.equal(isPdfUpload('bill.PDF', 'application/octet-stream', null), true);
        assert.equal(isPdfUpload('bill', 'application/pdf', null), true);
        assert.equal(isPdfUpload('bill.jpg', 'image/jpeg', pdf()), true);
        assert.equal(isPdfUpload('photo.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff])), false);
    });

    test('a file named .pdf that is not one is refused', () => {
        assert.equal(looksLikePdf(Buffer.from('<html>hello</html>')), false);
        assert.match(pdfProblem(Buffer.from('<html>hello</html>'), 18)!, /not a readable PDF/);
        assert.match(pdfProblem(Buffer.alloc(0), 0)!, /not a readable PDF/);
    });

    test('over 2 MB is refused; 2 MB exactly is fine', () => {
        assert.match(pdfProblem(pdf(), PDF_MAX_BYTES + 1)!, /up to 2 MB/);
        assert.equal(pdfProblem(pdf(), PDF_MAX_BYTES), null);
    });

    test('a password-protected PDF is refused', () => {
        const locked = pdf().toString('latin1').replace('trailer << /Root 1 0 R >>', 'trailer << /Root 1 0 R /Encrypt 5 0 R >>');
        assert.equal(isEncryptedPdf(Buffer.from(locked, 'latin1')), true);
        assert.match(pdfProblem(Buffer.from(locked, 'latin1'), 500)!, /password-protected/);
        assert.equal(isEncryptedPdf(pdf()), false);
    });

    test('an ordinary invoice PDF passes', () => {
        assert.equal(pdfProblem(pdf('2 0 obj << /Type /Page >> endobj'), 120_000), null);
    });
});
