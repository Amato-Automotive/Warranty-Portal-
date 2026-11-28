/* eslint-disable @typescript-eslint/no-explicit-any -- stand-ins for the API's JSON, which the screens read untyped */
import { coverage, problemsFor, warrantyYears } from "../../../server/src/services/claimFlow";
import { summarise, DEFAULT_SETTINGS } from "../../../server/src/services/posmHistory";
import { usageFrom } from "../../../server/src/services/posmCatalog";
import {
    SELL_MORE_ID, SELL_MORE_PROGRAM, eligibility, subtractSets, addSets, setsTotal, noSets, readSets, invoiceProblems,
} from "../../../server/src/services/sellMoreEarnMore";
import { FIRST_NAMES, LAST_NAMES, iso, istDay, type Mode } from "./seed";
import { LIVE_POSM_CATALOG } from "./posmCatalog";

/**
 * The screens added after the training store was first built (28 Nov 2026):
 * the store's Old Warranties, its POSM Received tab, and a distributor's POSM
 * for its stores and Buy More for its stores. Made-up data; the cover,
 * allowance, usage and free-set rules are the server's own.
 */

const DAY = 86_400_000;

/* ---------- old (pre-portal) warranties ---------- */

const OLD_DESIGNS = ["U-Focus", "H Cross", "D3", "U Arrow", "X Cross", "U Blade", "Velora", "Signature", "Emporio", "Doble"];

/** About forty old warranties for the practice store: some covered, some over, some with no cover recorded. */
export function seedOldWarranties(storeName: string) {
    let x = 20261128;
    const r = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const now = Date.now();
    const out: any[] = [];
    for (let i = 0; i < 42; i++) {
        /* Spread from mid-2023 to early 2026, newest first. */
        const ago = 215 + Math.floor((i / 42) * 1000) + Math.floor(r() * 15);
        const first = pick(FIRST_NAMES), last = pick(LAST_NAMES);
        const type = i % 5 === 3 ? "" : i % 3 === 0 ? "2+1 Year" : "1+1 Year";
        out.push({
            id: 9000 + i, uid: `2${String(5000000000000 + i * 7919337).slice(-13)}`,
            customer_name: `${first} ${last}`, customer_mobile: `97${String(20000000 + i * 104729).slice(-8)}`,
            customer_email: i % 4 === 0 ? `${first.toLowerCase()}${i}@example.com` : "",
            product_name: pick(OLD_DESIGNS), warranty_type: type, purchase_date: istDay(now - ago * DAY), store_name: storeName,
            created_at: iso(now - ago * DAY),
        });
    }
    return out;
}

/** An old warranty as the claim flow takes it (as on the server: validated, a seat cover). */
export function oldAsWarranty(o: any) {
    return {
        uid: o.uid, status: "validated", warranty_type: o.warranty_type, purchase_date: o.purchase_date, created_at: o.created_at,
        customer_name: o.customer_name, customer_phone: o.customer_mobile, customer_email: o.customer_email || null,
        product_type: "seat-cover", product_details: { productName: o.product_name, storeName: o.store_name },
        car_make: null, car_model: null, registration_number: null,
        __old: true, __cover_unknown: !warrantyYears(o.warranty_type),
    };
}

/** The card the screens list, as the server's oldCard. */
export function oldCard(o: any, warrantyCard: (w: any) => any) {
    const w = oldAsWarranty(o);
    const card: any = { ...warrantyCard(w), old: true, purchase_date: o.purchase_date };
    if (w.__cover_unknown) Object.assign(card, { covered: false, cover_unknown: true, cover_end: null, why: "Cover not recorded: head office confirms it", problems: problemsFor("seat-cover", true) });
    return card;
}

const coverOf = (o: any) => (!warrantyYears(o.warranty_type) ? "not_recorded" : coverage({ status: "validated", warranty_type: o.warranty_type, purchase_date: o.purchase_date, created_at: o.created_at }).covered ? "covered" : "over");

/* ---------- POSM received (the store's dispatch history) ---------- */

function seedPosmHistory() {
    const now = Date.now();
    const line = (id: number, item: string, design: string | null, colours: [string, string] | null, qty: number, status: string, reqAgo: number, sentAgo: number | null, extra: any = {}) => ({
        id: `tr-h-${id}`, from: "Plant", item, design, major_colour: colours?.[0] ?? null, minor_colour: colours?.[1] ?? null, qty, status,
        request_date: istDay(now - reqAgo * DAY), dispatch_date: sentAgo === null ? null : istDay(now - sentAgo * DAY),
        delivery_date: status === "Delivered" && sentAgo !== null ? istDay(now - (sentAgo - 4) * DAY) : null,
        courier: sentAgo === null ? null : "DTDC", docket_no: sentAgo === null ? null : `D${7700000000 + id * 13}`,
        dispatch_group: sentAgo === null ? null : `tr-g-${sentAgo}`, ticket_id: null, ...extra,
    });
    return [
        line(1, "FRP", "U-Focus", ["Red", "Black"], 1, "Delivered", 150, 140),
        line(2, "Sample Jacket", null, null, 10, "Delivered", 150, 140),
        line(3, "Sample Jacket", null, null, 4, "In Transit", 9, 3),
        line(4, "FRP", "D3", ["Tan", "Black"], 1, "WIP", 6, null),
        line(5, "T-shirt", null, null, 2, "Ready to dispatch", 6, null),
    ];
}

/* ---------- a distributor's stores ---------- */

type Store = { id: string; store_name: string; store_code: string | null; city: string | null };

function seedDistributorPosm(stores: Store[], posmLine: (id: string, name: string, qty: number, stage: string, display?: any[]) => any) {
    if (!stores.length) return [];
    const now = Date.now();
    const req = (id: number, s: Store, ago: number, status: string, role: string, items: any[], dispatch: any = null) => ({
        id, ticket_id: `POSM-TR-${id}`, requirement: "", status, items, created_by_role: role, created_by_name: role === "asm" ? "Area manager" : null,
        created_at: iso(now - ago * DAY), store_id: s.id, store_name: s.store_name, city: s.city, dispatch,
    });
    return [
        req(4103, stores[0], 2, "open", "distributor", [posmLine("jacket", "Sample jacket", 10, "pending")]),
        req(4102, stores[1] ?? stores[0], 8, "dispatched", "franchise", [posmLine("frp", "FRP Cover", 1, "dispatched", [{ label: "Design", value: "H Cross · Bl. White / Wine" }])], { courier: "DTDC", tracking: "D7712004411" }),
        req(4101, stores[2] ?? stores[0], 30, "delivered", "asm", [posmLine("tshirt", "T-shirt", 2, "delivered")]),
    ];
}

/** Buy More for each of the distributor's stores, on the server's rules. */
function seedDistributorBuyMore(stores: Store[]) {
    const now = Date.now();
    const file = (n: string) => [{ name: n, url: `${window.location.origin}/images/training/invoice.svg` }];
    const inv = (no: string, ago: number, sets: any, status: string, note: string | null = null) => ({
        id: `dinv-${no}`, invoice_no: no, invoice_date: istDay(now - ago * DAY), files: file(`${no}.pdf`), sets: { ...noSets(), ...sets }, read_sets: null,
        status, review_note: note, reviewed_at: status === "pending" ? null : iso(now - (ago - 1) * DAY), created_at: iso(now - ago * DAY), added_by: "distributor",
    });
    const plan = [
        [inv("SAD-311", 7, { velora: 4, doble: 2, signature: 2, emporio: 1, other: 3 }, "approved"), inv("SAD-318", 2, { other: 2 }, "pending")],
        [inv("RCA-120", 5, { signature: 2, emporio: 1, other: 1 }, "approved")],
        [inv("SPM-044", 4, { other: 3 }, "rejected", "The invoice photo is cut off. Please add a clear photo of the whole page.")],
    ];
    return stores.map((s, i) => ({ store_id: s.id, invoices: plan[i] ?? [], freeSets: [] as any[] }));
}

/* ---------- the routes ---------- */

type On = (method: string, path: string, handler: (c: any) => any) => void;
interface Deps {
    fail: (status: number, message: string) => never; nextId: () => number; now: () => number; mode: Mode;
    fileUrls: (form: FormData | null, match: (k: string) => boolean) => string[];
    warrantyCard: (w: any) => any; displayOf: (itemId: string, values: any) => any[];
}

const posmLine = (item: string, item_name: string, qty: number, stage: string, display: { label: string; value: string }[] = []) =>
    ({ item_id: item, item_name, qty, values: {}, display, approved_qty: stage === "pending" ? null : qty, line_status: stage, note: null });

export function registerNewerRoutes(on: On, S: any, d: Deps) {
    S.oldWarranties ??= seedOldWarranties(S.profile.store_name);
    S.posmHistory ??= d.mode === "franchise" ? seedPosmHistory() : [];
    const stores: Store[] = (S.franchises ?? []).map((f: any) => ({ id: f.vendor_id, store_name: f.store_name, store_code: null, city: f.city }));
    S.distPosm ??= seedDistributorPosm(stores, posmLine);
    S.distBuyMore ??= seedDistributorBuyMore(stores);

    /* Old warranties: the store's own, with counts by year and by cover now. */
    on("GET", "/claims/store/old-warranties", ({ q }: any) => {
        const term = String(q.get("q") ?? "").trim().toLowerCase();
        const digits = term.replace(/\D/g, "");
        const year = /^\d{4}$/.test(q.get("year") ?? "") ? q.get("year") : null;
        const page = Math.max(1, Number(q.get("page")) || 1);
        const all: any[] = S.oldWarranties;
        const hits = all.filter(o => (!year || o.purchase_date.startsWith(year))
            && (!term || o.uid.includes(term) || o.customer_name.toLowerCase().includes(term) || o.product_name.toLowerCase().includes(term)
                || (digits.length >= 4 && o.customer_mobile.includes(digits))));
        const years = new Map<number, number>();
        const cover = { covered: 0, over: 0, not_recorded: 0 } as Record<string, number>;
        for (const o of all) { const y = Number(o.purchase_date.slice(0, 4)); years.set(y, (years.get(y) ?? 0) + 1); cover[coverOf(o)]++; }
        return {
            success: true, total: all.length, found: hits.length, page, pages: Math.max(1, Math.ceil(hits.length / 50)),
            years: [...years].sort((a, b) => a[0] - b[0]).map(([y, n]) => ({ year: y, n })), cover, claims_live: true,
            warranties: hits.slice((page - 1) * 50, page * 50).map(o => oldCard(o, d.warrantyCard)),
        };
    });

    /* POSM › Received: the allowance, what is coming, the shipments. Never the expected date, urgent mark or reasons. */
    on("GET", "/posm/history", () => ({
        success: true, summary: summarise(S.posmHistory, DEFAULT_SETTINGS), store_type: DEFAULT_SETTINGS.store_type, lines: S.posmHistory,
    }));

    /* A distributor's POSM for its stores. */
    on("GET", "/posm/distributor/stores", () => ({ success: true, stores }));
    on("GET", "/posm/distributor/requests", () => ({ success: true, requests: S.distPosm }));
    on("GET", "/posm/distributor/stores/:id/catalog", ({ p }: any) => {
        if (!stores.some(s => s.id === p[0])) d.fail(404, "Store not found");
        const mine = S.distPosm.filter((r: any) => r.store_id === p[0]);
        return { success: true, data: { catalog: LIVE_POSM_CATALOG, brands: ["AF"], usage: usageFrom(mine, new Date(d.now())) } };
    });
    on("POST", "/posm/distributor/stores/:id/items", ({ p, body, form }: any) => {
        const s = stores.find(x => x.id === p[0]) ?? d.fail(404, "Store not found");
        const lines = JSON.parse(body.items || "[]");
        if (!lines.length) d.fail(400, "Pick at least one item");
        const id = d.nextId();
        const ticketId = `POSM-TR-${id}`;
        S.distPosm.unshift({
            id, ticket_id: ticketId, requirement: body.note || "", status: "open", created_by_role: "distributor", created_by_name: S.profile.owner_name,
            created_at: iso(d.now()), store_id: s.id, store_name: s.store_name, city: s.city, dispatch: null,
            items: lines.map((l: any, i: number) => ({ ...l, display: d.displayOf(l.item_id, l.values), files: d.fileUrls(form, k => k.startsWith(`line_${i}_`)), approved_qty: null, line_status: "pending", note: null })),
        });
        return { success: true, data: { ticketId, id }, message: `Raised for ${s.store_name}. In the live portal head office reviews it, and the store is told.` };
    });

    /* A distributor's Buy More for its stores. */
    const scheme = () => {
        const today = istDay(d.now());
        const first = `${today.slice(0, 7)}-01`;
        const end = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) + 4, 0)).toISOString().slice(0, 10);
        return { id: SELL_MORE_ID, title: SELL_MORE_PROGRAM, starts_on: first, ends_on: end, status: "published", terms: "Training program. The terms here are examples; in the live portal they come from head office.", banner_url: null };
    };
    const storeView = (b: any) => {
        const s = stores.find(x => x.id === b.store_id)!;
        const approved = b.invoices.filter((i: any) => i.status === "approved").reduce((t: any, i: any) => addSets(t, i.sets), noSets());
        const used = b.freeSets.reduce((t: any, c: any) => addSets(t, c.used ?? noSets()), noSets());
        const available = subtractSets(approved, used);
        return {
            store_id: s.id, store_name: s.store_name, store_code: s.store_code, city: s.city, state: "Madhya Pradesh",
            approved, used, available, eligibility: eligibility(available), rewards: b.freeSets.length,
            waiting_sets: b.invoices.filter((i: any) => i.status === "pending").reduce((n: number, i: any) => n + setsTotal(i.sets), 0),
            invoices: b.invoices,
        };
    };
    const PRODUCTS = ["Velora", "Doble", "Signature", "Emporio", "Amaze", "Sportz", "D3", "D5", "U-FOCUS"];
    on("GET", "/schemes/distributor", () => ({
        success: true, schemes: d.mode === "distributor" && stores.length ? [{ id: SELL_MORE_ID, title: SELL_MORE_PROGRAM, stores: stores.length }] : [],
    }));
    on("GET", "/schemes/distributor/:id", ({ p }: any) => {
        if (p[0] !== SELL_MORE_ID || d.mode !== "distributor") d.fail(404, "Scheme not found");
        return { success: true, distributor: S.profile.store_name, scheme: scheme(), can_add: true, stores: S.distBuyMore.map(storeView), products: PRODUCTS };
    });
    on("POST", "/schemes/distributor/:id/invoices", ({ p, body, form }: any) => {
        if (p[0] !== SELL_MORE_ID || d.mode !== "distributor") d.fail(404, "Scheme not found");
        const b = S.distBuyMore.find((x: any) => x.store_id === String(body.store_id ?? "")) ?? d.fail(400, "Pick one of your stores");
        const files: File[] = [];
        form?.forEach((v: any, k: string) => { if (k === "invoice" && v instanceof File) files.push(v); });
        const sets = readSets(JSON.parse(body.sets || "{}"));
        const sc = scheme();
        const problems = invoiceProblems({ invoice_no: String(body.invoice_no ?? ""), invoice_date: String(body.invoice_date ?? ""), sets, files: files.length }, sc.starts_on, sc.ends_on, istDay(d.now()));
        if (problems.length) d.fail(400, problems[0]);
        const no = String(body.invoice_no).trim();
        if (b.invoices.some((i: any) => i.invoice_no.toLowerCase() === no.toLowerCase() && i.status !== "rejected")) d.fail(400, "This invoice number has already been added.");
        b.invoices.unshift({
            id: `dinv-${d.nextId()}`, invoice_no: no, invoice_date: String(body.invoice_date), sets, files: files.map(f => ({ name: f.name, url: URL.createObjectURL(f) })),
            read_sets: body.read_sets ? readSets(JSON.parse(body.read_sets)) : null, status: "pending", review_note: null, reviewed_at: null, created_at: iso(d.now()), added_by: "distributor",
        });
        return { success: true, message: "Sent for approval. In the live portal head office reviews it." };
    });
}
