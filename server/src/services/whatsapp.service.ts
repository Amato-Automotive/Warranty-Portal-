import axios from 'axios';
import https from 'https';
import db from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { isContextEnabled, getNotificationSettings, NOTIFICATION_TYPES } from './notificationSettings.service.js';

dotenv.config();

/*
 * One HTTP client for Interakt that keeps its connections open. Without it
 * every message opened a fresh TLS connection first — a few hundred ms on
 * each bot reply, before Interakt even saw the message.
 */
const interakt = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true, keepAliveMsecs: 30_000, maxSockets: 25 }),
    timeout: 20_000,
});

export interface CampaignProgress {
    campaignId: string;
    totalRecipients: number;
    processed: number;
    status: 'running' | 'completed' | 'aborted';
}

/**
 * Service to handle all WhatsApp Business API communications via Interakt
 * API Docs: https://www.interakt.shop/resource-center/how-to-send-whatsapp-templates-using-apis-webhooks/
 */
export class WhatsAppService {
    private static readonly API_URL = 'https://api.interakt.ai/v1/public/message/';
    private static readonly API_KEY = process.env.INTERAKT_API_KEY;

    private static activeCampaign: CampaignProgress | null = null;

    static getCampaignProgress(campaignId: string): CampaignProgress | null {
        if (this.activeCampaign && this.activeCampaign.campaignId === campaignId) {
            return this.activeCampaign;
        }
        return null;
    }

    /**
     * Splits a phone number into countryCode and phoneNumber for Interakt's format.
     * Interakt requires: countryCode: "+91", phoneNumber: "9876543210" (no country code, no leading 0)
     */
    private static formatPhoneNumber(phone: string): { countryCode: string; phoneNumber: string } {
        // Remove all non-numeric characters except leading +
        let cleaned = phone.replace(/[^\d+]/g, '');

        // If starts with +91
        if (cleaned.startsWith('+91')) {
            return { countryCode: '+91', phoneNumber: cleaned.substring(3) };
        }

        // If starts with 91 and is 12 digits
        if (cleaned.startsWith('91') && cleaned.length === 12) {
            return { countryCode: '+91', phoneNumber: cleaned.substring(2) };
        }

        // If starts with 0 and is 11 digits (Indian format with leading 0)
        if (cleaned.startsWith('0') && cleaned.length === 11) {
            return { countryCode: '+91', phoneNumber: cleaned.substring(1) };
        }

        // If it's exactly 10 digits, assume Indian number
        if (cleaned.length === 10) {
            return { countryCode: '+91', phoneNumber: cleaned };
        }

        // Fallback: return as-is with +91 default
        return { countryCode: '+91', phoneNumber: cleaned };
    }

    /**
     * Generic function to send a WhatsApp template message via Interakt
     */
    private static async sendTemplateMessage(
        phone: string,
        templateName: string,
        bodyValues: string[],
        context: string,
        referenceId?: string,
        buttonValues?: string[],  // For templates with variable buttons (e.g., OTP copy button)
        headerValues?: string[],  // For templates with text or media (image/video) headers
        campaignId?: string,      // Groups messages belonging to the same broadcast run
        dateContext?: string | Date | null  // Warranty date checked against the type's send window, if it has one
    ): Promise<boolean> {
        const logId = uuidv4();
        const { countryCode, phoneNumber } = this.formatPhoneNumber(phone);

        // Admin toggle gate — on/off, and for a type with a configured send
        // window, in/out of date range. Checked here rather than at each call
        // site so no sender can bypass it. Skipped messages are logged as
        // 'failed' with a clear reason so the admin UI can show them as
        // suppressed, not broken.
        try {
            const allowed = await isContextEnabled(context, dateContext);
            if (!allowed) {
                const settings = await getNotificationSettings();
                const toggledOff = settings[NOTIFICATION_TYPES.find(t => t.context === context)?.key ?? ''] === false;
                const reason = toggledOff ? 'Skipped: disabled by admin' : 'Skipped: outside configured send window';
                console.log(`[WhatsApp] Skipped "${templateName}" — ${reason.replace('Skipped: ', '')}.`);
                await this.logMessage({
                    id: logId,
                    recipient_phone: `${countryCode}${phoneNumber}`,
                    channel: 'whatsapp',
                    template_name: templateName,
                    status: 'failed',
                    context,
                    reference_id: referenceId,
                    error_message: reason,
                    campaign_id: campaignId
                });
                return false;
            }
        } catch (gateErr) {
            // A settings failure must never block messaging — fail open.
            console.error('[WhatsApp] Toggle check failed, allowing send:', gateErr);
        }

        if (!this.API_KEY) {
            console.error('[WhatsApp] Configuration missing. Set INTERAKT_API_KEY in .env');
            await this.logMessage({
                id: logId,
                recipient_phone: `${countryCode}${phoneNumber}`,
                channel: 'whatsapp',
                template_name: templateName,
                status: 'failed',
                context,
                reference_id: referenceId,
                error_message: 'INTERAKT_API_KEY not configured',
                campaign_id: campaignId
            });
            return false;
        }

        try {
            const payload: any = {
                countryCode,
                phoneNumber,
                type: 'Template',
                callbackData: referenceId ? `${context}_${referenceId}` : context,
                template: {
                    name: templateName,
                    languageCode: 'en',
                }
            };

            // Only include bodyValues if there are variables in the template.
            // Interakt rejects values containing tabs, newlines, or 3+ consecutive spaces.
            if (bodyValues.length > 0) {
                payload.template.bodyValues = bodyValues.map(val =>
                    String(val)
                        .replace(/[\t\r\n\u00A0\u2000-\u200B\u202F\u205F\u3000]+/g, ' ')
                        .replace(/ {3,}/g, '  ')
                        .trim()
                );
            }

            // Include buttonValues if the template has variable buttons (e.g., OTP copy button)
            // Interakt expects format: { "0": ["value"], "1": ["value"] }
            if (buttonValues && buttonValues.length > 0) {
                const buttonValuesObj: Record<string, string[]> = {};
                buttonValues.forEach((val, index) => {
                    buttonValuesObj[String(index)] = [String(val)];
                });
                payload.template.buttonValues = buttonValuesObj;
            }

            // Include headerValues for templates with a text header variable or a dynamic media
            // (image/video/document) header. For image headers, headerValues[0] is the public image URL.
            if (headerValues && headerValues.length > 0) {
                payload.template.headerValues = headerValues;
            }

            const response = await interakt.post(
                this.API_URL,
                payload,
                {
                    headers: {
                        'Authorization': `Basic ${this.API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log(`[WhatsApp] Sent "${templateName}" to ${countryCode}${phoneNumber} — ID: ${response.data?.id}`);

            await this.logMessage({
                id: logId,
                recipient_phone: `${countryCode}${phoneNumber}`,
                channel: 'whatsapp',
                template_name: templateName,
                status: 'sent',
                context,
                reference_id: referenceId,
                interakt_message_id: response.data?.id || null,
                campaign_id: campaignId
            });

            return true;
        } catch (error: any) {
            const errMsg = error.response?.data?.message || error.response?.data?.error || error.message;
            console.error(`[WhatsApp] Failed to send "${templateName}" to ${countryCode}${phoneNumber}:`, errMsg);

            await this.logMessage({
                id: logId,
                recipient_phone: `${countryCode}${phoneNumber}`,
                channel: 'whatsapp',
                template_name: templateName,
                status: 'failed',
                context,
                reference_id: referenceId,
                error_message: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg),
                campaign_id: campaignId
            });

            return false;
        }
    }

    // ---------------------------------------------------------------------------
    // Admin Broadcast kill-switch
    // ---------------------------------------------------------------------------

    /** Set to true mid-broadcast to stop sending any further messages. */
    private static broadcastAborted = false;

    /** Call this to immediately halt any in-progress admin broadcast. */
    static abortBroadcast(): void {
        this.broadcastAborted = true;
        console.warn('[WhatsApp] Admin broadcast ABORTED by admin request.');
    }

    /**
     * Sends a broadcast announcement to a list of franchise phone numbers.
     *
     * Template selection:
     *   • imageUrl provided  → af_admin_broadcast_img_2  (Marketing, image header)
     *   • imageUrl absent    → af_admin_broadcast_2  (Utility, no header)
     *
     * Sends are throttled at 200 ms per phone to stay within Interakt rate limits.
     * Can be stopped mid-flight by calling WhatsAppService.abortBroadcast().
     *
     * @param phones   - Array of raw phone numbers (any format; formatPhoneNumber handles normalisation)
     * @param title    - Announcement heading (used as text header on the text-only template)
     * @param message  - Announcement body (truncated to 1000 chars if too long)
     * @param imageUrl - Optional publicly-accessible HTTPS image URL
     * @param pregeneratedCampaignId - Optional override for campaign ID
     * @returns        - { sent, failed, aborted } counts
     */
    static async sendAdminBroadcast(
        phones: string[],
        title: string,
        message: string,
        imageUrl?: string,
        pregeneratedCampaignId?: string
    ): Promise<{ sent: number; failed: number; aborted: boolean; campaignId?: string }> {
        const MAX_MESSAGE_LENGTH = 1000;

        // Reset kill-switch for this new broadcast run
        this.broadcastAborted = false;

        // Generate or use pre-generated campaign_id to group all messages in this broadcast
        const campaignId = pregeneratedCampaignId || uuidv4();

        this.activeCampaign = {
            campaignId,
            totalRecipients: phones.length,
            processed: 0,
            status: 'running'
        };

        // Sanitise inputs — Interakt rejects tabs, newlines, and 3+ consecutive spaces
        // in template body variable values. All whitespace collapsed to spaces.
        const sanitise = (val: string) =>
            String(val)
                .replace(/[\t\r\n\u00A0\u2000-\u200B\u202F\u205F\u3000]+/g, ' ')
                .replace(/ {3,}/g, '  ')
                .trim();

        const cleanTitle   = sanitise(title);
        const rawMessage   = sanitise(message);
        const cleanMessage = rawMessage.length > MAX_MESSAGE_LENGTH
            ? rawMessage.substring(0, MAX_MESSAGE_LENGTH - 1) + '\u2026'  // …
            : rawMessage;

        const useImageTemplate = !!(imageUrl && imageUrl.trim());
        const templateName     = useImageTemplate ? 'af_admin_broadcast_img_2' : 'af_admin_broadcast_2';

        // headerValues:
        //   image template → [imageUrl]  (Interakt passes this as the dynamic media header)
        //   text  template → no header (subject/title removed as per user request)
        const headerValues = useImageTemplate ? [imageUrl!.trim()] : undefined;
        const bodyValues   = [cleanMessage];

        let sent   = 0;
        let failed = 0;

        for (const phone of phones) {
            // Check kill-switch before every send
            if (this.broadcastAborted) {
                console.warn(`[WhatsApp] Broadcast aborted after ${sent} sent, ${phones.length - sent - failed} remaining.`);
                if (this.activeCampaign) this.activeCampaign.status = 'aborted';
                break;
            }

            if (!phone || !phone.trim()) {
                if (this.activeCampaign) this.activeCampaign.processed++;
                continue;
            }

            const ok = await this.sendTemplateMessage(
                phone,
                templateName,
                bodyValues,
                'admin_broadcast',
                undefined,   // no referenceId for broadcasts
                undefined,   // no buttonValues
                headerValues,
                campaignId
            );

            ok ? sent++ : failed++;
            if (this.activeCampaign) this.activeCampaign.processed++;

            // Throttle: 200 ms between sends to avoid Interakt rate limits
            if (phones.indexOf(phone) < phones.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        if (this.activeCampaign && this.activeCampaign.status === 'running') {
            this.activeCampaign.status = 'completed';
        }

        console.log(`[WhatsApp] Admin broadcast complete — sent: ${sent}, failed: ${failed}, aborted: ${this.broadcastAborted}, template: ${templateName}, campaign: ${campaignId}`);
        return { sent, failed, aborted: this.broadcastAborted, campaignId };
    }


    /**
     * Send a free-form reply: text, a list, or reply buttons.
     *
     * Not a template, so it needs no Meta approval — but WhatsApp only delivers
     * one within 24 hours of the customer's last message. Use it to answer a
     * customer who has just written to us, never to start a conversation.
     *
     * Not behind the admin notification toggles: those switch off whole kinds
     * of outbound template messages, and this is a reply the customer asked
     * for. Callers that need a switch carry their own.
     */
    static async sendSessionMessage(
        phone: string,
        type: 'Text' | 'InteractiveList' | 'InteractiveButton',
        data: Record<string, unknown>,
        context: string,
        referenceId?: string
    ): Promise<boolean> {
        const logId = uuidv4();
        const { countryCode, phoneNumber } = this.formatPhoneNumber(phone);
        const label = `session:${type}`;

        if (!this.API_KEY) {
            console.error('[WhatsApp] Configuration missing. Set INTERAKT_API_KEY in .env');
            await this.logMessage({
                id: logId, recipient_phone: `${countryCode}${phoneNumber}`, channel: 'whatsapp',
                template_name: label, status: 'failed', context, reference_id: referenceId,
                error_message: 'INTERAKT_API_KEY not configured',
            });
            return false;
        }

        const started = Date.now();
        try {
            const response = await interakt.post(
                this.API_URL,
                {
                    countryCode,
                    phoneNumber,
                    type,
                    callbackData: referenceId ? `${context}_${referenceId}` : context,
                    data,
                },
                { headers: { 'Authorization': `Basic ${this.API_KEY}`, 'Content-Type': 'application/json' } }
            );
            console.log(`[WhatsApp] Sent ${type} (${context}) to ${countryCode}${phoneNumber} in ${Date.now() - started} ms — ID: ${response.data?.id}`);
            void this.logMessage({
                id: logId, recipient_phone: `${countryCode}${phoneNumber}`, channel: 'whatsapp',
                template_name: label, status: 'sent', context, reference_id: referenceId,
                interakt_message_id: response.data?.id || null,
            });
            return true;
        } catch (error: any) {
            const errMsg = error.response?.data?.message || error.response?.data?.error || error.message;
            console.error(`[WhatsApp] Failed to send ${type} (${context}) to ${countryCode}${phoneNumber}:`, errMsg);
            await this.logMessage({
                id: logId, recipient_phone: `${countryCode}${phoneNumber}`, channel: 'whatsapp',
                template_name: label, status: 'failed', context, reference_id: referenceId,
                error_message: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg),
            });
            return false;
        }
    }

    /**
     * Logs communication activity to the database
     */
    private static async logMessage(data: any): Promise<void> {
        try {
            await db.execute(
                `INSERT INTO message_logs 
        (id, recipient_phone, recipient_email, channel, template_name, status, context, reference_id, error_message, interakt_message_id, campaign_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    data.id,
                    data.recipient_phone || null,
                    data.recipient_email || null,
                    data.channel,
                    data.template_name || null,
                    data.status,
                    data.context,
                    data.reference_id || null,
                    data.error_message || null,
                    data.interakt_message_id || null,
                    data.campaign_id || null
                ]
            );
        } catch (err) {
            console.error('[WhatsApp] Failed to log message:', err);
        }
    }

    // ─── PUBLIC METHODS (signatures unchanged) ───────────────────────

    /**
     * Send Login OTP
     * Template: fms_login_otp — Variables: body {{1}} = OTP, button[0] = OTP (copy button)
     */
    static async sendLoginOTP(phone: string, name: string, otp: string): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'fms_login_otp',
            [otp],         // body {{1}} = OTP
            'login_auth',
            undefined,
            [otp]          // button[0] = OTP (copy code button)
        );
    }

    /**
     * Send Warranty Submitted Confirmation
     * Template: af_warranty_submitted_2
     * Variables:
     *   {{1}} = Customer Name
     *   {{2}} = Product Name (e.g. "AquaShield Premium Seat Cover")
     *   {{3}} = Vehicle Registration Number
     *   {{4}} = UID / Serial Number
     *   {{5}} = Product Type (e.g. "Seat Cover", "Paint Protection Film")
     *   {{6}} = Registration Date (DD-MMM-YYYY)
     */
    static async sendWarrantySubmitted(
        phone: string,
        customerName: string,
        productName: string,
        registrationNumber: string,
        uid: string,
        productType: string,
        purchaseDate: string,
        warrantyId: string
    ): Promise<boolean> {
        // Format product type label
        const productTypeLabel = productType === 'seat-cover' ? 'Seat Cover'
            : productType === 'ev-products' ? 'Paint Protection Film'
                : productType;

        // Format date as DD-MMM-YYYY using a safe manual formatter.
        // NOTE: toLocaleDateString('en-IN') can produce non-breaking spaces (\u00A0)
        // or locale-specific separators on some Node.js/ICU versions which WhatsApp rejects.
        const _d = new Date(purchaseDate);
        const _months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const formattedDate = `${String(_d.getDate()).padStart(2, '0')}-${_months[_d.getMonth()]}-${_d.getFullYear()}`;

        return this.sendTemplateMessage(
            phone,
            'af_warranty_submitted_2',
            [customerName, productName, registrationNumber, uid, productTypeLabel, formattedDate],
            'warranty_submitted',
            warrantyId
        );
    }

    /**
     * Welcome message to vendor after OTP verification on registration.
     * Template: af_vendor_welcome
     *   {{1}} = Vendor Name
     * Static message: "Welcome to Autoform India, our team will review and confirm
     * your store and your profile will be activated."
     */
    static async sendVendorWelcome(
        phone: string,
        vendorName: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'af_vendor_welcome',
            [vendorName],
            'vendor_welcome'
        );
    }

    /**
     * Notify customer their warranty has been approved by admin.
     * Template: af_warranty_approved_customer
     *   {{1}} = Customer Name
     *   {{2}} = Product Name
     *   {{3}} = Registration Number
     *   {{4}} = UID
     *   {{5}} = Store Name
     *   {{6}} = Status (e.g. "Approved")
     *   {{7}} = Purchase Date
     *   {{8}} = Warranty Type
     */
    static async sendWarrantyApprovedCustomer(
        phone: string,
        customerName: string,
        productName: string,
        registrationNumber: string,
        uid: string,
        storeName: string,
        status: string,
        purchaseDate: string,
        warrantyType: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'af_warranty_approved_customer',
            [customerName, productName, registrationNumber, uid, storeName, status, purchaseDate, warrantyType],
            'warranty_approved_customer',
            uid
        );
    }

    /**
     * Notify the INSTALLER (manpower) that a warranty they fitted was approved.
     * Template: af_manpower_warranty_approved_2
     *   {{1}} = Installer Name
     *   {{2}} = Product Name
     *   {{3}} = Customer Name
     *   {{4}} = Approved warranties for this installer, INCLUDING this one — but
     *           scoped to the send window configured for this type when one is
     *           set (validated_at, not created_at), not their lifetime total.
     *           The template text itself ("Total approved installations") is
     *           fixed and Meta-approved, so it cannot say "this month" — a
     *           running scheme should still show its own count, not a career
     *           number that reads as though the scheme had been running for
     *           years.
     *
     * Full text:
     *   "Hi {{1}}
     *    Good news! The warranty for {{2}} installed by you has been approved
     *    for the customer {{3}}. Credited to your profile
     *    Total approved installations: {{4}}"
     *
     * Gated by the 'manpower_warranty_approved' admin toggle, and by an
     * optional admin-set date range checked against `registeredAt` — the
     * warranty's registration date, not today's date, so the range describes
     * which warranties qualify rather than when the button happened to be
     * clicked.
     */
    static async sendManpowerWarrantyApproved(
        phone: string,
        installerName: string,
        productName: string,
        customerName: string,
        uid: string,
        totalApproved: number | string,
        registeredAt?: string | Date | null
    ): Promise<boolean> {
        // Names are stored with inconsistent casing ("SAGAR PATEL", "Jayesh bhai"),
        // so normalise them here rather than shouting at the recipient.
        const titleCase = (s: string) =>
            String(s || '')
                .toLowerCase()
                .replace(/\b[a-z]/g, ch => ch.toUpperCase());

        return this.sendTemplateMessage(
            phone,
            'af_manpower_warranty_approved_2',
            [titleCase(installerName), productName, titleCase(customerName), String(totalApproved)],
            'manpower_warranty_approved',
            uid,
            undefined,
            undefined,
            undefined,
            registeredAt
        );
    }

    /**
     * Notify customer their warranty has been rejected by admin.
     * Template: af_cust_warr_rejec_2
     *   {{1}} = Customer Name
     *   {{2}} = Product Name
     *   {{3}} = Registration Number
     *   {{4}} = UID
     *   {{5}} = Store Name
     *   {{6}} = Status (e.g. "Rejected")
     *   {{7}} = Purchase Date
     *   {{8}} = Warranty Type
     *   {{9}} = Rejection Reason
     */
    /**
     * Tell an ASM what head office did with their expense claim: decided it,
     * changed the decision, or paid it.
     *
     * Template: af_asm_expense_update (ASM_EXPENSE_TEMPLATE overrides), values
     * from expenseUpdateValues() in asmExpenseRules:
     *   {{1}} ASM name  {{2}} Claim number  {{3}} What happened
     *   {{4}} Claimed   {{5}} Approved      {{6}} Note or reason
     * Off by default (asm_expense_update toggle) until Interakt approves it.
     */
    static async sendAsmExpenseUpdate(phone: string, values: string[], claimId: string): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            process.env.ASM_EXPENSE_TEMPLATE || 'af_asm_expense_update',
            values,
            'asm_expense_update',
            claimId
        );
    }

    /**
     * Tell an ASM about a customer enquiry in their area.
     *
     * The enquiry reaches us from two places — a customer messaging us directly,
     * or an Instagram ad form — but the message out is identical, because by
     * this point all that matters is the area and who covers it.
     */
    static async sendAsmEnquiry(
        phone: string,
        asmName: string,
        customerName: string,
        customerPhone: string,
        area: string,
        receivedAt: string,
        product?: string | null,
        car?: string | null,
        leadNumber?: number
    ): Promise<boolean> {
        // "rohini, delhi" -> "Rohini, Delhi". The previous version uppercased
        // every letter, which shouted ROHINI, DELHI at the ASM.
        const titleCase = (s: string) =>
            String(s || '')
                .toLowerCase()
                .replace(/\b[a-z]/g, ch => ch.toUpperCase());

        /*
         * The seven-field alert, the same shape as the store and support ones:
         *   {{1}} ASM name   {{2}} Customer phone   {{3}} Location
         *   {{4}} Product    {{5}} Vehicle          {{6}} Date of enquiry
         *   {{7}} Lead number — this ASM's nth lead this month
         * No customer name: the workflow rarely has one.
         */
        if (leadNumber) {
            const newShape = [
                titleCase(asmName) || 'Team',
                customerPhone,
                titleCase(area) || 'Not provided',
                product || 'Not specified',
                car || 'Not specified',
                receivedAt,
                String(leadNumber),
            ];
            /*
             * It was approved as an edit of af_asm_enquiry_v2 in September
             * 2026 (every old six-field send then failed with "expected number
             * of values are 7"). A separate af_asm_lead_alert was planned but
             * never created, and trying it first logged a failed alert next to
             * every real one — the lead screen then showed the ASM alert as
             * failed. It is tried only if ASM_LEAD_TEMPLATE names one.
             */
            const names = [...new Set([
                ...(process.env.ASM_LEAD_TEMPLATE ? [process.env.ASM_LEAD_TEMPLATE] : []),
                process.env.ASM_ENQUIRY_TEMPLATE || 'af_asm_enquiry',
            ])];
            for (const name of names) {
                if (await this.sendTemplateMessage(phone, name, newShape, 'asm_enquiry', customerPhone)) return true;
            }
        }

        /*
         * The approved `af_asm_enquiry` has four variables and no slot for the
         * product line. Meta does not allow variables to be added to a live
         * template, so until a five-variable version is approved the product
         * rides along inside the area field.
         *
         * Set ASM_ENQUIRY_TEMPLATE=af_asm_enquiry_v2 once that clears review and
         * the product gets its own line, no code change needed. Either way the
         * lead row carries `product` as a real column, so the bifurcated
         * reporting the team asked for never depended on the template.
         */
        const template = process.env.ASM_ENQUIRY_TEMPLATE || 'af_asm_enquiry';
        const label = titleCase(area);

        const variables = template.endsWith('_v2')
            ? [
                  titleCase(customerName) || 'Not provided',
                  customerPhone,
                  product || 'Not specified',
                  car || 'Not specified',
                  label,
                  receivedAt,
              ]
            : [
                  titleCase(customerName) || 'Not provided',
                  customerPhone,
                  product ? `${label} - ${product}` : label,
                  receivedAt,
              ];

        return this.sendTemplateMessage(
            phone,
            template,
            variables,
            'asm_enquiry',
            customerPhone
        );
    }

    /**
     * Give a customer the store nearest them.
     *
     * Sent by an admin from the lead screen, once they have decided which store
     * to point the customer at. One store, not a list: this arrives on a phone
     * and gets read in a glance, and a numbered list of three addresses is
     * harder to act on than a single name with a number under it.
     *
     * Template: af_customer_store_details
     *   {{1}} Store name
     *   {{2}} Full address
     *   {{3}} Phone number
     *
     * Returns whether it went, like every other send here. The delivery state
     * afterwards is read from message_logs, which the Interakt webhook keeps
     * current — so the admin can see whether the customer actually opened it.
     */
    static async sendCustomerStoreDetails(
        customerPhone: string,
        storeName: string,
        address: string,
        storePhone: string,
        leadId?: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            customerPhone,
            'af_customer_store_details',
            [storeName, address, storePhone],
            'customer_store_details',
            leadId
        );
    }


    /**
     * Tell a store a customer picked it from the WhatsApp store locator.
     *
     * Template: af_franchise_lead_transfer (header "New Lead Alert!"),
     * overridable with STORE_LEAD_TEMPLATE should a revised version replace it.
     *   {{1}} Store name
     *   {{2}} Customer phone
     *   {{3}} Product
     *   {{4}} Vehicle
     *   {{5}} Date of enquiry
     *   {{6}} Lead number — this store's nth lead this month ("Lead: #3")
     *
     * Only ever called while the locator is live; the customer's own reply is
     * unaffected either way.
     */
    static async sendStoreLead(
        storePhone: string,
        storeName: string,
        customerPhone: string,
        product: string | null,
        car: string | null,
        receivedAt: string,
        leadNumber: number,
        leadId?: string
    ): Promise<boolean> {
        const template = process.env.STORE_LEAD_TEMPLATE || 'af_franchise_lead_transfer';
        return this.sendTemplateMessage(
            storePhone,
            template,
            [
                storeName.trim(),
                customerPhone,
                product || 'Not specified',
                car || 'Not specified',
                receivedAt,
                String(leadNumber),
            ],
            'store_lead',
            leadId
        );
    }

    /**
     * Tell customer support about a lead nobody else could take — no store, ASM
     * or distributor near the customer.
     *
     * Template: af_support_lead_alert (header "New Support Lead!"),
     * overridable with SUPPORT_LEAD_TEMPLATE.
     *   {{1}} Customer phone   {{2}} Location   {{3}} Product
     *   {{4}} Vehicle          {{5}} Date of enquiry
     *   {{6}} Lead number — support's nth lead this month
     * No customer name: the workflow does not reliably have one.
     *
     * Returns false if the send fails — including while the template is still
     * awaiting Meta's approval — so the caller can fall back to the store alert.
     */
    static async sendSupportLead(
        supportPhone: string,
        customerPhone: string,
        location: string,
        product: string | null,
        car: string | null,
        receivedAt: string,
        leadNumber: number,
        leadId?: string
    ): Promise<boolean> {
        const template = process.env.SUPPORT_LEAD_TEMPLATE || 'af_support_lead_alert';
        return this.sendTemplateMessage(
            supportPhone,
            template,
            [
                customerPhone,
                location || 'Not provided',
                product || 'Not specified',
                car || 'Not specified',
                receivedAt,
                String(leadNumber),
            ],
            'support_lead',
            leadId
        );
    }

    static async sendWarrantyRejectedCustomer(
        phone: string,
        customerName: string,
        productName: string,
        registrationNumber: string,
        uid: string,
        storeName: string,
        status: string,
        purchaseDate: string,
        warrantyType: string,
        rejectionReason: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'af_cust_warr_rejec_2',
            [customerName, productName, registrationNumber, uid, storeName, status, purchaseDate, warrantyType, rejectionReason],
            'warranty_rejected_customer',
            uid
        );
    }

    /**
     * Notify franchise vendor their submitted warranty was rejected by admin.
     * Template: af_vendor_warr_rejected
     *   {{1}} = Store Name
     *   {{2}} = Product Name
     *   {{3}} = Registration Number
     *   {{4}} = UID
     *   {{5}} = Status (e.g. "Not Approved")
     *   {{6}} = Purchase Date
     *   {{7}} = Warranty Type
     *   {{8}} = Rejection Reason
     */
    static async sendVendorRejected(
        phone: string,
        storeName: string,
        productName: string,
        registrationNumber: string,
        uid: string,
        status: string,
        purchaseDate: string,
        warrantyType: string,
        rejectionReason: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'af_vendor_warr_rejected',
            [storeName, productName, registrationNumber, uid, status, purchaseDate, warrantyType, rejectionReason],
            'vendor_rejected',
            uid
        );
    }

    /**
     * Remind a customer that HO did not accept their warranty and it still
     * needs correcting.
     *
     * Template: af_war_rej_reminder_cust
     * Deliberately the same variable order as af_cust_warr_rejec_2 (the
     * original rejection notice) with one addition, so the template can be
     * duplicated in Interakt and reworded rather than built from scratch:
     *   {{1}} Customer Name      {{6}} Status
     *   {{2}} Product Name       {{7}} Purchase Date
     *   {{3}} Registration No.   {{8}} Warranty Type
     *   {{4}} UID                {{9}} Rejection Reason
     *   {{5}} Store Name        {{10}} Days since rejection   <-- new
     */
    static async sendWarrantyRejectReminderCustomer(
        phone: string,
        customerName: string,
        productName: string,
        registrationNumber: string,
        uid: string,
        storeName: string,
        status: string,
        purchaseDate: string,
        warrantyType: string,
        rejectionReason: string,
        daysSinceRejection: string,
        // A test send passes its own context. That context is not in the
        // registry, so it bypasses the admin on/off toggle (an explicit test
        // should work while the type is still switched off) and its
        // message_logs rows stay out of the real 30-day stats.
        contextOverride?: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'af_war_rej_reminder_cust',
            [customerName, productName, registrationNumber, uid, storeName, status,
             purchaseDate, warrantyType, rejectionReason, daysSinceRejection],
            contextOverride || 'warranty_reject_reminder_customer',
            uid
        );
    }

    /**
     * Remind a store that one of its warranties is still rejected and unfixed.
     *
     * Template: af_war_rej_reminder_fran
     * Mirrors af_vendor_warr_rejected, plus the days count:
     *   {{1}} Store Name         {{5}} Status
     *   {{2}} Product Name       {{6}} Purchase Date
     *   {{3}} Registration No.   {{7}} Warranty Type
     *   {{4}} UID                {{8}} Rejection Reason
     *                            {{9}} Days since rejection   <-- new
     */
    static async sendWarrantyRejectReminderStore(
        phone: string,
        storeName: string,
        productName: string,
        registrationNumber: string,
        uid: string,
        status: string,
        purchaseDate: string,
        warrantyType: string,
        rejectionReason: string,
        daysSinceRejection: string,
        contextOverride?: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'af_war_rej_reminder_fran',
            [storeName, productName, registrationNumber, uid, status,
             purchaseDate, warrantyType, rejectionReason, daysSinceRejection],
            contextOverride || 'warranty_reject_reminder_store',
            uid
        );
    }

    /**
     * Send Franchise Verification Request
     * Template: franchise_verify_action
     * Variables:
     *   {{1}} = Franchise Store Name
     *   {{2}} = Customer Name
     *   {{3}} = Customer Phone
     *   {{4}} = Vehicle Registration Number
     *   {{5}} = Product Name
     *   {{6}} = UID
     * Buttons: Quick Replies — "Approve Installation" / "Reject Installation" (static)
     */
    static async sendFranchiseVerifyAction(
        phone: string,
        franchiseName: string,
        customerName: string,
        customerPhone: string,
        registrationNumber: string,
        productName: string,
        uid: string,
        warrantyId: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'franchise_verify_action',
            [franchiseName, customerName, customerPhone, registrationNumber, productName, uid],
            'franchise_verify',
            warrantyId
        );
    }

    /**
     * Send Warranty Submission Authorization OTP
     * Template: warranty_auth_otp — Variables: {{1}} = registrant, {{2}} = product, {{3}} = OTP
     */
    static async sendWarrantyAuthOTP(
        phone: string,
        registrantType: string,
        productType: string,
        otp: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'warranty_auth_otp',
            [registrantType, productType, otp],
            'warranty_auth'
        );
    }

    /**
     * Send Warranty Submission Confirmation
     * Template: warranty_confirmed — Variables: {{1}} = name, {{2}} = UID, {{3}} = product, {{4}} = car
     */
    static async sendWarrantyConfirmation(
        phone: string,
        name: string,
        uid: string,
        product: string,
        car: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'warranty_confirmed',
            [name, uid, product, car],
            'warranty_confirm',
            uid
        );
    }

    /**
     * Confirm to franchise vendor that they approved an installation (webhook response)
     * Simple acknowledgement — template TBD, using a basic utility template for now.
     * TODO: Create a dedicated Interakt template for this if needed.
     */
    static async sendFranchiseVerifyConfirmed(
        phone: string,
        franchiseName: string,
        customerName: string,
        warrantyId: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'franchise_verify_approved',
            [],   // No variables — static template
            'franchise_verify_confirmed',
            warrantyId
        );
    }

    /**
     * Confirm to franchise vendor that they rejected an installation (webhook response)
     * Template: franchise_verify_rejected — no variables
     */
    static async sendFranchiseVerifyRejected(
        phone: string,
        franchiseName: string,
        customerName: string,
        warrantyId: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'franchise_verify_rejected',
            [],   // No variables — static template
            'franchise_verify_rejected',
            warrantyId
        );
    }

    /**
     * Notify franchise vendor they already responded to this verification.
     * Template: franchise_verify_responded — no variables (static)
     * Fires when vendor taps a button on a warranty already approved/rejected.
     * TODO: swap template name once Meta approves 'franchise_verify_responded'
     */
    static async sendFranchiseVerifyResponded(
        phone: string,
        warrantyId: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'franchise_verify_responded',
            [],
            'franchise_verify_responded',
            warrantyId
        );
    }

    /**
     * Send Warranty Approval
     * Template: warranty_approved — Variables: {{1}} = name, {{2}} = UID, {{3}} = product, {{4}} = link
     */
    static async sendWarrantyApproval(
        phone: string,
        name: string,
        uid: string,
        product: string,
        certLink: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'warranty_approved',
            [name, uid, product, certLink],
            'warranty_approve',
            uid
        );
    }

    /**
     * Send Warranty Rejection
     * Template: warranty_rejected — Variables: {{1}} = name, {{2}} = UID, {{3}} = reason, {{4}} = link
     */
    static async sendWarrantyRejection(
        phone: string,
        name: string,
        uid: string,
        reason: string,
        editLink: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'warranty_rejected',
            [name, uid, reason, editLink],
            'warranty_reject',
            uid
        );
    }

    /**
     * Send Installation Confirmation Request to Franchise
     * Template: installation_confirm — Variables: {{1}} = vendor, {{2}} = customer, {{3}} = car, {{4}} = link
     */
    static async sendInstallationConfirmation(
        phone: string,
        vendorName: string,
        customerName: string,
        carDetails: string,
        confirmLink: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'installation_confirm',
            [vendorName, customerName, carDetails, confirmLink],
            'install_confirm'
        );
    }

    /**
     * Send Grievance Assignment to Assignee
     * Template: grievance_assigned — Variables: {{1}} = assignee, {{2}} = ticketId, {{3}} = category
     */
    static async sendGrievanceAssignment(
        phone: string,
        assigneeName: string,
        ticketId: string,
        category: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'grievance_assigned',
            [assigneeName, ticketId, category],
            'grievance_assign',
            ticketId
        );
    }

    /**
     * Send Grievance Status Update to Customer/Franchise
     * Template: grievance_status_update — Variables: {{1}} = name, {{2}} = ticketId, {{3}} = status
     */
    static async sendGrievanceUpdate(
        phone: string,
        name: string,
        ticketId: string,
        status: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'grievance_status_update',
            [name, ticketId, status],
            'grievance_update',
            ticketId
        );
    }

    /**
     * New Registration Welcome
     * Template: welcome_registration — Variables: {{1}} = name, {{2}} = warrantyId
     */
    static async sendPublicWelcome(
        phone: string,
        name: string,
        warrantyId: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'welcome_registration',
            [name, warrantyId],
            'registrant_welcome',
            warrantyId
        );
    }

    /**
     * Notify the FRANCHISE that their store order was placed.
     * Template: af_order_placed_franchise
     *   Body:
     *     {{1}} = Franchise contact/store name
     *     {{2}} = Order ID
     *     {{3}} = Distributor name (who it was placed with)
     *     {{4}} = Total quantity (units)
     *     {{5}} = Item count (number of products)
     *   Buttons (dynamic-URL, register these in the Interakt template):
     *     Button 0 "Download Invoice" — base URL `<APP_URL>/api/orders/`, dynamic suffix = invoiceUrlSuffix
     *     Button 1 "Manage Orders"   — static URL to the dashboard/login (no dynamic value needed)
     */
    static async sendOrderPlacedFranchise(
        phone: string,
        franchiseName: string,
        orderId: string,
        distributorName: string,
        totalQuantity: number | string,
        itemCount: number | string,
        invoiceUrlSuffix?: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'af_order_placed_franchise',
            [franchiseName, orderId, distributorName, String(totalQuantity), String(itemCount)],
            'order_placed_franchise',
            orderId,
            invoiceUrlSuffix ? [invoiceUrlSuffix] : undefined
        );
    }

    /**
     * Notify the DISTRIBUTOR that a new order came in from a franchise.
     * Template: af_order_received_distributor
     *   Body:
     *     {{1}} = Distributor name
     *     {{2}} = Order ID
     *     {{3}} = Franchise store name (who placed it)
     *     {{4}} = Total quantity (units)
     *     {{5}} = Item count (number of products)
     *   Buttons (dynamic-URL, register these in the Interakt template):
     *     Button 0 "Download Invoice" — base URL `<APP_URL>/api/orders/`, dynamic suffix = invoiceUrlSuffix
     *     Button 1 "Manage Orders"   — static URL to the dashboard/login (no dynamic value needed)
     */
    static async sendOrderReceivedDistributor(
        phone: string,
        distributorName: string,
        orderId: string,
        franchiseName: string,
        totalQuantity: number | string,
        itemCount: number | string,
        invoiceUrlSuffix?: string
    ): Promise<boolean> {
        return this.sendTemplateMessage(
            phone,
            'af_order_received_distributor',
            [distributorName, orderId, franchiseName, String(totalQuantity), String(itemCount)],
            'order_received_distributor',
            orderId,
            invoiceUrlSuffix ? [invoiceUrlSuffix] : undefined
        );
    }
}
