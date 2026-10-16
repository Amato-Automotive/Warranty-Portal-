import db, { type SqlValue } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import { WhatsAppService } from './whatsapp.service.js';
import { findState } from './indianStates.js';
import { phoneKey, normaliseProduct, asmLeadNumber } from './asmRouting.service.js';
import { isPincode, extractPincode, localPhone } from './storeLocator.js';
import { findStoresForPincode, getLocatorSettings, repliesTo, type LocatorResult } from './storeLocatorQuery.js';
import {
    storeList,
    distributorList,
    storeDetailsText,
    distributorDetailsText,
    asmText,
    supportText,
    titleCase,
    INVALID_PINCODE_TEXT,
    type LocatorReply,
} from './storeLocatorMessages.js';

/**
 * The store locator over WhatsApp.
 *
 * The Interakt workflow greets the customer, asks what they want and for their
 * pincode, then hands over to us through a webhook and stops. From there:
 *
 *   pincode        → a list of stores near them, or the fallback contact
 *   tap a store    → its name, address and phone; the lead records the store
 *   tap a partner  → the same, for a distributor standing in for a store
 *   "More stores"  → the next page of the same list
 *   a new pincode  → the search again, for anyone mid-conversation with us
 *
 * Every enquiry is a lead, whether or not a reply went out. While the locator
 * is not live, only the admin's test numbers get replies, and nobody else is
 * ever messaged — not a customer, not an ASM. Third parties are contacted only
 * when it is live, so testing from your own phone can never reach a real ASM.
 */

/** Marks the leads this flow creates, to find them again when a tap comes back. */
export const LOCATOR_FLOW_ID = 'store-locator';

/**
 * The workflow can fire twice for one answer; the second is the same enquiry.
 *
 * Seconds, not minutes: a double-fire lands almost at once, while a customer
 * who runs the whole flow again for the same pincode is asking again and must
 * get the list again. At two minutes, a tester re-running the flow after 95
 * seconds was silently ignored.
 */
const REPEAT_WINDOW_SECONDS = 15;

/** How long after an enquiry a bare pincode is taken as a new search. */
const FOLLOW_UP_HOURS = 24;

const CONTEXT = 'store_locator';

export interface StoreEnquiry {
    pincode: string;
    phone: string;
    name?: string | null;
    product?: string | null;
    car?: string | null;
    /** Where the enquiry came from: the Interakt workflow, or an Instagram lead form. */
    source?: 'whatsapp' | 'instagram';
    rawPayload?: unknown;
    /**
     * The lead to finish, when our own chat collected the answers
     * (locatorConversation) — so one enquiry stays one lead, dated when the
     * customer first asked. Without it a new lead is created, as always.
     */
    leadId?: string;
    /** How the chat went, kept on the lead under locator.chat. */
    chat?: Record<string, unknown>;
}

/** Create the lead, or finish the one a chat started. */
async function writeLead(existingId: string | undefined, newId: string, cols: Record<string, unknown>) {
    const names = Object.keys(cols);
    if (existingId) {
        // Finishing a lead that already exists (a chat's, or an Instagram sheet
        // lead the customer has now written to): its raw_payload is merged into,
        // never replaced — a sheet lead keeps its Meta id, so it is not imported again.
        const set = (n: string) => n === 'raw_payload'
            ? 'raw_payload = JSON_MERGE_PATCH(COALESCE(raw_payload, JSON_OBJECT()), CAST(? AS JSON))'
            : `${n} = ?`;
        await db.execute(
            `UPDATE leads SET ${names.map(set).join(', ')}, updated_at = NOW() WHERE id = ?`,
            [...(Object.values(cols) as SqlValue[]), existingId]
        );
    } else {
        await db.execute(
            `INSERT INTO leads (id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`,
            [newId, ...(Object.values(cols) as SqlValue[])]
        );
    }
}

export type EnquiryOutcome =
    | 'invalid-pincode' | 'repeat'
    | 'stores' | 'distributor' | 'asm' | 'support';

/** "29 Sept, 03:45 pm" in IST — now, or when the enquiry actually came in. */
const receivedAt = (at: Date = new Date()) => at.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
});

async function reply(phone: string, type: 'Text' | 'InteractiveList', data: Record<string, unknown>, leadId?: string) {
    return WhatsAppService.sendSessionMessage(phone, type, data, CONTEXT, leadId);
}

const text = (body: string) => ({ message: body });

/**
 * A pincode from the workflow, or typed again mid-conversation.
 *
 * Never throws: it runs after the webhook has already been answered, and an
 * error here would only be lost in the log.
 */
export async function startStoreEnquiry(input: StoreEnquiry): Promise<EnquiryOutcome> {
    // Ten digits, as the team reads it — the alerts quote this number.
    const phone = localPhone(input.phone) || String(input.phone || '').trim();
    const typed = String(input.pincode || '').trim();
    const pincode = extractPincode(typed) ?? '';
    const source = input.source ?? 'whatsapp';
    const settings = await getLocatorSettings();
    const canReply = repliesTo(settings, phone);

    const [recent]: any = await db.execute(
        `SELECT id FROM leads
          WHERE phone_key = ? AND flow_id = ? AND raw_area <=> ?
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)
          LIMIT 1`,
        [phoneKey(phone), LOCATOR_FLOW_ID, pincode || typed.slice(0, 255) || null, REPEAT_WINDOW_SECONDS]
    );
    // A chat finishing its own lead is not a double-fire of the workflow.
    if (recent.length && !input.leadId) {
        console.log(`[Locator] repeat of ${pincode || typed || '(no pincode)'} from ${phoneKey(phone)} — lead ${recent[0].id} already answered`);
        return 'repeat';
    }

    if (!isPincode(pincode)) {
        /*
         * No usable pincode — an Instagram form answered "near the bus stand",
         * or left blank. The customer is asked for it, and the enquiry is kept
         * as a lead so it is not lost: that record is also what lets the
         * pincode they type next be taken up (handlePincodeMessage looks for a
         * recent locator lead from the same phone).
         */
        const leadId = input.leadId ?? uuidv4();
        if (canReply) await reply(phone, 'Text', text(INVALID_PINCODE_TEXT), leadId);
        await writeLead(input.leadId, leadId, {
            source,
            product: normaliseProduct(input.product),
            car_model: String(input.car || '').trim().slice(0, 80) || null,
            customer_name: input.name ? String(input.name).trim().slice(0, 255) : null,
            customer_phone: phone,
            phone_key: phoneKey(phone),
            raw_area: typed.slice(0, 255) || null,
            flow_id: LOCATOR_FLOW_ID,
            raw_payload: JSON.stringify({
                ...(input.rawPayload && typeof input.rawPayload === 'object' ? input.rawPayload as object : {}),
                locator: { pincode: typed || null, offered: 'invalid-pincode', ...(input.chat ? { chat: input.chat } : {}) },
            }),
            status: 'unmatched',
            failure_reason: 'No valid pincode given',
        });
        console.log(`[Locator] no valid pincode in "${typed}" from ${phoneKey(phone)} (${source}) — asked for one, lead ${leadId}`);
        return 'invalid-pincode';
    }

    const result = await findStoresForPincode(pincode);
    const leadId = input.leadId ?? uuidv4();
    const district = result.customer?.district ?? null;
    const place = district && district !== 'NA' ? `${titleCase(district)} (${pincode})` : pincode;
    const kind: EnquiryOutcome = result.stores.length ? 'stores' : (result.fallback?.kind ?? 'support');

    // ─── What the customer gets ─────────────────────────────────────────────
    let sent: boolean | null = null;   // null: held back, not live for this number
    if (canReply) {
        sent = await sendResult(phone, leadId, result, 1);
    }

    // ─── Who else hears about it: live only ─────────────────────────────────
    let status: 'matched' | 'unmatched' | 'sent' | 'failed' = kind === 'support' ? 'unmatched' : 'matched';
    let asmId: string | null = null;
    if (kind === 'asm') {
        const asm = result.fallback!.contacts[0];
        asmId = asm.id;
        if (settings.whatsapp_live && asm.phone) {
            const ok = await WhatsAppService.sendAsmEnquiry(
                asm.phone, asm.name, input.name || '', phone, place, receivedAt(),
                normaliseProduct(input.product), input.car || null,
                asm.id ? await asmLeadNumber(asm.id).catch(() => undefined) : undefined,
            ).catch(() => false);
            status = ok ? 'sent' : 'failed';
        }
    }

    const raw = {
        ...(input.rawPayload && typeof input.rawPayload === 'object' ? input.rawPayload as object : {}),
        locator: {
            pincode,
            offered: kind,
            count: kind === 'stores' ? result.stores.length : (result.fallback?.contacts.length ?? 0),
            reply: sent === null ? 'held' : sent ? 'sent' : 'failed',
            ...(input.chat ? { chat: input.chat } : {}),
        },
    };

    await writeLead(input.leadId, leadId, {
        source,
        product: normaliseProduct(input.product),
        car_model: String(input.car || '').trim().slice(0, 80) || null,
        state: findState(String(result.customer?.state ?? ''))?.state ?? null,
        customer_name: input.name ? String(input.name).trim().slice(0, 255) : null,
        customer_phone: phone,
        phone_key: phoneKey(phone),
        raw_area: pincode,
        matched_area: district && district !== 'NA' ? place : null,
        asm_id: asmId,
        flow_id: LOCATOR_FLOW_ID,
        raw_payload: JSON.stringify(raw),
        status,
        sent_at: status === 'sent' ? new Date() : null,
        failure_reason: sent === false ? 'WhatsApp reply to the customer failed' : null,
    });

    console.log(`[Locator] ${pincode} from ${phoneKey(phone)} (${source}) -> ${kind}` +
        `${kind === 'stores' ? ` (${result.stores.length})` : ''}, reply ${raw.locator.reply} — lead ${leadId}`);

    /*
     * The only store (or distributor) was sent straight to the customer: record
     * it and alert it, as a tap would. After the write, because the alert is
     * recorded on the lead row.
     */
    const only = sent ? onlyStore(result) : null;
    const onlyDist = sent ? onlyDistributor(result) : null;
    if (only || onlyDist) {
        try {
            const lead = await leadForAlert(leadId);
            if (lead && only) await recordStorePick(lead, String(only.id), only.phone, only.store_name, settings.whatsapp_live, true);
            if (lead && onlyDist) await recordDistributorPick(lead, String(onlyDist.id), onlyDist.phone, onlyDist.name, settings.whatsapp_live, true);
        } catch (err: any) {
            console.error('[Locator] recording the only store failed:', err?.message);
        }
    }

    /*
     * Nobody near — no store, ASM or distributor — so customer support is the
     * one place this lead can go. The customer is shown the support number;
     * support is told about the customer, in the same alert a store gets, so
     * the lead does not sit unseen in Lead Management. After the insert,
     * because notifyOnce records the alert on the lead row.
     */
    if (kind === 'support') {
        const support = result.fallback?.contacts[0];
        await notifyOnce(
            { id: leadId, notified: null, customer_phone: phone, location: place,
              product: normaliseProduct(input.product), car_model: String(input.car || '').trim() || null },
            'support', support?.phone ?? null, support?.name || 'Autoform Customer Support', settings.whatsapp_live,
        ).catch(err => console.error('[Locator] support alert failed:', err?.message));
    }
    return kind;
}

/*
 * One store (or one distributor) near the customer: a list of one to tap is
 * only a step in the way, so its details are sent straight away and the pick
 * is recorded as if they had tapped it.
 */
const onlyStore = (r: LocatorResult) => (r.stores.length === 1 ? r.stores[0] : null);
const onlyDistributor = (r: LocatorResult) =>
    (!r.stores.length && r.fallback?.kind === 'distributor' && r.fallback.contacts.length === 1 ? r.fallback.contacts[0] : null);

/** Send the customer what the locator found, at a given page of the list. */
async function sendResult(phone: string, leadId: string, result: LocatorResult, page: number): Promise<boolean> {
    const store = page === 1 ? onlyStore(result) : null;
    if (store) {
        const { support_phone } = await getLocatorSettings();
        return reply(phone, 'Text', text(storeDetailsText({
            store_name: store.store_name, address: store.address, city: store.city, pincode: store.pincode, phone: store.phone,
        }, support_phone, true)), leadId);
    }
    const dist = page === 1 ? onlyDistributor(result) : null;
    if (dist) {
        const { support_phone } = await getLocatorSettings();
        return reply(phone, 'Text', text(distributorDetailsText(dist, support_phone, true)), leadId);
    }

    if (result.stores.length) {
        const msg = storeList(leadId, result.stores, page);
        return msg ? reply(phone, 'InteractiveList', msg as any, leadId) : false;
    }

    const fallback = result.fallback;
    if (fallback?.kind === 'distributor') {
        const msg = distributorList(leadId, fallback.contacts, page);
        return msg ? reply(phone, 'InteractiveList', msg as any, leadId) : false;
    }
    if (fallback?.kind === 'asm') {
        const { support_phone } = await getLocatorSettings();
        return reply(phone, 'Text', text(asmText(fallback.contacts[0], support_phone)), leadId);
    }
    const support = fallback?.contacts[0] ?? { id: null, name: 'Autoform Customer Support', phone: null };
    return reply(phone, 'Text', text(supportText(support)), leadId);
}

/**
 * The customer tapped a row in one of our lists.
 *
 * The lead is looked up by the id in the row and must belong to the phone the
 * tap came from, so a row id cannot be replayed from another number to pull
 * someone else's enquiry. Returns whether the tap was ours to handle.
 */
export async function handleLocatorReply(senderPhone: string, tap: LocatorReply): Promise<boolean> {
    const [rows]: any = await db.execute(
        `SELECT id, raw_area, phone_key, customer_phone, product, car_model,
                JSON_EXTRACT(raw_payload, '$.locator.notified') AS notified
           FROM leads WHERE id = ? AND flow_id = ? LIMIT 1`,
        [tap.leadId, LOCATOR_FLOW_ID]
    );
    const lead = rows[0];
    if (!lead || lead.phone_key !== phoneKey(senderPhone)) {
        console.warn(`[Locator] tap for lead ${tap.leadId} from ${phoneKey(senderPhone)} does not match — ignored`);
        return true;
    }

    const settings = await getLocatorSettings();
    if (!repliesTo(settings, senderPhone)) return true;

    if (tap.kind === 'more') {
        const page = Math.max(2, Math.min(50, Number(tap.ref) || 2));
        const result = await findStoresForPincode(lead.raw_area);
        await sendResult(senderPhone, lead.id, result, page);
        return true;
    }

    if (tap.kind === 'store') {
        const [stores]: any = await db.execute(
            `SELECT vd.id, vd.store_name, vd.address, vd.city, vd.pincode, p.phone_number
               FROM vendor_details vd
               JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1
               LEFT JOIN profiles p ON p.id = vd.user_id
              WHERE vd.id = ? AND vd.is_franchise = 1
              LIMIT 1`,
            [tap.ref]
        );
        const store = stores[0];
        if (!store) {
            console.warn(`[Locator] tapped store ${tap.ref} is no longer a verified franchise`);
            return true;
        }
        await reply(senderPhone, 'Text', text(storeDetailsText({
            store_name: store.store_name,
            address: store.address,
            city: store.city,
            pincode: store.pincode,
            phone: store.phone_number,
        }, settings.support_phone)), lead.id);

        await recordStorePick(lead, store.id, store.phone_number, store.store_name, settings.whatsapp_live, false);
        return true;
    }

    // A distributor, when no store was near.
    const [dists]: any = await db.execute(
        'SELECT id, name, phone_number, city FROM distributors WHERE id = ? LIMIT 1',
        [tap.ref]
    );
    const d = dists[0];
    if (!d) return true;
    await reply(senderPhone, 'Text', text(distributorDetailsText({
        id: String(d.id), name: d.name, phone: d.phone_number, city: d.city,
    }, settings.support_phone)), lead.id);
    await recordDistributorPick(lead, String(d.id), d.phone_number, d.name, settings.whatsapp_live, false);
    return true;
}

/** The lead as the alerts need it, with what it has been alerted about so far. */
async function leadForAlert(leadId: string) {
    const [rows]: any = await db.execute(
        `SELECT id, customer_phone, product, car_model,
                JSON_EXTRACT(raw_payload, '$.locator.notified') AS notified
           FROM leads WHERE id = ? LIMIT 1`,
        [leadId]
    );
    return rows[0] ?? null;
}

/**
 * The store the customer got — tapped, or `auto` when it was the only one —
 * recorded as the customer's own choice, not an admin's, and the store alerted.
 */
async function recordStorePick(lead: any, storeId: string, storePhone: string | null, storeName: string, live: boolean, auto: boolean) {
    await db.execute(
        `UPDATE leads SET store_id = ?, store_sent_at = NOW(), store_sent_by = 'customer'
                ${auto ? `, raw_payload = JSON_SET(COALESCE(raw_payload, JSON_OBJECT()), '$.locator.auto_picked', true)` : ''}
          WHERE id = ?`,
        [storeId, lead.id]
    );
    console.log(`[Locator] lead ${lead.id} ${auto ? 'sent the only store,' : 'picked'} ${storeName}`);
    await notifyOnce(lead, `store:${storeId}`, storePhone, storeName, live);
}

async function recordDistributorPick(lead: any, id: string, phone: string | null, name: string, live: boolean, auto: boolean) {
    await db.execute(
        `UPDATE leads SET raw_payload = JSON_SET(COALESCE(raw_payload, JSON_OBJECT()),
            '$.locator.picked_distributor', JSON_OBJECT('id', ?, 'name', ?)
            ${auto ? `, '$.locator.auto_picked', true` : ''}) WHERE id = ?`,
        [id, name, lead.id]
    );
    console.log(`[Locator] lead ${lead.id} ${auto ? 'sent the only distributor,' : 'picked distributor'} ${name}`);
    await notifyOnce(lead, `distributor:${id}`, phone, name, live);
}

/**
 * Tell whoever the lead went to — the store or distributor the customer
 * picked, or customer support when nobody was near — that it is coming.
 *
 * Live only: a test from an admin's phone must never land on a real store's
 * phone. Once per recipient per enquiry — a customer tapping the same row
 * twice is one lead, while picking a second store is a lead for that store too.
 * Whether it went is kept on the lead, under locator.notified, keyed
 * `store:<id>`, `distributor:<id>` or `support`.
 *
 * Also used when an admin sends an IVR or hand-added lead a store from Lead
 * Management, so that store hears of it the same way.
 */
export type AlertResult = 'sent' | 'already' | 'not-live' | 'no-phone' | 'failed';

export async function notifyOnce(lead: any, key: string, phone: string | null, name: string, live: boolean): Promise<AlertResult> {
    if (!live) return 'not-live';
    if (!phone) return 'no-phone';

    let notified: string[] = [];
    try {
        const parsed = typeof lead.notified === 'string' ? JSON.parse(lead.notified) : lead.notified;
        if (Array.isArray(parsed)) notified = parsed.map(String);
    } catch { /* nothing recorded yet */ }
    if (notified.includes(key)) return 'already';

    /*
     * The recipient's lead number for the month: the leads it has already been
     * alerted about since the 1st, plus this one. Starts again at #1 each
     * month. The connection runs in IST, so the month turns at midnight India
     * time. Counted from locator.notified, the same record that stops a repeat
     * alert, so a lead is numbered only if the store actually heard about it.
     * Every channel counts: an IVR lead an admin sent the store is its next
     * lead too.
     */
    const [[{ prior }]]: any = await db.execute(
        `SELECT COUNT(*) AS prior FROM leads
          WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
            AND JSON_CONTAINS(COALESCE(JSON_EXTRACT(raw_payload, '$.locator.notified'), JSON_ARRAY()), JSON_QUOTE(?))`,
        [key]
    );

    const leadNumber = Number(prior) + 1;
    /* The enquiry's own time when the caller knows it. A WhatsApp pick is
       alerted moments after the enquiry, so "now" is right there; an admin
       may send an IVR lead's store hours after the call. */
    const enquired = lead.enquired_at ? new Date(lead.enquired_at) : null;
    const when = receivedAt(enquired && !Number.isNaN(enquired.getTime()) ? enquired : undefined);

    /*
     * Support has its own template, which adds where the customer is — they
     * are the ones who must find them somewhere to go. Until Meta approves it
     * the send fails, and support gets the store alert instead, so no lead
     * goes unannounced in the meantime.
     */
    let ok = false;
    if (key === 'support') {
        ok = await WhatsAppService.sendSupportLead(
            phone, lead.customer_phone, lead.location || '', lead.product, lead.car_model, when, leadNumber, lead.id,
        ).catch(() => false);
    }
    if (!ok) {
        ok = await WhatsAppService.sendStoreLead(
            phone, name, lead.customer_phone, lead.product, lead.car_model, when, leadNumber, lead.id,
        ).catch(() => false);
    }
    if (!ok) return 'failed';

    await db.execute(
        `UPDATE leads
            /* $.locator first: JSON_SET will not create a missing parent, and an
               IVR lead has none — without it the record would silently vanish. */
            SET raw_payload = JSON_SET(COALESCE(raw_payload, JSON_OBJECT()),
                    '$.locator', COALESCE(JSON_EXTRACT(raw_payload, '$.locator'), JSON_OBJECT()),
                    '$.locator.notified',
                    JSON_ARRAY_APPEND(COALESCE(JSON_EXTRACT(raw_payload, '$.locator.notified'), JSON_ARRAY()), '$', ?)),
                status = 'sent', sent_at = COALESCE(sent_at, NOW())
          WHERE id = ?`,
        [key, lead.id]
    );
    return 'sent';
}

/**
 * A bare 6-digit message, as a new search — but only from someone who used the
 * locator in the last day. Anyone else's six digits are not ours to answer.
 */
export async function handlePincodeMessage(senderPhone: string, body: string): Promise<boolean> {
    const pincode = String(body || '').trim();
    if (!/^[1-9][0-9]{5}$/.test(pincode)) return false;

    const [rows]: any = await db.execute(
        `SELECT id, customer_name, product, car_model, source, raw_area FROM leads
          WHERE phone_key = ? AND flow_id = ?
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
          ORDER BY created_at DESC LIMIT 1`,
        [phoneKey(senderPhone), LOCATOR_FLOW_ID, FOLLOW_UP_HOURS]
    );
    if (!rows.length) return false;

    const last = rows[0];
    /*
     * The pincode they were already answered for — typed again, as people do
     * ("416006" after "Okay"). Same enquiry: the answer goes again on the same
     * lead, so no second lead and no second alert. A different pincode is a
     * new area, and a new enquiry.
     */
    const same = String(last.raw_area ?? '') === pincode;
    if (same) console.log(`[Locator] ${phoneKey(senderPhone)} sent ${pincode} again — answering on lead ${last.id}`);
    await startStoreEnquiry({
        ...(same ? { leadId: last.id } : {}),
        pincode, phone: senderPhone, name: last.customer_name, product: last.product, car: last.car_model,
        source: last.source === 'instagram' ? 'instagram' : 'whatsapp',
        rawPayload: { source: 'follow-up pincode' },
    });
    return true;
}

/**
 * A customer answered within the last day writes again with a general word
 * ("Price please", "hi"): they get their answer again — their store, or the
 * list to pick from, or the contact they were given — on the same lead,
 * instead of a fresh menu and a second lead. Returns whether it was sent.
 */
export async function resendAnswer(senderPhone: string, product: string | null = null): Promise<boolean> {
    const [rows]: any = await db.execute(
        `SELECT id, flow_id, raw_area, store_id, product FROM leads
          WHERE phone_key = ? AND created_at >= NOW() - INTERVAL 1 DAY
            AND raw_area REGEXP '^[1-9][0-9]{5}$'
            AND JSON_EXTRACT(raw_payload, '$.locator.offered') IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`,
        [phoneKey(senderPhone)]
    );
    const lead = rows[0];
    if (!lead) return false;
    // Asking about another product ("mats" after seat covers) is a new enquiry: the chat starts it.
    if (product && lead.product && normaliseProduct(product) !== lead.product) return false;
    const settings = await getLocatorSettings();
    if (!repliesTo(settings, senderPhone)) return false;

    // A sheet lead the customer now writes to joins the chat's flow, so their taps on the list are taken.
    if (lead.flow_id !== LOCATOR_FLOW_ID) {
        await db.execute('UPDATE leads SET flow_id = ? WHERE id = ?', [LOCATOR_FLOW_ID, lead.id]);
    }
    if (lead.store_id) {
        const [stores]: any = await db.execute(
            `SELECT vd.store_name, vd.address, vd.city, vd.pincode, p.phone_number
               FROM vendor_details vd LEFT JOIN profiles p ON p.id = vd.user_id WHERE vd.id = ? LIMIT 1`,
            [lead.store_id]
        );
        const s = stores[0];
        if (s) {
            await reply(senderPhone, 'Text', text(storeDetailsText({
                store_name: s.store_name, address: s.address, city: s.city, pincode: s.pincode, phone: s.phone_number,
            }, settings.support_phone)), lead.id);
            console.log(`[Locator] ${phoneKey(senderPhone)} wrote again — resent their store, lead ${lead.id}`);
            return true;
        }
    }
    const result = await findStoresForPincode(lead.raw_area);
    await sendResult(senderPhone, lead.id, result, 1);
    console.log(`[Locator] ${phoneKey(senderPhone)} wrote again — resent their answer for ${lead.raw_area}, lead ${lead.id}`);
    return true;
}

/* ─── A lead an auditor adds by hand, by pincode ─────────────────────────── */

export type ManualOutcome = 'stores' | 'asm' | 'distributor' | 'support';

export interface ManualLeadInput {
    pincode: string;
    phone: string;
    name: string | null;
    product: string | null;
    car: string | null;
    /** The channel the auditor chose: one of MANUAL_CHANNELS (leadCharts). */
    source: string;
    enteredBy: string | null;
    /** The auditor picked a store in the form; it is sent by the caller, and the chain stops there. */
    storePicked: boolean;
}

/**
 * Where a hand-added lead goes, by the same chain as WhatsApp: the stores near
 * the pincode (the auditor picks one), else the ASM holding the area, else the
 * nearest distributor, else customer support. Nothing is written or sent.
 */
export async function manualLeadPlan(pincode: string) {
    const result = await findStoresForPincode(pincode);
    const kind: ManualOutcome = result.stores.length ? 'stores' : (result.fallback?.kind ?? 'support');
    const district = result.customer?.district && result.customer.district !== 'NA' ? titleCase(result.customer.district) : null;
    const state = findState(String(result.customer?.state ?? ''))?.state ?? null;
    const contact = kind === 'stores' ? null : (result.fallback?.contacts[0] ?? null);
    return { result, kind, district, state, contact, found: result.found };
}

/**
 * File the lead and, when no store is near (and the auditor did not pick one),
 * hand it to the next in the chain: that contact gets the lead, and the
 * customer gets that contact. With stores near, nothing is sent here — the
 * auditor's pick sends the store's details and alerts the store.
 */
export async function createManualPincodeLead(input: ManualLeadInput): Promise<{ leadId: string; kind: ManualOutcome; sentTo: string | null }> {
    const { result, kind, district, state, contact } = await manualLeadPlan(input.pincode);
    const settings = await getLocatorSettings();
    const leadId = uuidv4();
    const phone = localPhone(input.phone) || String(input.phone).trim();
    const place = district ? `${district} (${input.pincode})` : input.pincode;
    const product = normaliseProduct(input.product);
    const car = String(input.car || '').trim().slice(0, 80) || null;
    const options = (result.stores.length
        ? result.stores.map(s => ({ id: s.id, name: s.store_name, distance_km: s.distance_km }))
        : (result.fallback?.contacts ?? []).map(c => ({ id: c.id, name: c.name })));

    await db.execute(
        `INSERT INTO leads
           (id, source, product, car_model, state, customer_name, customer_phone, phone_key,
            raw_area, matched_area, asm_id, flow_id, raw_payload, status, failure_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
            leadId, input.source, product, car, state,
            input.name ? String(input.name).trim().slice(0, 255) : null,
            phone, phoneKey(phone), input.pincode, district ? place : null,
            kind === 'asm' ? contact?.id ?? null : null,
            JSON.stringify({
                entered_by: input.enteredBy, channel: input.source, pincode: input.pincode,
                locator: { pincode: input.pincode, offered: kind, count: options.length, reply: 'none', via: 'manual', options: options.slice(0, 10) },
            }),
            kind === 'support' ? 'unmatched' : 'matched',
            kind === 'support' ? 'No store, ASM or distributor near this pincode' : null,
        ]
    );

    // Stores near, or the auditor chose one: the store is sent from the form.
    if (kind === 'stores' || input.storePicked || !contact) return { leadId, kind, sentTo: null };

    const sentTo = await deliverLead(
        { id: leadId, phone, name: input.name, product, car, place },
        result, { stores: 'auditor' }, settings.whatsapp_live,
    );
    console.log(`[Locator] manual lead ${leadId} at ${input.pincode} -> ${kind}${sentTo ? `, sent to ${sentTo}` : ''}`);
    return { leadId, kind, sentTo };
}

/**
 * A 2-wheeler enquiry added by hand. It never goes to a store: the Customer
 * Executive (the support number in the locator settings) gets the support
 * lead alert, with "2-Wheeler" as the vehicle. The customer is not messaged —
 * outside WhatsApp's 24-hour window only a template could reach them, and the
 * auditor taking the enquiry gives them the number.
 */
export async function createTwoWheelerLead(input: {
    phone: string; name: string | null; product: string | null; car: string | null;
    source: string; enteredBy: string | null; pincode: string | null; area: string | null;
}): Promise<{ leadId: string; alert: AlertResult; sentTo: string | null }> {
    const settings = await getLocatorSettings();
    const leadId = uuidv4();
    const phone = localPhone(input.phone) || String(input.phone).trim();
    const product = normaliseProduct(input.product);
    const typed = String(input.car || '').trim();
    const car = (typed ? `${typed} (2-Wheeler)` : '2-Wheeler').slice(0, 80);
    const where = String(input.area || '').trim() || input.pincode || '';

    await db.execute(
        `INSERT INTO leads
           (id, source, product, car_model, customer_name, customer_phone, phone_key,
            raw_area, flow_id, raw_payload, status, failure_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'matched', NULL)`,
        [
            leadId, input.source, product, car,
            input.name ? String(input.name).trim().slice(0, 255) : null,
            phone, phoneKey(phone), where ? where.slice(0, 255) : null,
            JSON.stringify({
                entered_by: input.enteredBy, channel: input.source, vehicle: '2w',
                ...(input.pincode ? { pincode: input.pincode } : {}),
                locator: { offered: 'support', via: 'manual', vehicle: '2w' },
            }),
        ]
    );
    const alert = await notifyOnce(
        { id: leadId, customer_phone: phone, product, car_model: car, notified: null, location: where },
        'support', settings.support_phone || null, settings.support_name, settings.whatsapp_live,
    ).catch(() => 'failed' as const);
    if (alert !== 'sent') {
        await db.execute('UPDATE leads SET failure_reason = ? WHERE id = ?',
            [`2-Wheeler enquiry: executive not alerted (${alert})`, leadId]);
    }
    console.log(`[Locator] manual 2-wheeler lead ${leadId} -> executive ${alert}`);
    return { leadId, alert, sentTo: alert === 'sent' ? settings.support_name : null };
}

/**
 * Hand a lead that has not written to us — added by hand, or filed from
 * Meta's sheet — to whoever the chain gives it, and tell the customer who to
 * call (the approved store-details template: outside WhatsApp's 24-hour reply
 * window a free-form message cannot reach them).
 *
 *   stores near  → `stores`:
 *                    'auditor' — nothing here; the auditor picks one (hand-added leads).
 *                    'choose'  — one store: its details straight to the customer, the
 *                                store alerted. Several: the af_choose_store_sheet
 *                                template, whose "View stores" tap sends the list
 *                                (handleChooseStoreTap) — once CHOOSE_STORE_LIVE is
 *                                set, i.e. Meta has approved it; until then the auditor.
 *   ASM          → the ASM's enquiry alert; the customer gets the ASM's number.
 *   distributor  → the nearest distributor's alert; the customer gets its number.
 *   support      → customer support's alert; the customer gets its number.
 *
 * Returns who got the lead, or null. Every alert goes through notifyOnce or is
 * recorded on the lead, so running it twice does not alert anyone twice.
 */
export async function deliverLead(
    l: { id: string; phone: string; name: string | null; product: string | null; car: string | null; place: string },
    result: LocatorResult,
    opts: { stores: 'auditor' | 'choose' },
    live: boolean,
): Promise<string | null> {
    if (!live) return null;
    const noteReply = (v: string) => db.execute(
        `UPDATE leads SET raw_payload = JSON_SET(COALESCE(raw_payload, JSON_OBJECT()),
                '$.locator', COALESCE(JSON_EXTRACT(raw_payload, '$.locator'), JSON_OBJECT()),
                '$.locator.reply', ?) WHERE id = ?`,
        [v, l.id]
    );
    const customerGets = async (name: string, address: string, phone: string) => {
        const ok = await WhatsAppService.sendCustomerStoreDetails(l.phone, name, address, phone, l.id).catch(() => false);
        await noteReply(ok ? 'sent' : 'failed');
        return ok;
    };

    if (result.stores.length) {
        if (opts.stores === 'auditor') return null;
        // Several to choose from: the customer picks, once the template is approved.
        if (result.stores.length > 1) {
            if (process.env.CHOOSE_STORE_LIVE !== 'true') return null;
            const ok = await WhatsAppService.sendChooseStore(l.phone, l.name, l.product, l.place, l.id).catch(() => false);
            await noteReply(ok ? 'choose-sent' : 'failed');
            return null;
        }
        const store = [...result.stores].sort((a, b) => a.distance_km - b.distance_km).find(s => s.phone);
        if (!store) return null;
        const address = [store.address, titleCase(store.city), store.pincode].map(p => String(p ?? '').trim()).filter(Boolean)
            .filter((p, i, all) => i === 0 || !all[0].toLowerCase().includes(p.toLowerCase())).join(', ') || l.place;
        await customerGets(store.store_name, address, store.phone!);
        const lead = await leadForAlert(l.id);
        if (lead) await recordStorePick(lead, String(store.id), store.phone, store.store_name, live, true);
        return store.store_name;
    }

    const kind = result.fallback?.kind ?? 'support';
    const contact = result.fallback?.contacts[0];
    if (!contact) return null;
    // The template's address line may not be empty: the contact's city, else the customer's area.
    if (contact.phone) await customerGets(contact.name, titleCase(contact.city) || l.place, contact.phone);

    if (kind === 'asm') {
        if (!contact.phone) return null;
        const ok = await WhatsAppService.sendAsmEnquiry(
            contact.phone, contact.name, l.name || '', l.phone, l.place, receivedAt(), l.product, l.car,
            contact.id ? await asmLeadNumber(contact.id).catch(() => undefined) : undefined,
        ).catch(() => false);
        await db.execute(`UPDATE leads SET status = ?, sent_at = ${ok ? 'NOW()' : 'NULL'} WHERE id = ?`, [ok ? 'sent' : 'failed', l.id]);
        return ok ? contact.name : null;
    }
    const lead = { id: l.id, notified: null, customer_phone: l.phone, location: l.place, product: l.product, car_model: l.car };
    const key = kind === 'distributor' ? `distributor:${contact.id}` : 'support';
    const r = await notifyOnce(lead, key, contact.phone, contact.name, live).catch(() => 'failed' as const);
    return r === 'sent' ? contact.name : null;
}

/**
 * The customer tapped "View stores" on af_choose_store_sheet: their store list,
 * as WhatsApp customers get it — tap a store, get its details, the store gets
 * the lead. The tap opened the 24-hour window, so the interactive list can go.
 *
 * `leadId` comes from the button's callback ("choose_store_<lead id>"); without
 * it (a typed "View stores", or a payload missing the callback) the customer's
 * latest lead that was sent the template is used. The lead must belong to the
 * number that tapped. Returns whether it was ours.
 */
const tapAnswered = new Map<string, number>();

export async function handleChooseStoreTap(senderPhone: string, leadId: string | null): Promise<boolean> {
    const key = phoneKey(senderPhone);
    const [rows]: any = leadId
        ? await db.execute(`SELECT id, flow_id, phone_key, raw_area FROM leads WHERE id = ? LIMIT 1`, [leadId])
        : await db.execute(
            `SELECT id, flow_id, phone_key, raw_area FROM leads
              WHERE phone_key = ? AND created_at >= NOW() - INTERVAL 7 DAY
                AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.locator.reply')) = 'choose-sent'
              ORDER BY created_at DESC LIMIT 1`,
            [key]
        );
    const lead = rows[0];
    if (!lead) return false;
    if (lead.phone_key !== key) {
        console.warn(`[Locator] "View stores" for lead ${lead.id} from ${key} does not match — ignored`);
        return true;
    }
    /* One tap reaches us twice — as a message and as a button click — and
       each sent the list. The second, within two minutes, is the same tap. */
    const last = tapAnswered.get(lead.id);
    if (last && Date.now() - last < 120_000) return true;
    tapAnswered.set(lead.id, Date.now());
    if (tapAnswered.size > 500) tapAnswered.delete(tapAnswered.keys().next().value as string);

    const settings = await getLocatorSettings();
    if (!repliesTo(settings, senderPhone)) return true;

    // The customer is in the chat now: their taps on the list are taken like any WhatsApp customer's.
    if (lead.flow_id !== LOCATOR_FLOW_ID) await db.execute('UPDATE leads SET flow_id = ? WHERE id = ?', [LOCATOR_FLOW_ID, lead.id]);
    const result = await findStoresForPincode(lead.raw_area);
    const sent = await sendResult(senderPhone, lead.id, result, 1);
    await db.execute(
        `UPDATE leads SET raw_payload = JSON_SET(raw_payload, '$.locator.reply', ?) WHERE id = ?`,
        [sent ? 'list-sent' : 'failed', lead.id]
    );
    console.log(`[Locator] ${key} tapped "View stores" — list for ${lead.raw_area} ${sent ? 'sent' : 'failed'}, lead ${lead.id}`);
    return true;
}
