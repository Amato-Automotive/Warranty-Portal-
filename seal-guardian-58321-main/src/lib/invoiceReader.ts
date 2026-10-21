/**
 * Finding a scheme's products and quantities in the text read off an invoice.
 *
 * The text comes from OCR (lib/invoiceOcr.ts), so it is noisy: "Sports" for
 * Sportz, "DOUBLE" for Doble, "U-MAX PREM", stray symbols. Each line is
 * compared with each product's name (without "Series") by edit distance over
 * runs of 1–4 words, joined, so spacing and hyphens do not matter. The
 * quantity is the small whole number on the same line that is not part of the
 * name, a price or a code — preferring one next to "pcs", "set" or "qty".
 *
 * Nothing here is final: every line is shown to the store to correct before
 * it submits, and a line the reader is unsure of is marked to check.
 *
 * Pure: no browser or network, so it can be checked on its own.
 */

export interface ReaderProduct { id: string; name: string; points: number }
export interface ReadLine {
    product_id: string;
    qty: number;
    /* "sure": a close name and a clear quantity; "check": the store should look. */
    confidence: "sure" | "check";
    /* The invoice line it came from, to show the store where it was read. */
    from: string;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, "");
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9+.]+/g, " ").trim().split(/\s+/).filter(Boolean);
const keyOf = (name: string) => squash(name.replace(/\bseries\b/gi, ""));

function distance(a: string, b: string): number {
    if (a === b) return 0;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0];
        prev[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const t = prev[j];
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
            diag = t;
        }
    }
    return prev[b.length];
}
const likeness = (a: string, b: string) => (a && b ? 1 - distance(a, b) / Math.max(a.length, b.length) : 0);

const SURE = 0.82;
const MAYBE = 0.72;

/*
 * What OCR usually gets wrong in a word: "m" read as "rn", "w" as "vv", and
 * digits for the letters they look like inside a word ("S1GNATURE"). Only
 * applied to words with letters, so quantities and prices are left alone.
 */
function ocrFix(token: string): string {
    let t = token.toLowerCase();
    if (!/[a-z]/.test(t)) return t;
    if (/\d/.test(t)) t = t.replace(/1/g, "i").replace(/0/g, "o").replace(/5/g, "s").replace(/8/g, "b");
    return t.replace(/rn/g, "m").replace(/vv/g, "w").replace(/\|/g, "l");
}

/** The best product for one line, the words it took up, and how alike they were. */
function bestOnLine(tokens: string[], products: ReaderProduct[]) {
    let best: { p: ReaderProduct; score: number; from: number; to: number } | null = null;
    const fixed = tokens.map(ocrFix);
    for (const p of products) {
        const key = keyOf(p.name);
        if (!key) continue;
        for (let i = 0; i < tokens.length; i++) {
            let joined = "";
            let joinedFixed = "";
            for (let j = i; j < Math.min(tokens.length, i + 4); j++) {
                joined += squash(tokens[j]);
                joinedFixed += squash(fixed[j]);
                if (!joined) continue;
                /* A run much longer than the name cannot be it; stop growing. */
                if (joined.length > key.length + 3 && joinedFixed.length > key.length + 3) break;
                let score = Math.max(likeness(joined, key), likeness(joinedFixed, key));
                /* A name the invoice shortens: "UMAXPREM" for U Max Premium. */
                for (const j2 of [joined, joinedFixed]) if (j2.length >= 5 && key.startsWith(j2) && j2.length / key.length >= 0.6) score = Math.max(score, 0.85);
                if (!best || score > best.score || (score === best.score && key.length > keyOf(best.p.name).length)) {
                    best = { p, score, from: i, to: j };
                }
            }
        }
    }
    return best;
}

const UNIT = /^(pcs?|pc\.?|nos?\.?|sets?|set\.?|qty|units?|pair|pairs)$/i;
/* A number before one of these describes the product, not how many: "2 Row", "5 Seater", "12mm". */
const SPEC = /^(rows?|seaters?|seats?|wheelers?|mm|cm|inch(es)?|in|kg|gm?|ml|ltr|l|x|%|pack|layers?|d)$/i;

/** The quantity on a line, outside the words the product name took up. */
function quantityOn(tokens: string[], from: number, to: number): { qty: number; clear: boolean } | null {
    const found: { n: number; i: number; unit: boolean }[] = [];
    tokens.forEach((t, i) => {
        if (i >= from && i <= to) return;
        if (!/^\d{1,3}(\.0+)?$/.test(t)) return;            // whole numbers up to 999; prices and codes are longer or have paise
        const n = Number(t);
        if (!(n >= 1 && n <= 500)) return;
        if (SPEC.test(tokens[i + 1] ?? "")) return;
        /* The line's own serial number: a number first, before the name. */
        if (i === 0 && from > 0) return;
        const unit = UNIT.test(tokens[i + 1] ?? "") || UNIT.test(tokens[i - 1] ?? "");
        found.push({ n, i, unit });
    });
    if (!found.length) return null;
    const withUnit = found.find(f => f.unit);
    if (withUnit) return { qty: withUnit.n, clear: true };
    /* Otherwise the first number after the name — invoices put the quantity
       before the rate and the amount. One candidate is clear; several are not. */
    const after = found.filter(f => f.i > to);
    if (after.length) return { qty: after[0].n, clear: after.length === 1 };
    return { qty: found[0].n, clear: false };
}

/** Every product found in the invoice text, with its quantity; the same product on two lines is added up. */
export function matchInvoice(text: string, products: ReaderProduct[]): ReadLine[] {
    const out = new Map<string, ReadLine>();
    for (const raw of String(text ?? "").split(/\r?\n/)) {
        const line = raw.trim();
        if (line.length < 3) continue;
        const tokens = words(line);
        const hit = bestOnLine(tokens, products);
        if (!hit || hit.score < MAYBE) continue;
        const q = quantityOn(tokens, hit.from, hit.to);
        /* A product line has a quantity. A near-name with none — "Signatory"
           at the foot of the bill — is not a product line. */
        if (!q && hit.score < 0.95) continue;
        const sure = hit.score >= SURE && Boolean(q?.clear);
        const qty = q?.qty ?? 1;
        const prev = out.get(hit.p.id);
        if (prev) {
            prev.qty += qty;
            if (!sure) prev.confidence = "check";
            prev.from += ` / ${line}`;
        } else {
            out.set(hit.p.id, { product_id: hit.p.id, qty, confidence: sure ? "sure" : "check", from: line });
        }
    }
    return [...out.values()];
}
