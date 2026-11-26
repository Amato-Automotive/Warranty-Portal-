import { execFile } from 'child_process';
import fs from 'fs';
import sharp from 'sharp';
import type { Request, Response, NextFunction } from 'express';

/**
 * Invoices may come as a PDF (warranty form, public QR form, admin replace).
 * The browser can only compress photos, so a PDF is handled here:
 *  - only where a PDF is allowed (the invoice), never as a photo;
 *  - up to 10 MB as it arrives (a phone scan), a real PDF (%PDF-), no password;
 *  - Ghostscript rewrites it at invoice quality (images ~150 dpi, text stays
 *    sharp, scripts dropped); if it is still over 2 MB, a second, stronger
 *    pass (~72 dpi); the smaller file is kept;
 *  - only if it is still over 2 MB after that is it refused;
 *  - its pages (up to 10) are saved as one tall picture beside it
 *    (<file>.preview.jpg), so admins scroll through it like a photo.
 * If Ghostscript is missing or fails, a PDF of up to 2 MB is kept as it came.
 */

export const PDF_MAX_BYTES = 2 * 1024 * 1024;     // what is kept
export const PDF_MAX_UPLOAD = 10 * 1024 * 1024;   // what may be picked
export const PREVIEW_SUFFIX = '.preview.jpg';

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

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

/** What is wrong with a PDF as it arrives, or null when it may go on to be shrunk. */
export function pdfProblem(buf: Buffer, size: number): string | null {
    if (size > PDF_MAX_UPLOAD) return `The invoice PDF is ${mb(size)} MB. Please upload a PDF of up to 10 MB, or a photo of the invoice.`;
    if (!size || !looksLikePdf(buf)) return 'This file is not a readable PDF. Please upload the invoice again, or a photo of it.';
    if (isEncryptedPdf(buf)) return 'This PDF is password-protected. Please upload one without a password, or a photo of the invoice.';
    return null;
}

/** The message when a PDF is still too big after shrinking (or could not be shrunk). */
export const tooBigAfterShrink = (size: number) =>
    `This invoice PDF is still ${mb(size)} MB after compressing. Please upload a smaller PDF (fewer pages), or a photo of the invoice.`;

let gsMissing = false;

function gs(args: string[]): Promise<boolean> {
    if (gsMissing) return Promise.resolve(false);
    return new Promise(resolve => {
        execFile('gs', ['-dNOPAUSE', '-dBATCH', '-dQUIET', '-dSAFER', ...args], { timeout: 45_000 }, (err: any) => {
            if (err) {
                if (err.code === 'ENOENT') { gsMissing = true; console.warn('[PDF] Ghostscript (gs) is not installed; PDFs are kept as uploaded'); }
                else console.warn('[PDF] Ghostscript failed:', err.message);
            }
            resolve(!err);
        });
    });
}

/**
 * Rewrites a PDF with Ghostscript at the given quality and keeps the result
 * only if it is a valid, smaller PDF. Resolves with the sizes, or null if it could not run.
 */
export async function shrinkPdf(input: string, quality: 'ebook' | 'screen' = 'ebook'): Promise<{ before: number; after: number } | null> {
    const out = `${input}.gs.pdf`;
    try {
        const ok = await gs(['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=/${quality}`, '-dDetectDuplicateImages=true', `-sOutputFile=${out}`, input]);
        if (!ok) return null;
        const before = (await fs.promises.stat(input)).size;
        const made = await fs.promises.readFile(out);
        if (made.length > 0 && looksLikePdf(made) && made.length < before) {
            await fs.promises.writeFile(input, made);
            return { before, after: made.length };
        }
        return { before, after: before };
    } catch (e: any) {
        console.warn('[PDF] shrink failed for', input, e?.message);
        return null;
    } finally {
        fs.promises.unlink(out).catch(() => {});
    }
}

export const PREVIEW_MAX_PAGES = 10;

/**
 * Saves the PDF's pages (up to 10) as one tall JPEG beside it
 * (<file>.preview.jpg), page under page with a thin gap, so an admin can
 * scroll through the invoice like a photo. Never fails the upload.
 */
export async function renderPreview(pdfPath: string): Promise<boolean> {
    const out = `${pdfPath}${PREVIEW_SUFFIX}`;
    const pagePattern = `${pdfPath}.page-%02d.jpg`;
    const pageFiles = Array.from({ length: PREVIEW_MAX_PAGES }, (_, i) => `${pdfPath}.page-${String(i + 1).padStart(2, '0')}.jpg`);
    try {
        const ok = await gs(['-sDEVICE=jpeg', '-dJPEGQ=82', '-r110', '-dFirstPage=1', `-dLastPage=${PREVIEW_MAX_PAGES}`, '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4', `-sOutputFile=${pagePattern}`, pdfPath]);
        const pages = pageFiles.filter(f => fs.existsSync(f));
        if (!ok || !pages.length) return false;
        if (pages.length === 1) { await fs.promises.rename(pages[0], out); return true; }
        /* Pages one below the other, each at the widest page's width, with an 12 px grey gap. */
        const metas = await Promise.all(pages.map(f => sharp(f).metadata()));
        const width = Math.max(...metas.map(m => m.width ?? 0));
        const GAP = 12;
        let top = 0;
        const layers = pages.map((f, i) => { const at = top; top += (metas[i].height ?? 0) + GAP; return { input: f, top: at, left: 0 }; });
        await sharp({ create: { width, height: top - GAP, channels: 3, background: '#cbd5e1' } })
            .composite(layers).jpeg({ quality: 80, mozjpeg: true }).toFile(out);
        return true;
    } catch (e: any) {
        console.warn('[PDF] preview failed for', pdfPath, e?.message);
        fs.promises.unlink(out).catch(() => {});
        return false;
    } finally {
        for (const f of pageFiles) fs.promises.unlink(f).catch(() => {});
    }
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
            const pdfs: Express.Multer.File[] = [];
            for (const file of files) {
                if (!file?.path || !fs.existsSync(file.path)) continue;
                const buf = await fs.promises.readFile(file.path);
                if (!isPdfUpload(file.originalname, file.mimetype, buf)) continue;
                if (!allowed(req, file)) return reject(400, 'A PDF can only be uploaded as the invoice. Please upload a photo here.');
                const problem = pdfProblem(buf, file.size);
                if (problem) return reject(file.size > PDF_MAX_UPLOAD ? 413 : 400, problem);

                const start = file.size;
                let r = await shrinkPdf(file.path, 'ebook');
                if (r && r.after > PDF_MAX_BYTES) r = (await shrinkPdf(file.path, 'screen')) ?? r;
                file.size = (await fs.promises.stat(file.path)).size;
                if (file.size < start) console.log(`[PDF] ${file.originalname}: ${Math.round(start / 1024)} KB -> ${Math.round(file.size / 1024)} KB`);
                if (file.size > PDF_MAX_BYTES) return reject(413, tooBigAfterShrink(file.size));
                pdfs.push(file);
            }
            /* Every file has passed: now the page-1 pictures for the admin. */
            for (const file of pdfs) await renderPreview(file.path);
            next();
        } catch (e: any) {
            console.error('[PDF] check failed:', e?.message);
            return reject(500, 'Could not read the uploaded PDF. Please try again.');
        }
    };
}
