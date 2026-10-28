/* eslint-disable @typescript-eslint/no-explicit-any -- stand-ins for the API's JSON, which the screens read untyped */
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { seed, iso, istDay, STORE_DETAILS_ID, type Mode } from "./seed";
import { TRAINING_EXIT_KEY } from "./flag";

/**
 * The API, answered in the browser for a training tab (see ./flag.ts).
 *
 * Each route mirrors what the real one returns, close enough for the screens
 * to behave as they do for a store: lists filter and page, actions move a
 * warranty or a request along, and what a trainee adds shows up where it
 * would. Everything lives in memory, so a reload starts the store over.
 *
 * A route not listed here answers "not available in training" rather than
 * falling through to the server. The only calls that do leave are anonymous
 * reads of the public catalogue (PUBLIC below), which anyone can make.
 */


const mode: Mode = new URLSearchParams(window.location.search).get("as") === "distributor" ? "distributor" : "franchise";
const S = seed(mode);

class Fail extends Error {
    constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}
const fail = (status: number, message: string, extra?: Record<string, unknown>): never => { throw new Fail(status, message, extra); };
const NOT_HERE = "This isn't available in training mode.";

interface Ctx {
    p: string[];
    q: URLSearchParams;
    body: Record<string, any>;
    form: FormData | null;
}
type Handler = (c: Ctx) => any | Promise<any>;

/* ---------- helpers ---------- */

const nextId = () => ++S.seq;
const now = () => Date.now();
const fileUrls = (form: FormData | null, match: (key: string) => boolean) => {
    if (!form) return [] as string[];
    const out: string[] = [];
    form.forEach((v, k) => { if (match(k) && v instanceof File) out.push(URL.createObjectURL(v)); });
    return out;
};

function page<T>(list: T[], q: URLSearchParams, fallbackLimit = 30) {
    const limit = Math.max(1, Number(q.get("limit")) || fallbackLimit);
    const currentPage = Math.max(1, Number(q.get("page")) || 1);
    const totalCount = list.length;
    const totalPages = Math.ceil(totalCount / limit);
    return {
        rows: list.slice((currentPage - 1) * limit, currentPage * limit),
        pagination: { currentPage, totalPages, totalCount, limit, hasNextPage: currentPage < totalPages, hasPrevPage: currentPage > 1 },
    };
}

const findWarranty = (id: string) => S.warranties.find(w => w.uid === id || String(w.id) === id) ?? fail(404, "Warranty not found");
const findMember = (id: string) => S.manpower.find(m => m.id === id) ?? fail(404, "Manpower not found");
const findOrder = (id: string) => [...S.orders, ...S.incoming].find(o => o.id === id) ?? fail(404, "Order not found");

function withCounts(m: any) {
    const mine = S.warranties.filter(w => w.manpower_id === m.id);
    return {
        ...m,
        validated_count: mine.filter(w => w.status === "validated").length,
        pending_count: mine.filter(w => w.status === "pending" || w.status === "pending_vendor").length,
        rejected_count: mine.filter(w => w.status === "rejected").length,
        total_count: mine.length,
    };
}

/* ---------- the public catalogue (real, read anonymously) ---------- */

let catalogue: Promise<{ products: any[]; categories: any[] }> | null = null;
let baseURL = "";
const pub = () => axios.create({ baseURL, withCredentials: false });

function loadCatalogue() {
    catalogue ??= Promise.all([
        pub().get("/catalog/products").then(r => r.data.products || []),
        pub().get("/catalog/categories").then(r => r.data.categories || []),
    ]).then(([products, categories]) => ({ products, categories }))
        .catch(() => ({ products: [], categories: [] }));
    return catalogue;
}

/** Every orderable line of the training distributor (Autoform brand), with made-up stock. */
async function stockRows() {
    const { products, categories } = await loadCatalogue();
    const cat = new Map(categories.map((c: any) => [c.id, c]));
    const rows: any[] = [];
    products.filter((p: any) => (p.brand || "AF") === "AF").forEach((p: any, i: number) => {
        const variations = p.variations?.length ? p.variations : [{ id: null, name: "Default", price: typeof p.price === "number" ? p.price : p.price?.default ?? 0, sku: null }];
        variations.forEach((v: any, j: number) => {
            const key = `${p.id}::${v.id ?? ""}`;
            const seeded = (i * 7 + j * 13) % 9 === 0 ? 0 : 5 + ((i * 11 + j * 5) % 40);
            const c: any = cat.get(p.categoryId);
            rows.push({
                product_id: p.id, variation_id: v.id ?? null, stock_quantity: S.inventory?.[key] ?? seeded,
                product_name: p.name, product_description: (p.description || []).join("\n"), additional_info: p.additionalInfo ?? [],
                category_id: p.categoryId, category_name: c?.name ?? null, category_parent_id: c?.parent_id ?? c?.parentId ?? null,
                product_brand: "AF", variation_name: v.name || "Default", price: Number(v.price) || 0, sku: v.sku ?? null,
                distributor_id: S.distributor.id, distributor_name: S.distributor.name, distributor_brands: "AF",
            });
        });
    });
    return { rows, products, categories };
}

/* ---------- schemes ---------- */

const clubFor = (s: any, score: number) => [...(s.clubs ?? [])].sort((a, b) => b.min - a.min).find(c => score >= c.min) ?? null;

function board(s: any) {
    const score = s.entries.filter((e: any) => e.status === "approved").reduce((n: number, e: any) => n + e.score, 0);
    const rows = s.leaderboard_rows.map((r: any) => r.name === "MY_STORE" ? { name: "You", score, me: true } : { ...r, me: false })
        .sort((a: any, b: any) => b.score - a.score)
        .map((r: any, i: number) => ({ ...r, rank: i + 1, club: clubFor(s, r.score) }));
    return { score, rows };
}

function achieved(s: any) {
    if (!s.joined || s.score_rule.mode === "none") return null;
    const { score, rows } = board(s);
    const me = rows.find((r: any) => r.me);
    const club = clubFor(s, score);
    return { score, approved: s.entries.filter((e: any) => e.status === "approved").length, rank: me?.rank ?? rows.length, of: rows.length, reward: club?.reward ?? null, club };
}

const schemeOut = (s: any) => {
    const { joined, entries, months, leaderboard_rows, ...rest } = s;
    return rest;
};

/* ---------- warranties ---------- */

function filterWarranties(q: URLSearchParams) {
    let list = [...S.warranties];
    const status = q.get("status");
    if (status && status !== "all") {
        list = status === "pending" ? list.filter(w => w.status === "pending_vendor" || w.status === "pending")
            : status === "pending_ho" ? list.filter(w => w.status === "pending")
                : list.filter(w => w.status === status);
    }
    const eq = (key: string, col: string) => { const v = q.get(key); if (v && v !== "all") list = list.filter(w => w[col] === v); };
    eq("product_type", "product_type"); eq("make", "car_make"); eq("model", "car_model");
    const search = q.get("search")?.toLowerCase();
    if (search) list = list.filter(w => ["customer_name", "customer_phone", "uid", "registration_number", "car_make", "car_model"]
        .some(k => String(w[k] ?? "").toLowerCase().includes(search)));
    const from = q.get("date_from"), to = q.get("date_to");
    if (from && to) list = list.filter(w => w.created_at >= new Date(from).toISOString() && w.created_at <= new Date(to).toISOString());
    return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function stats() {
    const counts: Record<string, number> = { pending_vendor: 0, pending: 0, validated: 0, rejected: 0 };
    S.warranties.forEach(w => { counts[w.status] = (counts[w.status] ?? 0) + 1; });
    const today = istDay(now());
    const monthStart = today.slice(0, 8) + "01";
    const d = new Date(monthStart + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1);
    const lastStart = d.toISOString().slice(0, 10);
    const days = new Map<string, number>();
    let this_month = 0, last_month = 0;
    S.warranties.forEach(w => {
        const day = istDay(Date.parse(w.created_at));
        if (day >= monthStart) this_month++;
        else if (day >= lastStart) last_month++;
        if (day >= lastStart) days.set(day, (days.get(day) ?? 0) + 1);
    });
    return { ...counts, this_month, last_month, daily: [...days].sort().map(([day, n]) => ({ day, n })) };
}

/** Applies a corrected warranty from the edit form; it goes back to head office. */
function applyWarrantyEdit(w: any, c: Ctx) {
    const b = c.body;
    const pd = typeof b.productDetails === "string" ? JSON.parse(b.productDetails) : b.productDetails ?? {};
    const photos = { ...(w.product_details?.photos ?? {}), ...(pd.photos ?? {}) };
    if (c.form) c.form.forEach((v, k) => {
        if (!(v instanceof File)) return;
        if (k === "invoiceFile") pd.invoiceFileName = URL.createObjectURL(v);
        else if (k.endsWith("Photo")) photos[k.slice(0, -5)] = URL.createObjectURL(v);
    });
    Object.keys(photos).forEach(k => { if (!photos[k] || typeof photos[k] !== "string") delete photos[k]; });
    w.product_details = { ...w.product_details, ...pd, photos, invoiceFileName: pd.invoiceFileName || w.product_details?.invoiceFileName };
    const set = (col: string, v: unknown) => { if (v !== undefined && v !== null && v !== "" && v !== "null") w[col] = v; };
    set("customer_name", b.customerName); set("customer_email", b.customerEmail); set("customer_phone", b.customerPhone);
    set("registration_number", b.registrationNumber); set("car_make", b.carMake); set("car_model", b.carModel); set("car_year", b.carYear);
    set("purchase_date", b.purchaseDate); set("warranty_type", b.warrantyType);
    if (w.status === "rejected") {
        w.status = "pending";
        w.rejection_reason = null; w.rejected_by = null; w.rejected_at = null;
    }
}

/* ---------- POSM ---------- */

function posmUsage() {
    const usage: Record<string, { month: number; year: number }> = {};
    const today = istDay(now());
    S.posmRequests.filter(r => r.status !== "rejected").forEach(r => {
        const day = istDay(Date.parse(r.created_at));
        (r.items ?? []).forEach((l: any) => {
            const u = usage[l.item_id] ??= { month: 0, year: 0 };
            if (day.slice(0, 4) === today.slice(0, 4)) u.year += l.qty;
            if (day.slice(0, 7) === today.slice(0, 7)) u.month += l.qty;
        });
    });
    return usage;
}

function displayOf(itemId: string, values: Record<string, any>) {
    const item = S.posmCatalog.items.find((i: any) => i.id === itemId);
    return Object.entries(values ?? {}).filter(([, v]) => v !== "" && v != null).map(([k, v]) => ({
        label: item?.fields.find((f: any) => f.id === k)?.label ?? k,
        value: Array.isArray(v) ? v.join(", ")
            : typeof v === "object" ? Object.entries(v).filter(([, n]) => Number(n) > 0).map(([s, n]) => `${s} × ${n}`).join(", ")
                : String(v),
    }));
}

/* ---------- routes ---------- */

const routes: [string, RegExp, Handler][] = [];
const on = (method: string, path: string, h: Handler) =>
    routes.push([method, new RegExp("^" + path.replace(/:[a-zA-Z]+/g, "([^/]+)") + "$"), h]);

/* auth */
on("GET", "/auth/me", () => ({ success: true, user: S.user }));
on("POST", "/auth/logout", () => {
    // Signing out of the training store ends training.
    setTimeout(() => window.location.assign(sessionStorage.getItem(TRAINING_EXIT_KEY) || "/"), 50);
    return { success: true };
});
on("PUT", "/auth/profile", () => fail(403, "A franchise can't change its own details. Ask head office to update them."));

/* store */
on("GET", "/vendor/profile", () => ({ success: true, vendorDetails: S.profile }));
on("POST", "/vendor/activity", () => ({ success: true }));
on("GET", "/vendor/audits", () => ({ success: true, audits: S.audits, pending: null }));
on("GET", "/vendor/leads", () => ({ success: true, leads: S.leads, store: { name: S.profile.store_name } }));

/* staff */
on("GET", "/vendor/manpower", ({ q }) => {
    const active = q.get("active") !== "false";
    const approved = q.get("approved") ?? "true";
    const list = S.manpower.filter(m => Boolean(m.is_active) === active && (approved === "all" || Boolean(m.is_approved) === (approved === "true")))
        .map(withCounts);
    const { rows, pagination } = page(list, q);
    return { success: true, manpower: rows, pagination };
});
on("GET", "/vendor/manpower/:id/warranties", ({ p, q }) => {
    const status = q.get("status");
    const list = S.warranties.filter(w => w.manpower_id === p[0] && (status === "pending" ? (w.status === "pending" || w.status === "pending_vendor") : w.status === status));
    return { success: true, warranties: list };
});
const checkMember = (b: any) => {
    if (!String(b.name ?? "").trim()) fail(400, "Name is required");
    if (!/^\d{10}$/.test(String(b.phoneNumber ?? "").replace(/\D/g, "").slice(-10))) fail(400, "Enter a 10-digit mobile number");
};
on("POST", "/vendor/manpower", ({ body }) => {
    checkMember(body);
    const n = nextId();
    const m = {
        id: `mp-${n}`, manpower_id: `PCS-${n}`, name: body.name.trim(), phone_number: String(body.phoneNumber).replace(/\D/g, "").slice(-10),
        applicator_type: body.applicatorType || "seat_cover", is_active: 1, is_approved: 0, request_status: null, request_type: null,
        request_reason: null, removed_at: null, removed_reason: null, created_at: iso(now()),
    };
    S.manpower.push(m);
    return { success: true, message: "Added. An admin needs to approve this member before they can be picked on a warranty form.", manpower: withCounts(m) };
});
on("PUT", "/vendor/manpower/:id", ({ p, body }) => {
    checkMember(body);
    const m = findMember(p[0]);
    Object.assign(m, { name: body.name.trim(), phone_number: String(body.phoneNumber).replace(/\D/g, "").slice(-10), applicator_type: body.applicatorType || m.applicator_type });
    return { success: true, message: "Details updated.", manpower: withCounts(m) };
});
on("DELETE", "/vendor/manpower/:id", ({ p, body }) => {
    const m = findMember(p[0]);
    if (m.request_status === "pending") fail(400, "A request for this member is already waiting for an admin.");
    Object.assign(m, { request_status: "pending", request_type: "remove", request_reason: body.reason });
    return { success: true, message: "Removal requested. The member stays on your team until an admin approves it." };
});
on("PUT", "/vendor/manpower/:id/restore", ({ p, body }) => {
    const m = findMember(p[0]);
    Object.assign(m, { is_active: 1, is_approved: 0, request_status: "pending", request_type: "restore", request_reason: body.reason ?? null, removed_at: null, removed_reason: null });
    return { success: true, message: "Restore requested. An admin will approve the member again." };
});

/* warranties */
on("GET", "/warranty", ({ q }) => {
    const { rows, pagination } = page(filterWarranties(q), q);
    return { success: true, warranties: rows, pagination };
});
on("GET", "/warranty/stats", () => ({ success: true, stats: stats() }));
on("GET", "/warranty/:uid", ({ p }) => ({ success: true, warranty: findWarranty(decodeURIComponent(p[0])) }));
on("PUT", "/warranty/:uid", (c) => {
    applyWarrantyEdit(findWarranty(decodeURIComponent(c.p[0])), c);
    return { success: true, message: "Correction sent. Head office will review the warranty again." };
});
on("POST", "/vendor/warranty/:uid/approve", ({ p }) => {
    const w = findWarranty(decodeURIComponent(p[0]));
    if (w.status !== "pending_vendor") fail(400, "This warranty has already been verified.");
    Object.assign(w, { status: "pending", vendor_approved_at: iso(now()) });
    return { success: true, message: "Verified. It now goes to head office for approval." };
});
on("POST", "/vendor/warranty/:uid/reject", ({ p, body }) => {
    const w = findWarranty(decodeURIComponent(p[0]));
    if (w.status !== "pending_vendor") fail(400, "Only a warranty waiting for your verification can be sent back.");
    Object.assign(w, { status: "rejected", rejected_by: "vendor", rejected_at: iso(now()), rejection_reason: body.reason });
    return { success: true, message: "Sent back to the customer for correction." };
});

/* the warranty forms' lookups */
const publicStore = () => ({
    vendor_details_id: STORE_DETAILS_ID, id: STORE_DETAILS_ID, store_name: S.profile.store_name, store_email: S.profile.store_email,
    store_code: S.profile.store_code, city: S.profile.city, state: S.profile.state, address: S.profile.address_line1, owner_name: S.profile.owner_name,
});
on("GET", "/public/stores", () => ({ success: true, stores: [publicStore()] }));
on("GET", "/public/stores/code/:code", () => ({ success: true, store: publicStore() }));
on("GET", "/public/stores/:id/manpower", () => ({ success: true, manpower: S.manpower.filter(m => m.is_active && m.is_approved) }));
on("GET", "/public/warranty/check-uid", () => ({ success: true, valid: true, available: true }));
on("GET", "/public/warranty/check-uniqueness", () => ({ success: true, unique: true }));
on("GET", "/uid/validate/:uid", () => ({ success: true, valid: true, available: true, message: "UID is valid and available" }));

/* complaints */
on("GET", "/grievance/categories", () => ({ success: true, categories: S.grievanceCategories }));
on("GET", "/grievance/vendor", ({ q }) => { const { rows, pagination } = page(S.grievances, q, 15); return { success: true, data: rows, pagination }; });
on("GET", "/grievance/franchise/submitted", ({ q }) => { const { rows, pagination } = page(S.myGrievances, q, 15); return { success: true, data: rows, pagination }; });
on("GET", "/grievance/:id/remarks", ({ p }) => ({ success: true, data: S.remarks[Number(p[0])] ?? [] }));
on("PUT", "/grievance/:id/remarks", ({ p, body }) => {
    const id = Number(p[0]);
    const g = S.grievances.find(x => x.id === id) ?? fail(404, "Complaint not found");
    if (!String(body.remarks ?? "").trim()) fail(400, "Write a remark first");
    (S.remarks[id] ??= []).push({ id: nextId(), grievance_id: id, added_by: "franchise", added_by_name: S.profile.store_name, added_by_id: S.user.id, remark: body.remarks, created_at: iso(now()) });
    g.franchise_remarks = body.remarks;
    if (g.status === "submitted") g.status = "under_review";
    return { success: true, message: "Remarks added" };
});
on("POST", "/grievance/franchise", ({ body, form }) => {
    if (!String(body.subject ?? "").trim() || !String(body.description ?? "").trim()) fail(400, "Subject and description are required");
    const id = nextId();
    S.myGrievances.unshift({
        id, ticket_id: `GRV-TR-${id}`, customer_name: S.profile.store_name, category: body.category, sub_category: null, subject: body.subject,
        description: body.description, attachments: JSON.stringify(fileUrls(form, k => k === "attachments")), status: "submitted",
        franchise_remarks: null, admin_remarks: null, created_by_role: "franchise", created_by_name: S.profile.owner_name, customer_rating: null,
        created_at: iso(now()), resolved_at: null,
    });
    S.remarks[id] = [];
    return { success: true, message: "Complaint submitted", ticketId: `GRV-TR-${id}` };
});

/* POSM */
on("GET", "/posm/catalog", () => ({ success: true, data: { catalog: S.posmCatalog, brands: ["AF"], usage: posmUsage() } }));
on("GET", "/posm", () => ({ success: true, data: S.posmRequests }));
on("GET", "/posm/:id", ({ p }) => {
    const r = S.posmRequests.find(x => x.id === Number(p[0])) ?? fail(404, "Request not found");
    return { success: true, data: { ...r, messages: S.posmMessages[r.id] ?? [] } };
});
on("POST", "/posm/items", ({ body, form }) => {
    const lines = JSON.parse(body.items || "[]");
    if (!lines.length) fail(400, "Pick at least one item");
    const id = nextId();
    const ticketId = `POSM-TR-${id}`;
    S.posmRequests.unshift({
        id, ticket_id: ticketId, requirement: body.note || "", created_by_role: "franchise", created_by_name: S.profile.owner_name, status: "open",
        created_at: iso(now()), updated_at: iso(now()), dispatch: null, delivery: null,
        items: lines.map((l: any, i: number) => ({
            ...l, display: displayOf(l.item_id, l.values), files: fileUrls(form, k => k.startsWith(`line_${i}_`)),
            approved_qty: null, line_status: "pending", note: null,
        })),
        history: [{ action: "sent", status: "open", at: iso(now()), by_role: "franchise", by_name: S.profile.owner_name }],
    });
    S.posmMessages[id] = [];
    return { success: true, data: { ticketId, id } };
});
on("POST", "/posm/:id/messages", ({ p, body, form }) => {
    const id = Number(p[0]);
    (S.posmMessages[id] ??= []).push({
        id: nextId(), sender_role: "franchise", sender_name: S.profile.owner_name, message: body.message || null,
        attachments: fileUrls(form, k => k === "attachments"), created_at: iso(now()),
    });
    return { success: true };
});
on("POST", "/posm/:id/delivered", ({ p, form }) => {
    const r = S.posmRequests.find(x => x.id === Number(p[0])) ?? fail(404, "Request not found");
    if (r.status !== "dispatched") fail(400, "Only a dispatched request can be marked received.");
    Object.assign(r, {
        status: "delivered", updated_at: iso(now()),
        delivery: { by: "franchise", at: iso(now()), photos: fileUrls(form, k => k === "photos") },
        items: r.items.map((l: any) => l.line_status === "dispatched" ? { ...l, line_status: "delivered", delivered_at: iso(now()), delivered_by: "franchise" } : l),
        history: [...r.history, { action: "received", status: "delivered", at: iso(now()), by_role: "franchise", by_name: S.profile.owner_name }],
    });
    return { success: true };
});

/* schemes */
on("GET", "/schemes", () => ({
    success: true,
    schemes: S.schemes.map(s => ({
        id: s.id, title: s.title, category: s.category, summary: s.summary, banner_url: s.banner_url, starts_on: s.starts_on, ends_on: s.ends_on,
        state: s.state, windows: s.windows, open_window: s.open_window, next_window: s.next_window,
        has_score: s.score_rule.mode !== "none", joined: s.joined, achieved: achieved(s),
    })),
}));
on("GET", "/schemes/:id", ({ p }) => {
    const s = S.schemes.find(x => x.id === p[0]) ?? fail(404, "Scheme not found");
    const months = new Map<string, number>();
    s.entries.filter((e: any) => e.status === "approved").forEach((e: any) => {
        const m = istDay(Date.parse(e.created_at)).slice(0, 7);
        months.set(m, (months.get(m) ?? 0) + e.score);
    });
    return {
        success: true, scheme: schemeOut(s), joined: s.joined, can_submit: s.joined && Boolean(s.open_window),
        achieved: achieved(s), months: [...months].sort().map(([month, points]) => ({ month, points })),
        distributors: s.fields.some((f: any) => f.type === "distributor") ? [{ id: S.distributor.id, name: S.distributor.name, city: S.distributor.city }] : [],
        entries: [...s.entries].sort((a: any, b: any) => b.created_at.localeCompare(a.created_at)),
        leaderboard: s.leaderboard.show && s.score_rule.mode !== "none" ? board(s).rows : null,
    };
});
on("POST", "/schemes/:id/join", ({ p, body }) => {
    const s = S.schemes.find(x => x.id === p[0]) ?? fail(404, "Scheme not found");
    if (!body.accept_terms) fail(400, "Please accept the terms to join.");
    s.joined = true;
    return { success: true };
});
on("POST", "/schemes/:id/entries", ({ p, body, form }) => {
    const s = S.schemes.find(x => x.id === p[0]) ?? fail(404, "Scheme not found");
    if (!s.joined || !s.open_window) fail(400, "Entries aren't open for this scheme right now.");
    const answers = JSON.parse(body.answers || "{}");
    const files: Record<string, any[]> = {};
    form?.forEach((v, k) => {
        if (v instanceof File) (files[k] ??= []).push({ name: v.name, url: URL.createObjectURL(v), size: v.size, ext: v.name.split(".").pop() ?? "" });
    });
    s.entries.push({ id: `e${nextId()}`, answers, files, score: 0, lines: null, claimed_lines: null, status: "pending", review_note: null, created_at: iso(now()), invoices: null });
    return { success: true };
});

/* feedback */
on("GET", "/feedback/current", () => ({ success: true, data: S.feedbackCurrent }));
on("GET", "/feedback/mine", () => ({ success: true, data: S.feedbackPast }));
on("POST", "/feedback", ({ body, form }) => {
    const cur = S.feedbackCurrent;
    if (cur.response) fail(400, "You've already sent this month's feedback.");
    const values = JSON.parse(body.answers || "{}");
    const answers = cur.questions.map((q: any) => ({
        qid: q.id, label: q.label, type: q.type, value: values[q.id] ?? null,
        ...(q.type === "photo" ? { files: fileUrls(form, k => k === `q_${q.id}`) } : {}),
    }));
    cur.response = { answers, submitted_at: iso(now()) };
    S.feedbackPast.unshift({ month: cur.month, answers, submitted_at: cur.response.submitted_at });
    return { success: true };
});

/* notifications */
on("GET", "/notifications", ({ q }) => ({
    success: true,
    notifications: q.get("includeCleared") === "true" ? S.notifications : S.notifications.filter(n => !n.is_cleared),
}));
on("GET", "/notifications/unread-count", () => ({ success: true, count: S.notifications.filter(n => !n.is_read && !n.is_cleared).length }));
on("PATCH", "/notifications/read-all", () => { S.notifications.forEach(n => { n.is_read = true; }); return { success: true }; });
on("PATCH", "/notifications/:id/read", ({ p }) => { S.notifications.forEach(n => { if (n.id === Number(p[0])) n.is_read = true; }); return { success: true }; });
on("PATCH", "/notifications/:id/restore", ({ p }) => { S.notifications.forEach(n => { if (n.id === Number(p[0])) n.is_cleared = false; }); return { success: true }; });
on("DELETE", "/notifications", () => { S.notifications.forEach(n => { n.is_cleared = true; }); return { success: true }; });
on("DELETE", "/notifications/:id", ({ p }) => { S.notifications.forEach(n => { if (n.id === Number(p[0])) n.is_cleared = true; }); return { success: true }; });

/* e-catalogue: refused, so the page shows Autoform's public catalogue links */
on("GET", "/settings/ecatalogue/mine", () => fail(404, NOT_HERE));

/* orders — the store's side */
on("GET", "/orders/catalogue", async () => {
    const { rows, products, categories } = await stockRows();
    const productImages: Record<string, string[]> = {};
    products.forEach((p: any) => { if (p.images?.length) productImages[p.id] = p.images; });
    const categoryMap: Record<string, string> = {};
    categories.forEach((c: any) => { categoryMap[c.id] = c.name; });
    return { success: true, inventory: mode === "franchise" ? rows : [], productImages, categoryMap };
});
on("GET", "/orders/my-orders", () => ({ success: true, orders: S.orders }));
on("GET", "/orders/my-distributors", () => ({ success: true, distributors: mode === "franchise" ? [S.distributor] : [] }));
on("GET", "/orders/distributor", () => ({ success: true, distributor: S.distributor }));
on("GET", "/orders/distributor-stock", async () => ({ success: true, inventory: (await stockRows()).rows }));
on("POST", "/orders", async ({ body }) => {
    const items: any[] = body.items ?? [];
    if (!items.length) fail(400, "Your cart is empty");
    const { rows } = await stockRows();
    const lines = items.map((it, i) => {
        const row = rows.find(r => r.product_id === it.productId && (r.variation_id ?? null) === (it.variationId ?? null));
        return { id: `oi-${nextId()}-${i}`, product_name: row?.product_name ?? "Product", variation_name: row?.variation_name ?? null, quantity: Number(it.quantity) || 1, price: row?.price ?? 0 };
    });
    const id = `AFI-TR-${nextId()}`;
    S.orders.unshift({
        id, status: "processing", total_amount: lines.reduce((s, l) => s + l.quantity * l.price, 0),
        shipping_address: body.shippingAddress, shipping_city: body.shippingCity, shipping_state: body.shippingState, shipping_pincode: body.shippingPincode,
        created_at: iso(now()), distributor_name: S.distributor.name, distributor_phone: S.distributor.phone_number, distributor_email: S.distributor.email,
        client_store_name: S.profile.store_name, client_store_email: S.profile.store_email, vendor_name: S.profile.owner_name, vendor_phone: S.profile.contact_number,
        docket_id: null, distributor_confirmation_note: null, declined_by_role: null, decline_reason: null, declined_at: null,
        order_group_id: null, group_size: 1, items: lines,
    });
    return { success: true, message: `Order ${id} placed with ${S.distributor.name}. In the live portal they'd be told on WhatsApp.` };
});
on("POST", "/orders/:id/cancel", ({ p }) => {
    const o = findOrder(p[0]);
    if (o.status === "delivered" || o.status === "cancelled") fail(400, `Cannot cancel an order that is already ${o.status}`);
    Object.assign(o, { status: "cancelled", declined_by_role: "vendor", declined_at: iso(now()) });
    return { success: true, message: "Order declined successfully." };
});
on("POST", "/orders/:id/received", ({ p }) => {
    const o = findOrder(p[0]);
    if (o.status !== "processing" && o.status !== "shipped") fail(400, `Order cannot be marked received from current status: ${o.status}`);
    o.status = "delivered";
    return { success: true, message: "Marked as received." };
});
on("GET", "/orders/:id/group", ({ p }) => ({ success: true, orders: [findOrder(p[0])] }));
on("GET", "/orders/:id/pdf", () => fail(400, "Invoices can't be downloaded in training mode."));
on("GET", "/orders/:id/messages", () => ({ success: true, messages: [] }));
on("GET", "/orders/:id", ({ p }) => ({ success: true, order: findOrder(p[0]) }));
on("POST", "/orders/:id/messages", ({ p, body }) => {
    const o = findOrder(p[0]);
    if (body.docketId) o.docket_id = String(body.docketId);
    return { success: true, docketId: o.docket_id };
});

/* orders — the distributor's side */
on("GET", "/orders/distributor/franchises", () => ({ success: true, franchises: S.franchises }));
on("GET", "/orders/distributor/inventory", async () => ({
    success: true, distributorId: S.distributor.id, distributorName: S.distributor.name, inventory: mode === "distributor" ? (await stockRows()).rows : [],
}));
on("PUT", "/orders/distributor/inventory", ({ body }) => {
    const qty = Number(body.stockQuantity);
    if (!Number.isFinite(qty) || qty < 0) fail(400, "Enter a valid quantity");
    (S.inventory ??= {})[`${body.productId}::${body.variationId ?? ""}`] = qty;
    return { success: true, message: "Stock updated" };
});
on("GET", "/orders/distributor/incoming", () => ({ success: true, orders: S.incoming }));
on("POST", "/orders/distributor/incoming/:id/confirm", ({ p }) => {
    findOrder(p[0]).status = "processing";
    return { success: true, status: "processing", message: "Order confirmed. In the live portal the store would be told on WhatsApp." };
});
on("POST", "/orders/distributor/incoming/:id/note", ({ p, body }) => {
    const o = findOrder(p[0]);
    o.distributor_confirmation_note = body.note ?? null;
    return { success: true, message: "Note sent to the store.", distributorConfirmationNote: o.distributor_confirmation_note };
});
on("POST", "/orders/distributor/incoming/:id/cancel", ({ p, body }) => {
    if (!String(body.declineReason ?? "").trim()) fail(400, "Please give a reason");
    Object.assign(findOrder(p[0]), { status: "cancelled", declined_by_role: "distributor", decline_reason: body.declineReason, declined_at: iso(now()) });
    return { success: true, message: "Order declined." };
});
on("POST", "/orders/distributor/incoming/:id/hold", ({ p, body }) => {
    Object.assign(findOrder(p[0]), { status: "pending", distributor_confirmation_note: body.holdReason || null });
    return { success: true };
});

/* Public, read-only content anyone can load without signing in. */
const PUBLIC = [/^\/catalog\/categories$/, /^\/catalog\/products(\/[^/]+)?$/, /^\/public\/products$/, /^\/settings\/public\/[a-z0-9_]+$/];

/* ---------- the adapter ---------- */

function parseBody(data: unknown): { body: Record<string, any>; form: FormData | null } {
    if (data instanceof FormData) {
        const body: Record<string, any> = {};
        data.forEach((v, k) => { if (!(v instanceof File)) body[k] = v; });
        return { body, form: data };
    }
    if (typeof data === "string") { try { return { body: JSON.parse(data), form: null }; } catch { return { body: {}, form: null }; } }
    return { body: (data as Record<string, any>) ?? {}, form: null };
}

const respond = (config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse =>
    ({ data, status, statusText: status < 400 ? "OK" : "Error", headers: {}, config, request: {} });

export async function handle(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    baseURL = config.baseURL ?? "";
    const method = (config.method ?? "get").toUpperCase();
    const url = new URL(config.url ?? "/", "http://training.local");
    const q = url.searchParams;
    Object.entries(config.params ?? {}).forEach(([k, v]) => { if (v != null) q.set(k, String(v)); });
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (method === "GET" && PUBLIC.some(re => re.test(path))) {
        const res = await pub().get(path, { params: Object.fromEntries(q) });
        return respond(config, res.status, res.data);
    }

    // A short wait, so loaders and disabled buttons behave as they do live.
    await new Promise(r => setTimeout(r, 120 + Math.random() * 200));

    const route = routes.find(([m, re]) => m === method && re.test(path));
    let status = 200;
    let data: unknown;
    try {
        if (!route) fail(400, NOT_HERE);
        const { body, form } = parseBody(config.data);
        data = await route![2]({ p: path.match(route![1])!.slice(1), q, body, form });
    } catch (e) {
        status = e instanceof Fail ? e.status : 500;
        data = { success: false, error: e instanceof Error ? e.message : NOT_HERE, ...(e instanceof Fail ? e.extra : {}) };
        if (!(e instanceof Fail)) console.error("[training]", method, path, e);
    }
    const res = respond(config, status, data);
    if (status >= 400) throw new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, config, {}, res);
    return res;
}

