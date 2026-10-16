import db, { type SqlValue } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import { WhatsAppService } from './whatsapp.service.js';
import { phoneKey, normaliseProduct } from './asmRouting.service.js';
import { getLocatorSettings, repliesTo } from './storeLocatorQuery.js';
import { LOCATOR_FLOW_ID, startStoreEnquiry, resendAnswer, notifyOnce } from './storeLocatorChat.js';
import { readCarAnswer } from './carModels.js';
import { localPhone } from './storeLocator.js';
import { hasAutoReplyContent } from './autoReply.js';
import {
    nextStep, menuStep, vehicleStep, isRestart, isCancel, isIdle, OPEN_STAGES, type StartWord,
    type ChatStage, type MenuStep,
} from './locatorConversation.js';
import {
    CAR_QUESTION, PINCODE_QUESTION, PLEASE_TYPE_TEXT, CANCELLED_TEXT, SORRY_TEXT, MENU_RETRY,
    VEHICLE_TEXT, VEHICLE_RETRY, twoWheelerText, vehicleQuestion, vehicleTapFromWebhook,
    productMenu, otherProductsMenu, menuTapFromWebhook, type InteractiveList, type Vehicle,
} from './storeLocatorMessages.js';

/**
 * Our side of the WhatsApp chat. The Interakt workflow only starts it ("Heyy")
 * and hands over; from there the server runs everything: the product menu (and
 * its "Other Products" sub-menu, with a way back), then the car, then the
 * pincode — checking each answer. The rules are in locatorConversation; this
 * reads and writes the lead, and sends.
 *
 * The chat lives on its lead, under raw_payload.locator.session — so an
 * enquiry is one lead from the first message, and one that stops half-way is
 * still in Lead Management for the auditor to call. The pincode step then
 * finishes that same lead through startStoreEnquiry.
 *
 * Nothing here may throw into the webhook: Interakt disables a webhook after
 * five failures in ten minutes. Anything unexpected is caught, the customer is
 * told the team will call, and the lead is marked for the auditor.
 */

/*
 * Each chat message is logged under its own tag ("chat:car-question"…), so the
 * lead's WhatsApp history can say exactly what was asked (leadMessages).
 */
type ChatTag = 'vehicle-question' | 'vehicle-retry' | 'two-wheeler'
    | 'product-menu' | 'other-menu' | 'product-retry' | 'car-question' | 'pincode-question'
    | 'car-retry' | 'pincode-retry' | 'please-type' | 'cancelled' | 'gave-up' | 'error';

const send = (phone: string, body: string, leadId: string, tag: ChatTag) =>
    WhatsAppService.sendSessionMessage(phone, 'Text', { message: body }, `chat:${tag}`, leadId);

const sendList = (phone: string, list: InteractiveList, leadId: string, tag: ChatTag) =>
    WhatsAppService.sendSessionMessage(phone, 'InteractiveList', list as any, `chat:${tag}`, leadId);

/*
 * The 4-wheeler / 2-wheeler buttons. If WhatsApp refuses the buttons, the same
 * question goes as text ("reply 4 or 2"), so the customer always gets it.
 */
const askVehicle = async (phone: string, leadId: string) => {
    // VEHICLE_BUTTONS=false in .env sends the text version only.
    const ok = process.env.VEHICLE_BUTTONS !== 'false' && await WhatsAppService.sendSessionMessage(
        phone, 'InteractiveButton', vehicleQuestion(leadId) as any, 'chat:vehicle-question', leadId,
    ).catch(() => false);
    if (!ok) await send(phone, VEHICLE_TEXT, leadId, 'vehicle-question');
};

const nowIso = () => new Date().toISOString();

/* "{{4}}" from a workflow variable nobody mapped is not a value. */
const given = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s && !/^\{\{\s*\d+\s*\}\}$/.test(s) ? s : null;
};

/** Set raw_payload.locator.session in one statement, plus any columns, and touch the lead. */
async function saveSession(leadId: string, session: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const cols = Object.keys(extra);
    await db.execute(
        `UPDATE leads
            SET raw_payload = JSON_SET(COALESCE(raw_payload, JSON_OBJECT()),
                    '$.locator', COALESCE(JSON_EXTRACT(raw_payload, '$.locator'), JSON_OBJECT()),
                    '$.locator.session', CAST(? AS JSON))
                ${cols.map(c => `, ${c} = ?`).join('')},
                updated_at = NOW()
          WHERE id = ?`,
        [JSON.stringify(session), ...(Object.values(extra) as SqlValue[]), leadId]
    );
}

/**
 * The hand-off. Starts the chat at the first thing still missing: the product
 * menu when the workflow sends nothing, the car when it sends the product, the
 * pincode when it sends the car too. `announce: false` opens the chat without
 * sending anything — for a tap on an old menu, answered by the caller.
 */
export async function startConversation(input: {
    phone: string; name?: string | null; product?: string | null; car?: string | null; rawPayload?: unknown;
    announce?: boolean;
    /** An Instagram lead-form message starts the chat too, and keeps its source. */
    source?: 'whatsapp' | 'instagram';
}): Promise<{ result: 'asked' | 'held'; leadId: string }> {
    // Ten digits, as the team reads it — the alerts quote this number.
    const phone = localPhone(input.phone) || String(input.phone).trim();
    const settings = await getLocatorSettings();
    const canReply = repliesTo(settings, phone);
    const productText = given(input.product);
    const carText = given(input.car);

    const started = Date.now();
    const givenCar = carText ? readCarAnswer(carText) : null;
    /* A car given (an Instagram form) is a 4-wheeler already: straight to the
       pincode. Otherwise the first question is 4-wheeler or 2-wheeler. */
    const stage: ChatStage = givenCar?.ok ? 'pincode' : 'vehicle';
    /* Same number, a chat that never got anywhere a moment ago: start again on
       that lead rather than leave an empty "replaced" lead behind for each
       "hi" or old-menu tap (one customer had five in two minutes). */
    const reuse = await reusableChatLead(phone);
    const leadId = reuse ?? uuidv4();
    const session = { stage: canReply ? stage : 'held', tries: 0, at: nowIso(), choice: productText };

    // A new start replaces any chat still open for this number — before the
    // insert, or it would close the new chat too.
    const write = (async () => {
        await endOpenChats(phone, 'replaced');
        if (reuse) {
            const { locator: _old, ...extra } = (input.rawPayload && typeof input.rawPayload === 'object' ? input.rawPayload : {}) as any;
            await db.execute(
                `UPDATE leads
                    SET source = ?, product = ?, car_model = ?, customer_name = COALESCE(?, customer_name),
                        raw_payload = JSON_SET(JSON_MERGE_PATCH(COALESCE(raw_payload, JSON_OBJECT()), CAST(? AS JSON)),
                                               '$.locator.session', CAST(? AS JSON)),
                        failure_reason = ?, updated_at = NOW()
                  WHERE id = ?`,
                [
                    input.source ?? 'whatsapp',
                    normaliseProduct(productText),
                    givenCar?.ok ? givenCar.car : (carText ? carText.slice(0, 80) : null),
                    given(input.name)?.slice(0, 255) ?? null,
                    JSON.stringify({ ...extra, locator: {} }),
                    JSON.stringify(session),
                    canReply ? null : 'Store locator not live for this number: details not asked',
                    reuse,
                ]
            );
            return;
        }
        await db.execute(
            `INSERT INTO leads
               (id, source, product, car_model, customer_name, customer_phone, phone_key, flow_id, raw_payload, status, failure_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unmatched', ?)`,
            [
                leadId,
                input.source ?? 'whatsapp',
                normaliseProduct(productText),
                givenCar?.ok ? givenCar.car : (carText ? carText.slice(0, 80) : null),
                given(input.name)?.slice(0, 255) ?? null,
                phone,
                phoneKey(phone),
                LOCATOR_FLOW_ID,
                JSON.stringify({
                    ...(input.rawPayload && typeof input.rawPayload === 'object' ? input.rawPayload as object : {}),
                    locator: { session },
                }),
                // Not live for this number: the chat cannot ask, so the team calls.
                canReply ? null : 'Store locator not live for this number: details not asked',
            ]
        );
    })();

    if (!canReply) {
        await write;
        console.log(`[Chat] ${phoneKey(phone)} not live — lead ${leadId} kept for the team`);
        return { result: 'held', leadId };
    }
    // The first question goes out while the lead is written: the customer
    // cannot answer it before the row exists, and does not wait for it.
    const ask = input.announce === false ? Promise.resolve()
        : stage === 'vehicle' ? askVehicle(phone, leadId)
            : send(phone, PINCODE_QUESTION, leadId, 'pincode-question');
    await Promise.all([write, ask]);
    console.log(`[Chat] ${phoneKey(phone)} started at ${stage} in ${Date.now() - started} ms — lead ${leadId}`);
    return { result: 'asked', leadId };
}

/*
 * The lead of a chat from this number in the last two hours that never got a
 * pincode, a store or a review — open, or already replaced by a restart. A new
 * start goes on it instead of filing another empty lead.
 */
async function reusableChatLead(phone: string): Promise<string | null> {
    const stages = [...OPEN_STAGES, 'replaced', 'restarted'];
    const [rows]: any = await db.execute(
        `SELECT id FROM leads
          WHERE flow_id = ? AND phone_key = ?
            AND created_at >= NOW() - INTERVAL 2 HOUR
            AND status = 'unmatched' AND raw_area IS NULL AND store_id IS NULL AND review_status IS NULL
            AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.locator.session.stage')) IN (${stages.map(() => '?').join(', ')})
          ORDER BY created_at DESC LIMIT 1`,
        [LOCATOR_FLOW_ID, phoneKey(phone), ...stages]
    );
    return rows[0]?.id ?? null;
}

async function endOpenChats(phone: string, how: 'replaced' | 'restarted') {
    await db.execute(
        `UPDATE leads
            SET raw_payload = JSON_SET(raw_payload, '$.locator.session.stage', ?), updated_at = NOW()
          WHERE flow_id = ? AND phone_key = ?
            AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.locator.session.stage')) IN (${OPEN_STAGES.map(() => '?').join(', ')})`,
        [how, LOCATOR_FLOW_ID, phoneKey(phone), ...OPEN_STAGES]
    );
}

/* ─── One message at a time ──────────────────────────────────────────────── */

/* Interakt can deliver a message twice; the same message id is handled once. */
const seen: string[] = [];
function firstTime(messageId: string | undefined): boolean {
    if (!messageId) return true;
    if (seen.includes(messageId)) return false;
    seen.push(messageId);
    if (seen.length > 500) seen.shift();
    return true;
}

/* Two quick messages from one customer are handled in order, never together. */
const queues = new Map<string, Promise<unknown>>();
function inOrder<T>(key: string, work: () => Promise<T>): Promise<T> {
    const run = (queues.get(key) ?? Promise.resolve()).then(work, work);
    const tail = run.catch(() => undefined);
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return run;
}

/* ─── Two ways in, one chat ──────────────────────────────────────────────── */

/**
 * Whether a chat for this number began in the last few seconds — and, if
 * `openOnly`, is still going: a chat the customer just ended by sending "Heyy"
 * again must not stop the fresh one.
 */
async function chatStartedWithin(phone: string, seconds: number, openOnly: boolean): Promise<boolean> {
    const [rows]: any = await db.execute(
        `SELECT 1 FROM leads
          WHERE flow_id = ? AND phone_key = ?
            AND JSON_EXTRACT(raw_payload, '$.locator.session') IS NOT NULL
            AND created_at >= NOW() - INTERVAL ? SECOND
            ${openOnly ? `AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.locator.session.stage')) IN (${OPEN_STAGES.map(() => '?').join(', ')})` : ''}
          LIMIT 1`,
        [LOCATOR_FLOW_ID, phoneKey(phone), seconds, ...(openOnly ? OPEN_STAGES : [])]
    );
    return rows.length > 0;
}

/*
 * The customer's "Heyy", straight from the incoming-message webhook — about
 * eight seconds before the Interakt workflow gets round to its hand-off, and
 * with the right phone number whatever the workflow's variables say.
 *
 * Skipped only when the hand-off got there first a moment ago, so the menu is
 * never sent twice; a customer sending "Heyy" again later starts over.
 */
export function startFromMessage(phone: string, name: string | null, start: StartWord = { kind: 'heyy' }): Promise<boolean> {
    return inOrder(phoneKey(phone), async () => {
        // Both checks at once; the team check is only needed for a word other than "Heyy".
        const [justStarted, team] = await Promise.all([
            chatStartedWithin(phone, 20, true),
            start.kind === 'word' ? isTeamNumber(phone) : Promise.resolve(false),
        ]);
        if (justStarted) {
            console.log(`[Chat] ${phoneKey(phone)} "Heyy" — chat already started by the hand-off`);
            return true;
        }
        // Only "Heyy" starts the chat for our own people; their "hi" is to someone.
        if (team) {
            console.log(`[Chat] ${phoneKey(phone)} start word from a team number — no chat`);
            return false;
        }
        const product = start.kind === 'word' ? start.product : null;
        /*
         * "Price please" from someone answered within the day: their answer
         * again, on their lead — not a fresh menu and a second lead. "Heyy",
         * or another product, still starts a new enquiry.
         */
        if (start.kind === 'word' && await resendAnswer(phone, product)) return true;
        await startConversation({ phone, name, product, rawPayload: { source: start.kind === 'heyy' ? 'heyy' : 'start-word' } });
        return true;
    });
}

/*
 * A franchise, admin, distributor, ASM or manpower number. Numbers are stored
 * in every format, so the last ten digits are compared. Asked only when a
 * start word other than "Heyy" arrives, so the scan is rare.
 */
async function isTeamNumber(phone: string): Promise<boolean> {
    const key = phoneKey(phone);
    if (key.length !== 10) return false;
    const last10 = (col: string) => `RIGHT(REGEXP_REPLACE(${col}, '[^0-9]', ''), 10) = ?`;
    const [rows]: any = await db.execute(
        `SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id = p.id
          WHERE r.role <> 'customer' AND ${last10('p.phone_number')}
         UNION ALL SELECT 1 FROM distributors WHERE ${last10('phone_number')}
         UNION ALL SELECT 1 FROM asms WHERE ${last10('phone_number')}
         UNION ALL SELECT 1 FROM manpower WHERE ${last10('phone_number')}
         LIMIT 1`,
        [key, key, key, key]
    );
    return rows.length > 0;
}

/*
 * The workflow's hand-off. It always follows a "Heyy" we have usually acted on
 * already, so it only starts a chat when none began in the last two minutes —
 * a backup for when the message webhook is late or missed.
 */
export function startFromHandoff(input: Parameters<typeof startConversation>[0]): Promise<void> {
    /* A hand-off with no usable number (an unmapped workflow variable) cannot
       be answered: starting a chat only made sends to "+91" fail. */
    if (!/^\d{10}$/.test(localPhone(input.phone) || '')) {
        console.log(`[Chat] hand-off ignored — no valid phone number ("${String(input.phone ?? '')}")`);
        return Promise.resolve();
    }
    return inOrder(phoneKey(input.phone), async () => {
        if (await chatStartedWithin(input.phone, 120, false)) {
            console.log(`[Chat] ${phoneKey(input.phone)} hand-off — chat already running`);
            return;
        }
        await startConversation(input);
    });
}

async function isKnownPincode(pincode: string): Promise<boolean> {
    const [rows]: any = await db.execute('SELECT 1 FROM pincode_geo WHERE pincode = ? LIMIT 1', [pincode]);
    return rows.length > 0;
}

interface OpenChat {
    id: string;
    customer_phone: string;
    customer_name: string | null;
    source: string | null;
    product: string | null;
    car_model: string | null;
    raw: any;
    session: any;
}

async function openChat(senderPhone: string): Promise<OpenChat | null> {
    const [rows]: any = await db.execute(
        `SELECT id, customer_phone, customer_name, source, product, car_model, raw_payload
           FROM leads
          WHERE flow_id = ? AND phone_key = ?
            AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.locator.session.stage')) IN (${OPEN_STAGES.map(() => '?').join(', ')})
          ORDER BY created_at DESC LIMIT 1`,
        [LOCATOR_FLOW_ID, phoneKey(senderPhone), ...OPEN_STAGES]
    );
    if (!rows.length) return null;
    const raw = typeof rows[0].raw_payload === 'string' ? JSON.parse(rows[0].raw_payload) : (rows[0].raw_payload ?? {});
    const session = raw?.locator?.session ?? {};
    // Gone quiet: the chat is over, and the lead waits for the auditor.
    if (isIdle(session.at)) return null;
    return { ...rows[0], raw, session };
}

/**
 * A customer's message, if our chat is waiting for it — or a tap on one of our
 * product menus. Returns whether it was ours; anything else (a store-list tap,
 * a fresh "Heyy", no open chat) is left for the other handlers and Interakt.
 */
export async function handleConversationMessage(senderPhone: string, message: any): Promise<boolean> {
    if (!message) return false;
    const key = phoneKey(senderPhone);
    const type = String(message.message_content_type ?? '');
    const tap = menuTapFromWebhook(message);
    const vtap = vehicleTapFromWebhook(message);
    if (/Reply$/.test(type) && !tap && !vtap) return false;      // a store-list tap, not ours

    return inOrder(key, async () => {
        const started = Date.now();
        // Read inside the queue: a quick second message must see what the first one saved.
        let chat = await openChat(senderPhone);
        if (!chat && !tap && !vtap) return false;
        if (!firstTime(message.id)) return true;

        const phone = chat?.customer_phone || senderPhone;
        const done = (what: string) => console.log(`[Chat] ${key} ${what} in ${Date.now() - started} ms`);
        try {
            if (vtap) {
                // A tap on the vehicle buttons of an earlier chat, or after this
                // one moved on: start again from that answer.
                if (!chat || chat.id !== vtap.leadId || chat.session.stage !== 'vehicle') {
                    const fresh = await startConversation({ phone, announce: false });
                    if (fresh.result === 'held') return true;
                    chat = await openChat(senderPhone);
                    if (!chat) return true;
                }
                await applyVehicle(chat, phone, vehicleStep(0, { tap: vtap.vehicle }));
                done(`vehicle tap ${vtap.vehicle}`);
                return true;
            }
            if (tap) {
                // A tap on a menu from an earlier chat, or after this one moved
                // on: start again from that choice rather than ignore it.
                if (!chat || chat.id !== tap.leadId || !['product', 'product-other'].includes(chat.session.stage)) {
                    const fresh = await startConversation({ phone, announce: false });
                    if (fresh.result === 'held') return true;
                    chat = await openChat(senderPhone);
                    if (!chat) return true;
                }
                await applyMenu(chat, phone, menuStep(chat.session.stage, 0, { tap: tap.key }));
                done(`menu tap ${tap.key}`);
                return true;
            }
            const current = chat!;

            if (type !== 'Text') {
                await send(phone, PLEASE_TYPE_TEXT, current.id, 'please-type');
                return true;
            }
            const text = String(message.message ?? message.text ?? '');

            // The "Heyy" that the workflow's hand-off beat to us by a moment is
            // the same "Heyy", not a restart — restarting sent the menu twice.
            if (isRestart(text) && (current.session.stage === 'vehicle' || current.session.stage === 'product')
                && Date.now() - Date.parse(current.session.at ?? '') < 20_000) {
                return true;
            }
            if (isRestart(text)) {
                // The workflow answers "Heyy" and hands over again; ours steps aside.
                await endOpenChats(senderPhone, 'restarted');
                return false;
            }
            if (isCancel(text)) {
                await Promise.all([
                    saveSession(current.id, { ...current.session, stage: 'cancelled', at: nowIso() }),
                    send(phone, CANCELLED_TEXT, current.id, 'cancelled'),
                ]);
                return true;
            }
            // A business's auto-reply answering our question is not the customer.
            if (hasAutoReplyContent([text])) return true;

            const stage = current.session.stage as ChatStage;
            const tries = Number(current.session.tries) || 0;
            if (stage === 'vehicle') {
                await applyVehicle(current, phone, vehicleStep(tries, { text }));
                done('vehicle answer');
                return true;
            }
            if (stage === 'product' || stage === 'product-other') {
                await applyMenu(current, phone, menuStep(stage, tries, { text }));
                done(`menu answer at ${stage}`);
                return true;
            }

            /*
             * Saving the chat and sending the reply run together: the queue
             * holds this customer's next message until both are done, so it
             * still sees the saved step.
             */
            const step = await nextStep({ stage: stage as 'car' | 'pincode', tries }, text, isKnownPincode);
            if (step.kind === 'retry') {
                await Promise.all([
                    saveSession(current.id, { ...current.session, tries: step.tries, at: nowIso() }),
                    send(phone, step.reply, current.id, stage === 'car' ? 'car-retry' : 'pincode-retry'),
                ]);
            } else if (step.kind === 'car') {
                await Promise.all([
                    saveSession(
                        current.id,
                        { ...current.session, stage: 'pincode', tries: 0, at: nowIso(), car_checked: step.checked },
                        { car_model: step.car.slice(0, 80) }
                    ),
                    send(phone, step.reply, current.id, 'pincode-question'),
                ]);
            } else if (step.kind === 'give-up') {
                await Promise.all([
                    saveSession(
                        current.id,
                        { ...current.session, stage: 'ended', tries: tries + 1, at: nowIso() },
                        { failure_reason: 'No valid pincode given', raw_area: text.slice(0, 255) }
                    ),
                    send(phone, step.reply, current.id, 'gave-up'),
                ]);
            } else {
                // The pincode: the locator takes over and finishes this lead.
                await saveSession(current.id, { ...current.session, stage: 'done', at: nowIso() });
                const { locator: _chat, ...payload } = current.raw ?? {};
                await startStoreEnquiry({
                    pincode: step.pincode,
                    phone,
                    name: current.customer_name,
                    product: current.product,
                    car: current.car_model,
                    source: current.source === 'instagram' ? 'instagram' : 'whatsapp',
                    rawPayload: payload,
                    leadId: current.id,
                    chat: {
                        choice: current.session.choice ?? null,
                        car_checked: current.session.car_checked !== false,
                        pincode_checked: step.checked,
                    },
                });
            }
            done(`${stage} → ${step.kind}`);
            return true;
        } catch (err: any) {
            console.error(`[Chat] ${key} failed${chat ? ` on lead ${chat.id}` : ''}:`, err?.message);
            // Never silent: the customer hears from us, and the auditor sees it.
            if (chat) {
                await send(phone, SORRY_TEXT, chat.id, 'error').catch(() => undefined);
                await saveSession(
                    chat.id,
                    { ...chat.session, stage: 'error', at: nowIso() },
                    { failure_reason: 'Chat error: call the customer' }
                ).catch(() => undefined);
            }
            return true;
        }
    });
}

/**
 * The vehicle answer. A 4-wheeler goes on as the chat always has — the product
 * menu, or the car when the product is already known. A 2-wheeler gets the
 * Customer Executive's number, the executive is alerted (the support lead
 * alert, with "2-Wheeler" as the vehicle), and the chat ends on this lead.
 */
async function applyVehicle(chat: OpenChat, phone: string, step: ReturnType<typeof vehicleStep>) {
    if (step.kind === 'retry') {
        await Promise.all([
            saveSession(chat.id, { ...chat.session, tries: step.tries, at: nowIso() }),
            send(phone, VEHICLE_RETRY, chat.id, 'vehicle-retry'),
        ]);
        return;
    }
    const vehicle: Vehicle = step.vehicle;
    if (vehicle === '4w') {
        const knowsProduct = Boolean(chat.product || chat.session.choice);
        await Promise.all([
            saveSession(chat.id, {
                ...chat.session, stage: knowsProduct ? 'car' : 'product', tries: 0, at: nowIso(),
                vehicle, vehicle_checked: step.checked,
            }),
            knowsProduct
                ? send(phone, CAR_QUESTION, chat.id, 'car-question')
                : sendList(phone, productMenu(chat.id, false), chat.id, 'product-menu'),
        ]);
        return;
    }

    const settings = await getLocatorSettings();
    await Promise.all([
        saveSession(chat.id, { ...chat.session, stage: 'done', tries: 0, at: nowIso(), vehicle, vehicle_checked: true }, { car_model: '2-Wheeler' }),
        send(phone, twoWheelerText(settings.support_phone), chat.id, 'two-wheeler'),
    ]);
    // Live only, as every alert: a test from a team phone must not reach the executive.
    const alert = await notifyOnce(
        { id: chat.id, customer_phone: phone, product: chat.product, car_model: '2-Wheeler', notified: null, location: '' },
        'support', settings.support_phone || null, settings.support_name, settings.whatsapp_live,
    ).catch(() => 'failed' as const);
    if (alert !== 'sent') {
        await db.execute('UPDATE leads SET failure_reason = ? WHERE id = ?',
            [`2-Wheeler enquiry: executive not alerted (${alert})`, chat.id]);
    }
    console.log(`[Chat] lead ${chat.id} 2-wheeler — executive ${alert}`);
}

/** Act on a menu step: show a menu (or a retry), or take the product and ask for the car. */
async function applyMenu(chat: OpenChat, phone: string, step: MenuStep) {
    // Save and send together, as in handleConversationMessage.
    if (step.kind === 'menu') {
        await Promise.all([
            saveSession(chat.id, {
                ...chat.session, stage: step.menu === 'other' ? 'product-other' : 'product', tries: step.tries, at: nowIso(),
            }),
            step.retry ? send(phone, MENU_RETRY, chat.id, 'product-retry')
                : step.menu === 'other' ? sendList(phone, otherProductsMenu(chat.id), chat.id, 'other-menu')
                    : sendList(phone, productMenu(chat.id), chat.id, 'product-menu'),
        ]);
        return;
    }
    await Promise.all([
        saveSession(
            chat.id,
            { ...chat.session, stage: 'car', tries: 0, at: nowIso(), choice: step.choice },
            { product: step.product }
        ),
        send(phone, CAR_QUESTION, chat.id, 'car-question'),
    ]);
}

