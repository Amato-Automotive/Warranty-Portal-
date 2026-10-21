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
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
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
            images.push(f);
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
