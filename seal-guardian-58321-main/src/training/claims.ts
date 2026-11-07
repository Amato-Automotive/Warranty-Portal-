/* eslint-disable @typescript-eslint/no-explicit-any -- stand-ins for the API's JSON, which the screens read untyped */
import {
    applyClaimAction, actionsFor, waitingOn, stepText, coverage, problemsFor, asksAirbags, kindOf, readProblem, readVehicle,
    PROBLEMS, STATUS_TEXT, REJECT_REASONS, HOLD_REASONS, type FlowClaim, type Who,
} from "../../../server/src/services/claimFlow";
import { PLANT_VEHICLES } from "../../../server/src/services/plantVehicles";

/**
 * Warranty claims in the training store. The steps are the server's own
 * (claimFlow), so a claim moves, and refuses, exactly as it does live; only
 * the storage is a list in memory, and the plant's side is played by a few
 * claims already at each stage.
 */

const STORE: Who = { actor: "vendor" };
const PLANT: Who = { actor: "admin", rights: ["decide", "plan", "dispatch", "edit"] };
const CUSTOMER: Who = { actor: "customer" };

const DAY = 86_400_000;

/** What a claim keeps of its warranty, as it was when raised. */
function snapshotOf(w: any) {
    const d = w.product_details ?? {};
    const cov = coverage(w);
    return {
        product_type: w.product_type,
        product_name: d.productName || d.product || w.product_type,
        customer_name: w.customer_name, customer_phone: w.customer_phone, customer_email: w.customer_email || null,
        car: [w.car_make, w.car_model].filter(Boolean).join(" ") || null,
        registration_number: w.registration_number || d.carRegistration || null,
        warranty_type: w.warranty_type, cover_start: cov.start, cover_end: cov.end,
        fitted_store: d.storeName || null,
    };
}

/** A warranty as the claim screens list it. */
export function warrantyCard(w: any) {
    const cov = coverage(w);
    return {
        uid: w.uid, ...snapshotOf(w), status: w.status, store_id: w.vendor_details_id ?? null,
        covered: cov.covered, why: cov.why,
        claimable: w.status === "validated",
        problems: w.status === "validated" ? problemsFor(w.product_type, cov.covered) : [],
        asks_airbags: asksAirbags(w.product_type),
    };
}

/** The warranty as registered, laid out beside the claim. */
function registrationOf(w: any, S: any) {
    const d = w.product_details ?? {};
    const cov = coverage(w);
    const photos = Object.entries(d.photos ?? {}).filter(([, u]) => u).map(([k, u]) => ({
        label: ({ vehicle: "Car exterior", seatCover: "Seat cover", lhs: "LHS view", rhs: "RHS view", frontReg: "Front number plate", backReg: "Back number plate", warranty: "Warranty card" } as Record<string, string>)[k] ?? k,
        url: String(u),
    }));
    return {
        uid: w.uid, status: w.status, product_type: w.product_type, product_name: d.productName || d.product || w.product_type, rolls: null,
        customer_name: w.customer_name, customer_phone: w.customer_phone, customer_email: w.customer_email ?? null, customer_address: w.customer_address ?? null,
        car: [w.car_make, w.car_model].filter(Boolean).join(" ") || null, car_colour: w.car_colour ?? null, registration_number: w.registration_number ?? null,
        warranty_type: w.warranty_type, fitted_on: w.purchase_date ?? null, registered_on: w.created_at, approved_on: w.validated_at ?? null,
        cover_start: cov.start, cover_end: cov.end, fitted_store: S.profile.store_name, fitted_city: S.profile.city, installer: w.manpower_name_from_db ?? null,
        photos, checks: [{ tone: cov.covered ? "ok" : "warn", text: cov.covered ? "Within the warranty period" : cov.why ?? "Out of warranty" }],
    };
}

/** A claim as the store reads it. */
export function viewClaim(c: any, S: any, withDetail = false) {
    const flow: FlowClaim = { ...c, trail: c.trail ?? [] };
    const out: any = {
        ...c, trail: undefined, trail_length: (c.trail ?? []).length,
        actions: c.raised_via === "sheet" ? [] : actionsFor(flow, STORE),
        status_text: STATUS_TEXT[c.status as keyof typeof STATUS_TEXT] ?? c.status,
        waiting_on: waitingOn(c.status),
        problem_text: PROBLEMS[c.problem]?.label ?? c.problem,
        watching: false,
        history: (c.history ?? []).map((h: any) => ({ ...h, by: undefined, by_name: h.by_role === "admin" ? "Autoform" : h.by_name })),
    };
    if (withDetail) {
        const w = S.warranties.find((x: any) => x.uid === c.warranty_uid);
        out.counts = { on_warranty: 1, approved_before: 0, rejected_before: 0, customer_total: 1 };
        out.registration = w ? registrationOf(w, S) : null;
    }
    return out;
}

const person = (who: Who) => (who.actor === "admin" ? { by_role: "admin", by_name: "Autoform plant" } : who.actor === "vendor" ? { by_role: "vendor", by_name: "Practice Car Studio" } : { by_role: "customer", by_name: "Customer" });

function newClaim(S: any, id: number, w: any, p: { problem: string; description: string | null; vehicle: any; via: string; by: Who; media: string[]; at: number }) {
    const when = new Date(p.at).toISOString();
    const snapshot = snapshotOf(w);
    const c: any = {
        id, claim_no: `WC-${String(id).padStart(4, "0")}`, kind: kindOf(p.problem), warranty_uid: w.uid,
        store_id: S.profile.id, store_name: S.profile.store_name, store_city: S.profile.city, store_phone: S.profile.contact_number,
        raised_by_role: p.by.actor, raised_via: p.via,
        problem: p.problem, description: p.description, vehicle: p.vehicle, media: p.media, snapshot, product_type: w.product_type,
        status: "verify", verification: null, hold: null, decision: null, consent: null, plan: null, dispatch: null, fitted: null, change_request: null,
        trail: [], history: [{ action: "raised", status: "verify", text: p.by.actor === "vendor" ? "Raised by the store" : "Raised by the customer", note: p.description, at: when, ...person(p.by) }],
        created_at: when, updated_at: when,
    };
    return c;
}

/** Applies one step to a claim and records it, as the server does. */
function step(c: any, action: string, who: Who, input: Record<string, unknown>, at = Date.now()): { claim: any; changes: string[] } | { error: string } {
    const r = applyClaimAction({ ...c, trail: c.trail ?? [] }, action, who, input as any, new Date(at));
    if ("error" in r) return r;
    const next: any = r.claim;
    const history = [...(c.history ?? [])];
    if (action === "undo") {
        for (let i = history.length - 1; i >= 0; i--) {
            const h = history[i];
            if (!h.undone && !["undo", "raised"].includes(h.action)) { history[i] = { ...h, undone: true }; break; }
        }
    }
    const note = action === "verify" ? next.verification?.remarks : String(input.note ?? "").trim().slice(0, 1000) || null;
    history.push({ action, status: next.status, text: stepText(action as any, next), note, changes: r.changes.length ? r.changes : undefined, at: new Date(at).toISOString(), ...person(who) });
    next.history = history;
    next.updated_at = new Date(at).toISOString();
    return { claim: next, changes: r.changes };
}

/** A few claims already at each stage, so the store has something to do and to read. */
export function seedClaims(S: any): any[] {
    const mine = S.warranties.filter((w: any) => w.status === "validated" && w.product_type === "seat-cover");
    if (mine.length < 6) return [];
    const photo = (f: string) => `${window.location.origin}/images/training/${f}`;
    const vehicleOf = (w: any, extra: Record<string, unknown> = {}) => ({
        make: w.car_make, model: w.car_model, year: Number(w.car_year) || null, airbags: "with", major_colour: "Black", minor_colour: "Beige",
        material: null, component: null, component_remarks: null, photo: photo("car.svg"), ...extra,
    });
    const now = Date.now();
    const claims: any[] = [];
    let seq = 0;
    const make = (w: any, problem: string, description: string, ago: number, by: Who = CUSTOMER, vehicle: any = vehicleOf(w)) =>
        newClaim(S, ++seq, w, { problem, description, vehicle, via: by.actor === "vendor" ? "store" : "customer", by, media: [photo("seat-cover.svg")], at: now - ago * DAY });
    const go = (c: any, action: string, who: Who, input: Record<string, unknown>, ago: number) => {
        const r = step(c, action, who, input, now - ago * DAY);
        if ("error" in r) throw new Error(`[training] seed claim: ${r.error}`);
        return r.claim;
    };

    // 1. Raised by a customer, waiting for the store to verify.
    claims.push(make(mine[0], "peel_off", "The surface is peeling near the driver's seat bolster.", 1));
    // 2. Verified by the store, now with the plant.
    claims.push(go(make(mine[1], "stitch_issue", "The stitching on the rear seat has opened.", 4), "verify", STORE, { note: "Checked at the counter. The seam is open about 15 cm." }, 3));
    // 3. Approved as chargeable: waiting for the customer to agree.
    let c3 = go(make(mine[2], "alteration", "Needs the headrest covers re-cut to fit.", 6), "verify", STORE, { note: "Customer is at the store." }, 5);
    c3 = go(c3, "approve", PLANT, { outcome: "send_material", charge: "chargeable", item: "Headrest cover set", remarks: "Chargeable: it is an alteration, not a defect." }, 4);
    claims.push(c3);
    // 4. Dispatched: the store confirms when it reaches and is fitted.
    let c4 = go(make(mine[3], "colour_issue", "The colour has faded unevenly on the front seats.", 12), "verify", STORE, { note: "Faded on both front seats." }, 11);
    c4 = go(c4, "approve", PLANT, { outcome: "send_material", charge: "foc", item: "Front seat cover set", remarks: "Approved free of cost." }, 9);
    c4 = go(c4, "plan", PLANT, { alteration_no: "A204", edd: new Date(now - 5 * DAY).toISOString().slice(0, 10) }, 8);
    c4 = go(c4, "dispatch", PLANT, { dispatch_date: new Date(now - 2 * DAY).toISOString().slice(0, 10), docket: "TRK48820113", courier: "TRACKON COURIER" }, 2);
    claims.push(c4);
    // 5. Fitted and closed.
    let c5 = go(make(mine[4], "wrinkles", "Wrinkles on the back seat after two months.", 30), "verify", STORE, { note: "Wrinkles along the centre." }, 29);
    c5 = go(c5, "approve", PLANT, { outcome: "send_material", charge: "foc", item: "Rear seat cover set", remarks: "Approved." }, 26);
    c5 = go(c5, "plan", PLANT, { alteration_no: "A171", edd: new Date(now - 20 * DAY).toISOString().slice(0, 10) }, 25);
    c5 = go(c5, "dispatch", PLANT, { dispatch_date: new Date(now - 18 * DAY).toISOString().slice(0, 10), docket: "TRK47100342", courier: "SHREE MARUTI COURIER" }, 18);
    c5 = go(c5, "fitted", STORE, { note: "Fitted the same day it arrived." }, 15);
    claims.push(c5);
    // 6. Not approved.
    let c6 = go(make(mine[5], "damaged", "Torn after the customer's pet scratched it.", 20), "verify", STORE, { note: "Tear on the passenger seat." }, 19);
    c6 = go(c6, "reject", PLANT, { reason: Object.keys(REJECT_REASONS).find(k => k !== "other") ?? "other", note: "Damage caused in use is not covered." }, 17);
    claims.push(c6);
    return claims;
}

/* ---------- the routes ---------- */

type On = (method: string, path: string, handler: (c: any) => any) => void;
interface Deps { fail: (status: number, message: string) => never; nextId: () => number; fileUrls: (form: FormData | null, match: (k: string) => boolean) => string[]; now: () => number }

export function registerClaimRoutes(on: On, S: any, d: Deps) {
    const findClaim = (id: string) => S.claims.find((c: any) => String(c.id) === id) ?? d.fail(404, "Claim not found");
    const findWarrantyRow = (uid: string) => S.warranties.find((w: any) => w.uid === uid) ?? d.fail(404, "Warranty not found");

    on("GET", "/claims/meta", () => ({
        success: true,
        problems: PROBLEMS, reasons: REJECT_REASONS, hold_reasons: HOLD_REASONS, statuses: STATUS_TEXT, rights: [], old_part: false,
        models: {}, plant_vehicles: PLANT_VEHICLES,
    }));
    on("GET", "/claims/store", () => ({
        success: true,
        claims: [...S.claims].sort((a: any, b: any) => b.created_at.localeCompare(a.created_at)).map((c: any) => viewClaim(c, S)),
        distributor_claims: [], is_distributor: false,
    }));
    on("GET", "/claims/store/warranties", () => ({
        success: true,
        warranties: S.warranties.filter((w: any) => w.status === "validated").map(warrantyCard),
    }));
    on("GET", "/claims/store/search", ({ q }: any) => {
        const term = String(q.get("q") ?? "").trim();
        if (term.length < 4) d.fail(400, "Enter the phone number, UID or car number");
        const digits = term.replace(/\D/g, "").slice(-10);
        const reg = term.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const hits = S.warranties.filter((w: any) => w.uid === term
            || (digits.length === 10 && String(w.customer_phone).replace(/\D/g, "").slice(-10) === digits)
            || (reg.length >= 6 && String(w.registration_number ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") === reg)).slice(0, 20);
        return { success: true, warranties: hits.map(warrantyCard) };
    });
    on("POST", "/claims/store", ({ body, form }: any) => {
        const w = findWarrantyRow(String(body.warranty_uid ?? ""));
        if (w.status !== "validated") d.fail(400, "Warranty is not approved yet");
        const cov = coverage(w);
        const p = readProblem(body, cov.covered);
        if ("error" in p) d.fail(400, p.error);
        const v = readVehicle(body, w.product_type);
        if ("error" in v) d.fail(400, v.error);
        const media = d.fileUrls(form, k => k === "media");
        if (!media.length) d.fail(400, "Add at least one photo of the problem");
        const vehiclePhoto = d.fileUrls(form, k => k === "vehicle_photo")[0] ?? null;
        const vehicle: any = { ...(v as any), material: body.material || null, component: body.component || null, component_remarks: body.component_remarks || null, photo: vehiclePhoto };
        const raised = newClaim(S, d.nextId(), w, { problem: (p as any).problem, description: (p as any).description, vehicle, via: "store", by: STORE, media, at: d.now() });
        // The store has the customer in front of it, so the claim goes straight to the plant.
        const r = step(raised, "verify", STORE, { note: body.remarks }, d.now());
        if ("error" in r) d.fail(400, r.error);
        S.claims.unshift(r.claim);
        return { success: true, claim: viewClaim(r.claim, S) };
    });
    on("GET", "/claims/:id/file", () => d.fail(400, "Files can't be downloaded in training mode."));
    on("GET", "/claims/:id", ({ p }: any) => ({ success: true, claim: viewClaim(findClaim(p[0]), S, true) }));
    on("POST", "/claims/:id/action", ({ p, body, form }: any) => {
        const c = findClaim(p[0]);
        if (c.raised_via === "sheet") d.fail(403, "You can only view this claim");
        const action = String(body.action ?? "");
        const input: Record<string, unknown> = { ...body, photos: d.fileUrls(form, k => k === "photos") };
        delete input.action;
        const r = step(c, action, STORE, input, d.now());
        if ("error" in r) d.fail(400, r.error);
        const vehiclePhoto = d.fileUrls(form, k => k === "vehicle_photo")[0];
        if (vehiclePhoto && ["verify", "change", "resend"].includes(action)) r.claim.vehicle = { ...(r.claim.vehicle ?? {}), photo: vehiclePhoto };
        S.claims[S.claims.findIndex((x: any) => x.id === c.id)] = r.claim;
        return { success: true, claim: viewClaim(r.claim, S, true) };
    });
}
