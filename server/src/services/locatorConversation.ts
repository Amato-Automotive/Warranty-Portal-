import { readCarAnswer, exampleModels } from './carModels.js';
import { extractPincode } from './storeLocator.js';
import { normaliseProduct, type Product } from './productMatch.js';
import type { MenuKey, Vehicle } from './storeLocatorMessages.js';
import {
    CAR_RETRY, PINCODE_QUESTION, INVALID_PINCODE_TEXT, NO_PINCODE_END,
    whichModelText, unknownPincodeText,
} from './storeLocatorMessages.js';

/**
 * The questions our server asks after the Interakt workflow hands over at the
 * product menu: the car, then the pincode. Each answer is checked before the
 * next question, and a wrong one gets a re-prompt that says what to send.
 *
 * Nobody is kept going round: after two wrong answers to a question, the car
 * is taken as typed (and marked unchecked for the auditor), and a pincode that
 * never comes ends the chat with "our team will call you" — the lead is kept
 * either way.
 *
 * Free of any database import, so the rules are tested; the service does the
 * reading, writing and sending.
 */

/**
 * vehicle        4-wheeler or 2-wheeler — the first question
 * product        the main menu is showing
 * product-other  the "Other Products" menu is showing
 * car, pincode   the questions after it
 */
export type ChatStage = 'vehicle' | 'product' | 'product-other' | 'car' | 'pincode';

/** Every stage in which the chat is waiting for the customer. */
export const OPEN_STAGES: ChatStage[] = ['vehicle', 'product', 'product-other', 'car', 'pincode'];

/** A question stage — the menus are handled by menuStep. */
export interface ChatSession {
    stage: 'car' | 'pincode';
    /** Wrong answers so far to the current question. */
    tries: number;
}

/** Wrong answers to one question before the chat moves on without it. */
export const MAX_TRIES = 2;

/** A chat nobody has answered for this long is over; the lead stays for the auditor. */
export const IDLE_MINUTES = 30;

export type ChatStep =
    /* Same question again, with this re-prompt. */
    | { kind: 'retry'; tries: number; reply: string }
    /* Car settled — ask for the pincode. */
    | { kind: 'car'; car: string; checked: boolean; reply: string }
    /* Pincode settled — find the stores, as the locator always has. */
    | { kind: 'pincode'; pincode: string; checked: boolean }
    /* No pincode after MAX_TRIES — end politely, the team calls. */
    | { kind: 'give-up'; reply: string };

/** "My pin code is: 201301" → the car-free, tidy answer to keep when nothing matched. */
const asTyped = (text: string) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

export async function nextStep(
    session: ChatSession,
    text: string,
    isKnownPincode: (pincode: string) => Promise<boolean>,
): Promise<ChatStep> {
    const wrong = session.tries + 1;

    if (session.stage === 'car') {
        const answer = readCarAnswer(text);
        if (answer.ok) return { kind: 'car', car: answer.car, checked: true, reply: PINCODE_QUESTION };

        // Out of tries: take what they gave, so the chat moves on. A make on its
        // own ("Toyota") is still worth keeping; anything else is kept as typed.
        if (wrong >= MAX_TRIES) {
            const car = answer.why === 'make-only' && answer.make ? answer.make : asTyped(text);
            return { kind: 'car', car, checked: false, reply: PINCODE_QUESTION };
        }
        const reply = answer.why === 'make-only' && answer.make
            ? whichModelText(answer.make, exampleModels(answer.make))
            : CAR_RETRY[answer.why === 'make-only' ? 'junk' : answer.why];
        return { kind: 'retry', tries: wrong, reply };
    }

    // The pincode, read out of a sentence too: "My pin code is : 201301".
    const pincode = extractPincode(text);
    if (pincode) {
        if (await isKnownPincode(pincode)) return { kind: 'pincode', pincode, checked: true };
        // One chance to correct a pincode we cannot place; after that it goes
        // through anyway, and the locator's own fallback (support) takes it.
        if (wrong >= MAX_TRIES) return { kind: 'pincode', pincode, checked: false };
        return { kind: 'retry', tries: wrong, reply: unknownPincodeText(pincode) };
    }
    if (wrong >= MAX_TRIES) return { kind: 'give-up', reply: NO_PINCODE_END };
    return { kind: 'retry', tries: wrong, reply: INVALID_PINCODE_TEXT };
}

/* ─── 4-wheeler or 2-wheeler ─────────────────────────────────────────────── */

/*
 * Typed instead of tapped. The whole answer is read, so "2" is a 2-wheeler but
 * "2 seat covers" is not an answer. A car word means a 4-wheeler.
 */
const TWO_WHEELER = /^(2|two|do|2 ?-? ?w(heeler|heelar|hlr)?s?|two ?-? ?wheelers?|bike|bikes|scooty|scooter|scooters|motor ?cycle|motorbike|activa)$/i;
const FOUR_WHEELER = /^(4|four|char|4 ?-? ?w(heeler|heelar|hlr)?s?|four ?-? ?wheelers?|car|cars|suv|sedan|hatchback|jeep)$/i;

export function readVehicleAnswer(text: string): Vehicle | null {
    const t = String(text ?? '').toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim()
        .replace(/^(it'?s |its |for |my |a |an |i have a |i have )+/, '')
        .replace(/ (hai|he|h|please|pls|ji|sir)$/, '');
    if (TWO_WHEELER.test(t)) return '2w';
    if (FOUR_WHEELER.test(t)) return '4w';
    return null;
}

export type VehicleStep =
    | { kind: 'chosen'; vehicle: Vehicle; checked: boolean }
    | { kind: 'retry'; tries: number };

/**
 * The answer to the vehicle question. Asked once more if it can't be read;
 * after that the chat goes on as a 4-wheeler (the usual enquiry), marked
 * unchecked so the auditor knows.
 */
export function vehicleStep(tries: number, input: { tap?: Vehicle; text?: string }): VehicleStep {
    const v = input.tap ?? readVehicleAnswer(input.text ?? '');
    if (v) return { kind: 'chosen', vehicle: v, checked: true };
    const wrong = tries + 1;
    if (wrong >= MAX_TRIES) return { kind: 'chosen', vehicle: '4w', checked: false };
    return { kind: 'retry', tries: wrong };
}

/* ─── The product menu ───────────────────────────────────────────────────── */

/*
 * What each menu row files the lead under. Lead Management splits leads into
 * three lines, so the "Other Products" rows count as Accessories; the exact row
 * is kept alongside as the customer's choice.
 */
export const MENU_CHOICES: Record<'seat' | 'mats' | 'acc' | 'care' | 'lights' | 'audio', { product: Product; choice: string }> = {
    seat: { product: 'Seat Covers', choice: 'Seat Covers' },
    mats: { product: 'Mats', choice: 'Car Mats' },
    acc: { product: 'Accessories', choice: 'Accessories' },
    care: { product: 'Accessories', choice: 'Care & Fragrance' },
    lights: { product: 'Accessories', choice: 'Lights & Utility' },
    audio: { product: 'Accessories', choice: 'Audio & Security' },
};

export type MenuStep =
    /* Show a menu: after "Other Products", "Back", or a retry of the same one. */
    | { kind: 'menu'; menu: 'main' | 'other'; tries: number; retry: boolean }
    /* A product is chosen — ask for the car. Null product: moved on after tries. */
    | { kind: 'chosen'; product: Product | null; choice: string | null };

/* Typed instead of tapped: the words people use for each row. */
const TYPED_CHOICES: [keyof typeof MENU_CHOICES, RegExp][] = [
    ['care', /care|fragran|perfume|polish|clean|wash|shampoo/i],
    ['lights', /light|\bled\b|lamp|bulb|horn|utility/i],
    ['audio', /audio|music|speaker|stereo|sound|security|camera|alarm|lock|dash\s*cam/i],
];

export function menuStep(
    stage: 'product' | 'product-other',
    tries: number,
    input: { tap?: MenuKey; text?: string },
): MenuStep {
    const key = input.tap ?? readMenuText(stage, input.text ?? '');
    if (key === 'other') return { kind: 'menu', menu: 'other', tries: 0, retry: false };
    if (key === 'back') return { kind: 'menu', menu: 'main', tries: 0, retry: false };
    if (key) return { kind: 'chosen', ...MENU_CHOICES[key] };

    // Not something on the menu. Ask once more, then move on — the car and
    // pincode matter more than the product, which the auditor can fill in.
    const wrong = tries + 1;
    if (wrong >= MAX_TRIES) return { kind: 'chosen', product: null, choice: String(input.text ?? '').trim().slice(0, 40) || null };
    return { kind: 'menu', menu: stage === 'product-other' ? 'other' : 'main', tries: wrong, retry: true };
}

function readMenuText(stage: 'product' | 'product-other', text: string): MenuKey | null {
    const t = String(text ?? '').trim();
    if (!t) return null;
    if (stage === 'product-other' && /\b(back|main\s*menu|menu)\b/i.test(t)) return 'back';
    for (const [key, pattern] of TYPED_CHOICES) if (pattern.test(t)) return key;
    const product = normaliseProduct(t);
    if (product === 'Seat Covers') return 'seat';
    if (product === 'Mats') return 'mats';
    if (product === 'Accessories') return 'acc';
    if (/\bother/i.test(t)) return 'other';
    return null;
}

/**
 * "Heyy" (any number of y's) — the Interakt workflow's own trigger. It starts
 * the chat for anyone, the team's own phones included, and mid-chat it is the
 * one word that starts over.
 */
function isHeyy(text: string): boolean {
    return /^\s*hey+\s*[!.]*\s*$/i.test(String(text ?? ''));
}

/** Mid-chat, only "Heyy" starts over. A "hi" or "car" is just an answer. */
export const isRestart = isHeyy;

/*
 * The other words that start the chat, compared with repeated letters
 * squashed, so "hiii", "helloo" and "heyyy" count. The whole message must be
 * the word, give or take punctuation, emoji and a "sir"/"ji" after it:
 * customers' own auto-replies ("Hello! Welcome to KP Trading…") must not
 * start a menu, or their bot and ours answer each other.
 */
const GREETINGS = [
    'hi', 'hey', 'hello', 'helo', 'hlo', 'hlw', 'hy', 'hai',
    'namaste', 'namaskar', 'नमस्ते', 'नमस्कार',
    'price', 'enquiry', 'inquiry', 'info', 'details', 'car',
    'store', 'store near me', 'dealer',
];

/* Naming a product skips the menu: the chat goes straight to the car. */
const PRODUCT_WORDS: [Product, string[]][] = [
    ['Seat Covers', ['seat', 'seats', 'seat cover', 'seat covers', 'car seat cover', 'car seat covers']],
    ['Mats', ['mat', 'mats', 'car mat', 'car mats', 'floor mat', 'floor mats']],
    ['Accessories', ['accessories', 'car accessories']],
];

/* Said after the word, and dropped before comparing. */
const COURTESY = /(\s+(sir|ji|जी|bhai|team|autoform|please|pls|plz))+$/u;

const squash = (s: string) => s.replace(/(.)\1+/gu, '$1');
const tidy = (text: string) => squash(
    String(text ?? '').toLowerCase()
        .replace(/[^\p{L}\p{M}\s]/gu, ' ')
        .replace(/\s+/g, ' ').trim(),
).replace(COURTESY, '');
const GREETING_SET = new Set(GREETINGS.map(squash));
const PRODUCT_MAP = new Map(PRODUCT_WORDS.flatMap(([p, words]) => words.map(w => [squash(w), p] as const)));

export type StartWord =
    /* "Heyy": starts the chat for any number. */
    | { kind: 'heyy' }
    /* Any other start word: for customers only — see startWord. */
    | { kind: 'word'; product: Product | null };

/**
 * Whether a message starts the chat, and with which product if it names one.
 * Only "Heyy" starts it for the team's own numbers: franchises message this
 * number too, and their "hi" must not get a product menu. The caller checks
 * the number for the other words.
 */
export function startWord(text: string): StartWord | null {
    if (isHeyy(text)) return { kind: 'heyy' };
    const t = tidy(text);
    if (!t) return null;
    if (GREETING_SET.has(t)) return { kind: 'word', product: null };
    const product = PRODUCT_MAP.get(t);
    return product ? { kind: 'word', product } : null;
}

/** "stop", "cancel": the customer wants out. */
export function isCancel(text: string): boolean {
    return /^\s*(stop|cancel|exit|quit|no thanks)\s*[!.]*\s*$/i.test(String(text ?? ''));
}

/** Whether a chat last touched at this time has gone quiet for good. */
export function isIdle(lastAt: string | null | undefined, now = Date.now()): boolean {
    const t = lastAt ? Date.parse(lastAt) : NaN;
    return !Number.isFinite(t) || now - t > IDLE_MINUTES * 60_000;
}
