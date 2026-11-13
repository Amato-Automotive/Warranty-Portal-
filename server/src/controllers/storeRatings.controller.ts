import { Request, Response } from 'express';
import db from '../config/database.js';
import { getRatingDisplay } from '../services/storeRatings.service.js';
import { showableRating } from '../services/storeRatingRules.js';
import { ratingMinCount } from '../services/storeRatings.service.js';
import { average, split, buildOverview, buildStoreDetail, resolvePeriod, type AverageBand, type RatingRow, type StoreInfo } from '../services/ratingStats.js';

/**
 * The admin's store ratings: the network overview and one store. Reads the
 * ratings customers gave (store_ratings); nothing here changes them.
 */

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const text = (v: unknown) => String(v ?? '').trim();
const BANDS = new Set(['any', 'below4', '4to45', 'above45']);

/** The franchise stores that are in view, narrowed by brand and state. Our own test stores are left out. */
async function storesFor(brand: string, state: string): Promise<StoreInfo[]> {
    const where = ['vd.is_franchise = 1', "COALESCE(vv.is_verified, 0) = 1"];
    const args: unknown[] = [];
    if (brand && brand !== 'all') { where.push("COALESCE(vd.allowed_brands, 'AF') = ?"); args.push(brand); }
    if (state && state !== 'all') { where.push('vd.state = ?'); args.push(state); }
    const [rows]: any = await db.execute(
        `SELECT vd.id AS store_id, vd.store_name, COALESCE(vd.allowed_brands, 'AF') AS brand, vd.state, vd.city
           FROM vendor_details vd LEFT JOIN vendor_verification vv ON vv.user_id = vd.user_id
          WHERE ${where.join(' AND ')} ORDER BY vd.store_name`, args as any[]);
    return rows.filter((r: any) => !/\btest\b/i.test(String(r.store_name))).map((r: any) => ({
        store_id: String(r.store_id), name: String(r.store_name ?? '').trim(), brand: r.brand, state: r.state ?? null, city: r.city ?? null,
    }));
}

async function ratingsOf(storeIds: string[], product: string): Promise<RatingRow[]> {
    if (!storeIds.length) return [];
    const args: unknown[] = [storeIds];
    let extra = '';
    if (product && product !== 'all') { extra = ' AND product = ?'; args.push(product); }
    const [rows]: any = await db.query(
        `SELECT store_id, stars, DATE_FORMAT(created_at, '%Y-%m-%d') AS day, product, customer_name, customer_phone, warranty_uid
           FROM store_ratings WHERE store_id IN (?)${extra}`, args as any[]);
    return rows.map((r: any) => ({ ...r, store_id: String(r.store_id), stars: Number(r.stars) }));
}

/** The average shows only from the minimum number of ratings; below it, only the count does. */
const shownAverage = (avg: number | null, count: number, min: number) => (avg === null ? null : showableRating(avg, count, min));

export class StoreRatingsController {
    /** A store's average for the customer on its QR page: the number alone. Nothing when the switch is off or the store has too few ratings. */
    static async forCustomer(req: Request, res: Response) {
        try {
            const display = await getRatingDisplay();
            if (!display.customers) return res.json({ success: true, show: false, average: null });
            const [rows]: any = await db.execute('SELECT stars FROM store_ratings WHERE store_id = ?', [req.params.vendorDetailsId]);
            const stars = rows.map((r: any) => ({ stars: Number(r.stars) }));
            const avg = shownAverage(average(stars), stars.length, display.min_count);
            res.json({ success: true, show: avg !== null, average: avg });
        } catch (error: any) {
            console.error('[StoreRatings] customer:', error);
            res.status(500).json({ error: 'Could not load the rating' });
        }
    }

    /** The signed-in franchise's own rating: overall, and for a period it picks. */
    static async mine(req: Request, res: Response) {
        try {
            const display = await getRatingDisplay();
            if (!display.franchises) return res.json({ success: true, show: false });
            const [[s]]: any = await db.execute('SELECT id FROM vendor_details WHERE user_id = ? LIMIT 1', [(req as any).user?.id]);
            if (!s) return res.json({ success: true, show: false });
            const today = istToday();
            const period = resolvePeriod(req.query.period ?? 'overall', req.query.from, req.query.to, today);
            const [rows]: any = await db.execute(
                "SELECT stars, DATE_FORMAT(created_at, '%Y-%m-%d') AS day FROM store_ratings WHERE store_id = ?", [s.id]);
            const all = rows.map((r: any) => ({ stars: Number(r.stars), day: String(r.day) }));
            const inPeriod = all.filter((r: any) => (!period.start || r.day >= period.start) && (!period.end || r.day <= period.end));
            const first = all.length ? all.map((r: any) => r.day).sort()[0] : null;
            res.json({
                success: true, show: true, min_count: display.min_count,
                overall: { count: all.length, average: shownAverage(average(all), all.length, display.min_count), since: first },
                period: { key: period.key, label: period.label, from: period.start ?? first, to: period.end ?? today, count: inPeriod.length, average: shownAverage(average(inPeriod), inPeriod.length, display.min_count) },
                split: split(inPeriod),
            });
        } catch (error: any) {
            console.error('[StoreRatings] mine:', error);
            res.status(500).json({ error: 'Could not load your rating' });
        }
    }

    static async overview(req: Request, res: Response) {
        try {
            const today = istToday();
            const period = resolvePeriod(req.query.period, req.query.from, req.query.to, today);
            const brand = text(req.query.brand); const state = text(req.query.state); const product = text(req.query.product);
            const band = (BANDS.has(text(req.query.avg)) ? text(req.query.avg) : 'any') as AverageBand;
            const stores = await storesFor(brand, state);
            const ratings = await ratingsOf(stores.map(s => s.store_id), product);

            let warranties: number | null = null;
            if (stores.length) {
                const args: unknown[] = [stores.map(s => s.store_id)];
                let range = '';
                if (period.start && period.end) { range = ' AND DATE(created_at) BETWEEN ? AND ?'; args.push(period.start, period.end); }
                const [[w]]: any = await db.query(`SELECT COUNT(*) AS n FROM warranty_registrations WHERE status = 'validated' AND vendor_details_id IN (?)${range}`, args as any[]);
                warranties = Number(w?.n ?? 0);
            }

            const [stateRows]: any = await db.execute("SELECT DISTINCT state FROM vendor_details WHERE is_franchise = 1 AND state IS NOT NULL AND state <> '' ORDER BY state");
            const [productRows]: any = await db.execute("SELECT DISTINCT product FROM store_ratings WHERE product IS NOT NULL AND product <> '' ORDER BY product");
            res.json({
                success: true, period,
                options: { states: stateRows.map((r: any) => r.state), products: productRows.map((r: any) => r.product) },
                ...buildOverview(ratings, stores, period, today, { band, minCount: await ratingMinCount(), warrantiesInPeriod: warranties }),
            });
        } catch (error: any) {
            console.error('[StoreRatings] overview:', error);
            res.status(500).json({ error: 'Could not load the ratings' });
        }
    }

    static async store(req: Request, res: Response) {
        try {
            const today = istToday();
            const period = resolvePeriod(req.query.period, req.query.from, req.query.to, today);
            const [[s]]: any = await db.execute(
                "SELECT id AS store_id, store_name, COALESCE(allowed_brands, 'AF') AS brand, state, city FROM vendor_details WHERE id = ?", [req.params.storeId]);
            if (!s) return res.status(404).json({ error: 'Store not found' });
            const store: StoreInfo = { store_id: String(s.store_id), name: String(s.store_name ?? '').trim(), brand: s.brand, state: s.state ?? null, city: s.city ?? null };
            const [mineRows]: any = await db.execute(
                `SELECT store_id, stars, DATE_FORMAT(created_at, '%Y-%m-%d') AS day, product, customer_name, customer_phone, warranty_uid
                   FROM store_ratings WHERE store_id = ? ORDER BY created_at DESC LIMIT 2000`, [store.store_id]);
            const [netRows]: any = await db.execute(`SELECT store_id, stars, DATE_FORMAT(created_at, '%Y-%m-%d') AS day, product FROM store_ratings`);
            const norm = (r: any): RatingRow => ({ ...r, store_id: String(r.store_id), stars: Number(r.stars) });
            res.json({ success: true, range: period, ...buildStoreDetail(store, mineRows.map(norm), netRows.map(norm), period, today) });
        } catch (error: any) {
            console.error('[StoreRatings] store:', error);
            res.status(500).json({ error: 'Could not load this store' });
        }
    }
}
