import { parseLeadForm } from './instagramLeadParser.js';
import { startConversation } from './locatorConversation.service.js';
import { startStoreEnquiry } from './storeLocatorChat.js';
import { extractPincode } from './storeLocator.js';
import { sheetCar, SAME_ENQUIRY_DAYS } from './leadSheetSync.js';
import { phoneKey } from './leadIdentity.js';
import { SHEET_FLOW_ID } from './leadSheetImport.service.js';
import db from '../config/database.js';

/*
 * The same form can reach us twice: as this WhatsApp message, and as a row in
 * Meta's lead sheet that the import files every few minutes. Usually the
 * message comes first and the import skips the row. When the row was filed
 * first, this message finishes that lead instead of starting a second one —
 * the auditor may already be working on it.
 */
/*
 * The same form sent again from the same number within a day — a double tap,
 * or "did it go through?". It is the same enquiry: the customer gets their
 * answer again, but the lead is reused, so the store is not alerted twice
 * (alerts are recorded on the lead, once per store).
 */
async function recentFormLead(phone: string): Promise<string | null> {
    const key = phoneKey(phone);
    if (!key) return null;
    const [rows]: any = await db.execute(
        `SELECT id FROM leads
          WHERE source = 'instagram' AND phone_key = ? AND created_at >= NOW() - INTERVAL 1 DAY
            AND JSON_EXTRACT(raw_payload, '$.locator.session') IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [key]
    );
    return rows[0]?.id ?? null;
}

// The sheet lead for this WhatsApp number — the same number only; a different number is a different lead.
async function sheetLeadFor(phone: string): Promise<string | null> {
    const key = phoneKey(phone);
    if (!key) return null;
    const [rows]: any = await db.execute(
        `SELECT id FROM leads
          WHERE flow_id = ? AND phone_key = ? AND created_at >= NOW() - INTERVAL ? DAY
          ORDER BY created_at DESC LIMIT 1`,
        [SHEET_FLOW_ID, key, SAME_ENQUIRY_DAYS]
    );
    return rows[0]?.id ?? null;
}

/* Re-exported so callers and tests can reach the parser through either
   module; the reading itself has no database import. */
export { parseLeadForm } from './instagramLeadParser.js';
export type { ParsedLead } from './instagramLeadParser.js';

/**
 * Route an Instagram lead-form message, if that is what it is.
 *
 * Returns false when the message is not a lead form, so the caller can carry on
 * treating it as an ordinary enquiry.
 *
 * The phone comes from the WhatsApp sender, not the form: the form field is
 * typed and can be wrong, while the sender's number is the one that actually
 * reached us and the one a store can call back.
 *
 * Since late September 2026 the ad forms ask for a pincode, and a lead with
 * one goes through the store locator exactly like the Interakt workflow: the
 * customer has just messaged us, so the store list can go straight back to
 * them, and the store they pick is alerted. Stores, then the ASM, then
 * distributors, then support — one flow whichever door the customer came in by.
 *
 *   a pincode (or a city answer that is one)  -> the store locator
 *   a pincode question, but no pincode in it  -> the locator asks for one
 *   a form asking only for the city           -> our chat asks car / pincode
 */
const handled: string[] = [];

export async function handleInstagramLead(
    text: string,
    senderPhone: string,
    rawPayload?: any
): Promise<boolean> {
    const lead = parseLeadForm(text);
    if (!lead) return false;

    // Interakt can deliver one message twice; the second must not ask again.
    const messageId = rawPayload?.data?.message?.id;
    if (messageId) {
        if (handled.includes(messageId)) return true;
        handled.push(messageId);
        if (handled.length > 200) handled.shift();
    }

    if (Object.keys(lead.unmapped).length) {
        // Not an error — a new ad asking something we have no column for. Worth
        // seeing, because it is also how a renamed pincode field would show up.
        console.log('[Instagram] unmapped form fields:', JSON.stringify(lead.unmapped));
    }

    const payload = rawPayload ?? { text };
    const pincode = extractPincode(lead.pincode) ?? extractPincode(lead.city);

    // A pincode form, whether or not the answer holds one: the locator either
    // runs, or asks the customer for the pincode and keeps the lead meanwhile.
    if (pincode || lead.pincode !== null || !lead.city) {
        const fromSheet = await sheetLeadFor(senderPhone);
        const repeat = fromSheet ? null : await recentFormLead(senderPhone);
        const existing = fromSheet ?? repeat;
        if (fromSheet) console.log(`[Instagram] ${phoneKey(senderPhone)} already filed from the sheet — finishing lead ${fromSheet}`);
        if (repeat) console.log(`[Instagram] ${phoneKey(senderPhone)} sent the form again — reusing lead ${repeat}, nobody alerted twice`);
        await startStoreEnquiry({
            ...(existing ? { leadId: existing } : {}),
            pincode: pincode ?? lead.pincode ?? '',
            phone: senderPhone,
            name: lead.name,
            product: lead.product,
            // "Hyundai exter (2025)": the year the form asked for, kept with the car.
            car: sheetCar(lead),
            source: 'instagram',
            // The phone typed in the form, when it is not this WhatsApp number: the sheet row carries that one.
            rawPayload: { ...(typeof payload === 'object' ? payload : { text }), instagram: { form_phone: lead.phone ?? null } },
        });
        return true;
    }

    /*
     * A form that asks only for the city — every live campaign as of 30 Sept
     * 2026. The customer is in the chat right now, so our chat takes over at
     * the first thing missing: the car if the form's answer is not a model
     * ("SUV", "yes"), then the pincode, then the store list, as for "Heyy".
     * It used to go to the city's ASM, whose alert template Interakt has not
     * approved, and the customer heard nothing back.
     */
    await startConversation({
        phone: senderPhone,
        name: lead.name,
        product: lead.product,
        car: lead.car,
        source: 'instagram',
        rawPayload: { ...(typeof payload === 'object' ? payload : { text }), instagram: { city: lead.city } },
    });
    return true;
}
