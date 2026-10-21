import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { readSheet } from './googleSheets.js';
import { readLeadSheet } from './leadSheetParser.js';
import { planSheetImport, sheetCar, SAME_ENQUIRY_DAYS, type ImportDecision, type KnownLeads } from './leadSheetSync.js';
import { phoneKey } from './leadIdentity.js';
import { normaliseProduct } from './productMatch.js';
import { findState } from './indianStates.js';
import { extractPincode } from './storeLocator.js';
import { findStoresForPincode, getLocatorSettings } from './storeLocatorQuery.js';
import { deliverLead } from './storeLocatorChat.js';
import { titleCase } from './storeLocatorMessages.js';

/**
 * Files the Instagram lead-ad sheet into Lead Management, every few minutes.
 *
 * Record only: nothing is sent to the customer, a store or an ASM. Each lead
 * is routed by its pincode through the same chain as WhatsApp (see
 * insertLead), so it lands with the right store, ASM or distributor in the
 * lead screen, and the team calls from there. What to import is decided in
 * leadSheetSync.planSheetImport; this reads, looks up and writes.
 *
 * Off unless LEAD_SHEET_URL is set. LEAD_SHEET_TAB names the tab (Meta's own
 * "AD1" by default) and LEAD_SHEET_SINCE the first day to import (default: all).
 */

export const SHEET_FLOW_ID = 'meta-sheet';
const INTERVAL_MS = 10 * 60 * 1000;

export interface ImportReport {
    rows: number;
    inserted: number;
    alreadyImported: number;
    sameEnquiry: number;
    unusable: number;
    tooOld: number;
    /* Too new: left for the next pass, so a WhatsApp copy can arrive first. */
    waiting: number;
    skippedRows: { headers: number; tests: number; unrecognised: number };
}

function sheetConfig() {
    const url = String(process.env.LEAD_SHEET_URL || '').trim();
    const tab = String(process.env.LEAD_SHEET_TAB || 'AD1').trim();
    const sinceRaw = String(process.env.LEAD_SHEET_SINCE || '').trim();
    const since = sinceRaw ? new Date(sinceRaw) : null;
    return { url, tab, since: since && !Number.isNaN(since.getTime()) ? since : null };
}

async function knownLeads(): Promise<KnownLeads> {
    // Any lead carrying a Meta id: one the customer later wrote to on WhatsApp
    // has moved to the locator's flow, and must still count as imported.
    const [ids]: any = await db.execute(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.sheet.lead_id')) AS id
           FROM leads WHERE source = 'instagram' AND JSON_EXTRACT(raw_payload, '$.sheet.lead_id') IS NOT NULL`
    );
    // Same number only (a different number is a different lead) — an Instagram lead, or a WhatsApp chat they started.
    const [ig]: any = await db.execute(
        `SELECT phone_key, created_at FROM leads
          WHERE source IN ('instagram', 'whatsapp') AND phone_key IS NOT NULL
            AND created_at >= NOW() - INTERVAL 120 DAY`
    );
    const instagramAt = new Map<string, Date[]>();
    for (const r of ig) instagramAt.set(r.phone_key, [...(instagramAt.get(r.phone_key) ?? []), new Date(r.created_at)]);
    return { metaIds: new Set(ids.map((r: any) => r.id).filter(Boolean)), instagramAt };
}

/*
 * Where a lead goes, by its pincode, exactly as on WhatsApp: the stores near
 * it, else the ASM who holds the area, else the state's distributors, else
 * customer support (storeLocatorQuery). The outcome is kept on the lead in the
 * same shape the WhatsApp locator writes, so the lead screen shows it the same
 * way; nobody is messaged, and the team sends the store from the lead screen.
 *
 * No pincode, no routing: the city and state are kept as typed, but a guess
 * from them is not made. The forms ask for the pincode from 30 Sept 2026.
 */
async function insertLead(d: ImportDecision): Promise<'inserted' | 'same-enquiry'> {
    const lead = d.lead;
    const phone = phoneKey(lead.phone);

    // Checked again at the last moment: the customer's WhatsApp message may have
    // filed this enquiry while this pass was running.
    const at = d.at ?? new Date();
    const pincode = extractPincode(lead.pincode);
    const [dup]: any = await db.execute(
        `SELECT 1 FROM leads WHERE source IN ('instagram', 'whatsapp') AND phone_key = ?
            AND created_at BETWEEN ? - INTERVAL ? DAY AND ? + INTERVAL ? DAY LIMIT 1`,
        [phone, at, SAME_ENQUIRY_DAYS, at, SAME_ENQUIRY_DAYS]
    );
    if (dup.length) return 'same-enquiry';

    const result = pincode ? await findStoresForPincode(pincode) : null;

    const district = result?.customer?.district ?? null;
    const place = pincode && district && district !== 'NA' ? `${titleCase(district)} (${pincode})` : null;
    const kind = !result ? null : result.stores.length ? 'stores' : (result.fallback?.kind ?? 'support');
    const contacts = result?.stores.length
        ? result.stores.map(st => ({ id: st.id, name: st.store_name, distance_km: st.distance_km }))
        : (result?.fallback?.contacts ?? []).map(c => ({ id: c.id, name: c.name }));
    // Nearest first: the one the team is most likely to send.
    contacts.sort((a: any, b: any) => (a.distance_km ?? 0) - (b.distance_km ?? 0));

    const status = kind && kind !== 'support' ? 'matched' : 'unmatched';
    const why = !pincode
        ? (lead.pincode ? `No valid pincode in "${String(lead.pincode).slice(0, 40)}"` : 'No pincode on the form')
        : kind === 'support' ? 'No store, ASM or distributor near this pincode' : null;

    const leadId = uuidv4();
    await db.execute(
        `INSERT INTO leads
           (id, source, product, car_model, state, customer_name, customer_phone, phone_key,
            raw_area, matched_area, asm_id, flow_id, raw_payload, status, failure_reason, created_at)
         VALUES (?, 'instagram', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            leadId,
            normaliseProduct(lead.product) ?? lead.product ?? null,
            sheetCar(lead),
            findState(String(result?.customer?.state ?? ''))?.state ?? null,
            String(lead.name ?? '').trim().slice(0, 255) || null,
            phone,
            phone,
            pincode ?? (String(lead.pincode ?? '').trim().slice(0, 255) || null),
            place,
            kind === 'asm' ? result!.fallback!.contacts[0].id : null,
            SHEET_FLOW_ID,
            JSON.stringify({
                sheet: {
                    lead_id: String(lead.leadId ?? '').replace(/^l:/i, '').trim() || null,
                    row: lead.rowNumber,
                    created_time: lead.createdAt,
                    platform: lead.platform,
                    pincode: lead.pincode,
                    car: lead.car,
                    car_year: lead.carYear,
                    city: lead.city,
                    state: lead.state,
                    ...(Object.keys(lead.unmapped).length ? { other: lead.unmapped } : {}),
                },
                ...(kind ? {
                    locator: {
                        pincode,
                        offered: kind,
                        count: contacts.length,
                        // The customer was not messaged: they filled a form, they never wrote to us.
                        reply: 'none',
                        via: 'sheet',
                        options: contacts.slice(0, 10),
                    },
                } : {}),
            }),
            status,
            why,
            d.at ?? new Date(),
        ]
    );

    /*
     * This customer filled the form but never wrote to us, so nothing reaches
     * them unless we send it: the nearest store's details (that store gets the
     * lead), or the ASM / distributor / support when no store is near. A
     * failure here leaves the lead filed for the auditor.
     */
    if (result && pincode) {
        try {
            const settings = await getLocatorSettings();
            const sentTo = await deliverLead(
                {
                    id: leadId, phone, name: String(lead.name ?? '').trim() || null,
                    product: normaliseProduct(lead.product) ?? null, car: sheetCar(lead), place: place ?? pincode,
                },
                result, { stores: 'choose' }, settings.whatsapp_live,
            );
            console.log(`[LeadSheet] lead ${leadId} (${pincode}) -> ${kind}${sentTo ? `, sent to ${sentTo}` : ', nobody messaged'}`);
        } catch (err: any) {
            console.error(`[LeadSheet] lead ${leadId} filed but not delivered:`, err?.message);
        }
    }
    return "inserted";
}

/**
 * One pass over the sheet. `dryRun` reads and decides but writes nothing —
 * how to see what an import would do before it runs for real.
 */
export async function importLeadSheet(opts: { dryRun?: boolean } = {}): Promise<ImportReport | null> {
    const { url, tab, since } = sheetConfig();
    if (!url) return null;

    const rows = await readSheet(url, tab);
    const { leads, skipped } = readLeadSheet(rows);
    const decisions = planSheetImport(leads, await knownLeads(), since);

    const count = (a: ImportDecision['action']) => decisions.filter(d => d.action === a).length;
    const report: ImportReport = {
        rows: leads.length,
        inserted: 0,
        alreadyImported: count('already-imported'),
        sameEnquiry: count('same-enquiry'),
        unusable: count('unusable'),
        tooOld: count('too-old'),
        waiting: count('wait'),
        skippedRows: skipped,
    };

    for (const d of decisions) {
        if (d.action !== 'insert') continue;
        if (opts.dryRun) { report.inserted++; continue; }
        try {
            if (await insertLead(d) === "inserted") report.inserted++;
            else report.sameEnquiry++;
        } catch (err: any) {
            // One bad row must not stop the rest; it is tried again next pass.
            console.error(`[LeadSheet] row ${d.lead.rowNumber} not filed:`, err?.message);
        }
    }

    if (report.inserted || opts.dryRun) {
        console.log(`[LeadSheet] ${opts.dryRun ? 'dry run' : 'import'}:`, JSON.stringify(report));
    }
    return report;
}

let running = false;

/** Every ten minutes while LEAD_SHEET_URL is set; one pass at a time. */
export function startLeadSheetSchedule(): void {
    if (!sheetConfig().url) {
        console.log('[LeadSheet] LEAD_SHEET_URL not set — sheet import off');
        return;
    }
    const tick = async () => {
        if (running) return;
        running = true;
        try { await importLeadSheet(); }
        catch (err: any) { console.error('[LeadSheet] import failed:', err?.message); }
        finally { running = false; }
    };
    setTimeout(() => { void tick(); }, 60_000);
    const timer = setInterval(() => { void tick(); }, INTERVAL_MS);
    timer.unref?.();
}
