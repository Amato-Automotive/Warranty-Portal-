import db from '../config/database.js';

/**
 * The franchises and distributors an ASM looks after: every store whose
 * vendor_details.asm_id is theirs. An admin sets that from the franchise's
 * screen; nothing derives it from the ASM's lead-routing areas.
 *
 * Read by ASM Management and by the ASM's own portal. What an ASM sees of a
 * store was agreed with the owner (8 Oct 2026): name, code, city, status, the
 * owner's contact details, warranty counts and the date of the latest (numbers only,
 * never the warranties themselves), and its POSM requests and grievances in full. Not the map pin,
 * and not head office's internal notes.
 */

/** A JSON column as mysql2 hands it back: parsed already, a string, or null. */
const parseJson = (v: unknown) => {
    if (v == null || typeof v !== 'string') return v ?? null;
    try { return JSON.parse(v); } catch { return null; }
};

/** The signed-in ASM's own record, from their login profile; null if none. */
export async function asmOfProfile(profileId: string): Promise<{ id: string; name: string } | null> {
    const [rows]: any = await db.execute('SELECT id, name FROM asms WHERE profile_id = ?', [profileId]);
    return rows[0] ?? null;
}

/**
 * The one check behind everything an ASM does for a store: the store, if it
 * is theirs, else null. Accepts either id a store goes by (vendor_details.id
 * or the owner's profile id), and returns both.
 */
export async function asmStore(profileId: string, storeId: string): Promise<{
    id: string; user_id: string; store_name: string; asm_id: string; asm_name: string;
} | null> {
    const [rows]: any = await db.execute(
        `SELECT vd.id, vd.user_id, vd.store_name, a.id AS asm_id, a.name AS asm_name
           FROM vendor_details vd
           JOIN asms a ON a.id = vd.asm_id
          WHERE a.profile_id = ? AND (vd.id = ? OR vd.user_id = ?)
          LIMIT 1`,
        [profileId, storeId, storeId]
    );
    return rows[0] ?? null;
}

// POSM and grievance states that still need someone to act.
const POSM_DONE = "('delivered', 'closed', 'rejected')";
const GRIEVANCE_DONE = "('resolved', 'rejected')";

/*
 * A store's grievances are two kinds: customers' complaints about the store
 * (franchise_id is the store) and the ones the store raised itself, which carry
 * the store owner's profile as customer_id.
 */
const STORE_GRIEVANCE = `(g.franchise_id = vd.id OR (g.source_type = 'franchise' AND g.customer_id = vd.user_id))`;

const STORE_COLUMNS = `
    vd.id AS vendor_details_id, vd.user_id, vd.store_name, vd.store_code, vd.store_email,
    vd.city, vd.state,
    p.name AS contact_name, p.phone_number, p.email,
    COALESCE(vd.is_franchise, TRUE) AS is_franchise,
    COALESCE(vd.is_distributor, FALSE) AS is_distributor,
    COALESCE(vv.is_verified, FALSE) AS is_verified,
    COALESCE(vv.is_active, TRUE) AS is_active,
    (SELECT COUNT(*) FROM warranty_registrations wr WHERE wr.vendor_details_id = vd.id) AS warranties_total,
    (SELECT COUNT(*) FROM warranty_registrations wr WHERE wr.vendor_details_id = vd.id AND wr.status = 'validated') AS warranties_approved,
    (SELECT COUNT(*) FROM warranty_registrations wr WHERE wr.vendor_details_id = vd.id AND wr.status IN ('pending', 'pending_vendor')) AS warranties_pending,
    (SELECT COUNT(*) FROM warranty_registrations wr WHERE wr.vendor_details_id = vd.id AND wr.status = 'rejected') AS warranties_rejected,
    (SELECT COUNT(*) FROM warranty_registrations wr WHERE wr.vendor_details_id = vd.id
        AND wr.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')) AS warranties_this_month,
    (SELECT COUNT(*) FROM warranty_registrations wr WHERE wr.vendor_details_id = vd.id
        AND wr.created_at >= DATE_FORMAT(NOW() - INTERVAL 1 MONTH, '%Y-%m-01')
        AND wr.created_at < DATE_FORMAT(NOW(), '%Y-%m-01')) AS warranties_last_month,
    (SELECT MAX(wr.created_at) FROM warranty_registrations wr WHERE wr.vendor_details_id = vd.id) AS last_warranty_at,
    (SELECT COUNT(*) FROM posm_requests pr WHERE pr.franchise_id = vd.id
        AND (pr.status IS NULL OR pr.status NOT IN ${POSM_DONE})) AS posm_open,
    (SELECT MIN(pr.created_at) FROM posm_requests pr WHERE pr.franchise_id = vd.id
        AND (pr.status IS NULL OR pr.status NOT IN ${POSM_DONE})) AS posm_oldest_open_at,
    (SELECT COUNT(*) FROM grievances g WHERE ${STORE_GRIEVANCE}
        AND g.status NOT IN ${GRIEVANCE_DONE}) AS grievances_open,
    (SELECT MIN(g.created_at) FROM grievances g WHERE ${STORE_GRIEVANCE}
        AND g.status NOT IN ${GRIEVANCE_DONE}) AS grievances_oldest_open_at`;

const STORE_FROM = `
      FROM vendor_details vd
      JOIN profiles p ON p.id = vd.user_id
      LEFT JOIN vendor_verification vv ON vv.user_id = vd.user_id`;

const shape = (r: any) => ({
    ...r,
    is_franchise: Boolean(r.is_franchise),
    is_distributor: Boolean(r.is_distributor),
    is_verified: Boolean(r.is_verified),
    is_active: Boolean(r.is_active),
    warranties_total: Number(r.warranties_total || 0),
    warranties_approved: Number(r.warranties_approved || 0),
    warranties_pending: Number(r.warranties_pending || 0),
    warranties_rejected: Number(r.warranties_rejected || 0),
    warranties_this_month: Number(r.warranties_this_month || 0),
    warranties_last_month: Number(r.warranties_last_month || 0),
    posm_open: Number(r.posm_open || 0),
    grievances_open: Number(r.grievances_open || 0),
});

/** Weeks of warranty history in each store's pulse. */
export const PULSE_WEEKS = 12;

/**
 * Warranties per store per week over the last PULSE_WEEKS weeks, oldest first.
 * Week 0 is the last seven days, so the strip is never half a calendar week.
 */
async function weeklyCounts(ids: string[]) {
    const out = new Map<string, number[]>();
    if (!ids.length) return out;
    const [rows]: any = await db.execute(
        `SELECT vendor_details_id AS store_id, FLOOR(DATEDIFF(CURDATE(), DATE(created_at)) / 7) AS wk, COUNT(*) AS n
           FROM warranty_registrations
          WHERE vendor_details_id IN (?) AND created_at >= CURDATE() - INTERVAL ${PULSE_WEEKS * 7 - 1} DAY
          GROUP BY store_id, wk`,
        [ids]
    );
    for (const r of rows) {
        const wk = Number(r.wk);
        if (wk < 0 || wk >= PULSE_WEEKS) continue;
        if (!out.has(r.store_id)) out.set(r.store_id, new Array(PULSE_WEEKS).fill(0));
        out.get(r.store_id)![PULSE_WEEKS - 1 - wk] = Number(r.n);
    }
    return out;
}

const withPulse = async (stores: any[]) => {
    const weekly = await weeklyCounts(stores.map(s => s.vendor_details_id));
    return stores.map(s => ({ ...s, weekly: weekly.get(s.vendor_details_id) ?? new Array(PULSE_WEEKS).fill(0) }));
};

export async function storesOfAsm(asmId: string) {
    const [rows]: any = await db.execute(
        `SELECT ${STORE_COLUMNS} ${STORE_FROM}
          WHERE vd.asm_id = ?
          ORDER BY vd.state, vd.city, vd.store_name`,
        [asmId]
    );
    return withPulse(rows.map(shape));
}

const parseList = (v: unknown): string[] => {
    if (Array.isArray(v)) return v;
    try {
        const parsed = JSON.parse(String(v ?? '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

/**
 * One store in full, for the ASM — or null when it is not one of theirs, so
 * an ASM can never read another ASM's store by guessing its id.
 */
export async function storeDetailForAsm(asmId: string, vendorDetailsId: string) {
    const [rows]: any = await db.execute(
        `SELECT ${STORE_COLUMNS} ${STORE_FROM}
          WHERE vd.id = ? AND vd.asm_id = ?`,
        [vendorDetailsId, asmId]
    );
    if (!rows.length) return null;
    const [store] = await withPulse([shape(rows[0])]);

    // POSM: everything but head office's internal notes.
    const [posm]: any = await db.execute(
        `SELECT r.id, r.ticket_id, r.requirement, r.status, r.created_by_role, r.created_at, r.updated_at,
                r.items, r.dispatch, r.delivery, r.history, creator.name AS created_by_name
           FROM posm_requests r
           LEFT JOIN profiles creator ON creator.id = r.created_by
          WHERE r.franchise_id = ?
          ORDER BY r.created_at DESC`,
        [vendorDetailsId]
    );
    const posmIds = posm.map((r: any) => r.id);
    const [posmMessages]: any = posmIds.length
        ? await db.execute(
            `SELECT m.request_id, m.sender_role, sender.name AS sender_name, m.message, m.attachments, m.created_at
               FROM posm_messages m
               LEFT JOIN profiles sender ON sender.id = m.sender_id
              WHERE m.request_id IN (?)
              ORDER BY m.created_at ASC`,
            [posmIds]
        )
        : [[]];

    // Grievances: everything but admin_notes, which is head office's own.
    const [grievances]: any = await db.execute(
        `SELECT g.id, g.ticket_id, g.source_type, g.category, g.sub_category, g.subject, g.description,
                g.attachments, g.status, g.priority, g.warranty_uid, g.department, g.department_details,
                g.franchise_remarks, g.admin_remarks, g.assigned_to, g.customer_rating, g.customer_feedback,
                g.created_at, g.updated_at, g.resolved_at, g.created_by_role,
                CASE WHEN g.source_type = 'customer' THEN c.name END AS customer_name,
                CASE WHEN g.source_type = 'customer' THEN c.phone_number END AS customer_phone,
                creator.name AS created_by_name
           FROM grievances g
           LEFT JOIN profiles c ON c.id = g.customer_id
           LEFT JOIN profiles creator ON creator.id = g.created_by
          -- STORE_GRIEVANCE as two lookups: the OR form scans the table.
          WHERE g.id IN (
                SELECT id FROM grievances WHERE franchise_id = ?
                UNION
                SELECT id FROM grievances WHERE source_type = 'franchise' AND customer_id = ?)
          ORDER BY g.created_at DESC`,
        [vendorDetailsId, store.user_id]
    );
    const grievanceIds = grievances.map((g: any) => g.id);
    const [remarks]: any = grievanceIds.length
        ? await db.execute(
            `SELECT grievance_id, added_by, added_by_name, remark, created_at
               FROM grievance_remarks WHERE grievance_id IN (?)
              ORDER BY created_at ASC`,
            [grievanceIds]
        )
        : [[]];

    return {
        store,
        posm: posm.map((r: any) => ({
            ...r,
            items: parseJson(r.items), dispatch: parseJson(r.dispatch), delivery: parseJson(r.delivery), history: parseJson(r.history),
            messages: posmMessages
                .filter((m: any) => m.request_id === r.id)
                .map(({ request_id, attachments, ...m }: any) => ({ ...m, attachments: parseList(attachments) })),
        })),
        grievances: grievances.map((g: any) => ({
            ...g,
            attachments: parseList(g.attachments),
            remarks: remarks
                .filter((r: any) => r.grievance_id === g.id)
                .map(({ grievance_id, ...r }: any) => r),
        })),
    };
}
