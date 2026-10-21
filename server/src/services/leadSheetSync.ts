import type { SheetLead } from './leadSheetParser.js';
import { leadKey, phoneKey } from './leadIdentity.js';
import { extractPincode } from './storeLocator.js';

/**
 * Deciding what a sheet sync should do with each row, before anything is written.
 *
 * Kept apart from the import that performs it, and free of any database import,
 * because this is where a mistake is expensive: a wrong decision here either
 * files a duplicate an ASM is messaged about twice, or silently drops a real
 * customer. Every rule below is exercised directly in the tests.
 *
 * The sync never decides what happens to a lead after it exists. An admin's
 * review, the store they picked, the status they set — those belong to the
 * admin, and a re-sync leaves them exactly as they were.
 */

/** An existing lead, as much of it as the decision needs. */
export interface ExistingLead {
    id: string;
    phone_key: string | null;
    raw_area: string | null;
    car_model: string | null;
    product: string | null;
}

export type SyncAction =
    /** Not seen before, and recent enough to send. */
    | 'route'
    /** Not seen before, but older than the cutoff: recorded, never sent. */
    | 'import_silent'
    /** Already in the table — the ASM has heard about it. */
    | 'duplicate'
    /** Nothing usable to route or call back. */
    | 'unusable';

export interface SyncDecision {
    lead: SheetLead;
    action: SyncAction;
    /** The lead this repeats, when the action is 'duplicate'. */
    existingId?: string;
    /** Why, in words, for the import report. */
    reason: string;
}

/**
 * A phone we could actually call back.
 *
 * Ten digits after stripping punctuation and any country code. Three rows in
 * the September export fail this — a lead with no reachable number is worth
 * recording nowhere, since neither an ASM nor an admin can act on it.
 */
export function hasUsablePhone(lead: SheetLead): boolean {
    return phoneKey(lead.phone).length === 10;
}

/**
 * When this lead was created, as a date.
 *
 * Meta writes an ISO timestamp with an offset ("2026-06-08T09:55:49-05:00").
 * Returns null for anything unparseable rather than guessing, so a row with a
 * broken date is treated as old and never sent by surprise.
 */
export function leadDate(lead: SheetLead): Date | null {
    const raw = String(lead.createdAt || '').trim();
    if (!raw) return null;
    const at = new Date(raw);
    return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The identity of a sheet lead, in the same shape the router records.
 *
 * `raw_area` on a lead row holds whatever the customer gave as their location.
 * For a store-locator lead — the workflow's and, since the forms ask for one,
 * Instagram's — that is the pincode, so the pincode leads here too: it is what
 * makes a lead captured on WhatsApp and its sheet copy recognise each other.
 * Older rows without one fall back to the state or city as before.
 */
export function sheetArea(lead: SheetLead): string | null {
    return extractPincode(lead.pincode) ?? extractPincode(lead.city) ?? (lead.state || lead.city);
}

function sheetKey(lead: SheetLead): string {
    return leadKey({
        phone: lead.phone,
        area: sheetArea(lead),
        car: lead.car,
        product: lead.product,
    });
}

function existingKey(row: ExistingLead): string {
    return leadKey({
        phone: row.phone_key,
        area: row.raw_area,
        car: row.car_model,
        product: row.product,
    });
}

/**
 * What to do with every row of a sheet.
 *
 * `cutoff` is the date from which leads may be sent. Anything older is still
 * imported — it is a real customer and belongs in the table — but nobody is
 * messaged about it. Without that, a first sync of a three-month backlog would
 * fire thousands of paid templates at ASMs about enquiries long gone cold.
 *
 * Rows already represented in `existing` are marked duplicate, whichever source
 * put them there. That is what stops a lead captured on WhatsApp being sent a
 * second time when the sheet catches up with it.
 *
 * Duplicates *within the sheet itself* are caught too: the first occurrence
 * wins and later copies see it, so a file listing the same enquiry twice does
 * not produce two leads.
 */
export function planSync(
    leads: SheetLead[],
    existing: ExistingLead[],
    cutoff: Date | null
): SyncDecision[] {
    const byKey = new Map<string, string>();
    for (const row of existing) {
        const key = existingKey(row);
        if (!byKey.has(key)) byKey.set(key, row.id);
    }

    const decisions: SyncDecision[] = [];

    for (const lead of leads) {
        if (!hasUsablePhone(lead)) {
            decisions.push({
                lead, action: 'unusable',
                reason: 'No usable phone number',
            });
            continue;
        }

        const key = sheetKey(lead);
        const match = byKey.get(key);
        if (match) {
            decisions.push({
                lead, action: 'duplicate', existingId: match,
                reason: 'Already recorded — same phone, area, vehicle and product',
            });
            continue;
        }

        const at = leadDate(lead);
        const tooOld = cutoff !== null && (at === null || at < cutoff);

        decisions.push({
            lead,
            action: tooOld ? 'import_silent' : 'route',
            reason: tooOld
                ? (at === null
                    ? 'No readable date — imported without sending'
                    : `Created before the cutoff — imported without sending`)
                : 'New lead',
        });

        /*
         * Claimed immediately, so a second identical row later in the same file
         * is seen as a duplicate of this one rather than filed again. The id is
         * not known until the row is written, so the marker stands in for it.
         */
        byKey.set(key, match ?? '(this sync)');
    }

    return decisions;
}

/** What a sync did, for the admin who asked for it. */
export interface SyncSummary {
    total: number;
    routed: number;
    importedSilently: number;
    duplicates: number;
    unusable: number;
}

export function summarise(decisions: SyncDecision[]): SyncSummary {
    return {
        total: decisions.length,
        routed: decisions.filter(d => d.action === 'route').length,
        importedSilently: decisions.filter(d => d.action === 'import_silent').length,
        duplicates: decisions.filter(d => d.action === 'duplicate').length,
        unusable: decisions.filter(d => d.action === 'unusable').length,
    };
}

/* ─── The live import ────────────────────────────────────────────────────── */

/*
 * From 23 Sept 2026 Meta writes every lead-ad submission straight into the
 * "Autoform New Lead Sheet" (tab AD1), about ninety a day. The import files
 * each one into Lead Management once, and sends nobody anything: these
 * customers filled a form, they never messaged us, so there is no chat to
 * answer in, and the team calls them from the lead screen.
 *
 * A customer who filled the form AND messaged us on WhatsApp is already a lead
 * — the WhatsApp copy came first and is the one the chat worked on — so the
 * sheet row for them is skipped rather than filed twice.
 */

/** How close in time a WhatsApp Instagram lead and a sheet row must be to be one enquiry. */
export const SAME_ENQUIRY_DAYS = 3;

export type ImportAction =
    | 'insert'
    /* This Meta lead id is already in the table. */
    | 'already-imported'
    /* Same number reached us as an Instagram lead within SAME_ENQUIRY_DAYS. */
    | 'same-enquiry'
    /* No number anyone could call back. */
    | 'unusable'
    /* Before the import's start date. */
    | 'too-old'
    /* Too new to act on: the customer's WhatsApp copy may still be on its way. */
    | 'wait';

/*
 * A sheet row is left alone for this long. Most people who fill the form also
 * send the WhatsApp message within a minute or two; letting that arrive first
 * means the sheet row is recognised as the same enquiry instead of messaging
 * the customer and alerting the store a second time.
 */
export const SETTLE_MINUTES = 10;

export interface ImportDecision {
    lead: SheetLead;
    action: ImportAction;
    at: Date | null;
}

export interface KnownLeads {
    /** Meta lead ids already imported. */
    metaIds: Set<string>;
    /**
     * When each number last reached us as an Instagram lead, any way in. Only
     * the same number is the same enquiry: a different number is a different
     * lead, even under the same name (decided 6 Oct 2026).
     */
    instagramAt: Map<string, Date[]>;
}

export function planSheetImport(leads: SheetLead[], known: KnownLeads, since: Date | null, now: Date = new Date()): ImportDecision[] {
    const ids = new Set(known.metaIds);
    const seen = new Map<string, Date[]>();
    for (const [k, dates] of known.instagramAt) seen.set(k, [...dates]);
    const windowMs = SAME_ENQUIRY_DAYS * 86_400_000;
    const settleBefore = now.getTime() - SETTLE_MINUTES * 60_000;

    // Oldest first, so of two rows for one enquiry the first is the one kept.
    const ordered = [...leads].sort((a, b) => (leadDate(a)?.getTime() ?? 0) - (leadDate(b)?.getTime() ?? 0));

    return ordered.map(lead => {
        const at = leadDate(lead);
        const id = String(lead.leadId ?? '').replace(/^l:/i, '').trim();
        if (id && ids.has(id)) return { lead, action: 'already-imported', at };
        if (!hasUsablePhone(lead)) return { lead, action: 'unusable', at };
        if (since && (!at || at < since)) return { lead, action: 'too-old', at };

        const key = phoneKey(lead.phone);
        const when = at ?? new Date();
        const earlier = seen.get(key) ?? [];
        if (earlier.some(d => Math.abs(d.getTime() - when.getTime()) <= windowMs)) {
            return { lead, action: 'same-enquiry', at };
        }
        if (at && at.getTime() > settleBefore) return { lead, action: 'wait', at };
        if (id) ids.add(id);
        seen.set(key, [...earlier, when]);
        return { lead, action: 'insert', at };
    });
}

/** The car as the lead screen shows it: "SUV", "Etios cross 2015", "Swift (2019)". */
export function sheetCar(lead: Pick<SheetLead, 'car' | 'carYear'>): string | null {
    const car = String(lead.car ?? '').trim();
    const year = String(lead.carYear ?? '').trim();
    const yes = /^(yes|no|ok|haan|na)$/i;
    const parts = [yes.test(car) ? '' : car, year].filter(Boolean);
    if (!parts.length) return null;
    const text = parts.length === 2 && /^\d{4}(\s*-\s*\d{4})?$/.test(year) ? `${parts[0]} (${year})` : parts.join(' ');
    return text.replace(/\s+/g, ' ').slice(0, 80);
}
