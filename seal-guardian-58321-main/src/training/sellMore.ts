/* eslint-disable @typescript-eslint/no-explicit-any -- stand-ins for the API's JSON, which the screens read untyped */
import {
    SELL_MORE_ID, SELL_MORE_PROGRAM, rewardSlab, eligibility, setsForOffer, subtractSets, addSets, setsTotal, noSets, readSets, invoiceProblems, isOffer,
    type Sets,
} from "../../../server/src/services/sellMoreEarnMore";
import { istDay, iso } from "./seed";

/**
 * Sell More Earn More in the training store. Option 1 (points on warranties)
 * and Option 2 (invoices and free sets) both work on made-up numbers; the
 * rules, the free-set offers and the reward ladder are the server's own.
 */

const DAY = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
const nextMonth = (key: string, n: number) => {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export interface SellMoreState {
    option: "sell_more" | "buy_more" | null;
    opted_at: string | null;
    /** Reward requests on Option 1, newest last. */
    rewards: { status: "requested" | "sent"; note: string | null; requested_at: string; sent_at: string | null }[];
    invoices: any[];
    freeSets: any[];
}

export const seedSellMore = (): SellMoreState => ({ option: null, opted_at: null, rewards: [], invoices: [], freeSets: [] });

const PRODUCTS = [
    "Velora", "Doble", "Signature", "Emporio", "Amaze", "Sportz", "D3", "D3 (Signature)", "D3 (Emporio)", "D5", "D5 (SIGNATURE)",
    "U-Sports (Signature)", "U-Sports (Emporio)", "U-FOCUS", "U-BLADE (Signature)", "ARO LINE (DOBLE)", "ARROW CRYSTAL (DOBLE)", "VECTOR (SIGNATURE)", "H-CROSS (EMPORIO)",
];

function programDates() {
    const today = istDay(Date.now());
    const first = `${today.slice(0, 7)}-01`;
    const lastKey = nextMonth(today.slice(0, 7), 4);
    const last = new Date(Date.UTC(Number(lastKey.slice(0, 4)), Number(lastKey.slice(5)), 0)).toISOString().slice(0, 10);
    return { today, first, last };
}

/** The scheme as a store may see it. */
export function sellMoreScheme() {
    const { first, last } = programDates();
    return {
        id: SELL_MORE_ID, title: SELL_MORE_PROGRAM, category: "Franchisee benefit", summary: "Choose one option: earn points on every warranty, or buy sets and get free ones.",
        banner_url: null, starts_on: first, ends_on: last, status: "published", state: "live", windows: [], open_window: null, next_window: null,
        terms: "Training program. The terms here are examples; in the live portal they come from head office.",
        settings: { live: true, option_banners: {}, points: { series: [], tiers: [] } },
    };
}

function buyMore(s: SellMoreState) {
    const approvedSets = s.invoices.filter(i => i.status === "approved").reduce((t, i) => addSets(t, i.sets), noSets());
    const used = s.freeSets.filter(c => c.status === "approved").reduce((t, c) => addSets(t, c.used ?? noSets()), noSets());
    const available = subtractSets(approvedSets, used);
    return {
        invoices: s.invoices, approved: approvedSets, used, available, eligibility: eligibility(available),
        rewards: s.freeSets.filter(c => c.status === "approved").length,
        waiting_sets: s.invoices.filter(i => i.status === "pending").reduce((n, i) => n + setsTotal(i.sets), 0),
        claims: s.freeSets, products: PRODUCTS,
    };
}

/** Option 1 as the store sees it: this month's points against a target, and the reward ladder. */
function months(s: SellMoreState) {
    const { today } = programDates();
    const key = today.slice(0, 7);
    const target = 12;
    const points = 14.5;
    const claimed = s.rewards.length;
    const slab = rewardSlab(target, points, claimed);
    const last = s.rewards[s.rewards.length - 1] ?? null;
    const days = [[-6, 2, 2.5], [-5, 1, 1.25], [-4, 3, 3.75], [-2, 2, 2.5], [-1, 2, 2.5], [0, 1, 2]]
        .map(([ago, w, p]) => ({ date: addDays(today, ago as number), warranties: w as number, points: p as number }))
        .filter(d => d.date >= `${key}-01`);
    const first = {
        key, label: monthLabel(key), warranties: 11, points, future: false, target, pct: Math.floor((points / target) * 100), days,
        series: [
            { name: "Signature", warranties: 4, points: 6 }, { name: "Emporio", warranties: 2, points: 3 },
            { name: "Velora", warranties: 3, points: 3.75 }, { name: "Amaze", warranties: 2, points: 1.75 },
        ],
        can_request: Boolean((slab && slab.to_next === 0 && !last) || (slab && slab.to_next === 0 && last?.status === "sent")),
        reward: last ? { status: last.status, note: last.note, requested_at: last.requested_at, sent_at: last.sent_at } : null,
        reward_slab: slab, rewards_claimed: claimed,
    };
    const rest = [1, 2, 3, 4].map(n => ({
        key: nextMonth(key, n), label: monthLabel(nextMonth(key, n)), warranties: 0, points: 0, future: true, target: null, pct: null, days: [], series: [],
        can_request: false, reward: null, reward_slab: null, rewards_claimed: 0,
    }));
    return [first, ...rest];
}

export function storeSellMore(s: SellMoreState, onlyBuyMore: boolean) {
    const base = { option: s.option, opted_at: s.opted_at, assigned: true, only_option: onlyBuyMore ? "buy_more" : null };
    if (s.option === "sell_more") {
        const m = months(s);
        return { ...base, total: m[0].points, warranties: m[0].warranties, months: m };
    }
    return { ...base, total: 0, warranties: 0, months: [], buy_more: s.option === "buy_more" ? buyMore(s) : null };
}

export function sellMoreCard(s: SellMoreState, onlyBuyMore: boolean) {
    const data: any = storeSellMore(s, onlyBuyMore);
    const latest = (data.months as any[]).filter(m => !m.future).pop();
    const buy = data.buy_more ?? null;
    const sc = sellMoreScheme();
    return {
        id: sc.id, title: sc.title, category: sc.category, summary: sc.summary, banner_url: null, starts_on: sc.starts_on, ends_on: sc.ends_on,
        windows: [], open_window: null, next_window: null, state: sc.state, has_score: false, joined: Boolean(s.option), achieved: null, run: "sell_more",
        sell_more: {
            opted: Boolean(s.option), option: s.option, total: data.total, month_label: latest?.label ?? null, month_points: latest?.points ?? 0,
            free_sets: buy?.rewards ?? 0, approved_sets: buy?.eligibility.total ?? 0,
        },
    };
}

/* ---------- the routes ---------- */

type On = (method: string, path: string, handler: (c: any) => any) => void;
interface Deps { fail: (status: number, message: string) => never; nextId: () => number; now: () => number; onlyBuyMore: boolean }

export function registerSellMoreRoutes(on: On, S: any, d: Deps) {
    const mine = (): SellMoreState => S.sellMore;
    const check = (id: string) => { if (id !== SELL_MORE_ID) d.fail(404, "Scheme not found"); };

    on("POST", "/schemes/:id/opt", ({ p, body }: any) => {
        check(p[0]);
        const s = mine();
        if (s.option) d.fail(400, "You have already chosen an option. It can't be changed.");
        const option = body.option;
        if (option !== "sell_more" && option !== "buy_more") d.fail(400, "Choose an option");
        if (d.onlyBuyMore && option === "sell_more") d.fail(400, "This option isn't open to distributors.");
        if (!body.accept_terms) d.fail(400, "Please accept the terms and conditions.");
        s.option = option;
        s.opted_at = iso(d.now());
        if (option === "buy_more" && !s.invoices.length) {
            const today = programDates().today;
            const file = (name: string) => [{ name, url: `${window.location.origin}/images/training/invoice.svg` }];
            s.invoices = [
                { id: `inv-${d.nextId()}`, invoice_no: "INV-2041", invoice_date: addDays(today, -6), files: file("INV-2041.pdf"), sets: { velora: 3, doble: 1, signature: 1, emporio: 0, other: 4 }, read_sets: null,
                    status: "approved", review_note: null, reviewed_at: iso(d.now() - 5 * DAY), created_at: iso(d.now() - 6 * DAY) },
                { id: `inv-${d.nextId()}`, invoice_no: "INV-2057", invoice_date: addDays(today, -2), files: file("INV-2057.pdf"), sets: { ...noSets(), other: 2 }, read_sets: null,
                    status: "pending", review_note: null, reviewed_at: null, created_at: iso(d.now() - 2 * DAY) },
                { id: `inv-${d.nextId()}`, invoice_no: "INV-2012", invoice_date: addDays(today, -9), files: file("INV-2012.pdf"), sets: { ...noSets(), other: 3 }, read_sets: null,
                    status: "rejected", review_note: "The invoice photo is cut off. Please add a clear photo of the whole page.", reviewed_at: iso(d.now() - 8 * DAY), created_at: iso(d.now() - 9 * DAY) },
            ];
        }
        return { success: true };
    });

    on("POST", "/schemes/:id/redeem", ({ p, body }: any) => {
        check(p[0]);
        const s = mine();
        if (s.option !== "sell_more") d.fail(400, "Only stores on Sell More Earn More can ask for this reward.");
        const m = months(s).find(x => x.key === body.month && !x.future);
        if (!m) d.fail(400, "Choose a month that has started");
        if (!m!.can_request) d.fail(400, m!.reward?.status === "requested" ? "You have already asked for this reward." : "Your points haven't reached the next milestone yet.");
        s.rewards.push({ status: "requested", note: null, requested_at: iso(d.now()), sent_at: null });
        return { success: true };
    });

    on("POST", "/schemes/:id/invoices", ({ p, body, form }: any) => {
        check(p[0]);
        const s = mine();
        if (s.option !== "buy_more") d.fail(400, "Only stores on Buy More Get More can add invoices.");
        const files: File[] = [];
        form?.forEach((v: any, k: string) => { if (k === "invoice" && v instanceof File) files.push(v); });
        const sets = readSets(JSON.parse(body.sets || "{}"));
        const { today, first, last } = programDates();
        const problems = invoiceProblems({ invoice_no: String(body.invoice_no ?? ""), invoice_date: String(body.invoice_date ?? ""), sets, files: files.length }, first, last, today);
        if (problems.length) d.fail(400, problems[0]);
        const no = String(body.invoice_no).trim();
        if (s.invoices.some(i => i.invoice_no.toLowerCase() === no.toLowerCase() && i.status !== "rejected")) d.fail(400, "This invoice number has already been added.");
        s.invoices.unshift({
            id: `inv-${d.nextId()}`, invoice_no: no, invoice_date: String(body.invoice_date), sets,
            files: files.map(f => ({ name: f.name, url: URL.createObjectURL(f) })),
            read_sets: body.read_sets ? readSets(JSON.parse(body.read_sets)) : null,
            status: "pending", review_note: null, reviewed_at: null, created_at: iso(d.now()),
        });
        return { success: true, message: "Sent for approval. In the live portal head office reviews it." };
    });

    on("POST", "/schemes/:id/claims", ({ p, body }: any) => {
        check(p[0]);
        const s = mine();
        if (s.option !== "buy_more") d.fail(400, "Only stores on Buy More Get More can redeem free sets.");
        if (!isOffer(body.offer)) d.fail(400, "Choose an offer");
        if (s.freeSets.some(c => c.status === "requested")) d.fail(400, "You already have a request waiting for head office.");
        const bm = buyMore(s);
        const ok = body.offer === "offer1" ? bm.eligibility.offer1.ready : bm.eligibility.offer2_ready;
        if (!ok) d.fail(400, "You don't have the sets for this offer yet.");
        s.freeSets.unshift({ id: `fs-${d.nextId()}`, offer: body.offer, used: setsForOffer(bm.available, body.offer), status: "requested", note: null, requested_at: iso(d.now()), sent_at: null });
        return { success: true };
    });
}

export const isSellMoreId = (id: string) => id === SELL_MORE_ID;
export type { Sets };
