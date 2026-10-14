/**
 * The WhatsApp messages the store locator sends, built without a database so
 * they can be checked against WhatsApp's limits in tests.
 *
 * WhatsApp refuses a list message outright — not truncates, refuses — when any
 * part is over its limit, and the customer then gets nothing at all. So every
 * piece of text is cut to size here, in one place:
 *
 *   rows in a list          10 in total, across all sections
 *   row title               24 characters
 *   row description         72
 *   section title           24
 *   list button             20
 *   body                    1024
 *   row id                  200
 *
 * A row id carries everything needed to act on the tap, because the tap comes
 * back through the webhook with nothing else attached: `sl:<lead id>:<kind>:<ref>`.
 */

export const LIMITS = {
    rows: 10,
    rowTitle: 24,
    rowDescription: 72,
    sectionTitle: 24,
    button: 20,
    body: 1024,
    rowId: 200,
} as const;

/** Rows per page when there are more than ten: nine, plus "More stores". */
const PAGE_WITH_MORE = LIMITS.rows - 1;

const ID_PREFIX = 'sl';

export type ReplyKind = 'store' | 'distributor' | 'more';
const KIND_CODE: Record<ReplyKind, string> = { store: 's', distributor: 'd', more: 'm' };
const CODE_KIND: Record<string, ReplyKind> = { s: 'store', d: 'distributor', m: 'more' };

/** Cut to a length, ending in an ellipsis rather than mid-word where it can. */
export function fit(text: string, max: number): string {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function rowId(leadId: string, kind: ReplyKind, ref: string | number): string {
    return `${ID_PREFIX}:${leadId}:${KIND_CODE[kind]}:${ref}`;
}

export interface LocatorReply { leadId: string; kind: ReplyKind; ref: string; }

/** The row id of a tap, if it is one of ours; null for anything else. */
export function parseRowId(id: string): LocatorReply | null {
    const parts = String(id ?? '').split(':');
    if (parts.length !== 4 || parts[0] !== ID_PREFIX) return null;
    const kind = CODE_KIND[parts[2]];
    if (!kind || !parts[1] || !parts[3]) return null;
    return { leadId: parts[1], kind, ref: parts[3] };
}

/**
 * The row id out of a message_received webhook, if the customer tapped a list
 * row or a reply button of ours.
 *
 * Interakt passes the WhatsApp reply through as a JSON string in
 * data.message.message — the stored button taps look like
 * {"type": "button_reply", "button_reply": {"id": …, "title": …}}. List taps
 * are read the same way under list_reply.
 */
export function replyFromWebhook(message: any): LocatorReply | null {
    let body: any = message?.message;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return null; }
    }
    const id = body?.list_reply?.id ?? body?.button_reply?.id;
    return id ? parseRowId(String(id)) : null;
}

// ─── Shapes going in ────────────────────────────────────────────────────────

export interface ListStore {
    id: string;
    store_name: string;
    city: string | null;
    distance_label: string;
}

export interface ListContact {
    id: string | null;
    name: string;
    phone: string | null;
    city?: string | null;
    distance_label?: string | null;
}

/** An Interakt InteractiveList message's `data` block. */
export interface InteractiveList {
    message: {
        type: 'list';
        body: { text: string };
        action: {
            button: string;
            sections: { title: string; rows: { id: string; title: string; description?: string }[] }[];
        };
    };
}

// ─── Lists ──────────────────────────────────────────────────────────────────

interface Row { id: string; title: string; description?: string; }

/**
 * One page of rows. Up to ten fit on a page when that is all there are;
 * otherwise nine and a "More" row, so the customer can always reach the rest.
 */
function paginate<T>(items: T[], page: number, toRow: (item: T) => Row, moreRow: (next: number) => Row) {
    if (page < 1 || page > pageCount(items.length)) return { rows: [] as Row[], hasMore: false };
    let start = 0;
    for (let p = 1; p < page; p++) start += PAGE_WITH_MORE;
    const remaining = items.length - start;
    if (remaining <= 0) return { rows: [] as Row[], hasMore: false };
    if (remaining <= LIMITS.rows) return { rows: items.slice(start).map(toRow), hasMore: false };
    return {
        rows: [...items.slice(start, start + PAGE_WITH_MORE).map(toRow), moreRow(page + 1)],
        hasMore: true,
    };
}

export function pageCount(total: number): number {
    if (total <= LIMITS.rows) return 1;
    let pages = 1, left = total;
    while (left > LIMITS.rows) { left -= PAGE_WITH_MORE; pages++; }
    return pages;
}

/*
 * A message body cut to length with its line breaks kept. fit() flattens all
 * whitespace — right for a row title, but it ran a list's greeting and
 * instructions together into one paragraph.
 */
function fitBody(text: string, max: number): string {
    const clean = String(text ?? '')
        .split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function list(body: string, button: string, section: string, rows: Row[]): InteractiveList {
    return {
        message: {
            type: 'list',
            body: { text: fitBody(body, LIMITS.body) },
            action: {
                button: fit(button, LIMITS.button),
                sections: [{
                    title: fit(section, LIMITS.sectionTitle),
                    rows: rows.map(r => ({
                        id: r.id.slice(0, LIMITS.rowId),
                        title: fit(r.title, LIMITS.rowTitle),
                        ...(r.description ? { description: fit(r.description, LIMITS.rowDescription) } : {}),
                    })),
                }],
            },
        },
    };
}

export function titleCase(s: string | null | undefined): string {
    return String(s ?? '').toLowerCase().replace(/\b[a-z]/g, ch => ch.toUpperCase()).trim();
}

/*
 * What the customer reads.
 *
 * Every contact is presented to the customer as an Autoform store — a store
 * nearby, a distributor, the ASM, or customer support. Who is behind the
 * number is our routing, not something the customer needs to weigh up; to them
 * it is simply where to go. No distance or range is shown either: "near you"
 * is the promise, and a kilometre figure only invites second-guessing.
 */

const LIST_BODY =
    'Here are the Autoform stores near you 📍\n\n' +
    "Tap *View stores* and select one — we'll send you its address and phone number.";
const LIST_BODY_MORE = 'More Autoform stores near you 📍';

/** Stores, or the state's distributors standing in for them — the same list to the customer. */
function nearbyList(
    leadId: string,
    kind: 'store' | 'distributor',
    items: { id: string | null; name: string; city?: string | null }[],
    page: number,
): InteractiveList | null {
    const { rows } = paginate(
        items, page,
        item => ({
            id: rowId(leadId, kind, String(item.id)),
            title: item.name,
            description: titleCase(item.city) || undefined,
        }),
        next => ({ id: rowId(leadId, 'more', next), title: 'More stores', description: 'See more stores near you' }),
    );
    if (!rows.length) return null;
    return list(page === 1 ? LIST_BODY : LIST_BODY_MORE, 'View stores', 'Stores near you', rows);
}

/** The stores near the customer, in the locator's order: their city first, then A to Z. */
export function storeList(leadId: string, stores: ListStore[], page = 1): InteractiveList | null {
    return nearbyList(leadId, 'store', stores.map(s => ({ id: s.id, name: s.store_name, city: s.city })), page);
}

/** The state's distributors, when no store is close enough — shown as stores. */
export function distributorList(leadId: string, distributors: ListContact[], page = 1): InteractiveList | null {
    return nearbyList(leadId, 'distributor', distributors, page);
}

// ─── Plain text ─────────────────────────────────────────────────────────────

export interface StoreDetails {
    store_name: string;
    address: string | null;
    city: string | null;
    pincode: string | null;
    phone: string | null;
}

/** One address line, without repeating a city or pincode the address already ends in. */
function addressLine(address: string | null, city: string | null, pincode: string | null): string {
    const parts = [address, titleCase(city), pincode].map(p => String(p ?? '').trim()).filter(Boolean);
    return parts
        .filter((p, i) => i === 0 || !parts[0].toLowerCase().includes(p.toLowerCase()))
        .join(', ');
}

function card(name: string, address: string, phone: string | null): string {
    return [
        `🏪 *${name.trim()}*`,
        address ? `📍 ${address}` : null,
        phone ? `📞 ${formatPhone(phone)}` : null,
    ].filter(Boolean).join('\n');
}

const HELP_LINE =
    'Feel free to call or visit — the team will be happy to help you choose the right products for your car. 🚗';
const ANOTHER_LINE = 'Looking for a store somewhere else? Just send us that pincode.';

/** Our customer executive, under every final answer (the support number in the locator settings). */
function helplineLines(helpline: string | null | undefined): string[] {
    return helpline ? ['', `For any other help, call our Customer Executive: 📞 ${formatPhone(helpline)}`] : [];
}

/** The store the customer picked. */
/**
 * The store's details: the one the customer picked, or — `only` — the one store
 * near them, sent straight away instead of a list of one to tap.
 */
export function storeDetailsText(s: StoreDetails, helpline?: string | null, only = false): string {
    return [
        only ? 'Thank you for reaching out to Autoform! 🙏' : 'Thank you for choosing Autoform! 🙏',
        '',
        only ? 'Here is the Autoform store nearest to you:' : "Here are your store's details:",
        '',
        card(s.store_name, addressLine(s.address, s.city, s.pincode), s.phone),
        '',
        HELP_LINE,
        ...helplineLines(helpline),
        '',
        ANOTHER_LINE,
    ].join('\n');
}

/** The distributor the customer picked — told as a store, like the list they picked from. */
export function distributorDetailsText(d: ListContact, helpline?: string | null, only = false): string {
    return storeDetailsText({ store_name: d.name, address: null, city: d.city ?? null, pincode: null, phone: d.phone }, helpline, only);
}

/** The ASM, when no store is near: one contact, sent straight away. */
export function asmText(asm: ListContact, helpline?: string | null): string {
    return [
        'Thank you for reaching out to Autoform! 🙏',
        '',
        'Here is the Autoform store contact nearest to you:',
        '',
        card(asm.name, titleCase(asm.city), asm.phone),
        '',
        'Give them a call — they will be happy to help you choose the right products for your car. 🚗',
        ...helplineLines(helpline),
    ].join('\n');
}

/** The last resort: nobody in the state, or a pincode we could not place. */
export function supportText(support: ListContact): string {
    if (!support.phone) {
        return [
            'Thank you for reaching out to Autoform! 🙏',
            '',
            'Our team will get in touch with you shortly to help you find the right store and products for your car. 🚗',
        ].join('\n');
    }
    return [
        'Thank you for reaching out to Autoform! 🙏',
        '',
        'Our team will help you find the right store and products for your car:',
        '',
        card(support.name, '', support.phone),
        '',
        "Give us a call — we'll be happy to help. 🚗",
    ].join('\n');
}

export const INVALID_PINCODE_TEXT =
    "That doesn't look like a pincode. Please send your 6-digit area pincode, for example 110001.";

/*
 * The questions our server asks once the Interakt workflow hands over after the
 * product menu (locatorConversation), and what it says when an answer will not
 * do. Each re-prompt says what was wrong and gives an example, so a customer is
 * never just told "invalid".
 */
/*
 * The product menu, now sent by our server rather than the Interakt workflow.
 * WhatsApp allows only three reply buttons, and there are four choices plus a
 * sub-menu — so both are lists (up to ten rows behind one tap). A tap comes
 * back as `pm:<lead id>:<key>`.
 */
export type MenuKey = 'seat' | 'mats' | 'acc' | 'other' | 'care' | 'lights' | 'audio' | 'back';

const MENU_PREFIX = 'pm';
export const menuRowId = (leadId: string, key: MenuKey) => `${MENU_PREFIX}:${leadId}:${key}`;

/** A tap on one of our menus, out of a message_received webhook; null for anything else. */
export function menuTapFromWebhook(message: any): { leadId: string; key: MenuKey } | null {
    let body: any = message?.message;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return null; }
    }
    const parts = String(body?.list_reply?.id ?? body?.button_reply?.id ?? '').split(':');
    const keys: MenuKey[] = ['seat', 'mats', 'acc', 'other', 'care', 'lights', 'audio', 'back'];
    if (parts.length !== 3 || parts[0] !== MENU_PREFIX || !parts[1] || !keys.includes(parts[2] as MenuKey)) return null;
    return { leadId: parts[1], key: parts[2] as MenuKey };
}

const MAIN_MENU_BODY = [
    '🎉 Hello! Thanks for reaching out to us at Autoform India.',
    '',
    '🚘 We offer a wide range of car seat covers, car mats, and other car accessories.',
    '',
    '💬 Tap *Choose a product* and let us know what you are looking for! 😊',
].join('\n');

/* After the 4-wheeler / 2-wheeler question the customer has been greeted already. */
const MAIN_MENU_BODY_AFTER_VEHICLE = [
    '🚘 We offer a wide range of car seat covers, car mats, and other car accessories.',
    '',
    '💬 Tap *Choose a product* and let us know what you are looking for! 😊',
].join('\n');

/** `greet: false` once the vehicle question has said hello. */
export function productMenu(leadId: string, greet = true): InteractiveList {
    return list(greet ? MAIN_MENU_BODY : MAIN_MENU_BODY_AFTER_VEHICLE, 'Choose a product', 'Our products', [
        { id: menuRowId(leadId, 'seat'), title: 'Seat Covers', description: 'Custom-fit seat covers for your car' },
        { id: menuRowId(leadId, 'mats'), title: 'Car Mats', description: 'Floor and boot mats' },
        { id: menuRowId(leadId, 'acc'), title: 'Accessories', description: 'Car accessories' },
        { id: menuRowId(leadId, 'other'), title: 'Other Products', description: 'Care & fragrance, lights, audio & security' },
    ]);
}

export function otherProductsMenu(leadId: string): InteractiveList {
    return list('Which of these are you looking for? 🚗', 'Choose a product', 'Other products', [
        { id: menuRowId(leadId, 'care'), title: 'Care & Fragrance' },
        { id: menuRowId(leadId, 'lights'), title: 'Lights & Utility' },
        { id: menuRowId(leadId, 'audio'), title: 'Audio & Security' },
        { id: menuRowId(leadId, 'back'), title: '↩ Back to main menu' },
    ]);
}

export const MENU_RETRY = 'Please tap *Choose a product* above and pick one of the options. 🙏';

/*
 * The first question: a 4-wheeler goes on to the product menu as before; a
 * 2-wheeler is given the Customer Executive's number, and the executive is
 * alerted. Two reply buttons (WhatsApp allows three, titles up to 20
 * characters); a tap comes back as `vt:<lead id>:4w|2w`.
 */
export type Vehicle = '4w' | '2w';

const VEHICLE_PREFIX = 'vt';
export const vehicleButtonId = (leadId: string, v: Vehicle) => `${VEHICLE_PREFIX}:${leadId}:${v}`;

/** An Interakt InteractiveButton message's `data` block. */
export interface InteractiveButtons {
    message: {
        type: 'button';
        body: { text: string };
        action: { buttons: { type: 'reply'; reply: { id: string; title: string } }[] };
    };
}

export const BUTTON_TITLE_MAX = 20;

const VEHICLE_BODY = [
    '🎉 Hello! Thanks for reaching out to us at Autoform India.',
    '',
    'Is your enquiry for a *4-Wheeler* 🚗 or a *2-Wheeler* 🏍️?',
].join('\n');

export function vehicleQuestion(leadId: string): InteractiveButtons {
    const button = (v: Vehicle, title: string) =>
        ({ type: 'reply' as const, reply: { id: vehicleButtonId(leadId, v).slice(0, LIMITS.rowId), title: fit(title, BUTTON_TITLE_MAX) } });
    return {
        message: {
            type: 'button',
            body: { text: fitBody(VEHICLE_BODY, LIMITS.body) },
            action: { buttons: [button('4w', '🚗 4-Wheeler'), button('2w', '🏍️ 2-Wheeler')] },
        },
    };
}

/** The same question as plain text, if the buttons could not be sent. */
export const VEHICLE_TEXT = [
    '🎉 Hello! Thanks for reaching out to us at Autoform India.',
    '',
    'Is your enquiry for a 4-Wheeler 🚗 or a 2-Wheeler 🏍️?',
    '',
    'Reply *4* for 4-Wheeler or *2* for 2-Wheeler.',
].join('\n');

export const VEHICLE_RETRY = 'Please tap *4-Wheeler* or *2-Wheeler* above, or reply *4* or *2*. 🙏';

/** A tap on the vehicle buttons, out of a message_received webhook; null for anything else. */
export function vehicleTapFromWebhook(message: any): { leadId: string; vehicle: Vehicle } | null {
    let body: any = message?.message;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return null; }
    }
    const parts = String(body?.button_reply?.id ?? body?.list_reply?.id ?? '').split(':');
    if (parts.length !== 3 || parts[0] !== VEHICLE_PREFIX || !parts[1] || !['4w', '2w'].includes(parts[2])) return null;
    return { leadId: parts[1], vehicle: parts[2] as Vehicle };
}

/** A 2-wheeler enquiry: the Customer Executive's number to call or WhatsApp; the executive is alerted too. */
export function twoWheelerText(helpline: string | null | undefined): string {
    if (!helpline) {
        return [
            'Thank you for reaching out to Autoform India! 🙏',
            '',
            'Our Customer Executive will call you shortly to help you with products for your 2-wheeler. 🏍️',
        ].join('\n');
    }
    const ten = String(helpline).replace(/\D/g, '').slice(-10);
    return [
        'Thank you for reaching out to Autoform India! 🙏',
        '',
        'For 2-wheeler products, our Customer Executive will help you. Call or WhatsApp them:',
        '',
        `📞 Call: ${formatPhone(helpline)}`,
        `💬 WhatsApp: https://wa.me/91${ten}`,
        '',
        "They'll be happy to help, and may also call you shortly. 🏍️",
    ].join('\n');
}

export const CAR_QUESTION =
    'Which car do you have? 🚗\n\nPlease type the model, for example Creta, Nexon or Thar.';

export const CAR_RETRY: Record<'empty' | 'junk' | 'place', string> = {
    empty: 'Please type your car model, for example Creta, Nexon or Thar.',
    junk: "Sorry, we couldn't read that as a car. Please type your car model, for example Creta, Nexon or Thar.",
    place: 'That looks like a place 🙂 Please type your car model, for example Creta, Nexon or Thar.',
};

export function whichModelText(make: string, examples: string): string {
    return `Which ${make}? Please type the model${examples ? `, for example ${examples}` : ''}.`;
}

export const PINCODE_QUESTION =
    'Thanks! 📍 Please send your 6-digit area pincode, so we can find the Autoform store nearest you. For example 110001.';

export function unknownPincodeText(pincode: string): string {
    return `We couldn't find the pincode ${pincode}. Could you check it and send it again?`;
}

/** Two wrong pincodes: nobody is kept going round — the team calls instead. */
export const NO_PINCODE_END =
    'Thank you! 🙏 Our team will call you shortly to help you find the nearest Autoform store.';

export const PLEASE_TYPE_TEXT = 'Please type your answer as a message so we can help. 🙏';

export const CANCELLED_TEXT = 'No problem. Send "Heyy" any time to start again. 🙏';

/** Anything unexpected on our side: the customer still hears from us, and the lead is kept. */
export const SORRY_TEXT = 'Sorry, something went wrong on our side. 🙏 Our team will call you shortly.';

/** 919876543210 or 9876543210 -> +91 98765 43210. */
export function formatPhone(raw: string): string {
    const digits = String(raw ?? '').replace(/\D/g, '');
    const ten = digits.slice(-10);
    if (ten.length !== 10) return String(raw ?? '').trim();
    return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;
}
