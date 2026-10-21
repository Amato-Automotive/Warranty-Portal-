/**
 * Every WhatsApp a lead set off, in words, for the Edit lead dialog: what went
 * to the customer, the store, the ASM or support, and how far each got.
 *
 * message_logs records the template and the recipient, not the text, so what
 * a message said is read from its template — and, for the locator's free-form
 * replies, from what the locator offered this lead (a list of stores, the
 * ASM's number, …). Free of any database import, so it can be tested; the
 * controller fetches the logs.
 */

import { phoneTail } from './leadRouting.js';

export interface LoggedMessage {
    /** Our chat logs its questions as "chat:car-question" and the like. */
    context?: string | null;
    template_name: string | null;
    recipient_phone: string | null;
    status: string | null;
    error_message: string | null;
    created_at: string | Date;
    updated_at: string | Date | null;
}

export interface LeadMessage {
    at: string;
    updatedAt: string | null;
    to: 'customer' | 'store' | 'asm' | 'support' | 'distributor' | 'other';
    /** Who, by name where known. */
    toName: string;
    phone: string | null;
    what: string;
    status: string | null;
    error: string | null;
}

export interface MessageContext {
    customerPhone: string;
    /** What the store locator offered this lead, when it went through the locator. */
    offered: string | null;
    asm: { name: string; phone: string | null } | null;
    support: { name: string; phone: string | null };
    /** Stores and distributors by the last ten digits of their phone. */
    contacts: Map<string, { name: string; kind: 'store' | 'distributor' }>;
}

/** What the locator's free-form reply to the customer said, from what it offered. */
const LOCATOR_TEXT: Record<string, string> = {
    stores: 'Details of the store they picked',
    distributor: 'Details of the distributor they picked',
    asm: "The ASM's contact",
    support: "Customer support's contact",
    'invalid-pincode': 'Asked for a valid pincode',
};

/* What each of our chat's messages asked or said (locatorConversation.service). */
const CHAT_TEXT: Record<string, string> = {
    'vehicle-question': 'Asked: 4-wheeler or 2-wheeler',
    'vehicle-retry': 'Asked again: 4-wheeler or 2-wheeler',
    'two-wheeler': "2-wheeler: sent the Customer Executive's number",
    'product-menu': 'Sent the product menu',
    'other-menu': 'Sent the Other Products menu',
    'product-retry': 'Asked them to pick from the menu',
    'car-question': 'Asked which car they have',
    'car-retry': 'Asked for the car again (answer not a car)',
    'pincode-question': 'Asked for their pincode',
    'pincode-retry': 'Asked for the pincode again (not valid)',
    'please-type': 'Asked them to type the answer',
    cancelled: 'Chat cancelled by the customer',
    'gave-up': 'No valid pincode: told the team will call',
    error: 'Error on our side: told the team will call',
};

const iso = (d: string | Date | null) => (d ? new Date(d).toISOString() : null);

export function describeMessage(m: LoggedMessage, ctx: MessageContext): LeadMessage {
    const template = String(m.template_name ?? '');
    const tail = phoneTail(m.recipient_phone);
    const base = {
        at: iso(m.created_at)!,
        updatedAt: iso(m.updated_at),
        phone: m.recipient_phone,
        status: m.status,
        error: m.error_message,
    };

    // Our own chat's questions, by the tag each is logged under.
    const chat = String(m.context ?? '').startsWith('chat:') ? String(m.context).slice(5) : null;
    if (chat) return { ...base, to: 'customer', toName: 'Customer', what: CHAT_TEXT[chat] ?? 'Chat message' };

    /* The template decides first: on a test the customer's number can be the
       store's own, and an alert to it is still the store's alert. */
    if (template === 'af_customer_store_details') {
        return { ...base, to: 'customer', toName: 'Customer', what: 'Store details, sent by an admin' };
    }
    if (template === 'session:InteractiveList') {
        return {
            ...base, to: 'customer', toName: 'Customer',
            what: ctx.offered === 'distributor' ? 'List of distributors to pick from' : 'List of nearby stores to pick from',
        };
    }
    if (template === 'session:Text') {
        return { ...base, to: 'customer', toName: 'Customer', what: LOCATOR_TEXT[ctx.offered ?? ''] ?? 'Reply' };
    }

    if (template.startsWith('af_asm_enquiry')) {
        return { ...base, to: 'asm', toName: ctx.asm?.name ?? 'ASM', what: 'New enquiry alert' };
    }

    // af_support_lead_alert is retired (never approved); kept so old log rows still read as support's.
    if (template === 'af_support_lead_alert'
        ||(tail && tail === phoneTail(ctx.support.phone) && template === 'af_franchise_lead_transfer')) {
        return { ...base, to: 'support', toName: ctx.support.name, what: 'New lead alert' };
    }

    if (template === 'af_franchise_lead_transfer') {
        const who = tail ? ctx.contacts.get(tail) : undefined;
        return {
            ...base,
            to: who?.kind ?? 'store',
            toName: who?.name ?? 'Store',
            what: 'New lead alert',
        };
    }

    if (tail && tail === phoneTail(ctx.customerPhone)) {
        return { ...base, to: 'customer', toName: 'Customer', what: template || 'Message' };
    }
    return { ...base, to: 'other', toName: m.recipient_phone ?? 'Unknown', what: template || 'Message' };
}

export function describeMessages(logs: LoggedMessage[], ctx: MessageContext): LeadMessage[] {
    return logs
        .map(m => describeMessage(m, ctx))
        .sort((a, b) => a.at.localeCompare(b.at));
}
