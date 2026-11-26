import { execFile } from 'child_process';
import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';

/**
 * Invoices may come as a PDF (warranty form, public QR form, admin replace).
 * A PDF is checked and shrunk on the server, since the browser can only
 * compress photos:
 *  - only where a PDF is allowed (the invoice), never as a photo;
 *  - 2 MB at most, as it arrives;
 *  - a real PDF (starts with %PDF-), not password-protected;
 *  - rewritten by Ghostscript at invoice quality (images ~150 dpi, text stays
 *    sharp), which also drops any scripts inside; the smaller file is kept.
 * Without Ghostscript the PDF is kept as it came, once it has passed the checks.
 */

export const PDF_MAX_BYTES = 2 * 1024 * 1024;

/** Whether an upload is a PDF, by its name, its type or its first bytes. */
export function isPdfUpload(originalname: string, mimetype: string, head: Buffer | null): boolean {
    return /\.pdf$/i.test(originalname) || mimetype === 'application/pdf' || Boolean(head && looksLikePdf(head));
}

/** A PDF starts with %PDF- within its first 1024 bytes. */
export function looksLikePdf(buf: Buffer): boolean {
    return buf.subarray(0, 1024).includes('%PDF-');
}

/** A password-protected PDF names an /Encrypt dictionary in its trailer. */
export function isEncryptedPdf(buf: Buffer): boolean {
    return /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(buf.toString('latin1'));
}

/** What is wrong with a PDF, or null when it may be kept. */
export function pdfProblem(buf: Buffer, size: number): string | null {
    if (size > PDF_MAX_BYTES) return `The invoice PDF is ${(size / 1024 / 1024).toFixed(1)} MB. Please upload a PDF of up to 2 MB, or a photo of the invoice.`;
    if (!size || !looksLikePdf(buf)) return 'This file is not a readable PDF. Please upload the invoice again, or a photo of it.';
    if (isEncryptedPdf(buf)) return 'This PDF is password-protected. Please upload one without a password, or a photo of the invoice.';
    return null;
}

let gsMissing = false;

/** Rewrites a PDF with Ghostscript at invoice quality; resolves with the new size, or null if it could not. */
export function shrinkPdf(input: string): Promise<{ before: number; after: number } | null> {
    if (gsMissing) return Promise.resolve(null);
    const out = `${input}.gs.pdf`;
    const args = ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dPDFSETTINGS=/ebook', '-dDetectDuplicateImages=true',
        '-dNOPAUSE', '-dBATCH', '-dQUIET', '-dSAFER', `-sOutputFile=${out}`, input];
    return new Promise(resolve => {
        execFile('gs', args, { timeout: 30_000 }, async (err: any) => {
            try {
                if (err) {
                    if (err.code === 'ENOENT') { gsMissing = true; console.warn('[PDF] Ghostscript (gs) is not installed; PDFs are kept as uploaded'); }
                    else console.warn('[PDF] Ghostscript could not rewrite', input, err.message);
                    return resolve(null);
                }
                const before = (await fs.promises.stat(input)).size;
                const made = await fs.promises.readFile(out);
                if (made.length > 0 && looksLikePdf(made) && made.length < before) {
                    await fs.promises.writeFile(input, made);
                    return resolve({ before, after: made.length });
                }
                resolve({ before, after: before });
            } catch (e: any) {
                console.warn('[PDF] shrink failed for', input, e?.message);
                resolve(null);
            } finally {
                fs.promises.unlink(out).catch(() => {});
            }
        });
    });
}

function filesOf(req: any): Express.Multer.File[] {
    if (req.file) return [req.file];
    if (Array.isArray(req.files)) return req.files;
    return req.files ? Object.values(req.files as Record<string, Express.Multer.File[]>).flat() : [];
}

/**
 * Runs after multer has saved the files (paths are still on disk) and before
 * attachPublicUrls. `allowed` says whether a PDF may come in this file's field.
 */
export function preparePdfs(allowed: (req: Request, file: Express.Multer.File) => boolean) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const files = filesOf(req);
        const reject = async (status: number, error: string) => {
            await Promise.allSettled(files.filter(f => f?.path).map(f => fs.promises.unlink(f.path)));
            res.status(status).json({ success: false, error });
        };
        try {
            for (const file of files) {
                if (!file?.path || !fs.existsSync(file.path)) continue;
                const buf = await fs.promises.readFile(file.path);
                if (!isPdfUpload(file.originalname, file.mimetype, buf)) continue;
                if (!allowed(req, file)) return reject(400, 'A PDF can only be uploaded as the invoice. Please upload a photo here.');
                const problem = pdfProblem(buf, file.size);
                if (problem) return reject(file.size > PDF_MAX_BYTES ? 413 : 400, problem);
                const r = await shrinkPdf(file.path);
                if (r && r.after < r.before) {
                    file.size = r.after;
                    console.log(`[PDF] ${file.originalname}: ${Math.round(r.before / 1024)} KB -> ${Math.round(r.after / 1024)} KB`);
                }
            }
            next();
        } catch (e: any) {
            console.error('[PDF] check failed:', e?.message);
            return reject(500, 'Could not read the uploaded PDF. Please try again.');
        }
    };
}
