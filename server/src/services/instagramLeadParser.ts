import { normaliseProduct } from './productMatch.js';

/**
 * Instagram lead-form enquiries, which arrive as an ordinary WhatsApp message.
 *
 * Meta's click-to-WhatsApp lead ads send the form answers as the customer's
 * first message, from the customer's own number:
 *
 *   Hello! I filled in your form and would like to know more about your business.
 *
 *   For which car do you need the seat cover?: Verna Sedan
 *   Full name: Kuldeep Sharma
 *   Phone number: +917307388011
 *   City: Mohali
 *   Can you share the car model year?: 2024
 *
 * Everything routing needs is already in there, so these are answered straight
 * away rather than being put through the question flow. Asking someone their
 * city moments after they typed it into the ad form is how a warm lead goes
 * cold.
 *
 * Only the reading lives here. Sending is in instagramLead.service, which
 * imports the router and therefore a database pool — keeping them apart is
 * what lets the parsing be tested on its own.
 */

/**
 * The marker every lead-form message carries.
 *
 * Meta sends two wordings for the same thing — "filled in your form" and
 * "filled out your form" — so both are accepted. Real messages also arrive
 * with text before the greeting (one opened with the sender's own name), which
 * is why this is searched for anywhere in the body rather than anchored to the
 * start.
 */
const LEAD_FORM_MARKER = /i\s+filled\s+(in|out)\s+your\s+form/i;

export interface ParsedLead {
    name: string | null;
    phone: string | null;
    /**
     * The answer to the pincode question, as typed ("302 001", "Pin 302001").
     * Campaigns from late September 2026 ask for this instead of the city,
     * because leads are routed by pincode; extractPincode reads the digits.
     */
    pincode: string | null;
    city: string | null;
    car: string | null;
    /** "Can you share the car model year?" — kept with the car on the lead. */
    carYear: string | null;
    product: string | null;
    /** Labels we saw but had no home for — surfaced so new ad forms are visible. */
    unmapped: Record<string, string>;
}

/**
 * Pull "Label: value" pairs out of the message.
 *
 * Split on the LAST colon of the label rather than the first, because the
 * questions are themselves questions — "For which car do you need the seat
 * cover?: Verna Sedan" would otherwise break at the wrong place and never.
 * A line without a colon is prose, not an answer, and is skipped.
 */
function extractPairs(text: string): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    for (const line of String(text || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // "?:" is the separator Meta uses when the label is a question.
        const at = trimmed.lastIndexOf('?:') >= 0
            ? trimmed.lastIndexOf('?:') + 1
            : trimmed.indexOf(':');
        if (at <= 0) continue;

        const label = trimmed.slice(0, at).replace(/\?+$/, '').trim();
        const value = trimmed.slice(at + 1).trim();
        if (label && value) pairs.push([label, value]);
    }
    return pairs;
}

/*
 * Which label means what.
 *
 * Every ad asks in its own words — "Post code", "PIN", "Your area pincode?",
 * "post_code", even "Picode" — so a label is matched loosely: lower-cased,
 * with "_", "-" and punctuation as spaces, against each field's words, and a
 * word may be one letter off (two in a long word). The first live lead on the
 * October 2026 form asked "Post code", which the old exact patterns missed.
 *
 * Order matters: the first field whose words match a label wins, so the
 * specific ones come first — the year before the car ("car model year"), the
 * pincode before the city ("Area pincode"), the car before the name ("Car name").
 */
type Field = keyof Omit<ParsedLead, 'unmapped' | 'product'>;
const FIELD_WORDS: Array<[Field, string[]]> = [
    ['carYear', ['year', 'model year', 'manufacturing', 'mfg', 'yr']],
    ['pincode', ['pincode', 'pin code', 'pin', 'postcode', 'post code', 'postal', 'zip', 'zipcode', 'area code', 'pin no']],
    ['phone', ['phone', 'mobile', 'contact number', 'contact no', 'whatsapp', 'whats app', 'mob no', 'cell']],
    ['car', ['car', 'vehicle', 'car model', 'car name', 'gaadi', 'gadi', 'which car', 'make and model']],
    ['name', ['name', 'full name', 'your name', 'customer name']],
    ['city', ['city', 'town', 'location', 'area', 'district', 'address', 'locality', 'where', 'place']],
];

const normLabel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* Edits between two words, where swapping two neighbouring letters counts as one ("moblie"). */
function editDistance(a: string, b: string): number {
    if (a === b) return 0;
    const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}

/* A label word close enough to a field word: exact for short words, one mistake
   from five letters, two from seven ("Picode", "Pincod", "Moblie", "Vehical"). */
function wordLike(word: string, target: string): boolean {
    if (word === target) return true;
    if (target.length < 5 || word.length < 4) return false;
    return editDistance(word, target) <= (target.length >= 7 ? 2 : 1);
}

/** Whether a label asks for this field: a field phrase appears in it, word by word, allowing typos. */
function labelAsks(label: string, phrases: string[]): boolean {
    const words = normLabel(label).split(' ').filter(Boolean);
    const squashed = words.join('');
    return phrases.some(phrase => {
        const parts = phrase.split(' ');
        // "pincode" also as "pin code", "post_code" as "postcode".
        if (parts.length > 1 && squashed.includes(parts.join(''))) return true;
        return words.some((_, i) => parts.every((p, k) => words[i + k] !== undefined && wordLike(words[i + k], p)));
    });
}

/* An answer that is a pincode and nothing much else: "143001", "143 001", "Pin- 143001". */
const PINCODE_ANSWER = /^[^\d]{0,12}([1-9]\d{2})[\s-]?(\d{3})[^\d]{0,3}$/;

/**
 * Read an Instagram lead-form message.
 *
 * Returns null when the message is not one — an ordinary customer saying hello
 * must fall through to the normal question flow untouched.
 */
export function parseLeadForm(text: string): ParsedLead | null {
    const body = String(text || '');
    if (!LEAD_FORM_MARKER.test(body)) return null;

    const parsed: ParsedLead = {
        name: null, phone: null, pincode: null, city: null, car: null, carYear: null, product: null, unmapped: {},
    };

    for (const [label, value] of extractPairs(body)) {
        let claimed = false;
        for (const [field, phrases] of FIELD_WORDS) {
            if (labelAsks(label, phrases)) {
                // The first field that matches owns the label, even if already filled.
                if (parsed[field] === null) parsed[field] = value;
                claimed = true;
                break;
            }
        }

        /*
         * The product is never its own field — it is named inside the question
         * ("...do you need the seat cover?"). Reading it from the label means a
         * mats or accessories campaign files correctly without another change
         * here.
         */
        if (!parsed.product) {
            const fromLabel = normaliseProduct(label);
            if (fromLabel) parsed.product = fromLabel;
        }

        if (!claimed) parsed.unmapped[label] = value;
    }

    /*
     * The safety net: no label read as the pincode, but an answer we could not
     * place (or the city) is plainly one — a form asking "Where should we
     * reach you?" still routes. Never the phone number.
     */
    if (parsed.pincode === null) {
        if (parsed.city !== null && PINCODE_ANSWER.test(parsed.city.trim())) {
            parsed.pincode = parsed.city;
            parsed.city = null;
        } else {
            for (const [label, value] of Object.entries(parsed.unmapped)) {
                if (PINCODE_ANSWER.test(value.trim())) {
                    parsed.pincode = value;
                    delete parsed.unmapped[label];
                    break;
                }
            }
        }
    }

    return parsed;
}
