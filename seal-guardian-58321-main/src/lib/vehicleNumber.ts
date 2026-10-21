/**
 * A warranty's vehicle registration number, when it has a real one.
 *
 * Seat cover warranties stopped asking for it (21 Oct 2026; the QR page first)
 * and are filed as APPLIED-FOR, as 1,601 earlier ones already were, so a
 * screen that printed the column would show "APPLIED-FOR" or "N/A" for most
 * new warranties. Older warranties and every PPF one carry a real number.
 * Screens show the number when this returns one and leave the line out (or
 * fall back to another label) when it returns null.
 *
 * Takes the candidates in order — usually `registration_number`, then
 * `product_details.carRegistration` — and returns the first real one.
 */
const NO_NUMBER = new Set(["", "APPLIED-FOR", "APPLIED FOR", "N/A", "NA", "NULL", "-", "—"]);

export function vehicleNumberOf(...candidates: unknown[]): string | null {
    for (const c of candidates) {
        const v = typeof c === "string" ? c.trim() : c == null ? "" : String(c).trim();
        if (!NO_NUMBER.has(v.toUpperCase())) return v;
    }
    return null;
}

/** product_details as stored: an object, a JSON string, or nothing. */
export function productDetailsOf(w: { product_details?: unknown }): Record<string, any> {
    const pd = w.product_details;
    if (!pd) return {};
    if (typeof pd === "string") {
        try { return JSON.parse(pd) || {}; } catch { return {}; }
    }
    return pd as Record<string, any>;
}

/** The number for a warranty row, looking in both places it has been kept. */
export const warrantyVehicleNumber = (w: { registration_number?: unknown; product_details?: unknown; car_reg?: unknown }) =>
    vehicleNumberOf(w.registration_number, productDetailsOf(w).carRegistration, w.car_reg);
