import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractJpegPreview, isDng, jpegOrientation, tiffOrientation } from "../src/lib/rawPhoto.ts";

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const cat = (...parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
/* A little-endian TIFF header whose first directory holds one entry: Orientation = `o`. */
const tiff = (o: number) => new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0]);
/* The start of a lossless JPEG (SOF3), where a DNG keeps its sensor data: an SOI many times over, none of them viewable. */
const losslessTile = () => new Uint8Array([0xff, 0xd8, 0xff, 0xc3, 0, 11, 16, 0x10, 0, 0x10, 0, 1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 1, 0, 0, 1, 2, 3, 0xff, 0xd9]);

test("isDng recognises a RAW photo by name or type", () => {
    assert.equal(isDng({ name: "IMG_2788.dng" }), true);
    assert.equal(isDng({ name: "IMG_2788.DNG", type: "" }), true);
    assert.equal(isDng({ name: "x", type: "image/x-adobe-dng" }), true);
    assert.equal(isDng({ name: "photo.jpg", type: "image/jpeg" }), false);
});

test("the big JPEG preview is taken out of a DNG, byte for byte, not the thumbnail or the sensor data", () => {
    const preview = fx("preview_baseline.jpg");
    const dng = cat(tiff(1), fx("thumb.jpg"), losslessTile(), losslessTile(), new Uint8Array(5000).fill(7), preview, losslessTile());
    const c = extractJpegPreview(dng)!;
    assert.ok(c);
    assert.deepEqual([c.width, c.height], [1200, 900]);
    assert.deepEqual(dng.slice(c.start, c.end), preview);
});

test("a progressive JPEG preview is found whole", () => {
    const preview = fx("preview_progressive.jpg");
    const c = extractJpegPreview(cat(tiff(1), fx("thumb.jpg"), preview))!;
    assert.deepEqual(new Uint8Array(cat(tiff(1), fx("thumb.jpg"), preview).slice(c.start, c.end)), preview);
});

test("a DNG with only a thumbnail, a small preview, or no JPEG at all gives nothing to use", () => {
    assert.equal(extractJpegPreview(cat(tiff(1), fx("thumb.jpg"), losslessTile())), null);
    assert.equal(extractJpegPreview(cat(tiff(1), fx("preview_small.jpg"))), null);
    assert.equal(extractJpegPreview(cat(tiff(1), new Uint8Array(20000).fill(3))), null);
});

test("a truncated JPEG is not mistaken for a preview", () => {
    const p = fx("preview_baseline.jpg");
    assert.equal(extractJpegPreview(p.slice(0, p.length - 40)), null);
});

test("orientation is read from the DNG's TIFF header and from a JPEG's own Exif", () => {
    assert.equal(tiffOrientation(tiff(6), 0), 6);
    assert.equal(tiffOrientation(tiff(1), 0), 1);
    assert.equal(tiffOrientation(new Uint8Array(30), 0), 0);
    const withExif = fx("preview_exif6.jpg"); const c = extractJpegPreview(withExif)!;
    assert.equal(jpegOrientation(withExif, c), 6);
    const plain = fx("preview_baseline.jpg"); assert.equal(jpegOrientation(plain, extractJpegPreview(plain)!), 0);
});

test("a JPEG that ends the file is found too, and a preview at the very end of a DNG", () => {
    for (const n of ["preview_baseline.jpg", "preview_progressive.jpg", "preview_exif6.jpg"]) {
        const b = fx(n);
        const c = extractJpegPreview(b)!;
        assert.ok(c, n);
        assert.deepEqual([c.start, c.end], [0, b.length]);
    }
    const dng = cat(tiff(6), losslessTile(), fx("preview_baseline.jpg"));
    assert.equal(extractJpegPreview(dng)!.end, dng.length);
});
