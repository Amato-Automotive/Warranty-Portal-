/**
 * Sell More Earn More, Nov 2026 to Mar 2027. Hardcoded on purpose: this one
 * scheme has its own rules and no builder in the admin. A franchise normally
 * opts for one option once; an admin assignment can override or release it.
 *
 * Option 1 (Sell More): points on every warranty the store registers, by the
 * series its product is in, counted live, rejected ones left out. No targets.
 * What each series is worth and which products are in it stay in the scheme's
 * settings. The store always sees its plain points. The admin puts a store in
 * a store type and sets that type's points series by series, which changes the
 * calculated score the admin alone sees. Points don't carry forward, so each
 * month is rewarded on its own: the store asks for that month, or the admin sends
 * without being asked, by hand. Kept free of any database import so it is tested directly.
 */
import { roundPoints, type Period, type PointsRule, type StoreTier } from './schemeTargets.js';

/* ─── Who the program is open to ──────────────────────────────────────────── */

export type AudienceGroup = 'AF' | 'AC' | 'AFAC' | 'distributors';
export const AUDIENCE_GROUPS: AudienceGroup[] = ['AF', 'AC', 'AFAC', 'distributors'];
export type AssignedOption = 'sell_more' | 'buy_more';
export interface Audience { groups: Record<AudienceGroup, boolean>; include: string[]; exclude: string[]; assignments: Record<string, AssignedOption> }

/** A store's group: distributor only, else a franchise by its brand. A store that is both counts as a franchise. */
export function groupOf(store: { is_franchise: unknown; allowed_brands?: unknown }): AudienceGroup {
    if (!store.is_franchise) return 'distributors';
    const b = String(store.allowed_brands ?? '').trim().toUpperCase();
    return b === 'AC' || b === 'AFAC' ? b : 'AF';
}

/** The audience as saved or sent: groups on unless switched off; a store can't be both always and never. */
export function readAudience(raw: any): Audience {
    const ids = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(x => String(x ?? '').trim()).filter(Boolean))].slice(0, 2000);
    const exclude = ids(raw?.exclude);
    const assignments = Object.fromEntries(Object.entries(raw?.assignments ?? {}).filter(([id, option]) =>
        ids([id]).length > 0 && (option === 'sell_more' || option === 'buy_more'))
    ) as Record<string, AssignedOption>;
    return {
        groups: Object.fromEntries(AUDIENCE_GROUPS.map(g => [g, raw?.groups?.[g] !== false])) as Record<AudienceGroup, boolean>,
        include: ids(raw?.include).filter(id => !exclude.includes(id)),
        exclude,
        assignments,
    };
}

/** Whether a store can see the program: its own setting first, then its group's. */
export function inAudience(store: { id: string; is_franchise: unknown; allowed_brands?: unknown }, a: Audience): boolean {
    if (a.exclude.includes(store.id)) return false;
    if (a.include.includes(store.id)) return true;
    return a.groups[groupOf(store)];
}

/** Distributors only get Buy More Get More; franchises choose either. */
export const optionAllowed = (option: unknown, store: { is_franchise: unknown }) =>
    option === 'buy_more' || (option === 'sell_more' && Boolean(store.is_franchise));

/** The published scheme on the live portal. */
export const SELL_MORE_ID = '22dc9530-8c7e-4438-9230-4f7aa31d3e3d';
export const isSellMore = (id: string) => id === SELL_MORE_ID;
/** One program with two options: Sell More Earn More, and Buy More Get More. */
export const SELL_MORE_PROGRAM = 'Sell More Earn More Franchisee Benefit Program';

export type SellMoreOption = 'sell_more' | 'buy_more';

/** The option a store opted for, from its terms on the scheme. */
export function optionOf(terms: unknown): SellMoreOption | null {
    const o = (terms as any)?.option;
    return o === 'sell_more' || o === 'buy_more' ? o : null;
}

/** What one warranty of each series earns for a store type: what the admin set, else the series' points × its multiplier. */
export function rateFor(tier: StoreTier, series: { id: string; points: number }): number {
    return roundPoints(tier.rates?.[series.id] ?? series.points * tier.times);
}

/** Each product's points by its name in lower case: plain with no store type, else that type's. */
export function worthOf(rule: PointsRule, tier: StoreTier | null = null): Map<string, number> {
    const out = new Map<string, number>();
    for (const s of rule.series) for (const p of s.products) {
        const k = p.trim().toLowerCase();
        if (k && !out.has(k)) out.set(k, tier ? rateFor(tier, s) : s.points);
    }
    return out;
}

/** One row of warranties: a day, a product name in lower case, and how many (rejected ones already left out). */
export interface WarrantyRow { d: string; pn: string; n: number }
export interface EarnedDay { date: string; warranties: number; points: number; no_series: number }
export interface EarnedMonth { key: string; label: string; warranties: number; points: number; no_series: number; days: EarnedDay[] }
export interface Earned { total: number; warranties: number; no_series: number; months: EarnedMonth[] }

/**
 * What a store has earned, month by month and day by day, newest day first.
 * `worth` is what each product earns (see worthOf). A warranty whose product is
 * in no series earns nothing and is counted as `no_series`, so the admin sees it.
 */
export function earned(rows: WarrantyRow[], worth: Map<string, number>, months: Period[], from: string, to: string): Earned {
    const out: EarnedMonth[] = months.map(m => ({ key: m.key, label: m.label, warranties: 0, points: 0, no_series: 0, days: [] }));
    const byKey = new Map(out.map(m => [m.key, m]));
    const days = new Map<string, EarnedDay>();
    for (const r of rows) {
        if (!r.d || r.d < from || r.d > to) continue;
        const month = byKey.get(r.d.slice(0, 7));
        if (!month) continue;
        const n = Number(r.n) || 0;
        const each = worth.get(String(r.pn ?? '').trim().toLowerCase()) ?? 0;
        let day = days.get(r.d);
        if (!day) { day = { date: r.d, warranties: 0, points: 0, no_series: 0 }; days.set(r.d, day); month.days.push(day); }
        if (each > 0) {
            const got = each * n;
            day.warranties += n; day.points = roundPoints(day.points + got);
            month.warranties += n; month.points = roundPoints(month.points + got);
        } else {
            day.no_series += n; month.no_series += n;
        }
    }
    for (const m of out) m.days.sort((a, b) => b.date.localeCompare(a.date));
    return {
        total: roundPoints(out.reduce((s, m) => s + m.points, 0)),
        warranties: out.reduce((s, m) => s + m.warranties, 0),
        no_series: out.reduce((s, m) => s + m.no_series, 0),
        months: out,
    };
}

/**
 * A store's category for a month: what the admin set for it, else the nearest
 * earlier month's, else its first category. Saves typing it every month.
 */
export function tierIdForMonth(set: Record<string, string | null | undefined>, months: Period[], key: string, fallback: string | undefined): string | undefined {
    const at = months.findIndex(m => m.key === key);
    for (let i = at; i >= 0; i--) {
        const t = set[months[i].key];
        if (t) return t;
    }
    return fallback;
}

/** What each series earned in one month, for a store type or plain. */
export function seriesInMonth(rows: WarrantyRow[], rule: PointsRule, month: string, from: string, to: string, tier: StoreTier | null = null) {
    const seriesOf = new Map<string, string>();
    for (const s of rule.series) for (const p of s.products) {
        const k = p.trim().toLowerCase();
        if (k && !seriesOf.has(k)) seriesOf.set(k, s.id);
    }
    const n = new Map<string, number>();
    for (const r of rows) {
        if (!r.d || r.d < from || r.d > to || r.d.slice(0, 7) !== month) continue;
        const id = seriesOf.get(String(r.pn ?? '').trim().toLowerCase());
        if (id) n.set(id, (n.get(id) ?? 0) + (Number(r.n) || 0));
    }
    return rule.series.map(s => {
        const warranties = n.get(s.id) ?? 0;
        return { name: s.name, warranties, points: roundPoints(warranties * (tier ? rateFor(tier, s) : s.points)) };
    });
}

/**
 * A target as the store sees it. The admin's target is in calculated points but
 * the store sees plain points, so it is shown on the store's own scale: the same
 * share of the way there, whatever the store's category. With no warranties yet
 * the category's multiplier gives the scale.
 */
export function storeScaleTarget(target: number | null, plain: number, calculated: number, times: number): number | null {
    if (target === null) return null;
    return roundPoints(target * (calculated > 0 ? plain / calculated : 1 / (times || 1)));
}

/** Why a store can't ask for one month's reward, or null when it can. It opens once the store reaches that month's target. */
export function redeemProblem(option: SellMoreOption | null, month: { points: number; can_request?: boolean } | null, alreadyAsked: boolean): string | null {
    if (option !== 'sell_more') return 'Choose this option first';
    if (!month) return 'That month is not open';
    if (!month.can_request) return "You aren't eligible for this month's reward yet";
    if (alreadyAsked) return "This month's reward has already been asked for";
    if (month.points <= 0) return 'You have no points in this month';
    return null;
}

/* ─── Option 2: Buy More Get More ─────────────────────────────────────────── */

export const SET_KINDS = ['velora', 'doble', 'signature', 'emporio', 'other'] as const;
export type SetKind = (typeof SET_KINDS)[number];
export type Sets = Record<SetKind, number>;
export const noSets = (): Sets => ({ velora: 0, doble: 0, signature: 0, emporio: 0, other: 0 });

/** Offer 2's mix of 7 sets; any 12 sets of any kind make Offer 1. */
export const PREMIUM_MIX: Record<Exclude<SetKind, 'other'>, number> = { velora: 4, doble: 1, signature: 1, emporio: 1 };
export const MIX_SIZE = 7;
export const ANY_SIZE = 12;

/** Sets as sent: whole numbers from 0 to 500 for each kind, anything else dropped. */
export function readSets(raw: unknown): Sets {
    let v: any = raw;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = {}; } }
    const out = noSets();
    for (const k of SET_KINDS) {
        const n = Math.floor(Number(v?.[k]));
        out[k] = Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 0;
    }
    return out;
}

export const addSets = (a: Sets, b: Sets): Sets => Object.fromEntries(SET_KINDS.map(k => [k, a[k] + b[k]])) as Sets;
export const setsTotal = (s: Sets) => SET_KINDS.reduce((n, k) => n + s[k], 0);

export type Offer = 'offer1' | 'offer2';
export const isOffer = (v: unknown): v is Offer => v === 'offer1' || v === 'offer2';

/** Sets a minus sets b, never below zero: the balance after what was used. */
export const subtractSets = (a: Sets, b: Sets): Sets => Object.fromEntries(SET_KINDS.map(k => [k, Math.max(0, a[k] - b[k])])) as Sets;

export interface Eligibility {
    total: number;
    /* Sets towards Offer 1, of 12. */
    offer1: { have: number; more: number; ready: boolean };
    /* Each premium kind towards Offer 2's mix. */
    offer2: { kind: Exclude<SetKind, 'other'>; have: number; need: number; more: number }[];
    offer2_ready: boolean;
}

/**
 * Where a store stands, from the sets it has available: approved, less what
 * rewards already used. Sets left over carry forward until the program ends.
 */
export function eligibility(available: Sets): Eligibility {
    const kinds = Object.keys(PREMIUM_MIX) as (keyof typeof PREMIUM_MIX)[];
    const total = setsTotal(available);
    const offer2 = kinds.map(kind => {
        const need = PREMIUM_MIX[kind];
        const have = Math.min(need, available[kind]);
        return { kind, have, need, more: need - have };
    });
    return {
        total,
        offer1: { have: Math.min(total, ANY_SIZE), more: Math.max(0, ANY_SIZE - total), ready: total >= ANY_SIZE },
        offer2, offer2_ready: offer2.every(r => r.more === 0),
    };
}

/**
 * The sets an offer uses up, which the admin may change when approving. Offer 2
 * uses its mix. Offer 1 uses other sets first, then whichever premium kind has
 * the most to spare, so as many mixes as possible stay within reach.
 */
export function setsForOffer(available: Sets, offer: Offer): Sets {
    if (offer === 'offer2') return { ...noSets(), ...PREMIUM_MIX };
    const used = noSets();
    const left = { ...available };
    let need = ANY_SIZE;
    const take = (k: SetKind, n: number) => { used[k] += n; left[k] -= n; need -= n; };
    take('other', Math.min(left.other, need));
    const kinds = Object.keys(PREMIUM_MIX) as (keyof typeof PREMIUM_MIX)[];
    while (need > 0) {
        const k = kinds.filter(x => left[x] > 0).sort((a, b) => left[b] / PREMIUM_MIX[b] - left[a] / PREMIUM_MIX[a])[0];
        if (!k) break;
        take(k, 1);
    }
    return used;
}

/** Why the admin can't use these sets, or null: some must be used, and no more of a kind than the store has. */
export function usedProblem(used: Sets, available: Sets): string | null {
    if (setsTotal(used) <= 0) return 'Enter the sets this reward uses';
    const over = SET_KINDS.find(k => used[k] > available[k]);
    return over ? `The store has only ${available[over]} ${over} available` : null;
}

/** Problems with an invoice a store is sending, in words. */
export function invoiceProblems(i: { invoice_no: string; invoice_date: string; sets: Sets; files: number }, from: string, to: string, today: string): string[] {
    const p: string[] = [];
    if (!i.files) p.push('Add the invoice file');
    if (!i.invoice_no.trim()) p.push('Enter the invoice number');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.invoice_date)) p.push('Enter the invoice date');
    else if (i.invoice_date < from || i.invoice_date > to) p.push('The invoice date is outside the program period');
    else if (i.invoice_date > today) p.push("The invoice date can't be in the future");
    if (setsTotal(i.sets) <= 0) p.push('Enter the sets on this invoice');
    return p;
}
