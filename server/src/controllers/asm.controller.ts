import { Request, Response } from 'express';
import db from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import { hasAutoReplyContent } from '../services/autoReply.js';
import { findStoresForPincode, getLocatorSettings, saveLocatorSettings } from '../services/storeLocatorQuery.js';
import { startStoreEnquiry, notifyOnce, manualLeadPlan, createManualPincodeLead, createTwoWheelerLead, type AlertResult } from '../services/storeLocatorChat.js';
import { startFromHandoff } from '../services/locatorConversation.service.js';
import { searchAreas, resolveNewArea, coverageOf, placeOf } from '../services/asmTerritoryQuery.js';
import { extractPincode } from '../services/storeLocator.js';
import { routeEnquiry, areaKey } from '../services/asmRouting.service.js';
import { findState } from '../services/indianStates.js';
import { isSamePlace, buildAddress } from '../services/placeMatch.js';
import { buildLeadCharts, CHART_CHANNELS, MANUAL_CHANNELS } from '../services/leadCharts.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { summariseIvr } from '../services/ivrLead.js';
import {
    leadRouting, notifiedIds, leadPincode, areaText, locatorOf, phoneTail, leadStage, LEAD_STAGES,
    forwardKinds, leadStores,
} from '../services/leadRouting.js';
import { describeMessages } from '../services/leadMessages.js';
import { PRODUCTS } from '../services/productMatch.js';
import { titleCase } from '../services/asmTerritory.js';

/**
 * The verified franchises in a state, with the ones the customer's own words
 * point at marked and sorted first.
 *
 * Shared by the lead screen and the manual add form: the add form needs this
 * before a lead exists, keyed on the typed area rather than a stored row, and
 * two copies of the matching would drift apart.
 *
 * Matched on the canonical state, not the stored spelling: vendor_details holds
 * 29 spellings for about 25 states, so comparing strings would miss most of
 * them. The "near" tag is advice and the admin still picks — but a wrong one is
 * worse than none, since it is the reason they would choose one store over
 * another, and the result is a customer sent across their state.
 */
async function storesForArea(state: string | null, rawArea: string): Promise<any[]> {
    if (!state) return [];

    const [rows]: any = await db.execute(
        `SELECT vd.id, vd.store_name, vd.store_code, vd.address, vd.city,
                vd.state, vd.pincode, p.phone_number
           FROM vendor_details vd
           LEFT JOIN profiles p ON p.id = vd.user_id
           JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1
          WHERE vd.is_franchise = 1`
    );

    const scored = rows
        .filter((r: any) => findState(r.state || '')?.state === state)
        .map((r: any) => ({ ...r, near: isSamePlace(r.city || '', rawArea, state) }));

    scored.sort((a: any, b: any) =>
        (b.near ? 1 : 0) - (a.near ? 1 : 0) ||
        String(a.city || '').localeCompare(String(b.city || '')) ||
        String(a.store_name).localeCompare(String(b.store_name))
    );

    return scored;
}

/**
 * Who each store-locator lead went to, as `row.routing` (see leadRouting).
 *
 * One query per kind for the whole page rather than per lead. mysql2's
 * execute cannot bind an array to IN (?), so the placeholders are built.
 */
async function attachRouting(rows: any[]) {
    const locator = rows.filter(r => r.flow_id === 'store-locator');
    for (const row of rows) row.routing = null;
    if (!locator.length) return;

    const storeIds = new Set<string>();
    const distributorIds = new Set<string>();
    for (const r of locator) {
        const ids = notifiedIds(r.raw_payload);
        ids.stores.forEach(id => storeIds.add(id));
        ids.distributors.forEach(id => distributorIds.add(id));
    }
    const marks = (n: number) => Array(n).fill('?').join(',');

    const stores = new Map<string, { name: string; phone: string | null }>();
    if (storeIds.size) {
        const [found]: any = await db.execute(
            `SELECT vd.id, vd.store_name, p.phone_number
               FROM vendor_details vd LEFT JOIN profiles p ON p.id = vd.user_id
              WHERE vd.id IN (${marks(storeIds.size)})`,
            [...storeIds]
        );
        for (const s of found) stores.set(String(s.id), { name: s.store_name, phone: s.phone_number });
    }

    const distributors = new Map<string, { name: string; phone: string | null }>();
    if (distributorIds.size) {
        const [found]: any = await db.execute(
            `SELECT id, name, phone_number FROM distributors WHERE id IN (${marks(distributorIds.size)})`,
            [...distributorIds]
        );
        for (const d of found) distributors.set(String(d.id), { name: d.name, phone: d.phone_number });
    }

    // Support falls back to the store template until Meta approves its own.
    const [logs]: any = await db.execute(
        `SELECT reference_id, recipient_phone, status FROM message_logs
          WHERE context IN ('store_lead', 'support_lead')
            AND reference_id IN (${marks(locator.length)})
          ORDER BY created_at`,
        locator.map(r => r.id)
    );
    const alertsFor = new Map<string, { phone: string; status: string }[]>();
    for (const l of logs) {
        const list = alertsFor.get(l.reference_id) ?? [];
        list.push({ phone: l.recipient_phone, status: l.status });
        alertsFor.set(l.reference_id, list);
    }

    const settings = await getLocatorSettings();
    const support = { name: settings.support_name, phone: settings.support_phone || null };
    for (const r of locator) {
        r.routing = leadRouting(r, { stores, distributors, support, alerts: alertsFor.get(r.id) ?? [] });
    }
}

/**
 * The stores for a customer: the ones the WhatsApp locator offers for this
 * pincode — within its radius, nearest first — then the rest of the state
 * below, because an auditor on the phone may know better. Without a pincode,
 * the state comes from the typed area (or `knownState`, the lead's own).
 */
async function storesNear(pin: string | null, area: string, knownState: string | null) {
    const place = pin ? await placeOf(pin) : null;
    const state = (place ? findState(String(place.state ?? ''))?.state : null)
        ?? (area ? findState(area)?.state : null)
        ?? knownState
        ?? null;

    const nearby = pin
        ? [...(await findStoresForPincode(pin)).stores].sort((a, b) => a.distance_km - b.distance_km)
        : [];
    const nearIds = new Set(nearby.map(s => String(s.id)));
    const rest = state
        ? (await storesForArea(state, area)).filter((s: any) => !nearIds.has(String(s.id)))
        : [];
    const stores = [
        ...nearby.map(s => ({
            id: s.id, store_name: s.store_name, store_code: s.store_code,
            address: s.address, city: s.city, state, pincode: s.pincode,
            phone_number: s.phone, near: true, distance_label: s.distance_label,
        })),
        // By pincode, "near" means within the locator's radius; the city match is only a guess.
        ...rest.map((s: any) => ({ ...s, near: pin ? false : s.near, distance_label: null })),
    ];
    return { state, place, stores };
}

export class AsmController {
    /**
     * Called by the Interakt workflow when a customer has given their area.
     *
     * Returns the matched ASM so the workflow can name them in its own closing
     * message. That message is then an ordinary reply inside the 24-hour window
     * rather than a paid template — the reason this answers synchronously
     * instead of acknowledging first.
     *
     * Interakt requires a 200 within three seconds and disables the webhook
     * after five failures in ten minutes, so the whole thing is raced against a
     * 2.2s timer: a slow WhatsApp send loses the ASM's name in the reply, but
     * never costs us the webhook. Routing continues regardless.
     */
    static async routeEnquiryWebhook(req: Request, res: Response) {
        const { area, phone, name, product, car, source, flow_id, fallbackArea, dryRun } = req.body || {};

        if (!phone || !area) {
            return res.status(400).json({ error: 'phone and area are required' });
        }

        /*
         * An auto-responder answering on the customer's behalf is not an
         * enquiry. Apps like WhatAuto reply to every message we send, and the
         * workflow passes that canned line through as the area — one number
         * filed eleven junk leads in three minutes this way.
         *
         * Answered 200 with the usual keys rather than 400: Interakt disables
         * a webhook after five failures in ten minutes, and an auto-responder
         * produces exactly the rapid burst that would trip it.
         */
        if (hasAutoReplyContent([area, car, name])) {
            console.log(`[ASM] auto-reply ignored from ${String(phone).slice(-10)}`);
            // Every key the normal path returns, for the reason given there.
            return res.json({
                received: true,
                matched: false,
                status: 'ignored',
                asm_name: '',
                asm_phone: '',
                area: '',
                product: '',
                car: '',
            });
        }

        const routing = routeEnquiry({
            area: String(area),
            phone: String(phone),
            name: name ? String(name) : null,
            product: product ? String(product) : null,
            car: car ? String(car) : null,
            source: source ? String(source) : 'whatsapp',
            flowId: flow_id ? String(flow_id) : null,
            fallbackArea: fallbackArea ? String(fallbackArea) : null,
            dryRun: dryRun === true,
            rawPayload: req.body,
        });

        // Keep routing alive even if the race below gives up on it.
        routing.catch(err => console.error('[ASM] routing failed:', err?.message));

        const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 2200));
        const result = await Promise.race([routing.catch(() => null), timeout]);

        /*
         * Always answer with the same keys. Interakt's Save Response maps fields
         * by name, so a missing key would leave a variable unset and print an
         * empty gap in the customer's message.
         */
        res.json({
            received: true,
            matched: Boolean(result?.asm),
            // 'sent' | 'duplicate' | 'unmatched' | 'failed' | 'dry-run', or
            // empty when routing outran the timer and the reply went without it.
            status: result?.status || '',
            asm_name: result?.asm?.name || '',
            asm_phone: result?.asm?.phone_number || '',
            area: result?.matchedArea || String(area),
            product: result?.product || '',
            car: result?.car || '',
        });
    }

    // ── ASMs ────────────────────────────────────────────────────────────────

    static async listAsms(_req: Request, res: Response) {
        try {
            const [rows]: any = await db.execute(
                `SELECT a.*,
                        (SELECT COUNT(*) FROM asm_areas ar WHERE ar.asm_id = a.id) AS area_count,
                        (SELECT COUNT(*) FROM leads l WHERE l.asm_id = a.id) AS lead_count
                   FROM asms a
                  ORDER BY a.is_active DESC, a.name ASC`
            );
            const [areas]: any = await db.execute(
                `SELECT id, asm_id, area_key, area_label, state, kind, district, pincode
                   FROM asm_areas ORDER BY area_label`
            );
            const counts = await coverageOf(areas).catch(() => areas.map(() => 0));
            res.json({
                success: true,
                asms: rows,
                areas: areas.map((a: any, i: number) => ({ ...a, pincodes: counts[i] })),
            });
        } catch (error: any) {
            console.error('List ASMs error:', error);
            res.status(500).json({ error: 'Failed to load ASMs' });
        }
    }

    static async createAsm(req: Request, res: Response) {
        try {
            const { name, phone_number, email } = req.body || {};
            if (!name || !phone_number) {
                return res.status(400).json({ error: 'Name and WhatsApp number are required' });
            }
            const id = uuidv4();
            await db.execute(
                'INSERT INTO asms (id, name, phone_number, email) VALUES (?, ?, ?, ?)',
                [id, String(name).trim(), String(phone_number).replace(/\D/g, ''), email || null]
            );
            res.status(201).json({ success: true, id, message: 'ASM added' });
        } catch (error: any) {
            if (error?.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'That WhatsApp number already belongs to another ASM' });
            }
            console.error('Create ASM error:', error);
            res.status(500).json({ error: 'Failed to add ASM' });
        }
    }

    static async updateAsm(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { name, phone_number, email, is_active } = req.body || {};
            const [rows]: any = await db.execute('SELECT id FROM asms WHERE id = ?', [id]);
            if (!rows.length) return res.status(404).json({ error: 'ASM not found' });

            await db.execute(
                `UPDATE asms SET
                    name = COALESCE(?, name),
                    phone_number = COALESCE(?, phone_number),
                    email = ?,
                    is_active = COALESCE(?, is_active)
                  WHERE id = ?`,
                [
                    name ? String(name).trim() : null,
                    phone_number ? String(phone_number).replace(/\D/g, '') : null,
                    email ?? null,
                    is_active === undefined ? null : (is_active ? 1 : 0),
                    id,
                ]
            );
            res.json({ success: true, message: 'ASM updated' });
        } catch (error: any) {
            if (error?.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'That WhatsApp number already belongs to another ASM' });
            }
            console.error('Update ASM error:', error);
            res.status(500).json({ error: 'Failed to update ASM' });
        }
    }

    static async deleteAsm(req: Request, res: Response) {
        try {
            const { id } = req.params;
            // Areas cascade; leads keep asm_id so history survives the deletion.
            const [r]: any = await db.execute('DELETE FROM asms WHERE id = ?', [id]);
            if (!r.affectedRows) return res.status(404).json({ error: 'ASM not found' });
            res.json({ success: true, message: 'ASM removed' });
        } catch (error: any) {
            console.error('Delete ASM error:', error);
            res.status(500).json({ error: 'Failed to remove ASM' });
        }
    }

    // ── Areas ───────────────────────────────────────────────────────────────

    /**
     * Give an ASM a place: a state, a district or a pincode from the pincode
     * directory. Every pincode inside it is then theirs.
     *
     * The key is UNIQUE, so a second ASM claiming the same place is refused by
     * the database rather than resolved arbitrarily at routing time. A place
     * inside one someone else holds — a district of their state — is allowed:
     * the more specific place wins, which is how a state is split.
     */
    static async addArea(req: Request, res: Response) {
        try {
            const { asm_id } = req.body || {};
            if (!asm_id) return res.status(400).json({ error: 'asm_id is required' });

            const [asm]: any = await db.execute('SELECT id FROM asms WHERE id = ?', [asm_id]);
            if (!asm.length) return res.status(404).json({ error: 'ASM not found' });

            let area;
            try {
                area = await resolveNewArea(req.body || {});
            } catch (err: any) {
                return res.status(400).json({ error: err?.message || 'Pick the area from the list' });
            }

            try {
                await db.execute(
                    `INSERT INTO asm_areas (id, asm_id, area_key, area_label, state, kind, district, pincode)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [uuidv4(), asm_id, area.key, area.label, area.state,
                     area.territory.kind, area.territory.district ?? null, area.territory.pincode ?? null]
                );
            } catch (error: any) {
                if (error?.code !== 'ER_DUP_ENTRY') throw error;
                const [owner]: any = await db.execute(
                    `SELECT a.name FROM asm_areas ar JOIN asms a ON a.id = ar.asm_id WHERE ar.area_key = ?`,
                    [area.key]
                );
                return res.status(400).json({
                    error: owner.length
                        ? `${area.label} is already covered by ${owner[0].name}`
                        : `${area.label} is already assigned`,
                });
            }
            res.status(201).json({ success: true, message: `${area.label} assigned` });
        } catch (error: any) {
            console.error('Add area error:', error);
            res.status(500).json({ error: 'Failed to assign the area' });
        }
    }

    /** Places matching what the admin typed, and who already holds each. */
    static async searchAreas(req: Request, res: Response) {
        try {
            const places = await searchAreas(String(req.query.q || ''));
            res.json({ success: true, places });
        } catch (error: any) {
            console.error('Area search error:', error);
            res.status(500).json({ error: 'Failed to search areas' });
        }
    }

    static async removeArea(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const [r]: any = await db.execute('DELETE FROM asm_areas WHERE id = ?', [id]);
            if (!r.affectedRows) return res.status(404).json({ error: 'Area not found' });
            res.json({ success: true, message: 'Area removed' });
        } catch (error: any) {
            console.error('Remove area error:', error);
            res.status(500).json({ error: 'Failed to remove the area' });
        }
    }

    /** Cities we already serve — suggestions, so nobody types an area from memory. */
    static async knownAreas(_req: Request, res: Response) {
        try {
            const [rows]: any = await db.execute(
                `SELECT DISTINCT city AS label, state
                   FROM vendor_details
                  WHERE city IS NOT NULL AND TRIM(city) <> ''
                  ORDER BY city`
            );
            res.json({ success: true, areas: rows });
        } catch (error: any) {
            console.error('Known areas error:', error);
            res.status(500).json({ error: 'Failed to load areas' });
        }
    }

    // ── Leads (phase 2 reads this) ──────────────────────────────────────────

    /**
     * Add a lead by hand.
     *
     * IVR and website enquiries reach us by phone or a form, not a webhook, so
     * somebody has to enter them. They then travel the same path as an
     * automatic one — matched to a state, sent to that ASM, capped by the same
     * daily limit — because a lead is a lead whatever door it came through.
     *
     * This sends a real WhatsApp to a real person. `preview` exists so the form
     * can show who it is about to reach before anything is sent.
     */
    static async createLead(req: Request, res: Response) {
        try {
            const { name, phone, product, car, source, preview } = req.body || {};
            const admin = (req as any).user;
            // The team's notes, typed with the lead — the same field its Edit dialog keeps.
            const notes = String(req.body?.internal_notes ?? '').trim().slice(0, 2000);
            const saveNotes = async (leadId: string | null | undefined) => {
                if (notes && leadId) await db.execute('UPDATE leads SET internal_notes = ? WHERE id = ?', [notes, leadId]);
            };

            /*
             * The pincode is what lets the store message go out — the lead screen
             * finds the stores near it, as WhatsApp does. A lead saved with only
             * an area could never be sent a store. The area is still accepted
             * when the customer does not know their pincode.
             */
            const pin = extractPincode(String(req.body?.pincode ?? ''));
            if (req.body?.pincode && String(req.body.pincode).trim() && !pin) {
                return res.status(400).json({ error: 'That is not a valid 6-digit pincode' });
            }
            const place = pin ? await placeOf(pin) : null;
            if (pin && !place) {
                return res.status(400).json({ error: `We could not find the pincode ${pin}. Check it, or leave it blank and type the area.` });
            }
            const typedArea = String(req.body?.area ?? '').trim();
            // Routing reads the state from the area text: from the pincode's own place when there is one.
            const area = typedArea || (place
                ? [place.district && place.district !== 'NA' ? titleCase(place.district) : null, place.state].filter(Boolean).join(', ')
                : '');

            // A 2-wheeler goes to the Customer Executive, not a store: no location needed.
            const twoWheeler = req.body?.wheels === '2w';
            if (!phone || (!area && !twoWheeler)) {
                return res.status(400).json({ error: 'Phone number and a pincode (or the area) are required' });
            }
            /*
             * An Indian mobile, not merely ten or more digits.
             *
             * The old check passed anything long enough, so a keyboard mash
             * like 23423423432432423 was accepted and filed as a lead nobody
             * could ever call. The last ten digits are taken so a country code
             * or a leading zero is accepted, then those ten are required to
             * look like a real number.
             */
            const digits = String(phone).replace(/\D/g, '').slice(-10);
            if (digits.length !== 10 || !/^[6-9]\d{9}$/.test(digits)) {
                return res.status(400).json({
                    error: 'That is not a valid Indian mobile number — 10 digits starting 6, 7, 8 or 9.',
                });
            }

            // Only the manual channels: an entry claiming to be from WhatsApp
            // or Instagram would be indistinguishable from a real one. An
            // enquiry the team took on WhatsApp by hand is its own channel,
            // 'whatsapp_manual', so the bot's leads and logic never mix with it;
            // Instagram and Facebook DMs likewise, apart from the Instagram ad form.
            const channel = MANUAL_CHANNELS.includes(source) ? source : 'ivr';

            if (twoWheeler) {
                const settings = await getLocatorSettings();
                if (preview === true) {
                    return res.json({
                        success: true, preview: true, two_wheeler: true,
                        contact_name: settings.support_name, contact_phone: settings.support_phone || null,
                    });
                }
                const made = await createTwoWheelerLead({
                    phone: digits, name: name ? String(name) : null, product: product ? String(product) : null,
                    car: car ? String(car) : null, source: channel, enteredBy: admin?.email || admin?.id || null,
                    pincode: pin, area: typedArea || area || null,
                });
                await saveNotes(made.leadId);
                try {
                    await ActivityLogService.log({
                        adminId: admin?.id, adminName: admin?.name, adminEmail: admin?.email,
                        actionType: 'LEAD_CREATED', targetType: 'LEAD', targetId: made.leadId,
                        targetName: name ? String(name) : digits,
                        details: { channel, vehicle: '2w', alert: made.alert },
                        ipAddress: req.ip || req.socket?.remoteAddress,
                    });
                } catch (e) {
                    console.error('Failed to log lead creation', e);
                }
                return res.status(201).json({
                    success: true, id: made.leadId, outcome: 'support',
                    message: made.sentTo ? `2-wheeler lead added — ${made.sentTo} alerted` : '2-wheeler lead added — executive not alerted',
                });
            }

            /*
             * With a pincode, the WhatsApp chain: the stores near it (the auditor
             * picks one, and the customer and that store are messaged), else the
             * ASM, the distributor, then support. The state's ASM is not messaged
             * just because the lead was added.
             */
            if (pin) {
                if (preview === true) {
                    const plan = await manualLeadPlan(pin);
                    return res.json({
                        success: true, preview: true, pincode: pin,
                        state: plan.state, district: plan.district,
                        outcome: plan.kind,
                        store_count: plan.result.stores.length,
                        contact_name: plan.contact?.name ?? null,
                        // Kept for older screens: who is messaged on save.
                        matched: plan.kind !== 'support',
                        asm_name: plan.contact?.name ?? null,
                    });
                }
                const made = await createManualPincodeLead({
                    pincode: pin, phone: digits,
                    name: name ? String(name) : null, product: product ? String(product) : null, car: car ? String(car) : null,
                    source: channel, enteredBy: admin?.email || admin?.id || null,
                    storePicked: req.body?.store_picked === true,
                });
                await saveNotes(made.leadId);
                try {
                    await ActivityLogService.log({
                        adminId: admin?.id, adminName: admin?.name, adminEmail: admin?.email,
                        actionType: 'LEAD_CREATED', targetType: 'LEAD', targetId: made.leadId,
                        targetName: name ? String(name) : digits,
                        details: { channel, pincode: pin, outcome: made.kind, sent_to: made.sentTo },
                        ipAddress: req.ip || req.socket?.remoteAddress,
                    });
                } catch (e) {
                    console.error('Failed to log lead creation', e);
                }
                return res.status(201).json({
                    success: true, id: made.leadId, outcome: made.kind,
                    message: made.kind === 'stores'
                        ? 'Lead added'
                        : made.sentTo ? `Lead added — no store near ${pin}, sent to ${made.sentTo}` : `Lead added — no store near ${pin}`,
                });
            }

            /*
             * A preview resolves and reports without sending. Mistyping an area
             * here costs a real message to a real ASM, and that cannot be
             * recalled, so the form is expected to show the match first.
             */
            if (preview === true) {
                const result = await routeEnquiry({
                    area: String(area),
                    phone: digits,
                    name: name ? String(name) : null,
                    product: product ? String(product) : null,
                    car: car ? String(car) : null,
                    source: channel,
                    dryRun: true,
                });
                return res.json({
                    success: true,
                    preview: true,
                    state: findState(String(area))?.state || null,
                    pincode: pin,
                    district: place?.district && place.district !== 'NA' ? titleCase(place.district) : null,
                    matched: Boolean(result.asm),
                    asm_name: result.asm?.name || null,
                    asm_phone: result.asm?.phone_number || null,
                    status: result.status,
                });
            }

            const result = await routeEnquiry({
                area: String(area),
                phone: digits,
                name: name ? String(name) : null,
                product: product ? String(product) : null,
                car: car ? String(car) : null,
                source: channel,
                // The pincode where leadPincode reads it, so the lead screen finds its stores.
                rawPayload: { entered_by: admin?.email || admin?.id, channel, ...(pin ? { pincode: pin } : {}) },
            });
            await saveNotes(result.leadId);

            try {
                await ActivityLogService.log({
                    adminId: admin?.id,
                    adminName: admin?.name,
                    adminEmail: admin?.email,
                    actionType: 'LEAD_CREATED',
                    targetType: 'LEAD',
                    targetId: result.leadId,
                    targetName: name ? String(name) : digits,
                    details: {
                        channel,
                        area: String(area),
                        status: result.status,
                        asm: result.asm?.name || null,
                    },
                    ipAddress: req.ip || req.socket?.remoteAddress,
                });
            } catch (e) {
                console.error('Failed to log lead creation', e);
            }

            res.status(201).json({
                success: true,
                id: result.leadId,
                status: result.status,
                asm_name: result.asm?.name || null,
                message: result.asm
                    ? `Lead added and forwarded to ${result.asm.name}`
                    : 'Lead added, but no ASM covers that area yet',
            });
        } catch (error: any) {
            console.error('Create lead error:', error);
            res.status(500).json({ error: 'Failed to add the lead' });
        }
    }

    /**
     * Edit a lead: the outcome, the audit, and corrections to what was captured.
     *
     * Two outcomes are tracked separately and deliberately. `lead_status` is
     * what the ASM reported; `review_status` is what an admin found calling the
     * customer back. Where the two disagree is the whole point of auditing, so
     * neither may overwrite the other.
     */
    static async updateLead(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const admin = (req as any).user;
            const {
                lead_status, review_status, review_reason, internal_notes,
                customer_name, raw_area, state, product, car_model, pincode,
            } = req.body || {};

            const [rows]: any = await db.execute('SELECT id, raw_area, raw_payload FROM leads WHERE id = ?', [id]);
            if (!rows.length) return res.status(404).json({ error: 'Lead not found' });

            if (pincode !== undefined && pincode !== null && pincode !== '' && !/^[1-9]\d{5}$/.test(String(pincode).trim())) {
                return res.status(400).json({ error: 'The pincode must be 6 digits' });
            }
            if (product !== undefined && product !== null && product !== '' && !PRODUCTS.includes(product)) {
                return res.status(400).json({ error: `Product must be one of ${PRODUCTS.join(', ')}` });
            }

            const OUTCOMES = [
                'no_response', 'follow_up', 'closed_won', 'closed_lost',
                'call_disconnected', 'switched_off', 'number_not_working',
            ];
            for (const [field, value] of [
                ['lead_status', lead_status],
                ['review_status', review_status],
            ] as Array<[string, any]>) {
                if (value !== undefined && value !== null && value !== ''
                    && !OUTCOMES.includes(String(value))) {
                    return res.status(400).json({ error: `${field} is not one of the allowed outcomes` });
                }
            }

            const sets: string[] = [];
            const params: any[] = [];
            const assign = (col: string, value: any, transform: (v: any) => any = v => v) => {
                if (value === undefined) return;
                sets.push(`${col} = ?`);
                params.push(value === '' || value === null ? null : transform(value));
            };

            assign('lead_status', lead_status);
            assign('review_status', review_status);
            assign('review_reason', review_reason, v => String(v).slice(0, 500));
            // The auditor's own notes: kept on the lead, shown only in its Edit dialog.
            assign('internal_notes', internal_notes, v => String(v).trim().slice(0, 2000) || null);
            assign('customer_name', customer_name, v => String(v).trim());
            assign('raw_area', raw_area, v => String(v).trim());
            assign('product', product);
            assign('car_model', car_model, v => String(v).trim().slice(0, 80));

            /*
             * The pincode, kept apart from the area as typed: WhatsApp and
             * Instagram ask for one, and on an IVR lead the auditor asks the
             * caller for both. Stored in raw_payload.pincode — the key the
             * workflows already write — so no column is needed.
             */
            const oldPin = leadPincode(rows[0].raw_payload, rows[0].raw_area);
            const areaChanged = raw_area !== undefined
                && String(raw_area ?? '').trim() !== String(rows[0].raw_area ?? '').trim();
            if (pincode !== undefined) {
                sets.push(`raw_payload = JSON_SET(COALESCE(raw_payload, JSON_OBJECT()), '$.pincode', ?)`);
                params.push(String(pincode ?? '').trim() || null);
            } else if (areaChanged && oldPin) {
                /* A WhatsApp lead's pincode may live only in raw_area; typing a
                   place name over it must not lose what the customer gave. */
                sets.push(`raw_payload = JSON_SET(COALESCE(raw_payload, JSON_OBJECT()), '$.pincode', ?)`);
                params.push(oldPin);
            }

            /*
             * Correcting the pincode or the area re-resolves the state, unless
             * one was given explicitly. The pincode wins: it names one place,
             * where an area can be spelt a dozen ways — and findState reads
             * place names, so a pincode given to it would wipe the state.
             */
            if (state !== undefined) {
                assign('state', state, v => String(v).trim());
            } else if (pincode !== undefined || areaChanged) {
                const area = raw_area !== undefined ? String(raw_area ?? '') : String(rows[0].raw_area ?? '');
                const pin = pincode !== undefined
                    ? extractPincode(pincode) ?? extractPincode(area)
                    : oldPin ?? extractPincode(area);
                const place = pin ? await placeOf(pin) : null;
                sets.push('state = ?');
                params.push(findState(String(place?.state ?? area))?.state || null);
            }

            // Stamp the audit only when the review itself changed.
            if (review_status !== undefined || review_reason !== undefined) {
                sets.push('reviewed_at = NOW()', 'reviewed_by = ?');
                params.push(admin?.id || null);
            }

            if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

            await db.execute(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);

            try {
                await ActivityLogService.log({
                    adminId: admin?.id,
                    adminName: admin?.name,
                    adminEmail: admin?.email,
                    actionType: 'LEAD_UPDATED',
                    targetType: 'LEAD',
                    targetId: id,
                    targetName: customer_name ? String(customer_name) : id,
                    details: {
                        lead_status: lead_status ?? null,
                        review_status: review_status ?? null,
                        review_reason: review_reason ?? null,
                        ...(internal_notes !== undefined ? { internal_notes_changed: true } : {}),
                    },
                    ipAddress: req.ip || req.socket?.remoteAddress,
                });
            } catch (e) {
                console.error('Failed to log lead update', e);
            }

            res.json({ success: true, message: 'Lead updated' });
        } catch (error: any) {
            console.error('Update lead error:', error);
            res.status(500).json({ error: 'Failed to update the lead' });
        }
    }

    /**
     * The stores that could serve this lead.
     *
     * Everything in the lead's state, because that is the unit an enquiry is
     * routed by and a customer will travel within — but ordered so the ones
     * matching what they actually typed come first. Someone who wrote "Rohini
     * Delhi" wants Rohini at the top, not alphabetical order across forty
     * Delhi franchises.
     *
     * The admin still chooses. This only saves them scrolling.
     */
    /**
     * The stores that could serve a typed area, before any lead exists.
     *
     * The manual add form needs this while the admin is still filling it in —
     * a customer phoning in is usually still on the line, and making them wait
     * while the lead is saved and reopened is the difference between sending a
     * store now and not sending one at all.
     */
    /**
     * The stores offered for a pincode, and who to call when there are none.
     *
     * The first piece of the store-locator flow: pincode in, list out, nothing
     * sent to anyone. It exists so the rules can be checked on real pincodes
     * before any customer sees the result.
     */
    /**
     * Called by the Interakt workflow with the customer's pincode.
     *
     * Answered at once, then worked on: Interakt wants a 200 within three
     * seconds and disables the webhook after five failures in ten minutes, and
     * nothing is handed back to the workflow — the stores go to the customer
     * straight from startStoreEnquiry, and the workflow ends at this node.
     */
    static async storeEnquiryWebhook(req: Request, res: Response) {
        const { pincode, phone, name, product, car } = req.body || {};

        // Interakt's "Test Webhook" posts the body with its placeholders unfilled.
        const unfilled = [pincode, phone].some(v => /\{\{\s*\d+\s*\}\}/.test(String(v ?? '')));
        // A hand-off without a real WhatsApp number cannot be answered. Logged
        // with what arrived, because from the customer's side it is silence —
        // and the usual cause is a workflow variable mapped to the wrong field.
        const digits = String(phone ?? '').replace(/\D/g, '');
        if (unfilled || digits.length < 10) {
            const reason = unfilled ? 'test call / unfilled variable' : 'no valid phone number';
            console.warn(`[Locator] store-enquiry ignored (${reason}) — body: ${JSON.stringify(req.body).slice(0, 300)}`);
            return res.json({ received: true, handled: false, reason });
        }

        // An auto-responder answering for the customer is not an enquiry.
        if (hasAutoReplyContent([pincode, car, name])) {
            console.log(`[Locator] auto-reply ignored from ${String(phone).slice(-10)}`);
            return res.json({ received: true, handled: false, reason: 'auto-reply' });
        }

        res.json({ received: true, handled: true });

        /*
         * The hybrid flow: the workflow hands over right after the product
         * menu, with no pincode, and our server asks the car and the pincode
         * itself — checking each answer (locatorConversation). A workflow that
         * still asks for the pincode lands below, exactly as before.
         */
        if (!String(pincode ?? '').trim()) {
            startFromHandoff({
                phone: String(phone),
                name: name ? String(name) : null,
                product: product ? String(product) : null,
                car: car ? String(car) : null,
                rawPayload: req.body,
            }).catch(err => console.error('[Chat] could not start:', err?.message));
            return;
        }

        startStoreEnquiry({
            pincode: String(pincode ?? ''),
            phone: String(phone),
            name: name ? String(name) : null,
            product: product ? String(product) : null,
            car: car ? String(car) : null,
            rawPayload: req.body,
        }).catch(err => console.error('[Locator] enquiry failed:', err?.message));
    }

    static async storesNearPincode(req: Request, res: Response) {
        try {
            const result = await findStoresForPincode(String(req.query.pincode || ''));
            res.json({ success: true, ...result });
        } catch (error: any) {
            console.error('Stores near pincode error:', error);
            res.status(500).json({ error: 'Failed to find stores for that pincode' });
        }
    }

    static async getLocatorSettings(_req: Request, res: Response) {
        try {
            // Every verified franchise, for picking the ones to hide from customers.
            const [stores]: any = await db.execute(
                `SELECT vd.id, vd.store_name, vd.city, vd.state
                   FROM vendor_details vd
                   JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1
                  WHERE vd.is_franchise = 1
                  ORDER BY vd.store_name`
            );
            res.json({
                success: true,
                settings: await getLocatorSettings(),
                stores: stores.map((s: any) => ({ id: String(s.id), store_name: s.store_name, city: s.city ?? null, state: s.state ?? null })),
            });
        } catch (error: any) {
            console.error('Locator settings read error:', error);
            res.status(500).json({ error: 'Failed to read the store locator settings' });
        }
    }

    /**
     * Change the minimum warranties, or the customer support contact.
     *
     * Logged, because raising the threshold removes stores from every
     * customer's list at once — someone asking why a store stopped getting
     * leads should be able to find out who changed it and when.
     */
    static async updateLocatorSettings(req: Request, res: Response) {
        try {
            const admin = (req as any).user;
            const before = await getLocatorSettings();
            const { min_warranties, radius_km, support_phone, support_name, whatsapp_live, test_numbers, hidden_stores } = req.body || {};

            let saved;
            try {
                saved = await saveLocatorSettings(
                    { min_warranties, radius_km, support_phone, support_name, whatsapp_live, test_numbers, hidden_stores },
                    admin?.id || null
                );
            } catch (err: any) {
                return res.status(400).json({ error: err?.message || 'Invalid settings' });
            }

            try {
                await ActivityLogService.log({
                    adminId: admin?.id,
                    adminName: admin?.name,
                    adminEmail: admin?.email,
                    actionType: 'LOCATOR_SETTINGS_UPDATED',
                    targetType: 'SYSTEM',
                    targetName: 'Store locator',
                    details: { before, after: saved },
                    ipAddress: req.ip || req.socket?.remoteAddress,
                });
            } catch (e) {
                console.error('Failed to log locator settings change', e);
            }

            res.json({ success: true, settings: saved });
        } catch (error: any) {
            console.error('Locator settings save error:', error);
            res.status(500).json({ error: 'Failed to save the store locator settings' });
        }
    }

    /**
     * The stores for a lead being added — by its pincode when there is one
     * (nearest first, as WhatsApp offers them), else by the typed area's state.
     */
    static async storesForEnquiry(req: Request, res: Response) {
        try {
            const area = String(req.query.area || '').trim();
            const pin = extractPincode(String(req.query.pincode || ''));
            if (!area && !pin) return res.json({ success: true, state: null, stores: [], near_count: 0 });

            const { state, place, stores } = await storesNear(pin, area, null);
            res.json({
                success: true,
                state,
                pincode: pin,
                district: place?.district && place.district !== 'NA' ? titleCase(place.district) : null,
                area,
                stores,
                near_count: stores.filter((s: any) => s.near).length,
            });
        } catch (error: any) {
            console.error('Stores for enquiry error:', error);
            res.status(500).json({ error: 'Failed to load stores for that area' });
        }
    }

    static async leadStores(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const [leads]: any = await db.execute(
                'SELECT id, state, raw_area, raw_payload FROM leads WHERE id = ?', [id]
            );
            if (!leads.length) return res.status(404).json({ error: 'Lead not found' });
            const lead = leads[0];

            /*
             * What the dialog has typed, before it is saved — a new pincode or
             * area shows its stores straight away, rather than after a save.
             */
            const { pincode: typedPin, area: typedArea } = req.query as Record<string, string>;
            const area = typedArea !== undefined ? String(typedArea) : String(lead.raw_area ?? '');
            const pin = typedPin !== undefined
                ? extractPincode(typedPin)
                : leadPincode(lead.raw_payload, lead.raw_area);

            const { state, place, stores } = await storesNear(
                pin, area, typedArea !== undefined ? null : (lead.state ?? null),
            );

            res.json({
                success: true,
                state,
                pincode: pin,
                district: place?.district && place.district !== 'NA' ? titleCase(place.district) : null,
                area,
                stores,
                near_count: stores.filter((s: any) => s.near).length,
                ...(stores.length ? {} : {
                    message: pin || state
                        ? `No verified franchise near ${pin ?? state} yet.`
                        : 'Enter a pincode or an area to find stores.',
                }),
            });
        } catch (error: any) {
            console.error('Lead stores error:', error);
            res.status(500).json({ error: 'Failed to load the stores for this lead' });
        }
    }

    /**
     * Every WhatsApp this lead set off, oldest first (see leadMessages).
     *
     * Everything is logged against the lead id except the ASM's alert, which
     * is logged against the customer's number — matched here on time, within
     * fifteen seconds of the forward, the same way the list matches it.
     */
    static async leadMessages(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const [leads]: any = await db.execute(
                `SELECT l.id, l.customer_phone, l.sent_at, l.created_at, l.raw_payload, a.name AS asm_name, a.phone_number AS asm_phone
                   FROM leads l LEFT JOIN asms a ON a.id = l.asm_id WHERE l.id = ?`,
                [id]
            );
            if (!leads.length) return res.status(404).json({ error: 'Lead not found' });
            const lead = leads[0];

            const COLS = 'context, template_name, recipient_phone, status, error_message, created_at, updated_at';
            const [byLead]: any = await db.execute(
                `SELECT ${COLS} FROM message_logs WHERE reference_id = ?`,
                [id]
            );
            /* A failed forward leaves no sent_at, and the failure is the one
               worth seeing — so the lead's own time stands in for it. */
            const [toAsm]: any = await db.execute(
                `SELECT ${COLS} FROM message_logs
                  WHERE context = 'asm_enquiry'
                    AND reference_id = ?
                    AND ABS(TIMESTAMPDIFF(SECOND, ?, created_at)) <= 15`,
                [lead.customer_phone, lead.sent_at ?? lead.created_at]
            );

            /* Stores and distributors by phone, to name who an alert went to. */
            const ids = notifiedIds(lead.raw_payload);
            const contacts = new Map<string, { name: string; kind: 'store' | 'distributor' }>();
            const [[stores], [dists]]: any = await Promise.all([
                ids.stores.length ? db.execute(
                    `SELECT vd.store_name AS name, p.phone_number AS phone FROM vendor_details vd
                       LEFT JOIN profiles p ON p.id = vd.user_id
                      WHERE vd.id IN (${ids.stores.map(() => '?').join(',')})`, ids.stores) : [[]],
                ids.distributors.length ? db.execute(
                    `SELECT name, phone_number AS phone FROM distributors
                      WHERE id IN (${ids.distributors.map(() => '?').join(',')})`, ids.distributors) : [[]],
            ]);
            for (const s of stores) contacts.set(phoneTail(s.phone), { name: s.name, kind: 'store' });
            for (const d of dists) contacts.set(phoneTail(d.phone), { name: d.name, kind: 'distributor' });

            const settings = await getLocatorSettings();
            const messages = describeMessages([...byLead, ...toAsm], {
                customerPhone: lead.customer_phone,
                offered: locatorOf(lead.raw_payload)?.offered ?? null,
                asm: lead.asm_name ? { name: lead.asm_name, phone: lead.asm_phone } : null,
                support: { name: settings.support_name, phone: settings.support_phone || null },
                contacts,
            });
            res.json({ success: true, messages });
        } catch (error: any) {
            console.error('Lead messages error:', error);
            res.status(500).json({ error: 'Failed to load the messages for this lead' });
        }
    }

    /**
     * Send a customer the store an admin picked for them.
     *
     * This message goes to a member of the public and cannot be recalled, so
     * `preview` returns exactly what would be sent without sending it, and the
     * screen shows that before the admin commits.
     *
     * The lead records which store and when. Whether the customer opened it is
     * read from message_logs afterwards, the same way the ASM's own delivery
     * state is.
     */
    static async sendLeadStore(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { store_id, preview } = req.body || {};
            const admin = (req as any).user;

            if (!store_id) return res.status(400).json({ error: 'Pick a store first' });

            const [leads]: any = await db.execute(
                `SELECT id, source, customer_phone, customer_name, product, car_model, store_id, store_sent_at,
                        created_at AS enquired_at,
                        JSON_EXTRACT(raw_payload, '$.locator.notified') AS notified
                   FROM leads WHERE id = ?`,
                [id]
            );
            if (!leads.length) return res.status(404).json({ error: 'Lead not found' });
            const lead = leads[0];

            const [stores]: any = await db.execute(
                `SELECT vd.id, vd.store_name, vd.address, vd.city, vd.state, vd.pincode,
                        p.phone_number
                   FROM vendor_details vd
                   LEFT JOIN profiles p ON p.id = vd.user_id
                  WHERE vd.id = ?`,
                [store_id]
            );
            if (!stores.length) return res.status(404).json({ error: 'Store not found' });
            const store = stores[0];

            /*
             * One readable line. The parts are joined rather than concatenated
             * blindly because a missing pincode or city would otherwise leave a
             * stray comma in a message a customer reads.
             */
            const address = buildAddress(store);

            /*
             * Whether the store is told too. A WhatsApp customer who picked a
             * store already alerted it; an Instagram lead filed from Meta's
             * sheet, an IVR call or a hand-added lead has alerted nobody yet.
             * Decided by what the lead has actually done, not by its source —
             * sheet leads share the "instagram" source with WhatsApp ones, and
             * were skipped. notifyOnce still never alerts one store twice.
             */
            const notifiedBefore = (() => {
                try {
                    const v = typeof lead.notified === 'string' ? JSON.parse(lead.notified) : lead.notified;
                    return Array.isArray(v) && v.length > 0;
                } catch { return false; }
            })();
            const alertsStore = !['whatsapp', 'instagram'].includes(lead.source) || !notifiedBefore;

            if (preview === true) {
                return res.json({
                    success: true,
                    preview: true,
                    store_name: store.store_name,
                    address,
                    store_phone: store.phone_number || null,
                    customer_phone: lead.customer_phone,
                    already_sent_at: lead.store_sent_at,
                    // IVR and hand-added leads also alert the store; see below.
                    alerts_store: alertsStore,
                });
            }

            if (!store.phone_number) {
                return res.status(400).json({
                    error: `${store.store_name} has no phone number on record, so the message would tell the customer to call nothing.`,
                });
            }

            const sent = await WhatsAppService.sendCustomerStoreDetails(
                lead.customer_phone,
                store.store_name,
                address,
                store.phone_number,
                lead.id
            );

            if (!sent) {
                return res.status(502).json({
                    error: 'WhatsApp did not accept the message. Nothing was recorded — try again.',
                });
            }

            await db.execute(
                'UPDATE leads SET store_id = ?, store_sent_at = NOW(), store_sent_by = ? WHERE id = ?',
                [store_id, admin?.id || null, id]
            );

            /*
             * The store hears of it too, for an IVR or hand-added lead — the
             * same "new lead" alert, with its monthly lead number, that a
             * WhatsApp customer's own pick sends. WhatsApp and Instagram leads
             * already alerted whoever they went to. Once per store per lead, so
             * resending the same store does not alert it twice; after the
             * customer's message, whose failure stops everything above.
             */
            let storeAlert: AlertResult | 'not-applicable' = 'not-applicable';
            if (alertsStore) {
                const settings = await getLocatorSettings();
                storeAlert = await notifyOnce(
                    lead, `store:${store.id}`, store.phone_number, store.store_name, settings.whatsapp_live,
                ).catch((err: any) => {
                    console.error('[Leads] store alert failed:', err?.message);
                    return 'failed' as const;
                });
            }

            try {
                await ActivityLogService.log({
                    adminId: admin?.id,
                    adminName: admin?.name,
                    adminEmail: admin?.email,
                    actionType: 'LEAD_STORE_SENT',
                    targetType: 'LEAD',
                    targetId: id,
                    targetName: lead.customer_name || lead.customer_phone,
                    details: {
                        store_name: store.store_name,
                        store_phone: store.phone_number,
                        customer_phone: lead.customer_phone,
                        resent: Boolean(lead.store_sent_at),
                        store_alert: storeAlert,
                    },
                    ipAddress: req.ip || req.socket?.remoteAddress,
                });
            } catch (e) {
                console.error('Failed to log store send', e);
            }

            res.json({
                success: true,
                message: `${store.store_name} sent to the customer`,
                store_name: store.store_name,
                store_alert: storeAlert,
            });
        } catch (error: any) {
            console.error('Send lead store error:', error);
            res.status(500).json({ error: 'Failed to send the store details' });
        }
    }

    static async listLeads(req: Request, res: Response) {
        /* A 2-wheeler enquiry: from the chat's first question, or added by hand. */
        const isTwoWheeler = (r: any) => /2-Wheeler/i.test(String(r.car_model ?? ''));
        try {
            const {
                status, stage, source, asm_id, product, delivery, review, dateFrom, dateTo, q, limit,
                forwarded_to, store, ivr_call, state, vehicle,
            } = req.query as Record<string, string>;
            /*
             * The date range and the plain column filters narrow in SQL.
             * Channel, product, stage and search are applied after, in one
             * place, because the tiles count by them: each tile group counts
             * with every filter but its own, so a tile and the list it opens
             * always agree.
             */
            const where: string[] = [];
            const params: any[] = [];
            if (status) { where.push('l.status = ?'); params.push(status); }
            if (asm_id) { where.push('l.asm_id = ?'); params.push(asm_id); }

            /*
             * The audit outcome. 'pending' is its own case and the one that
             * matters most day to day — a lead nobody has called back yet is
             * the work still to do, and it cannot be asked for by naming any
             * of the seven outcomes.
             */
            if (review) {
                if (review === 'pending') where.push('l.review_status IS NULL');
                else { where.push('l.review_status = ?'); params.push(review); }
            }

            /*
             * The date range, on the IST calendar date.
             *
             * The pool sets every connection's time_zone to +05:30, so
             * created_at already reads in IST and DATE() of it is the IST day.
             * It was once shifted again with CONVERT_TZ, which moved every
             * lead after 18:30 onto the next day. Both bounds are inclusive,
             * which is what a person picking two dates means.
             */
            if (dateFrom) {
                where.push("DATE(l.created_at) >= ?");
                params.push(dateFrom);
            }
            if (dateTo) {
                where.push("DATE(l.created_at) <= ?");
                params.push(dateTo);
            }

            /*
             * Filtering on how far the ASM's message got.
             *
             * The status itself is computed in the SELECT, so it cannot be named
             * in a WHERE clause — this repeats the match as an EXISTS instead.
             * 'none' is its own case: a lead with no message at all is an
             * unmatched, duplicate or throttled one, which is a different
             * question from "was it delivered".
             */
            if (delivery) {
                /* Every alert about the lead: the ASM's (logged against the
                   customer's number, matched on time), and the store,
                   distributor and support alerts (logged against the lead).
                   Store alerts are now most of them. */
                const alert = `(
                    (ml.context = 'asm_enquiry'
                     AND ml.reference_id = l.customer_phone COLLATE utf8mb4_unicode_ci
                     AND ABS(TIMESTAMPDIFF(SECOND, COALESCE(l.sent_at, l.created_at), ml.created_at)) <= 15)
                 OR (ml.context IN ('store_lead', 'support_lead')
                     AND ml.reference_id = l.id COLLATE utf8mb4_unicode_ci))`;

                if (delivery === 'none') {
                    where.push(`NOT EXISTS (SELECT 1 FROM message_logs ml WHERE ${alert})`);
                } else {
                    where.push(`EXISTS (SELECT 1 FROM message_logs ml WHERE ${alert} AND ml.status = ?)`);
                    params.push(delivery);
                }
            }

            const [rows]: any = await db.execute(
                `SELECT l.*, a.name AS asm_name, a.phone_number AS asm_phone,
                        /* The IST day, as the date filter reads it, for the charts. */
                        DATE_FORMAT(l.created_at, '%Y-%m-%d') AS ist_day,
                        /*
                         * Whether the ASM's WhatsApp actually arrived, and
                         * whether they opened it. Interakt's delivery webhook
                         * already keeps message_logs current — 'sent' only
                         * means we handed it over, which is the weakest of the
                         * three things worth knowing.
                         *
                         * Matched on recipient and time rather than a stored
                         * message id: capturing the id would mean changing what
                         * the shared WhatsApp service returns, and every
                         * template in the system goes through it. A correlated
                         * subquery cannot duplicate a lead row, and takes the
                         * nearest message inside fifteen seconds so a repeat
                         * enquiry from the same number cannot claim the wrong
                         * one. The collation cast is needed because the two
                         * tables were created with different defaults.
                         */
                        (SELECT ml.status FROM message_logs ml
                          WHERE ml.context = 'asm_enquiry'
                            AND ml.reference_id = l.customer_phone COLLATE utf8mb4_unicode_ci
                            AND ABS(TIMESTAMPDIFF(SECOND, l.sent_at, ml.created_at)) <= 15
                          ORDER BY ABS(TIMESTAMPDIFF(SECOND, l.sent_at, ml.created_at))
                          LIMIT 1) AS delivery_status,
                        (SELECT ml.updated_at FROM message_logs ml
                          WHERE ml.context = 'asm_enquiry'
                            AND ml.reference_id = l.customer_phone COLLATE utf8mb4_unicode_ci
                            AND ABS(TIMESTAMPDIFF(SECOND, l.sent_at, ml.created_at)) <= 15
                          ORDER BY ABS(TIMESTAMPDIFF(SECOND, l.sent_at, ml.created_at))
                          LIMIT 1) AS delivery_updated_at,
                        vd.store_name AS store_name,
                        /*
                         * Whether the customer opened the store details.
                         *
                         * Matched on the lead id, which that send passes as its
                         * reference — unlike the ASM notification, which has no
                         * per-lead id to key on and has to be matched on time.
                         */
                        (SELECT ms.status FROM message_logs ms
                          WHERE ms.context = 'customer_store_details'
                            AND ms.reference_id = l.id COLLATE utf8mb4_unicode_ci
                          ORDER BY ms.created_at DESC LIMIT 1) AS store_msg_status,
                        /* The store's own "new lead" alert, when an admin sent
                           an IVR or hand-added lead a store. */
                        (SELECT ma.status FROM message_logs ma
                          WHERE ma.context = 'store_lead'
                            AND ma.reference_id = l.id COLLATE utf8mb4_unicode_ci
                          ORDER BY ma.created_at DESC LIMIT 1) AS store_alert_status
                   FROM leads l
                   LEFT JOIN asms a ON a.id = l.asm_id
                   /* vendor_details was created with a different default
                      collation than leads, so the ids cannot be compared
                      without saying which one to use. */
                   LEFT JOIN vendor_details vd
                          ON vd.id = l.store_id COLLATE utf8mb4_unicode_ci
                   ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                  ORDER BY l.created_at DESC`,
                params
            );
            /*
             * Every ASM, for the filter — the roster, not only those who
             * already have leads.
             *
             * Sourcing it from the leads meant a newly added ASM was absent
             * from their own filter until someone happened to enquire from
             * their state, which is exactly when an admin wants to check
             * whether anything is reaching them.
             *
             * Never filtered by the active query: narrowing the options to the
             * current result would leave the dropdown holding only the ASM
             * already selected, with no way back to the others.
             */
            const [asmOptions]: any = await db.execute(
                `SELECT a.id, a.name, a.is_active,
                        (SELECT COUNT(*) FROM leads l WHERE l.asm_id = a.id) AS lead_count
                   FROM asms a
                  ORDER BY a.is_active DESC, a.name`
            );

            // IVR leads carry their calls in raw_payload; the screen gets them read.
            for (const row of rows) row.ivr = row.source === 'ivr' ? summariseIvr(row.raw_payload) : null;

            await attachRouting(rows);

            /* The pincode the customer gave (WhatsApp and Instagram ask for one;
               an auditor may add it to an IVR lead), the district it sits in,
               and the area as typed when it is more than that pincode. */
            for (const row of rows) {
                row.pincode = leadPincode(row.raw_payload, row.raw_area);
                row.area_text = areaText(row.raw_area);
                row.district = null;
            }
            const pins = [...new Set(rows.map((r: any) => r.pincode).filter(Boolean))] as string[];
            if (pins.length) {
                const [places]: any = await db.execute(
                    `SELECT pincode, MIN(district) AS district FROM pincode_geo
                      WHERE pincode IN (${pins.map(() => '?').join(',')}) GROUP BY pincode`,
                    pins
                );
                const districtOf = new Map<string, string>(places.map((p: any) => [String(p.pincode), p.district]));
                for (const row of rows) {
                    const d = row.pincode ? districtOf.get(row.pincode) : null;
                    row.district = d && d !== 'NA' ? titleCase(d) : null;
                }
            }

            for (const row of rows) row.stage = leadStage(row);

            /*
             * Search across everything the row shows — pincode, district, ASM,
             * and the stores and distributors it went to — over every lead in
             * the range, not only the page on screen.
             */
            const needle = String(q ?? '').trim().toLowerCase();
            const searched = needle
                ? rows.filter((r: any) => [
                    r.customer_phone, r.customer_name, r.raw_area, r.pincode, r.district, r.state,
                    r.car_model, r.matched_area, r.asm_name, r.store_name,
                    ...(r.routing?.recipients ?? []).map((x: any) => x.name),
                ].some(v => String(v ?? '').toLowerCase().includes(needle)))
                : rows;

            /*
             * The stores that received leads in this range, for the Store
             * filter — offered before that filter applies, so picking one
             * does not leave it the only option.
             */
            const storeCount = new Map<string, { id: string; name: string; count: number }>();
            for (const r of searched) {
                for (const s of leadStores(r)) {
                    const e = storeCount.get(s.id) ?? { ...s, count: 0 };
                    e.count++;
                    storeCount.set(s.id, e);
                }
            }
            const storeOptions = [...storeCount.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

            // The states leads came from in this range, most first — the same way.
            const stateCount = new Map<string, number>();
            for (const r of searched) if (r.state) stateCount.set(r.state, (stateCount.get(r.state) ?? 0) + 1);
            const stateOptions = [...stateCount].map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

            // Who has it, which store, and — for the IVR — whether anybody answered.
            const passes = (r: any, withVehicle: boolean) => {
                if (forwarded_to) {
                    const kinds = forwardKinds(r);
                    if (forwarded_to === 'none' ? kinds.length > 0 : !kinds.includes(forwarded_to)) return false;
                }
                if (store && !leadStores(r).some(s => s.id === store)) return false;
                if (ivr_call && r.ivr?.status !== ivr_call) return false;
                if (state && (state === 'none' ? Boolean(r.state) : r.state !== state)) return false;
                if (withVehicle && vehicle && (vehicle === '2w') !== isTwoWheeler(r)) return false;
                return true;
            };
            const found = searched.filter((r: any) => passes(r, true));

            /* Each tile group counts with every filter but its own — so picking
               Mats does not turn the other product tiles to zero. */
            const byStage = (r: any) => !stage || r.stage === stage;
            const byProduct = (r: any) => !product || (product === 'none' ? !r.product : r.product === product);
            const bySource = (r: any) => !source || r.source === source;
            const tally = (list: any[], key: (r: any) => string) =>
                list.reduce((acc: Record<string, number>, r: any) => {
                    const k = key(r);
                    acc[k] = (acc[k] ?? 0) + 1;
                    return acc;
                }, {});
            const stageBase = found.filter((r: any) => byProduct(r) && bySource(r));
            const productBase = found.filter((r: any) => byStage(r) && bySource(r));
            const sourceBase = found.filter((r: any) => byStage(r) && byProduct(r));
            const matching = found.filter((r: any) => byStage(r) && byProduct(r) && bySource(r));

            const counts = {
                total: stageBase.length,
                stage: Object.fromEntries(LEAD_STAGES.map(s => [s, 0])),
                product: { 'Seat Covers': 0, Mats: 0, Accessories: 0, none: 0 } as Record<string, number>,
                channel: Object.fromEntries(CHART_CHANNELS.map(c => [c, 0])) as Record<string, number>,
                review_pending: matching.filter((r: any) => !r.review_status).length,
                // The Vehicle pills: every other filter, not its own.
                vehicle: (() => {
                    const base = searched.filter((r: any) => passes(r, false) && byStage(r) && byProduct(r) && bySource(r));
                    const two = base.filter(isTwoWheeler).length;
                    return { '4w': base.length - two, '2w': two };
                })(),
            };
            Object.assign(counts.stage, tally(stageBase, r => r.stage));
            Object.assign(counts.product, tally(productBase, r => r.product || 'none'));
            Object.assign(counts.channel, tally(sourceBase, r => r.source));

            // The Analytics page wants the numbers, not the leads.
            const chartsOnly = String(req.query.charts_only ?? '') === '1';
            // Its charts: the same leads the list would show, every filter applied.
            const charts = chartsOnly ? buildLeadCharts(matching.map((r: any) => ({
                ist_day: r.ist_day ?? null,
                source: r.source,
                product: r.product,
                state: r.state,
                asm_id: r.asm_id,
                asm_name: r.asm_name,
                review_status: r.review_status,
                forward_kinds: forwardKinds(r),
                stores: leadStores(r),
            }))) : undefined;

            const cap = Math.min(Number(limit) || 200, 1000);
            res.json({
                success: true,
                leads: chartsOnly ? [] : matching.slice(0, cap),
                charts,
                // How many matched, when that is more than the page shows.
                matched: matching.length,
                counts,
                asms: asmOptions,
                stores: storeOptions,
                states: stateOptions,
            });
        } catch (error: any) {
            console.error('List leads error:', error);
            res.status(500).json({ error: 'Failed to load leads' });
        }
    }
}
