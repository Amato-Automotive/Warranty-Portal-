/**
 * The text on an invoice the store uploads, read in its own browser — nothing
 * is sent anywhere to read it.
 *
 * A PDF made by billing software carries its text, which is read directly:
 * instant and exact. A photo, or a scanned PDF with no text in it, goes
 * through OCR (Tesseract). Both libraries are loaded only when a store reads
 * an invoice, so they cost the rest of the app nothing.
 */

export type ReadProgress = (stage: string, pct: number) => void;

const MAX_PDF_PAGES = 3;

async function pdfText(file: File, onProgress: ReadProgress): Promise<{ text: string; canvases: HTMLCanvasElement[] }> {
    /* pdfjs-dist 6 uses Promise.withResolvers, which older Chromium/Edge
     * builds do not provide. Supplying the tiny standard polyfill keeps PDF
     * invoices readable without changing the rest of the app. */
    const promiseCtor = Promise as typeof Promise & { withResolvers?: <T>() => { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } };
    if (!promiseCtor.withResolvers) {
        promiseCtor.withResolvers = <T>() => {
            let resolve!: (value: T | PromiseLike<T>) => void;
            let reject!: (reason?: unknown) => void;
            const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
            return { promise, resolve, reject };
        };
    }
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    /* Hostinger serves .mjs as text/plain, which makes PDF.js's dynamic
     * worker import fail with "Setting up fake worker". Fetch the asset and
     * re-wrap it as a JavaScript blob so the browser sees the correct MIME
     * type regardless of the host's static-file mapping. */
    const workerSource = await fetch(workerUrl).then(r => {
        if (!r.ok) throw new Error(`Could not load the PDF reader worker (${r.status})`);
        return r.text();
    });
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    let text = "";
    const canvases: HTMLCanvasElement[] = [];
    for (let n = 1; n <= pages; n++) {
        onProgress(`Reading page ${n} of ${pages}`, Math.round(((n - 1) / pages) * 100));
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        /* Rebuild the lines: items on the same baseline make one line. */
        const rows = new Map<number, { x: number; s: string }[]>();
        for (const item of content.items as any[]) {
            if (!item.str?.trim()) continue;
            if (!Array.isArray(item.transform) || item.transform.length < 6) continue;
            const y = Math.round(item.transform[5]);
            const key = [...rows.keys()].find(k => Math.abs(k - y) <= 3) ?? y;
            rows.set(key, [...(rows.get(key) ?? []), { x: item.transform[4], s: item.str }]);
        }
        const lines = [...rows].sort((a, b) => b[0] - a[0]).map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.s).join("  "));
        text += lines.join("\n") + "\n";
        /* No text layer: a scan. Draw the page, for OCR. */
        if (!lines.length) {
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width; canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext("2d")!, viewport, canvas } as any).promise;
            canvases.push(canvas);
        }
    }
    return { text, canvases };
}

/**
 * A phone photo is often stored sideways with an "orientation" note that tells
 * viewers to turn it. OCR reads the raw pixels and ignores the note, so a
 * portrait photo comes out as garbage. Drawing it through the browser turns it
 * upright first (and enlarges a small one). If that fails, the file is read as it is.
 */
async function upright(file: File): Promise<File | HTMLCanvasElement> {
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        /* A small picture (a screenshot, a WhatsApp-compressed photo) is too coarse for OCR to read small print; enlarging it first makes it readable. */
        const longest = Math.max(bitmap.width, bitmap.height);
        const scale = longest < 2000 ? Math.min(4, 2000 / longest) : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return file;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        return canvas;
    } catch {
        return file;
    }
}

/** All the text on the invoice files (photos and PDFs), as lines. */
export async function readInvoiceFiles(files: File[], onProgress: ReadProgress = () => {}): Promise<string> {
    let text = "";
    const images: (File | HTMLCanvasElement)[] = [];
    for (const f of files) {
        if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
            const r = await pdfText(f, onProgress);
            text += r.text;
            images.push(...r.canvases);
        } else if (f.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(f.name)) {
            images.push(await upright(f));
        }
    }
    if (images.length) {
        onProgress("Getting the reader ready", 0);
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng", 1, {
            logger: (m: { status: string; progress: number }) => {
                if (m.status === "recognizing text") onProgress("Reading the invoice", Math.round(m.progress * 100));
            },
        });
        try {
            for (const img of images) {
                const { data } = await worker.recognize(img);
                text += data.text + "\n";
            }
        } finally {
            await worker.terminate();
        }
    }
    return text;
}
