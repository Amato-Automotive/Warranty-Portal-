import { leadPincode } from './leadRouting.js';

/**
 * A store's own leads, as the store sees them in its dashboard.
 *
 * A lead is the store's when the store was actually sent it: the customer
 * picked it from the WhatsApp list (its alert is recorded in
 * raw_payload.locator.notified as "store:<id>"), or the team sent it from
 * Lead Management (leads.store_id). A store only suggested and never sent is
 * not given the lead.
 *
 * The store sees the auditor's status, never the auditor's reason or internal
 * notes, and never which other stores the customer was offered.
 *
 * Free of any database import, so the rules are tested directly.
 */

export const STORE_LEAD_STATUSES = [
    'pending', 'follow_up', 'closed_won', 'closed_lost', 'no_response',
    'call_disconnected', 'switched_off', 'number_not_working',
] as const;
export type StoreLeadStatus = typeof STORE_LEAD_STATUSES[number];

export interface StoreLeadRow {
    id: string;
    created_ist: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    product: string | null;
    car_model: string | null;
    raw_area: string | null;
    state: string | null;
    store_id: string | null;
    store_sent_by: string | null;
    review_status: string | null;
    reviewed_at: string | null;
    raw_payload: unknown;
}

export interface StoreLead {
    id: string;
    /** "2026-09-30 14:05", IST. */
    received: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    product: string | null;
    car: string | null;
    pincode: string | null;
    state: string | null;
    /** How it reached the store. */
    via: 'customer' | 'autoform';
    /** The auditor's outcome (a value from the admin's list); "pending" until someone has called. */
    status: string;
    status_at: string | null;
}

function notifiedOf(rawPayload: unknown): string[] {
    let raw: any = rawPayload;
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch { return []; }
    }
    const list = raw?.locator?.notified;
    return Array.isArray(list) ? list.map(String) : [];
}

/** Whether this lead was sent to this store. */
export function isStoresLead(row: Pick<StoreLeadRow, 'store_id' | 'raw_payload'>, storeId: string): boolean {
    if (!storeId) return false;
    if (row.store_id && String(row.store_id) === String(storeId)) return true;
    return notifiedOf(row.raw_payload).includes(`store:${storeId}`);
}

/** The lead as the store sees it, or null when it is not the store's. */
export function storeLeadView(row: StoreLeadRow, storeId: string): StoreLead | null {
    if (!isStoresLead(row, storeId)) return null;

    /* The team sent it when the lead's store is this one and an admin set it;
       otherwise the customer chose this store from the WhatsApp list. */
    const sentByTeam = String(row.store_id ?? '') === String(storeId)
        && Boolean(row.store_sent_by) && row.store_sent_by !== 'customer';

    const status = row.review_status ? String(row.review_status) : 'pending';

    return {
        id: row.id,
        received: row.created_ist,
        customer_name: row.customer_name ? String(row.customer_name).trim() || null : null,
        customer_phone: row.customer_phone,
        product: row.product,
        car: row.car_model,
        pincode: leadPincode(row.raw_payload, row.raw_area),
        state: row.state,
        via: sentByTeam ? 'autoform' : 'customer',
        status,
        status_at: status === 'pending' ? null : row.reviewed_at,
    };
}
