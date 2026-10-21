import db from '../config/database.js';
import { WhatsAppService } from './whatsapp.service.js';
import { isContextEnabled } from './notificationSettings.service.js';
import { formatDateIST } from '../utils/dateUtils.js';

/**
 * Reminders for warranties HO rejected and nobody has fixed.
 *
 * A rejected warranty is a dead end unless someone corrects and resubmits it.
 * Most never are — the customer sees one rejection message and forgets, and the
 * store has no list of what it owes. This chases both, on a schedule the admin
 * controls.
 *
 * Two rules decide who is chased, and both matter more than they look:
 *
 *  1. HO rejections only (`rejected_by = 'admin'`). A dealer who rejected an
 *     installation themselves must never receive "please correct this", and the
 *     customer must never be told the company refused something their own
 *     dealer declined. Rows the migration could not attribute are left NULL
 *     and are still chased — every rejection written since carries
 *     rejected_by, so only a handful of historical rows are affected.
 *
 *  2. Skip anything already resubmitted. A correction lands in
 *     `warranty_resubmissions` as `pending_review` and the original row *stays*
 *     `rejected`, so the obvious query would keep chasing the people who
 *     already did what was asked.
 */

export const WARRANTY_REMINDER_SETTINGS_KEY = 'warranty_reminders';

export interface WarrantyReminderSettings {
    /** Master switch for the daily job. The one-time catch-up ignores this. */
    enabled: boolean;
    /** Days after rejection before the first reminder. */
    firstReminderAfterDays: number;
    /** Days between reminders after the first. */
    repeatEveryDays: number;
    /** Total reminders any one warranty may ever receive. */
    maxReminders: number;
    /**
     * When the one-time catch-up over the existing backlog was run.
     *
     * Null means it has not run. The daily job stays parked until it has:
     * switching the scheduler on with a backlog present would otherwise fire
     * every overdue reminder at once, unattended, on the first tick.
     */
    initialRunAt: string | null;
}

const DEFAULTS: WarrantyReminderSettings = {
    enabled: false,
    firstReminderAfterDays: 7,
    repeatEveryDays: 7,
    maxReminders: 3,
    initialRunAt: null,
};

/** Pause between messages so a large catch-up does not burst at Interakt. */
const SEND_SPACING_MS = 250;

export interface ReminderProgress {
    mode: 'initial' | 'scheduled';
    total: number;
    processed: number;
    sent: number;
    failed: number;
    skipped: number;
    status: 'running' | 'completed' | 'aborted';
    startedAt: string;
}

let activeRun: ReminderProgress | null = null;
let abortRequested = false;

export function getReminderProgress(): ReminderProgress | null {
    return activeRun;
}

export function abortReminderRun(): boolean {
    if (activeRun && activeRun.status === 'running') {
        abortRequested = true;
        return true;
    }
    return false;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getReminderSettings(): Promise<WarrantyReminderSettings> {
    try {
        const [rows]: any = await db.execute(
            'SELECT setting_value FROM system_settings WHERE setting_key = ?',
            [WARRANTY_REMINDER_SETTINGS_KEY]
        );
        if (rows.length > 0 && rows[0].setting_value) {
            const stored = JSON.parse(rows[0].setting_value);
            return { ...DEFAULTS, ...stored };
        }
    } catch (err) {
        console.error('[WarrantyReminder] Could not load settings, using defaults:', err);
    }
    return { ...DEFAULTS };
}

/** Clamped so a mistyped value cannot turn the job into a daily mass-send. */
function sanitise(input: Partial<WarrantyReminderSettings>): Partial<WarrantyReminderSettings> {
    const out: Partial<WarrantyReminderSettings> = {};
    const num = (v: any, min: number, max: number) => {
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
    };

    if (input.enabled !== undefined) out.enabled = Boolean(input.enabled);

    const first = num(input.firstReminderAfterDays, 1, 180);
    if (first !== undefined) out.firstReminderAfterDays = first;

    const repeat = num(input.repeatEveryDays, 1, 180);
    if (repeat !== undefined) out.repeatEveryDays = repeat;

    const max = num(input.maxReminders, 1, 10);
    if (max !== undefined) out.maxReminders = max;

    return out;
}

export async function saveReminderSettings(
    updates: Partial<WarrantyReminderSettings>,
    updatedBy: string
): Promise<WarrantyReminderSettings> {
    const current = await getReminderSettings();
    const next = { ...current, ...sanitise(updates) };

    await db.execute(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
        [WARRANTY_REMINDER_SETTINGS_KEY, JSON.stringify(next), updatedBy]
    );

    return next;
}

async function markInitialRunComplete(): Promise<void> {
    const current = await getReminderSettings();
    await db.execute(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [
            WARRANTY_REMINDER_SETTINGS_KEY,
            JSON.stringify({ ...current, initialRunAt: new Date().toISOString() }),
            'system'
        ]
    );
}

// ─── Finding who is due ──────────────────────────────────────────────────────

/**
 * The store behind a warranty, by the store id it carries (see
 * services/warrantyStore.ts) — never by name, which another store can share.
 */
const STORE_JOIN = `
    LEFT JOIN vendor_details vd_s ON vd_s.id = w.vendor_details_id
    LEFT JOIN profiles store_p ON vd_s.user_id = store_p.id
`;

/**
 * Rows that may ever be chased, before any timing rule is applied.
 * Both exclusions in the file header live here.
 */
// A dealer's own rejection is never chased. NULL is still allowed through for
// the handful of historical rows the backfill could not attribute — every
// rejection written since carries rejected_by, so nothing new lands here.
const ELIGIBLE_WHERE = `
    w.status = 'rejected'
    AND (w.rejected_by = 'admin' OR w.rejected_by IS NULL)
    AND NOT EXISTS (
        SELECT 1 FROM warranty_resubmissions r
        WHERE r.original_uid = w.uid AND r.status = 'pending_review'
    )
`;

const SELECT_COLUMNS = `
    w.uid, w.customer_name, w.customer_phone, w.registration_number,
    w.product_type, w.warranty_type, w.purchase_date, w.rejection_reason,
    w.product_details, w.reminder_count,
    COALESCE(w.rejected_at, w.created_at) AS rejected_on,
    DATEDIFF(NOW(), COALESCE(w.rejected_at, w.created_at)) AS days_since_rejection,
    vd_s.store_name AS store_name,
    store_p.phone_number AS store_phone
`;

interface DueWarranty {
    uid: string;
    customer_name: string;
    customer_phone: string | null;
    registration_number: string;
    product_type: string;
    warranty_type: string | null;
    purchase_date: string | null;
    rejection_reason: string | null;
    product_details: any;
    reminder_count: number;
    rejected_on: string;
    days_since_rejection: number;
    store_name: string | null;
    store_phone: string | null;
}

/**
 * Warranties due a reminder.
 *
 * `initial` waives the age threshold so the existing backlog is picked up in
 * one pass; `scheduled` applies the full timing rules.
 */
export async function findDueWarranties(
    mode: 'initial' | 'scheduled',
    settings: WarrantyReminderSettings
): Promise<DueWarranty[]> {
    const timing = mode === 'initial'
        ? 'AND w.reminder_count = 0'
        : `AND DATEDIFF(NOW(), COALESCE(w.rejected_at, w.created_at)) >= ?
           AND w.reminder_count < ?
           AND (w.last_reminder_at IS NULL OR DATEDIFF(NOW(), w.last_reminder_at) >= ?)`;

    const params = mode === 'initial'
        ? []
        : [settings.firstReminderAfterDays, settings.maxReminders, settings.repeatEveryDays];

    const [rows]: any = await db.execute(
        `SELECT ${SELECT_COLUMNS}
         FROM warranty_registrations w
         ${STORE_JOIN}
         WHERE ${ELIGIBLE_WHERE} ${timing}
         ORDER BY COALESCE(w.rejected_at, w.created_at) ASC`,
        params
    );

    return rows;
}

/**
 * What the one-time catch-up would do, without doing it. Shown to the admin
 * before they commit to messaging the whole backlog.
 */
export async function previewInitialRun(): Promise<{
    warranties: number;
    withCustomerPhone: number;
    withStorePhone: number;
    /** How many of the above are being chased despite an unknown rejector. */
    unclassifiedIncluded: number;
    oldestRejection: string | null;
    newestRejection: string | null;
    excluded: { dealerRejected: number; unclassified: number; alreadyResubmitted: number };
}> {
    const settings = await getReminderSettings();

    const [[summary]]: any = await db.execute(
        `SELECT COUNT(*) AS warranties,
                SUM(w.customer_phone IS NOT NULL AND w.customer_phone <> '') AS with_customer_phone,
                SUM(store_p.phone_number IS NOT NULL AND store_p.phone_number <> '') AS with_store_phone,
                SUM(w.rejected_by IS NULL) AS unclassified_included,
                MIN(COALESCE(w.rejected_at, w.created_at)) AS oldest,
                MAX(COALESCE(w.rejected_at, w.created_at)) AS newest
         FROM warranty_registrations w
         ${STORE_JOIN}
         WHERE ${ELIGIBLE_WHERE} AND w.reminder_count = 0`
    );

    const [[excluded]]: any = await db.execute(
        `SELECT
            SUM(w.rejected_by = 'vendor') AS dealer_rejected,
            SUM(w.rejected_by IS NULL) AS unclassified,
            SUM(EXISTS (
                SELECT 1 FROM warranty_resubmissions r
                WHERE r.original_uid = w.uid AND r.status = 'pending_review'
            )) AS already_resubmitted
         FROM warranty_registrations w
         WHERE w.status = 'rejected'`
    );

    return {
        warranties: Number(summary.warranties || 0),
        withCustomerPhone: Number(summary.with_customer_phone || 0),
        withStorePhone: Number(summary.with_store_phone || 0),
        unclassifiedIncluded: Number(summary.unclassified_included || 0),
        oldestRejection: summary.oldest || null,
        newestRejection: summary.newest || null,
        excluded: {
            dealerRejected: Number(excluded.dealer_rejected || 0),
            unclassified: Number(excluded.unclassified || 0),
            alreadyResubmitted: Number(excluded.already_resubmitted || 0),
        }
    };
}

/**
 * Whether a send would actually reach anyone right now.
 *
 * Learned the hard way: the first catch-up ran with both message types still
 * switched off, so all 172 sends were refused at the toggle gate, 0 arrived —
 * and the run still marked itself done, using up an action that only runs
 * once. Checking first turns that into a message instead of a wasted attempt.
 */
export async function preflightCheck(): Promise<{ ok: boolean; problems: string[] }> {
    const settings = await getReminderSettings();
    const problems: string[] = [];

    if (process.env.ENABLE_WHATSAPP !== 'true') {
        problems.push('WhatsApp is switched off on the server (ENABLE_WHATSAPP).');
    }

    const [toCustomer, toStore] = await Promise.all([
        isContextEnabled('warranty_reject_reminder_customer'),
        isContextEnabled('warranty_reject_reminder_store')
    ]);

    if (!toCustomer && !toStore) {
        problems.push('Both Rejection Reminder message types are switched off in WhatsApp Messages — nobody would be messaged.');
    }

    return { ok: problems.length === 0, problems };
}

/**
 * How many warranties have ever actually been reminded.
 *
 * The truth about whether the catch-up happened. `initialRunAt` alone is not
 * enough: an earlier version stamped it even when every send was refused, so
 * a set flag with a zero count means the run recorded itself but did nothing.
 */
export async function countEverReminded(): Promise<number> {
    try {
        const [[row]]: any = await db.execute(
            'SELECT COUNT(*) AS n FROM warranty_registrations WHERE reminder_count > 0'
        );
        return Number(row.n || 0);
    } catch {
        return 0;
    }
}

/** Most recent send failure for either reminder type, to explain a dead run. */
export async function lastReminderFailure(): Promise<string | null> {
    try {
        const [rows]: any = await db.execute(
            `SELECT error_message FROM message_logs
             WHERE channel = 'whatsapp' AND status = 'failed'
               AND context IN ('warranty_reject_reminder_customer', 'warranty_reject_reminder_store')
               AND error_message IS NOT NULL
             ORDER BY created_at DESC LIMIT 1`
        );
        return rows[0]?.error_message || null;
    } catch {
        return null;
    }
}

// ─── Sending ─────────────────────────────────────────────────────────────────

function productNameOf(row: DueWarranty): string {
    let details: any = {};
    try {
        details = typeof row.product_details === 'string'
            ? JSON.parse(row.product_details)
            : (row.product_details || {});
    } catch { /* a malformed blob should not stop the reminder */ }

    return details.productName
        || details.product
        || (row.product_type === 'seat-cover' ? 'Seat Cover'
            : row.product_type === 'ev-products' ? 'Paint Protection Film'
                : row.product_type)
        || 'Autoform Product';
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * Send one pass of reminders.
 *
 * Counters are advanced once per warranty, not once per message: a warranty
 * where the customer was reached but the store had no number on file has still
 * had its reminder, and must not be retried tomorrow as though nothing
 * happened.
 */
export async function runReminderPass(mode: 'initial' | 'scheduled'): Promise<ReminderProgress> {
    if (activeRun && activeRun.status === 'running') {
        return activeRun;
    }

    const settings = await getReminderSettings();
    const due = await findDueWarranties(mode, settings);

    // Who gets messaged is decided by the two message-type switches in
    // WhatsApp Messages — the same ones that gate every other send and carry
    // the delivery stats. Resolved once here rather than per warranty, so a
    // switched-off type is skipped outright instead of attempted 143 times and
    // logged as 143 failures.
    const [toCustomer, toStore] = await Promise.all([
        isContextEnabled('warranty_reject_reminder_customer'),
        isContextEnabled('warranty_reject_reminder_store')
    ]);

    abortRequested = false;
    activeRun = {
        mode,
        total: due.length,
        processed: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        status: 'running',
        startedAt: new Date().toISOString(),
    };

    console.log(`[WarrantyReminder] ${mode} pass: ${due.length} warranties due.`);

    for (const row of due) {
        if (abortRequested) {
            activeRun.status = 'aborted';
            console.warn(`[WarrantyReminder] Aborted after ${activeRun.processed}/${due.length}.`);
            break;
        }

        const productName = productNameOf(row);
        // purchase_date arrives as a Date or a string depending on the driver's
        // mood; formatDateIST only takes a Date, so normalise before calling it.
        const parsedPurchase = row.purchase_date ? new Date(row.purchase_date) : null;
        const purchaseDate = parsedPurchase && !Number.isNaN(parsedPurchase.getTime())
            ? formatDateIST(parsedPurchase)
            : 'N/A';
        const warrantyType = row.warranty_type || 'Standard';
        const reason = row.rejection_reason || 'Please review the submitted details.';
        const storeName = row.store_name || 'Autoform Store';
        const days = String(row.days_since_rejection ?? 0);
        let anySent = false;
        // Distinguishes "we had nobody to message" from "every send was
        // refused". Conflating them made a run where nothing was approved read
        // as 86 missing phone numbers.
        const hadRecipient = Boolean(
            (toCustomer && row.customer_phone) || (toStore && row.store_phone)
        );

        if (toCustomer && row.customer_phone) {
            try {
                const ok = await WhatsAppService.sendWarrantyRejectReminderCustomer(
                    row.customer_phone, row.customer_name, productName,
                    row.uid, storeName, 'Not Approved', purchaseDate, warrantyType, reason, days
                );
                ok ? activeRun.sent++ : activeRun.failed++;
                anySent = anySent || ok;
            } catch (err) {
                activeRun.failed++;
                console.error(`[WarrantyReminder] Customer reminder failed for ${row.uid}:`, err);
            }
            await sleep(SEND_SPACING_MS);
        }

        if (toStore && row.store_phone) {
            try {
                const ok = await WhatsAppService.sendWarrantyRejectReminderStore(
                    row.store_phone, storeName, productName,
                    row.uid, 'Not Approved', purchaseDate, warrantyType, reason, days
                );
                ok ? activeRun.sent++ : activeRun.failed++;
                anySent = anySent || ok;
            } catch (err) {
                activeRun.failed++;
                console.error(`[WarrantyReminder] Store reminder failed for ${row.uid}:`, err);
            }
            await sleep(SEND_SPACING_MS);
        }

        if (anySent) {
            await db.execute(
                `UPDATE warranty_registrations
                 SET reminder_count = reminder_count + 1, last_reminder_at = NOW()
                 WHERE uid = ?`,
                [row.uid]
            );
        } else if (!hadRecipient) {
            // Genuinely nobody to message. A warranty whose sends were all
            // refused is already counted under `failed`.
            activeRun.skipped++;
        }

        activeRun.processed++;
    }

    if (activeRun.status === 'running') activeRun.status = 'completed';

    // A run that delivered nothing has not caught anything up. Marking it done
    // would consume the one-time action and leave the backlog unreachable.
    if (mode === 'initial' && activeRun.status === 'completed' && activeRun.sent > 0) {
        await markInitialRunComplete();
    }

    console.log(
        `[WarrantyReminder] ${mode} pass ${activeRun.status}: ` +
        `${activeRun.sent} sent, ${activeRun.failed} failed, ${activeRun.skipped} without a number.`
    );

    return activeRun;
}

/** Contexts used only by test sends, kept out of the registry so they bypass
 *  the on/off toggle and out of the real per-type stats. */
const TEST_CONTEXT_CUSTOMER = 'warranty_reject_reminder_test_customer';
const TEST_CONTEXT_STORE = 'warranty_reject_reminder_test_store';

/**
 * Send both reminders for one real warranty to a nominated phone.
 *
 * Everything is rendered from live data — the same code path, the same
 * variables, so what arrives is exactly what a customer would get. Nobody else
 * is messaged and no counter moves, so the warranty stays due for its real
 * reminder afterwards.
 */
export async function sendTestReminder(phone: string, uid?: string): Promise<{
    uid: string;
    customerSent: boolean;
    storeSent: boolean;
}> {
    const settings = await getReminderSettings();

    let row: DueWarranty | undefined;
    if (uid) {
        const [rows]: any = await db.execute(
            `SELECT ${SELECT_COLUMNS} FROM warranty_registrations w ${STORE_JOIN} WHERE w.uid = ?`,
            [uid]
        );
        row = rows[0];
        if (!row) throw new Error(`No warranty found with UID ${uid}.`);
    } else {
        // Prefer something genuinely due, so the test reflects real data.
        const due = await findDueWarranties('initial', settings);
        row = due[0];
        if (!row) {
            const [rows]: any = await db.execute(
                `SELECT ${SELECT_COLUMNS} FROM warranty_registrations w ${STORE_JOIN}
                 WHERE w.status = 'rejected' ORDER BY COALESCE(w.rejected_at, w.created_at) DESC LIMIT 1`
            );
            row = rows[0];
        }
        if (!row) throw new Error('There are no rejected warranties to build a test message from.');
    }

    const productName = productNameOf(row);
    const parsedPurchase = row.purchase_date ? new Date(row.purchase_date) : null;
    const purchaseDate = parsedPurchase && !Number.isNaN(parsedPurchase.getTime())
        ? formatDateIST(parsedPurchase)
        : 'N/A';
    const warrantyType = row.warranty_type || 'Standard';
    const reason = row.rejection_reason || 'Please review the submitted details.';
    const storeName = row.store_name || 'Autoform Store';
    const days = String(row.days_since_rejection ?? 0);

    const customerSent = await WhatsAppService.sendWarrantyRejectReminderCustomer(
        phone, row.customer_name, productName, row.uid,
        storeName, 'Not Approved', purchaseDate, warrantyType, reason, days,
        TEST_CONTEXT_CUSTOMER
    );

    await sleep(SEND_SPACING_MS);

    const storeSent = await WhatsAppService.sendWarrantyRejectReminderStore(
        phone, storeName, productName, row.uid,
        'Not Approved', purchaseDate, warrantyType, reason, days,
        TEST_CONTEXT_STORE
    );

    return { uid: row.uid, customerSent, storeSent };
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export class WarrantyReminderScheduler {
    private static timer: NodeJS.Timeout | null = null;
    private static readonly INTERVAL_MS = 6 * 60 * 60 * 1000; // four times a day

    static start() {
        if (this.timer) return;
        console.log('🕒 Warranty Reminder Scheduler: Started');
        this.timer = setInterval(() => { void this.tick(); }, this.INTERVAL_MS);
        // No run on boot. A deploy should never be the thing that sends
        // messages — the first pass waits for the interval, or for the admin.
    }

    static stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private static async tick() {
        try {
            const settings = await getReminderSettings();

            if (!settings.enabled) return;

            // Parked until the backlog has been dealt with deliberately.
            // Without this, switching the feature on would send every overdue
            // reminder in one unattended burst.
            //
            // The flag alone is not enough: a catch-up that delivered nothing
            // still stamped it, which would let this tick pick up the entire
            // untouched backlog on its own — no preview, no confirmation, no
            // one watching. Both conditions must hold.
            if (!settings.initialRunAt || (await countEverReminded()) === 0) {
                console.log('🕒 Warranty Reminder: waiting for the one-time catch-up to be run by an admin.');
                return;
            }

            await runReminderPass('scheduled');
        } catch (err) {
            console.error('🕒 Warranty Reminder Scheduler error:', err);
        }
    }
}
