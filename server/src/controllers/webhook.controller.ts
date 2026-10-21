import { Request, Response } from 'express';
import crypto from 'crypto';
import db from '../config/database.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { NotificationService } from '../services/notification.service.js';
import { ingestFlowAuditResponse, recordAuditSent, recordAuditDelivery } from '../services/auditResponse.service.js';
import { handleInstagramLead } from '../services/instagramLead.service.js';
import { handleLocatorReply, handlePincodeMessage, handleChooseStoreTap } from '../services/storeLocatorChat.js';
import { handleConversationMessage, startFromMessage } from '../services/locatorConversation.service.js';
import { startWord } from '../services/locatorConversation.js';
import { replyFromWebhook } from '../services/storeLocatorMessages.js';
import { assignLeadChatFromWebhook } from '../services/leadChatAssignment.js';

export class WebhookController {

    /**
     * Record an incoming webhook verbatim.
     *
     * Fire-and-forget and never throws: logging must not be able to fail the
     * webhook, or Interakt retries and later events are lost too.
     */
    private static async logRawEvent(eventType: string, payload: any) {
        try {
            const d = payload?.data ?? {};
            const m = d.message ?? {};
            await db.execute(
                `INSERT INTO webhook_events
                   (id, provider, event_type, phone, campaign_id, campaign_name, payload)
                 VALUES (UUID(), 'interakt', ?, ?, ?, ?, ?)`,
                [
                    eventType || null,
                    d.customer?.phone_number ?? m.message_context?.from ?? null,
                    m.campaign_id ?? d.campaign_id ?? null,
                    m.campaign_name ?? d.campaign_name ?? null,
                    JSON.stringify(payload ?? {}).slice(0, 60000),
                ]
            );
        } catch (error: any) {
            console.error('[Webhook] Could not log the raw event:', error?.message || error);
        }
    }

    /**
     * Is this request really from Interakt?
     *
     * The route is unauthenticated and not rate-limited, and what it does is
     * consequential: approve or reject a pending warranty as the franchise,
     * record audit replies, create leads and send paid WhatsApp templates to
     * ASMs. The HMAC used to be computed, compared against a re-serialized body
     * that could never match, logged as a mismatch, and ignored — and skipped
     * entirely when no header was sent.
     *
     * Now: HMAC-SHA256 over the raw request bytes with INTERAKT_WEBHOOK_SECRET,
     * compared in constant time. No secret configured means nothing can be
     * verified, which is treated as a failure, not a pass.
     *
     * INTERAKT_WEBHOOK_VERIFY=report processes unverified events anyway and
     * only logs them — for checking a new secret against live traffic. Leave it
     * unset in normal running.
     */
    private static checkSignature(req: Request): 'valid' | 'missing' | 'mismatch' | 'unconfigured' {
        const secret = process.env.INTERAKT_WEBHOOK_SECRET;
        if (!secret) return 'unconfigured';

        const header = req.headers['interakt-signature'];
        const signature = (Array.isArray(header) ? header[0] : header || '').trim();
        const rawBody: Buffer | undefined = (req as any).rawBody;
        if (!signature || !rawBody) return 'missing';

        const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const given = signature.replace(/^sha256=/i, '').toLowerCase();

        const a = Buffer.from(given, 'utf8');
        const b = Buffer.from(expected, 'utf8');
        return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'valid' : 'mismatch';
    }

    /**
     * Handle incoming Interakt webhook events.
     *
     * Real Interakt payload for button clicks:
     *   type: "message_api_clicked"
     *   data.message.button_text: "Approve Installation"
     *   data.message.meta_data.source_data.callback_data: "franchise_verify_<warrantyId>"
     *   data.customer.phone_number: "7827889388"
     *   data.customer.country_code: "+91"
     *   Header: interakt-signature: sha256=<hmac>
     */
    static async handleInterakt(req: Request, res: Response) {

        // Always respond 200 immediately so Interakt doesn't retry. This holds
        // for rejected events too: Interakt disables a webhook after five
        // failures in ten minutes, so answering a bad signature with a 4xx
        // would let a misconfigured secret switch off every real event. A
        // forged event is dropped below; the status code gains nothing.
        res.status(200).json({ received: true });

        try {
            const payload   = req.body;
            const eventType = payload?.type || '';

            const verdict = WebhookController.checkSignature(req);
            if (verdict !== 'valid') {
                const mode = process.env.INTERAKT_WEBHOOK_VERIFY === 'report' ? 'report' : 'enforce';
                console.warn(`[Webhook] Signature ${verdict} on '${eventType}' event (${mode} mode)${mode === 'enforce' ? ' — dropped' : ''}.`);
                if (mode === 'enforce') return;
            }

            // Log every event before anything can decide to ignore it.
            //
            // A campaign to two contacts showed both replies in Interakt but
            // only one arrived here, and with nothing recorded there was no way
            // to tell whether Interakt never sent it or we dropped it. This
            // makes that question answerable with one query instead of
            // inference.
            void WebhookController.logRawEvent(eventType, payload);

            // A lead's chat goes to the sales inbox in Interakt, if unassigned.
            assignLeadChatFromWebhook(eventType, payload);

            // Handle delivery status events
            const statusEvents = ['message_api_sent', 'message_api_delivered', 'message_api_read', 'message_api_failed'];
            if (statusEvents.includes(eventType)) {
                await WebhookController.handleDeliveryStatus(payload);
                return;
            }

            // Store audit submissions arrive as message_campaign_flow_response.
            // The payload is logged in full as well as stored: Interakt does not
            // document its shape, so a real one is worth keeping to check the
            // parser against.
            // A campaign send tells us the audit reached this store. Recording
            // each one is what makes "has not responded" answerable at all —
            // without it, a store that never replies is absent, not outstanding.
            if (eventType === 'message_campaign_sent') {
                await recordAuditSent(payload);
                return;
            }

            // The rest of the campaign funnel. Interakt's docs do not pin down
            // these names, so both plausible spellings are accepted; the handler
            // ignores anything that is not an audit campaign.
            const CAMPAIGN_DELIVERY: Record<string, 'delivered' | 'read' | 'failed'> = {
                message_campaign_delivered: 'delivered',
                message_campaign_read: 'read',
                message_campaign_failed: 'failed',
                campaign_message_delivered: 'delivered',
                campaign_message_read: 'read',
                campaign_message_failed: 'failed',
            };
            if (CAMPAIGN_DELIVERY[eventType]) {
                await recordAuditDelivery(payload, CAMPAIGN_DELIVERY[eventType]);
                return;
            }

            if (eventType === 'message_campaign_flow_response') {
                console.log(`[Webhook][audit] ${eventType}: ${JSON.stringify(payload)}`);
                await ingestFlowAuditResponse(payload);
                return;
            }

            /*
             * An Instagram lead-ad form arrives here as the customer's first
             * WhatsApp message, carrying every answer they gave. Those are
             * routed straight to an ASM rather than being asked the same
             * questions again by the workflow.
             *
             * Anything that is not a lead form falls through untouched, so an
             * ordinary "hi" still reaches the Interakt workflow as before.
             */
            if (eventType === 'message_received') {
                const message = payload?.data?.message;
                const customer = payload?.data?.customer;
                const body: string = message?.message || message?.text || '';
                const code: string = String(customer?.country_code || '+91').replace('+', '');
                const senderPhone = `${code}${customer?.phone_number || ''}`;

                /*
                 * The store locator: a tap on one of its lists, or a fresh
                 * pincode from someone already talking to it. Checked first,
                 * and each only claims a message that is unmistakably its own.
                 */
                /*
                 * An Instagram lead form before anything else: an open chat
                 * would take it for an answer, and the locator for a pincode
                 * (the form's phone number holds six digits in a row).
                 */
                if (customer?.phone_number && message?.message_content_type === 'Text') {
                    try {
                        const routed = await handleInstagramLead(body, senderPhone, payload);
                        if (routed) {
                            console.log(`[Webhook] Instagram lead from ${senderPhone} routed`);
                            return;
                        }
                    } catch (err: any) {
                        // Never let this break the webhook — Interakt disables
                        // one after five failures in ten minutes.
                        console.error('[Webhook] Instagram lead handling failed:', err?.message);
                        return;
                    }
                }

                /*
                 * Our own chat first: when it is waiting for this customer's
                 * car or pincode, the message is its answer. It claims nothing
                 * else — taps, a fresh "Heyy", or no open chat fall through.
                 */
                // A "View stores" that arrives as a message rather than a button click.
                if (customer?.phone_number && /^\s*view\s*stores?\s*$/i.test(String(message?.button_text ?? body))) {
                    try {
                        if (await handleChooseStoreTap(senderPhone, null)) return;
                    } catch (err: any) {
                        console.error('[Webhook] "View stores" handling failed:', err?.message);
                        return;
                    }
                }

                if (customer?.phone_number) {
                    try {
                        if (await handleConversationMessage(senderPhone, message)) return;
                        // "Heyy", "hi", "seat cover"… start the chat here, the
                        // moment they arrive — not ~8 s later when the workflow
                        // hands over.
                        const start = message?.message_content_type === 'Text' ? startWord(body) : null;
                        // A team number's "hi" is left for the handlers below.
                        if (start && await startFromMessage(senderPhone, customer?.traits?.name ?? null, start)) return;
                    } catch (err: any) {
                        console.error('[Webhook] Chat handling failed:', err?.message);
                        return;
                    }
                }

                if (customer?.phone_number) {
                    try {
                        const tap = replyFromWebhook(message);
                        if (tap) {
                            await handleLocatorReply(senderPhone, tap);
                            return;
                        }
                        if (message?.message_content_type === 'Text' && await handlePincodeMessage(senderPhone, body)) {
                            return;
                        }
                    } catch (err: any) {
                        console.error('[Webhook] Store locator handling failed:', err?.message);
                        return;
                    }
                }

                return;
            }

            // Only handle button click events
            if (eventType !== 'message_api_clicked') {
                console.log(`[Webhook] Ignoring event type: "${eventType}"`);
                return;
            }

            const msgData    = payload?.data?.message;
            const customer   = payload?.data?.customer;
            const buttonText: string = msgData?.button_text || '';
            const callbackData: string = msgData?.meta_data?.source_data?.callback_data || '';
            const vendorPhone: string  = customer?.phone_number || '';
            const countryCode: string  = (customer?.country_code || '+91').replace('+', '');
            const fullVendorPhone = `${countryCode}${vendorPhone}`;

            console.log(`[Webhook] Button: "${buttonText}" | callbackData: "${callbackData}" | vendor: ${fullVendorPhone}`);

            // "View stores" on af_choose_store_sheet: the customer's store list.
            if (callbackData.startsWith('choose_store_')) {
                try {
                    await handleChooseStoreTap(fullVendorPhone, callbackData.slice('choose_store_'.length) || null);
                } catch (err: any) {
                    console.error('[Webhook] "View stores" handling failed:', err?.message);
                }
                return;
            }

            // ── Determine action ──────────────────────────────────────────────
            const isApprove = buttonText.toLowerCase().includes('approve');
            const isReject  = buttonText.toLowerCase().includes('reject');

            if (!isApprove && !isReject) {
                console.log(`[Webhook] Unrecognised button: "${buttonText}" — ignoring`);
                return;
            }

            // ── Extract warrantyId from callbackData ──────────────────────────
            let warrantyId: string | null = null;
            if (callbackData.startsWith('franchise_verify_')) {
                warrantyId = callbackData.replace('franchise_verify_', '');
            }

            // Fallback: look up by vendor phone
            if (!warrantyId && vendorPhone) {
                console.warn(`[Webhook] No callbackData prefix — falling back to phone lookup`);
                const [rows]: any = await db.execute(
                    `SELECT wr.uid FROM warranty_registrations wr
                     JOIN vendor_details vd ON vd.id = wr.vendor_details_id
                     JOIN profiles p ON p.id = vd.user_id
                     WHERE p.phone_number = ? AND wr.status = 'pending_vendor'
                     ORDER BY wr.created_at DESC LIMIT 1`,
                    [vendorPhone]
                );
                if (rows.length > 0) warrantyId = rows[0].uid;
            }

            if (!warrantyId) {
                console.error(`[Webhook] Could not resolve warrantyId from: "${callbackData}"`);
                return;
            }

            // ── Check DB status first ─────────────────────────────────────────
            const [warranties]: any = await db.execute(
                `SELECT uid, customer_name, installer_name, status
                 FROM warranty_registrations WHERE uid = ?`,
                [warrantyId]
            );

            if (warranties.length === 0) {
                console.error(`[Webhook] Warranty not found: ${warrantyId}`);
                return;
            }

            const warranty = warranties[0];

            // ── Already responded — send friendly message and stop ────────────
            if (warranty.status !== 'pending_vendor') {
                console.warn(`[Webhook] Warranty ${warrantyId} already "${warranty.status}" — sending already-responded notice`);
                if (process.env.ENABLE_WHATSAPP === 'true' && fullVendorPhone) {
                    try {
                        await WhatsAppService.sendFranchiseVerifyResponded(fullVendorPhone, warrantyId);
                    } catch (err) {
                        console.error('[Webhook] Already-responded message failed:', err);
                    }
                }
                return;
            }

            // ── Process the response ──────────────────────────────────────────
            if (isApprove) {
                await WebhookController.handleApprove(warrantyId, warranty, fullVendorPhone);
            } else {
                await WebhookController.handleReject(warrantyId, warranty, fullVendorPhone);
            }

        } catch (err) {
            console.error('[Webhook] Error processing payload:', err);
        }
    }

    // ── Approve Handler ───────────────────────────────────────────────────────
    private static async handleApprove(warrantyId: string, warranty: any, vendorPhone: string) {
        await db.execute(
            `UPDATE warranty_registrations SET status = 'pending' WHERE uid = ?`,
            [warrantyId]
        );
        console.log(`[Webhook] ✅ Vendor approved ${warrantyId} — moved to admin review`);

        if (process.env.ENABLE_WHATSAPP === 'true' && vendorPhone) {
            try {
                await WhatsAppService.sendFranchiseVerifyConfirmed(vendorPhone, '', '', warrantyId);
            } catch (err) {
                console.error('[Webhook] Approval confirmation WhatsApp failed:', err);
            }
        }

        try {
            await NotificationService.broadcast({
                title: 'Warranty Verified by Franchise',
                message: `${warranty.installer_name || 'A franchise'} confirmed ${warranty.customer_name}'s installation. Ready for HQ review.`,
                type: 'warranty',
                link: `/admin/verifications?uid=${warrantyId}`,
                targetUsers: [],
                targetRole: 'admin'
            });
        } catch (err) {
            console.error('[Webhook] Admin notification failed:', err);
        }
    }

    // ── Reject Handler ────────────────────────────────────────────────────────
    private static async handleReject(warrantyId: string, warranty: any, vendorPhone: string) {
        // rejected_at and rejected_by are stamped here as well as on the admin
        // path: without them a dealer rejection is indistinguishable from an HO
        // one, and the reminder job must never chase a customer about a
        // warranty their own dealer turned down.
        await db.execute(
            `UPDATE warranty_registrations
             SET status = 'rejected',
                 rejection_reason = 'Franchise store could not confirm this installation (via WhatsApp button).',
                 rejected_at = NOW(),
                 rejected_by = 'vendor'
             WHERE uid = ?`,
            [warrantyId]
        );
        console.log(`[Webhook] ❌ Vendor rejected ${warrantyId}`);

        if (process.env.ENABLE_WHATSAPP === 'true' && vendorPhone) {
            try {
                await WhatsAppService.sendFranchiseVerifyRejected(vendorPhone, '', '', warrantyId);
            } catch (err) {
                console.error('[Webhook] Rejection confirmation WhatsApp failed:', err);
            }
        }

        try {
            await NotificationService.broadcast({
                title: 'Warranty Rejected by Franchise',
                message: `${warranty.installer_name || 'A franchise'} could not confirm ${warranty.customer_name}'s installation.`,
                type: 'warranty',
                link: `/admin/verifications?uid=${warrantyId}`,
                targetUsers: [],
                targetRole: 'admin'
            });
        } catch (err) {
            console.error('[Webhook] Admin notification failed:', err);
        }
    }

    /**
     * Update message delivery/read/failed status from webhook
     */
    private static async handleDeliveryStatus(payload: any) {
        const eventType = payload?.type || '';
        const msgData = payload?.data?.message;
        const messageId = msgData?.id;

        if (!messageId) {
            console.warn('[Webhook] Delivery status event missing message.id');
            return;
        }

        let dbStatus: 'sent' | 'delivered' | 'read' | 'failed' = 'sent';
        if (eventType === 'message_api_delivered') {
            dbStatus = 'delivered';
        } else if (eventType === 'message_api_read') {
            dbStatus = 'read';
        } else if (eventType === 'message_api_failed') {
            dbStatus = 'failed';
        } else if (eventType === 'message_api_sent') {
            dbStatus = 'sent';
        }

        const errorCode = msgData?.channel_error_code || null;
        const errorMessage = msgData?.channel_failure_reason || null;

        console.log(`[Webhook] Update delivery status for Message ID: ${messageId} -> ${dbStatus} (Code: ${errorCode})`);

        try {
            if (dbStatus === 'failed') {
                await db.execute(
                    `UPDATE message_logs 
                     SET status = ?, error_code = ?, error_message = ? 
                     WHERE interakt_message_id = ?`,
                    [dbStatus, errorCode, errorMessage, messageId]
                );
            } else {
                await db.execute(
                    `UPDATE message_logs 
                     SET status = ? 
                     WHERE interakt_message_id = ? 
                       AND status != 'read' 
                       AND (status != 'delivered' OR ? = 'read')`,
                    [dbStatus, messageId, dbStatus]
                );
            }
        } catch (err) {
            console.error('[Webhook] Failed to update delivery status in DB:', err);
        }
    }
}
