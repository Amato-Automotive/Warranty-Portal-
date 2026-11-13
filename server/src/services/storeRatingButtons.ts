/**
 * Reading a customer's tap on the store_experience_rating template. No
 * database import, so it can be tested alone.
 *
 * The template is sent with callback data "store_experience_rating_<request
 * id>", which comes back on the button-click event along with the button's
 * label. The label is where the stars are: a digit ("5"), star symbols ("⭐⭐⭐"),
 * or a word ("Excellent").
 */

export const RATING_CALLBACK_PREFIX = 'store_experience_rating_';

/** The request id out of the click's callback data, or null when it is not a rating click. */
export function requestIdFromCallback(callbackData: unknown): string | null {
    const s = String(callbackData ?? '');
    if (!s.startsWith(RATING_CALLBACK_PREFIX)) return null;
    const id = s.slice(RATING_CALLBACK_PREFIX.length).trim();
    return /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : null;
}

const WORDS: [RegExp, number][] = [
    [/excellent|outstanding|amazing|loved/i, 5],
    [/very\s*good|great/i, 4],
    [/okay|ok\b|average|fair|decent/i, 3],
    [/poor|bad|below/i, 2],
    [/terrible|worst|awful|very\s*bad/i, 1],
];

/** 1 to 5 from a button label, or null when it cannot be read as stars. */
export function starsFromButton(label: unknown): number | null {
    const text = String(label ?? '').trim();
    if (!text) return null;
    const symbols = (text.match(/[★⭐🌟]/gu) ?? []).length;
    if (symbols >= 1 && symbols <= 5 && !/\d/.test(text)) return symbols;
    const digit = text.match(/(?:^|\D)([1-5])(?:\D|$)/);
    if (digit) return Number(digit[1]);
    for (const [re, n] of WORDS) if (re.test(text)) return n;
    return null;
}
