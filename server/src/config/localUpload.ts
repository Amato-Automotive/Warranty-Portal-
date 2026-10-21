/**
 * Local disk upload utility — replaces Cloudinary storage
 * Organizes uploads into monthly subdirectories: uploads/{folder}/YYYY-MM/{filename}
 * Naming convention: {uid}_{fieldName}_{originalName}_{timestamp}.{ext} (same as Cloudinary)
 * Image compression is handled client-side (imageCompression.ts) — no server compression needed
 */
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import sharp from 'sharp';
import convertHeic from 'heic-convert';

const UPLOADS_BASE_DIR = process.env.UPLOADS_BASE_DIR || '/home/deploy/uploads';
const APP_URL = process.env.APP_URL || 'https://api.autoformindia.co.in';

export { UPLOADS_BASE_DIR, APP_URL };

/** Convert a public HTTPS URL (as stored in product_details) back to its absolute disk path */
export function urlToDiskPath(url: string): string {
    const relative = url.replace(APP_URL, '').replace(/^\/uploads/, '');
    return path.join(UPLOADS_BASE_DIR, relative);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Get current YYYY-MM folder name */
function getMonthFolder(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/** Ensure directory exists, create recursively if not */
function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Detect HEIC/HEIC-sequence containers by their ISO-BMFF ftyp box, regardless of
 * filename/extension. iPhones sometimes hand browsers a HEIC file that a client-side
 * canvas failed to convert; the server-generated filename always ends in .jpg/.jpeg
 * for these (see warrantyFileName), which makes extension-based checks unreliable.
 */
export function isHeicBuffer(buf: Buffer): boolean {
    if (buf.length < 12) return false;
    const boxType = buf.toString('ascii', 4, 8);
    if (boxType !== 'ftyp') return false;
    const brand = buf.toString('ascii', 8, 12);
    return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand);
}

/** Convert absolute disk path → public HTTPS URL */
function diskPathToUrl(absolutePath: string): string {
    const normalized = absolutePath.replace(/\\/g, '/');
    const base = UPLOADS_BASE_DIR.replace(/\\/g, '/');
    const relative = normalized.replace(base, '');
    return `${APP_URL}/uploads${relative}`;
}

/** Build destination function for a given subfolder */
function createDestination(folder: string) {
    return (req: Request, file: Express.Multer.File, cb: (error: any, destination: string) => void) => {
        const monthFolder = getMonthFolder();
        const destDir = path.join(UPLOADS_BASE_DIR, folder, monthFolder);
        ensureDir(destDir);
        cb(null, destDir);
    };
}

// ─── Filename Strategies ─────────────────────────────────────────────────────

/**
 * Warranty naming: {uid}_{fieldName}_{originalName}_{timestamp}.{ext}
 * Matches the existing Cloudinary public_id convention.
 * HEIC/HEIF files get .jpg extension (already converted by client compression).
 */
function warrantyFileName(
    req: Request,
    file: Express.Multer.File,
    cb: (error: any, filename: string) => void
) {
    let uid = 'UNKNOWN';
    try {
        if (req.body?.productDetails) {
            const pd =
                typeof req.body.productDetails === 'string'
                    ? JSON.parse(req.body.productDetails)
                    : req.body.productDetails;
            // A seat cover's UID, else the PPF roll the photos belong to. PPF
            // sends its rolls as a list now, and the warranty's own id does not
            // exist yet at upload time, so the first serial is what names the
            // file — the same value the single serialNumber field used to give.
            uid = pd.uid || pd.rolls?.[0]?.serial || pd.serialNumber || 'NO_UID';
        }
    } catch (_e) { /* ignore parse errors */ }

    const fieldName = file.fieldname || 'upload';
    const originalBase = file.originalname
        .split('.')[0]
        .replace(/[^a-zA-Z0-9]/g, '_')
        .substring(0, 20);
    const timestamp = Date.now();
    const rawExt = (file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const ext = ['heic', 'heif'].includes(rawExt) ? 'jpg' : rawExt;

    cb(null, `${uid}_${fieldName}_${originalBase}_${timestamp}.${ext}`);
}

/**
 * Generic naming: {fieldName}_{originalName}_{timestamp}.{ext}
 * Used by POSM, grievance, and broadcast routes.
 */
function genericFileName(
    req: Request,
    file: Express.Multer.File,
    cb: (error: any, filename: string) => void
) {
    const fieldName = file.fieldname || 'upload';
    const originalBase = file.originalname
        .split('.')[0]
        .replace(/[^a-zA-Z0-9]/g, '_')
        .substring(0, 30);
    const timestamp = Date.now();
    const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase();

    cb(null, `${fieldName}_${originalBase}_${timestamp}.${ext}`);
}

// ─── Public URL Middleware ────────────────────────────────────────────────────

/**
 * After multer saves files to disk, replace each file.path (absolute disk path)
 * with its public HTTPS URL. This means existing controllers that read file.path
 * continue to work without any changes.
 */
export async function attachPublicUrls(req: any, res: Response, next: NextFunction): Promise<void> {
    // 1. Gather all files
    const allFiles: Express.Multer.File[] = [];
    if (req.file) allFiles.push(req.file);
    if (req.files) {
        if (Array.isArray(req.files)) {
            allFiles.push(...req.files);
        } else {
            Object.values(req.files as Record<string, Express.Multer.File[]>).forEach(arr => {
                allFiles.push(...arr);
            });
        }
    }

    // 2. Transcode any HEIC/HEIC-sequence bytes to real JPEG, regardless of what
    // extension the file was saved with. Client-side compression is supposed to do
    // this in the browser, but silently falls back to the raw HEIC file on decode
    // failure (e.g. non-Safari browsers can't canvas-decode HEIC) — that raw HEIC
    // then gets renamed to .jpg by warrantyFileName() without its bytes changing.
    // Detecting by magic bytes (not originalname/extension) catches it either way.
    for (const file of allFiles) {
        if (!file?.path || !fs.existsSync(file.path)) continue;
        const looksLikeImage = /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(file.originalname) ||
            /\.(jpg|jpeg|png|webp)$/i.test(file.path);
        if (!looksLikeImage) continue;

        try {
            const head = await fs.promises.readFile(file.path);
            if (isHeicBuffer(head)) {
                const jpegBuffer = await convertHeic({
                    buffer: head,
                    format: 'JPEG',
                    quality: 0.8,
                }) as Buffer;
                await fs.promises.writeFile(file.path, jpegBuffer);
                file.size = jpegBuffer.length;
                console.log(`[Upload] Transcoded HEIC->JPEG for ${file.originalname} (${file.path})`);
            }
        } catch (error) {
            console.error(`[Upload] HEIC transcode failed for ${file.originalname}:`, error);
            // Leave the file as-is; the integrity check below will reject it
            // since sharp/decode will fail on genuinely broken HEIC bytes too.
        }
    }

    // 3. Validate Image Integrity
    let hasCorruption = false;
    for (const file of allFiles) {
        if (!file?.path || !fs.existsSync(file.path)) continue;

        // Only validate images (skip PDFs, Excel, etc.) — check both the client's
        // original filename and the server-saved path, since HEIC uploads are saved
        // with a .jpg extension even before the transcode step above runs.
        const isImage = /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(file.originalname) ||
            /\.(jpg|jpeg|png|webp)$/i.test(file.path);
        if (isImage) {
            if (file.size === 0) {
                hasCorruption = true;
                break;
            }

            try {
                // .stats() forces sharp to decode the image, immediately throwing
                // if the file was truncated by a dropped network connection, or if
                // it's still an undecodable format after the transcode step above.
                await sharp(file.path).stats();
            } catch (error) {
                console.error(`[Upload] Image corrupted during transit: ${file.originalname}`, error);
                hasCorruption = true;
                break;
            }
        }
    }

    // 4. Reject if corrupted
    if (hasCorruption) {
        // Cleanup all files from this request.
        // Use async unlink with try/catch — unlinkSync can throw EPERM if multer's
        // WriteStream hasn't fully released the file handle yet.
        await Promise.allSettled(
            allFiles
                .filter(file => file?.path && fs.existsSync(file.path))
                .map(file => fs.promises.unlink(file.path).catch(err =>
                    console.warn(`[Upload] Cleanup failed for ${file.path}:`, err.message)
                ))
        );
        res.status(400).json({
            success: false,
            error: "Submission failed due to slow or dropped internet connection. Please check your connection and try again."
        });
        return;
    }

    // 5. Attach Public URLs for successful uploads
    const patchFile = (file: any) => {
        if (file?.path) {
            file.path = diskPathToUrl(file.path);
        }
    };
    allFiles.forEach(patchFile);

    next();
}

// ─── Pre-built Upload Instances ───────────────────────────────────────────────

/** Warranty & public QR warranty uploads → uploads/warranty-portal/YYYY-MM/ */
export const warrantyUpload = multer({
    storage: multer.diskStorage({
        destination: createDestination('warranty-portal'),
        filename: warrantyFileName,
    }),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB (already compressed client-side)
        files: 6,                   // invoice + up to 5 photos
    },
    fileFilter: (_req, file, cb) => {
        const ext = (file.originalname.split('.').pop() || '').toLowerCase();
        const allowedExts = ['jpg', 'jpeg', 'png', 'heic', 'heif'];
        const allowedMimes = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/jpg'];
        if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`File type not allowed: ${file.originalname}`));
        }
    },
});

/** Broadcast / announcement uploads → uploads/broadcasts/YYYY-MM/ */
export const broadcastUpload = multer({
    storage: multer.diskStorage({
        destination: createDestination('broadcasts'),
        filename: genericFileName,
    }),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB for videos
    },
});

/** POSM request uploads → uploads/posm_requests/YYYY-MM/ */
export const posmUpload = multer({
    storage: multer.diskStorage({
        destination: createDestination('posm_requests'),
        filename: genericFileName,
    }),
    limits: {
        fileSize: 20 * 1024 * 1024, // 20MB for videos/excel
        files: 5,
    },
});

/** POSM item requests: a file per item line (visiting-card photos, art-work
 *  places) plus a note's own → uploads/posm_requests/YYYY-MM/. Images and PDFs only. */
export const posmItemUpload = multer({
    storage: multer.diskStorage({
        destination: createDestination('posm_requests'),
        filename: genericFileName,
    }),
    limits: {
        fileSize: 20 * 1024 * 1024,
        files: 20,
    },
    fileFilter: (_req, file, cb) => {
        const ext = (file.originalname.split('.').pop() || '').toLowerCase();
        if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'].includes(ext) || /^image\//.test(file.mimetype) || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error(`Only photos and PDFs can be attached: ${file.originalname}`));
        }
    },
});

/** Review & Feedback photos → uploads/feedback/YYYY-MM/. Images only. */
export const feedbackUpload = multer({
    storage: multer.diskStorage({
        destination: createDestination('feedback'),
        filename: genericFileName,
    }),
    limits: { fileSize: 15 * 1024 * 1024, files: 20 },
    fileFilter: (_req, file, cb) => {
        const ext = (file.originalname.split('.').pop() || '').toLowerCase();
        if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext) || /^image\//.test(file.mimetype)) cb(null, true);
        else cb(new Error(`Only photos can be attached: ${file.originalname}`));
    },
});

/** Offers & Schemes: banners and the stores' entry files → uploads/schemes/YYYY-MM/.
 *  Which formats a field accepts is the scheme's own rule, checked after upload. */
export const schemeUpload = multer({
    storage: multer.diskStorage({
        destination: createDestination('schemes'),
        filename: genericFileName,
    }),
    limits: {
        fileSize: 50 * 1024 * 1024, // the field's own limit is checked too; this is the ceiling for videos
        files: 20,
    },
});

/** Grievance uploads → uploads/grievances/YYYY-MM/ */
export const grievanceUpload = multer({
    storage: multer.diskStorage({
        destination: createDestination('grievances'),
        filename: genericFileName,
    }),
    limits: {
        // 20MB, matching POSM: a grievance can carry a video of the fault, and
        // 5MB rejected any clip a phone produces. The browser compresses first,
        // so this is the ceiling for what arrives, not what was filmed.
        fileSize: 20 * 1024 * 1024,
        files: 3,
    },
});
