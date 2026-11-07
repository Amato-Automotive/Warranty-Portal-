/**
 * RAW photos (.dng) from phone cameras, made usable.
 *
 * A DNG is a TIFF container that carries the sensor data and, next to it, a
 * ready-made JPEG preview of the same picture. Browsers cannot show the sensor
 * data, but the preview is an ordinary JPEG, so it is taken out and used as the
 * photo; the normal compression then brings it to size.
 *
 * Everything that works on bytes is pure (no browser), so it is tested directly.
 */

export const isDng = (file: { name: string; type?: string }): boolean =>
    /\.dng$/i.test(file.name) || /^image\/(x-adobe-dng|dng)$/i.test(file.type ?? "");

/** A preview smaller than this (about 0.3 megapixel) is a thumbnail: too coarse to read an invoice or a sticker. */
const MIN_PIXELS = 300_000;

export interface JpegCandidate { start: number; end: number; width: number; height: number }

/**
 * Walk one JPEG that starts at `start` (at its FF D8) and return where it ends
 * and its size, or null when it is not a normal viewable JPEG — a damaged one, or
 * the lossless JPEG a DNG keeps its sensor data in.
 */
function walkJpeg(b: Uint8Array, start: number): JpegCandidate | null {
    let i = start + 2;
    let width = 0, height = 0, sawFrame = false;
    while (i + 1 < b.length) {
        if (b[i] !== 0xff) return null;
        while (b[i] === 0xff && i + 1 < b.length) i++;      // fill bytes
        const marker = b[i++];
        if (marker === 0xd9) return sawFrame && width > 0 ? { start, end: i, width, height } : null;   // EOI
        if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) continue;         // no length
        if (i + 2 > b.length) return null;
        const len = (b[i] << 8) | b[i + 1];
        if (len < 2) return null;
        const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isFrame) {
            /* Only baseline, extended and progressive are viewable; C3 and C5–CF are lossless/arithmetic/hierarchical. */
            if (marker !== 0xc0 && marker !== 0xc1 && marker !== 0xc2) return null;
            height = (b[i + 3] << 8) | b[i + 4];
            width = (b[i + 5] << 8) | b[i + 6];
            sawFrame = true;
        }
        i += len;
        if (marker === 0xda) {
            /* Start of scan: the picture data runs on until the next real marker (FF followed by neither 00 nor a restart). */
            while (i + 1 < b.length) {
                if (b[i] === 0xff && b[i + 1] !== 0x00 && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7) && b[i + 1] !== 0xff) break;
                i++;
            }
            if (i + 1 >= b.length) return null;
        }
    }
    return null;
}

/** The largest viewable JPEG inside the bytes, if it is big enough to be a real preview. */
export function extractJpegPreview(b: Uint8Array): JpegCandidate | null {
    let best: JpegCandidate | null = null;
    for (let i = 0; i + 3 < b.length; i++) {
        if (b[i] !== 0xff || b[i + 1] !== 0xd8 || b[i + 2] !== 0xff) continue;
        const c = walkJpeg(b, i);
        if (!c) continue;
        if (!best || c.width * c.height > best.width * best.height) best = c;
        i = c.end - 1;                                       // nothing starts inside a finished picture
    }
    return best && best.width * best.height >= MIN_PIXELS ? best : null;
}

/** The Orientation (1–8) written in a TIFF block's first directory, or 0 when there is none. */
export function tiffOrientation(b: Uint8Array, at: number): number {
    if (at + 8 > b.length) return 0;
    const le = b[at] === 0x49 && b[at + 1] === 0x49;
    if (!le && !(b[at] === 0x4d && b[at + 1] === 0x4d)) return 0;
    const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
    const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
    if (u16(at + 2) !== 42) return 0;
    const ifd = at + u32(at + 4);
    if (ifd + 2 > b.length) return 0;
    const n = u16(ifd);
    for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 12 > b.length) return 0;
        if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
    }
    return 0;
}

/** Does this JPEG carry its own Orientation (in its Exif block)? Then the browser already turns it upright. */
export function jpegOrientation(b: Uint8Array, c: JpegCandidate): number {
    let i = c.start + 2;
    while (i + 4 < c.end) {
        if (b[i] !== 0xff) return 0;
        const marker = b[i + 1];
        const len = (b[i + 2] << 8) | b[i + 3];
        if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) return tiffOrientation(b, i + 10);
        if (marker === 0xda) return 0;
        i += 2 + len;
    }
    return 0;
}

/** Why a RAW photo could not be turned into a normal one. */
export class RawPhotoError extends Error {
    constructor() { super("This RAW (.dng) photo could not be converted. Please choose a normal photo (JPG or HEIC)."); this.name = "RawPhotoError"; }
}

/**
 * A .dng as an ordinary JPEG file (same name, .jpg), upright. Throws RawPhotoError
 * when the file holds no usable preview.
 */
export async function dngToJpeg(file: File): Promise<File> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const found = extractJpegPreview(bytes);
    if (!found) throw new RawPhotoError();
    const jpeg = bytes.slice(found.start, found.end);
    /* The preview may carry its own turn; if not, the DNG's own Orientation applies. */
    const own = jpegOrientation(bytes, found);
    const turn = own ? 1 : tiffOrientation(bytes, 0) || 1;
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }), { imageOrientation: "from-image" });
    } catch {
        throw new RawPhotoError();
    }
    const quarter = turn === 6 || turn === 8;
    const canvas = document.createElement("canvas");
    canvas.width = quarter ? bitmap.height : bitmap.width;
    canvas.height = quarter ? bitmap.width : bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new RawPhotoError();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (turn === 6) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); }
    else if (turn === 8) { ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); }
    else if (turn === 3) { ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI); }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.9));
    if (!blob) throw new RawPhotoError();
    return new File([blob], file.name.replace(/\.dng$/i, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
}
