import { Response } from 'express';
import db from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { vendorRepository } from '../repositories/vendor.repository.js';
import { NotificationService } from '../services/notification.service.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { APP_URL } from '../config/localUpload.js';
import {
    applyClaimAction, actionsFor, coverage, problemsFor, kindOf, stepText, STATUS_TEXT, REJECT_REASONS, PROBLEMS,
    type Actor, type ClaimAction, type ClaimKind, type FlowClaim, type ClaimStatus,
} from '../services/claimFlow.js';

/** One line on a claim's timeline. */
interface HistoryEntry {
    action: ClaimAction | 'raised' | 'old_part';
    status: ClaimStatus;
    text: string;
    note?: string | null;
    at: string;
    by_role: Actor;
    by: string | null;
    by_name: string | null;
    undone?: boolean;
}

const JSON_COLS = ['media', 'snapshot', 'inspection', 'decision', 'payment', 'dispatch', 'fixed', 'old_part', 'trail', 'history'];
const parse = (v: any) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v ?? null);
const withJson = (row: any) => { const out = { ...row }; for (const c of JSON_COLS) out[c] = parse(row[c]); return out; };
const json = (v: any) => (v === null || v === undefined ? null : JSON.stringify(v));

const actorOf = (req: AuthRequest): Actor =>
    req.user?.role === 'admin' ? 'admin' : req.user?.role === 'vendor' ? 'vendor' : 'customer';

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
 * signals and remarks are head office's alone.
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

async function loadClaim(id: unknown) {
    const [rows]: any = await db.execute('SELECT * FROM warranty_claims WHERE id = ?', [Number(id) || 0]);
    return rows[0] ? withJson(rows[0]) : null;
}

/** Whether the signed-in person may see this claim. */
async function canSee(req: AuthRequest, c: any): Promise<boolean> {
    const role = req.user?.role;
    if (role === 'admin') return true;
    if (role === 'vendor') {
        const v = await storeOf(req.user!.id);
        return !!v && String(v.id) === String(c.store_id);
    }
    return String(c.customer_user_id) === String(req.user?.id);
}

/** How many claims this warranty and this customer have had, and how they ended. */
async function claimCounts(c: any) {
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
function view(c: any, actor: Actor) {
    const flow: FlowClaim = { ...c, trail: c.trail ?? [] };
    const out: any = {
        ...c, trail: undefined, trail_length: (c.trail ?? []).length,
        actions: actionsFor(flow, actor), status_text: STATUS_TEXT[c.status as ClaimStatus] ?? c.status,
        problem_text: PROBLEMS[c.problem]?.label ?? c.problem,
    };
    if (actor !== 'admin') {
        // Head office's working (amount edits, who in the office) stays inside;
        // the store and customer see the outcome and the notes meant for them.
        out.history = (c.history ?? []).map((h: HistoryEntry) => ({ ...h, by: undefined, by_name: h.by_role === 'admin' ? 'Autoform' : h.by_name }));
    }
    return out;
}

/** Tells the customer, the store and head office what they each need to know. */
async function tell(c: any, text: string, who: { customer?: boolean; store?: boolean; admins?: boolean }) {
    const title = `Claim ${c.claim_no}`;
    try {
        if (who.customer && c.customer_user_id) {
            await NotificationService.notify(c.customer_user_id, { title, message: text, type: 'warranty', link: '/dashboard/customer/claims' });
        }
        if (who.store && c.store_id) {
            const [s]: any = await db.execute('SELECT user_id FROM vendor_details WHERE id = ?', [c.store_id]);
            if (s[0]?.user_id) await NotificationService.notify(s[0].user_id, { title, message: text, type: 'warranty', link: '/dashboard/vendor' });
        }
        if (who.admins) {
            await NotificationService.broadcast({ title, message: text, type: 'warranty', targetRole: 'admin' });
        }
    } catch (e) {
        console.error('Claim notification failed:', e);
    }
}

async function save(c: any) {
    await db.execute(
        `UPDATE warranty_claims SET status = ?, inspection = ?, decision = ?, payment = ?, dispatch = ?, fixed = ?, old_part = ?, trail = ?, history = ? WHERE id = ?`,
        [c.status, json(c.inspection), json(c.decision), json(c.payment), json(c.dispatch), json(c.fixed), json(c.old_part), json(c.trail ?? []), json(c.history ?? []), c.id]);
}

/** Creates a claim on a warranty; the caller has checked who may raise it. */
async function createClaim(req: AuthRequest, w: any, input: { kind: ClaimKind; problem: string; description: string; storeId: string | null; via: string; media: string[] }) {
    const snapshot = snapshotOf(w);
    const raisedBy = actorOf(req);
    const history: HistoryEntry[] = [entry(req, {
        action: 'raised', status: 'inspect',
        text: raisedBy === 'vendor' ? 'Raised by the store' : raisedBy === 'admin' ? 'Raised by head office' : 'Raised by the customer',
        note: input.description || null,
    })];
    const [r]: any = await db.execute(
        `INSERT INTO warranty_claims (kind, warranty_uid, warranty_id, customer_user_id, store_id, raised_by_role, raised_by, raised_via, problem, description, media, snapshot, status, history, trail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inspect', ?, '[]')`,
        [input.kind, w.uid, w.id ?? null, w.user_id ?? null, input.storeId, raisedBy, req.user?.id ?? null, input.via,
            input.problem, input.description || null, json(input.media), json(snapshot), json(history)]);
    const claimNo = `WC-${String(r.insertId).padStart(4, '0')}`;
    await db.execute('UPDATE warranty_claims SET claim_no = ? WHERE id = ?', [claimNo, r.insertId]);
    return loadClaim(r.insertId);
}

/** Checks a new claim's fields against its warranty; the error to show, if any. */
function checkNew(w: any, problem: unknown, description: string): string | null {
    if (w.status !== 'validated') return 'Warranty is not approved yet';
    if (problem !== 'alteration') {
        const cov = coverage(w);
        if (!cov.covered) return cov.why || 'This warranty cannot be claimed';
    }
    if (!problemsFor(w.product_type).includes(String(problem))) return 'Choose the problem';
    if (['product_defect', 'alteration'].includes(String(problem)) && description.length < 5) return 'Describe the problem';
    return null;
}

const ok = (res: Response, data: any, status = 200) => res.status(status).json({ success: true, ...data });
const bad = (res: Response, error: string, status = 400) => res.status(status).json({ success: false, error });

export default class ClaimsController {
    /* ─── Customer ─────────────────────────────────────────────────────── */

    /** The customer's warranties (with what can be claimed) and their claims. */
    static async mine(req: AuthRequest, res: Response) {
        try {
            const [ws]: any = await db.execute(
                `SELECT * FROM warranty_registrations WHERE user_id = ? AND status IN ('validated','pending','pending_vendor') ORDER BY created_at DESC LIMIT 50`,
                [req.user!.id]);
            const [cs]: any = await db.execute('SELECT * FROM warranty_claims WHERE customer_user_id = ? ORDER BY id DESC LIMIT 100', [req.user!.id]);
            return ok(res, { warranties: ws.map(warrantyCard), claims: cs.map(withJson).map((c: any) => view(c, 'customer')) });
        } catch (e) {
            console.error('claims.mine', e);
            return bad(res, 'Could not load your claims', 500);
        }
    }

    /** A customer raises a claim on one of their own warranties. */
    static async raise(req: AuthRequest, res: Response) {
        try {
            const b = req.body ?? {};
            const [ws]: any = await db.execute('SELECT * FROM warranty_registrations WHERE uid = ? AND user_id = ? LIMIT 1', [String(b.warranty_uid ?? ''), req.user!.id]);
            const w = ws[0];
            if (!w) return bad(res, 'Warranty not found on your account', 404);
            const description = String(b.description ?? '').trim().slice(0, 2000);
            const problem = checkNew(w, b.problem, description);
            if (problem) return bad(res, problem);
            const media = filesOf(req, 'media');
            if (!media.some(isPhoto)) return bad(res, 'Add at least one photo of the problem');
            let storeId: string | null = w.vendor_details_id ?? null;
            if (b.store_id) {
                const [s]: any = await db.execute('SELECT id FROM vendor_details WHERE id = ?', [String(b.store_id)]);
                if (!s[0]) return bad(res, 'Choose the store for the inspection');
                storeId = s[0].id;
            }
            if (!storeId) return bad(res, 'Choose the store for the inspection');
            const c = await createClaim(req, w, { kind: kindOf(b.problem), problem: b.problem, description, storeId, via: 'web', media });
            await tell(c, `New claim from ${c.snapshot?.customer_name || 'a customer'}: ${PROBLEMS[c.problem]?.label}. Please check the car.`, { store: true });
            return ok(res, { claim: view(c, 'customer') }, 201);
        } catch (e) {
            console.error('claims.raise', e);
            return bad(res, 'Could not raise the claim', 500);
        }
    }

    /* ─── Store ────────────────────────────────────────────────────────── */

    /** The store's claims, newest first. */
    static async storeList(req: AuthRequest, res: Response) {
        try {
            const v = await storeOf(req.user!.id);
            if (!v) return bad(res, 'Store not found', 404);
            const [cs]: any = await db.execute('SELECT * FROM warranty_claims WHERE store_id = ? ORDER BY id DESC LIMIT 300', [v.id]);
            return ok(res, { claims: cs.map(withJson).map((c: any) => view(c, 'vendor')) });
        } catch (e) {
            console.error('claims.storeList', e);
            return bad(res, 'Could not load claims', 500);
        }
    }

    /** Warranties by the customer's phone, the UID or the car number, for the store to raise on. */
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

    /** The store raises a claim for a customer at the counter, with its inspection done there and then. */
    static async storeRaise(req: AuthRequest, res: Response) {
        try {
            const v = await storeOf(req.user!.id);
            if (!v) return bad(res, 'Store not found', 404);
            const b = req.body ?? {};
            const [ws]: any = await db.execute('SELECT * FROM warranty_registrations WHERE uid = ? LIMIT 1', [String(b.warranty_uid ?? '')]);
            const w = ws[0];
            if (!w) return bad(res, 'Warranty not found', 404);
            const description = String(b.description ?? '').trim().slice(0, 2000);
            const problem = checkNew(w, b.problem, description);
            if (problem) return bad(res, problem);
            const photos = filesOf(req, 'photos');
            // The inspection is checked before anything is saved, so a refused
            // one leaves no half-raised claim behind.
            const trial = applyClaimAction({ kind: kindOf(b.problem), status: 'inspect', inspection: null, decision: null, payment: null, dispatch: null, fixed: null }, 'inspect', 'vendor', { ...b, photos });
            if ('error' in trial) return bad(res, trial.error);

            const c = await createClaim(req, w, { kind: kindOf(b.problem), problem: b.problem, description, storeId: v.id, via: 'store', media: filesOf(req, 'media') });
            const done = applyClaimAction(c, 'inspect', 'vendor', { ...b, photos });
            if ('error' in done) return bad(res, done.error);
            const next = { ...done.claim, history: [...c.history, entry(req, { action: 'inspect', status: 'decide', text: stepText('inspect', done.claim), note: done.claim.inspection?.note })] };
            await save(next);
            await tell(next, `Raised for you by ${v.store_name || 'your store'}: ${PROBLEMS[next.problem]?.label}. Head office will decide next.`, { customer: true });
            await tell(next, `${v.store_name || 'A store'} raised and checked a claim: ${PROBLEMS[next.problem]?.label}. Waiting for your decision.`, { admins: true });
            return ok(res, { claim: view(next, 'vendor') }, 201);
        } catch (e) {
            console.error('claims.storeRaise', e);
            return bad(res, 'Could not raise the claim', 500);
        }
    }

    /** The store records the defective part: sent back to the plant, or scrapped there. */
    static async oldPart(req: AuthRequest, res: Response) {
        try {
            const c = await loadClaim(req.params.id);
            if (!c || !(await canSee(req, c))) return bad(res, 'Claim not found', 404);
            const want = c.decision?.old_part;
            if (!want) return bad(res, 'Head office has not asked for the old part');
            const b = req.body ?? {};
            const photos = filesOf(req, 'photos');
            const courier = String(b.courier ?? '').trim().slice(0, 80);
            if (want === 'return' && !courier) return bad(res, 'Enter how the old part was sent');
            if (want === 'scrap' && !photos.length) return bad(res, 'Add a photo of the scrapped part');
            c.old_part = { done: want === 'return' ? 'returned' : 'scrapped', courier: courier || null, tracking: String(b.tracking ?? '').trim().slice(0, 80) || null, note: String(b.note ?? '').trim().slice(0, 500) || null, photos, at: new Date().toISOString() };
            c.history = [...(c.history ?? []), entry(req, { action: 'old_part', status: c.status, text: want === 'return' ? `Old part sent back · ${courier}` : 'Old part scrapped at the store', note: c.old_part.note })];
            await save(c);
            await tell(c, want === 'return' ? `The store sent the old part back · ${courier}` : 'The store scrapped the old part', { admins: true });
            return ok(res, { claim: view(c, actorOf(req)) });
        } catch (e) {
            console.error('claims.oldPart', e);
            return bad(res, 'Could not save', 500);
        }
    }

    /* ─── Head office ──────────────────────────────────────────────────── */

    static async adminList(req: AuthRequest, res: Response) {
        try {
            const status = String(req.query.status ?? '');
            const q = String(req.query.q ?? '').trim();
            const where: string[] = [];
            const params: any[] = [];
            if (status && status in STATUS_TEXT) { where.push('c.status = ?'); params.push(status); }
            if (q) {
                where.push(`(c.claim_no = ? OR c.warranty_uid = ? OR JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.customer_phone')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.registration_number')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(c.snapshot, '$.customer_name')) LIKE ?)`);
                params.push(q.toUpperCase(), q, `%${q}%`, `%${q}%`, `%${q}%`);
            }
            const [cs]: any = await db.execute(
                `SELECT c.*, vd.store_name FROM warranty_claims c LEFT JOIN vendor_details vd ON vd.id = c.store_id
                  ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.id DESC LIMIT 300`, params);
            const [n]: any = await db.execute('SELECT status, COUNT(*) AS n FROM warranty_claims GROUP BY status');
            const counts: Record<string, number> = {};
            for (const r of n) counts[r.status] = Number(r.n);
            return ok(res, { claims: cs.map(withJson).map((c: any) => view(c, 'admin')), counts });
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
            if (!c || !(await canSee(req, c))) return bad(res, 'Claim not found', 404);
            const [s]: any = await db.execute('SELECT store_name, city FROM vendor_details WHERE id = ?', [c.store_id ?? '']);
            const out = view(c, actorOf(req));
            out.store_name = s[0]?.store_name ?? null;
            out.store_city = s[0]?.city ?? null;
            if (actorOf(req) !== 'customer') {
                out.counts = await claimCounts(c);
                out.registration = await registrationFor(c, actorOf(req));
                if (out.counts.on_warranty > 1 && out.registration) {
                    out.registration.checks.push({ tone: out.counts.approved_before ? 'warn' : 'info', text: `${out.counts.on_warranty - 1} earlier claim${out.counts.on_warranty > 2 ? 's' : ''} on this warranty · ${out.counts.approved_before} approved` });
                }
            }
            return ok(res, { claim: out });
        } catch (e) {
            console.error('claims.detail', e);
            return bad(res, 'Could not load the claim', 500);
        }
    }

    /** A step on a claim by the customer, the store or head office. */
    static async act(req: AuthRequest, res: Response) {
        try {
            const c = await loadClaim(req.params.id);
            if (!c || !(await canSee(req, c))) return bad(res, 'Claim not found', 404);
            const actor = actorOf(req);
            const action = String(req.body?.action ?? '') as ClaimAction;
            const input = { ...req.body, photos: filesOf(req, 'photos') };
            const r = applyClaimAction({ ...c, trail: c.trail ?? [] }, action, actor, input);
            if ('error' in r) return bad(res, r.error);
            const next: any = r.claim;

            let history: HistoryEntry[] = [...(c.history ?? [])];
            if (action === 'undo') {
                for (let i = history.length - 1; i >= 0; i--) {
                    const h = history[i];
                    if (!h.undone && !['undo', 'edit', 'raised', 'old_part'].includes(h.action)) { history[i] = { ...h, undone: true }; break; }
                }
            }
            const note = action === 'inspect' ? next.inspection?.note : String(req.body?.note ?? '').trim().slice(0, 1000) || null;
            history.push(entry(req, { action, status: next.status, text: stepText(action, next), note }));
            next.history = history;
            if (action === 'undo' && !next.decision?.old_part) next.old_part = null;
            await save(next);

            if (actor === 'admin') {
                await ActivityLogService.log({
                    adminId: req.user!.id, adminName: (req.user as any)?.name, adminEmail: (req.user as any)?.email,
                    actionType: 'WARRANTY_CLAIM_ACTION', targetType: 'warranty_claim', targetId: String(c.id), targetName: c.claim_no,
                    details: { action, status: next.status },
                } as any);
            }

            const t = stepText(action, next) + (note && action !== 'inspect' && action !== 'edit' ? ` · ${note.slice(0, 160)}` : '');
            switch (action) {
                case 'inspect': await tell(next, t, { admins: true, customer: true }); break;
                case 'ask_more': await tell(next, t, { store: true }); break;
                case 'approve': case 'reject': case 'paid': case 'dispatch': await tell(next, t, { store: true, customer: true }); break;
                case 'fixed':
                    await tell(next, `${t}. Please confirm it is fixed.`, { customer: true });
                    if (actor !== 'admin') await tell(next, t, { admins: true });
                    break;
                case 'close': await tell(next, t, { store: true, admins: actor !== 'admin' }); break;
                case 'undo': await tell(next, t, { store: true, customer: true }); break;
            }
            const out = view(next, actor);
            return ok(res, { claim: out });
        } catch (e) {
            console.error('claims.act', e);
            return bad(res, 'Could not save the step', 500);
        }
    }

    /** The lists the screens choose from. */
    static async meta(_req: AuthRequest, res: Response) {
        return ok(res, { problems: PROBLEMS, reasons: REJECT_REASONS, statuses: STATUS_TEXT });
    }
}
