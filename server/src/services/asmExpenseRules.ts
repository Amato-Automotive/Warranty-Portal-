/**
 * What an ASM expense claim may contain, and what it adds up to.
 *
 * Pure — no database — so it is tested directly and the controller only has to
 * store what this returns. The form on the ASM portal applies the same rules
 * for a quick answer; this is the copy that counts.
 *
 * Two kinds of claim:
 *  - local: travel within the ASM's own city on one day — any number of
 *    from/to trips with an amount each. No bills.
 *  - tour:  an outstation trip over a date range — the journey there and back,
 *    an optional hotel stay, and other costs on the way. Bills are required
 *    wherever the ASM paid for a ticket, a cab or a hotel.
 */

/** Claims may be filed for travel up to this many days back, and no later. */
export const BACKDATE_DAYS = 7;
export const MAX_TOUR_DAYS = 30;
const MAX_AMOUNT = 100000;
const MAX_TRIPS = 20;
const MAX_OTHERS = 10;

export const TRAVEL_MODES = ['train', 'bus', 'flight', 'cab', 'own_vehicle'] as const;
export type TravelMode = typeof TRAVEL_MODES[number];

/** Modes where a ticket is bought — so either the ASM or the company booked it. */
export const TICKETED_MODES: readonly TravelMode[] = ['train', 'bus', 'flight'];

/** The file each bill arrives under in the upload. */
export type BillField = 'onward_ticket' | 'return_ticket' | 'hotel_bill';

export interface ExpenseItem {
    kind: 'trip' | 'onward' | 'return' | 'hotel' | 'other';
    from_place: string | null;
    to_place: string | null;
    description: string | null;
    amount: number;
    /** Which uploaded file is this item's bill, if any. */
    bill: BillField | null;
}

export interface ValidClaim {
    type: 'local' | 'tour';
    start_date: string;
    end_date: string;
    from_place: string | null;
    to_place: string | null;
    travel_mode: TravelMode | null;
    tickets_by: 'self' | 'company' | null;
    one_way: boolean;
    hotel_stay: boolean;
    hotel_nights: number | null;
    hotel_persons: number | null;
    remarks: string | null;
    items: ExpenseItem[];
    total_amount: number;
    /** Bills that must be attached for this claim. */
    required_bills: BillField[];
}

export class ExpenseRuleError extends Error {}

const fail = (msg: string): never => { throw new ExpenseRuleError(msg); };

const text = (v: unknown, label: string, max: number, required = true): string | null => {
    const s = String(v ?? '').trim().replace(/\s+/g, ' ');
    if (!s) return required ? fail(`${label} is required`) : null;
    if (s.length > max) fail(`${label} is too long (${max} characters at most)`);
    return s;
};

const money = (v: unknown, label: string): number => {
    const s = String(v ?? '').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s)) fail(`${label}: enter an amount in rupees`);
    const n = Number(s);
    if (n <= 0) fail(`${label} must be more than ₹0`);
    if (n > MAX_AMOUNT) fail(`${label} is over ₹${MAX_AMOUNT.toLocaleString('en-IN')} — please check it`);
    return n;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

const date = (v: unknown, label: string): string => {
    const s = String(v ?? '').trim();
    if (!ISO.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) fail(`${label} is required`);
    return s;
};

/** Travel must have happened, and no more than BACKDATE_DAYS ago. */
const withinWindow = (iso: string, today: string, label: string) => {
    const diff = dayNumber(today) - dayNumber(iso);
    if (diff < 0) fail(`${label} cannot be in the future`);
    if (diff > BACKDATE_DAYS) fail(`${label} is more than ${BACKDATE_DAYS} days ago — claims must be filed within ${BACKDATE_DAYS} days of travel`);
};

const yes = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';

/**
 * Check a claim as the form sent it and turn it into what is stored.
 * `today` is the IST date, YYYY-MM-DD. Throws ExpenseRuleError with a message
 * fit to show the ASM.
 */
export function validateExpenseClaim(input: any, today: string): ValidClaim {
    if (!input || typeof input !== 'object') fail('Claim details are missing');
    const remarks = text(input.remarks, 'Remarks', 1000, false);

    if (input.type === 'local') {
        const day = date(input.date, 'Date of travel');
        withinWindow(day, today, 'Date of travel');

        const trips = Array.isArray(input.trips) ? input.trips : [];
        if (trips.length === 0) fail('Add at least one trip');
        if (trips.length > MAX_TRIPS) fail(`At most ${MAX_TRIPS} trips in one claim`);

        const items: ExpenseItem[] = trips.map((t: any, i: number) => ({
            kind: 'trip' as const,
            from_place: text(t?.from, `Trip ${i + 1}: From`, 120),
            to_place: text(t?.to, `Trip ${i + 1}: To`, 120),
            description: null,
            amount: money(t?.amount, `Trip ${i + 1}: Amount`),
            bill: null,
        }));

        return {
            type: 'local', start_date: day, end_date: day,
            from_place: null, to_place: null, travel_mode: null, tickets_by: null, one_way: false,
            hotel_stay: false, hotel_nights: null, hotel_persons: null,
            remarks, items, total_amount: sum(items), required_bills: [],
        };
    }

    if (input.type !== 'tour') fail('Choose Local Conveyance or Outstation Tour');

    const start = date(input.startDate, 'Start date');
    const end = date(input.endDate, 'Return date');
    if (dayNumber(end) < dayNumber(start)) fail('Return date is before the start date');
    withinWindow(end, today, 'Return date');
    const span = dayNumber(end) - dayNumber(start);
    if (span + 1 > MAX_TOUR_DAYS) fail(`A tour can be at most ${MAX_TOUR_DAYS} days`);

    const fromCity = text(input.fromCity, 'From city', 120);
    const toCity = text(input.toCity, 'To city', 120);

    const mode = input.travelMode as TravelMode;
    if (!TRAVEL_MODES.includes(mode)) fail('Choose the mode of travel');
    const ticketed = TICKETED_MODES.includes(mode);

    // A cab or own vehicle is always paid by the ASM; only tickets can be the
    // company's.
    let ticketsBy: 'self' | 'company' | null = null;
    if (ticketed) {
        if (input.ticketsBy !== 'self' && input.ticketsBy !== 'company') fail('Say who booked the tickets');
        ticketsBy = input.ticketsBy;
    }
    const paidBySelf = !ticketed || ticketsBy === 'self';
    const oneWay = paidBySelf && yes(input.oneWay);
    // Bills: tickets and cab receipts. Fuel for their own vehicle has none.
    const billed = mode !== 'own_vehicle';

    const items: ExpenseItem[] = [];
    const required: BillField[] = [];
    if (paidBySelf) {
        items.push({
            kind: 'onward', from_place: fromCity, to_place: toCity, description: null,
            amount: money(input.onwardAmount, 'Onward journey amount'),
            bill: billed ? 'onward_ticket' : null,
        });
        if (billed) required.push('onward_ticket');
        if (!oneWay) {
            items.push({
                kind: 'return', from_place: toCity, to_place: fromCity, description: null,
                amount: money(input.returnAmount, 'Return journey amount'),
                bill: billed ? 'return_ticket' : null,
            });
            if (billed) required.push('return_ticket');
        }
    }

    const hotelStay = yes(input.hotelStay);
    let nights: number | null = null;
    let persons: number | null = null;
    if (hotelStay) {
        nights = Number(input.hotelNights);
        persons = Number(input.hotelPersons);
        const maxNights = Math.max(1, span);
        if (!Number.isInteger(nights) || nights < 1 || nights > maxNights) {
            fail(`Hotel nights must be between 1 and ${maxNights} for these dates`);
        }
        if (!Number.isInteger(persons) || persons < 1 || persons > 10) fail('Persons staying must be between 1 and 10');
        items.push({
            kind: 'hotel', from_place: null, to_place: null,
            description: `${nights} night${nights === 1 ? '' : 's'}, ${persons} person${persons === 1 ? '' : 's'}`,
            amount: money(input.hotelAmount, 'Hotel amount'), bill: 'hotel_bill',
        });
        required.push('hotel_bill');
    }

    const others = Array.isArray(input.others) ? input.others : [];
    if (others.length > MAX_OTHERS) fail(`At most ${MAX_OTHERS} other expenses in one claim`);
    others.forEach((o: any, i: number) => items.push({
        kind: 'other', from_place: null, to_place: null,
        description: text(o?.description, `Other expense ${i + 1}: What for`, 200),
        amount: money(o?.amount, `Other expense ${i + 1}: Amount`), bill: null,
    }));

    if (items.length === 0) fail('Nothing to claim — add a ticket, hotel or other expense');

    return {
        type: 'tour', start_date: start, end_date: end,
        from_place: fromCity, to_place: toCity, travel_mode: mode, tickets_by: ticketsBy, one_way: oneWay,
        hotel_stay: hotelStay, hotel_nights: nights, hotel_persons: persons,
        remarks, items, total_amount: sum(items), required_bills: required,
    };
}

/** Rupee total, kept exact to the paisa. */
function sum(items: ExpenseItem[]): number {
    return items.reduce((t, i) => t + Math.round(i.amount * 100), 0) / 100;
}

// ── Head office's decision ───────────────────────────────────────────────────

export type ExpenseDecision = 'approve' | 'partial' | 'reject';

export interface DecisionResult {
    status: 'approved' | 'partially_approved' | 'rejected';
    /** Approved amount for every line, by item id. */
    approved: Record<string, number>;
    approved_total: number;
    note: string | null;
}

const paise = (n: number) => Math.round(n * 100);

/**
 * Turn an admin's decision on a claim into what is stored.
 *
 *  - approve: every line in full; a note is optional.
 *  - partial: an approved amount for every line, none above what was claimed,
 *    with a reason. Cutting nothing is an approval and cutting everything a
 *    rejection, so both are refused here and the admin uses those instead —
 *    the ASM then sees the status that actually describes it.
 *  - reject:  nothing approved; a reason is required.
 */
export function decideExpenseClaim(
    items: { id: string; amount: number }[],
    input: any
): DecisionResult {
    const action = input?.action as ExpenseDecision;
    if (!['approve', 'partial', 'reject'].includes(action)) fail('Choose approve, approve part or reject');
    const note = text(input?.note, 'Reason', 1000, action !== 'approve');

    if (action === 'approve') {
        const approved = Object.fromEntries(items.map(i => [i.id, i.amount]));
        return { status: 'approved', approved, approved_total: centsTotal(items.map(i => i.amount)), note };
    }

    if (action === 'reject') {
        const approved = Object.fromEntries(items.map(i => [i.id, 0]));
        return { status: 'rejected', approved, approved_total: 0, note };
    }

    if (action !== 'partial') fail('Choose approve, approve part or reject');

    const given = input?.amounts && typeof input.amounts === 'object' ? input.amounts : {};
    const approved: Record<string, number> = {};
    items.forEach((item, i) => {
        const raw = String(given[item.id] ?? '').trim();
        if (!/^\d+(\.\d{1,2})?$/.test(raw)) fail(`Line ${i + 1}: enter the approved amount (0 if none)`);
        const n = Number(raw);
        if (paise(n) > paise(item.amount)) fail(`Line ${i + 1}: approved amount is more than was claimed`);
        approved[item.id] = n;
    });

    const total = centsTotal(Object.values(approved));
    if (total === 0) fail('Nothing is approved — use Reject instead');
    if (items.every(i => paise(approved[i.id]) === paise(i.amount))) fail('Nothing was reduced — use Approve instead');

    return { status: 'partially_approved', approved, approved_total: total, note };
}

function centsTotal(values: number[]): number {
    return values.reduce((t, v) => t + paise(v), 0) / 100;
}

/** A decision can be changed until the money has gone out. */
export const DECIDED_STATUSES = ['approved', 'partially_approved', 'rejected'] as const;
export const canChangeDecision = (status: string) => (DECIDED_STATUSES as readonly string[]).includes(status);

/** Only a claim with something approved can be paid. */
export const canMarkPaid = (status: string) => status === 'approved' || status === 'partially_approved';

export interface PaymentDetails {
    paid_on: string;
    reference: string | null;
}

/**
 * Head office marking an approved claim paid: the date the money went out
 * (today or earlier, within the last 90 days) and an optional reference — a
 * UTR, cheque number or "cash".
 */
export function validatePayment(input: any, today: string): PaymentDetails {
    const paidOn = date(input?.paid_on, 'Date paid');
    const diff = dayNumber(today) - dayNumber(paidOn);
    if (diff < 0) fail('Date paid cannot be in the future');
    if (diff > 90) fail('Date paid is more than 90 days ago — please check it');
    return { paid_on: paidOn, reference: text(input?.reference, 'Payment reference', 100, false) };
}

// ── The WhatsApp message to the ASM ──────────────────────────────────────────

const inr = (n: number) => `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * Body values for af_asm_expense_update, one template for every outcome:
 *   {{1}} ASM name  {{2}} claim number  {{3}} what happened
 *   {{4}} claimed   {{5}} approved      {{6}} note or reason ("-" if none)
 * `changed` marks a decision head office has revised.
 */
export function expenseUpdateValues(c: {
    asm_name: string | null;
    claim_number: string;
    status: string;
    total_amount: number;
    approved_amount: number | null;
    note: string | null;
    changed?: boolean;
    paid_on?: string | null;
}): string[] {
    const outcome: Record<string, string> = {
        approved: 'approved',
        partially_approved: 'partly approved',
        rejected: 'rejected',
        paid: 'paid',
    };
    let what = outcome[c.status] ?? c.status;
    if (c.changed) what = `changed to ${what}`;
    if (c.status === 'paid' && c.paid_on) {
        const [y, m, d] = c.paid_on.split('-').map(Number);
        what += ` on ${new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
    }
    return [
        c.asm_name?.trim() || 'Team',
        c.claim_number,
        what,
        inr(c.total_amount),
        inr(c.approved_amount ?? 0),
        c.note?.trim() || '-',
    ];
}
