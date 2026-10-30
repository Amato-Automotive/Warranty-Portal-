/**
 * The brand of the store an email or a message is about (AF, AC or AFAC), found
 * from whatever the caller has: the store, its user, its email, or a warranty.
 * Null when there is no store; a lookup that fails is null too, so an email is
 * never held up by it (it then goes out as Autoform).
 */
import db from '../config/database.js';

const one = async (sql: string, args: string[]): Promise<string | null> => {
    try {
        const [r]: any = await db.execute(sql, args);
        return r[0]?.brand ?? null;
    } catch (e) {
        console.error('[Brand] lookup failed:', e);
        return null;
    }
};

export const brandOfStore = (storeId: unknown) =>
    storeId ? one("SELECT COALESCE(allowed_brands, 'AF') AS brand FROM vendor_details WHERE id = ? LIMIT 1", [String(storeId)]) : Promise.resolve(null);

export const brandOfUser = (userId: unknown) =>
    userId ? one("SELECT COALESCE(allowed_brands, 'AF') AS brand FROM vendor_details WHERE user_id = ? LIMIT 1", [String(userId)]) : Promise.resolve(null);

/** A store's brand by its login or store email (customers have none). */
export const brandOfEmail = (email: unknown) =>
    email ? one(`SELECT COALESCE(vd.allowed_brands, 'AF') AS brand FROM vendor_details vd LEFT JOIN profiles p ON p.id = vd.user_id
                  WHERE p.email = ? OR vd.store_email = ? LIMIT 1`, [String(email), String(email)]) : Promise.resolve(null);

/** The brand of the store a warranty was registered at, by its UID or id. */
export const brandOfWarranty = (uidOrId: unknown) =>
    uidOrId ? one(`SELECT COALESCE(vd.allowed_brands, 'AF') AS brand FROM warranty_registrations wr
                    JOIN vendor_details vd ON vd.id = wr.vendor_details_id WHERE wr.uid = ? OR wr.id = ? LIMIT 1`, [String(uidOrId), String(uidOrId)]) : Promise.resolve(null);
