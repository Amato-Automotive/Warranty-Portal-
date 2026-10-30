import { findState } from './indianStates.js';

/**
 * Offers & Schemes: the rules, free of any database import so they are tested
 * directly.
 *
 * An admin builds a scheme: who it is for, what a store submits (fields the
 * admin picks, uploads included), how an entry scores, and what a score earns.
 * Stores join and submit entries; the admin approves or rejects each one. The
 * score is the sum of APPROVED entries plus any manual adjustment — nothing is
 * counted automatically. Stores see what they have achieved: their score, the
 * slab reached, the reward earned and their rank — never how far they are from
 * the next slab.
 */

/* ─── Shapes ──────────────────────────────────────────────────────────────── */

export const SCHEME_CATEGORIES = ['sales', 'display', 'contest', 'offer'] as const;
export type SchemeCategory = typeof SCHEME_CATEGORIES[number];

/* 'distributor': the store picks the distributor it bought from (its mapped ones, or any in its state). */
export const FIELD_TYPES = ['number', 'text', 'date', 'select', 'file', 'distributor'] as const;
export type FieldType = typeof FIELD_TYPES[number];

/* What an upload field accepts, by the names an admin picks. */
export const FILE_FORMATS: Record<string, string[]> = {
    image: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
    pdf: ['pdf'],
    video: ['mp4', 'mov', 'webm', '3gp'],
    excel: ['xls', 'xlsx', 'csv'],
};
export type FileFormat = keyof typeof FILE_FORMATS;

export interface SchemeField {
    id: string;
    label: string;
    type: FieldType;
    required: boolean;
    /* select */
    options?: string[];
    /* file */
    formats?: FileFormat[];
    max_files?: number;
    max_mb?: number;
}

export type ScoreRule =
    /* The sum of a number field, e.g. "Quantity sold". */
    | { mode: 'sum'; field_id: string }
    /* One point per approved entry. */
    | { mode: 'count' }
    /* The admin types the points when approving. */
    | { mode: 'points' }
    /* The admin picks products and quantities off the invoice when
       approving; each product is worth the points set here. */
    | { mode: 'products'; products: ProductPoints[] }
    /* No score: an offer, or a scheme judged outside the app. */
    | { mode: 'none' };

export interface Slab { min: number; max: number | null; reward: string }
export interface RankPrize { from: number; to: number; reward: string }

export type RewardRule =
    | { mode: 'none' }
    | { mode: 'slabs'; slabs: Slab[] }
    | { mode: 'per_unit'; amount: number; unit_label?: string }
    | { mode: 'rank'; prizes: RankPrize[] }
    | { mode: 'per_entry'; reward: string }
    /* Each club's own reward: Silver → 4 sets, Gold → 7 sets… */
    | { mode: 'clubs' };

export interface Eligibility {
    mode: 'all' | 'states' | 'stores';
    states?: string[];
    store_ids?: string[];
    /* AF, AC, or null for both. */
    /** Only the stores of this brand: Autoform only, Autocruze only, or the ones with both. None: every brand. */
    brand?: 'AF' | 'AC' | 'AFAC' | null;
}

/**
 * A club a store joins by its score, e.g. Silver from 180. Set per scheme by
 * the admin; a store is in the highest club whose `min` its score reaches.
 * `icon` names an icon from the screen's icon set, `color` one of its colours.
 */
export interface Club { id: string; name: string; min: number; icon: string; color: string; reward?: string }

/** The club a score puts a store in, or null below the lowest. */
export function clubFor(score: number, clubs: Club[]): Club | null {
    return [...clubs].sort((a, b) => b.min - a.min).find(c => score >= c.min) ?? null;
}

/** Problems with a scheme's clubs, in words. */
export function clubProblems(clubs: Club[]): string[] {
    const p: string[] = [];
    const names = new Set<string>();
    const mins = new Set<number>();
    for (const c of clubs) {
        const n = String(c.name ?? '').trim().toLowerCase();
        if (!n) p.push('Every club needs a name');
        else if (names.has(n)) p.push(`Two clubs are called "${c.name}"`);
        names.add(n);
        if (!Number.isFinite(Number(c.min)) || Number(c.min) < 0) p.push(`Set the score "${c.name || 'a club'}" starts at`);
        else if (mins.has(Number(c.min))) p.push(`Two clubs start at ${c.min}`);
        mins.add(Number(c.min));
    }
    return p;
}

/** One product the admin scores, and what one unit of it is worth. */
export interface ProductPoints { id: string; name: string; points: number }

/** A line the admin reads off an invoice when approving. */
export interface EntryLine { product_id: string; qty: number }

/**
 * When a scheme takes entries: one or more windows, each from a date and time
 * to a date and time, IST, as "YYYY-MM-DDTHH:mm" — e.g. 5 Oct 10:00 to 7 Oct
 * 18:00, then 5 Nov 10:00 to 7 Nov 18:00. Stores submit only while a window
 * is open; the scheme runs from the first window's start to the last's end.
 */
export interface SchemeWindow { start: string; end: string }

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** The windows in order of start. */
export const sortedWindows = (w: SchemeWindow[]) => [...w].sort((a, b) => a.start.localeCompare(b.start));

const lastEnd = (w: SchemeWindow[]) => w.reduce((m, x) => (x.end > m ? x.end : m), w[0].end);

/** The days the scheme spans, for lists and filters. */
export function windowSpan(w: SchemeWindow[]): { starts_on: string; ends_on: string } | null {
    const ok = sortedWindows(w.filter(x => STAMP.test(x.start) && STAMP.test(x.end)));
    if (!ok.length) return null;
    return { starts_on: ok[0].start.slice(0, 10), ends_on: lastEnd(ok).slice(0, 10) };
}

/** The window open at this moment, or null. */
export const openWindow = (w: SchemeWindow[], now: string) => sortedWindows(w).find(x => now >= x.start && now <= x.end) ?? null;

/** The next window to open after this moment, or null. */
export const nextWindow = (w: SchemeWindow[], now: string) => sortedWindows(w).find(x => x.start > now) ?? null;

/** Now in IST, as "YYYY-MM-DDTHH:mm". */
export const istNow = (at = Date.now()) => new Date(at + 5.5 * 3600_000).toISOString().slice(0, 16);

/**
 * The same window a month later, same days and times — for "repeat monthly".
 * A day past a short month's end becomes its last day (31 Jan → 28 Feb).
 */
export function nextMonth(w: SchemeWindow): SchemeWindow {
    const shift = (stamp: string) => {
        const [d, t] = stamp.split('T');
        const [y, m, day] = d.split('-').map(Number);
        const ny = m === 12 ? y + 1 : y;
        const nm = m === 12 ? 1 : m + 1;
        const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
        return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}T${t}`;
    };
    return { start: shift(w.start), end: shift(w.end) };
}

/** An entry's score from the products and quantities the admin read off it. */
export function linesScore(products: ProductPoints[], lines: EntryLine[]) {
    const problems: string[] = [];
    const byId = new Map(products.map(p => [p.id, p]));
    const out: { product_id: string; name: string; points: number; qty: number; subtotal: number }[] = [];
    for (const l of lines) {
        const p = byId.get(String(l.product_id));
        const qty = Number(l.qty);
        if (!p) { problems.push('A line names a product this scheme does not have'); continue; }
        if (!Number.isFinite(qty) || qty <= 0) { problems.push(`Give a quantity for ${p.name}`); continue; }
        out.push({ product_id: p.id, name: p.name, points: p.points, qty, subtotal: qty * p.points });
    }
    if (!out.length && !problems.length) problems.push('Add at least one product from the invoice');
    return { score: out.reduce((n, x) => n + x.subtotal, 0), lines: out, problems };
}

/** One invoice of an entry as the admin read it: its number, its files (pages), and what was on it. */
export interface InvoiceIn { invoice_no: string; files: string[]; lines: EntryLine[] }

/**
 * An entry read invoice by invoice. Each invoice needs its number (that is
 * what stops one invoice counting twice) and may have no counted products;
 * the entry needs at least one product overall. The entry's lines are the
 * invoices' lines added up per product, so totals, months and sell-through
 * read exactly as before.
 */
export function invoicesScore(products: ProductPoints[], invoices: InvoiceIn[]) {
    const problems: string[] = [];
    const out: { invoice_no: string; files: string[]; lines: ReturnType<typeof linesScore>['lines']; points: number }[] = [];
    const seen = new Map<string, number>();
    invoices.forEach((inv, i) => {
        const n = i + 1;
        const no = String(inv?.invoice_no ?? '').trim().slice(0, 80);
        if (!no) problems.push(`Give the invoice number for invoice ${n}`);
        const key = invoiceKey(no);
        if (key && seen.has(key)) problems.push(`Invoices ${seen.get(key)} and ${n} have the same number (${no}) — if they are pages of one invoice, put them together`);
        else if (key) seen.set(key, n);
        const given = (Array.isArray(inv?.lines) ? inv.lines : []).filter(l => Number(l?.qty) > 0);
        const r = given.length ? linesScore(products, given) : { score: 0, lines: [], problems: [] };
        problems.push(...r.problems.map(p => `Invoice ${n}: ${p}`));
        out.push({ invoice_no: no, files: (Array.isArray(inv?.files) ? inv.files : []).map(String).slice(0, 20), lines: r.lines, points: r.score });
    });
    if (!invoices.length) problems.push('Add the invoice');
    const total = new Map<string, ReturnType<typeof linesScore>['lines'][number]>();
    for (const l of out.flatMap(o => o.lines)) {
        const t = total.get(l.product_id);
        if (t) { t.qty += l.qty; t.subtotal += l.subtotal; } else total.set(l.product_id, { ...l });
    }
    if (!problems.length && !total.size) problems.push('Add at least one product from the invoices');
    return { score: out.reduce((n, o) => n + o.points, 0), lines: [...total.values()], invoices: out, problems };
}

export type SchemeStatus = 'draft' | 'published' | 'ended';
export type SchemeState = 'draft' | 'upcoming' | 'live' | 'closed';

/* ─── Validation of what an admin saves ───────────────────────────────────── */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with a scheme an admin is saving, in words; empty when it is fine. */
export function schemeProblems(s: {
    title?: string; category?: string; windows: SchemeWindow[]; fields: SchemeField[];
    score: ScoreRule; rewards: RewardRule; eligibility: Eligibility; entries_per_store?: string; clubs?: Club[];
}): string[] {
    const p: string[] = [];
    if (!String(s.title ?? '').trim()) p.push('Give the scheme a title');
    if (!(SCHEME_CATEGORIES as readonly string[]).includes(String(s.category))) p.push('Pick a category');
    if (!s.windows.length) p.push('Add at least one window — a start and an end date and time');
    for (const w of s.windows) {
        if (!STAMP.test(w.start) || !STAMP.test(w.end)) p.push('Every window needs a start and an end date and time');
        else if (w.end <= w.start) p.push('A window ends before it starts');
    }
    const ws = sortedWindows(s.windows.filter(w => STAMP.test(w.start) && STAMP.test(w.end)));
    for (let i = 1; i < ws.length; i++) if (ws[i].start <= ws[i - 1].end) p.push('Two windows overlap');
    if (!['one', 'many'].includes(String(s.entries_per_store ?? 'many'))) p.push('Entries per store must be one or many');

    const ids = new Set<string>();
    for (const f of s.fields) {
        if (!f.id || ids.has(f.id)) p.push('Every field needs its own id');
        ids.add(f.id);
        if (!String(f.label ?? '').trim()) p.push('Every field needs a label');
        if (!(FIELD_TYPES as readonly string[]).includes(f.type)) p.push(`"${f.label}" has an unknown type`);
        if (f.type === 'select' && !(f.options ?? []).filter(o => String(o).trim()).length) p.push(`"${f.label}" needs at least one option`);
        if (f.type === 'file') {
            if (!(f.formats ?? []).length) p.push(`"${f.label}": pick at least one file format`);
            if ((f.formats ?? []).some(x => !(x in FILE_FORMATS))) p.push(`"${f.label}" has an unknown file format`);
        }
    }

    const score = s.score;
    if (score.mode === 'sum') {
        const f = s.fields.find(x => x.id === score.field_id);
        if (!f || f.type !== 'number') p.push('The score adds up a field that is not a number field');
    }
    if (score.mode === 'products') {
        if (!score.products.length) p.push('Add at least one product with its points');
        const names = new Set<string>();
        for (const pr of score.products) {
            const n = String(pr.name ?? '').trim().toLowerCase();
            if (!n) p.push('Every product needs a name');
            else if (names.has(n)) p.push(`"${pr.name}" is listed twice`);
            names.add(n);
            if (!(Number(pr.points) > 0)) p.push(`Set the points for "${pr.name || 'a product'}"`);
        }
    }
    if (s.score.mode === 'none' && ['slabs', 'per_unit', 'rank', 'clubs'].includes(s.rewards.mode)) {
        p.push('Slab, per-unit, rank and club rewards need a score');
    }
    if (s.rewards.mode === 'slabs') {
        if (!s.rewards.slabs.length) p.push('Add at least one slab');
        const sorted = [...s.rewards.slabs].sort((a, b) => a.min - b.min);
        sorted.forEach((sl, i) => {
            if (!String(sl.reward ?? '').trim()) p.push('Every slab needs a reward');
            if (sl.max !== null && sl.max < sl.min) p.push(`Slab ${sl.min}–${sl.max} ends before it starts`);
            const next = sorted[i + 1];
            if (next && (sl.max === null || sl.max >= next.min)) p.push(`Slabs ${sl.min}+ and ${next.min}+ overlap`);
        });
    }
    if (s.rewards.mode === 'per_unit' && !(Number(s.rewards.amount) > 0)) p.push('Set the amount per unit');
    if (s.rewards.mode === 'rank') {
        if (!s.rewards.prizes.length) p.push('Add at least one prize');
        for (const pr of s.rewards.prizes) {
            if (!(pr.from >= 1) || pr.to < pr.from) p.push(`Prize for ranks ${pr.from}–${pr.to} is not a valid range`);
            if (!String(pr.reward ?? '').trim()) p.push('Every prize needs a reward');
        }
    }
    if (s.rewards.mode === 'per_entry' && !String(s.rewards.reward ?? '').trim()) p.push('Set the reward per approved entry');
    if (s.rewards.mode === 'clubs') {
        if (!(s.clubs ?? []).length) p.push('Add the clubs whose rewards stores earn');
        for (const c of s.clubs ?? []) if (!String(c.reward ?? '').trim()) p.push(`Set the reward for ${c.name || 'each club'}`);
    }

    if (s.eligibility.mode === 'states' && !(s.eligibility.states ?? []).length) p.push('Pick at least one state');
    if (s.eligibility.mode === 'stores' && !(s.eligibility.store_ids ?? []).length) p.push('Pick at least one store');
    if ((s.clubs ?? []).length && s.score.mode === 'none') p.push('Clubs need a score');
    p.push(...clubProblems(s.clubs ?? []));
    return [...new Set(p)];
}

/* ─── Who sees it, and when ───────────────────────────────────────────────── */

/**
 * Where a scheme stands at this moment ("YYYY-MM-DDTHH:mm", IST). Live from
 * the first window's start to the last window's end — between two windows
 * too, when it is live but not taking entries (see openWindow).
 */
export function schemeState(status: SchemeStatus, windows: SchemeWindow[], now: string): SchemeState {
    if (status === 'draft') return 'draft';
    if (status === 'ended') return 'closed';
    const ws = sortedWindows(windows);
    if (!ws.length) return 'closed';
    if (now < ws[0].start) return 'upcoming';
    if (now > lastEnd(ws)) return 'closed';
    return 'live';
}

/** Whether a store may submit right now: published, and a window is open. */
export function canSubmit(status: SchemeStatus, windows: SchemeWindow[], now: string): boolean {
    return status === 'published' && openWindow(windows, now) !== null;
}

/** Whether this store is one the scheme is for. */
export function isEligible(
    e: Eligibility,
    store: { id: string; state: string | null; allowed_brands: string | null },
): boolean {
    // A brand means stores of exactly that brand: AF only, AC only, or both (AFAC).
    if (e.brand && String(store.allowed_brands ?? 'AF').toUpperCase() !== e.brand) return false;
    if (e.mode === 'stores') return (e.store_ids ?? []).map(String).includes(String(store.id));
    if (e.mode === 'states') {
        const mine = findState(String(store.state ?? ''))?.state;
        if (!mine) return false;
        return (e.states ?? []).some(s => findState(String(s))?.state === mine);
    }
    return true;
}

/* ─── An entry ────────────────────────────────────────────────────────────── */

/** A file on an entry; `sha256` (taken on upload) recognises the same file sent again. */
export interface EntryFile { name: string; url: string; size: number; ext: string; sha256?: string }

/** An invoice number as written, compared without case, spaces or punctuation. */
export const invoiceKey = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const extOf = (name: string) => String(name ?? '').split('.').pop()?.toLowerCase() ?? '';

/**
 * Problems with an entry a store is submitting; empty when it is fine.
 * `files` are what was uploaded, by field id.
 */
export function entryProblems(
    fields: SchemeField[],
    values: Record<string, unknown>,
    files: Record<string, EntryFile[]>,
): string[] {
    const p: string[] = [];
    for (const f of fields) {
        if (f.type === 'file') {
            const list = files[f.id] ?? [];
            if (f.required && !list.length) p.push(`Upload "${f.label}"`);
            const max = f.max_files ?? 5;
            if (list.length > max) p.push(`"${f.label}": at most ${max} file${max === 1 ? '' : 's'}`);
            const allowed = (f.formats ?? []).flatMap(x => FILE_FORMATS[x] ?? []);
            for (const file of list) {
                if (!allowed.includes(file.ext || extOf(file.name))) {
                    p.push(`"${file.name}" is not an allowed format for "${f.label}" (${(f.formats ?? []).join(', ')})`);
                }
                if (f.max_mb && file.size > f.max_mb * 1024 * 1024) p.push(`"${file.name}" is over ${f.max_mb} MB`);
            }
            continue;
        }
        const raw = values[f.id];
        const blank = raw === undefined || raw === null || String(raw).trim() === '';
        if (blank) {
            if (f.required) p.push(`Fill in "${f.label}"`);
            continue;
        }
        const v = String(raw).trim();
        if (f.type === 'number' && !(Number.isFinite(Number(v)) && Number(v) >= 0)) p.push(`"${f.label}" must be a number`);
        if (f.type === 'date' && !DATE.test(v)) p.push(`"${f.label}" must be a date`);
        if (f.type === 'select' && !(f.options ?? []).includes(v)) p.push(`"${f.label}": pick one of the options`);
        if ((f.type === 'text' || f.type === 'distributor') && v.length > 500) p.push(`"${f.label}" is too long`);
    }
    return p;
}

/** The score an entry would add once approved; the admin can change it when approving. */
export function entryScore(rule: ScoreRule, values: Record<string, unknown>): number {
    if (rule.mode === 'sum') {
        const n = Number(values[rule.field_id]);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }
    if (rule.mode === 'count') return 1;
    return 0;   // points / products: the admin sets them when approving; none: no score
}

/* ─── Standings and rewards ───────────────────────────────────────────────── */

export interface Standing {
    store_id: string;
    score: number;
    approved: number;
    rank: number;
    /* The slab reached, by its lower bound; null when none. */
    slab: Slab | null;
    reward: string | null;
    club: Club | null;
}

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * Everyone's standing: rank by score (ties share a rank, then the next rank
 * skips — 1, 2, 2, 4), the slab reached and the reward earned. Only stores
 * with an approved entry or an adjustment are ranked.
 */
export function standings(
    rows: { store_id: string; score: number; approved: number }[],
    rewards: RewardRule,
    clubs: Club[] = [],
): Standing[] {
    const ranked = rows
        .filter(r => r.approved > 0 || r.score !== 0)
        .sort((a, b) => b.score - a.score || a.store_id.localeCompare(b.store_id));

    let lastScore: number | null = null;
    let lastRank = 0;
    return ranked.map((r, i) => {
        const rank = lastScore !== null && r.score === lastScore ? lastRank : i + 1;
        lastScore = r.score; lastRank = rank;

        let slab: Slab | null = null;
        let reward: string | null = null;
        const club = clubFor(r.score, clubs);
        if (rewards.mode === 'clubs') {
            reward = club?.reward?.trim() || null;
        } else if (rewards.mode === 'slabs') {
            slab = [...rewards.slabs]
                .sort((a, b) => b.min - a.min)
                .find(s => r.score >= s.min && (s.max === null || r.score <= s.max))
                ?? null;
            reward = slab?.reward ?? null;
        } else if (rewards.mode === 'per_unit') {
            reward = r.score > 0 ? money(r.score * rewards.amount) : null;
        } else if (rewards.mode === 'rank') {
            reward = rewards.prizes.find(pr => rank >= pr.from && rank <= pr.to)?.reward ?? null;
        } else if (rewards.mode === 'per_entry') {
            reward = r.approved > 0 ? `${rewards.reward}${r.approved > 1 ? ` × ${r.approved}` : ''}` : null;
        }
        return { store_id: r.store_id, score: r.score, approved: r.approved, rank, slab, reward, club };
    });
}

/* ─── Points by month ─────────────────────────────────────────────────────── */

/** The IST month, "2026-10", of a moment. */
export const istMonth = (at: Date | string) => new Date(new Date(at).getTime() + 5.5 * 3600_000).toISOString().slice(0, 7);

/** Approved points per IST month, oldest first. An entry counts in the month it is dated. */
export function monthlyPoints(entries: { created_at: Date | string; score: number; status: string }[]) {
    const m = new Map<string, number>();
    for (const e of entries) {
        if (e.status !== 'approved') continue;
        const k = istMonth(e.created_at);
        m.set(k, (m.get(k) ?? 0) + Number(e.score || 0));
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([month, points]) => ({ month, points }));
}

/* ─── Importing past months ───────────────────────────────────────────────── */

export interface ImportRow { row: number; store: string; date: unknown; product: string; qty: unknown; invoice?: string }
export interface PlannedEntry { store_id: string; day: string; invoice: string | null; lines: EntryLine[]; rows: number[] }

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/* "Amaze Series" and "amaze" are one product name. */
const bare = (v: unknown) => norm(v).replace(/\bseries\b/g, '').replace(/[^a-z0-9+]+/g, ' ').trim();

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A date as typed in a sheet, as "YYYY-MM-DD": ISO, DD-MM-YYYY, DD/MM/YYYY, "15 Jul 2026", or an Excel day number. */
export function readDate(v: unknown): string | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number' && v > 20000 && v < 80000) {                    // Excel serial, 1900 system
        return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10);
    }
    const t = String(v).trim();
    const ok = (y: number, m: number, d: number) => {
        const dt = new Date(Date.UTC(y, m - 1, d));
        return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
            ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
    };
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return ok(+m[1], +m[2], +m[3]);
    m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (m) return ok(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);   // Indian order: day first
    m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3})[a-z]*[\s,-]+(\d{4})$/i);
    if (m) { const mo = MONTHS.indexOf(m[2].toLowerCase()); return mo < 0 ? null : ok(+m[3], mo + 1, +m[1]); }
    return null;
}

/** The scheme product a typed name means: its id, its exact name, or its name without "Series". */
export function findProduct(typed: unknown, products: ProductPoints[]): ProductPoints | null {
    const t = norm(typed), b = bare(typed);
    if (!t) return null;
    return products.find(p => p.id.toLowerCase() === t)
        ?? products.find(p => norm(p.name) === t)
        ?? products.find(p => bare(p.name) === b && b !== '')
        ?? null;
}

/**
 * Rows from a sheet into entries: one per store, day and invoice, with its
 * product lines. Every row that cannot be used is named, with why; nothing is
 * planned for a store or product the sheet names but the system does not know.
 */
export function planImport(
    rows: ImportRow[],
    stores: { id: string; code: string | null; name: string }[],
    products: ProductPoints[],
) {
    const byCode = new Map(stores.filter(s => s.code).map(s => [norm(s.code), s] as const));
    const byName = new Map<string, { id: string; code: string | null; name: string }[]>();
    for (const st of stores) byName.set(norm(st.name), [...(byName.get(norm(st.name)) ?? []), st]);

    const problems: { row: number; message: string }[] = [];
    const groups = new Map<string, PlannedEntry>();
    for (const r of rows) {
        const key = norm(r.store);
        if (!key) { problems.push({ row: r.row, message: 'No store' }); continue; }
        let store = byCode.get(key) ?? null;
        if (!store) {
            const named = byName.get(key) ?? [];
            if (named.length > 1) { problems.push({ row: r.row, message: `"${r.store}" is the name of ${named.length} stores — use the store code` }); continue; }
            store = named[0] ?? null;
        }
        if (!store) { problems.push({ row: r.row, message: `No store with code or name "${r.store}"` }); continue; }
        const day = readDate(r.date);
        if (!day) { problems.push({ row: r.row, message: `"${String(r.date ?? '')}" is not a date` }); continue; }
        const product = findProduct(r.product, products);
        if (!product) { problems.push({ row: r.row, message: `"${r.product}" is not one of this scheme's products` }); continue; }
        const qty = Number(r.qty);
        if (!Number.isFinite(qty) || qty <= 0) { problems.push({ row: r.row, message: `Quantity "${String(r.qty ?? '')}" is not a number above 0` }); continue; }

        const invoice = String(r.invoice ?? '').trim() || null;
        const g = `${store.id}|${day}|${invoice ?? ''}`;
        const entry = groups.get(g) ?? { store_id: store.id, day, invoice, lines: [], rows: [] };
        const line = entry.lines.find(l => l.product_id === product.id);
        if (line) line.qty += qty; else entry.lines.push({ product_id: product.id, qty });
        entry.rows.push(r.row);
        groups.set(g, entry);
    }
    return { entries: [...groups.values()], problems };
}

/* ─── Sell-through: bought vs sold to customers ───────────────────────────── */

/**
 * The scheme product a warranty's product belongs to: the same name, or a
 * name the scheme product's name (without "Series") starts — "Amaze Series"
 * takes AMAZE and AMAZE DUO. Null when it is none of the scheme's products.
 */
export function productForWarranty(warrantyProduct: unknown, products: ProductPoints[]): ProductPoints | null {
    const w = bare(warrantyProduct);
    if (!w) return null;
    return products.find(p => bare(p.name) === w)
        ?? [...products].sort((a, b) => bare(b.name).length - bare(a.name).length)
            .find(p => { const b = bare(p.name); return b !== '' && w.startsWith(b + ' '); })
        ?? null;
}

/**
 * Per month: units bought (approved invoice lines) against warranties the
 * store registered for those products — what it actually sold to customers.
 * pct is null when nothing was bought that month.
 */
export function sellThrough(
    bought: { month: string; product_id: string; qty: number }[],
    registered: { month: string; product: string; count: number }[],
    products: ProductPoints[],
) {
    const months = new Map<string, { bought: number; sold: number }>();
    for (const b of bought) {
        const m = months.get(b.month) ?? { bought: 0, sold: 0 };
        m.bought += b.qty; months.set(b.month, m);
    }
    for (const r of registered) {
        if (!productForWarranty(r.product, products)) continue;
        const m = months.get(r.month) ?? { bought: 0, sold: 0 };
        m.sold += r.count; months.set(r.month, m);
    }
    return [...months].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({
        month, bought: v.bought, sold: v.sold, pct: v.bought ? Math.round((v.sold / v.bought) * 100) : null,
    }));
}
