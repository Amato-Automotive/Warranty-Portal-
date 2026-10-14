import db from '../config/database.js';
import { findAsmForPincode } from './asmTerritoryQuery.js';
import { findState } from './indianStates.js';
import {
    storesToOffer,
    isTestAccount,
    parseCoordinate,
    isPincode,
    formatDistance,
    clampMinWarranties,
    clampRadiusKm,
    RADIUS_KM,
    type LocatableStore,
} from './storeLocator.js';

/**
 * What a customer is offered for their pincode, read from the database.
 *
 *   stores within 15 km           → a list, the customer picks one
 *   else the ASM for the pincode  → one person, who gets the lead
 *   else the state's distributors → a list, the customer picks one
 *   else customer support         → one number
 *
 * Kept apart from storeLocator so the filtering stays testable without a
 * database; this file fetches the points, the settings and walks the chain.
 */

// ─── Settings ────────────────────────────────────────────────────────────────

const SETTING_KEY = 'store_locator';

export interface LocatorSettings {
    /** Only stores with at least this many approved warranties are offered. */
    min_warranties: number;
    /** How far a store may be from the customer's pincode to be offered, in km. */
    radius_km: number;
    /** The last resort: no store, no ASM and no distributor in the state. */
    support_phone: string;
    support_name: string;
    /**
     * Whether WhatsApp replies go to every customer. Off, only the numbers in
     * test_numbers get one; everyone else's enquiry is still recorded as a
     * lead, for the team to follow up by hand.
     */
    whatsapp_live: boolean;
    /** Last ten digits of the phones that get replies while not live. */
    test_numbers: string[];
    /**
     * Stores never offered to customers, whatever their warranty count — our
     * own Autoform Brand Store, which appeared once the minimum was set to 0.
     * An admin can still send one from Lead Management.
     */
    hidden_stores: string[];
}

/** At most this many test numbers — it is for a handful of people's phones. */
export const MAX_TEST_NUMBERS = 10;

const DEFAULTS: LocatorSettings = {
    // Leaves out only stores with no approved warranty at all — 131 of 339 as
    // of September 2026. An admin raises it from Lead Management.
    min_warranties: 1,
    radius_km: RADIUS_KM,
    support_phone: '',
    support_name: 'Autoform Customer Support',
    whatsapp_live: false,
    test_numbers: [],
    hidden_stores: [],
};

/** Store ids, de-duplicated; at most 50 — it is for a handful of our own stores. */
function cleanStoreIds(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;]+/);
    return [...new Set(list.map(v => String(v ?? '').trim()).filter(v => /^[\w-]{6,64}$/.test(v)))].slice(0, 50);
}

/** The ten digits a phone is compared on: country code and formatting dropped. */
const tenDigits = (raw: unknown) => String(raw ?? '').replace(/\D/g, '').slice(-10);

function cleanTestNumbers(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;]+/);
    const out = [...new Set(list.map(tenDigits).filter(n => n.length === 10))];
    return out.slice(0, MAX_TEST_NUMBERS);
}

/** Whether this phone gets a WhatsApp reply from the locator right now. */
export function repliesTo(settings: LocatorSettings, phone: string): boolean {
    return settings.whatsapp_live || settings.test_numbers.includes(tenDigits(phone));
}

/*
 * The settings are read on every chat message, so they are kept for a short
 * while instead of being queried each time. Saving them here replaces the
 * copy at once; another server process sees a change within CACHE_MS.
 */
const CACHE_MS = 30_000;
let cached: { at: number; value: LocatorSettings } | null = null;
const copy = (v: LocatorSettings): LocatorSettings => ({ ...v, test_numbers: [...v.test_numbers], hidden_stores: [...v.hidden_stores] });

export async function getLocatorSettings(): Promise<LocatorSettings> {
    if (cached && Date.now() - cached.at < CACHE_MS) return copy(cached.value);
    const value = await readLocatorSettings();
    cached = { at: Date.now(), value };
    return copy(value);
}

async function readLocatorSettings(): Promise<LocatorSettings> {
    try {
        const [rows]: any = await db.execute(
            'SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1',
            [SETTING_KEY]
        );
        if (!rows.length) return { ...DEFAULTS };
        const stored = JSON.parse(rows[0].setting_value || '{}');
        return {
            min_warranties: clampMinWarranties(stored.min_warranties ?? DEFAULTS.min_warranties),
            // Settings saved before the radius was adjustable have none: 15 km, as before.
            radius_km: clampRadiusKm(stored.radius_km ?? DEFAULTS.radius_km),
            // Read under the old company_* names too: settings saved before the
            // rename would otherwise lose their number without anyone noticing.
            support_phone: String(stored.support_phone ?? stored.company_phone ?? DEFAULTS.support_phone).trim(),
            support_name: String(stored.support_name ?? '').trim() || DEFAULTS.support_name,
            // Only a stored true switches it on: anything unreadable stays off.
            whatsapp_live: stored.whatsapp_live === true,
            test_numbers: cleanTestNumbers(stored.test_numbers ?? []),
            hidden_stores: cleanStoreIds(stored.hidden_stores ?? []),
        };
    } catch (error) {
        // An unreadable setting must not take the locator down with it.
        console.error('[Locator] Could not read settings, using defaults:', error);
        return { ...DEFAULTS };
    }
}

/**
 * Save the settings, keeping anything the caller did not send.
 *
 * The support number is checked — digits only, 10 to 12 of them — because it
 * is the one number a customer with nowhere else to go is told to ring, and a
 * typo there leaves them nowhere.
 */
export async function saveLocatorSettings(
    changes: Partial<LocatorSettings>,
    updatedBy: string | null,
): Promise<LocatorSettings> {
    const current = await readLocatorSettings();
    const next: LocatorSettings = copy(current);

    if (changes.min_warranties !== undefined) {
        next.min_warranties = clampMinWarranties(changes.min_warranties);
    }
    if (changes.radius_km !== undefined) {
        next.radius_km = clampRadiusKm(changes.radius_km);
    }
    if (changes.support_phone !== undefined) {
        const digits = String(changes.support_phone).replace(/\D/g, '');
        if (digits && (digits.length < 10 || digits.length > 12)) {
            throw new Error('The customer support number should be 10 to 12 digits');
        }
        next.support_phone = digits;
    }
    if (changes.support_name !== undefined) {
        next.support_name = String(changes.support_name).trim().slice(0, 80) || DEFAULTS.support_name;
    }
    if (changes.whatsapp_live !== undefined) {
        next.whatsapp_live = changes.whatsapp_live === true;
    }
    if (changes.test_numbers !== undefined) {
        const given = Array.isArray(changes.test_numbers) ? changes.test_numbers : [changes.test_numbers];
        const bad = given.map(String).filter(n => n.trim() && tenDigits(n).length !== 10);
        if (bad.length) throw new Error(`Not a 10-digit mobile number: ${bad.join(', ')}`);
        next.test_numbers = cleanTestNumbers(given);
    }
    if (changes.hidden_stores !== undefined) {
        next.hidden_stores = cleanStoreIds(changes.hidden_stores);
    }

    await db.execute(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
        [SETTING_KEY, JSON.stringify(next), updatedBy]
    );
    cached = { at: Date.now(), value: copy(next) };
    return next;
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

export interface OfferedStoreRow {
    id: string;
    store_code: string | null;
    store_name: string;
    address: string | null;
    city: string | null;
    pincode: string | null;
    phone: string | null;
    warranties: number;
    distance_km: number;
    distance_label: string;
}

/** Someone a customer can be put in touch with when no store is near. */
export interface Contact {
    id: string | null;
    name: string;
    phone: string | null;
    city?: string | null;
    distance_km?: number | null;
    distance_label?: string | null;
}

/**
 * What happens when no store qualifies.
 *
 * `asm` and `support` carry one contact, who gets the lead. `distributor`
 * carries every active distributor in the state, and the customer picks — the
 * lead goes to whichever they choose, as it does with a store.
 */
export interface LocatorFallback {
    kind: 'asm' | 'distributor' | 'support';
    contacts: Contact[];
}

export interface LocatorResult {
    pincode: string;
    found: boolean;
    customer: { lat: number; lng: number; district: string | null; state: string | null } | null;
    rules: { radius_km: number; min_warranties: number };
    stores: OfferedStoreRow[];
    /** Present only when no store qualified. */
    fallback: LocatorFallback | null;
    reason?: string;
}

// ─── Lookups ─────────────────────────────────────────────────────────────────

/**
 * Approved warranties per store, by the store id each warranty carries (see
 * services/warrantyStore.ts). It used to union four routes — staff, the
 * franchise's own account, the "owner-<id>" link, and installer name + email —
 * which let one warranty count for two stores, and a store sharing a name with
 * another count the other's.
 */
async function warrantyCounts(): Promise<Map<string, number>> {
    const [rows]: any = await db.execute(`
        SELECT vendor_details_id AS franchise_id, COUNT(*) AS n
          FROM warranty_registrations
         WHERE status = 'validated' AND vendor_details_id IS NOT NULL
         GROUP BY vendor_details_id
    `);
    /* Keyed as text: vendor_details.id is a UUID. Converting it with Number()
       gave NaN for every store, and a Map treats every NaN as the same key, so
       all 339 stores read back one store's count. */
    return new Map(rows.map((r: any) => [String(r.franchise_id), Number(r.n)]));
}

/**
 * Who a customer is put in touch with when no store qualifies.
 *
 * The ASM whose territory holds their pincode first — their state, their
 * district, or the pincode itself: a person who knows the area and can place
 * them with a store further out. Otherwise customer support (the company
 * executive). Distributors are not part of the chain (7 Oct 2026).
 */
async function fallbackFor(
    pincode: string,
    customer: { lat: number; lng: number; district: string | null; state: string | null } | null,
    settings: LocatorSettings,
): Promise<LocatorFallback> {
    if (customer) {
        const asm = await findAsmForPincode(pincode, { pincode, district: customer.district, state: customer.state })
            .catch(() => null);
        if (asm?.phone_number) {
            return { kind: 'asm', contacts: [{ id: asm.id, name: asm.name, phone: asm.phone_number }] };
        }
        // No distributor step (7 Oct 2026): with no store and no ASM, customer
        // support takes the lead. Leads already sent to a distributor keep it.
    }

    return {
        kind: 'support',
        contacts: [{ id: null, name: settings.support_name, phone: settings.support_phone || null }],
    };
}

export async function findStoresForPincode(rawPincode: string): Promise<LocatorResult> {
    const pincode = String(rawPincode ?? '').trim();
    const settings = await getLocatorSettings();
    const rules = { radius_km: settings.radius_km, min_warranties: settings.min_warranties };

    if (!isPincode(pincode)) {
        return { pincode, found: false, customer: null, rules, stores: [],
            fallback: null, reason: 'Not a valid 6-digit pincode' };
    }

    const [pinRows]: any = await db.execute(
        'SELECT lat, lng, district, state FROM pincode_geo WHERE pincode = ? LIMIT 1',
        [pincode]
    );
    if (!pinRows.length) {
        // A real pincode we cannot place still gets someone to call.
        return { pincode, found: false, customer: null, rules, stores: [],
            fallback: await fallbackFor(pincode, null, settings),
            reason: 'Pincode not in the India Post directory' };
    }

    const customer = {
        lat: Number(pinRows[0].lat),
        lng: Number(pinRows[0].lng),
        district: pinRows[0].district,
        state: pinRows[0].state,
    };

    const [[storeRows], counts]: any = await Promise.all([
        db.execute(
            `SELECT vd.id, vd.store_code, vd.store_name, vd.address, vd.city, vd.pincode,
                    vd.latitude, vd.longitude, p.phone_number
               FROM vendor_details vd
               JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1
               LEFT JOIN profiles p ON p.id = vd.user_id
              WHERE vd.is_franchise = 1`
        ),
        warrantyCounts(),
    ]);

    const stores: (LocatableStore & { row: any })[] = [];
    const hidden = new Set(settings.hidden_stores);
    for (const row of storeRows) {
        if (isTestAccount(row.store_name)) continue;
        // Our own stores are never offered to a customer.
        if (hidden.has(String(row.id))) continue;
        const lat = parseCoordinate(row.latitude);
        const lng = parseCoordinate(row.longitude);
        if (lat === null || lng === null) continue;
        stores.push({
            id: row.id,
            store_name: row.store_name,
            lat,
            lng,
            warranties: counts.get(String(row.id)) ?? 0,
            row,
        });
    }

    /*
     * The customer's city, to list its stores first: the district each store's
     * own pincode belongs to, against the customer's. Delhi is one city — the
     * directory splits it into eleven districts, and Karol Bagh is as much
     * "Delhi" to a Lajpat Nagar customer as Lajpat Nagar is. A store whose
     * pincode we cannot place falls back to its typed city.
     */
    const cityKey = (district: unknown, state: unknown) => {
        const s = String(state ?? '').trim().toUpperCase();
        if (s.includes('DELHI')) return 'DELHI';
        const d = String(district ?? '').trim().toUpperCase();
        return d && d !== 'NA' ? `${d}|${s}` : null;
    };
    const customerCity = cityKey(customer.district, customer.state);
    const storePins = [...new Set(stores.map(s => String(s.row.pincode ?? '').trim()).filter(isPincode))];
    const pinCity = new Map<string, string | null>();
    if (customerCity && storePins.length) {
        const [geo]: any = await db.query(
            'SELECT pincode, district, state FROM pincode_geo WHERE pincode IN (?)', [storePins]);
        for (const g of geo) if (!pinCity.has(String(g.pincode))) pinCity.set(String(g.pincode), cityKey(g.district, g.state));
    }
    const customerDistrict = String(customer.district ?? '').trim().toUpperCase();
    const inCity = (s: { row: any }) => {
        if (!customerCity) return false;
        const placed = pinCity.get(String(s.row.pincode ?? '').trim());
        if (placed !== undefined) return placed === customerCity;
        const typed = String(s.row.city ?? '').trim().toUpperCase();
        return Boolean(typed) && (typed === customerDistrict || (customerCity === 'DELHI' && typed.includes('DELHI')));
    };

    const offered = storesToOffer(customer, stores, {
        radiusKm: settings.radius_km,
        minWarranties: settings.min_warranties,
    }, inCity);

    return {
        pincode,
        found: true,
        customer,
        rules,
        stores: offered.map(({ store, distanceKm }) => ({
            id: String(store.row.id),
            store_code: store.row.store_code || null,
            store_name: store.row.store_name,
            address: store.row.address || null,
            city: store.row.city || null,
            pincode: store.row.pincode || null,
            phone: store.row.phone_number || null,
            warranties: store.warranties,
            distance_km: Number(distanceKm.toFixed(2)),
            distance_label: formatDistance(distanceKm),
        })),
        fallback: offered.length ? null : await fallbackFor(pincode, customer, settings),
        reason: offered.length ? undefined
            : `No store within ${settings.radius_km} km with ${settings.min_warranties}+ approved warranties`,
    };
}
