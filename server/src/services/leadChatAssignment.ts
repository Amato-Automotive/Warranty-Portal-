import axios from 'axios';
import db from '../config/database.js';
import { phoneKey } from './leadIdentity.js';

/**
 * Put lead chats in one person's Interakt inbox.
 *
 * The shared inbox mixes campaign replies, franchise traffic and enquiries,
 * and Interakt's own rules cannot tell a lead from the rest, so the sales team
 * had no view of the chats that were actually leads. Every webhook already
 * says who owns the chat (traits.chat_assignee), so the check rides on those:
 * a message in or out on an unassigned chat whose number has a recent lead is
 * assigned to INTERAKT_LEAD_AGENT_EMAIL. Unset, nothing is assigned.
 *
 * A chat someone already holds is never taken from them — whoever picked it up
 * is handling it.
 */

const ASSIGN_URL = 'https://api.interakt.ai/v1/public/assignment/';

/** A lead older than this is history, not why the customer is writing now. */
const LEAD_WINDOW_DAYS = 7;

/** Long enough for this event's own handler to have filed the lead. */
const SETTLE_MS = 5_000;

/** One attempt per number per window, whatever the outcome; the webhook fires on every message. */
const RETRY_AFTER_MS = 30 * 60_000;
const attempted = new Map<string, number>();

const EVENTS = new Set(['message_received', 'message_api_sent']);

/** The agent's email from a chat_assignee trait, which arrives as an object or a JSON string. */
export function assigneeEmail(trait: unknown): string | null {
    let v: any = trait;
    if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch { return v.includes('@') ? v.trim() : null; }
    }
    const email = v && typeof v === 'object' ? v.email : null;
    return typeof email === 'string' && email.trim() ? email.trim() : null;
}

/** Called for every Interakt webhook event; returns at once and never throws. */
export function assignLeadChatFromWebhook(eventType: string, payload: any): void {
    const agent = process.env.INTERAKT_LEAD_AGENT_EMAIL?.trim();
    if (!agent || !EVENTS.has(eventType)) return;

    const customer = payload?.data?.customer;
    if (!customer?.phone_number) return;
    if (assigneeEmail(customer.traits?.chat_assignee)) return;

    const key = phoneKey(customer.phone_number);
    if (key.length !== 10) return;
    const last = attempted.get(key);
    if (last && Date.now() - last < RETRY_AFTER_MS) return;

    const code = String(customer.country_code || '+91').replace(/\D/g, '') || '91';
    setTimeout(() => {
        void assignIfLead(key, `${code}${key}`, agent).catch(err =>
            console.error('[LeadChat] Assignment failed:', err?.message || err));
    }, SETTLE_MS).unref();
}

async function assignIfLead(key: string, fullPhone: string, agent: string) {
    const [rows]: any = await db.execute(
        `SELECT 1 FROM leads WHERE phone_key = ? AND created_at >= NOW() - INTERVAL ? DAY LIMIT 1`,
        [key, LEAD_WINDOW_DAYS]
    );
    if (!rows.length) return;

    attempted.set(key, Date.now());
    if (attempted.size > 5_000) {
        const cutoff = Date.now() - RETRY_AFTER_MS;
        for (const [k, t] of attempted) if (t < cutoff) attempted.delete(k);
    }

    const res = await axios.post(
        ASSIGN_URL,
        { user_phone_number: fullPhone, agent_email: agent },
        {
            headers: { Authorization: `Basic ${process.env.INTERAKT_API_KEY}`, 'Content-Type': 'application/json' },
            timeout: 15_000,
            validateStatus: () => true,
        }
    );
    if (res.status === 200 && res.data?.result !== false) {
        console.log(`[LeadChat] ${key} assigned to ${agent}`);
    } else if (/already assigned to same agent/i.test(String(res.data?.message))) {
        // The webhook's assignee trait can lag a moment behind; the chat is where it should be.
        console.log(`[LeadChat] ${key} already with ${agent}`);
    } else {
        console.warn(`[LeadChat] ${key} not assigned (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
    }
}
