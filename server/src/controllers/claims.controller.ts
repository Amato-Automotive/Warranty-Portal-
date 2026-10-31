import { Response } from 'express';
import db from '../config/database.js';
import { modelList } from '../services/carModels.js';
import { PLANT_VEHICLES } from '../services/plantVehicles.js';
import { AuthRequest } from '../middleware/auth.js';
import { sheetSeen } from './claimSheet.controller.js';
import { vendorRepository } from '../repositories/vendor.repository.js';
import { NotificationService } from '../services/notification.service.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import fs from 'fs';
import path from 'path';
import { APP_URL, UPLOADS_BASE_DIR, urlToDiskPath } from '../config/localUpload.js';
import {
    applyClaimAction, actionsFor, coverage, problemsFor, kindOf, stepText, waitingOn, readVehicle, readProblem, asksAirbags,
    STATUS_TEXT, REJECT_REASONS, HOLD_REASONS, PROBLEMS, PLANT_RIGHTS, OLD_PART_ENABLED,
    type Actor, type ClaimAction, type ClaimStatus, type FlowClaim, type PlantRight, type Who,
} from '../services/claimFlow.js';

/** One line on a claim's timeline. */
interface HistoryEntry {
    action: ClaimAction | 'raised';
    status: ClaimStatus;
    text: string;
    note?: string | null;
    changes?: string[];
    at: string;
    by_role: Actor;
    by: string | null;
    by_name: string | null;
    undone?: boolean;
}

/* Columns stored as JSON, and their names in the flow where they differ. */
const JSON_COLS = ['media', 'snapshot', 'vehicle', 'verification', 'hold_info', 'decision', 'consent', 'plan_info', 'dispatch', 'fitted', 'old_part', 'change_request', 'trail', 'history'];
const parse = (v: any) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v ?? null);
const json = (v: any) => (v === null || v === undefined ? null : JSON.stringify(v));

/** A row as the flow reads it. */
function fromRow(row: any) {
    const out: any = { ...row };
    for (const c of JSON_COLS) out[c] = parse(row[c]);
    out.hold = out.hold_info; delete out.hold_info;
    out.plan = out.plan_info; delete out.plan_info;
    out.product_type = out.snapshot?.product_type ?? null;
    return out;
}

const actorOf = (req: AuthRequest): Actor =>
    req.user?.role === 'admin' ? 'admin' : req.user?.role === 'vendor' ? 'vendor' : 'customer';

/**
 * The plant person's rights, from the admin permissions: one switch per step
 * (Write on "Claims: decide", "Claims: EDD & alteration", …). Super admins
 * have them all; "Warranty Claims" Read alone is a viewer — Anurag sir,
 * Himanshu sir and the depots.
 */
function whoOf(req: AuthRequest): Who {
    const actor = actorOf(req);
    if (actor !== 'admin') return { actor };
    if (req.user?.isSuperAdmin) return { actor, rights: [...PLANT_RIGHTS] };
    const p = req.user?.permissions ?? {};
    return { actor, rights: PLANT_RIGHTS.filter(r => p[`claims_${r}`]?.write) };
}

const entry = (req: AuthRequest, e: Omit<HistoryEntry, 'at' | 'by_role' | 'by' | 'by_name'>): HistoryEntry => ({
    ...e, at: new Date().toISOString(), by_role: actorOf(req), by: req.user?.id ?? null, by_name: (req.user as any)?.name ?? null,
});

const filesOf = (req: AuthRequest, field: string): string[] => {
    const files = (req.files as any[] | undefined) ?? [];
    return files.filter(f => f.fieldname === field).map(f => f.path || f.secure_url || f.url).filter(Boolean);
};
const isPhoto = (url: string) => /\.(jpe?g|png|webp|heic|heif)$/i.test(url);

/** What the claim shows of its warranty, kept as it was when raised. */
function snapshotOf(w: any) {
    const d = parse(w.product_details) ?? {};
    const cov = coverage(w);
    return {
        product_type: w.product_type,
        product_name: d.productName || d.product || w.product_type,
        customer_name: w.customer_name, customer_phone: w.customer_phone,
        car: [w.car_make, w.car_model].filter(Boolean).join(' ') || null,
        registration_number: w.registration_number || d.carRegistration || null,
        warranty_type: w.warranty_type, cover_start: cov.start, cover_end: cov.end,
        fitted_store: d.storeName || null,
    };
}

/** A warranty as the screens list it: what it is, its cover, and what can be claimed on it. */
function warrantyCard(w: any) {
    const cov = coverage(w);
    return {
        uid: w.uid, ...snapshotOf(w), status: w.status, store_id: w.vendor_details_id ?? null,
        covered: cov.covered, why: cov.why,
        claimable: w.status === 'validated',
        problems: w.status === 'validated' ? problemsFor(w.product_type, cov.covered) : [],
        asks_airbags: asksAirbags(w.product_type),
    };
}

/* Registration photos by product, in the order the warranty screen shows them. */
const REG_PHOTOS: [string, string][] = [
    ['vehicle', 'Car exterior'], ['seatCover', 'Seat cover'], ['carOuter', 'Car outer'],
    ['lhs', 'LHS view'], ['rhs', 'RHS view'], ['frontReg', 'Front number plate'], ['backReg', 'Back number plate'], ['warranty', 'Warranty card'],
];
const fullUrl = (raw: unknown) => (typeof raw === 'string' && raw ? (raw.startsWith('http') ? raw : `${APP_URL}/uploads/${raw}`) : null);
const monthsBetween = (a: Date, b: Date) => Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0));

/**
 * The warranty as it was registered, laid out for whoever reviews the claim:
 * its details, its photos and a few checks against the claim. The fraud
 * signals and remarks are the plant's alone.
 */
async function registrationFor(c: any, actor: Actor) {
    const [ws]: any = await db.execute('SELECT * FROM warranty_registrations WHERE uid = ? LIMIT 1', [c.warranty_uid]);
    const w = ws[0];
    if (!w) return null;
    const d = parse(w.product_details) ?? {};
    const photos: { label: string; url: string }[] = [];
    const seen = new Set<string>();
    const add = (label: string, raw: unknown) => { const u = fullUrl(raw); if (u && !seen.has(u)) { seen.add(u); photos.push({ label, url: u }); } };
    for (const [k, label] of REG_PHOTOS) add(label, d.photos?.[k]);
    add('Seat cover', w.seat_cover_photo_url);
    add('Car outer', w.car_outer_photo_url);
    add('Invoice', d.invoiceFileName);

    const [fit]: any = w.vendor_details_id ? await db.execute('SELECT store_name, city FROM vendor_details WHERE id = ?', [w.vendor_details_id]) : [[]];
    const fittedStore = fit[0]?.store_name || d.storeName || null;
    const fittedOn = w.purchase_date || d.installationDate || w.created_at;
    const cov = coverage(w, new Date(c.created_at));

    const checks: { tone: 'ok' | 'warn' | 'info'; text: string }[] = [];
    if (fittedOn) {
        const m = monthsBetween(new Date(fittedOn), new Date(c.created_at));
        checks.push({ tone: 'info', text: `Claimed ${m < 1 ? 'within a month' : `${m} month${m === 1 ? '' : 's'}`} after fitting` });
    }
    if (c.kind === 'warranty') {
        checks.push(cov.covered
            ? { tone: 'ok', text: `In warranty when raised · covered till ${cov.end}` }
            : { tone: 'warn', text: `${cov.why ?? 'Not in warranty'} when raised` });
    }
    if (w.status !== 'validated') checks.push({ tone: 'warn', text: `Registration is ${w.status.replace('_', ' ')}, not approved` });
    const regCar = [w.car_make, w.car_model].filter(Boolean).join(' ').toLowerCase();
    const claimCar = [c.vehicle?.make, c.vehicle?.model].filter(Boolean).join(' ').toLowerCase();
    if (regCar && claimCar && !regCar.includes(String(c.vehicle?.model ?? '').toLowerCase())) {
        checks.push({ tone: 'warn', text: `Vehicle on the claim (${c.vehicle.make} ${c.vehicle.model}) differs from the registration (${[w.car_make, w.car_model].filter(Boolean).join(' ')})` });
    }
    if (w.vendor_details_id && c.store_id && String(w.vendor_details_id) !== String(c.store_id)) {
        checks.push({ tone: 'warn', text: `Claim is at a different store from the one that fitted it (${fittedStore ?? 'another store'})` });
    } else if (w.vendor_details_id) checks.push({ tone: 'ok', text: 'Claim is at the store that fitted it' });
    if (!photos.length) checks.push({ tone: 'warn', text: 'No photos on the registration to compare with' });

    const out: any = {
        uid: w.uid, status: w.status, product_type: w.product_type,
        product_name: d.productName || d.product || w.product_type,
        rolls: Array.isArray(d.rolls) ? d.rolls.map((r: any) => ({ serial: r.serial, sqft: r.sqft, area: r.installArea })) : null,
        customer_name: w.customer_name, customer_phone: w.customer_phone, customer_email: w.customer_email,
        customer_address: w.customer_address || d.customerAddress || null,
        car: [w.car_make, w.car_model, w.car_year].filter(Boolean).join(' ') || null, car_colour: w.car_colour || null,
        registration_number: w.registration_number || d.carRegistration || null,
        warranty_type: w.warranty_type, fitted_on: fittedOn, registered_on: w.created_at,
        approved_on: w.validated_at || w.vendor_approved_at || null,
        cover_start: cov.start, cover_end: cov.end,
        fitted_store: fittedStore, fitted_city: fit[0]?.city ?? null,
        installer: d.manpowerName || w.installer_name || null,
        photos, checks,
    };
    if (actor === 'admin') {
        out.fraud_score = w.fraud_score ?? null;
        out.fraud_flags = parse(w.fraud_flags);
        if (Number(w.fraud_score) >= 50) checks.push({ tone: 'warn', text: `Registration fraud score was ${w.fraud_score}` });
        const [rm]: any = await db.execute('SELECT admin_name, remark, created_at FROM warranty_remarks WHERE warranty_uid = ? ORDER BY created_at DESC LIMIT 10', [w.uid]);
        out.remarks = rm;
        // The whole row, for the full registration sheet.
        out.row = w;
    }
    return out;
}

async function storeOf(userId: string) {
    return vendorRepository.findByUserId(userId);
}

/** The stores a distributor supplies (Sourcing Map), as vendor_details ids. */
async function distributorStoreIds(userId: string): Promise<string[]> {
    const [rows]: any = await db.execute(
        `SELECT DISTINCT vd.id FROM distributors d
           JOIN franchise_distributors fd ON fd.distributor_id = d.id
           JOIN vendor_details vd ON vd.user_id = fd.franchise_user_id
          WHERE d.profile_id = ?`, [userId]);
    return rows.map((r: any) => String(r.id));
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Everything a claim is searched by, as one text: numbers, names, the car, the colours, the issue, the plant's columns. */
/**
 * A claim's brand: its product's (a product on the list by the same name),
 * else its store's (an AC store is Autocruze; AF and AFAC are Autoform).
 * Needs `vd` joined on the claim's store.
 */
const CLAIM_BRAND = `COALESCE(
    (SELECT CASE WHEN p.brand = 'AC' THEN 'AC' ELSE 'AF' END FROM products p
      WHERE LOWER(TRIM(p.name)) = LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.product_name')))) LIMIT 1),
    CASE WHEN vd.allowed_brands = 'AC' THEN 'AC' ELSE 'AF' END)`;

const SEARCH_TEXT = `CONCAT_WS(' ', c.claim_no, c.warranty_uid, vd.store_name, c.problem, c.description,
    JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.customer_name')), JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.customer_phone')),
    JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.registration_number')), JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.product_name')),
    JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.fitted_store')), JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.depot')),
    JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.car')), JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.foc_note')),
    JSON_UNQUOTE(JSON_EXTRACT(c.vehicle, '$.make')), JSON_UNQUOTE(JSON_EXTRACT(c.vehicle, '$.model')),
    JSON_UNQUOTE(JSON_EXTRACT(c.vehicle, '$.major_colour')), JSON_UNQUOTE(JSON_EXTRACT(c.vehicle, '$.minor_colour')),
    JSON_UNQUOTE(JSON_EXTRACT(c.decision, '$.item')), JSON_UNQUOTE(JSON_EXTRACT(c.plan_info, '$.alteration_no')),
    JSON_UNQUOTE(JSON_EXTRACT(c.dispatch, '$.docket')), JSON_UNQUOTE(JSON_EXTRACT(c.dispatch, '$.courier')))`;

/** Whether claims are open to franchises and customers (Admin › Claims › Live); the plant always has them. */
async function claimsLive(): Promise<boolean> {
    const [r]: any = await db.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'claims_live'");
    return r[0]?.setting_value === 'true';
}
const NOT_LIVE = 'Warranty claims are not open yet';

async function loadClaim(id: unknown) {
    const [rows]: any = await db.execute('SELECT * FROM warranty_claims WHERE id = ?', [Number(id) || 0]);
    return rows[0] ? fromRow(rows[0]) : null;
}

/**
 * Whether the signed-in person may see this claim, and as what: the store on
 * it acts on it; a distributor of that store only watches.
 */
async function access(req: AuthRequest, c: any): Promise<'act' | 'view' | null> {
    const role = req.user?.role;
    if (role === 'admin') return 'act';
    /* A sheet row is the plant's record: the store and its distributors may see it
       (each while Claims › Sheet sync allows), never act on it — the sheet is the master. */
    if (c.raised_via === 'sheet') {
        if (role !== 'vendor' || !c.store_id) return null;
        const seen = await sheetSeen();
        const v = await storeOf(req.user!.id);
        if (seen.store && v && String(v.id) === String(c.store_id)) return 'view';
        return seen.distributor && (await distributorStoreIds(req.user!.id)).includes(String(c.store_id)) ? 'view' : null;
    }
    if (role === 'vendor') {
        const v = await storeOf(req.user!.id);
        if (v && String(v.id) === String(c.store_id)) return 'act';
        return (await distributorStoreIds(req.user!.id)).includes(String(c.store_id)) ? 'view' : null;
    }
    return String(c.customer_user_id) === String(req.user?.id) ? 'act' : null;
}

/** How many claims this warranty and this customer have had, and how they ended. */
async function claimCounts(c: any) {
    // A row from the production sheet has no warranty to count against.
    if (!c.warranty_uid) return { on_warranty: 1, approved_before: 0, rejected_before: 0, customer_total: 0 };
    const [w]: any = await db.execute(
        `SELECT id, status, JSON_UNQUOTE(JSON_EXTRACT(decision, '$.outcome')) AS outcome FROM warranty_claims WHERE warranty_uid = ?`,
        [c.warranty_uid]);
    const phone = String(c.snapshot?.customer_phone ?? '').replace(/\D/g, '').slice(-10);
    let customer = 0;
    if (phone.length === 10) {
        const [p]: any = await db.execute(
            `SELECT COUNT(*) AS n FROM warranty_claims WHERE RIGHT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.customer_phone')), '[^0-9]', ''), 10) = ?`,
            [phone]);
        customer = Number(p[0]?.n || 0);
    }
    const earlier = w.filter((r: any) => r.id !== c.id);
    return {
        on_warranty: w.length,
        approved_before: earlier.filter((r: any) => r.outcome && r.outcome !== 'reject').length,
        rejected_before: earlier.filter((r: any) => r.outcome === 'reject').length,
        customer_total: customer,
    };
}

/** A claim as the screens read it, with the steps open to this person. */
function view(c: any, who: Who, watching = false) {
    const flow: FlowClaim = { ...c, trail: c.trail ?? [] };
    const out: any = {
        ...c, trail: undefined, trail_length: (c.trail ?? []).length,
        actions: watching ? [] : actionsFor(flow, who),
        status_text: STATUS_TEXT[c.status as ClaimStatus] ?? c.status,
        waiting_on: waitingOn(c.status),
        problem_text: PROBLEMS[c.problem]?.label ?? c.problem,
        watching,
    };
    if (who.actor !== 'admin') {
        // Who in the plant did what stays inside; the store, distributor and
        // customer see "Autoform" and the notes meant for them.
        out.history = (c.history ?? []).map((h: HistoryEntry) => ({ ...h, by: undefined, by_name: h.by_role === 'admin' ? 'Autoform' : h.by_name }));
    }
    if (who.actor === 'customer') {
        // Store-side corrections are between the store and the plant.
        out.history = out.history.map((h: HistoryEntry) => ({ ...h, changes: undefined }));
    }
    return out;
}

/** Tells the customer, the store and the plant what they each need to know. */
async function tell(c: any, text: string, who: { customer?: boolean; store?: boolean; plant?: boolean }) {
    const title = `Claim ${c.claim_no}`;
    // A local run uses the live database: nobody real is told about test claims.
    if (process.env.DISABLE_SCHEDULERS === '1') {
        console.log(`[Claims] ${title} — not sent locally (${Object.keys(who).filter(k => (who as any)[k]).join(', ')}): ${text}`);
        return;
    }
    try {
        if (who.customer && c.customer_user_id) {
            await NotificationService.notify(c.customer_user_id, { title, message: text, type: 'warranty', link: '/dashboard/customer/claims' });
        }
        if (who.store && c.store_id) {
            const [s]: any = await db.execute('SELECT user_id FROM vendor_details WHERE id = ?', [c.store_id]);
            if (s[0]?.user_id) await NotificationService.notify(s[0].user_id, { title, message: text, type: 'warranty', link: '/dashboard/vendor' });
        }
        if (who.plant) {
            await NotificationService.broadcast({ title, message: text, type: 'warranty', targetRole: 'admin' });
        }
    } catch (e) {
        console.error('Claim notification failed:', e);
    }
}

async function save(c: any) {
    await db.execute(
        `UPDATE warranty_claims SET kind = ?, status = ?, problem = ?, description = ?, media = ?, vehicle = ?, verification = ?, hold_info = ?, decision = ?,
                consent = ?, plan_info = ?, dispatch = ?, fitted = ?, old_part = ?, change_request = ?, trail = ?, history = ? WHERE id = ?`,
        [c.kind, c.status, c.problem, c.description ?? null, json(c.media ?? []), json(c.vehicle), json(c.verification), json(c.hold), json(c.decision),
            json(c.consent), json(c.plan), json(c.dispatch), json(c.fitted), json(c.old_part), json(c.change_request ?? null), json(c.trail ?? []), json(c.history ?? []), c.id]);
}

/** The claim's own fields from what was sent, checked against its warranty. */
function readNew(w: any, b: any): { problem: string; description: string | null; vehicle: any } | { error: string } {
    if (w.status !== 'validated') return { error: 'Warranty is not approved yet' };
    const cov = coverage(w);
    const p = readProblem(b, cov.covered);
    if ('error' in p) return p;
    const vehicle = readVehicle(b, w.product_type);
    if ('error' in vehicle) return vehicle;
    return { ...p, vehicle };
}

/** Creates a claim on a warranty; the caller has checked who may raise it. */
async function createClaim(req: AuthRequest, w: any, input: { problem: string; description: string | null; vehicle: any; storeId: string | null; via: string; media: string[] }) {
    const snapshot = snapshotOf(w);
    const raisedBy = actorOf(req);
    const history: HistoryEntry[] = [entry(req, {
        action: 'raised', status: 'verify',
        text: raisedBy === 'vendor' ? 'Raised by the store' : raisedBy === 'admin' ? 'Raised by the plant' : 'Raised by the customer',
        note: input.description,
    })];
    const [r]: any = await db.execute(
        `INSERT INTO warranty_claims (kind, warranty_uid, warranty_id, customer_user_id, store_id, raised_by_role, raised_by, raised_via, problem, description, vehicle, media, snapshot, status, history, trail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verify', ?, '[]')`,
        [kindOf(input.problem), w.uid, w.id ?? null, w.user_id ?? null, input.storeId, raisedBy, req.user?.id ?? null, input.via,
            input.problem, input.description, json(input.vehicle), json(input.media), json(snapshot), json(history)]);
    const claimNo = `WC-${String(r.insertId).padStart(4, '0')}`;
    await db.execute('UPDATE warranty_claims SET claim_no = ? WHERE id = ?', [claimNo, r.insertId]);
    return loadClaim(r.insertId);
}

const ok = (res: Response, data: any, status = 200) => res.status(status).json({ success: true, ...data });
const bad = (res: Response, error: string, status = 400) => res.status(status).json({ success: false, error });

const problemLabel = (c: any) => PROBLEMS[c.problem]?.label ?? c.problem;

export default class ClaimsController {
    /* ─── Customer ─────────────────────────────────────────────────────── */

    /** The customer's warranties (with what can be claimed) and their claims. */
    static async mine(req: AuthRequest, res: Response) {
        try {
            if (!(await claimsLive())) return ok(res, { claims: [], warranties: [], distributor_claims: [], live: false });
            const [ws]: any = await db.execute(
                `SELECT * FROM warranty_registrations WHERE user_id = ? AND status IN ('validated','pending','pending_vendor') ORDER BY created_at DESC LIMIT 50`,
                [req.user!.id]);
            const [cs]: any = await db.execute('SELECT * FROM warranty_claims WHERE customer_user_id = ? ORDER BY id DESC LIMIT 100', [req.user!.id]);
            return ok(res, { warranties: ws.map(warrantyCard), claims: cs.map(fromRow).map((c: any) => view(c, { actor: 'customer' })) });
        } catch (e) {
            console.error('claims.mine', e);
            return bad(res, 'Could not load your claims', 500);
        }
    }

    /** A customer requests a claim on one of their own warranties. */
    static async raise(req: AuthRequest, res: Response) {
        try {
            if (!(await claimsLive())) return bad(res, NOT_LIVE, 403);
            const b = req.body ?? {};
            const [ws]: any = await db.execute('SELECT * FROM warranty_registrations WHERE uid = ? AND user_id = ? LIMIT 1', [String(b.warranty_uid ?? ''), req.user!.id]);
            const w = ws[0];
            if (!w) return bad(res, 'Warranty not found on your account', 404);
            const fields = readNew(w, b);
            if ('error' in fields) return bad(res, fields.error);
            const media = filesOf(req, 'media');
            if (!media.some(isPhoto)) return bad(res, 'Add at least one photo of the problem');
            const vehiclePhoto = filesOf(req, 'vehicle_photo').find(isPhoto);
            if (!vehiclePhoto) return bad(res, 'Add a photo of the vehicle');
            fields.vehicle = { ...fields.vehicle, photo: vehiclePhoto };
            let storeId: string | null = w.vendor_details_id ?? null;
            if (b.store_id) {
                const [s]: any = await db.execute('SELECT id FROM vendor_details WHERE id = ?', [String(b.store_id)]);
                if (!s[0]) return bad(res, 'Choose the store to check it');
                storeId = s[0].id;
            }
            if (!storeId) return bad(res, 'Choose the store to check it');
            const c = await createClaim(req, w, { ...fields, storeId, via: 'web', media });
            await tell(c, `New claim from ${c.snapshot?.customer_name || 'a customer'}: ${problemLabel(c)}. Please verify it.`, { store: true });
            return ok(res, { claim: view(c, { actor: 'customer' }) }, 201);
        } catch (e) {
            console.error('claims.raise', e);
            return bad(res, 'Could not raise the claim', 500);
        }
    }

    /* ─── Store and distributor ────────────────────────────────────────── */

    /** The store's claims, and for a distributor its stores' claims to watch. */
    static async storeList(req: AuthRequest, res: Response) {
        try {
            if (!(await claimsLive())) return ok(res, { claims: [], warranties: [], distributor_claims: [], live: false });
            const v = await storeOf(req.user!.id);
            // Rows from the production sheet show while Claims › Sheet sync lets them.
            const seen = await sheetSeen();
            const own: any[] = v ? (await db.execute(`SELECT * FROM warranty_claims WHERE store_id = ? ${seen.store ? '' : "AND raised_via <> 'sheet'"} ORDER BY id DESC LIMIT 300`, [v.id]) as any)[0] : [];
            const storeIds = (await distributorStoreIds(req.user!.id)).filter(id => !v || id !== String(v.id));
            let watched: any[] = [];
            if (storeIds.length) {
                const [rows]: any = await db.query(
                    `SELECT c.*, vd.store_name FROM warranty_claims c JOIN vendor_details vd ON vd.id = c.store_id
                      WHERE c.store_id IN (?) ${seen.distributor ? '' : "AND c.raised_via <> 'sheet'"} ORDER BY c.id DESC LIMIT 300`, [storeIds]);
                watched = rows;
            }
            return ok(res, {
                // A sheet row is shown, not worked on: the sheet is the master.
                claims: own.map(fromRow).map((c: any) => view(c, { actor: 'vendor' }, c.raised_via === 'sheet')),
                distributor_claims: watched.map(fromRow).map((c: any) => view(c, { actor: 'vendor' }, true)),
                is_distributor: storeIds.length > 0,
            });
        } catch (e) {
            console.error('claims.storeList', e);
            return bad(res, 'Could not load claims', 500);
        }
    }

    /**
     * The store's own approved warranties, newest first, so it can pick a
     * customer without typing; the screen filters them as the store types.
     */
    static async storeWarranties(req: AuthRequest, res: Response) {
        try {
            const v = await storeOf(req.user!.id);
            if (!v) return bad(res, 'Store not found', 404);
            const [ws]: any = await db.execute(
                `SELECT * FROM warranty_registrations WHERE vendor_details_id = ? AND status = 'validated' ORDER BY created_at DESC LIMIT 500`,
                [v.id]);
            return ok(res, { warranties: ws.map(warrantyCard) });
        } catch (e) {
            console.error('claims.storeWarranties', e);
            return bad(res, 'Could not load your warranties', 500);
        }
    }

    /** Warranties by the customer's phone, the UID or the car number, across all stores. */
    static async storeSearch(req: AuthRequest, res: Response) {
        try {
            const q = String(req.query.q ?? '').trim();
            if (q.length < 4) return bad(res, 'Enter the phone number, UID or car number');
            const digits = q.replace(/\D/g, '');
            const reg = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const [ws]: any = await db.execute(
                `SELECT * FROM warranty_registrations
                  WHERE uid = ?
                     OR (? <> '' AND RIGHT(REGEXP_REPLACE(customer_phone, '[^0-9]', ''), 10) = ?)
                     OR (? <> '' AND REGEXP_REPLACE(UPPER(registration_number), '[^A-Z0-9]', '') = ?)
                  ORDER BY created_at DESC LIMIT 20`,
                [q, digits.length >= 10 ? 'y' : '', digits.slice(-10), reg.length >= 6 ? 'y' : '', reg]);
            return ok(res, { warranties: ws.map(warrantyCard) });
        } catch (e) {
            console.error('claims.storeSearch', e);
            return bad(res, 'Search failed', 500);
        }
    }

    /**
     * The store raises a claim for a customer at the counter. It has the
     * customer in front of it, so its verification is done there and then and
     * the claim goes straight to the plant.
     */
    static async storeRaise(req: AuthRequest, res: Response) {
        try {
            if (!(await claimsLive())) return bad(res, NOT_LIVE, 403);
            const v = await storeOf(req.user!.id);
            if (!v) return bad(res, 'Store not found', 404);
            const b = req.body ?? {};
            const [ws]: any = await db.execute('SELECT * FROM warranty_registrations WHERE uid = ? LIMIT 1', [String(b.warranty_uid ?? '')]);
            const w = ws[0];
            if (!w) return bad(res, 'Warranty not found', 404);
            const fields = readNew(w, b);
            if ('error' in fields) return bad(res, fields.error);
            const media = filesOf(req, 'media');
            if (!media.some(isPhoto)) return bad(res, 'Add at least one photo of the problem');
            const vehiclePhoto = filesOf(req, 'vehicle_photo').find(isPhoto);
            if (vehiclePhoto) fields.vehicle = { ...fields.vehicle, photo: vehiclePhoto };

            const c = await createClaim(req, w, { ...fields, storeId: v.id, via: 'store', media });
            const done = applyClaimAction(c, 'verify', { actor: 'vendor' }, { note: b.remarks });
            if ('error' in done) return bad(res, done.error);
            const next: any = { ...done.claim, history: [...c.history, entry(req, { action: 'verify', status: 'review', text: stepText('verify', done.claim), note: done.claim.verification?.remarks })] };
            await save(next);
            await tell(next, `Raised for you by ${v.store_name || 'your store'}: ${problemLabel(next)}. The plant will decide next.`, { customer: true });
            await tell(next, `${v.store_name || 'A store'} raised a claim: ${problemLabel(next)}. Waiting for a decision.`, { plant: true });
            return ok(res, { claim: view(next, { actor: 'vendor' }) }, 201);
        } catch (e) {
            console.error('claims.storeRaise', e);
            return bad(res, 'Could not raise the claim', 500);
        }
    }

    /* ─── Plant ────────────────────────────────────────────────────────── */

    /**
     * Every claim for the plant's sheet, filtered by search, store, dates and
     * charge; the queue counts follow the same filters, so each queue says how
     * many of what is shown are in it.
     */
    static async adminList(req: AuthRequest, res: Response) {
        try {
            const status = String(req.query.status ?? '');
            const q = String(req.query.q ?? '').trim().slice(0, 120);
            const store = String(req.query.store ?? '').trim();
            const depot = String(req.query.depot ?? '').trim().slice(0, 120);
            const brand = String(req.query.brand ?? '');
            const from = String(req.query.from ?? '');
            const to = String(req.query.to ?? '');
            const charge = String(req.query.charge ?? '');
            const where: string[] = [];
            const params: any[] = [];
            // Search: every word must be found somewhere on the claim.
            if (q) {
                for (const word of q.split(/\s+/).filter(Boolean).slice(0, 6)) {
                    where.push(`${SEARCH_TEXT} LIKE ?`);
                    params.push(`%${word}%`);
                }
            }
            // A store is its id, or the sheet's name for a row with no portal store.
            if (store.startsWith('name:')) {
                where.push("c.raised_via = 'sheet' AND JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.fitted_store')) = ?");
                params.push(store.slice(5));
            } else if (store) { where.push("c.store_id = ? AND c.raised_via <> 'sheet'"); params.push(store); }
            // The depot a sheet row came through (the sheet's DEPOT NAME).
            if (depot) { where.push("JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.depot')) = ?"); params.push(depot); }
            if (brand === 'AF' || brand === 'AC') { where.push(`${CLAIM_BRAND} = ?`); params.push(brand); }
            if (DATE_ONLY.test(from)) { where.push('DATE(c.created_at) >= ?'); params.push(from); }
            if (DATE_ONLY.test(to)) { where.push('DATE(c.created_at) <= ?'); params.push(to); }
            if (charge === 'foc' || charge === 'chargeable') {
                where.push("JSON_UNQUOTE(JSON_EXTRACT(c.decision, '$.charge')) = ?");
                params.push(charge);
            }
            const filtered = where.length ? `WHERE ${where.join(' AND ')}` : '';

            const listWhere = [...where];
            const listParams = [...params];
            const statuses = status.split(',').filter(s => s in STATUS_TEXT);
            if (statuses.length) { listWhere.push(`c.status IN (${statuses.map(() => '?').join(',')})`); listParams.push(...statuses); }
            // "change": the claims with a change asked for, waiting for the plant.
            if (status.split(',').includes('change')) listWhere.push('c.change_request IS NOT NULL');

            const FROM = 'FROM warranty_claims c LEFT JOIN vendor_details vd ON vd.id = c.store_id';
            const [cs]: any = await db.execute(
                `SELECT c.*, vd.store_name, ${CLAIM_BRAND} AS brand ${FROM} ${listWhere.length ? `WHERE ${listWhere.join(' AND ')}` : ''} ORDER BY c.created_at DESC, c.id DESC LIMIT 1000`, listParams);
            const [n]: any = await db.execute(
                `SELECT c.status, COUNT(*) AS n, SUM(c.change_request IS NOT NULL) AS ch ${FROM} ${filtered} GROUP BY c.status`, params);
            const counts: Record<string, number> = { change: 0 };
            for (const r of n) { counts[r.status] = Number(r.n); counts.change += Number(r.ch || 0); }
            // The stores to filter by: portal stores, and the sheet's names for rows with none.
            // A sheet claim is filtered by the sheet's party name; a portal claim by its store.
            const [st]: any = await db.execute(
                `SELECT CASE WHEN c.raised_via = 'sheet' THEN NULL ELSE c.store_id END AS id,
                        CASE WHEN c.raised_via = 'sheet' THEN JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.fitted_store')) ELSE vd.store_name END AS name, COUNT(*) AS n
                   ${FROM} GROUP BY id, name HAVING name IS NOT NULL ORDER BY name`);
            const stores = st.map((r: any) => ({ value: r.id ?? `name:${r.name}`, name: r.name, n: Number(r.n), portal: Boolean(r.id) }));
            // The depots to filter by, with how many claims each.
            const [dp]: any = await db.execute(
                `SELECT JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.depot')) AS name, COUNT(*) AS n
                   FROM warranty_claims c GROUP BY name HAVING name IS NOT NULL AND name <> '' AND name <> 'null' ORDER BY name`);
            const depots = dp.map((r: any) => ({ value: String(r.name), name: String(r.name), n: Number(r.n) }));
            const who = whoOf(req);
            return ok(res, {
                claims: cs.map(fromRow).map((c: any) => view(c, who)), counts, stores, depots,
                total: Object.entries(counts).reduce((a, [k, v]) => (k === 'change' ? a : a + v), 0),
                rights: who.rights ?? [],
            });
        } catch (e) {
            console.error('claims.adminList', e);
            return bad(res, 'Could not load claims', 500);
        }
    }

    /* ─── Everyone ─────────────────────────────────────────────────────── */

    /** One claim with its history counts, for whoever may see it. */
    static async detail(req: AuthRequest, res: Response) {
        try {
            const c = await loadClaim(req.params.id);
            const can = c && await access(req, c);
            if (!c || !can) return bad(res, 'Claim not found', 404);
            const who = whoOf(req);
            const [s]: any = await db.execute(
                'SELECT vd.store_name, vd.city, p.phone_number AS phone FROM vendor_details vd LEFT JOIN profiles p ON p.id = vd.user_id WHERE vd.id = ?', [c.store_id ?? '']);
            const out = view(c, who, can === 'view');
            const [[b]]: any = await db.execute(
                `SELECT ${CLAIM_BRAND} AS brand FROM warranty_claims c LEFT JOIN vendor_details vd ON vd.id = c.store_id WHERE c.id = ?`, [c.id]);
            out.brand = b?.brand ?? 'AF';
            out.store_name = s[0]?.store_name ?? null;
            out.store_city = s[0]?.city ?? null;
            out.store_phone = s[0]?.phone ?? null;
            if (who.actor !== 'customer') {
                out.counts = await claimCounts(c);
                out.registration = await registrationFor(c, who.actor);
                if (out.counts.on_warranty > 1 && out.registration) {
                    out.registration.checks.push({ tone: out.counts.approved_before ? 'warn' : 'info', text: `${out.counts.on_warranty - 1} earlier claim${out.counts.on_warranty > 2 ? 's' : ''} on this warranty · ${out.counts.approved_before} approved` });
                }
            } else {
                // The customer sees their own product as fitted, beside the claim; no checks.
                const r = await registrationFor(c, who.actor);
                out.registration = r && {
                    uid: r.uid, product_name: r.product_name, car: r.car, car_colour: r.car_colour, registration_number: r.registration_number,
                    warranty_type: r.warranty_type, fitted_on: r.fitted_on, cover_end: r.cover_end, fitted_store: r.fitted_store, fitted_city: r.fitted_city,
                    photos: r.photos, checks: [],
                };
            }
            return ok(res, { claim: out });
        } catch (e) {
            console.error('claims.detail', e);
            return bad(res, 'Could not load the claim', 500);
        }
    }

    /**
     * One photo of a claim, sent as a download: the claim's own photos, the
     * store's and the plant's, and its warranty's registration photos. Any
     * other address is refused, so this cannot be used to fetch something else.
     */
    static async file(req: AuthRequest, res: Response) {
        try {
            const c = await loadClaim(req.params.id);
            const can = c && await access(req, c);
            if (!c || !can) return bad(res, 'Claim not found', 404);
            const u = String(req.query.u ?? '');
            const reg = await registrationFor(c, whoOf(req).actor);
            const allowed = new Set<string>([
                ...(c.media ?? []), ...(c.vehicle?.photo ? [c.vehicle.photo] : []), ...(c.verification?.photos ?? []), ...(c.fitted?.photos ?? []), ...(c.change_request?.photos ?? []),
                ...(reg?.photos ?? []).map((p: any) => p.url),
            ]);
            if (!u || !allowed.has(u)) return bad(res, 'File not found', 404);
            const name = path.basename(u.split('?')[0]) || 'photo.jpg';
            // Ours on this server's disk; anything else (older photos) is fetched and passed on.
            if (u.startsWith(`${APP_URL}/uploads/`)) {
                const p = path.resolve(urlToDiskPath(u));
                if (p.startsWith(path.resolve(UPLOADS_BASE_DIR) + path.sep) && fs.existsSync(p)) return res.download(p, name);
            }
            const r = await fetch(u);
            if (!r.ok) return bad(res, 'File not found', 404);
            res.setHeader('Content-Type', r.headers.get('content-type') ?? 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
            return res.send(Buffer.from(await r.arrayBuffer()));
        } catch (e) {
            console.error('claims.file', e);
            return bad(res, 'Could not get the file', 500);
        }
    }

    /** A step on a claim by the customer, the store or the plant. */
    static async act(req: AuthRequest, res: Response) {
        try {
            const c = await loadClaim(req.params.id);
            const can = c && await access(req, c);
            if (!c || !can) return bad(res, 'Claim not found', 404);
            if (can === 'view') return bad(res, 'You can only view this claim', 403);
            const who = whoOf(req);
            const action = String(req.body?.action ?? '') as ClaimAction;
            const input = { ...req.body, photos: filesOf(req, 'photos') };
            delete input.action;
            const r = applyClaimAction({ ...c, trail: c.trail ?? [] }, action, who, input);
            if ('error' in r) return bad(res, r.error);
            const next: any = r.claim;
            const vehiclePhoto = filesOf(req, 'vehicle_photo').find(isPhoto);
            if (vehiclePhoto && ['verify', 'change', 'resend'].includes(action)) {
                next.vehicle = { ...(next.vehicle ?? {}), photo: vehiclePhoto };
                r.changes.push('Vehicle photo added');
            }

            const history: HistoryEntry[] = [...(c.history ?? [])];
            if (action === 'undo') {
                for (let i = history.length - 1; i >= 0; i--) {
                    const h = history[i];
                    if (!h.undone && !['undo', 'raised'].includes(h.action)) { history[i] = { ...h, undone: true }; break; }
                }
            }
            const note = action === 'verify' ? next.verification?.remarks
                : action === 'redecide' ? [req.body?.change_reason, req.body?.note].map(x => String(x ?? '').trim()).filter(Boolean).join(' · ').slice(0, 1000) || null
                    : String(req.body?.note ?? '').trim().slice(0, 1000) || null;
            history.push(entry(req, { action, status: next.status, text: stepText(action, next), note, changes: r.changes.length ? r.changes : undefined }));
            next.history = history;
            await save(next);

            if (who.actor === 'admin') {
                await ActivityLogService.log({
                    adminId: req.user!.id, adminName: (req.user as any)?.name, adminEmail: (req.user as any)?.email,
                    actionType: 'WARRANTY_CLAIM_ACTION', targetType: 'warranty_claim', targetId: String(c.id), targetName: c.claim_no,
                    details: { action, status: next.status, note, changes: r.changes },
                } as any);
            }

            const t = stepText(action, next) + (note && !['verify', 'edit', 'undo'].includes(action) ? ` · ${note.slice(0, 160)}` : '');
            switch (action) {
                case 'verify': await tell(next, `${t}: ${problemLabel(next)}. Waiting for a decision.`, { plant: true }); break;
                case 'ask_more': await tell(next, t, { store: true }); break;
                case 'hold': case 'reject': case 'plan': case 'ready': case 'dispatch': await tell(next, t, { store: true, customer: true }); break;
                case 'approve':
                    if (next.status === 'consent') {
                        await tell(next, `${t}. Please agree to the charge so the plant can go ahead.`, { customer: true });
                        await tell(next, `${t}. Get the customer's agreement to the charge.`, { store: true });
                    } else await tell(next, t, { store: true, customer: true });
                    break;
                case 'consent': case 'decline': await tell(next, t, { plant: true, store: who.actor === 'customer', customer: who.actor !== 'customer' }); break;
                case 'fitted':
                    await tell(next, `${t}. Your claim is closed.`, { customer: true });
                    if (who.actor !== 'admin') await tell(next, `${t}: claim closed.`, { plant: true });
                    break;
                case 'dispatch_info':
                    // The moment it becomes dispatched, the store and the customer hear of it.
                    if (next.status === 'dispatched' && c.status !== 'dispatched') await tell(next, t, { store: true, customer: true });
                    break;
                case 'redecide':
                    await tell(next, t, { store: true, customer: next.status !== 'verify' });
                    if (next.status === 'consent') await tell(next, 'Please agree to the charge so the plant can go ahead.', { customer: true });
                    break;
                case 'edit':
                    await tell(next, `Claim details updated: ${r.changes.join('; ').slice(0, 200)}`, { store: true });
                    // A decision changed to chargeable waits for the customer's answer again.
                    if (next.status === 'consent' && c.status !== 'consent') await tell(next, 'This claim is now chargeable. Please agree to the charge so the plant can go ahead.', { customer: true });
                    break;
                case 'undo': await tell(next, t, { store: true }); break;
                case 'change': case 'resend':
                    // A customer's change goes to the store first; the store's to the plant.
                    if (who.actor === 'customer') await tell(next, `${t}: ${r.changes.join('; ').slice(0, 200)}`, { store: true });
                    else await tell(next, `${t}: ${r.changes.join('; ').slice(0, 200)}`, { plant: true, customer: action === 'resend' });
                    break;
                case 'ask_change': await tell(next, `${t}: ${r.changes.join('; ').slice(0, 200)}`, { plant: true }); break;
                case 'change_ok': case 'change_no': await tell(next, t, { store: true, customer: true }); break;
            }
            return ok(res, { claim: view(next, who) });
        } catch (e) {
            console.error('claims.act', e);
            return bad(res, 'Could not save the step', 500);
        }
    }

    /** The lists the screens choose from, and what this person may do. */
    static async meta(req: AuthRequest, res: Response) {
        return ok(res, {
            problems: PROBLEMS, reasons: REJECT_REASONS, hold_reasons: HOLD_REASONS, statuses: STATUS_TEXT,
            rights: whoOf(req).rights ?? [], old_part: OLD_PART_ENABLED,
            models: modelList(whoOf(req).actor === 'customer'),
            // The plant's own vehicle names, for the store and the plant (they hold Maruti names, so never the customer).
            ...(whoOf(req).actor !== 'customer' && { plant_vehicles: PLANT_VEHICLES }),
        });
    }
}
