import db from '../config/database.js';

/**
 * Admin-controlled on/off switches for outbound WhatsApp message types.
 *
 * Why this exists: `ENABLE_WHATSAPP` is a single global env flag checked at ~11
 * call sites, so turning one message type off means an SSH + .env edit + pm2
 * restart, and any new call site can silently forget the check. These toggles
 * live in the DB instead, so an admin can flip a single message type from the
 * UI and it takes effect within CACHE_TTL_MS — no deploy.
 *
 * Precedence:  ENABLE_WHATSAPP (master kill-switch)  →  per-type toggle  →
 *              per-type date window (if the type supports one)  →  send
 *
 * Storage: one JSON row in the existing `system_settings` table, so no migration
 * is needed. A missing key falls back to the registry default.
 *
 * A second row (NOTIFICATION_WINDOWS_KEY) holds an optional start/end date per
 * type, kept separate from the boolean map above rather than folded into it —
 * every other toggle is a plain boolean today, and mixing shapes in one JSON
 * blob would mean every reader has to branch on what it finds. Only a type
 * whose registry entry sets `supportsDateWindow` is checked against this.
 */

export const NOTIFICATION_SETTINGS_KEY = 'whatsapp_notifications';
export const NOTIFICATION_WINDOWS_KEY = 'whatsapp_notification_windows';

/** One type's configured send window. Both ends optional: either can be left open. */
export interface NotificationWindow {
    /** Inclusive. ISO date (YYYY-MM-DD) compared against the warranty's date, in IST. */
    startDate: string | null;
    /** Inclusive. */
    endDate: string | null;
}

export interface NotificationType {
    /** Stable key used in the settings JSON and by the toggle API. */
    key: string;
    /** Human label shown in the admin UI. */
    label: string;
    /** UI grouping. */
    group: 'Warranty' | 'Manpower' | 'Orders' | 'Auth' | 'Broadcast' | 'ASM';
    /** Interakt template this maps to (informational — the sender still passes its own). */
    template: string;
    /** Who receives it. */
    recipient: string;
    /** `context` value written to message_logs, used to pull live stats. */
    context: string;
    /** Value used when the settings row has no entry for this key. */
    defaultEnabled: boolean;
    description: string;
    /**
     * Whether this type is checked against a stored NotificationWindow, keyed
     * on the warranty's registration date. Most types have no natural "as of"
     * date to gate on, so this defaults to false and stays opt-in.
     */
    supportsDateWindow?: boolean;
}

/**
 * The registry of controllable message types.
 *
 * Interakt has no template-listing API, so this list cannot be discovered at
 * runtime — it is the source of truth for what the admin UI renders.
 *
 * Existing message types default to ON so behaviour is unchanged by shipping
 * this. New types whose template is not yet Meta-approved default to OFF.
 */
export const NOTIFICATION_TYPES: NotificationType[] = [
    {
        key: 'manpower_warranty_approved',
        label: 'Installer — Warranty Approved',
        group: 'Manpower',
        template: 'af_manpower_warranty_approved_2',
        recipient: 'Installer (manpower) selected on the warranty',
        context: 'manpower_warranty_approved',
        // Template is approved in Interakt (confirmed 2026-09). Gated instead
        // by a date window on the warranty's registration date — see
        // NotificationWindow — so the send stops on its own at the end date
        // rather than needing someone to remember to flip this off.
        defaultEnabled: true,
        supportsDateWindow: true,
        description: 'Tells the installer their work was approved, credited to their profile, with their running total of approved installations.'
    },
    {
        key: 'warranty_approved_customer',
        label: 'Customer — Warranty Approved',
        group: 'Warranty',
        template: 'af_warranty_approved_customer',
        recipient: 'Customer',
        context: 'warranty_approved_customer',
        defaultEnabled: true,
        description: 'Confirms to the customer that their warranty is active.'
    },
    {
        key: 'warranty_rejected_customer',
        label: 'Customer — Warranty Rejected',
        group: 'Warranty',
        template: 'af_cust_warr_rejec_2',
        recipient: 'Customer',
        context: 'warranty_rejected_customer',
        defaultEnabled: true,
        description: 'Tells the customer their warranty was not approved, with the reason.'
    },
    {
        key: 'warranty_submitted',
        label: 'Customer — Warranty Submitted',
        group: 'Warranty',
        template: 'af_warranty_submitted_3',
        recipient: 'Customer',
        context: 'warranty_submitted',
        defaultEnabled: true,
        description: 'Acknowledges a newly submitted warranty registration.'
    },
    {
        key: 'warranty_reject_reminder_customer',
        label: 'Customer — Rejection Reminder',
        group: 'Warranty',
        template: 'af_war_rej_reminder_cust',
        recipient: 'Customer',
        context: 'warranty_reject_reminder_customer',
        // OFF until the template is approved in Interakt.
        defaultEnabled: false,
        description: 'Chases a customer whose warranty HO rejected and nobody has corrected yet, with the reason and how long it has been waiting.'
    },
    {
        key: 'warranty_reject_reminder_store',
        label: 'Store — Rejection Reminder',
        group: 'Warranty',
        template: 'af_war_rej_reminder_fran',
        recipient: 'Franchise store',
        context: 'warranty_reject_reminder_store',
        defaultEnabled: false,
        description: 'Chases the store about one of its warranties that HO rejected and is still uncorrected.'
    },
    {
        key: 'vendor_rejected',
        label: 'Store — Warranty Rejected',
        group: 'Warranty',
        template: 'af_vendor_warr_rejected',
        recipient: 'Franchise store',
        context: 'vendor_rejected',
        defaultEnabled: true,
        description: 'Tells the store a warranty they submitted was rejected.'
    },
    {
        key: 'franchise_verify',
        label: 'Store — Verify Installation',
        group: 'Warranty',
        template: 'franchise_verify_action2',
        recipient: 'Franchise store',
        context: 'franchise_verify',
        defaultEnabled: true,
        description: 'Asks the store to confirm or reject an installation.'
    },
    {
        key: 'order_placed_franchise',
        label: 'Store — Order Placed',
        group: 'Orders',
        template: 'af_order_placed_franchise',
        recipient: 'Franchise store',
        context: 'order_placed_franchise',
        defaultEnabled: true,
        description: 'Confirms a store order was placed.'
    },
    {
        key: 'order_received_distributor',
        label: 'Distributor — Order Received',
        group: 'Orders',
        template: 'af_order_received_distributor',
        recipient: 'Distributor',
        context: 'order_received_distributor',
        defaultEnabled: true,
        description: 'Tells the distributor a new order came in.'
    },
    {
        key: 'vendor_welcome',
        label: 'Store — Welcome',
        group: 'Auth',
        template: 'af_vendor_welcome',
        recipient: 'New franchise store',
        context: 'vendor_welcome',
        defaultEnabled: true,
        description: 'Welcomes a newly registered store.'
    },
    {
        key: 'asm_expense_update',
        label: 'ASM — Expense Claim Update',
        group: 'ASM',
        template: 'af_asm_expense_update',
        recipient: 'ASM who filed the claim',
        context: 'asm_expense_update',
        // OFF until the template is approved in Interakt.
        defaultEnabled: false,
        description: 'Tells the ASM their expense claim was approved, partly approved, rejected, changed or paid.'
    },
];

/** Login OTP is deliberately excluded — gating it would lock users out. */
export const UNGATED_CONTEXTS = new Set(['login_auth', 'warranty_auth']);

const CACHE_TTL_MS = 30_000;

let cache: Record<string, boolean> | null = null;
let cacheExpiry = 0;

let windowCache: Record<string, NotificationWindow> | null = null;
let windowCacheExpiry = 0;

function defaults(): Record<string, boolean> {
    return NOTIFICATION_TYPES.reduce((acc, t) => {
        acc[t.key] = t.defaultEnabled;
        return acc;
    }, {} as Record<string, boolean>);
}

/**
 * Reads the toggle map, falling back to registry defaults for anything missing.
 * Cached briefly so a high-volume send loop doesn't hit the DB per message.
 */
export async function getNotificationSettings(force = false): Promise<Record<string, boolean>> {
    if (!force && cache && Date.now() < cacheExpiry) return cache;

    const merged = defaults();
    try {
        const [rows]: any = await db.execute(
            'SELECT setting_value FROM system_settings WHERE setting_key = ?',
            [NOTIFICATION_SETTINGS_KEY]
        );
        if (rows.length > 0 && rows[0].setting_value) {
            const stored = JSON.parse(rows[0].setting_value);
            for (const [k, v] of Object.entries(stored)) {
                if (k in merged) merged[k] = Boolean(v);
            }
        }
    } catch (err) {
        // Never let a settings problem stop messaging — fall back to defaults.
        console.error('[NotificationSettings] Failed to load, using defaults:', err);
    }

    cache = merged;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return merged;
}

/** Persists the toggle map and drops the cache so the change applies at once. */
export async function saveNotificationSettings(
    updates: Record<string, boolean>,
    updatedBy: string
): Promise<Record<string, boolean>> {
    const current = await getNotificationSettings(true);
    const next = { ...current };
    for (const [k, v] of Object.entries(updates)) {
        if (k in next) next[k] = Boolean(v);
    }

    await db.execute(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
        [NOTIFICATION_SETTINGS_KEY, JSON.stringify(next), updatedBy]
    );

    cache = next;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return next;
}

/**
 * Reads the per-type date windows, keyed by NotificationType.key. A type with
 * no stored entry has no window, i.e. it sends regardless of date — the same
 * "opt-in" stance as the boolean toggle's registry default.
 */
export async function getNotificationWindows(force = false): Promise<Record<string, NotificationWindow>> {
    if (!force && windowCache && Date.now() < windowCacheExpiry) return windowCache;

    let windows: Record<string, NotificationWindow> = {};
    try {
        const [rows]: any = await db.execute(
            'SELECT setting_value FROM system_settings WHERE setting_key = ?',
            [NOTIFICATION_WINDOWS_KEY]
        );
        if (rows.length > 0 && rows[0].setting_value) {
            windows = JSON.parse(rows[0].setting_value);
        }
    } catch (err) {
        // A broken windows row must not stop messaging — treat it as "no window
        // configured" rather than failing every send that checks one.
        console.error('[NotificationSettings] Failed to load date windows, ignoring:', err);
        windows = {};
    }

    windowCache = windows;
    windowCacheExpiry = Date.now() + CACHE_TTL_MS;
    return windows;
}

/**
 * Persists one type's date window. Passing null for a bound clears it (open
 * end); passing null for the whole entry removes the window and the type
 * reverts to sending regardless of date.
 */
export async function saveNotificationWindow(
    key: string,
    windowValue: NotificationWindow | null,
    updatedBy: string
): Promise<Record<string, NotificationWindow>> {
    const current = await getNotificationWindows(true);
    const next = { ...current };
    if (windowValue) {
        next[key] = windowValue;
    } else {
        delete next[key];
    }

    await db.execute(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
        [NOTIFICATION_WINDOWS_KEY, JSON.stringify(next), updatedBy]
    );

    windowCache = next;
    windowCacheExpiry = Date.now() + CACHE_TTL_MS;
    return next;
}

/**
 * Whether `dateValue` (a warranty's registration date, "YYYY-MM-DD" or an
 * ISO/Date-parseable value) falls inside the stored window for `key`. No
 * window configured, or the type does not support one, means "always in
 * range" — the window is an opt-in restriction, not a requirement.
 */
export async function isWithinNotificationWindow(key: string, dateValue: string | Date | null | undefined): Promise<boolean> {
    const type = NOTIFICATION_TYPES.find(t => t.key === key);
    if (!type?.supportsDateWindow) return true;

    const windows = await getNotificationWindows();
    const win = windows[key];
    if (!win || (!win.startDate && !win.endDate)) return true;

    // No date to check against: fail closed. A window was deliberately set,
    // so a warranty missing the field it is meant to be judged on should not
    // slip through as "in range".
    if (!dateValue) return false;

    // Compare on the IST calendar date, consistent with how the admin picks
    // the range and how every other date-in-range check in this codebase
    // treats "day", not a UTC-shifted instant.
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return false;
    const istDateStr = new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

    if (win.startDate && istDateStr < win.startDate) return false;
    if (win.endDate && istDateStr > win.endDate) return false;
    return true;
}

/**
 * Whether a given message `context` may be sent right now.
 * Contexts with no registry entry are allowed through, so adding a send site
 * never silently breaks for want of a toggle.
 *
 * `referenceDate` is only consulted for a type with `supportsDateWindow`; every
 * other context ignores it, so existing callers that never pass one are
 * unaffected.
 */
export async function isContextEnabled(context: string, referenceDate?: string | Date | null): Promise<boolean> {
    if (UNGATED_CONTEXTS.has(context)) return true;

    const type = NOTIFICATION_TYPES.find(t => t.context === context);
    if (!type) return true;

    const settings = await getNotificationSettings();
    if (settings[type.key] === false) return false;

    if (type.supportsDateWindow && !(await isWithinNotificationWindow(type.key, referenceDate))) {
        return false;
    }

    return true;
}
