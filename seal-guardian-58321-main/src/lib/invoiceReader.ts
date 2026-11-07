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
    /* Only with `byWord`: the series word the line itself names ("emporio"), when it names one. */
    word?: string;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, "");
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9+.]+/g, " ").trim().split(/\s+/).filter(Boolean);

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
 * A product is in a series when its name contains the series word ("AMAZE DUO
 * PLUS" is Amaze). Only that exact word is taken as read; a near-spelling —
 * OCR's "AMAZF" off a photo — is kept for the store but marked to check.
 */
const EXACT = 0.999;

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

/* Words in a product's name that say nothing about which product it is. */
const FILLER = new Set(["series", "artificial", "leather", "seat", "seats", "cover", "covers", "car", "the", "and", "with", "for", "of", "a", "an"]);

/**
 * A product's key words: its name, whatever the admin called it, without the
 * filler. "Amaze Series" → amaze; "VECTOR (SIGNATURE)" → vector, signature;
 * "D5 Artificial Leather Seat Covers" → d5. A long catalogue name is known by
 * its first four key words, the part an invoice keeps.
 */
export function keyWords(name: string): string[] {
    const all = words(String(name ?? "").replace(/[()[\]]/g, " ")).map(w => w.replace(/^\.+|\.+$/g, "")).filter(Boolean);
    const kept = all.filter(w => !FILLER.has(w));
    return (kept.length ? kept : all).slice(0, 4);
}

/** How well one invoice word reads as a name word: 1 when exact, else OCR-tolerant — short words must be exact. */
function wordLike(token: string, fixedToken: string, w: string): number {
    const t = squash(token), f = squash(fixedToken), k = squash(w);
    if (!t || !k) return 0;
    if (t === k || f === k) return 1;
    if (k.length < 4) return 0;          // "u", "d5", "q2", "2d" are exact or nothing
    return Math.max(likeness(t, k), likeness(f, k));
}

type Hit = { p: ReaderProduct; score: number; from: number; to: number; words: number };

/**
 * Where a product sits on a line: every key word found, in order, each as one
 * invoice word or two run together ("SIGNA TURE"). The score is the weakest
 * word's — 1 when all are exact. A name the invoice writes as one word or
 * shortens ("UMAX", "UMAXPREM") is tried whole as well.
 */
function matchProduct(tokens: string[], fixed: string[], p: ReaderProduct): Hit | null {
    const kw = keyWords(p.name);
    if (!kw.length) return null;
    let hit: Hit | null = null;

    /* Every word of `list` found in order, side by side. */
    const inOrder = (list: string[]): { score: number; from: number; to: number } | null => {
        let pos = 0, first = -1, last = -1, score = 1;
        for (const w of list) {
            let at = -1, best = 0, span = 1;
            /* The name's words sit side by side: "U-MAX ARROW" is not "U-ARROW". Only a one-character OCR speck may sit between. */
            const lastAt = first < 0 ? tokens.length : Math.min(tokens.length, pos + 1 + (tokens[pos]?.length === 1 ? 1 : 0));
            for (let i = pos; i < lastAt && best < 1; i++) {
                let s = wordLike(tokens[i], fixed[i], w), len = 1;
                if (s < 1 && i + 1 < tokens.length) {
                    const s2 = wordLike(tokens[i] + tokens[i + 1], fixed[i] + fixed[i + 1], w);
                    if (s2 > s) { s = s2; len = 2; }
                }
                if (s > best) { best = s; at = i; span = len; }
            }
            if (at < 0 || best < 0.8) return null;
            if (first < 0) first = at;
            last = at + span - 1;
            pos = last + 1;
            score = Math.min(score, best);
        }
        return { score, from: first, to: last };
    };

    const whole = inOrder(kw);
    if (whole) hit = { p, ...whole, words: kw.length };
    /* Invoices often drop the "U-" of a name: "S/C Focus 2 Row" is U-FOCUS. A guess, so never exact; and not after "MAX" ("U-MAX ARROW" is another product). */
    else if (kw[0] === "u" && kw.length > 1) {
        const bare = inOrder(kw.slice(1));
        if (bare && !/max$/.test(tokens[bare.from - 1] ?? "")) hit = { p, score: Math.min(bare.score, 0.9), from: bare.from, to: bare.to, words: kw.length - 1 };
    }

    const key = squash(kw.join(""));
    for (let i = 0; i < tokens.length; i++) {
        let joined = "", joinedFixed = "";
        for (let j = i; j < Math.min(tokens.length, i + 4); j++) {
            joined += squash(tokens[j]);
            joinedFixed += squash(fixed[j]);
            if (!joined) continue;
            if (joined.length > key.length + 3 && joinedFixed.length > key.length + 3) break;
            let s = Math.max(joined[0] === key[0] ? likeness(joined, key) : 0, joinedFixed[0] === key[0] ? likeness(joinedFixed, key) : 0);
            /* Shortened on the invoice: "UMAXPREM" for U Max Premium — a guess, so never exact. */
            for (const j2 of [joined, joinedFixed]) if (j2[0] === key[0] && j2.length >= 5 && key.startsWith(j2) && j2.length / key.length >= 0.6) s = Math.max(s, 0.85);
            if (s >= 1 && j > i && kw.length === 1) s = 0.9;   // one name word found only by gluing words: check it
            if (!hit || s > hit.score) hit = { p, score: s, from: i, to: j, words: kw.length };
        }
    }
    return hit;
}

/**
 * The product for one line, out of the scheme's own products — whatever the
 * admin picked or typed.
 *
 * When several fit the line, the most specific wins ("U Max Arrow Plus" over
 * "U Max Arrow"); between equally specific ones, the one named last — "SIGNATURE
 * SWED DOBLE" is Doble and "SIGNATURE LE EMPORIO" is Emporio, as the invoices'
 * prices show. Exact names come before near-spellings.
 */
function bestOnLine(tokens: string[], products: ReaderProduct[]): Hit | null {
    const fixed = tokens.map(ocrFix);
    const hits = products.map(p => matchProduct(tokens, fixed, p)).filter((h): h is Hit => Boolean(h));
    if (!hits.length) return null;
    const exact = hits.filter(h => h.score >= EXACT);
    const clear = exact.length ? exact : hits.filter(h => h.score >= SURE);
    if (clear.length) return clear.sort((a, b) => b.words - a.words || b.from - a.from || b.score - a.score)[0];
    return hits.sort((a, b) => b.score - a.score)[0];
}

/*
 * An e-invoice PDF often carries its e-Way Bill as the last page, listing
 * every line again; reading it as well would count everything twice. Its
 * section starts with an "e-Way Bill" heading or "e-Way Bill Details", and a
 * new "Tax Invoice" heading ends it (an invoice photographed after its bill).
 */
const EWAY_START = /^(\d+\.\s*)?e[\s-]?way\s*bill(\s+details)?(\s+e[\s-]?way\s*bill)?\s*$/i;
const INVOICE_START = /^tax\s+invoice\b/i;

const SERIES_WORDS = new Set(["velora", "doble", "signature", "emporio"]);
const UNIT = /^(pcs?|nos?|sets?|sts?|qty|units?|pairs?)\.?$/i;
/* A number before one of these describes the product, not how many: "2 Row", "5 Seater", "12mm". */
const SPEC = /^(rows?|seaters?|seats?|wheelers?|mm|cm|inch(es)?|in|kg|gm?|ml|ltr|l|x|%|pack|layers?|d)$/i;
/* Prevent header/HSN/amount numbers from becoming huge set quantities. */
const MAX_LINE_QTY = 100;

/** The quantity on a line, outside the words the product name took up. */
function quantityOn(tokens: string[], from: number, to: number): { qty: number; clear: boolean } | null {
    const found: { n: number; i: number; unit: boolean; after: boolean }[] = [];
    tokens.forEach((t, i) => {
        if (i >= from && i <= to) return;
        /* "1SET", "2PCS": the number and its unit run together. */
        const fused = /^(\d{1,3})(pcs?|nos?|sets?|sts?|units?|pairs?)\.?$/.exec(t);
        if (fused) { const n = Number(fused[1]); if (n >= 1 && n <= MAX_LINE_QTY) found.push({ n, i, unit: true, after: true }); return; }
        if (!/^\d{1,3}(\.0+)?$/.test(t)) return;            // whole numbers up to 999; prices and codes are longer or have paise
        const n = Number(t);
        if (!(n >= 1 && n <= MAX_LINE_QTY)) return;
        if (SPEC.test(tokens[i + 1] ?? "")) return;
        /* The line's own serial number: a number first, before the name. */
        if (i === 0 && from > 0) return;
        const after = UNIT.test(tokens[i + 1] ?? "");
        const unit = after || UNIT.test(tokens[i - 1] ?? "");
        found.push({ n, i, unit, after });
    });
    if (!found.length) return null;
    /* "2 SET" beats a number that merely follows a unit (the rate's "SET  8 %"). */
    const withUnit = found.find(f => f.unit && f.after) ?? found.find(f => f.unit);
    if (withUnit) return { qty: withUnit.n, clear: true };
    /* Otherwise the first number after the name — invoices put the quantity
       before the rate and the amount. One candidate is clear; several are not. */
    /* If OCR did not preserve a unit, do not guess from serials, prices, or
       address numbers. The store can correct the value manually below. */
    return null;
}

/** Every product found in the invoice text, with its quantity; the same product on two lines is added up. */
export function matchInvoice(text: string, products: ReaderProduct[], byWord = false): ReadLine[] {
    const out = new Map<string, ReadLine>();
    let inEwayBill = false;
    for (const raw of String(text ?? "").split(/\r?\n/)) {
        const line = raw.trim();
        if (EWAY_START.test(line)) { inEwayBill = true; continue; }
        if (INVOICE_START.test(line)) inEwayBill = false;
        if (inEwayBill) continue;
        if (line.length < 3) continue;
        /* "8,093.00" is one price, not an 8 and a 093.00. */
        const tokens = words(line.replace(/(\d),(?=\d{2,3}(?!\d))/g, "$1"));
        const hit = bestOnLine(tokens, products);
        if (!hit || hit.score < MAYBE) continue;
        const q = quantityOn(tokens, hit.from, hit.to);
        /* A product line has a quantity. A near-name with none — "Signatory"
           at the foot of the bill — is not a product line. */
        /* An exact name without a nearby quantity can be a heading/address. */
        if (!q) continue;
        const sure = hit.score >= EXACT && q.clear;
        const qty = q.qty;
        /* A line that names a series ("U-Focus Perfo Emporio") is that series, whichever product it matched; the word named last wins. */
        const word = byWord ? [...tokens].reverse().find(t => SERIES_WORDS.has(t)) : undefined;
        const key = word ? `${hit.p.id}|${word}` : hit.p.id;
        const prev = out.get(key);
        if (prev) {
            prev.qty += qty;
            if (!sure) prev.confidence = "check";
            prev.from += ` / ${line}`;
        } else {
            out.set(key, { product_id: hit.p.id, qty, confidence: sure ? "sure" : "check", from: line, ...(word ? { word } : {}) });
        }
    }
    return [...out.values()];
}
