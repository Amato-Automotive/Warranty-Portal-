import db from '../config/database.js';
import { cleanMinRatings, showableRating, DEFAULT_MIN_RATINGS } from './storeRatingRules.js';

export { cleanMinRatings, showableRating, DEFAULT_MIN_RATINGS };

/**
 * Store ratings as customers, the website and WhatsApp see them.
 *
 * `store_rating_summary` holds each store's average and how many ratings stand
 * behind it; whatever collects the ratings keeps it up to date. An average is
 * shown only from a set number of ratings (the admin's "show the average from"
 * setting, 5 unless changed): the average of one or two ratings misleads.
 * WhatsApp shows the average alone, never the count.
 */

const SETTING_KEY = 'rating_display';

/** Where a rating shows, each on or off, and from how many ratings an average shows. */
export interface RatingDisplay { whatsapp: boolean; website: boolean; min_count: number }
const DISPLAY_DEFAULTS: RatingDisplay = { whatsapp: true, website: true, min_count: DEFAULT_MIN_RATINGS };

export async function getRatingDisplay(): Promise<RatingDisplay> {
    try {
        const [rows]: any = await db.execute('SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1', [SETTING_KEY]);
        if (!rows.length) return { ...DISPLAY_DEFAULTS };
        const v = JSON.parse(rows[0].setting_value || '{}');
        return { whatsapp: v.whatsapp !== false, website: v.website !== false, min_count: cleanMinRatings(v.min_count) };
    } catch { return { ...DISPLAY_DEFAULTS }; }
}

export async function saveRatingDisplay(changes: Partial<RatingDisplay>, updatedBy: string): Promise<RatingDisplay> {
    const current = await getRatingDisplay();
    const next: RatingDisplay = {
        whatsapp: changes.whatsapp === undefined ? current.whatsapp : Boolean(changes.whatsapp),
        website: changes.website === undefined ? current.website : Boolean(changes.website),
        min_count: changes.min_count === undefined ? current.min_count : cleanMinRatings(changes.min_count),
    };
    await db.execute(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
        [SETTING_KEY, JSON.stringify(next), updatedBy]
    );
    return next;
}

/** Brings a store's summary into line with its ratings. Called whenever a rating is added, changed or removed. */
export async function refreshRatingSummary(storeId: string): Promise<void> {
    await db.execute(
        `INSERT INTO store_rating_summary (store_id, avg_rating, rating_count)
         SELECT store_id, ROUND(AVG(stars), 2), COUNT(*) FROM store_ratings WHERE store_id = ? GROUP BY store_id
         ON DUPLICATE KEY UPDATE avg_rating = VALUES(avg_rating), rating_count = VALUES(rating_count)`,
        [storeId]
    );
}

export async function ratingMinCount(): Promise<number> {
    return (await getRatingDisplay()).min_count;
}

/** The ratings worth showing, by store id. A store with too few, or none, is simply absent. A failure shows no ratings rather than failing the message. */
export async function ratingsFor(storeIds: string[], channel: 'whatsapp' | 'website' = 'whatsapp'): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const ids = [...new Set(storeIds.map(String).filter(Boolean))];
    if (!ids.length) return out;
    try {
        const display = await getRatingDisplay();
        if (!display[channel]) return out;
        const min = display.min_count;
        const [rows]: any = await db.query('SELECT store_id, avg_rating, rating_count FROM store_rating_summary WHERE store_id IN (?)', [ids]);
        for (const r of rows) {
            const shown = showableRating(r.avg_rating, r.rating_count, min);
            if (shown !== null) out.set(String(r.store_id), shown);
        }
    } catch (e) {
        console.error('[Ratings] could not read ratings:', e);
    }
    return out;
}
