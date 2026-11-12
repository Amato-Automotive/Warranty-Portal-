import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { NotificationService } from '../services/notification.service.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import {
    schemeProblems, schemeState, canSubmit, isEligible, entryProblems, entryScore, standings,
    windowSpan, openWindow, nextWindow, istNow, linesScore, monthlyPoints, istMonth, planImport, sellThrough, productForWarranty, invoiceKey, invoicesScore,
    type SchemeField, type ScoreRule, type RewardRule, type Eligibility, type SchemeStatus, type EntryFile,
    type SchemeWindow, type EntryLine, type Club, type ImportRow, type InvoiceIn,
} from '../services/schemeRules.js';
import { correctEntry, type EntryEdit } from '../services/schemeCorrection.js';
import {
    readSettings, settingsProblems, stepProblems, readSteps, periodsOf, targetResult, planTargetImport,
    stepsFor, growthTarget, windowPeriods, basisRange, averagePerMonth, pointsByProduct, roundPoints, tierOf,
    type TargetStep, type TargetImportRow, type TargetChange, type StoreTerms, type Period, type AverageBasis,
} from '../services/schemeTargets.js';
import { addSets, earned, eligibility, groupOf, inAudience, invoiceProblems, isOffer, isSellMore, noSets, optionAllowed, optionOf, readAudience, readSets, redeemProblem, SELL_MORE_PROGRAM, seriesInMonth, setsForOffer, setsTotal, storeScaleTarget, subtractSets, tierIdForMonth, usedProblem, worthOf, rewardSlab, type AssignedOption, type Sets, type WarrantyRow } from '../services/sellMoreEarnMore.js';

/**
 * Offers & Schemes. The admin builds and runs schemes; franchises join them
 * and submit entries; the admin approves entries, and the score is what was
 * approved. The rules are in services/schemeRules.ts.
 */


const json = <T>(v: unknown, fallback: T): T => {
    if (v === null || v === undefined) return fallback;
    if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
    return v as T;
};
const day = (v: unknown): string | null => {
    if (!v) return null;
    if (v instanceof Date) return new Date(v.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    return String(v).slice(0, 10);
};

/** A scheme row with its JSON read, its windows, and where it stands now. */
function readScheme(r: any) {
    const starts_on = day(r.starts_on)!;
    const ends_on = day(r.ends_on)!;
    /* A scheme saved before windows existed runs its whole days. */
    const saved = json<SchemeWindow[]>(r.windows, []);
    const windows = saved.length ? saved : [{ start: `${starts_on}T00:00`, end: `${ends_on}T23:59` }];
    const now = istNow();
    return {
        id: r.id as string,
        title: (isSellMore(r.id) ? SELL_MORE_PROGRAM : r.title) as string,
        category: r.category as string,
        summary: r.summary as string | null,
        banner_url: r.banner_url as string | null,
        instructions: r.instructions as string | null,
        terms: r.terms as string | null,
        starts_on, ends_on,
        windows,
        open_window: r.status === 'published' ? openWindow(windows, now) : null,
        next_window: r.status === 'published' ? nextWindow(windows, now) : null,
        eligibility: json<Eligibility>(r.eligibility, { mode: 'all' }),
        fields: json<SchemeField[]>(r.fields, []),
        entries_per_store: (r.entries_per_store || 'many') as 'one' | 'many',
        score_rule: json<ScoreRule>(r.score_rule, { mode: 'none' }),
        rewards: json<RewardRule>(r.rewards, { mode: 'none' }),
        leaderboard: json<{ show: boolean; names: boolean }>(r.leaderboard, { show: true, names: false }),
        clubs: json<Club[]>(r.clubs, []),
        contact: json<{ name: string; role: string; phone: string; email: string } | null>(r.contact, null),
        settings: readSettings(r.settings),
        status: r.status as SchemeStatus,
        state: schemeState(r.status, windows, now),
        published_at: r.published_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
}
type Scheme = ReturnType<typeof readScheme>;

/** What the admin sent, shaped for the rules and the database. */
function schemeFromBody(b: any) {
    const fields: SchemeField[] = (Array.isArray(b.fields) ? b.fields : []).map((f: any) => ({
        id: String(f.id ?? '').trim(),
        label: String(f.label ?? '').trim().slice(0, 120),
        type: f.type,
        required: Boolean(f.required),
        ...(f.type === 'select' ? { options: (f.options ?? []).map((o: any) => String(o).trim()).filter(Boolean).slice(0, 50) } : {}),
        ...(f.type === 'file' ? {
            formats: (f.formats ?? []).map(String),
            max_files: Math.min(Math.max(Number(f.max_files) || 1, 1), 10),
            max_mb: Math.min(Math.max(Number(f.max_mb) || 10, 1), 50),
        } : {}),
    }));
    return {
        title: String(b.title ?? '').trim().slice(0, 160),
        category: String(b.category ?? ''),
        summary: String(b.summary ?? '').trim().slice(0, 500) || null,
        banner_url: String(b.banner_url ?? '').trim().slice(0, 500) || null,
        instructions: String(b.instructions ?? '').trim().slice(0, 20000) || null,
        terms: String(b.terms ?? '').trim().slice(0, 20000) || null,
        windows: (Array.isArray(b.windows) ? b.windows : []).slice(0, 60).map((w: any) => ({
            start: String(w?.start ?? '').slice(0, 16),
            end: String(w?.end ?? '').slice(0, 16),
        })) as SchemeWindow[],
        eligibility: {
            mode: ['all', 'states', 'stores'].includes(b.eligibility?.mode) ? b.eligibility.mode : 'all',
            states: (b.eligibility?.states ?? []).map(String),
            store_ids: (b.eligibility?.store_ids ?? []).map(String),
            brand: ['AF', 'AC', 'AFAC'].includes(b.eligibility?.brand) ? b.eligibility.brand : null,
        } as Eligibility,
        fields,
        entries_per_store: b.entries_per_store === 'one' ? 'one' : 'many',
        score: (b.score_rule?.mode === 'products'
            ? {
                mode: 'products',
                products: (Array.isArray(b.score_rule.products) ? b.score_rule.products : []).slice(0, 200).map((p: any) => ({
                    id: String(p?.id ?? '').trim().slice(0, 40) || `m_${uuidv4().slice(0, 8)}`,
                    name: String(p?.name ?? '').trim().slice(0, 120),
                    points: Number(p?.points),
                })),
            }
            : (b.score_rule ?? { mode: 'none' })) as ScoreRule,
        rewards: (b.rewards ?? { mode: 'none' }) as RewardRule,
        leaderboard: { show: b.leaderboard?.show !== false, names: Boolean(b.leaderboard?.names) },
        clubs: (Array.isArray(b.clubs) ? b.clubs : []).slice(0, 20).map((c: any) => ({
            id: String(c?.id ?? '').trim().slice(0, 40) || `k_${uuidv4().slice(0, 8)}`,
            name: String(c?.name ?? '').trim().slice(0, 40),
            min: Number(c?.min),
            icon: String(c?.icon ?? 'award').replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'award',
            color: String(c?.color ?? 'slate').replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'slate',
            reward: String(c?.reward ?? '').trim().slice(0, 160),
        })) as Club[],
        contact: (() => {
            const c = b.contact ?? {};
            const out = {
                name: String(c.name ?? '').trim().slice(0, 80), role: String(c.role ?? '').trim().slice(0, 80),
                phone: String(c.phone ?? '').trim().slice(0, 30), email: String(c.email ?? '').trim().slice(0, 120),
            };
            return out.name || out.phone || out.email ? out : null;
        })(),
        settings: readSettings(b.settings),
    };
}

/** Every approved score plus adjustments, per store, for one scheme. */
async function schemeStandings(scheme: Scheme) {
    const [rows]: any = await db.execute(
        `SELECT store_id, SUM(score) AS score, SUM(approved) AS approved FROM (
             SELECT store_id, score, 1 AS approved FROM scheme_entries WHERE scheme_id = ? AND status = 'approved'
             UNION ALL
             SELECT store_id, points AS score, 0 AS approved FROM scheme_adjustments WHERE scheme_id = ?
         ) t GROUP BY store_id`,
        [scheme.id, scheme.id]
    );
    return standings(
        rows.map((r: any) => ({ store_id: String(r.store_id), score: Number(r.score) || 0, approved: Number(r.approved) || 0 })),
        scheme.rewards,
        scheme.clubs,
    );
}

async function storesById(ids: string[]) {
    const map = new Map<string, { name: string; city: string | null; state: string | null; user_id: string }>();
    if (!ids.length) return map;
    const [rows]: any = await db.execute(
        `SELECT id, store_name, city, state, user_id FROM vendor_details WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
    );
    for (const r of rows) map.set(String(r.id), { name: r.store_name, city: r.city, state: r.state, user_id: r.user_id });
    return map;
}

/**
 * The distributors a store can say it bought from: those mapped to it on the
 * Sourcing Map, or — when it has none — every active distributor in its state.
 */
async function distributorChoices(store: { user_id: string; state: string | null }) {
    const [mapped]: any = await db.execute(
        `SELECT d.id, d.name, d.city FROM franchise_distributors fd JOIN distributors d ON d.id = fd.distributor_id
          WHERE fd.franchise_user_id = ? ORDER BY d.name`, [store.user_id]
    );
    if (mapped.length) return mapped.map((d: any) => ({ id: String(d.id), name: d.name, city: d.city }));
    const [all]: any = await db.execute(
        `SELECT d.id, d.name, d.city, d.state FROM distributors d JOIN vendor_details vd ON vd.user_id = d.profile_id
          WHERE vd.is_distributor = TRUE ORDER BY d.name`
    );
    const mine = String(store.state ?? '').trim().toLowerCase();
    return all.filter((d: any) => String(d.state ?? '').trim().toLowerCase() === mine).map((d: any) => ({ id: String(d.id), name: d.name, city: d.city }));
}

/**
 * In-app reminders: the day before a window opens, every store the scheme is
 * for is told the date. Run hourly; each window is reminded once
 * (scheme_reminders). Skipped on a local run against the live database.
 */
export async function runSchemeReminders(): Promise<number> {
    if (process.env.DISABLE_SCHEDULERS === '1') return 0;
    const now = istNow();
    const tomorrow = istNow(Date.now() + 24 * 3600_000);
    const [rows]: any = await db.execute("SELECT * FROM schemes WHERE status = 'published' AND deleted_at IS NULL");
    let sent = 0;
    for (const r of rows) {
        const s = readScheme(r);
        if (s.settings.run === 'targets') continue;
        const due = s.windows.filter(w => w.start > now && w.start <= tomorrow);
        for (const w of due) {
            const [claim]: any = await db.execute('INSERT IGNORE INTO scheme_reminders (scheme_id, window_start) VALUES (?, ?)', [s.id, w.start]);
            if (!claim.affectedRows) continue;               // already reminded
            const [stores]: any = await db.execute(
                `SELECT vd.id, vd.state, vd.allowed_brands, vd.user_id FROM vendor_details vd
                   JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1
                  WHERE vd.is_franchise = 1`
            );
            let n = 0;
            const when = w.start.replace('T', ' ');
            for (const st of stores) {
                if (!isEligible(s.eligibility, { id: String(st.id), state: st.state, allowed_brands: st.allowed_brands })) continue;
                await NotificationService.notify(st.user_id, {
                    title: `Tomorrow: ${s.title}`,
                    message: `Entries open ${when} — have your invoices ready.`,
                    type: 'scheme', metadata: { scheme_id: s.id, window: w.start },
                });
                n++;
            }
            await db.execute('UPDATE scheme_reminders SET stores = ? WHERE scheme_id = ? AND window_start = ?', [n, s.id, w.start]);
            sent += n;
        }
    }
    if (sent) console.log(`[Schemes] reminders sent: ${sent}`);
    return sent;
}

/** The signed-in franchise's store, or null. */
async function myStore(req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) return null;
    const [[s]]: any = await db.execute(
        'SELECT id, store_name, state, allowed_brands, user_id, is_franchise FROM vendor_details WHERE user_id = ? LIMIT 1',
        [userId]
    );
    return s ? { id: String(s.id), name: s.store_name, state: s.state, allowed_brands: s.allowed_brands, user_id: s.user_id, is_franchise: Boolean(s.is_franchise) } : null;
}

async function loadScheme(id: string): Promise<Scheme | null> {
    const [[r]]: any = await db.execute('SELECT * FROM schemes WHERE id = ? AND deleted_at IS NULL', [id]);
    return r ? readScheme(r) : null;
}

const dayOf = (d: unknown) => new Date(new Date(d as any).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * The files of an upload, by field, each with its fingerprint. A file sent
 * twice in the same upload is kept once.
 */
function uploadedFiles(req: Request) {
    const files: Record<string, EntryFile[]> = {};
    const seen = new Set<string>();
    for (const f of ((req as any).files ?? []) as any[]) {
        if (f.sha256 && seen.has(f.sha256)) continue;
        if (f.sha256) seen.add(f.sha256);
        (files[f.fieldname] ??= []).push({
            name: String(f.originalname).slice(0, 120),
            url: f.path,
            size: Number(f.size) || 0,
            ext: String(f.originalname).split('.').pop()?.toLowerCase() ?? '',
            ...(f.sha256 ? { sha256: f.sha256 } : {}),
        });
    }
    return files;
}

/**
 * Whether a store already sent one of these files, or already has this
 * invoice number approved, on the scheme — so one invoice counts once, however
 * many entries a store sends in a day. Rejected entries do not count: a store
 * may send a rejected invoice again. Returns what to tell the sender, or null.
 */
async function alreadyCounted(schemeId: string, storeId: string, opts: { files?: Record<string, EntryFile[]>; invoiceNos?: string[]; except?: string }) {
    const hashes = new Set(Object.values(opts.files ?? {}).flat().map(f => f.sha256).filter(Boolean) as string[]);
    const wanted = new Map((opts.invoiceNos ?? []).map(n => [invoiceKey(n), String(n).trim()] as const).filter(([k]) => k));
    if (!hashes.size && !wanted.size) return null;
    const [rows]: any = await db.execute(
        "SELECT id, files, invoice_no, invoices, status, created_at FROM scheme_entries WHERE scheme_id = ? AND store_id = ? AND status <> 'rejected'",
        [schemeId, storeId]
    );
    for (const r of rows) {
        if (r.id === opts.except) continue;
        const same = Object.values(json<Record<string, EntryFile[]>>(r.files, {})).flat().find(f => f.sha256 && hashes.has(f.sha256));
        if (same) return `"${same.name}" was already sent on ${dayOf(r.created_at)} — the same invoice counts once`;
        if (r.status !== 'approved' || !wanted.size) continue;
        /* An entry read invoice by invoice has every number; an older one has one in invoice_no. */
        const theirs = json<{ invoice_no: string }[]>(r.invoices, []).map(i => i.invoice_no);
        for (const no of theirs.length ? theirs : [r.invoice_no]) {
            const hit = wanted.get(invoiceKey(no));
            if (hit) return `Invoice ${hit} is already approved for this store (entry of ${dayOf(r.created_at)})`;
        }
    }
    return null;
}

const log = (req: Request, actionType: string, scheme: { id: string; title: string }, details: Record<string, unknown> = {}) => {
    const admin = (req as any).user;
    ActivityLogService.log({
        adminId: admin?.id, adminName: admin?.name, adminEmail: admin?.email,
        actionType, targetType: 'SCHEME', targetId: scheme.id, targetName: scheme.title,
        details, ipAddress: req.ip || req.socket?.remoteAddress,
    }).catch(err => console.error('[Schemes] activity log failed:', err?.message));
};

/** Tell every eligible store a scheme is live. Skipped on a local run against the live database. */
async function announce(scheme: Scheme) {
    if (process.env.DISABLE_SCHEDULERS === '1') {
        console.log(`[Schemes] "${scheme.title}" published locally — store notifications skipped (DISABLE_SCHEDULERS=1)`);
        return 0;
    }
    const [rows]: any = await db.execute(
        `SELECT vd.id, vd.state, vd.allowed_brands, vd.user_id
           FROM vendor_details vd
           JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1
          WHERE vd.is_franchise = 1`
    );
    let sent = 0;
    for (const r of rows) {
        if (!isEligible(scheme.eligibility, { id: String(r.id), state: r.state, allowed_brands: r.allowed_brands })) continue;
        await NotificationService.notify(r.user_id, {
            title: `New scheme: ${scheme.title}`,
            message: scheme.summary || `Runs ${scheme.starts_on} to ${scheme.ends_on}. Open Offers & Schemes to join.`,
            type: 'scheme',
            metadata: { scheme_id: scheme.id },
        });
        sent++;
    }
    return sent;
}

/* ─── Schemes run by targets ──────────────────────────────────────────────── */

interface TargetHistory { at: string; by: string | null; field: 'target' | 'achieved' | 'paid'; from: number | string | null; to: number | string | null; reason: string | null }
const dec = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** The warranty date a scheme counts by: registration (IST via the pool's session) or the purchase date on it. */
const dateCol = (scheme: Scheme) => (scheme.settings.date_by === 'purchase' ? 'purchase_date' : 'created_at');

type DayCount = { approved: number; pending: number; rejected: number };

/** A warranty's product name, as the forms save it (seat covers: productName; others: product). */
const PRODUCT_NAME = `LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(product_details, '$.productName')), JSON_UNQUOTE(JSON_EXTRACT(product_details, '$.product')), '')))`;

/**
 * Warranties by store and day ("YYYY-MM-DD"): approved, waiting and rejected.
 * On a scheme counted in points, each warranty adds its series' points
 * instead of 1 (the store type's multiplier comes later). `null` means every
 * store (for the list of franchises to add).
 */
async function warrantyDaily(storeIds: string[] | null, scheme: Scheme) {
    const col = dateCol(scheme);
    const out = new Map<string, Record<string, DayCount>>();
    if (storeIds && !storeIds.length) return out;
    if (scheme.settings.measure === 'points') {
        const worth = pointsByProduct(scheme.settings.points);
        const [rows]: any = await db.execute(
            `SELECT vendor_details_id AS store_id, DATE_FORMAT(${col}, '%Y-%m-%d') AS d, ${PRODUCT_NAME} AS pn,
                    SUM(status = 'validated') AS approved, SUM(status = 'rejected') AS rejected,
                    SUM(status NOT IN ('validated', 'rejected')) AS pending
               FROM warranty_registrations
              WHERE vendor_details_id IS NOT NULL ${storeIds ? `AND vendor_details_id IN (${storeIds.map(() => '?').join(',')})` : ''}
              GROUP BY vendor_details_id, d, pn`,
            storeIds ?? []
        );
        for (const r of rows) {
            const pts = worth.get(String(r.pn ?? '')) ?? 0;
            if (!pts) continue;
            const m = out.get(String(r.store_id)) ?? {};
            const c = m[r.d] ?? { approved: 0, pending: 0, rejected: 0 };
            c.approved = roundPoints(c.approved + pts * (Number(r.approved) || 0));
            c.pending = roundPoints(c.pending + pts * (Number(r.pending) || 0));
            c.rejected = roundPoints(c.rejected + pts * (Number(r.rejected) || 0));
            m[r.d] = c;
            out.set(String(r.store_id), m);
        }
        return out;
    }
    const [rows]: any = await db.execute(
        `SELECT vendor_details_id AS store_id, DATE_FORMAT(${col}, '%Y-%m-%d') AS d,
                SUM(status = 'validated') AS approved, SUM(status = 'rejected') AS rejected,
                SUM(status NOT IN ('validated', 'rejected')) AS pending
           FROM warranty_registrations
          WHERE vendor_details_id IS NOT NULL ${storeIds ? `AND vendor_details_id IN (${storeIds.map(() => '?').join(',')})` : ''}
          GROUP BY vendor_details_id, d`,
        storeIds ?? []
    );
    for (const r of rows) {
        const m = out.get(String(r.store_id)) ?? {};
        m[r.d] = { approved: Number(r.approved) || 0, pending: Number(r.pending) || 0, rejected: Number(r.rejected) || 0 };
        out.set(String(r.store_id), m);
    }
    return out;
}

/** What one day adds to a count: approved only, or waiting ones too. */
const countOf = (scheme: Scheme, c: DayCount) => c.approved + (scheme.settings.count === 'registered' ? c.pending : 0);

/** A scheme's periods: its windows on a target scheme counted from warranties, else months/quarters/whole. */
function periodsFor(scheme: Scheme): (Period & { from?: string; to?: string })[] {
    return scheme.settings.period === 'window' ? windowPeriods(scheme.windows) : periodsOf(scheme.starts_on, scheme.ends_on, scheme.settings.period);
}
const inPeriod = (p: Period & { from?: string; to?: string }, d: string) => (p.from && p.to ? d >= p.from && d <= p.to : p.months.includes(d.slice(0, 7)));

/** The basis an admin sent: overall, the last 3 or 6 months, or a range of days. */
function readBasis(raw: any): AverageBasis {
    const mode = ['overall', 'm3', 'm6', 'custom'].includes(raw?.mode) ? raw.mode : 'm3';
    const ok = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    return mode === 'custom' ? { mode, from: ok(raw?.from), to: ok(raw?.to) } : { mode };
}

/** A store's average a month on one basis, from its days. */
function averageFor(scheme: Scheme, daily: Record<string, DayCount>, basis: AverageBasis) {
    const counts = Object.fromEntries(Object.entries(daily).map(([d, c]) => [d, countOf(scheme, c)]));
    const first = Object.keys(daily).sort()[0] ?? null;
    return averagePerMonth(counts, basisRange(basis, istNow().slice(0, 10), first));
}

/** A store's warranties: the last 12 months by status, and its average on every basis the admin can look at. */
function warrantyStats(scheme: Scheme, daily: Record<string, DayCount> = {}, custom: AverageBasis | null = null) {
    const now = istNow().slice(0, 7);
    let [y, m] = now.split('-').map(Number);
    const months: string[] = [];
    for (let i = 0; i < 12; i++) { months.unshift(`${y}-${String(m).padStart(2, '0')}`); m--; if (m < 1) { m = 12; y--; } }
    const byMonth = new Map<string, DayCount>();
    for (const [d, c] of Object.entries(daily)) {
        const k = d.slice(0, 7);
        const t = byMonth.get(k) ?? { approved: 0, pending: 0, rejected: 0 };
        t.approved += c.approved; t.pending += c.pending; t.rejected += c.rejected;
        byMonth.set(k, t);
    }
    return {
        months: months.map(k => ({ month: k, ...(byMonth.get(k) ?? { approved: 0, pending: 0, rejected: 0 }) })),
        averages: {
            overall: averageFor(scheme, daily, { mode: 'overall' }),
            m3: averageFor(scheme, daily, { mode: 'm3' }),
            m6: averageFor(scheme, daily, { mode: 'm6' }),
            custom: custom ? averageFor(scheme, daily, custom) : null,
        },
        first_day: Object.keys(daily).sort()[0] ?? null,
        /* As the scheme counts (approved, or all registered): the last full month, and the best of the 12. */
        last_month: (() => { const c = byMonth.get(months[months.length - 2]); return c ? countOf(scheme, c) : 0; })(),
        best_month: Math.max(0, ...months.map(k => { const c = byMonth.get(k); return c ? countOf(scheme, c) : 0; })),
    };
}

/** Targets a growth makes for every period, from the average the admin chose. */
function growthTargets(periods: Period[], average: number, growthPct: number) {
    return Object.fromEntries(periods.map(p => [p.key, growthTarget(average, growthPct, p.months.length)]));
}

/** Every franchise on a target scheme, its own terms, and its figures per period with the result. */
async function schemeTargets(scheme: Scheme, custom: AverageBasis | null = null) {
    const periods = periodsFor(scheme);
    const [members]: any = await db.execute('SELECT store_id, joined_at, terms FROM scheme_participants WHERE scheme_id = ? ORDER BY joined_at', [scheme.id]);
    const [rows]: any = await db.execute('SELECT * FROM scheme_targets WHERE scheme_id = ?', [scheme.id]);
    const ids = members.map((m: any) => String(m.store_id));
    const stores = await storesById(ids);
    const fromWarranties = scheme.settings.source === 'warranties';
    const inPoints = scheme.settings.measure === 'points';
    const daily = fromWarranties ? await warrantyDaily(ids, scheme) : new Map<string, Record<string, DayCount>>();
    const registered = scheme.settings.count === 'registered';
    const byStore = new Map<string, any[]>();
    for (const r of rows) byStore.set(String(r.store_id), [...(byStore.get(String(r.store_id)) ?? []), r]);
    return {
        periods,
        stores: members.map((m: any) => {
            const id = String(m.store_id);
            const terms = json<StoreTerms>(m.terms, {});
            const { steps, benefit } = stepsFor(terms, scheme.settings);
            const days = daily.get(id) ?? {};
            /* In points, the store's type multiplies everything it earns. */
            const tier = inPoints ? tierOf(scheme.settings.points, terms.tier) : null;
            const times = tier?.times ?? 1;
            const saved = new Map((byStore.get(id) ?? []).map((r: any) => [r.period, r]));
            const figures: Record<string, unknown> = {};
            for (const p of periods) {
                const r: any = saved.get(p.key);
                if (!r && !fromWarranties) continue;
                /* With warranties, achieved is counted live: those dated in the period (a window's days). */
                let approved = 0, pending = 0;
                for (const [d, c] of Object.entries(days)) if (inPeriod(p, d)) { approved += c.approved; pending += c.pending; }
                /* A points target typed once holds for every period, those added later too. */
                const target = dec(r?.target) ?? (inPoints ? terms.target ?? null : null);
                const achieved = fromWarranties ? roundPoints((approved + (registered ? pending : 0)) * times) : dec(r?.achieved);
                figures[p.key] = {
                    target, achieved, pending: fromWarranties && !registered ? roundPoints(pending * times) : null,
                    paid_at: r?.paid_at ?? null, updated_at: r?.updated_at ?? null,
                    history: json<TargetHistory[]>(r?.history, []),
                    result: targetResult(target, achieved, steps, benefit),
                };
            }
            return {
                store_id: id, store_name: stores.get(id)?.name ?? 'Store (removed)',
                city: stores.get(id)?.city ?? null, state: stores.get(id)?.state ?? null,
                own_steps: terms.steps?.length ? terms.steps : null, note: terms.note ?? null,
                growth_pct: terms.growth_pct ?? null, reward: terms.reward ?? null,
                basis: terms.basis ?? null, basis_average: terms.average ?? null,
                tier: tier?.id ?? null, times, target_points: terms.target ?? null,
                stats: fromWarranties ? warrantyStats(scheme, days, custom) : null,
                joined_at: m.joined_at, figures,
            };
        }),
    };
}

/** The period today falls in, else the last one started, else the first. */
function currentPeriod(scheme: Scheme, periods: (Period & { from?: string; to?: string })[]) {
    if (!periods.length) return null;
    if (periods.length === 1) return periods[0].key;
    const today = istNow().slice(0, 10);
    const hit = [...periods].reverse().find(p => (p.from ? p.from <= today : (p.key.startsWith('Q') ? p.key.slice(1) : p.key) <= today.slice(0, 7)));
    return (hit ?? periods[0]).key;
}

/**
 * A store's points: what each series is worth to it (its type's multiplier
 * included), and for every period how many of each it registered and the
 * points they made.
 */
async function storePoints(scheme: Scheme, storeId: string, periods: (Period & { from?: string; to?: string })[], times: number, tierId: string | undefined) {
    const rule = scheme.settings.points;
    const seriesOf = new Map<string, string>();
    for (const x of rule.series) for (const prod of x.products) if (!seriesOf.has(prod.toLowerCase())) seriesOf.set(prod.toLowerCase(), x.id);
    const [rows]: any = await db.execute(
        `SELECT DATE_FORMAT(${dateCol(scheme)}, '%Y-%m-%d') AS d, ${PRODUCT_NAME} AS pn,
                SUM(status = 'validated') AS approved, SUM(status NOT IN ('validated', 'rejected')) AS pending
           FROM warranty_registrations WHERE vendor_details_id = ? GROUP BY d, pn`,
        [storeId]
    );
    const registered = scheme.settings.count === 'registered';
    const breakdown: Record<string, { name: string; count: number; points: number }[]> = {};
    for (const p of periods) {
        const n = new Map<string, number>();
        for (const r of rows) {
            const sid = seriesOf.get(String(r.pn ?? ''));
            if (!sid || !r.d || !inPeriod(p, r.d)) continue;
            n.set(sid, (n.get(sid) ?? 0) + (Number(r.approved) || 0) + (registered ? Number(r.pending) || 0 : 0));
        }
        breakdown[p.key] = rule.series.map(x => ({ name: x.name, count: n.get(x.id) ?? 0, points: roundPoints((n.get(x.id) ?? 0) * x.points * times) }));
    }
    return {
        tier: tierOf(rule, tierId)?.name ?? null, times,
        series: rule.series.map(x => ({ name: x.name, points: roundPoints(x.points * times) })),
        breakdown,
    };
}

/** One store's own targets on a target scheme, showing only what the scheme lets it see. */
async function storeTargets(scheme: Scheme, storeId: string) {
    const all = await schemeTargets(scheme);
    const me = all.stores.find((x: any) => x.store_id === storeId);
    const show = scheme.settings.show;
    const { steps, benefit } = stepsFor({ steps: me?.own_steps ?? undefined, reward: me?.reward ?? undefined }, scheme.settings);
    const periods = all.periods.map(p => {
        const f: any = me?.figures[p.key];
        const r = f?.result;
        return {
            key: p.key, label: p.label, from: (p as any).from ?? null, to: (p as any).to ?? null,
            /* The reward it is working towards, before it has earned it. */
            reward: steps.length === 1 ? steps[0].reward ?? null : null,
            target: show.target ? f?.target ?? null : null,
            achieved: show.achieved ? f?.achieved ?? null : null,
            pending: show.achieved ? f?.pending ?? null : null,
            pct: show.percent ? r?.pct ?? null : null,
            step_no: r?.step_no ?? null,
            benefit: r?.benefit ?? null,
            to_next: show.to_next ? r?.to_next ?? null : null,
            paid: Boolean(f?.paid_at),
            updated_at: f?.updated_at ?? null,
        };
    });
    const nowKey = currentPeriod(scheme, all.periods);
    return {
        points: scheme.settings.measure === 'points' ? await storePoints(scheme, storeId, all.periods, me?.times ?? 1, me?.tier ?? undefined) : null,
        unit: scheme.settings.unit, benefit, show,
        steps: show.steps ? steps : [],
        periods,
        now: periods.find(p => p.key === nowKey) ?? null,
    };
}

/* ─── Sell More Earn More ─────────────────────────────────────────────────── */

/**
 * Sell More is admin-assignment only: a store must have an explicit option
 * assignment before the scheme appears in its portal. Paused schemes retain
 * the existing preview rule for an assigned/test store.
 */
const canSee = (scheme: Scheme, store: NonNullable<Awaited<ReturnType<typeof myStore>>>) => {
    if (!isSellMore(scheme.id)) return store.is_franchise && isEligible(scheme.eligibility, store);
    const audience = readAudience(scheme.settings.audience);
    if (audience.exclude.includes(store.id)) return false;
    return Boolean(audience.assignments[store.id]) && (scheme.settings.live || isEligible(scheme.eligibility, store));
};

const assignedOption = (scheme: Scheme, storeId: string): AssignedOption | null =>
    readAudience(scheme.settings.audience).assignments[storeId] ?? null;

/** Materialise an admin assignment as the store's permanent option. */
async function ensureAssignedOption(scheme: Scheme, storeId: string) {
    const option = assignedOption(scheme, storeId);
    if (!option) return null;
    await db.execute('INSERT IGNORE INTO scheme_participants (scheme_id, store_id) VALUES (?, ?)', [scheme.id, storeId]);
    await db.execute(
        `UPDATE scheme_participants SET terms = JSON_SET(COALESCE(terms, '{}'), '$.option', ?, '$.source', 'admin', '$.opted_at', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(terms, '$.opted_at')), ?))
         WHERE scheme_id = ? AND store_id = ? AND (terms IS NULL OR JSON_EXTRACT(terms, '$.source') = '"admin"' OR JSON_EXTRACT(terms, '$.option') IS NULL)`,
        [option, new Date().toISOString(), scheme.id, storeId]
    );
    return option;
}

/** Every verified store the program could be open to, franchises and distributors alike. */
async function programStores() {
    const [rows]: any = await db.execute(
        `SELECT vd.id, vd.store_code, vd.store_name, vd.city, vd.state, vd.is_franchise, vd.is_distributor, COALESCE(vd.allowed_brands, 'AF') AS allowed_brands
           FROM vendor_details vd JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1
          WHERE vd.is_franchise = 1 OR vd.is_distributor = 1 ORDER BY vd.store_name`
    );
    return rows.map((r: any) => ({
        id: String(r.id), code: r.store_code ?? null, name: String(r.store_name ?? '').trim(), city: r.city ?? null, state: r.state ?? null,
        is_franchise: Boolean(r.is_franchise), allowed_brands: r.allowed_brands,
    }));
}

/** The scheme's months up to this one (just its first before it starts). */
function sellMoreMonths(scheme: Scheme) {
    const all = periodsOf(scheme.starts_on, scheme.ends_on, 'month');
    const thisMonth = dayOf(new Date()).slice(0, 7);
    const sofar = all.filter(m => m.key <= thisMonth);
    return sofar.length ? sofar : all.slice(0, 1);
}

/** Warranties by store, day and product within the scheme's dates; rejected ones don't count. */
async function sellMoreRows(scheme: Scheme, storeIds: string[]) {
    const out = new Map<string, WarrantyRow[]>();
    if (!storeIds.length) return out;
    const [rows]: any = await db.query(
        `SELECT vendor_details_id AS store_id, DATE_FORMAT(created_at, '%Y-%m-%d') AS d, ${PRODUCT_NAME} AS pn, COUNT(*) AS n
           FROM warranty_registrations
          WHERE vendor_details_id IN (?) AND status <> 'rejected' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
          GROUP BY store_id, d, pn`,
        [storeIds, scheme.starts_on, scheme.ends_on]
    );
    for (const r of rows) {
        const k = String(r.store_id);
        out.set(k, [...(out.get(k) ?? []), { d: r.d, pn: r.pn, n: Number(r.n) }]);
    }
    return out;
}

/** Each store's category and target, by store then month. */
async function sellMoreMonthTerms(schemeId: string, storeIds: string[]) {
    const out = new Map<string, Map<string, { tier: string | null; target: number | null }>>();
    if (!storeIds.length) return out;
    const [rows]: any = await db.query('SELECT store_id, month, tier, target FROM scheme_store_months WHERE scheme_id = ? AND store_id IN (?)', [schemeId, storeIds]);
    for (const r of rows) {
        const k = String(r.store_id);
        if (!out.has(k)) out.set(k, new Map());
        out.get(k)!.set(String(r.month), { tier: r.tier ?? null, target: r.target === null ? null : Number(r.target) });
    }
    return out;
}

/** One store's month as the admin sees it: its category, target, calculated score and plain points. */
function adminMonth(scheme: Scheme, rows: WarrantyRow[], m: Period, months: Period[], terms: Map<string, { tier: string | null; target: number | null }> | undefined) {
    const rule = scheme.settings.points;
    const set = Object.fromEntries([...(terms?.entries() ?? [])].map(([k, v]) => [k, v.tier]));
    const tier = tierOf(rule, tierIdForMonth(set, months, m.key, undefined));
    const calc = earned(rows, worthOf(rule, tier), [m], scheme.starts_on, scheme.ends_on).months[0];
    const plain = earned(rows, worthOf(rule), [m], scheme.starts_on, scheme.ends_on).months[0];
    return { tier_obj: tier, tier: tier?.id ?? null, target: terms?.get(m.key)?.target ?? null, calc, plain };
}

/** Each store's reward rows, by store then month. */
async function sellMoreRewards(schemeId: string, storeIds: string[]) {
    const out = new Map<string, Map<string, any[]>>();
    if (!storeIds.length) return out;
    const [rows]: any = await db.query(
        'SELECT id, store_id, month, slab_no, points, status, source, note, requested_at, sent_at FROM scheme_reward_requests WHERE scheme_id = ? AND store_id IN (?) ORDER BY slab_no ASC, requested_at ASC',
        [schemeId, storeIds]
    );
    for (const r of rows) {
        const k = String(r.store_id);
        if (!out.has(k)) out.set(k, new Map());
        const m = out.get(k)!;
        const key = String(r.month);
        m.set(key, [...(m.get(key) ?? []), { ...r, store_id: k, points: Number(r.points), slab_no: Number(r.slab_no ?? 1) }]);
    }
    return out;
}

const readInvoice = (r: any) => ({
    id: r.id, store_id: String(r.store_id), invoice_no: r.invoice_no, invoice_date: day(r.invoice_date),
    files: json<EntryFile[]>(r.files, []).map(f => ({ name: f.name, url: f.url, sha256: f.sha256 })),
    sets: readSets(json(r.sets, {})), read_sets: r.read_sets ? readSets(json(r.read_sets, {})) : null,
    status: r.status as 'pending' | 'approved' | 'rejected', review_note: r.review_note, reviewed_at: r.reviewed_at, created_at: r.created_at,
    added_by_distributor_id: r.added_by_distributor_id ? String(r.added_by_distributor_id) : null,
});

/** The seat cover names the invoice reader looks for: every warranty product and every series' products. */
async function seatCoverNames(scheme: Scheme) {
    const [rows]: any = await db.execute("SELECT name FROM products WHERE type = 'seat_cover' ORDER BY name");
    return [...new Set<string>([...rows.map((r: any) => String(r.name).trim()), ...scheme.settings.points.series.flatMap(s => s.products)])];
}

/** What a store has: sets approved, sets used by approved rewards, what is left, and what it stands at. */
function buyBalance(invoices: { status: string; sets: Sets }[], claims: { status: string; used?: unknown }[]) {
    const approved = invoices.filter(i => i.status === 'approved').reduce((t, i) => addSets(t, i.sets), noSets());
    const used = claims.filter(c => c.status === 'approved').reduce((t, c) => addSets(t, readSets(json(c.used, {}))), noSets());
    const available = subtractSets(approved, used);
    return { approved, used, available, eligibility: eligibility(available), rewards: claims.filter(c => c.status === 'approved').length };
}

/** A store's Option 2: its invoices, its balance, where it stands on each offer, its rewards. */
async function buyMoreForStore(scheme: Scheme, storeId: string) {
    const [rows]: any = await db.execute('SELECT * FROM scheme_buy_invoices WHERE scheme_id = ? AND store_id = ? ORDER BY created_at DESC', [scheme.id, storeId]);
    const invoices = rows.map(readInvoice);
    const [claimRows]: any = await db.execute(
        'SELECT id, offer, used, status, note, requested_at, sent_at FROM scheme_free_sets WHERE scheme_id = ? AND store_id = ? ORDER BY requested_at DESC', [scheme.id, storeId]);
    return {
        invoices: invoices.map((i: any) => ({ ...i, files: i.files.map(({ sha256: _h, ...f }: any) => f) })),
        ...buyBalance(invoices, claimRows),
        waiting_sets: invoices.filter((i: any) => i.status === 'pending').reduce((n: number, i: any) => n + setsTotal(i.sets), 0),
        claims: claimRows.map((c: any) => ({ ...c, used: c.used ? readSets(json(c.used, {})) : null })),
        products: await seatCoverNames(scheme),
    };
}

/** The distributor record of the signed-in user, if they are one. */
async function myDistributor(req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) return null;
    const [[d]]: any = await db.execute('SELECT id, name FROM distributors WHERE profile_id = ? LIMIT 1', [userId]);
    return d ? { id: String(d.id), name: String(d.name) } : null;
}

/** The stores the admin has switched on for a distributor in this scheme (they must be mapped and on Option 2). */
async function distributorStores(scheme: Scheme, distributorId: string) {
    const [rows]: any = await db.execute(
        `SELECT vd.id AS store_id, vd.store_name, vd.store_code, vd.city, vd.state, sp.terms
           FROM franchise_distributors fd
           JOIN vendor_details vd ON vd.user_id = fd.franchise_user_id
           JOIN scheme_participants sp ON sp.store_id = vd.id AND sp.scheme_id = ?
           JOIN scheme_distributor_stores sds ON sds.scheme_id = sp.scheme_id AND sds.distributor_id = fd.distributor_id AND sds.store_id = vd.id
          WHERE fd.distributor_id = ? ORDER BY vd.store_name`,
        [scheme.id, distributorId]
    );
    return rows.filter((r: any) => optionOf(json<any>(r.terms, {})) === 'buy_more')
        .map((r: any) => ({ store_id: String(r.store_id), store_name: String(r.store_name ?? '').trim(), store_code: r.store_code ?? null, city: r.city ?? null, state: r.state ?? null }));
}

/** Whether the admin lets this distributor add invoices in this scheme (on unless switched off). */
async function distributorMayAdd(schemeId: string, distributorId: string) {
    const [[a]]: any = await db.execute('SELECT can_add FROM scheme_distributor_access WHERE scheme_id = ? AND distributor_id = ?', [schemeId, distributorId]);
    return a ? Boolean(a.can_add) : true;
}

/** Checks and saves one Buy More invoice for a store. `addedBy` is the distributor that sent it, if one did. */
async function saveBuyInvoice(req: Request, res: Response, scheme: Scheme, storeId: string, addedBy: string | null) {
    const files = (uploadedFiles(req).invoice ?? []);
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'];
    const bad = files.find(f => !allowed.includes(f.ext) || f.size > 10 * 1024 * 1024);
    if (bad) return res.status(400).json({ error: `${bad.name}: send a photo or PDF of up to 10 MB` });
    if (files.length > 10) return res.status(400).json({ error: 'Up to 10 files' });
    const invoice_no = String(req.body?.invoice_no ?? '').trim().slice(0, 60);
    const invoice_date = String(req.body?.invoice_date ?? '').trim();
    const sets = readSets(req.body?.sets);
    const problems = invoiceProblems({ invoice_no, invoice_date, sets, files: files.length }, scheme.starts_on, scheme.ends_on, dayOf(new Date()));
    if (problems.length) return res.status(400).json({ error: problems[0] });

    /* One invoice counts once: the same file or number again is refused, unless it was rejected. */
    const [mine]: any = await db.execute("SELECT invoice_no, files, created_at FROM scheme_buy_invoices WHERE scheme_id = ? AND store_id = ? AND status <> 'rejected'", [scheme.id, storeId]);
    const hashes = new Set(files.map(f => f.sha256).filter(Boolean));
    for (const r of mine) {
        if (invoiceKey(r.invoice_no) === invoiceKey(invoice_no)) return res.status(400).json({ error: `Invoice ${invoice_no} was already sent on ${dayOf(r.created_at)}` });
        const same = json<EntryFile[]>(r.files, []).find(f => f.sha256 && hashes.has(f.sha256));
        if (same) return res.status(400).json({ error: `"${same.name}" was already sent on ${dayOf(r.created_at)}` });
    }
    await db.execute(
        'INSERT INTO scheme_buy_invoices (id, scheme_id, store_id, invoice_no, invoice_date, files, sets, read_sets, added_by_distributor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), scheme.id, storeId, invoice_no, invoice_date, JSON.stringify(files), JSON.stringify(sets), req.body?.read_sets ? JSON.stringify(readSets(req.body.read_sets)) : null, addedBy]
    );
    res.json({ success: true });
}

/** One store's own view: its choice, its plain points by day and month, each month's reward. Never its store type or calculated score. */
async function sellMoreForStore(scheme: Scheme, storeId: string) {
    await ensureAssignedOption(scheme, storeId);
    const [[p]]: any = await db.execute('SELECT terms FROM scheme_participants WHERE scheme_id = ? AND store_id = ?', [scheme.id, storeId]);
    const terms = json<StoreTerms & { option?: string; opted_at?: string }>(p?.terms, {});
    const option = optionOf(terms);
    if (option !== 'sell_more') {
        return {
            option, opted_at: terms.opted_at ?? null, assigned: Boolean(assignedOption(scheme, storeId)), total: 0, warranties: 0, months: [],
            buy_more: option === 'buy_more' ? await buyMoreForStore(scheme, storeId) : null,
        };
    }
    const months = sellMoreMonths(scheme);
    const rows = (await sellMoreRows(scheme, [storeId])).get(storeId) ?? [];
    const e = earned(rows, worthOf(scheme.settings.points), months, scheme.starts_on, scheme.ends_on);
    const rewards = (await sellMoreRewards(scheme.id, [storeId])).get(storeId);
    const monthTerms = (await sellMoreMonthTerms(scheme.id, [storeId])).get(storeId);
    const shown = new Set(months.map(m => m.key));
    return {
        option, opted_at: terms.opted_at ?? null, assigned: Boolean(assignedOption(scheme, storeId)), total: e.total, warranties: e.warranties,
        months: [
            ...e.months.map(m => {
                const rewardRows = rewards?.get(m.key) ?? [];
                const d = adminMonth(scheme, rows, months.find(x => x.key === m.key)!, months, monthTerms);
                const slab = rewardSlab(d.target, d.calc.points, rewardRows.length);
                const lastReward = rewardRows[rewardRows.length - 1] ?? null;
                return {
                    key: m.key, label: m.label, warranties: m.warranties, points: m.points, future: false,
                    /* Its target and how far along it is, on the store's own points. */
                    target: storeScaleTarget(d.target, d.plain.points, d.calc.points, d.tier_obj?.times ?? 1),
                    pct: d.target ? Math.floor((d.calc.points / d.target) * 100) : null,
                    days: m.days.filter(d => d.warranties > 0).map(({ no_series: _n, ...d }) => d),
                    series: seriesInMonth(rows, scheme.settings.points, m.key, scheme.starts_on, scheme.ends_on),
                    /* Requests open once the calculated points reach the target. */
                    can_request: Boolean(slab && slab.to_next === 0 && !lastReward || slab && slab.to_next === 0 && lastReward?.status === 'sent'),
                    reward: lastReward ? { status: lastReward.status, note: lastReward.note, requested_at: lastReward.requested_at, sent_at: lastReward.sent_at } : null,
                    reward_slab: slab,
                    rewards_claimed: rewardRows.length,
                };
            }),
            ...periodsOf(scheme.starts_on, scheme.ends_on, 'month').filter(m => !shown.has(m.key)).map(m => ({
                key: m.key, label: m.label, warranties: 0, points: 0, future: true, target: null, pct: null, days: [], series: [], can_request: false, reward: null, reward_slab: null, rewards_claimed: 0,
            })),
        ],
    };
}

/** The scheme as a store may see it: no store types or multipliers. */
const sellMoreVisible = (scheme: Scheme) => {
    const { eligibility: _e, ...visible } = scheme;
    return { ...visible, settings: { ...visible.settings, points: { series: [], tiers: [] } } };
};

/** The verified franchises an admin can add, with what an import matches them by. */
async function allFranchises() {
    const [rows]: any = await db.execute(
        `SELECT vd.id, vd.store_code, vd.store_name, vd.city, vd.state, COALESCE(vd.allowed_brands, 'AF') AS brand, p.email
           FROM vendor_details vd
           JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1
           LEFT JOIN profiles p ON p.id = vd.user_id
          WHERE vd.is_franchise = 1 ORDER BY vd.store_name`
    );
    return rows.map((r: any) => ({
        id: String(r.id), code: r.store_code ?? null, name: String(r.store_name ?? '').trim(),
        city: r.city ?? null, state: r.state ?? null, brand: r.brand ?? 'AF', email: r.email ?? null,
    }));
}

/** Put a franchise on a target scheme (it sees the scheme from now on), or update its own terms. */
async function enrol(scheme: Scheme, storeId: string, terms: StoreTerms | null) {
    await db.execute(
        `INSERT INTO scheme_participants (scheme_id, store_id, terms) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE terms = VALUES(terms)`,
        [scheme.id, storeId, terms ? JSON.stringify(terms) : null]
    );
    const ids = new Set(scheme.eligibility.store_ids ?? []);
    if (!ids.has(storeId)) {
        ids.add(storeId);
        scheme.eligibility = { mode: 'stores', store_ids: [...ids], brand: null };
        await db.execute('UPDATE schemes SET eligibility = ? WHERE id = ?', [JSON.stringify(scheme.eligibility), scheme.id]);
        return true;
    }
    return false;
}

/**
 * Write target and achieved figures, keeping each change (who, when, old →
 * new, why). Changing a figure already set needs a reason; a first figure does not.
 */
async function writeFigures(req: Request, scheme: Scheme, changes: TargetChange[], reason: string | null) {
    const by = (req as any).user?.id ?? null;
    const byName = (req as any).user?.name ?? null;
    const [rows]: any = await db.execute('SELECT store_id, period, target, achieved, history FROM scheme_targets WHERE scheme_id = ?', [scheme.id]);
    const now = new Map<string, any>(rows.map((r: any) => [`${r.store_id}|${r.period}`, r]));
    const plan: { c: TargetChange; history: TargetHistory[] }[] = [];
    for (const c of changes) {
        const old = now.get(`${c.store_id}|${c.period}`);
        const history = json<TargetHistory[]>(old?.history, []);
        for (const field of ['target', 'achieved'] as const) {
            if (!(field in c)) continue;
            const from = dec(old?.[field]), to = c[field] ?? null;
            if (from === to) continue;
            if (from !== null && !reason) throw new Error(`Give a reason for changing ${field === 'target' ? 'a target' : 'an achieved figure'} already set`);
            history.push({ at: new Date().toISOString(), by: byName ?? by, field, from, to, reason });
        }
        plan.push({ c, history });
    }
    for (const { c, history } of plan) {
        await db.execute(
            `INSERT INTO scheme_targets (scheme_id, store_id, period, target, achieved, history, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                target = ${'target' in c ? 'VALUES(target)' : 'target'},
                achieved = ${'achieved' in c ? 'VALUES(achieved)' : 'achieved'},
                history = VALUES(history), updated_by = VALUES(updated_by)`,
            [scheme.id, c.store_id, c.period, c.target ?? null, c.achieved ?? null, JSON.stringify(history.slice(-200)), by]
        );
    }
    return plan.length;
}

/** The figures an admin sent, read: numbers or blanks, for this scheme's stores and periods only. */
function readChanges(raw: unknown, scheme: Scheme, storeIds: Set<string>): TargetChange[] {
    const periods = new Set(periodsFor(scheme).map(p => p.key));
    const out: TargetChange[] = [];
    for (const c of (Array.isArray(raw) ? raw : []).slice(0, 5000)) {
        const store_id = String(c?.store_id ?? ''), period = String(c?.period ?? '');
        if (!storeIds.has(store_id)) throw new Error('A figure is for a franchise not on this scheme');
        if (!periods.has(period)) throw new Error(`"${period}" is not a period of this scheme`);
        const one: TargetChange = { store_id, period };
        for (const field of ['target', 'achieved'] as const) {
            if (!(field in (c ?? {}))) continue;
            /* Counted from warranties, achievement is never typed. */
            if (field === 'achieved' && scheme.settings.source === 'warranties') continue;
            const v = c[field];
            if (v === null || v === '') { one[field] = null; continue; }
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0) throw new Error(`${field === 'target' ? 'Target' : 'Achieved'} must be a number`);
            one[field] = Math.round(n * 100) / 100;
        }
        out.push(one);
    }
    return out;
}

export class SchemeController {
    /* ─── Admin ──────────────────────────────────────────────────────────── */

    /** A target scheme's franchises, their figures per period, and the franchises that can be added. */
    static async adminTargets(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || scheme.settings.run !== 'targets') return res.status(404).json({ error: 'Target scheme not found' });
            const custom = req.query.avg_from ? readBasis({ mode: 'custom', from: req.query.avg_from, to: req.query.avg_to }) : null;
            const t = await schemeTargets(scheme, custom);
            const on = new Set(t.stores.map((x: any) => x.store_id));
            const free = (await allFranchises()).filter((f: any) => !on.has(f.id));
            const daily = scheme.settings.source === 'warranties' ? await warrantyDaily(null, scheme) : new Map<string, Record<string, DayCount>>();
            res.json({
                success: true, ...t, settings: scheme.settings, current: currentPeriod(scheme, t.periods),
                franchises: free.map((f: any) => {
                    if (scheme.settings.source !== 'warranties') return { ...f, averages: null, last_month: null, best_month: null };
                    const st = warrantyStats(scheme, daily.get(f.id) ?? {}, custom);
                    return { ...f, averages: st.averages, last_month: st.last_month, best_month: st.best_month };
                }),
            });
        } catch (error: any) {
            console.error('[Schemes] targets:', error);
            res.status(500).json({ error: 'Could not load the targets' });
        }
    }

    /** Add a franchise (or update it): its own steps (none = the scheme's), a note, and targets per period. */
    static async adminTargetStore(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || scheme.settings.run !== 'targets') return res.status(404).json({ error: 'Target scheme not found' });
            const storeId = String(req.body?.store_id ?? '');
            const known = (await allFranchises()).some((f: any) => f.id === storeId)
                || (scheme.eligibility.store_ids ?? []).includes(storeId);
            if (!known) return res.status(400).json({ error: 'Choose a verified franchise' });
            const steps = req.body?.steps ? readSteps(req.body.steps) : [];
            if (steps.length) {
                const p = stepProblems(steps, scheme.settings.benefit);
                if (p.length) return res.status(400).json({ error: p[0], problems: p });
            }
            const note = String(req.body?.note ?? '').trim().slice(0, 300);
            const growth = req.body?.growth_pct === '' || req.body?.growth_pct == null ? null : Number(req.body.growth_pct);
            if (growth !== null && (!Number.isFinite(growth) || growth < -100 || growth > 1000)) return res.status(400).json({ error: 'Growth must be a % between -100 and 1000' });
            const reward = String(req.body?.reward ?? '').trim().slice(0, 160);
            const terms: StoreTerms = {
                ...(steps.length ? { steps } : {}), ...(note ? { note } : {}),
                ...(growth !== null ? { growth_pct: growth } : {}), ...(reward ? { reward } : {}),
            };
            let typed: Record<string, unknown> = req.body?.targets ?? {};
            if (growth !== null && scheme.settings.source === 'warranties') {
                const basis = readBasis(req.body?.basis);
                const average = averageFor(scheme, (await warrantyDaily([storeId], scheme)).get(storeId) ?? {}, basis);
                Object.assign(terms, { basis, average });
                typed = growthTargets(periodsFor(scheme), average, growth);
            }
            const added = await enrol(scheme, storeId, Object.keys(terms).length ? terms : null);
            const targets = Object.entries(typed).filter(([, v]) => v !== '' && v !== null && v !== undefined)
                .map(([period, target]) => ({ store_id: storeId, period, target }));
            const changes = readChanges(targets, scheme, new Set([storeId]));
            await writeFigures(req, scheme, changes, String(req.body?.reason ?? '').trim() || null);
            log(req, added ? 'SCHEME_TARGET_STORE_ADDED' : 'SCHEME_TARGET_STORE_UPDATED', scheme, { store_id: storeId, steps: steps.length ? steps : 'scheme', targets: changes.length });
            if (added && scheme.status === 'published' && process.env.DISABLE_SCHEDULERS !== '1') {
                const [[st]]: any = await db.execute('SELECT user_id FROM vendor_details WHERE id = ?', [storeId]);
                if (st?.user_id) await NotificationService.notify(st.user_id, {
                    title: `You're in: ${scheme.title}`, message: 'Your target is set. Open Offers & Schemes to see it.',
                    type: 'scheme', metadata: { scheme_id: scheme.id },
                });
            }
            res.json({ success: true, added });
        } catch (error: any) {
            console.error('[Schemes] target store:', error);
            res.status(/must|period|franchise/i.test(error?.message) ? 400 : 500).json({ error: error?.message || 'Could not save' });
        }
    }

    /** A franchise's warranty history and average, to set its growth before adding it. */
    static async adminTargetStats(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || scheme.settings.run !== 'targets') return res.status(404).json({ error: 'Target scheme not found' });
            const storeId = String(req.query.store_id ?? '');
            const daily = (await warrantyDaily([storeId], scheme)).get(storeId) ?? {};
            const custom = req.query.avg_from ? readBasis({ mode: 'custom', from: req.query.avg_from, to: req.query.avg_to }) : null;
            res.json({ success: true, stats: warrantyStats(scheme, daily, custom), periods: periodsFor(scheme) });
        } catch (error: any) {
            console.error('[Schemes] target stats:', error);
            res.status(500).json({ error: 'Could not load the warranties' });
        }
    }

    /**
     * Growth and reward for many franchises at once, typed in the grid. A growth
     * sets every period's target from the store's average; changing targets
     * already set needs a reason.
     */
    static async adminTargetTerms(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || scheme.settings.run !== 'targets') return res.status(404).json({ error: 'Target scheme not found' });
            const on = new Set(scheme.eligibility.store_ids ?? []);
            const list = (Array.isArray(req.body?.stores) ? req.body.stores : []).slice(0, 2000);
            const [members]: any = await db.execute('SELECT store_id, terms FROM scheme_participants WHERE scheme_id = ?', [scheme.id]);
            const termsOf = new Map(members.map((m: any) => [String(m.store_id), json<StoreTerms>(m.terms, {})]));
            const periods = periodsFor(scheme);
            const basis = readBasis(req.body?.basis);
            const daily = await warrantyDaily([...on], scheme);
            const changes: TargetChange[] = [];
            const updates: [string, StoreTerms][] = [];
            for (const x of list) {
                const id = String(x?.store_id ?? '');
                if (!on.has(id)) return res.status(400).json({ error: 'A row is for a franchise not on this scheme' });
                const t: StoreTerms = { ...(termsOf.get(id) ?? {}) };
                if ('growth_pct' in (x ?? {})) {
                    if (x.growth_pct === '' || x.growth_pct === null) delete t.growth_pct;
                    else {
                        const g = Number(x.growth_pct);
                        if (!Number.isFinite(g) || g < -100 || g > 1000) return res.status(400).json({ error: 'Growth must be a % between -100 and 1000' });
                        t.growth_pct = g;
                        if (scheme.settings.source === 'warranties') {
                            const avg = averageFor(scheme, daily.get(id) ?? {}, basis);
                            t.basis = basis; t.average = avg;
                            for (const [period, target] of Object.entries(growthTargets(periods, avg, g))) changes.push({ store_id: id, period, target });
                        }
                    }
                }
                if ('tier' in (x ?? {})) {
                    const tier = String(x.tier ?? '');
                    if (scheme.settings.points.tiers.some(z => z.id === tier)) t.tier = tier; else delete t.tier;
                }
                if ('target' in (x ?? {}) && scheme.settings.measure === 'points') {
                    if (x.target === '' || x.target === null) delete t.target;
                    else {
                        const n = Number(x.target);
                        if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return res.status(400).json({ error: 'A target must be a number of points above 0' });
                        t.target = roundPoints(n);
                        for (const p of periods) changes.push({ store_id: id, period: p.key, target: t.target });
                    }
                }
                if ('reward' in (x ?? {})) {
                    const r = String(x.reward ?? '').trim().slice(0, 160);
                    if (r) t.reward = r; else delete t.reward;
                }
                updates.push([id, t]);
            }
            const reason = String(req.body?.reason ?? '').trim().slice(0, 300) || null;
            await writeFigures(req, scheme, changes, reason);
            for (const [id, t] of updates) {
                await db.execute('UPDATE scheme_participants SET terms = ? WHERE scheme_id = ? AND store_id = ?', [Object.keys(t).length ? JSON.stringify(t) : null, scheme.id, id]);
            }
            log(req, 'SCHEME_TARGET_TERMS_UPDATED', scheme, { stores: list, reason });
            res.json({ success: true, saved: updates.length });
        } catch (error: any) {
            res.status(/reason|must|period|franchise/i.test(error?.message) ? 400 : 500).json({ error: error?.message || 'Could not save' });
        }
    }

    /** Targets and achieved figures typed in the grid (or many at once). */
    static async adminTargetFigures(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || scheme.settings.run !== 'targets') return res.status(404).json({ error: 'Target scheme not found' });
            const changes = readChanges(req.body?.changes, scheme, new Set(scheme.eligibility.store_ids ?? []));
            const n = await writeFigures(req, scheme, changes, String(req.body?.reason ?? '').trim().slice(0, 300) || null);
            log(req, 'SCHEME_TARGETS_UPDATED', scheme, { changes, reason: req.body?.reason ?? null });
            res.json({ success: true, saved: n });
        } catch (error: any) {
            res.status(/reason|must|period|franchise/i.test(error?.message) ? 400 : 500).json({ error: error?.message || 'Could not save' });
        }
    }

    /** Mark one franchise's benefit for a period paid, or not paid. */
    static async adminTargetPaid(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || scheme.settings.run !== 'targets') return res.status(404).json({ error: 'Target scheme not found' });
            const { store_id, period, paid } = req.body ?? {};
            const [[row]]: any = await db.execute('SELECT history, paid_at FROM scheme_targets WHERE scheme_id = ? AND store_id = ? AND period = ?', [scheme.id, String(store_id), String(period)]);
            if (!row) return res.status(404).json({ error: 'No figures for that franchise and period' });
            const history = json<TargetHistory[]>(row.history, []);
            history.push({ at: new Date().toISOString(), by: (req as any).user?.name ?? null, field: 'paid', from: row.paid_at ? 'paid' : 'to pay', to: paid ? 'paid' : 'to pay', reason: String(req.body?.reason ?? '').trim() || null });
            await db.execute(
                'UPDATE scheme_targets SET paid_at = ?, paid_by = ?, history = ? WHERE scheme_id = ? AND store_id = ? AND period = ?',
                [paid ? new Date() : null, paid ? (req as any).user?.id ?? null : null, JSON.stringify(history), scheme.id, String(store_id), String(period)]
            );
            log(req, paid ? 'SCHEME_TARGET_PAID' : 'SCHEME_TARGET_UNPAID', scheme, { store_id, period });
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] target paid:', error);
            res.status(500).json({ error: 'Could not save' });
        }
    }

    /** Take a franchise off a target scheme: it no longer sees it. Its figures go into the activity log. */
    static async adminTargetRemove(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || scheme.settings.run !== 'targets') return res.status(404).json({ error: 'Target scheme not found' });
            const storeId = String(req.params.storeId);
            const reason = String(req.body?.reason ?? '').trim();
            if (reason.length < 3) return res.status(400).json({ error: 'Give a reason for removing the franchise' });
            const [rows]: any = await db.execute('SELECT * FROM scheme_targets WHERE scheme_id = ? AND store_id = ?', [scheme.id, storeId]);
            await db.execute('DELETE FROM scheme_targets WHERE scheme_id = ? AND store_id = ?', [scheme.id, storeId]);
            await db.execute('DELETE FROM scheme_participants WHERE scheme_id = ? AND store_id = ?', [scheme.id, storeId]);
            const ids = (scheme.eligibility.store_ids ?? []).filter(x => x !== storeId);
            await db.execute('UPDATE schemes SET eligibility = ? WHERE id = ?', [JSON.stringify({ mode: 'stores', store_ids: ids, brand: null }), scheme.id]);
            log(req, 'SCHEME_TARGET_STORE_REMOVED', scheme, { store_id: storeId, reason, figures: rows });
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] target remove:', error);
            res.status(500).json({ error: 'Could not remove the franchise' });
        }
    }

    /**
     * Targets and achievement from a sheet: rows of store, period, target,
     * achieved. `dry_run` shows what would change; otherwise franchises not yet
     * on the scheme are added (with the scheme's steps) and the figures saved.
     */
    static async adminTargetImport(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || scheme.settings.run !== 'targets') return res.status(404).json({ error: 'Target scheme not found' });
            const rows: TargetImportRow[] = (Array.isArray(req.body?.rows) ? req.body.rows : []).slice(0, 5000).map((r: any, i: number) => ({
                row: Number(r?.row) || i + 2, store: String(r?.store ?? ''), period: r?.period ?? '', target: r?.target ?? '', achieved: r?.achieved ?? '',
            }));
            if (!rows.length) return res.status(400).json({ error: 'The sheet has no rows' });
            const franchises = await allFranchises();
            const periods = periodsFor(scheme);
            const { changes, problems } = planTargetImport(rows, franchises, periods);
            const on = new Set(scheme.eligibility.store_ids ?? []);
            const newStores = [...new Set(changes.map(c => c.store_id).filter(id => !on.has(id)))];
            const names = new Map(franchises.map((f: any) => [f.id, f.name]));
            const summary = {
                rows: rows.length, changes: changes.length, problems,
                new_stores: newStores.map(id => names.get(id) ?? id),
            };
            if (req.body?.dry_run) return res.json({ success: true, dry_run: true, ...summary });
            for (const id of newStores) await enrol(scheme, id, null);
            await writeFigures(req, scheme, changes, String(req.body?.reason ?? '').trim() || 'Imported from a sheet');
            log(req, 'SCHEME_TARGETS_IMPORTED', scheme, { rows: rows.length, changes: changes.length, new_stores: newStores.length });
            res.json({ success: true, ...summary });
        } catch (error: any) {
            console.error('[Schemes] target import:', error);
            res.status(500).json({ error: error?.message || 'Could not import' });
        }
    }

    /** Sell More Earn More: every store that opted, its type, points by month and reward requests. */
    static async adminSellMore(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const [parts]: any = await db.execute(
                `SELECT sp.store_id, sp.joined_at, sp.terms, vd.store_name, vd.store_code, vd.city, vd.state, COALESCE(vd.allowed_brands, 'AF') AS brand
                   FROM scheme_participants sp JOIN vendor_details vd ON vd.id = sp.store_id
                  WHERE sp.scheme_id = ?`,
                [scheme.id]
            );
            const opted = parts.map((p: any) => ({ ...p, terms: json<any>(p.terms, {}) })).filter((p: any) => optionOf(p.terms) === 'sell_more');
            const rule = scheme.settings.points;
            const months = sellMoreMonths(scheme);
            const ids = opted.map((p: any) => String(p.store_id));
            const rows = await sellMoreRows(scheme, ids);
            const rewards = await sellMoreRewards(scheme.id, ids);
            const monthTerms = await sellMoreMonthTerms(scheme.id, ids);
            const stores = opted.map((p: any) => {
                const id = String(p.store_id);
                const data = months.map(m => [m, adminMonth(scheme, rows.get(id) ?? [], m, months, monthTerms.get(id))] as const);
                const mine = rewards.get(id);
                return {
                    store_id: id, store_name: String(p.store_name ?? '').trim(), store_code: p.store_code ?? null, city: p.city ?? null, state: p.state ?? null, brand: p.brand,
                    opted_at: p.terms.opted_at ?? p.joined_at,
                    months: Object.fromEntries(data.map(([m, d]) => [m.key, {
                        tier: d.tier, target: d.target, calculated: d.calc.points, store_points: d.plain.points,
                        warranties: d.calc.warranties, no_series: d.calc.no_series, reward: mine?.get(m.key)?.at(-1)?.status ?? null,
                    }])),
                };
            });
            res.json({
                success: true,
                months: months.map(m => ({ key: m.key, label: m.label })),
                tiers: rule.tiers.map(t => ({ id: t.id, name: t.name })),
                stores,
            });
        } catch (error: any) {
            console.error('[Schemes] sell more:', error);
            res.status(500).json({ error: 'Could not load the stores' });
        }
    }

    /** One opted store's points day by day. */
    static async adminSellMoreStore(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const [[p]]: any = await db.execute('SELECT terms FROM scheme_participants WHERE scheme_id = ? AND store_id = ?', [scheme.id, req.params.storeId]);
            const terms = json<any>(p?.terms, {});
            if (optionOf(terms) !== 'sell_more') return res.status(404).json({ error: 'This store has not opted' });
            const rows = (await sellMoreRows(scheme, [req.params.storeId])).get(req.params.storeId) ?? [];
            const rule = scheme.settings.points;
            const months = sellMoreMonths(scheme);
            const monthTerms = (await sellMoreMonthTerms(scheme.id, [req.params.storeId])).get(req.params.storeId);
            const rewards = (await sellMoreRewards(scheme.id, [req.params.storeId])).get(req.params.storeId);
            res.json({
                success: true,
                months: months.map(m => {
                    const d = adminMonth(scheme, rows, m, months, monthTerms);
                    const storeDay = new Map(d.plain.days.map(x => [x.date, x.points]));
                    return {
                        key: m.key, label: m.label, points: d.calc.points, store_points: d.plain.points, warranties: d.calc.warranties, no_series: d.calc.no_series,
                        reward: rewards?.get(m.key)?.at(-1) ?? null,
                        series: seriesInMonth(rows, rule, m.key, scheme.starts_on, scheme.ends_on, d.tier_obj),
                        days: d.calc.days.map(x => ({ ...x, store_points: storeDay.get(x.date) ?? 0 })),
                    };
                }),
            });
        } catch (error: any) {
            console.error('[Schemes] sell more store:', error);
            res.status(500).json({ error: 'Could not load the store' });
        }
    }

    /** For the edit form: every store a target can be set for, Option 1 first, with its targets by month. */
    static async adminSellMoreTargets(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const [parts]: any = await db.execute('SELECT store_id, terms FROM scheme_participants WHERE scheme_id = ?', [scheme.id]);
            const optionFor = new Map<string, string | null>(parts.map((p: any) => [String(p.store_id), optionOf(json<any>(p.terms, {}))]));
            const stores = (await allFranchises()).filter((f: any) => optionFor.get(f.id) !== 'buy_more');
            const [rows]: any = await db.execute('SELECT store_id, month, target FROM scheme_store_months WHERE scheme_id = ? AND target IS NOT NULL', [scheme.id]);
            const targets = new Map<string, Record<string, number>>();
            for (const r of rows) targets.set(String(r.store_id), { ...(targets.get(String(r.store_id)) ?? {}), [r.month]: Number(r.target) });
            const sofar = sellMoreMonths(scheme);
            res.json({
                success: true,
                months: periodsOf(scheme.starts_on, scheme.ends_on, 'month').map(m => ({ key: m.key, label: m.label })),
                current: sofar[sofar.length - 1].key,
                stores: stores
                    .map((f: any) => ({ store_id: f.id, store_name: f.name, store_code: f.code, city: f.city, state: f.state, option: optionFor.get(f.id) ?? null, targets: targets.get(f.id) ?? {} }))
                    .sort((a: any, b: any) => Number(Boolean(b.option)) - Number(Boolean(a.option)) || a.store_name.localeCompare(b.store_name)),
            });
        } catch (error: any) {
            console.error('[Schemes] targets:', error);
            res.status(500).json({ error: 'Could not load the stores' });
        }
    }

    /** Save targets typed in the edit form: { month: { storeId: number or blank } }. A blank clears the target. */
    static async adminSellMoreTargetsSave(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const months = new Set(periodsOf(scheme.starts_on, scheme.ends_on, 'month').map(m => m.key));
            const [parts]: any = await db.execute('SELECT store_id, terms FROM scheme_participants WHERE scheme_id = ?', [scheme.id]);
            const optionFor = new Map<string, string | null>(parts.map((p: any) => [String(p.store_id), optionOf(json<any>(p.terms, {}))]));
            const allowed = new Set((await allFranchises()).map((f: any) => f.id as string).filter((id: string) => optionFor.get(id) !== 'buy_more'));

            const changes: { store: string; month: string; target: number | null }[] = [];
            for (const [month, forMonth] of Object.entries((req.body?.targets ?? {}) as Record<string, Record<string, unknown>>)) {
                if (!months.has(month)) return res.status(400).json({ error: 'That month is not in the program' });
                for (const [store, raw] of Object.entries(forMonth ?? {})) {
                    if (!allowed.has(store)) return res.status(400).json({ error: "A target can't be set for one of these stores" });
                    const blank = raw === null || String(raw).trim() === '';
                    const n = Number(raw);
                    if (!blank && (!Number.isFinite(n) || n <= 0 || n > 1000000)) return res.status(400).json({ error: 'A target should be a number above 0' });
                    changes.push({ store, month, target: blank ? null : Math.round(n * 100) / 100 });
                }
            }
            const by = (req as any).user?.id ?? null;
            for (const c of changes) {
                await db.execute(
                    `INSERT INTO scheme_store_months (scheme_id, store_id, month, target, updated_by) VALUES (?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE target = VALUES(target), updated_by = VALUES(updated_by)`,
                    [scheme.id, c.store, c.month, c.target, by]
                );
            }
            if (changes.length) log(req, 'SCHEME_TARGETS_SET', scheme, { changes });
            res.json({ success: true, saved: changes.length });
        } catch (error: any) {
            console.error('[Schemes] targets save:', error);
            res.status(500).json({ error: 'Could not save the targets' });
        }
    }

    /** Set an opted store's category and/or target for one month. Reaching the target opens the store's request for that month. */
    static async adminSellMoreMonth(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const storeId = String(req.body?.store_id ?? '');
            const month = String(req.body?.month ?? '');
            const [[p]]: any = await db.execute('SELECT terms FROM scheme_participants WHERE scheme_id = ? AND store_id = ?', [scheme.id, storeId]);
            if (optionOf(json<any>(p?.terms, {})) !== 'sell_more') return res.status(404).json({ error: 'This store has not opted' });
            if (!sellMoreMonths(scheme).some(m => m.key === month)) return res.status(400).json({ error: 'That month is not open' });

            const [[now]]: any = await db.execute('SELECT tier, target FROM scheme_store_months WHERE scheme_id = ? AND store_id = ? AND month = ?', [scheme.id, storeId, month]);
            let tier: string | null = now?.tier ?? null;
            let target: number | null = now?.target == null ? null : Number(now.target);
            if (req.body?.tier !== undefined) {
                const t = scheme.settings.points.tiers.find(x => x.id === req.body.tier);
                if (!t) return res.status(400).json({ error: 'Pick a category' });
                tier = t.id;
            }
            if (req.body?.target !== undefined) {
                if (req.body.target === null || req.body.target === '') target = null;
                else {
                    const n = Number(req.body.target);
                    if (!Number.isFinite(n) || n <= 0 || n > 1000000) return res.status(400).json({ error: 'The target should be a number above 0' });
                    target = Math.round(n * 100) / 100;
                }
            }
            await db.execute(
                `INSERT INTO scheme_store_months (scheme_id, store_id, month, tier, target, updated_by) VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE tier = VALUES(tier), target = VALUES(target), updated_by = VALUES(updated_by)`,
                [scheme.id, storeId, month, tier, target, (req as any).user?.id ?? null]
            );
            log(req, 'SCHEME_STORE_MONTH_SET', scheme, { store_id: storeId, month, tier, target, was: now ?? null });
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] sell more month:', error);
            res.status(500).json({ error: 'Could not save' });
        }
    }

    /** Open the program to every franchise, or pause it so only the scheme's own stores can see it. */
    static async adminSellMoreLive(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const live = req.body?.live === true;
            const { live: _was, ...rest } = scheme.settings;
            await db.execute('UPDATE schemes SET settings = ? WHERE id = ?', [JSON.stringify(live ? { ...rest, live: true } : rest), scheme.id]);
            log(req, live ? 'SCHEME_MADE_LIVE' : 'SCHEME_PAUSED', scheme, {});
            res.json({ success: true, live });
        } catch (error: any) {
            console.error('[Schemes] program live:', error);
            res.status(500).json({ error: 'Could not change it' });
        }
    }

    /** Which groups and single stores the program is open to. */
    static async adminSellMoreAudience(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const audience = readAudience(req.body);
            // Stores are assigned manually now; the distributor group must stay
            // off so stale admin-screen payloads cannot reopen it.
            audience.groups.distributors = false;
            const stores = await programStores();
            const valid = new Set(stores.filter((s: any) => inAudience(s, audience) || audience.assignments[s.id]).map((s: any) => s.id));
            for (const [storeId, option] of Object.entries(audience.assignments)) {
                const store = stores.find((s: any) => s.id === storeId);
                if (!store || !valid.has(storeId) || !optionAllowed(option, store)) delete audience.assignments[storeId];
            }
            // An explicit option assignment also makes the store visible. This
            // lets the admin bulk-hide unassigned stores with “Never show” and
            // later reveal one simply by assigning Option 1 or 2.
            const assignedIds = new Set(Object.keys(audience.assignments));
            audience.exclude = audience.exclude.filter(id => !assignedIds.has(id));
            audience.include = [...new Set([...audience.include, ...assignedIds])];
            const previous = readAudience(scheme.settings.audience);
            for (const storeId of Object.keys(previous.assignments)) {
                if (audience.assignments[storeId]) continue;
                await db.execute(
                    `UPDATE scheme_participants SET terms = JSON_REMOVE(COALESCE(terms, '{}'), '$.option', '$.source', '$.opted_at')
                     WHERE scheme_id = ? AND store_id = ? AND JSON_EXTRACT(terms, '$.source') = '"admin"'`,
                    [scheme.id, storeId]
                );
            }
            await db.execute('UPDATE schemes SET settings = ? WHERE id = ?', [JSON.stringify({ ...scheme.settings, audience }), scheme.id]);
            for (const [storeId, option] of Object.entries(audience.assignments)) {
                await db.execute('INSERT IGNORE INTO scheme_participants (scheme_id, store_id) VALUES (?, ?)', [scheme.id, storeId]);
                await db.execute(
                    `UPDATE scheme_participants SET terms = JSON_SET(COALESCE(terms, '{}'), '$.option', ?, '$.source', 'admin', '$.opted_at', ?)
                     WHERE scheme_id = ? AND store_id = ?`,
                    [option, new Date().toISOString(), scheme.id, storeId]
                );
            }
            log(req, 'SCHEME_AUDIENCE_SET', scheme, { was: readAudience(scheme.settings.audience), now: audience });
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] audience:', error);
            res.status(500).json({ error: 'Could not save' });
        }
    }

    /** The whole program at a glance: what's waiting, who chose what, and the totals. */
    static async adminSellMoreProgram(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const [parts]: any = await db.execute('SELECT store_id, terms FROM scheme_participants WHERE scheme_id = ?', [scheme.id]);
            const audience = readAudience(scheme.settings.audience);
            const optionFor = new Map<string, string | null>(parts.map((p: any) => [String(p.store_id), optionOf(json<any>(p.terms, {})) ?? audience.assignments[String(p.store_id)] ?? null]));
            const everyone = await programStores();
            const franchises = everyone.filter((s: any) => inAudience(s, audience) || Boolean(audience.assignments[s.id]));
            const months = sellMoreMonths(scheme);
            const current = months[months.length - 1];
            const sell = franchises.filter((f: any) => optionFor.get(f.id) === 'sell_more').map((f: any) => f.id as string);
            const rows = await sellMoreRows(scheme, sell);
            const monthTerms = await sellMoreMonthTerms(scheme.id, sell);
            let points = 0, noSeries = 0, noTarget = 0;
            for (const id of sell) {
                const d = adminMonth(scheme, rows.get(id) ?? [], current, months, monthTerms.get(id));
                points += d.calc.points; noSeries += d.calc.no_series;
                if (d.target === null) noTarget++;
            }
            const [[invoices]]: any = await db.execute(
                `SELECT SUM(status = 'pending') AS waiting, MIN(CASE WHEN status = 'pending' THEN created_at END) AS oldest FROM scheme_buy_invoices WHERE scheme_id = ?`, [scheme.id]);
            const [approved]: any = await db.execute(`SELECT sets FROM scheme_buy_invoices WHERE scheme_id = ? AND status = 'approved'`, [scheme.id]);
            const [[free]]: any = await db.execute(
                `SELECT SUM(status = 'requested') AS waiting, SUM(status = 'approved') AS given FROM scheme_free_sets WHERE scheme_id = ?`, [scheme.id]);
            const [[rewards]]: any = await db.execute(
                `SELECT SUM(status = 'requested') AS waiting, SUM(status = 'sent') AS sent FROM scheme_reward_requests WHERE scheme_id = ?`, [scheme.id]);
            res.json({
                success: true,
                live: scheme.settings.live === true,
                preview_stores: everyone.filter((f: any) => (scheme.eligibility.store_ids ?? []).includes(f.id)).map((f: any) => f.name),
                audience,
                stores: everyone.map((s: any) => ({ id: s.id, name: s.name, code: s.code, city: s.city, state: s.state, group: groupOf(s), option: optionFor.get(s.id) ?? null, assignment: audience.assignments[s.id] ?? null })),
                month_label: current.label,
                franchises: franchises.length, option1: sell.length,
                option2: franchises.filter((f: any) => optionFor.get(f.id) === 'buy_more').length,
                not_chosen: franchises.filter((f: any) => !optionFor.get(f.id)).map((f: any) => ({ id: f.id, name: f.name, code: f.code, city: f.city, state: f.state, brand: f.brand })),
                invoices_waiting: Number(invoices?.waiting) || 0, oldest_invoice: invoices?.oldest ?? null,
                redeem_waiting: Number(free?.waiting) || 0, free_given: Number(free?.given) || 0,
                reward_waiting: Number(rewards?.waiting) || 0, rewards_sent: Number(rewards?.sent) || 0,
                no_target: noTarget, month_points: Math.round(points * 100) / 100, no_series: noSeries,
                sets_approved: approved.reduce((n: number, r: any) => n + setsTotal(readSets(json(r.sets, {}))), 0),
            });
        } catch (error: any) {
            console.error('[Schemes] program:', error);
            res.status(500).json({ error: 'Could not load the program' });
        }
    }

    /**
     * Mark one store's month as sent, asked for or not. Undoing goes back to the
     * store's request, or removes the row when the store never asked.
     */
    static async adminSellMoreReward(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const storeId = String(req.body?.store_id ?? '');
            const month = String(req.body?.month ?? '');
            const [[p]]: any = await db.execute('SELECT terms FROM scheme_participants WHERE scheme_id = ? AND store_id = ?', [scheme.id, storeId]);
            if (optionOf(json<any>(p?.terms, {})) !== 'sell_more') return res.status(404).json({ error: 'This store has not opted' });
            const months = sellMoreMonths(scheme);
            if (!months.some(m => m.key === month)) return res.status(400).json({ error: 'That month is not open' });
            const by = (req as any).user?.id ?? null;
            const [[latest]]: any = await db.execute('SELECT MAX(slab_no) AS slab_no FROM scheme_reward_requests WHERE scheme_id = ? AND store_id = ? AND month = ?', [scheme.id, storeId, month]);
            const slabNo = Math.max(1, Number(req.body?.slab_no) || Number(latest?.slab_no) || 1);
            if (req.body?.status === 'sent') {
                const note = String(req.body?.note ?? '').trim().slice(0, 500) || null;
                const rows = (await sellMoreRows(scheme, [storeId])).get(storeId) ?? [];
                const plain = earned(rows, worthOf(scheme.settings.points), months, scheme.starts_on, scheme.ends_on).months.find(m => m.key === month)?.points ?? 0;
                await db.execute(
                    `INSERT INTO scheme_reward_requests (id, scheme_id, store_id, month, slab_no, points, status, source, note, sent_at, sent_by)
                     VALUES (?, ?, ?, ?, ?, ?, 'sent', 'admin', ?, NOW(), ?)
                     ON DUPLICATE KEY UPDATE status = 'sent', note = VALUES(note), sent_at = NOW(), sent_by = VALUES(sent_by)`,
                    [uuidv4(), scheme.id, storeId, month, slabNo, plain, note, by]
                );
            } else {
                await db.execute(`DELETE FROM scheme_reward_requests WHERE scheme_id = ? AND store_id = ? AND month = ? AND slab_no = ? AND source = 'admin'`, [scheme.id, storeId, month, slabNo]);
                await db.execute(
                    `UPDATE scheme_reward_requests SET status = 'requested', note = NULL, sent_at = NULL, sent_by = NULL WHERE scheme_id = ? AND store_id = ? AND month = ? AND slab_no = ?`,
                    [scheme.id, storeId, month, slabNo]
                );
            }
            log(req, req.body?.status === 'sent' ? 'SCHEME_REWARD_SENT' : 'SCHEME_REWARD_UNDONE', scheme, { store_id: storeId, month, note: req.body?.note ?? null });
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] sell more reward:', error);
            res.status(500).json({ error: 'Could not update the reward' });
        }
    }

    /** Option 2 for the admin: every store that opted, every invoice, every free set. */
    static async adminBuyMore(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const [parts]: any = await db.execute(
                `SELECT sp.store_id, sp.joined_at, sp.terms, vd.user_id, vd.store_name, vd.store_code, vd.city, vd.state, COALESCE(vd.allowed_brands, 'AF') AS brand
                   FROM scheme_participants sp JOIN vendor_details vd ON vd.id = sp.store_id WHERE sp.scheme_id = ?`,
                [scheme.id]
            );
            const opted = parts.map((p: any) => ({ ...p, terms: json<any>(p.terms, {}) })).filter((p: any) => optionOf(p.terms) === 'buy_more');
            const names = new Map<string, any>(opted.map((p: any) => [String(p.store_id), p]));
            const [invoiceRows]: any = await db.execute('SELECT * FROM scheme_buy_invoices WHERE scheme_id = ? ORDER BY created_at DESC', [scheme.id]);
            const invoices = invoiceRows.map(readInvoice);
            const [claimRows]: any = await db.execute("SELECT id, store_id, offer, used, status, note, requested_at, sent_at FROM scheme_free_sets WHERE scheme_id = ? ORDER BY status = 'requested' DESC, requested_at DESC", [scheme.id]);
            const label = (id: string) => ({ store_name: String(names.get(id)?.store_name ?? 'Store').trim(), city: names.get(id)?.city ?? null });
            /* Which distributors each store is mapped to, and who added each invoice. */
            const [maps]: any = await db.execute('SELECT fd.franchise_user_id, d.id, d.name, d.city FROM franchise_distributors fd JOIN distributors d ON d.id = fd.distributor_id');
            const distsOf = new Map<string, { id: string; name: string; city: string | null }[]>();
            for (const m of maps) distsOf.set(String(m.franchise_user_id), [...(distsOf.get(String(m.franchise_user_id)) ?? []), { id: String(m.id), name: m.name, city: m.city ?? null }]);
            const [allDists]: any = await db.execute('SELECT id, name FROM distributors');
            /* The stores switched on for each distributor: its numbers count only those. */
            const [shownRows]: any = await db.execute('SELECT distributor_id, store_id FROM scheme_distributor_stores WHERE scheme_id = ?', [scheme.id]);
            const shownSet = new Map<string, Set<string>>();
            for (const r of shownRows) shownSet.set(String(r.distributor_id), (shownSet.get(String(r.distributor_id)) ?? new Set()).add(String(r.store_id)));
            const [addRows]: any = await db.execute('SELECT distributor_id, can_add FROM scheme_distributor_access WHERE scheme_id = ?', [scheme.id]);
            const addBy = new Map<string, boolean>(addRows.map((r: any) => [String(r.distributor_id), Boolean(r.can_add)]));
            const distName = new Map<string, string>(allDists.map((d: any) => [String(d.id), String(d.name)]));
            const balances = new Map<string, ReturnType<typeof buyBalance>>();
            const balanceOf = (id: string) => {
                if (!balances.has(id)) balances.set(id, buyBalance(invoices.filter((i: any) => i.store_id === id), claimRows.filter((c: any) => String(c.store_id) === id)));
                return balances.get(id)!;
            };
            res.json({
                success: true,
                stores: opted.map((p: any) => {
                    const id = String(p.store_id);
                    const claims = claimRows.filter((c: any) => String(c.store_id) === id);
                    const b = balanceOf(id);
                    return {
                        store_id: id, store_name: String(p.store_name ?? '').trim(), store_code: p.store_code ?? null, city: p.city ?? null, state: p.state ?? null, brand: p.brand,
                        distributors: (distsOf.get(String(p.user_id)) ?? []).map(d => d.name),
                        opted_at: p.terms.opted_at ?? p.joined_at, approved: b.approved, used: b.used, available: b.available, eligibility: b.eligibility, rewards: b.rewards,
                        waiting_sets: invoices.filter((i: any) => i.store_id === id && i.status === 'pending').reduce((n: number, i: any) => n + setsTotal(i.sets), 0),
                        requests: claims.filter((c: any) => c.status === 'requested').length,
                    };
                }),
                invoices: invoices.map((i: any) => ({ ...i, ...label(i.store_id), added_by: i.added_by_distributor_id ? (distName.get(i.added_by_distributor_id) ?? 'Distributor') : null, files: i.files.map(({ sha256: _h, ...f }: any) => f) })),
                distributors: (() => {
                    const rows = new Map<string, { id: string; name: string; city: string | null; stores: Set<string> }>();
                    for (const p of opted) for (const d of distsOf.get(String(p.user_id)) ?? []) {
                        if (!rows.has(d.id)) rows.set(d.id, { ...d, stores: new Set() });
                        rows.get(d.id)!.stores.add(String(p.store_id));
                    }
                    return [...rows.values()].map(r => {
                        const ids = [...r.stores].filter(id => shownSet.get(r.id)?.has(id));
                        const mine = invoices.filter((i: any) => ids.includes(i.store_id));
                        const approved = ids.reduce((n, id) => n + setsTotal(balanceOf(id).approved), 0);
                        return {
                            id: r.id, name: r.name, city: r.city, stores: r.stores.size, shown: ids.length, can_add: addBy.get(r.id) ?? true,
                            stores_active: ids.filter(id => mine.some((i: any) => i.store_id === id && i.status === 'approved')).length,
                            approved_sets: approved,
                            waiting_sets: mine.filter((i: any) => i.status === 'pending').reduce((n: number, i: any) => n + setsTotal(i.sets), 0),
                            available_sets: ids.reduce((n, id) => n + balanceOf(id).eligibility.total, 0),
                            ready: ids.filter(id => balanceOf(id).eligibility.offer1.ready || balanceOf(id).eligibility.offer2_ready).length,
                            free_sets: ids.reduce((n, id) => n + balanceOf(id).rewards, 0),
                            invoices_added: invoices.filter((i: any) => i.added_by_distributor_id === r.id).length,
                            invoices_by_stores: mine.filter((i: any) => !i.added_by_distributor_id).length,
                        };
                    });
                })(),
                free_sets: claimRows.map((c: any) => {
                    const id = String(c.store_id);
                    const available = balanceOf(id).available;
                    return {
                        ...c, store_id: id, ...label(id), available,
                        used: c.used ? readSets(json(c.used, {})) : setsForOffer(available, isOffer(c.offer) ? c.offer : 'offer1'),
                    };
                }),
            });
        } catch (error: any) {
            console.error('[Schemes] buy more:', error);
            res.status(500).json({ error: 'Could not load the invoices' });
        }
    }

    /** Approve an invoice (with the sets corrected if need be), reject it with a reason, or put it back to waiting. */
    static async adminBuyMoreInvoice(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const status = String(req.body?.status ?? '');
            if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'Pick a status' });
            const note = String(req.body?.note ?? '').trim().slice(0, 500) || null;
            if (status === 'rejected' && !note) return res.status(400).json({ error: 'Give a reason; the store sees it' });
            const [[inv]]: any = await db.execute('SELECT id, sets FROM scheme_buy_invoices WHERE id = ? AND scheme_id = ?', [req.params.invoiceId, scheme.id]);
            if (!inv) return res.status(404).json({ error: 'Invoice not found' });
            const sets = status === 'approved' ? readSets(req.body?.sets) : readSets(json(inv.sets, {}));
            if (status === 'approved' && setsTotal(sets) <= 0) return res.status(400).json({ error: 'Enter the sets on this invoice' });
            const by = (req as any).user?.id ?? null;
            await db.execute(
                `UPDATE scheme_buy_invoices SET status = ?, sets = ?, review_note = ?, reviewed_by = ?, reviewed_at = ${status === 'pending' ? 'NULL' : 'NOW()'} WHERE id = ?`,
                [status, JSON.stringify(sets), status === 'rejected' ? note : null, status === 'pending' ? null : by, inv.id]
            );
            log(req, 'SCHEME_BUY_INVOICE_REVIEWED', scheme, { invoice_id: inv.id, status, sets, was: json(inv.sets, {}), note });
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] buy more invoice:', error);
            res.status(500).json({ error: 'Could not update the invoice' });
        }
    }

    /**
     * Approve a redeem request, which uses up the sets (the admin may change how
     * many) and leaves the rest as balance; reject it with a reason; or undo.
     */
    static async adminDistributorStores(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const [[dist]]: any = await db.execute('SELECT id, name FROM distributors WHERE id = ?', [req.params.distributorId]);
            if (!dist) return res.status(404).json({ error: 'Distributor not found' });
            const [rows]: any = await db.execute(
                `SELECT vd.id AS store_id, vd.store_name, vd.store_code, vd.city, sp.terms, fd.supplies_sam,
                        (SELECT GROUP_CONCAT(d2.name ORDER BY d2.name SEPARATOR '||') FROM franchise_distributors f2 JOIN distributors d2 ON d2.id = f2.distributor_id
                          WHERE f2.franchise_user_id = fd.franchise_user_id AND f2.distributor_id <> fd.distributor_id) AS others,
                        EXISTS(SELECT 1 FROM scheme_distributor_stores sds WHERE sds.scheme_id = sp.scheme_id AND sds.distributor_id = fd.distributor_id AND sds.store_id = vd.id) AS shown
                   FROM franchise_distributors fd
                   JOIN vendor_details vd ON vd.user_id = fd.franchise_user_id
                   JOIN scheme_participants sp ON sp.store_id = vd.id AND sp.scheme_id = ?
                  WHERE fd.distributor_id = ? ORDER BY vd.store_name`,
                [scheme.id, dist.id]
            );
            const stores = rows.filter((r: any) => optionOf(json<any>(r.terms, {})) === 'buy_more')
                .map((r: any) => ({ store_id: String(r.store_id), store_name: String(r.store_name ?? '').trim(), store_code: r.store_code ?? null, city: r.city ?? null, shown: Boolean(r.shown), sam: Boolean(r.supplies_sam), others: r.others ? String(r.others).split('||') : [] }));
            res.json({ success: true, distributor: dist.name, can_add: await distributorMayAdd(scheme.id, dist.id), stores });
        } catch (error: any) {
            console.error('[Schemes] distributor stores:', error);
            res.status(500).json({ error: 'Could not load the stores' });
        }
    }

    /** Sets which of a distributor's Buy More stores it sees, and whether it may add invoices. */
    static async adminDistributorStoresSave(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const [[dist]]: any = await db.execute('SELECT id, name FROM distributors WHERE id = ?', [req.params.distributorId]);
            if (!dist) return res.status(404).json({ error: 'Distributor not found' });
            const wanted: string[] = Array.isArray(req.body?.store_ids) ? req.body.store_ids.map(String) : [];
            const canAdd = req.body?.can_add === undefined ? true : Boolean(req.body.can_add);
            /* Only stores that are this distributor's and on Option 2 can be switched on. */
            const [rows]: any = await db.execute(
                `SELECT vd.id AS store_id, sp.terms FROM franchise_distributors fd
                   JOIN vendor_details vd ON vd.user_id = fd.franchise_user_id
                   JOIN scheme_participants sp ON sp.store_id = vd.id AND sp.scheme_id = ?
                  WHERE fd.distributor_id = ?`, [scheme.id, dist.id]);
            const allowed = new Set<string>(rows.filter((r: any) => optionOf(json<any>(r.terms, {})) === 'buy_more').map((r: any) => String(r.store_id)));
            const ids = [...new Set(wanted)].filter(id => allowed.has(id));
            const conn = await (db as any).getConnection();
            try {
                await conn.beginTransaction();
                await conn.execute('DELETE FROM scheme_distributor_stores WHERE scheme_id = ? AND distributor_id = ?', [scheme.id, dist.id]);
                for (const id of ids) await conn.execute('INSERT INTO scheme_distributor_stores (scheme_id, distributor_id, store_id) VALUES (?, ?, ?)', [scheme.id, dist.id, id]);
                await conn.execute(
                    'INSERT INTO scheme_distributor_access (scheme_id, distributor_id, can_add) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE can_add = VALUES(can_add)',
                    [scheme.id, dist.id, canAdd ? 1 : 0]);
                await conn.commit();
            } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
            log(req, 'SCHEME_BUY_DISTRIBUTOR_STORES', scheme, { distributor_id: dist.id, distributor: dist.name, stores: ids.length, can_add: canAdd });
            res.json({ success: true, shown: ids.length });
        } catch (error: any) {
            console.error('[Schemes] distributor stores save:', error);
            res.status(500).json({ error: 'Could not save' });
        }
    }

    static async adminBuyMoreFreeSet(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id)) return res.status(404).json({ error: 'Scheme not found' });
            const status = String(req.body?.status ?? '');
            if (!['approved', 'rejected', 'requested'].includes(status)) return res.status(400).json({ error: 'Pick a status' });
            const note = status === 'requested' ? null : String(req.body?.note ?? '').trim().slice(0, 500) || null;
            if (status === 'rejected' && !note) return res.status(400).json({ error: 'Give a reason; the store sees it' });
            const [[claim]]: any = await db.execute('SELECT id, store_id, status FROM scheme_free_sets WHERE id = ? AND scheme_id = ?', [req.params.claimId, scheme.id]);
            if (!claim) return res.status(404).json({ error: 'Not found' });
            let used: Sets | null = null;
            if (status === 'approved') {
                const mine = await buyMoreForStore(scheme, String(claim.store_id));
                used = readSets(req.body?.used);
                const problem = usedProblem(used, mine.available);
                if (problem) return res.status(400).json({ error: problem });
            }
            const by = (req as any).user?.id ?? null;
            await db.execute(
                `UPDATE scheme_free_sets SET status = ?, used = ?, note = ?, sent_at = ${status === 'approved' ? 'NOW()' : 'NULL'}, sent_by = ? WHERE id = ?`,
                [status, used ? JSON.stringify(used) : null, note, status === 'requested' ? null : by, claim.id]
            );
            log(req, 'SCHEME_BUY_REWARD_REVIEWED', scheme, { claim_id: claim.id, store_id: String(claim.store_id), status, used, note });
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] buy reward:', error);
            res.status(500).json({ error: 'Could not update the request' });
        }
    }

    static async adminList(_req: Request, res: Response) {
        try {
            const [rows]: any = await db.execute(
                `SELECT s.*,
                        (SELECT COUNT(*) FROM scheme_participants p WHERE p.scheme_id = s.id) AS participants,
                        (SELECT COUNT(*) FROM scheme_entries e WHERE e.scheme_id = s.id AND e.status = 'pending') AS pending,
                        (SELECT COUNT(*) FROM scheme_entries e WHERE e.scheme_id = s.id) AS entries,
                        (SELECT COALESCE(SUM(e.score), 0) FROM scheme_entries e WHERE e.scheme_id = s.id AND e.status = 'approved') AS approved_points
                   FROM schemes s WHERE s.deleted_at IS NULL
                  ORDER BY s.starts_on DESC, s.created_at DESC`
            );
            /* Entries per day over the last 30 days, for each scheme's trend line.
               created_at already reads in IST (the pool's session zone). */
            const [daily]: any = await db.execute(
                `SELECT scheme_id, DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS n
                   FROM scheme_entries WHERE created_at >= CURDATE() - INTERVAL 29 DAY
                  GROUP BY scheme_id, day`
            );
            const trend = new Map<string, Record<string, number>>();
            for (const d of daily) {
                const m = trend.get(String(d.scheme_id)) ?? {};
                m[d.day] = Number(d.n);
                trend.set(String(d.scheme_id), m);
            }
            res.json({
                success: true,
                schemes: rows.map((r: any) => ({
                    ...readScheme(r),
                    participants: Number(r.participants), pending: Number(r.pending), entries: Number(r.entries),
                    approved_points: Number(r.approved_points), daily: trend.get(String(r.id)) ?? {},
                })),
            });
        } catch (error: any) {
            console.error('[Schemes] admin list:', error);
            res.status(500).json({ error: 'Could not load schemes' });
        }
    }

    static async adminGet(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });

            const [entries]: any = await db.execute(
                'SELECT * FROM scheme_entries WHERE scheme_id = ? ORDER BY created_at DESC LIMIT 2000', [scheme.id]
            );
            const [participants]: any = await db.execute(
                'SELECT store_id, joined_at FROM scheme_participants WHERE scheme_id = ? ORDER BY joined_at', [scheme.id]
            );
            const [adjustments]: any = await db.execute(
                'SELECT * FROM scheme_adjustments WHERE scheme_id = ? ORDER BY created_at DESC', [scheme.id]
            );
            const [payouts]: any = await db.execute('SELECT * FROM scheme_payouts WHERE scheme_id = ?', [scheme.id]);
            const board = await schemeStandings(scheme);
            /* Every verified franchise that has not joined, and whether the scheme is open to it. */
            const joinedIds = new Set(participants.map((p: any) => String(p.store_id)));
            const [franchises]: any = await db.execute(
                `SELECT vd.id, vd.store_code, vd.store_name, vd.city, vd.state, vd.allowed_brands
                   FROM vendor_details vd
                   JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1
                  WHERE vd.is_franchise = 1 ORDER BY vd.store_name`
            );
            const notJoined = franchises.filter((f: any) => !joinedIds.has(String(f.id))).map((f: any) => ({
                store_id: String(f.id), store_code: f.store_code ?? null, store_name: String(f.store_name ?? '').trim(),
                city: f.city ?? null, state: f.state ?? null,
                can_see: isEligible(scheme.eligibility, { id: String(f.id), state: f.state, allowed_brands: f.allowed_brands }),
            }));

            const ids = [...new Set([
                ...entries.map((e: any) => String(e.store_id)),
                ...participants.map((p: any) => String(p.store_id)),
                ...board.map(b => b.store_id),
            ])];
            const stores = await storesById(ids);
            const name = (id: string) => stores.get(id)?.name ?? 'Store (removed)';
            const paid = new Map(payouts.map((p: any) => [String(p.store_id), p]));

            res.json({
                success: true,
                scheme,
                participants: participants.map((p: any) => ({
                    store_id: String(p.store_id), store_name: name(String(p.store_id)),
                    city: stores.get(String(p.store_id))?.city ?? null, state: stores.get(String(p.store_id))?.state ?? null, joined_at: p.joined_at,
                })),
                not_joined: notJoined,
                entries: entries.map((e: any) => ({
                    id: e.id, store_id: String(e.store_id), store_name: name(String(e.store_id)),
                    city: stores.get(String(e.store_id))?.city ?? null, state: stores.get(String(e.store_id))?.state ?? null,
                    answers: json(e.answers, {}), files: json(e.files, {}),
                    score: Number(e.score), lines: json(e.lines, null), claimed_lines: json(e.claimed_lines, null),
                    source: e.source || 'store', invoice_no: e.invoice_no ?? null, invoices: json(e.invoices, null),
                    status: e.status, review_note: e.review_note,
                    reviewed_at: e.reviewed_at, created_at: e.created_at, edits: json(e.edits, []),
                })),
                adjustments: adjustments.map((a: any) => ({
                    id: a.id, store_id: String(a.store_id), store_name: name(String(a.store_id)),
                    points: Number(a.points), note: a.note, created_at: a.created_at,
                })),
                leaderboard: board.map(b => {
                    const p: any = paid.get(b.store_id);
                    return {
                        ...b, store_name: name(b.store_id),
                        city: stores.get(b.store_id)?.city ?? null, state: stores.get(b.store_id)?.state ?? null,
                        paid_at: p?.paid_at ?? null, payout_note: p?.note ?? null,
                        delivery: p?.delivery ?? null, dispatched_at: p?.dispatched_at ?? null, delivered_at: p?.delivered_at ?? null,
                        months: monthlyPoints([
                            ...entries.filter((e: any) => String(e.store_id) === b.store_id).map((e: any) => ({ created_at: e.created_at, score: Number(e.score), status: e.status })),
                            ...adjustments.filter((a: any) => String(a.store_id) === b.store_id).map((a: any) => ({ created_at: a.created_at, score: Number(a.points), status: 'approved' })),
                        ]),
                    };
                }),
            });
        } catch (error: any) {
            console.error('[Schemes] admin get:', error);
            res.status(500).json({ error: 'Could not load the scheme' });
        }
    }

    /** Create, or update when an id is given. `publish: true` publishes after saving. */
    static async adminSave(req: Request, res: Response) {
        try {
            const id = req.params.id;
            const s = schemeFromBody(req.body ?? {});
            const existing = id ? await loadScheme(id) : null;
            if (id && !existing) return res.status(404).json({ error: 'Scheme not found' });
            if (existing && existing.status !== 'draft' && existing.settings.run !== s.settings.run) {
                return res.status(400).json({ error: 'A published scheme keeps the way it runs. Copy it to run it the other way.' });
            }
            /* A target scheme is for the franchises the admin adds to it: no store
               submits, nothing is scored from entries, and its eligibility is
               the list of those franchises (so every store screen reads it as
               before). */
            if (s.settings.run === 'targets') {
                s.fields = []; s.score = { mode: 'none' }; s.rewards = { mode: 'none' }; s.clubs = [];
                s.eligibility = { mode: 'stores', store_ids: existing?.settings.run === 'targets' ? existing.eligibility.store_ids ?? [] : [], brand: null };
            }
            /* A target scheme gets its stores after it is saved, from its own page. */
            const problems = [...schemeProblems(s), ...settingsProblems(s.settings)]
                .filter(p => !(s.settings.run === 'targets' && p === 'Pick at least one store'));
            if (problems.length) return res.status(400).json({ error: problems[0], problems });

            const span = windowSpan(s.windows);

            const cols = {
                title: s.title, category: s.category, summary: s.summary, banner_url: s.banner_url,
                instructions: s.instructions, terms: s.terms,
                starts_on: span!.starts_on, ends_on: span!.ends_on, submit_until: null, windows: JSON.stringify(s.windows),
                eligibility: JSON.stringify(s.eligibility), fields: JSON.stringify(s.fields),
                entries_per_store: s.entries_per_store, score_rule: JSON.stringify(s.score),
                rewards: JSON.stringify(s.rewards), leaderboard: JSON.stringify(s.leaderboard), clubs: JSON.stringify(s.clubs),
                contact: s.contact ? JSON.stringify(s.contact) : null,
                settings: JSON.stringify(s.settings),
            };
            const schemeId = id ?? uuidv4();
            if (existing) {
                await db.execute(
                    `UPDATE schemes SET ${Object.keys(cols).map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
                    [...Object.values(cols), schemeId]
                );
            } else {
                await db.execute(
                    `INSERT INTO schemes (id, ${Object.keys(cols).join(', ')}, status, created_by)
                     VALUES (?, ${Object.keys(cols).map(() => '?').join(', ')}, 'draft', ?)`,
                    [schemeId, ...Object.values(cols), (req as any).user?.id ?? null]
                );
            }
            log(req, existing ? 'SCHEME_UPDATED' : 'SCHEME_CREATED', { id: schemeId, title: s.title });

            let notified: number | null = null;
            if (req.body?.publish && (!existing || existing.status === 'draft')) {
                await db.execute("UPDATE schemes SET status = 'published', published_at = NOW() WHERE id = ?", [schemeId]);
                const saved = (await loadScheme(schemeId))!;
                notified = await announce(saved);
                log(req, 'SCHEME_PUBLISHED', saved, { notified });
            }
            res.json({ success: true, scheme: await loadScheme(schemeId), notified });
        } catch (error: any) {
            console.error('[Schemes] save:', error);
            res.status(500).json({ error: 'Could not save the scheme' });
        }
    }

    static async adminPublish(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
            if (scheme.status !== 'draft') return res.status(400).json({ error: 'Only a draft can be published' });
            const problems = [...schemeProblems({ ...scheme, score: scheme.score_rule }), ...settingsProblems(scheme.settings)]
                .map(p => (scheme.settings.run === 'targets' && p === 'Pick at least one store' ? 'Add at least one franchise before publishing' : p));
            if (problems.length) return res.status(400).json({ error: problems[0], problems });
            await db.execute("UPDATE schemes SET status = 'published', published_at = NOW() WHERE id = ?", [scheme.id]);
            const saved = (await loadScheme(scheme.id))!;
            const notified = await announce(saved);
            log(req, 'SCHEME_PUBLISHED', saved, { notified });
            res.json({ success: true, scheme: saved, notified });
        } catch (error: any) {
            console.error('[Schemes] publish:', error);
            res.status(500).json({ error: 'Could not publish the scheme' });
        }
    }

    /** End now: closes it early. Entries stop; standings and payouts stay. */
    static async adminEnd(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
            await db.execute("UPDATE schemes SET status = 'ended' WHERE id = ?", [scheme.id]);
            log(req, 'SCHEME_ENDED', scheme);
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] end:', error);
            res.status(500).json({ error: 'Could not end the scheme' });
        }
    }

    /** A copy as a new draft — the usual way to run last month's scheme again. */
    static async adminCopy(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
            const id = uuidv4();
            await db.execute(
                `INSERT INTO schemes (id, title, category, summary, banner_url, instructions, terms, starts_on, ends_on,
                                      submit_until, windows, eligibility, fields, entries_per_store, score_rule, rewards, leaderboard, clubs, contact, settings,
                                      status, created_by)
                 SELECT ?, CONCAT('Copy of ', title), category, summary, banner_url, instructions, terms, starts_on, ends_on,
                        submit_until, windows, eligibility, fields, entries_per_store, score_rule, rewards, leaderboard, clubs, contact, settings, 'draft', ?
                   FROM schemes WHERE id = ?`,
                [id, (req as any).user?.id ?? null, scheme.id]
            );
            /* A target scheme's copy keeps its franchises and their own steps; the targets start empty. */
            if (scheme.settings.run === 'targets') {
                await db.execute(
                    'INSERT INTO scheme_participants (scheme_id, store_id, terms) SELECT ?, store_id, terms FROM scheme_participants WHERE scheme_id = ?',
                    [id, scheme.id]
                );
            }
            log(req, 'SCHEME_COPIED', scheme, { copy: id });
            res.json({ success: true, scheme: await loadScheme(id) });
        } catch (error: any) {
            console.error('[Schemes] copy:', error);
            res.status(500).json({ error: 'Could not copy the scheme' });
        }
    }

    /** Removed from every list; its entries are kept, so nothing a store sent is lost. */
    static async adminDelete(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
            await db.execute('UPDATE schemes SET deleted_at = NOW() WHERE id = ?', [scheme.id]);
            log(req, 'SCHEME_DELETED', scheme);
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] delete:', error);
            res.status(500).json({ error: 'Could not delete the scheme' });
        }
    }

    static async adminBanner(req: Request, res: Response) {
        const file = (req as any).file;
        if (!file) return res.status(400).json({ error: 'No image uploaded' });
        if (!/^image\//.test(file.mimetype)) return res.status(400).json({ error: 'The banner must be an image' });
        res.json({ success: true, url: file.path });
    }

    /** Approve or reject an entry; on approval the admin may correct its score. */
    static async adminReview(req: Request, res: Response) {
        try {
            const { status, score, note } = req.body ?? {};
            if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'Status must be approved, rejected or pending' });
            const [[entry]]: any = await db.execute('SELECT * FROM scheme_entries WHERE id = ?', [req.params.entryId]);
            if (!entry) return res.status(404).json({ error: 'Entry not found' });
            const scheme = await loadScheme(entry.scheme_id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
            if (status === 'rejected' && !String(note ?? '').trim()) return res.status(400).json({ error: 'Say why it was rejected — the store sees this' });
            /* The invoice numbers read off the invoices: one invoice is approved once per store. */
            let invoiceNo: string | null = req.body?.invoice_no === undefined ? entry.invoice_no : String(req.body.invoice_no ?? '').trim().slice(0, 80) || null;
            let invoices: ReturnType<typeof invoicesScore>['invoices'] | null = json(entry.invoices, null);
            let byInvoice: ReturnType<typeof invoicesScore> | null = null;
            if (status === 'approved' && scheme.score_rule.mode === 'products' && Array.isArray(req.body?.invoices)) {
                byInvoice = invoicesScore(scheme.score_rule.products, req.body.invoices as InvoiceIn[]);
                if (byInvoice.problems.length) return res.status(400).json({ error: byInvoice.problems[0], problems: byInvoice.problems });
                invoices = byInvoice.invoices;
                invoiceNo = byInvoice.invoices.map(i => i.invoice_no).join(', ').slice(0, 80);
            }
            if (status === 'approved') {
                const nos = invoices?.length ? invoices.map(i => i.invoice_no) : invoiceNo ? [invoiceNo] : [];
                const dup = await alreadyCounted(scheme.id, String(entry.store_id), { invoiceNos: nos, except: entry.id });
                if (dup) return res.status(409).json({ error: dup, problems: [dup] });
            }

            let newScore = score === undefined || score === null || score === '' ? Number(entry.score) : Number(score);
            let lines: ReturnType<typeof linesScore>['lines'] | null = json(entry.lines, null);
            if (byInvoice) {
                newScore = byInvoice.score;
                lines = byInvoice.lines;
            } else if (status === 'approved' && scheme.score_rule.mode === 'products') {
                invoices = null;                        // approved as one total: no per-invoice breakdown
                const given: EntryLine[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
                const r = linesScore(scheme.score_rule.products, given);
                if (r.problems.length) return res.status(400).json({ error: r.problems[0], problems: r.problems });
                newScore = r.score;
                lines = r.lines;
            }
            if (!Number.isFinite(newScore) || newScore < 0) return res.status(400).json({ error: 'The score must be a number' });

            await db.execute(
                `UPDATE scheme_entries SET status = ?, score = ?, \`lines\` = ?, invoice_no = ?, invoices = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
                [status, newScore, lines ? JSON.stringify(lines) : null, invoiceNo, invoices ? JSON.stringify(invoices) : null, String(note ?? '').trim().slice(0, 500) || null, (req as any).user?.id ?? null, entry.id]
            );
            log(req, 'SCHEME_ENTRY_REVIEWED', scheme, { entry: entry.id, status, score: newScore });

            const [[store]]: any = await db.execute('SELECT user_id FROM vendor_details WHERE id = ?', [entry.store_id]);
            if (store?.user_id && status !== 'pending' && process.env.DISABLE_SCHEDULERS !== '1') {
                NotificationService.notify(store.user_id, {
                    title: status === 'approved' ? `Entry approved — ${scheme.title}` : `Entry not approved — ${scheme.title}`,
                    message: status === 'approved' ? `Your entry was approved${scheme.score_rule.mode !== 'none' ? ` (${newScore})` : ''}.` : String(note).trim(),
                    type: 'scheme',
                    metadata: { scheme_id: scheme.id, entry_id: entry.id },
                }).catch(() => undefined);
            }
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] review:', error);
            res.status(500).json({ error: 'Could not save the review' });
        }
    }

    /** Points added or taken away by hand, with a note — for things settled outside the app. */
    static async adminAdjust(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
            const points = Number(req.body?.points);
            const storeId = String(req.body?.store_id ?? '');
            const note = String(req.body?.note ?? '').trim();
            if (!storeId || !Number.isFinite(points) || points === 0) return res.status(400).json({ error: 'Pick a store and the points to add or remove' });
            if (!note) return res.status(400).json({ error: 'Add a note saying why' });
            await db.execute(
                'INSERT INTO scheme_adjustments (id, scheme_id, store_id, points, note, created_by) VALUES (?, ?, ?, ?, ?, ?)',
                [uuidv4(), scheme.id, storeId, points, note.slice(0, 300), (req as any).user?.id ?? null]
            );
            log(req, 'SCHEME_ADJUSTED', scheme, { store_id: storeId, points });
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] adjust:', error);
            res.status(500).json({ error: 'Could not save the adjustment' });
        }
    }

    static async adminPayout(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
            const storeId = String(req.params.storeId);
            const paid = Boolean(req.body?.paid);
            const note = String(req.body?.note ?? '').trim().slice(0, 300) || null;
            const reward = String(req.body?.reward ?? '').slice(0, 160) || null;
            const delivery = ['dispatched', 'delivered'].includes(req.body?.delivery) ? req.body.delivery : null;
            if (req.body?.delivery !== undefined) {
                await db.execute(
                    `INSERT INTO scheme_payouts (scheme_id, store_id, reward, delivery, dispatched_at, delivered_at)
                     VALUES (?, ?, ?, ?, ${delivery ? 'NOW()' : 'NULL'}, ${delivery === 'delivered' ? 'NOW()' : 'NULL'})
                     ON DUPLICATE KEY UPDATE reward = COALESCE(VALUES(reward), reward), delivery = VALUES(delivery),
                         dispatched_at = ${delivery ? 'COALESCE(dispatched_at, NOW())' : 'NULL'},
                         delivered_at = ${delivery === 'delivered' ? 'COALESCE(delivered_at, NOW())' : 'NULL'}`,
                    [scheme.id, storeId, reward, delivery]
                );
                log(req, 'SCHEME_DELIVERY', scheme, { store_id: storeId, delivery });
                return res.json({ success: true });
            }
            await db.execute(
                `INSERT INTO scheme_payouts (scheme_id, store_id, reward, note, paid_at, paid_by)
                 VALUES (?, ?, ?, ?, ${paid ? 'NOW()' : 'NULL'}, ?)
                 ON DUPLICATE KEY UPDATE reward = VALUES(reward), note = VALUES(note),
                                         paid_at = ${paid ? 'NOW()' : 'NULL'}, paid_by = VALUES(paid_by)`,
                [scheme.id, storeId, reward, note, paid ? (req as any).user?.id ?? null : null]
            );
            log(req, paid ? 'SCHEME_PAID' : 'SCHEME_UNPAID', scheme, { store_id: storeId, reward });
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] payout:', error);
            res.status(500).json({ error: 'Could not save the payout' });
        }
    }

    /**
     * Products an admin can put points on: the warranty products, and the
     * product catalogue (B2B, with its brand). Ids are prefixed by source —
     * "w:12", "c:40" — so a scheme's product list says where each came from.
     */
    static async adminProducts(_req: Request, res: Response) {
        try {
            const [warranty]: any = await db.execute('SELECT id, name, type, brand FROM products ORDER BY name');
            const [catalogue]: any = await db.execute(
                'SELECT id, name, brand, product_code FROM store_products WHERE is_active = 1 ORDER BY name'
            );
            res.json({
                success: true,
                warranty: warranty.map((p: any) => ({ id: `w:${p.id}`, name: String(p.name).trim(), group: p.type ? String(p.type).replace(/_/g, ' ') : null, brand: p.brand ?? null })),
                catalogue: catalogue.map((p: any) => ({ id: `c:${p.id}`, name: String(p.name).trim(), group: p.brand || null, code: p.product_code || null })),
            });
        } catch (error: any) {
            console.error('[Schemes] products:', error);
            res.status(500).json({ error: 'Could not load products' });
        }
    }

    /** Stores to pick from when a scheme is for named stores. */
    static async adminStores(_req: Request, res: Response) {
        try {
            const [rows]: any = await db.execute(
                `SELECT vd.id, vd.store_name, vd.city, vd.state, vd.allowed_brands
                   FROM vendor_details vd
                   JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1
                  WHERE vd.is_franchise = 1 ORDER BY vd.store_name`
            );
            res.json({ success: true, stores: rows.map((r: any) => ({ ...r, id: String(r.id) })) });
        } catch (error: any) {
            console.error('[Schemes] stores:', error);
            res.status(500).json({ error: 'Could not load stores' });
        }
    }

    /**
     * An entry added by the admin for a store — an invoice phoned or mailed
     * in, or a past month. Approved straight away, outside the windows; the
     * store is joined if it was not. `date` (YYYY-MM-DD) dates it, at noon IST.
     */
    /** The distributors a store can name, for correcting a distributor answer. */
    static async adminDistributors(req: Request, res: Response) {
        try {
            const [[store]]: any = await db.execute('SELECT user_id, state FROM vendor_details WHERE id = ?', [String(req.query.store_id ?? '')]);
            res.json({ success: true, distributors: store ? await distributorChoices(store) : [] });
        } catch (error: any) {
            console.error('[Schemes] distributors:', error);
            res.status(500).json({ error: 'Could not load distributors' });
        }
    }

    /**
     * Head office correcting an entry: the store's answers, its files, or the
     * store it is under. The review (status, points from products) is left as
     * it was; a score worked out from a field is worked out again. What
     * changed is kept on the entry and in the activity log.
     */
    static async adminCorrectEntry(req: Request, res: Response) {
        try {
            const [[entry]]: any = await db.execute('SELECT * FROM scheme_entries WHERE id = ?', [req.params.entryId]);
            if (!entry) return res.status(404).json({ error: 'Entry not found' });
            const scheme = await loadScheme(entry.scheme_id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });

            const fromStore = String(entry.store_id);
            const toStore = String(req.body?.store_id ?? '').trim() || fromStore;
            const names = new Map<string, string>();
            const [stores]: any = await db.execute('SELECT id, store_name FROM vendor_details WHERE id IN (?, ?)', [fromStore, toStore]);
            for (const s of stores) names.set(String(s.id), s.store_name);
            if (!names.has(toStore)) return res.status(400).json({ error: 'Pick the store' });

            const before = { answers: json<Record<string, string>>(entry.answers, {}), files: json<Record<string, EntryFile[]>>(entry.files, {}), store_id: fromStore };
            const added = uploadedFiles(req);
            const r = correctEntry(scheme.fields, before, {
                answers: json<Record<string, unknown>>(req.body?.answers, {}),
                remove: json<string[]>(req.body?.remove, []),
                added, store_id: toStore,
                store_names: { from: names.get(fromStore) ?? 'the store', to: names.get(toStore) ?? 'another store' },
            });
            /* Only what this correction breaks is refused: an entry added by
               head office without every field can still be corrected. */
            const was = new Set(entryProblems(scheme.fields, before.answers, before.files));
            const problems = [...r.problems, ...entryProblems(scheme.fields, r.answers, r.files).filter(p => !was.has(p))];
            if (problems.length) return res.status(400).json({ error: problems[0], problems });

            /* Points on an approved entry: the products read off its invoices
               (invoice by invoice when it was approved that way), or the score. */
            const rule = scheme.score_rule;
            const pts = json<{ lines?: EntryLine[]; invoices?: InvoiceIn[]; score?: unknown } | null>(req.body?.points, null);
            let score = entry.status === 'approved' && (rule.mode === 'sum' || rule.mode === 'count') ? entryScore(rule, r.answers) : Number(entry.score);
            let lines = json<ReturnType<typeof linesScore>['lines'] | null>(entry.lines, null);
            let invoices = json<ReturnType<typeof invoicesScore>['invoices'] | null>(entry.invoices, null);
            let invoiceNo: string | null = entry.invoice_no ?? null;
            const said = (ls: { name: string; qty: number }[] | null) => (ls ?? []).map(l => `${l.name} × ${l.qty}`).join(', ') || 'none';
            if (pts) {
                if (entry.status !== 'approved') return res.status(400).json({ error: 'Points are set when the entry is approved: approve it from the review' });
                if (rule.mode === 'products' && Array.isArray(pts.invoices)) {
                    const b = invoicesScore(rule.products, pts.invoices);
                    if (b.problems.length) return res.status(400).json({ error: b.problems[0], problems: b.problems });
                    if (JSON.stringify(b.invoices.map(i => [i.invoice_no, i.lines.map(l => [l.product_id, l.qty])])) !== JSON.stringify((invoices ?? []).map(i => [i.invoice_no, i.lines.map(l => [l.product_id, l.qty])]))) {
                        b.invoices.forEach((inv, i) => {
                            const was = invoices?.[i];
                            if (!was || was.invoice_no !== inv.invoice_no || said(was.lines) !== said(inv.lines)) r.changes.push(`Invoice ${inv.invoice_no}: ${was ? said(was.lines) : 'new'} → ${said(inv.lines)}`);
                        });
                    }
                    score = b.score; lines = b.lines; invoices = b.invoices;
                    invoiceNo = b.invoices.map(i => i.invoice_no).join(', ').slice(0, 80);
                } else if (rule.mode === 'products') {
                    const b = linesScore(rule.products, Array.isArray(pts.lines) ? pts.lines : []);
                    if (b.problems.length) return res.status(400).json({ error: b.problems[0], problems: b.problems });
                    if (said(b.lines) !== said(lines)) r.changes.push(`Products: ${said(lines)} → ${said(b.lines)}`);
                    score = b.score; lines = b.lines;
                } else if (rule.mode !== 'none') {
                    const n = Number(pts.score);
                    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'The score must be a number' });
                    score = n;
                }
            }
            if (score !== Number(entry.score)) r.changes.push(`Points: ${Number(entry.score)} → ${score}`);
            /* Only what this correction breaks is checked again. */
            if (!r.changes.length) return res.status(400).json({ error: 'Nothing was changed' });

            /* The same invoice still counts once: new files, new invoice numbers, and the whole entry when it moves store. */
            const moved = toStore !== fromStore;
            const nos = entry.status !== 'approved' ? [] : invoices?.length ? invoices.map(i => i.invoice_no) : invoiceNo ? [invoiceNo] : [];
            const dup = await alreadyCounted(scheme.id, toStore, {
                files: moved ? r.files : added,
                invoiceNos: moved || invoiceNo !== (entry.invoice_no ?? null) ? nos : [],
                except: entry.id,
            });
            if (dup) return res.status(409).json({ error: dup, problems: [dup] });
            const admin = (req as any).user;
            const edit: EntryEdit = {
                at: new Date().toISOString(), by: admin?.id ?? null, by_name: admin?.name ?? null,
                changes: r.changes, note: String(req.body?.note ?? '').trim().slice(0, 500) || null,
            };
            if (moved && !edit.note) return res.status(400).json({ error: 'Say why the entry is moving to another store' });

            if (moved) await db.execute('INSERT IGNORE INTO scheme_participants (scheme_id, store_id) VALUES (?, ?)', [scheme.id, toStore]);
            await db.execute(
                'UPDATE scheme_entries SET store_id = ?, answers = ?, files = ?, score = ?, `lines` = ?, invoices = ?, invoice_no = ?, edits = ? WHERE id = ?',
                [toStore, JSON.stringify(r.answers), JSON.stringify(r.files), score, lines ? JSON.stringify(lines) : null,
                 invoices ? JSON.stringify(invoices) : null, invoiceNo, JSON.stringify([...json<EntryEdit[]>(entry.edits, []), edit]), entry.id]
            );
            log(req, 'SCHEME_ENTRY_CORRECTED', scheme, { entry: entry.id, store_id: toStore, ...(moved ? { from_store: fromStore } : {}), changes: r.changes, note: edit.note });
            res.json({ success: true, changes: r.changes });
        } catch (error: any) {
            console.error('[Schemes] correct entry:', error);
            res.status(500).json({ error: 'Could not save the correction' });
        }
    }

    /**
     * A wrong entry taken off the scheme — a duplicate, or one sent by
     * mistake. The reason and the whole entry are kept in the activity log.
     */
    static async adminDeleteEntry(req: Request, res: Response) {
        try {
            const reason = String(req.body?.reason ?? '').trim().slice(0, 500);
            if (reason.length < 3) return res.status(400).json({ error: 'Say why the entry is being deleted' });
            const [[entry]]: any = await db.execute('SELECT * FROM scheme_entries WHERE id = ?', [req.params.entryId]);
            if (!entry) return res.status(404).json({ error: 'Entry not found' });
            const scheme = await loadScheme(entry.scheme_id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
            await db.execute('DELETE FROM scheme_entries WHERE id = ?', [entry.id]);
            log(req, 'SCHEME_ENTRY_DELETED', scheme, {
                reason, entry: {
                    ...entry, answers: json(entry.answers, {}), files: json(entry.files, {}), lines: json(entry.lines, null),
                    claimed_lines: json(entry.claimed_lines, null), invoices: json(entry.invoices, null), edits: json(entry.edits, []),
                },
            });
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] delete entry:', error);
            res.status(500).json({ error: 'Could not delete the entry' });
        }
    }

    static async adminAddEntry(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
            const storeId = String(req.body?.store_id ?? '');
            const [[store]]: any = await db.execute('SELECT id FROM vendor_details WHERE id = ?', [storeId]);
            if (!store) return res.status(400).json({ error: 'Pick the store' });
            const date = String(req.body?.date ?? '').slice(0, 10);
            if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'The date is not valid' });

            const answers = json<Record<string, unknown>>(req.body?.answers, {});
            const files = uploadedFiles(req);
            const dup = await alreadyCounted(scheme.id, storeId, { files, invoiceNos: [String(req.body?.invoice_no ?? '')] });
            if (dup) return res.status(409).json({ error: dup, problems: [dup] });
            const clean: Record<string, string> = {};
            for (const f of scheme.fields) if (f.type !== 'file' && answers[f.id] !== undefined) clean[f.id] = String(answers[f.id]).trim();

            let score = Number(req.body?.score ?? entryScore(scheme.score_rule, clean));
            let lines: ReturnType<typeof linesScore>['lines'] | null = null;
            if (scheme.score_rule.mode === 'products') {
                const r = linesScore(scheme.score_rule.products, json<EntryLine[]>(req.body?.lines, []));
                if (r.problems.length) return res.status(400).json({ error: r.problems[0], problems: r.problems });
                score = r.score; lines = r.lines;
            }
            if (!Number.isFinite(score) || score < 0) return res.status(400).json({ error: 'The score must be a number' });

            const id = uuidv4();
            await db.execute('INSERT IGNORE INTO scheme_participants (scheme_id, store_id) VALUES (?, ?)', [scheme.id, storeId]);
            await db.execute(
                `INSERT INTO scheme_entries (id, scheme_id, store_id, answers, files, score, \`lines\`, status, source, invoice_no, reviewed_by, reviewed_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 'admin', ?, ?, NOW(), ${date ? '?' : 'NOW()'})`,
                [id, scheme.id, storeId, JSON.stringify(clean), JSON.stringify(files), score, lines ? JSON.stringify(lines) : null,
                 String(req.body?.invoice_no ?? '').trim().slice(0, 80) || null, (req as any).user?.id ?? null, ...(date ? [`${date} 12:00:00`] : [])]
            );
            log(req, 'SCHEME_ENTRY_ADDED', scheme, { entry: id, store_id: storeId, score, date: date || null });
            res.json({ success: true, id });
        } catch (error: any) {
            console.error('[Schemes] add entry:', error);
            res.status(500).json({ error: 'Could not add the entry' });
        }
    }

    /**
     * Past months from a sheet: rows of store, date, product, quantity and
     * invoice. `dry_run` reports what would be added and every row that
     * cannot be used; without it, the entries are added, approved, each dated
     * at noon IST on its day. A store-day-invoice already imported is skipped,
     * so the same sheet can be sent twice without counting twice.
     */
    static async adminImport(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
            if (scheme.score_rule.mode !== 'products') return res.status(400).json({ error: 'Importing needs a scheme scored by products' });
            const rows: ImportRow[] = (Array.isArray(req.body?.rows) ? req.body.rows : []).slice(0, 20000).map((r: any, i: number) => ({
                row: Number(r?.row) || i + 2, store: String(r?.store ?? ''), date: r?.date, product: String(r?.product ?? ''),
                qty: r?.qty, invoice: r?.invoice === undefined || r?.invoice === null ? '' : String(r.invoice),
            }));
            if (!rows.length) return res.status(400).json({ error: 'The sheet has no rows' });

            const [storeRows]: any = await db.execute('SELECT id, store_code, store_name, state, allowed_brands FROM vendor_details WHERE is_franchise = 1');
            const eligible = storeRows.filter((r: any) => isEligible(scheme.eligibility, { id: String(r.id), state: r.state, allowed_brands: r.allowed_brands }));
            const plan = planImport(rows, eligible.map((r: any) => ({ id: String(r.id), code: r.store_code, name: r.store_name })), scheme.score_rule.products);
            const names = new Map<string, string>(eligible.map((r: any) => [String(r.id), r.store_name]));
            const keyOf = (e: typeof plan.entries[number]) => `${e.store_id}|${e.day}|${e.invoice ?? ''}`.slice(0, 200);

            const [done]: any = await db.execute('SELECT import_key FROM scheme_entries WHERE scheme_id = ? AND import_key IS NOT NULL', [scheme.id]);
            const already = new Set(done.map((d: any) => d.import_key));
            const summary = plan.entries.map(e => {
                const r = linesScore((scheme.score_rule as any).products, e.lines);
                return { store_id: e.store_id, store_name: names.get(e.store_id) ?? e.store_id, day: e.day, invoice: e.invoice, lines: r.lines, points: r.score, rows: e.rows, duplicate: already.has(keyOf(e)) };
            });

            if (req.body?.dry_run) return res.json({ success: true, dry_run: true, entries: summary, problems: plan.problems });

            let added = 0;
            for (const e of summary) {
                if (e.duplicate) continue;
                await db.execute('INSERT IGNORE INTO scheme_participants (scheme_id, store_id) VALUES (?, ?)', [scheme.id, e.store_id]);
                await db.execute(
                    `INSERT INTO scheme_entries (id, scheme_id, store_id, answers, files, score, \`lines\`, status, source, invoice_no, import_key, reviewed_by, reviewed_at, created_at)
                     VALUES (?, ?, ?, '{}', '{}', ?, ?, 'approved', 'import', ?, ?, ?, NOW(), ?)`,
                    [uuidv4(), scheme.id, e.store_id, e.points, JSON.stringify(e.lines), e.invoice, `${e.store_id}|${e.day}|${e.invoice ?? ''}`.slice(0, 200),
                     (req as any).user?.id ?? null, `${e.day} 12:00:00`]
                );
                added++;
            }
            log(req, 'SCHEME_IMPORTED', scheme, { added, skipped: summary.length - added, problems: plan.problems.length });
            res.json({ success: true, added, skipped: summary.length - added, problems: plan.problems });
        } catch (error: any) {
            console.error('[Schemes] import:', error);
            res.status(500).json({ error: 'Could not import the sheet' });
        }
    }

    /**
     * Sell-through per store and month: units bought on approved invoices
     * against warranties the store registered for the scheme's products in
     * the same month — what it actually sold to customers.
     */
    static async adminSellThrough(req: Request, res: Response) {
        try {
            const scheme = await loadScheme(req.params.id);
            if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
            if (scheme.score_rule.mode !== 'products') return res.json({ success: true, stores: [] });
            const products = scheme.score_rule.products;

            const [entries]: any = await db.execute(
                "SELECT store_id, `lines`, created_at FROM scheme_entries WHERE scheme_id = ? AND status = 'approved'", [scheme.id]
            );
            const bought = new Map<string, { month: string; product_id: string; qty: number }[]>();
            for (const e of entries) {
                const list = bought.get(String(e.store_id)) ?? [];
                for (const l of json<EntryLine[]>(e.lines, [])) list.push({ month: istMonth(e.created_at), product_id: l.product_id, qty: Number(l.qty) || 0 });
                bought.set(String(e.store_id), list);
            }
            const ids = [...bought.keys()];
            if (!ids.length) return res.json({ success: true, stores: [] });

            const [reg]: any = await db.execute(
                `SELECT vendor_details_id AS store_id, DATE_FORMAT(created_at, '%Y-%m') AS month,
                        JSON_UNQUOTE(JSON_EXTRACT(product_details, '$.productName')) AS product, COUNT(*) AS n
                   FROM warranty_registrations
                  WHERE status = 'validated' AND vendor_details_id IN (${ids.map(() => '?').join(',')})
                    AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 MONTH)
                  GROUP BY 1, 2, 3`,
                [...ids, `${scheme.starts_on.slice(0, 7)}-01`, `${scheme.ends_on.slice(0, 7)}-01`]
            );
            const sold = new Map<string, { month: string; product: string; count: number }[]>();
            for (const r of reg) {
                const list = sold.get(String(r.store_id)) ?? [];
                list.push({ month: r.month, product: r.product, count: Number(r.n) });
                sold.set(String(r.store_id), list);
            }
            const stores = await storesById(ids);
            res.json({
                success: true,
                stores: ids.map(id => ({
                    store_id: id, store_name: stores.get(id)?.name ?? id, city: stores.get(id)?.city ?? null, state: stores.get(id)?.state ?? null,
                    months: sellThrough(bought.get(id) ?? [], sold.get(id) ?? [], products),
                })).sort((a, b) => a.store_name.localeCompare(b.store_name)),
            });
        } catch (error: any) {
            console.error('[Schemes] sell-through:', error);
            res.status(500).json({ error: 'Could not work out sell-through' });
        }
    }

    /* ─── Franchise ──────────────────────────────────────────────────────── */

    /** The schemes this store can see: published, for it, and not deleted. */
    static async storeList(req: Request, res: Response) {
        try {
            const store = await myStore(req);
            if (!store) return res.status(404).json({ error: 'Store not found' });
            const [rows]: any = await db.execute(
                "SELECT * FROM schemes WHERE status IN ('published', 'ended') AND deleted_at IS NULL ORDER BY starts_on DESC"
            );
            const mine = rows.map(readScheme).filter((s: Scheme) => canSee(s, store));
            const [joined]: any = await db.execute('SELECT scheme_id FROM scheme_participants WHERE store_id = ?', [store.id]);
            const joinedSet = new Set(joined.map((j: any) => String(j.scheme_id)));

            const out = [];
            for (const s of mine) {
                if (isSellMore(s.id)) {
                    const sm = await sellMoreForStore(s, store.id);
                    const latest = (sm.months as { label: string; points: number; future: boolean }[]).filter(m => !m.future).pop();
                    const buy = (sm as { buy_more?: Awaited<ReturnType<typeof buyMoreForStore>> | null }).buy_more ?? null;
                    out.push({
                        id: s.id, title: s.title, category: s.category, summary: s.summary, banner_url: s.banner_url,
                        starts_on: s.starts_on, ends_on: s.ends_on, windows: s.windows, open_window: null, next_window: null, state: s.state,
                        has_score: false, joined: Boolean(sm.option), achieved: null, run: 'sell_more',
                        sell_more: {
                            opted: Boolean(sm.option), option: sm.option, total: sm.total, month_label: latest?.label ?? null, month_points: latest?.points ?? 0,
                            free_sets: buy?.rewards ?? 0, approved_sets: buy?.eligibility.total ?? 0,
                        },
                    });
                    continue;
                }
                if (s.settings.run === 'targets') {
                    const t = await storeTargets(s, store.id);
                    out.push({
                        id: s.id, title: s.title, category: s.category, summary: s.summary, banner_url: s.banner_url,
                        starts_on: s.starts_on, ends_on: s.ends_on, windows: s.windows, open_window: null, next_window: null, state: s.state,
                        has_score: false, joined: true, achieved: null, run: 'targets', target_now: t.now,
                    });
                    continue;
                }
                const board = joinedSet.has(s.id) ? await schemeStandings(s) : [];
                const me = board.find(b => b.store_id === store.id);
                out.push({
                    id: s.id, title: s.title, category: s.category, summary: s.summary, banner_url: s.banner_url,
                    starts_on: s.starts_on, ends_on: s.ends_on, windows: s.windows, open_window: s.open_window, next_window: s.next_window, state: s.state,
                    has_score: s.score_rule.mode !== 'none',
                    joined: joinedSet.has(s.id),
                    achieved: me ? { score: me.score, approved: me.approved, rank: me.rank, of: board.length, reward: me.reward, slab: me.slab, club: me.club } : null,
                });
            }
            res.json({ success: true, schemes: out });
        } catch (error: any) {
            console.error('[Schemes] store list:', error);
            res.status(500).json({ error: 'Could not load schemes' });
        }
    }

    static async storeGet(req: Request, res: Response) {
        try {
            const store = await myStore(req);
            if (!store) return res.status(404).json({ error: 'Store not found' });
            const scheme = await loadScheme(req.params.id);
            if (!scheme || scheme.status === 'draft' || !canSee(scheme, store)) {
                return res.status(404).json({ error: 'Scheme not found' });
            }
            if (isSellMore(scheme.id)) {
                return res.json({ success: true, scheme: sellMoreVisible(scheme), joined: true, can_submit: false, sell_more: { ...(await sellMoreForStore(scheme, store.id)), only_option: store.is_franchise ? null : 'buy_more' } });
            }
            if (scheme.settings.run === 'targets') {
                const { eligibility: _e, ...visible } = scheme;
                return res.json({ success: true, scheme: visible, joined: true, can_submit: false, targets: await storeTargets(scheme, store.id) });
            }
            const [[joined]]: any = await db.execute(
                'SELECT joined_at FROM scheme_participants WHERE scheme_id = ? AND store_id = ?', [scheme.id, store.id]
            );
            const [entries]: any = await db.execute(
                'SELECT id, answers, files, score, `lines`, claimed_lines, invoices, status, review_note, created_at, reviewed_at FROM scheme_entries WHERE scheme_id = ? AND store_id = ? ORDER BY created_at DESC',
                [scheme.id, store.id]
            );
            const board = await schemeStandings(scheme);
            const me = board.find(b => b.store_id === store.id) ?? null;

            /* The leaderboard as the scheme allows: the top ten and this store,
               with other stores' names only if the admin turned names on. */
            let leaderboard: { rank: number; name: string; score: number; me: boolean; club: Club | null }[] | null = null;
            if (scheme.leaderboard.show && scheme.score_rule.mode !== 'none') {
                const shown = board.filter(b => b.rank <= 10 || b.store_id === store.id);
                const names = scheme.leaderboard.names ? await storesById(shown.map(b => b.store_id)) : new Map();
                leaderboard = shown.map(b => ({
                    rank: b.rank,
                    name: b.store_id === store.id ? 'You' : (scheme.leaderboard.names ? names.get(b.store_id)?.name ?? 'Store' : `Store #${b.rank}`),
                    score: b.score,
                    me: b.store_id === store.id,
                    club: b.club,
                }));
            }

            const { eligibility: _e, ...visible } = scheme;
            res.json({
                success: true,
                scheme: visible,
                joined: Boolean(joined), joined_at: joined?.joined_at ?? null,
                can_submit: Boolean(joined) && canSubmit(scheme.status, scheme.windows, istNow())
                    && !(scheme.entries_per_store === 'one' && entries.some((e: any) => e.status !== 'rejected')),
                achieved: me ? { score: me.score, approved: me.approved, rank: me.rank, of: board.length, reward: me.reward, slab: me.slab, club: me.club } : null,
                months: monthlyPoints(entries.map((e: any) => ({ created_at: e.created_at, score: Number(e.score), status: e.status }))),
                distributors: scheme.fields.some(f => f.type === 'distributor') ? await distributorChoices(store) : [],
                entries: entries.map((e: any) => ({
                    id: e.id, answers: json(e.answers, {}), files: json(e.files, {}),
                    score: Number(e.score), lines: json(e.lines, null), claimed_lines: json(e.claimed_lines, null),
                    invoices: e.status === 'approved' ? json(e.invoices, null) : null,
                    status: e.status, review_note: e.review_note,
                    created_at: e.created_at, reviewed_at: e.reviewed_at,
                })),
                leaderboard,
            });
        } catch (error: any) {
            console.error('[Schemes] store get:', error);
            res.status(500).json({ error: 'Could not load the scheme' });
        }
    }

    static async storeJoin(req: Request, res: Response) {
        try {
            const store = await myStore(req);
            if (!store) return res.status(404).json({ error: 'Store not found' });
            const scheme = await loadScheme(req.params.id);
            if (!scheme || scheme.status !== 'published' || !isEligible(scheme.eligibility, store)) {
                return res.status(404).json({ error: 'Scheme not found' });
            }
            if (scheme.state === 'closed') return res.status(400).json({ error: 'This scheme has closed' });
            if (scheme.terms && !req.body?.accept_terms) return res.status(400).json({ error: 'Accept the terms to join' });
            await db.execute('INSERT IGNORE INTO scheme_participants (scheme_id, store_id) VALUES (?, ?)', [scheme.id, store.id]);
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] join:', error);
            res.status(500).json({ error: 'Could not join the scheme' });
        }
    }

    /** Sell More Earn More: opt for an option; admins can later reassign or release it. */
    static async storeOpt(req: Request, res: Response) {
        try {
            const store = await myStore(req);
            if (!store) return res.status(404).json({ error: 'Store not found' });
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id) || scheme.status !== 'published' || !canSee(scheme, store)) {
                return res.status(404).json({ error: 'Scheme not found' });
            }
            if (scheme.state === 'closed') return res.status(400).json({ error: 'This scheme has closed' });
            if (assignedOption(scheme, store.id)) return res.status(400).json({ error: 'Head office has already assigned your option' });
            if (!optionAllowed(req.body?.option, store)) return res.status(400).json({ error: 'Choose an option' });
            if (req.body?.accept_terms !== true) return res.status(400).json({ error: 'Accept the terms to choose' });
            await db.execute('INSERT IGNORE INTO scheme_participants (scheme_id, store_id) VALUES (?, ?)', [scheme.id, store.id]);
            /* Only a store with no option yet is written, so a second choice can't replace the first. */
            const [r]: any = await db.execute(
                `UPDATE scheme_participants
                    SET terms = JSON_SET(COALESCE(terms, '{}'), '$.option', ?, '$.opted_at', ?)
                  WHERE scheme_id = ? AND store_id = ? AND (terms IS NULL OR JSON_EXTRACT(terms, '$.option') IS NULL)`,
                [req.body.option, new Date().toISOString(), scheme.id, store.id]
            );
            if (!r.affectedRows) return res.status(400).json({ error: "You've already chosen, and it can't be changed" });
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] opt:', error);
            res.status(500).json({ error: 'Could not save your choice' });
        }
    }

    /** Option 2: an invoice the store sends, with the sets it checked. Counts once the admin approves it. */
    static async storeBuyInvoice(req: Request, res: Response) {
        try {
            const store = await myStore(req);
            if (!store) return res.status(404).json({ error: 'Store not found' });
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id) || scheme.status !== 'published' || !canSee(scheme, store)) {
                return res.status(404).json({ error: 'Scheme not found' });
            }
            const [[p]]: any = await db.execute('SELECT terms FROM scheme_participants WHERE scheme_id = ? AND store_id = ?', [scheme.id, store.id]);
            if (optionOf(json<any>(p?.terms, {})) !== 'buy_more') return res.status(400).json({ error: 'Choose Buy More Get More first' });
            await saveBuyInvoice(req, res, scheme, store.id, null);
        } catch (error: any) {
            console.error('[Schemes] buy invoice:', error);
            res.status(500).json({ error: 'Could not send the invoice' });
        }
    }

    /** The Buy More schemes that have a store of this distributor in them. */
    static async distributorBuyMoreList(req: Request, res: Response) {
        try {
            const dist = await myDistributor(req);
            if (!dist) return res.json({ success: true, schemes: [] });
            const [rows]: any = await db.execute("SELECT * FROM schemes WHERE status IN ('published', 'ended') AND deleted_at IS NULL ORDER BY starts_on DESC");
            const out = [];
            for (const r of rows) {
                const scheme = readScheme(r);
                if (!isSellMore(scheme.id)) continue;
                const stores = await distributorStores(scheme, dist.id);
                if (!stores.length) continue;
                out.push({ id: scheme.id, title: scheme.title, starts_on: scheme.starts_on, ends_on: scheme.ends_on, status: scheme.status, stores: stores.length });
            }
            res.json({ success: true, distributor: dist.name, schemes: out });
        } catch (error: any) {
            console.error('[Schemes] distributor list:', error);
            res.status(500).json({ error: 'Could not load the schemes' });
        }
    }

    /** One Buy More scheme for a distributor: only its own stores that are in it, each with its sets and invoices. */
    static async distributorBuyMore(req: Request, res: Response) {
        try {
            const dist = await myDistributor(req);
            const scheme = await loadScheme(req.params.id);
            if (!dist || !scheme || !isSellMore(scheme.id) || scheme.status === 'draft') return res.status(404).json({ error: 'Scheme not found' });
            const mine = await distributorStores(scheme, dist.id);
            const stores = [];
            for (const st of mine) {
                const b = await buyMoreForStore(scheme, st.store_id);
                stores.push({
                    ...st, approved: b.approved, used: b.used, available: b.available, eligibility: b.eligibility, rewards: b.rewards, waiting_sets: b.waiting_sets,
                    invoices: b.invoices,
                });
            }
            res.json({
                success: true, distributor: dist.name,
                scheme: { id: scheme.id, title: scheme.title, starts_on: scheme.starts_on, ends_on: scheme.ends_on, status: scheme.status },
                can_add: scheme.status === 'published' && await distributorMayAdd(scheme.id, dist.id), stores, products: await seatCoverNames(scheme),
            });
        } catch (error: any) {
            console.error('[Schemes] distributor buy more:', error);
            res.status(500).json({ error: 'Could not load your stores' });
        }
    }

    /** A distributor sends an invoice for one of its stores in the scheme. The admin approves it like any other. */
    static async distributorBuyInvoice(req: Request, res: Response) {
        try {
            const dist = await myDistributor(req);
            const scheme = await loadScheme(req.params.id);
            if (!dist || !scheme || !isSellMore(scheme.id) || scheme.status !== 'published') return res.status(404).json({ error: 'Scheme not found' });
            if (!(await distributorMayAdd(scheme.id, dist.id))) return res.status(403).json({ error: 'Head office has not let you add invoices for now' });
            const storeId = String(req.body?.store_id ?? '');
            const mine = await distributorStores(scheme, dist.id);
            if (!mine.some((s: { store_id: string }) => s.store_id === storeId)) return res.status(400).json({ error: 'This store is not one of yours in the scheme' });
            await saveBuyInvoice(req, res, scheme, storeId, dist.id);
        } catch (error: any) {
            console.error('[Schemes] distributor invoice:', error);
            res.status(500).json({ error: 'Could not send the invoice' });
        }
    }

    /** Option 2: redeem an offer the store has enough sets for. The admin's approval uses the sets. */
    static async storeClaimFreeSet(req: Request, res: Response) {
        try {
            const store = await myStore(req);
            if (!store) return res.status(404).json({ error: 'Store not found' });
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id) || scheme.status === 'draft' || !canSee(scheme, store)) {
                return res.status(404).json({ error: 'Scheme not found' });
            }
            const [[p]]: any = await db.execute('SELECT terms FROM scheme_participants WHERE scheme_id = ? AND store_id = ?', [scheme.id, store.id]);
            if (optionOf(json<any>(p?.terms, {})) !== 'buy_more') return res.status(400).json({ error: 'Choose Buy More Get More first' });
            const offer = req.body?.offer;
            if (!isOffer(offer)) return res.status(400).json({ error: 'Choose an offer' });
            const mine = await buyMoreForStore(scheme, store.id);
            if (mine.claims.some((c: any) => c.status === 'requested')) return res.status(400).json({ error: 'Your request is already with head office' });
            const ready = offer === 'offer1' ? mine.eligibility.offer1.ready : mine.eligibility.offer2_ready;
            if (!ready) return res.status(400).json({ error: "You don't have enough sets for this offer yet" });
            await db.execute('INSERT INTO scheme_free_sets (id, scheme_id, store_id, offer) VALUES (?, ?, ?, ?)', [uuidv4(), scheme.id, store.id, offer]);
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] claim free set:', error);
            res.status(500).json({ error: 'Could not send your claim' });
        }
    }

    /** Sell More Earn More: ask for one month's reward. The admin works it out and sends it by hand. */
    static async storeRedeem(req: Request, res: Response) {
        try {
            const store = await myStore(req);
            if (!store) return res.status(404).json({ error: 'Store not found' });
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isSellMore(scheme.id) || scheme.status === 'draft' || !canSee(scheme, store)) {
                return res.status(404).json({ error: 'Scheme not found' });
            }
            const mine = await sellMoreForStore(scheme, store.id);
            const month = (mine.months as { key: string; points: number; reward: any; reward_slab?: { slab: number }; future: boolean; can_request: boolean }[]).find(m => m.key === req.body?.month && !m.future) ?? null;
            const problem = redeemProblem(mine.option, month, month?.reward?.status === 'requested');
            if (problem) return res.status(400).json({ error: problem });
            const slabNo = Math.max(1, Number(month?.reward_slab?.slab) || 1);
            /* The unique key stops a double tap making two requests for one slab. */
            await db.execute(
                'INSERT IGNORE INTO scheme_reward_requests (id, scheme_id, store_id, month, slab_no, points) VALUES (?, ?, ?, ?, ?, ?)',
                [uuidv4(), scheme.id, store.id, month!.key, slabNo, month!.points]
            );
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Schemes] redeem:', error);
            res.status(500).json({ error: 'Could not send your request' });
        }
    }

    /** An entry: the scheme's fields as `answers` (JSON), and files named by field id. */
    static async storeSubmit(req: Request, res: Response) {
        try {
            const store = await myStore(req);
            if (!store) return res.status(404).json({ error: 'Store not found' });
            const scheme = await loadScheme(req.params.id);
            if (!scheme || !isEligible(scheme.eligibility, store)) return res.status(404).json({ error: 'Scheme not found' });

            const [[joined]]: any = await db.execute(
                'SELECT 1 AS ok FROM scheme_participants WHERE scheme_id = ? AND store_id = ?', [scheme.id, store.id]
            );
            if (!joined) return res.status(400).json({ error: 'Join the scheme first' });
            if (!canSubmit(scheme.status, scheme.windows, istNow())) {
                const next = nextWindow(scheme.windows, istNow());
                return res.status(400).json({ error: next ? `Entries open again on ${next.start.replace('T', ' at ')}` : 'This scheme is not taking entries now' });
            }
            if (scheme.entries_per_store === 'one') {
                const [[prior]]: any = await db.execute(
                    "SELECT 1 AS ok FROM scheme_entries WHERE scheme_id = ? AND store_id = ? AND status <> 'rejected' LIMIT 1",
                    [scheme.id, store.id]
                );
                if (prior) return res.status(400).json({ error: 'This scheme takes one entry per store, and yours is already in' });
            }

            const answers = json<Record<string, unknown>>(req.body?.answers, {});
            const files = uploadedFiles(req);
            /* Only the scheme's own fields are kept; a file sent under any other
               name is refused rather than stored. */
            const known = new Set(scheme.fields.map(f => f.id));
            if (Object.keys(files).some(k => !known.has(k))) return res.status(400).json({ error: 'A file was sent for a field this scheme does not have' });
            const dup = await alreadyCounted(scheme.id, store.id, { files });
            if (dup) return res.status(409).json({ error: dup, problems: [dup] });
            const clean: Record<string, string> = {};
            for (const f of scheme.fields) if (f.type !== 'file' && answers[f.id] !== undefined) clean[f.id] = String(answers[f.id]).trim();

            const problems = entryProblems(scheme.fields, clean, files);
            /* A products scheme: the store sends its invoice, and the admin
               reads it and adds the products when approving. Lines the store
               lists itself are kept as what it claimed, but are not needed. */
            let claimed: ReturnType<typeof linesScore> | null = null;
            if (scheme.score_rule.mode === 'products') {
                if (!Object.values(files).some(list => list.length)) problems.push('Add your invoice');
                const given = json<EntryLine[]>(req.body?.lines, []);
                if (given.length) {
                    claimed = linesScore(scheme.score_rule.products, given);
                    problems.push(...claimed.problems);
                }
            }
            if (problems.length) return res.status(400).json({ error: problems[0], problems });

            const id = uuidv4();
            await db.execute(
                'INSERT INTO scheme_entries (id, scheme_id, store_id, answers, files, score, claimed_lines) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [id, scheme.id, store.id, JSON.stringify(clean), JSON.stringify(files),
                 claimed ? claimed.score : scheme.score_rule.mode === 'products' ? 0 : entryScore(scheme.score_rule, clean),
                 claimed ? JSON.stringify(claimed.lines) : null]
            );
            res.json({ success: true, id });
        } catch (error: any) {
            console.error('[Schemes] submit:', error);
            res.status(500).json({ error: 'Could not submit the entry' });
        }
    }
}
