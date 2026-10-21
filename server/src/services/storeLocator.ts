/**
 * The stores a customer is offered, from their pincode.
 *
 * A store is offered when it is within reach and has a record of doing the
 * work: inside a fixed radius of the customer, with at least a set number of
 * approved warranties behind it. The list is alphabetical, not ranked — every
 * store that qualifies is offered on equal terms, and the customer chooses.
 *
 * When nothing qualifies, the customer is not left with an empty list:
 *
 *   stores within reach      → a list, the customer picks one
 *   else the ASM for the state → one person, who gets the lead
 *   else the state's distributors → a list, the customer picks one
 *   else customer support    → one number
 *
 * The caller walks that chain; this file supplies the two lists.
 *
 * Free of any database import: the filtering is the part worth testing, and it
 * takes plain points in.
 */

/** A place on the map. */
export interface GeoPoint {
    lat: number;
    lng: number;
}

export interface LocatableStore extends GeoPoint {
    id: string | number;
    store_name: string;
    /** Approved warranties attributed to this store. */
    warranties: number;
    [key: string]: unknown;
}

export interface OfferedStore<T extends LocatableStore = LocatableStore> {
    store: T;
    distanceKm: number;
}

export interface LocatorRules {
    /** Only stores within this straight-line distance are offered. */
    radiusKm: number;
    /** Only stores with at least this many approved warranties are offered. */
    minWarranties: number;
}

/**
 * A customer's number as the team reads it: "918517813281" → "8517813281".
 * WhatsApp gives it with the country code, and that went straight into the
 * store, ASM and support alerts; sending still works, because WhatsAppService
 * adds +91 to a ten-digit number. A number from elsewhere is left whole.
 */
export function localPhone(raw: unknown): string {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
    return digits;
}

/**
 * How far is near, by default. An admin can change it from the Store Locator
 * settings, within MIN–MAX_RADIUS_KM: a customer offered a store 40 km away
 * has not been helped, and the ASM fallback exists for exactly that.
 */
export const RADIUS_KM = 15;
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 100;

/** A radius an admin may set: whole kilometres, 1 to 100. Anything unreadable is the default. */
export function clampRadiusKm(raw: unknown): number {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || raw === null || raw === '') return RADIUS_KM;
    return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, n));
}

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points, in kilometres.
 *
 * Straight-line, not road distance — the road is always longer, which is why
 * the customer is shown "~3.2 km" rather than a figure that sounds measured.
 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A coordinate read from the store table, or null when it is not one.
 *
 * vendor_details holds latitude and longitude as text, and five rows carry a
 * stray comma or space around a correct value ("16.710065296605027,"). Parsing
 * with Number() alone would turn those into NaN and silently drop real stores.
 */
export function parseCoordinate(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    const cleaned = String(raw).trim().replace(/^[,\s]+|[,\s]+$/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Roughly India. A pin outside it is a data error, not a faraway store. */
export function isInIndia(lat: number | null, lng: number | null): boolean {
    return lat !== null && lng !== null && lat >= 6 && lat <= 37.5 && lng >= 68 && lng <= 97.5;
}

/**
 * Every store that qualifies: the customer's own city first, then the rest,
 * each part alphabetically.
 *
 * Within the radius, and with enough approved warranties. Distance is still
 * worked out for each, because the customer is told how far a store is — it
 * just does not decide the order. A 201301 customer was offered Delhi and
 * Ghaziabad stores ahead of the two in Noida itself (14 Oct 2026), so
 * `inCity` lifts the stores in their city to the top; the radius is unchanged.
 *
 * Stores without a usable pin are left out rather than measured from 0,0,
 * which would put a store in Delhi thousands of kilometres from anywhere.
 */
export function storesToOffer<T extends LocatableStore>(
    customer: GeoPoint,
    stores: T[],
    rules: LocatorRules,
    inCity: (store: T) => boolean = () => false,
): OfferedStore<T>[] {
    return stores
        .filter(s => isInIndia(s.lat, s.lng))
        .filter(s => Number(s.warranties) >= rules.minWarranties)
        .map(store => ({ store, distanceKm: haversineKm(customer, store), local: inCity(store) }))
        .filter(o => o.distanceKm <= rules.radiusKm)
        .sort((a, b) =>
            Number(b.local) - Number(a.local)
            || String(a.store.store_name).trim().localeCompare(
                String(b.store.store_name).trim(), 'en', { sensitivity: 'base' })
            // Two stores with the same name are ordered by id, so the same
            // query always returns the same list.
            || String(a.store.id).localeCompare(String(b.store.id), 'en', { numeric: true }))
        .map(({ store, distanceKm }) => ({ store, distanceKm }));
}

/**
 * Every distributor a customer may choose from, alphabetically.
 *
 * Offered when no store is near and no ASM covers the state. There is no
 * radius: the caller has already limited these to the customer's state, which
 * rarely holds more than five, and a distributor 200 km away is still the right
 * business to own the lead. Distance is carried so the customer can see it.
 *
 * A distributor without a usable pin is still offered — unlike a store, it is
 * not being chosen for nearness — and simply carries no distance.
 */
export function distributorsToOffer<T extends GeoPoint & { name: string; id?: string | number }>(
    customer: GeoPoint,
    distributors: T[],
): { distributor: T; distanceKm: number | null }[] {
    return distributors
        .map(distributor => ({
            distributor,
            distanceKm: isInIndia(distributor.lat, distributor.lng)
                ? haversineKm(customer, distributor)
                : null,
        }))
        .sort((a, b) =>
            String(a.distributor.name).trim().localeCompare(
                String(b.distributor.name).trim(), 'en', { sensitivity: 'base' })
            || String(a.distributor.id ?? '').localeCompare(String(b.distributor.id ?? ''), 'en', { numeric: true }));
}

/**
 * An account that exists for testing, not trade.
 *
 * "Distributor_TEST" and "TestFranchise" sit in the live tables beside real
 * businesses. A customer's lead routed to one of them goes nowhere, so they
 * are never offered and never given a lead.
 */
export function isTestAccount(name: unknown): boolean {
    // "test" starting a word: TestFranchise, Distributor_TEST. Not "Latest
    // Auto" or "Contest Motors", where it sits inside another word.
    return /(^|[^a-z])test/i.test(String(name ?? ''));
}

/** Distance as the customer should read it: approximate, never falsely precise. */
export function formatDistance(km: number): string {
    if (km < 1) return '< 1 km';
    return `~${km.toFixed(1)} km`;
}

/** A 6-digit Indian pincode — the first digit is never 0. */
export function isPincode(raw: unknown): boolean {
    return /^[1-9][0-9]{5}$/.test(String(raw ?? '').trim());
}

/**
 * The pincode inside whatever a customer typed: "302001", "302 001",
 * "Pin- 302001", "Sector 62 Noida 201301". Null when there is none.
 *
 * Only six digits standing on their own count, so the tail of a phone number
 * ("+919876543210") is never mistaken for one.
 */
export function extractPincode(raw: unknown): string | null {
    const m = String(raw ?? '').match(/(?<![\d+])([1-9]\d{2})[\s-]?(\d{3})(?!\d)/);
    return m ? m[1] + m[2] : null;
}

/**
 * A minimum-warranty threshold an admin may set.
 *
 * Whole, and never negative. Capped so a stray extra zero cannot empty every
 * list in the country: the busiest store has a little over 700.
 */
export const MAX_MIN_WARRANTIES = 1000;

export function clampMinWarranties(raw: unknown): number {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, MAX_MIN_WARRANTIES);
}
