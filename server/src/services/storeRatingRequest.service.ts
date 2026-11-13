import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { WhatsAppService } from './whatsapp.service.js';
import { isContextEnabled } from './notificationSettings.service.js';
import { refreshRatingSummary } from './storeRatings.service.js';
import { requestIdFromCallback, starsFromButton } from './storeRatingButtons.js';

/**
 * Asking customers to rate their store.
 *
 * 24 hours after a warranty is approved the customer gets the
 * store_experience_rating template, whose buttons are the stars. Their tap
 * comes back on the webhook and becomes one row in store_ratings, tied to the
 * warranty, so a warranty is rated once and only by someone who bought.
 *
 * Found by looking at the warranties, not by hooking each place a warranty is
 * approved, so every approval route is covered. Only warranties approved
 * 24 to 48 hours ago are asked: switching the message on must not message
 * everyone approved last month.
 */

const CONTEXT = 'store_experience_rating';
const BATCH = 40;

export async function runStoreRatingRequests(): Promise<number> {
    if (process.env.DISABLE_SCHEDULERS === '1' || process.env.ENABLE_WHATSAPP !== 'true') return 0;
    if (!(await isContextEnabled(CONTEXT))) return 0;

    const [due]: any = await db.execute(
        `SELECT wr.uid, wr.customer_name, wr.customer_phone, wr.product_type, wr.vendor_details_id, vd.store_name
           FROM warranty_registrations wr
           JOIN vendor_details vd ON vd.id = wr.vendor_details_id
          WHERE wr.status = 'validated'
            AND wr.validated_at <= NOW() - INTERVAL 24 HOUR
            AND wr.validated_at > NOW() - INTERVAL 48 HOUR
            AND wr.customer_phone IS NOT NULL AND wr.customer_phone <> ''
            AND NOT EXISTS (SELECT 1 FROM store_rating_requests q WHERE q.warranty_uid = wr.uid)
            AND NOT EXISTS (SELECT 1 FROM store_ratings sr WHERE sr.warranty_uid = wr.uid)
          ORDER BY wr.validated_at LIMIT ${BATCH}`
    );

    let sent = 0;
    for (const w of due) {
        const id = uuidv4();
        /* The row is written first: the unique key on the warranty means a second run can never ask the same customer twice. */
        const [r]: any = await db.execute(
            `INSERT IGNORE INTO store_rating_requests (id, warranty_uid, store_id, customer_name, customer_phone, product, status)
             VALUES (?, ?, ?, ?, ?, ?, 'sending')`,
            [id, w.uid, String(w.vendor_details_id), w.customer_name ?? null, w.customer_phone, w.product_type ?? null]
        );
        if (!r.affectedRows) continue;
        try {
            const ok = await WhatsAppService.sendStoreExperienceRating(w.customer_phone, String(w.customer_name || 'there').trim(), String(w.store_name || 'your store').trim(), id);
            await db.execute("UPDATE store_rating_requests SET status = ?, sent_at = NOW() WHERE id = ?", [ok ? 'sent' : 'failed', id]);
            if (ok) sent++;
        } catch (e: any) {
            await db.execute("UPDATE store_rating_requests SET status = 'failed', error = ? WHERE id = ?", [String(e?.message ?? e).slice(0, 250), id]);
        }
    }
    if (due.length) console.log(`[Ratings] asked ${sent} of ${due.length} customers to rate their store`);
    return sent;
}

/**
 * A tap on one of the template's buttons. Saves the rating once; a second tap,
 * an unreadable button or a request we do not know is ignored. Returns whether
 * a rating was saved.
 */
export async function recordRatingTap(callbackData: unknown, buttonLabel: unknown): Promise<boolean> {
    const requestId = requestIdFromCallback(callbackData);
    if (!requestId) return false;
    const stars = starsFromButton(buttonLabel);
    if (stars === null) {
        console.warn(`[Ratings] could not read stars from button "${String(buttonLabel ?? '')}" (request ${requestId})`);
        return false;
    }
    const [[q]]: any = await db.execute('SELECT * FROM store_rating_requests WHERE id = ?', [requestId]);
    if (!q) return false;
    /* Only the first tap counts: a customer who tries the other buttons afterwards changes nothing. */
    if (q.status === 'rated') return false;
    const [r]: any = await db.execute(
        `INSERT IGNORE INTO store_ratings (id, store_id, warranty_uid, customer_name, customer_phone, stars, product) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), q.store_id, q.warranty_uid, q.customer_name, q.customer_phone, stars, q.product]
    );
    if (!r.affectedRows) return false;
    await db.execute("UPDATE store_rating_requests SET status = 'rated', rated_at = NOW() WHERE id = ?", [requestId]);
    await refreshRatingSummary(String(q.store_id));
    console.log(`[Ratings] ${stars} star(s) for store ${q.store_id}, warranty ${q.warranty_uid}`);
    return true;
}
