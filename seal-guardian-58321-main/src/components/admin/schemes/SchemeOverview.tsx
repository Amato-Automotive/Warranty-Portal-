import { useMemo, useState, type ReactNode } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ArrowRight, Download, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { downloadCSV } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ClubIcon, CLUB_COLORS } from "@/components/schemes/ClubBadge";
import { formatMonth } from "@/lib/schemes";
import { type AdminDetail, stateKey, stateLabel, istDay } from "./adminTypes";

/**
 * A scheme at a glance for the admin: how many stores took part and how far
 * they got, entries and points over time, the clubs, the series sold, the top
 * stores and the states. Everything is worked out here from the scheme's own
 * data, so the charts and the tabs never disagree.
 */

type Bucket = "day" | "week" | "month";

const STATUS_COLOR = { approved: "#059669", pending: "#f59e0b", rejected: "#e11d48" };
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
/* The Monday a day's week starts on. */
const weekOf = (day: string) => { const d = new Date(day + "T00:00:00Z"); return addDays(day, -((d.getUTCDay() + 6) % 7)); };
const shortDay = (day: string) => new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const fmt = (n: number) => n.toLocaleString("en-IN");

function Panel({ title, note, action, children, className }: { title: string; note?: string; action?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <div className={cn("rounded-xl border border-slate-200 bg-white p-4 min-w-0 flex flex-col", className)}>
            <div className="flex items-start justify-between gap-2 mb-4">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    {note && <p className="text-xs text-slate-500 mt-0.5">{note}</p>}
                </div>
                {action}
            </div>
            {children}
        </div>
    );
}

function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 min-w-0">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums leading-tight", tone === "warn" ? "text-amber-600" : "text-slate-900")}>{value}</p>
            {hint && <p className="mt-0.5 text-xs text-slate-500 truncate">{hint}</p>}
        </div>
    );
}

/** Rows of label · number with a thin bar, longest first. */
function Bars({ rows, empty, unit }: { rows: { key: string; label: ReactNode; value: number; color?: string; sub?: string }[]; empty: string; unit?: string }) {
    const max = Math.max(1, ...rows.map(r => r.value));
    if (!rows.length) return <p className="text-sm text-slate-400 py-8 text-center">{empty}</p>;
    return (
        <ul className="space-y-2.5">
            {rows.map(r => (
                <li key={r.key}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-slate-700 flex items-center gap-1.5">{r.label}</span>
                        <span className="shrink-0 tabular-nums font-semibold text-slate-900">
                            {fmt(r.value)}{unit && <span className="font-normal text-slate-400"> {unit}</span>}
                            {r.sub && <span className="ml-1.5 font-normal text-xs text-slate-400">{r.sub}</span>}
                        </span>
                    </div>
                    <div className="h-2 mt-1 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color ?? "#475569" }} />
                    </div>
                </li>
            ))}
        </ul>
    );
}

export function SchemeOverview({ data, onReview }: { data: AdminDetail; onReview: () => void }) {
    const [bucket, setBucket] = useState<Bucket>("day");
    const s = data.scheme;
    const hasScore = s.score_rule.mode !== "none";
    const products = useMemo(() => s.score_rule.mode === "products" ? s.score_rule.products : [], [s.score_rule]);
    const clubs = useMemo(() => [...(s.clubs ?? [])].sort((a, b) => b.min - a.min), [s.clubs]);

    const stats = useMemo(() => {
        const sent = new Set(data.entries.map(e => e.store_id));
        const approvedStores = new Set(data.entries.filter(e => e.status === "approved").map(e => e.store_id));
        const pending = data.entries.filter(e => e.status === "pending").length;
        const points = data.leaderboard.reduce((n, r) => n + r.score, 0);
        const inClub = data.leaderboard.filter(r => r.club).length;
        const earned = data.leaderboard.filter(r => r.reward).length;
        const paid = data.leaderboard.filter(r => r.reward && r.paid_at).length;
        const delivered = data.leaderboard.filter(r => r.reward && r.delivery === "delivered").length;
        /* How long a store waits: only entries the store sent and the team reviewed. */
        const waits = data.entries
            .filter(e => e.source === "store" && e.status !== "pending" && e.reviewed_at)
            .map(e => (Date.parse(e.reviewed_at!) - Date.parse(e.created_at)) / 3_600_000)
            .filter(h => h >= 0);
        const avgWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
        return { joined: data.participants.length, sent: sent.size, approvedStores: approvedStores.size, pending, points, inClub, earned, paid, delivered, avgWait };
    }, [data]);

    /* Entries per day/week/month by status, with the points approved from them. */
    const series = useMemo(() => {
        if (!data.entries.length) return [];
        const keyOf = (day: string) => bucket === "day" ? day : bucket === "week" ? weekOf(day) : day.slice(0, 7);
        const days = data.entries.map(e => istDay(e.created_at)).sort();
        const first = days[0];
        const last = istToday() > days[days.length - 1] ? istToday() : days[days.length - 1];
        const rows = new Map<string, { key: string; approved: number; pending: number; rejected: number; points: number }>();
        /* Every bucket from the first entry to today, so quiet days show as gaps. */
        for (let d = first; d <= last; d = addDays(d, 1)) {
            const k = keyOf(d);
            if (!rows.has(k)) rows.set(k, { key: k, approved: 0, pending: 0, rejected: 0, points: 0 });
            if (rows.size > 400) break;
        }
        for (const e of data.entries) {
            const r = rows.get(keyOf(istDay(e.created_at)));
            if (!r) continue;
            r[e.status] += 1;
            if (e.status === "approved") r.points += e.score;
        }
        return [...rows.values()].map(r => ({
            ...r,
            label: bucket === "month" ? formatMonth(r.key) : bucket === "week" ? `Wk ${shortDay(r.key)}` : shortDay(r.key),
        }));
    }, [data.entries, bucket]);

    const clubRows = useMemo(() => {
        const rows = clubs.map(c => ({
            key: c.id,
            label: <><span style={{ color: (CLUB_COLORS[c.color] ?? CLUB_COLORS.slate).swatch }}><ClubIcon icon={c.icon} className="h-4 w-4" /></span>{c.name}<span className="text-xs text-slate-400">{c.min}+</span></>,
            value: data.leaderboard.filter(r => r.club?.id === c.id).length,
            color: (CLUB_COLORS[c.color] ?? CLUB_COLORS.slate).swatch,
        }));
        const none = Math.max(0, data.participants.length - data.leaderboard.filter(r => r.club).length);
        return [...rows, { key: "none", label: <span className="text-slate-500">Not in a club yet</span>, value: none, color: "#cbd5e1" }];
    }, [clubs, data]);

    /* Sets approved per series, read off approved entries. */
    const seriesMix = useMemo(() => {
        const m = new Map<string, { qty: number; points: number }>();
        for (const e of data.entries) {
            if (e.status !== "approved") continue;
            for (const l of e.lines ?? []) {
                const x = m.get(l.product_id) ?? { qty: 0, points: 0 };
                x.qty += Number(l.qty) || 0; x.points += Number(l.subtotal) || 0;
                m.set(l.product_id, x);
            }
        }
        return products
            .map(p => ({ key: p.id, label: p.name, value: m.get(p.id)?.qty ?? 0, sub: `${fmt(m.get(p.id)?.points ?? 0)} pts`, color: "#ea580c" }))
            .filter(r => r.value > 0)
            .sort((a, b) => b.value - a.value);
    }, [data.entries, products]);


    /* Stores below a club, by how few points they need for the next one (admin only — stores never see their gap). */
    const closest = useMemo(() => {
        if (!clubs.length) return { rows: [], below: 0 };
        const up = [...clubs].sort((a, b) => a.min - b.min);
        const board = new Map(data.leaderboard.map(r => [r.store_id, r]));
        const all = data.participants.map(p => {
            const score = board.get(p.store_id)?.score ?? 0;
            const next = up.find(c => c.min > score);
            return next ? { store_id: p.store_id, store_name: p.store_name, city: p.city, score, next, need: next.min - score, club: board.get(p.store_id)?.club ?? null } : null;
        }).filter((r): r is NonNullable<typeof r> => r !== null);
        return { rows: all.sort((a, b) => a.need - b.need || b.score - a.score), below: all.length };
    }, [clubs, data]);

    const states = useMemo(() => {
        const m = new Map<string, { joined: number; points: number }>();
        for (const p of data.participants) {
            const k = stateKey(p.state) || "unknown";
            const x = m.get(k) ?? { joined: 0, points: 0 };
            x.joined += 1; m.set(k, x);
        }
        for (const r of data.leaderboard) {
            const k = stateKey(r.state) || "unknown";
            const x = m.get(k) ?? { joined: 0, points: 0 };
            x.points += r.score; m.set(k, x);
        }
        return [...m].map(([k, v]) => ({
            key: k, label: k === "unknown" ? <span className="text-slate-500">State not set</span> : stateLabel(k),
            value: hasScore ? v.points : v.joined, sub: `${v.joined} store${v.joined === 1 ? "" : "s"}`, color: "#0f766e",
        })).sort((a, b) => b.value - a.value).slice(0, 12);
    }, [data, hasScore]);

    const funnel = [
        { label: "Joined", n: stats.joined },
        { label: "Sent an entry", n: stats.sent },
        { label: "Got approved", n: stats.approvedStores },
        ...(clubs.length ? [{ label: "In a club", n: stats.inClub }] : []),
        ...(stats.earned ? [{ label: "Reward paid", n: stats.paid }, { label: "Delivered", n: stats.delivered }] : []),
    ];
    const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
    const wait = stats.avgWait === null ? "—" : stats.avgWait < 24 ? `${Math.max(1, Math.round(stats.avgWait))} h` : `${(stats.avgWait / 24).toFixed(1)} days`;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <Kpi label="Stores joined" value={fmt(stats.joined)} />
                <Kpi label="Sent an entry" value={fmt(stats.sent)} hint={`${pct(stats.sent, stats.joined)} of joined`} />
                {hasScore && <Kpi label="Points approved" value={fmt(stats.points)} hint={`${fmt(data.entries.filter(e => e.status === "approved").length)} entries approved`} />}
                {clubs.length > 0 && <Kpi label="In a club" value={fmt(stats.inClub)} hint={`${pct(stats.inClub, stats.joined)} of joined`} />}
                <Kpi label="Waiting for review" value={fmt(stats.pending)} tone={stats.pending ? "warn" : undefined}
                    hint={stats.pending ? <button type="button" onClick={onReview} className="text-orange-600 font-medium hover:underline inline-flex items-center gap-0.5">Review now <ArrowRight className="h-3 w-3" /></button> : "All caught up"} />
                <Kpi label="Avg. review time" value={wait} hint="Store entries only" />
                {stats.earned > 0 && <Kpi label="Rewards paid" value={<>{stats.paid}<span className="text-base font-normal text-slate-400"> / {stats.earned}</span></>} hint={`${stats.delivered} delivered`} />}
            </div>

            <Panel title="Entries and points over time" note="Bars: entries sent, by where they stand. Line: points approved from them."
                action={
                    <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
                        {(["day", "week", "month"] as const).map(b => (
                            <button key={b} type="button" onClick={() => setBucket(b)}
                                className={cn("px-2.5 py-1 rounded-md capitalize", bucket === b ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{b}</button>
                        ))}
                    </div>
                }>
                {!series.length ? <p className="text-sm text-slate-400 py-16 text-center">No entries yet.</p> : (
                    <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={series} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} minTickGap={16} />
                                <YAxis yAxisId="n" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                                {hasScore && <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />}
                                <Tooltip contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0", fontSize: 12 }} cursor={{ fill: "#f8fafc" }} />
                                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                                <Bar yAxisId="n" dataKey="approved" name="Approved" stackId="s" fill={STATUS_COLOR.approved} maxBarSize={28} />
                                <Bar yAxisId="n" dataKey="pending" name="Waiting" stackId="s" fill={STATUS_COLOR.pending} maxBarSize={28} />
                                <Bar yAxisId="n" dataKey="rejected" name="Rejected" stackId="s" fill={STATUS_COLOR.rejected} radius={[3, 3, 0, 0]} maxBarSize={28} />
                                {hasScore && <Line yAxisId="p" type="monotone" dataKey="points" name="Points approved" stroke="#ea580c" strokeWidth={2} dot={false} />}
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {clubs.length > 0 && (
                    <Panel title="Stores by club" note="Of the stores that joined.">
                        <Bars rows={clubRows} empty="Nobody has joined yet." />
                    </Panel>
                )}
                {products.length > 0 && (
                    <Panel title="Series sold" note="Sets on approved entries, with the points they earned.">
                        <Bars rows={seriesMix} unit="sets" empty="Nothing approved yet." />
                    </Panel>
                )}
                <Panel title="By state" note={hasScore ? "Points, with the stores that joined." : "Stores that joined."}>
                    <Bars rows={states} unit={hasScore ? "pts" : undefined} empty="Nobody has joined yet." />
                </Panel>
                {clubs.length > 0 && (
                    <Panel title="Closest to the next club" note={`${closest.below} store${closest.below === 1 ? "" : "s"} below a club, nearest first — for the team only; stores never see this.`}>
                        {!closest.rows.length ? <p className="text-sm text-slate-400 py-8 text-center">Every store that joined is in the top club.</p> : (
                            <ul className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                                {closest.rows.map(r => {
                                    const color = (CLUB_COLORS[r.next.color] ?? CLUB_COLORS.slate).swatch;
                                    return (
                                        <li key={r.store_id}>
                                            <div className="flex items-baseline justify-between gap-2 text-sm">
                                                <span className="min-w-0 truncate text-slate-700 flex items-center gap-1.5">
                                                    <span className="truncate">{r.store_name}</span>
                                                    {r.city && <span className="text-xs text-slate-400 truncate">{r.city}</span>}
                                                </span>
                                                <span className="shrink-0 text-xs text-slate-500 flex items-center gap-1">
                                                    <b className="tabular-nums text-slate-900 text-sm">{fmt(r.need)}</b> pts to
                                                    <span className="inline-flex items-center gap-0.5 font-medium" style={{ color }}><ClubIcon icon={r.next.icon} className="h-3.5 w-3.5" />{r.next.name}</span>
                                                </span>
                                            </div>
                                            <div className="h-2 mt-1 rounded-full bg-slate-100 overflow-hidden" title={`${fmt(r.score)} of ${fmt(r.next.min)} points`}>
                                                <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, (r.score / r.next.min) * 100))}%`, background: color }} />
                                            </div>
                                            <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">{fmt(r.score)} / {fmt(r.next.min)}{r.club ? ` · now ${r.club.name}` : ""}</p>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </Panel>
                )}
            </div>

            <StoresPanel data={data} hasScore={hasScore} />

            <Panel title="How far stores got" note="Each step out of the stores that joined.">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {funnel.map((f, i) => (
                        <div key={f.label} className="relative rounded-lg bg-slate-50 border border-slate-100 p-3">
                            <p className="text-xs text-slate-500">{i + 1}. {f.label}</p>
                            <p className="text-xl font-bold tabular-nums text-slate-900">{fmt(f.n)}</p>
                            <div className="h-1.5 mt-2 rounded-full bg-slate-200 overflow-hidden">
                                <div className="h-full rounded-full bg-orange-500" style={{ width: `${stats.joined ? Math.max(2, (f.n / stats.joined) * 100) : 0}%` }} />
                            </div>
                            <p className="mt-1 text-[11px] text-slate-400">{pct(f.n, stats.joined)}</p>
                        </div>
                    ))}
                </div>
            </Panel>
        </div>
    );
}

/**
 * Every store in the scheme, ranked and scrollable, and every verified
 * franchise that has not joined — both searchable and exportable.
 */
function StoresPanel({ data, hasScore }: { data: AdminDetail; hasScore: boolean }) {
    const [tab, setTab] = useState<"joined" | "not">("joined");
    const [q, setQ] = useState("");
    const notJoined = data.not_joined ?? [];
    const joined = useMemo(() => {
        const entries = new Map<string, number>();
        /* Approved points and entries per store and month (IST), for the month columns. */
        const byMonth = new Map<string, Map<string, { points: number; entries: number }>>();
        for (const e of data.entries) {
            if (e.status !== "approved") continue;
            entries.set(e.store_id, (entries.get(e.store_id) ?? 0) + 1);
            const m = istDay(e.created_at).slice(0, 7);
            const sm = byMonth.get(e.store_id) ?? new Map();
            const x = sm.get(m) ?? { points: 0, entries: 0 };
            x.points += e.score; x.entries += 1; sm.set(m, x); byMonth.set(e.store_id, sm);
        }
        for (const a of data.adjustments) {
            const m = istDay(a.created_at).slice(0, 7);
            const sm = byMonth.get(a.store_id) ?? new Map();
            const x = sm.get(m) ?? { points: 0, entries: 0 };
            x.points += a.points; sm.set(m, x); byMonth.set(a.store_id, sm);
        }
        const board = new Map(data.leaderboard.map(r => [r.store_id, r]));
        const rows = data.participants.map(p => {
            const b = board.get(p.store_id);
            return {
                store_id: p.store_id, store_name: p.store_name, city: p.city, state: p.state,
                rank: b?.rank ?? null, score: b?.score ?? 0, club: b?.club ?? null, approved: entries.get(p.store_id) ?? 0,
                months: byMonth.get(p.store_id) ?? new Map<string, { points: number; entries: number }>(),
            };
        });
        return rows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.store_name.localeCompare(b.store_name));
    }, [data]);
    /* Every month any store has points in, oldest first. */
    const months = useMemo(() => [...new Set(joined.flatMap(r => [...r.months.keys()]))].sort(), [joined]);
    const needle = q.trim().toLowerCase();
    const hit = (...v: (string | null | undefined)[]) => !needle || v.some(x => String(x ?? "").toLowerCase().includes(needle));
    const joinedShown = joined.filter(r => hit(r.store_name, r.city, r.state));
    const notShown = notJoined.filter(r => hit(r.store_name, r.store_code, r.city, r.state));
    const closed = notJoined.filter(r => !r.can_see).length;

    const exportShown = () => tab === "joined"
        ? downloadCSV(joinedShown.map(r => ({
            Rank: r.rank ?? "", Store: r.store_name, City: r.city ?? "", State: r.state ?? "",
            ...Object.fromEntries(months.flatMap(m => [[`${formatMonth(m)} points`, r.months.get(m)?.points ?? 0], [`${formatMonth(m)} entries`, r.months.get(m)?.entries ?? 0]])),
            ...(hasScore ? { "Total points": r.score } : {}), Club: r.club?.name ?? "", "Approved entries": r.approved,
        })), `${data.scheme.title}-joined.csv`)
        : downloadCSV(notShown.map(r => ({
            Store: r.store_name, Code: r.store_code ?? "", City: r.city ?? "", State: r.state ?? "", "Scheme open to them": r.can_see ? "Yes" : "No",
        })), `${data.scheme.title}-not-joined.csv`);

    return (
        <Panel title="Stores" note={tab === "joined" ? "Everyone in the scheme, by rank." : "Verified franchises that have not joined."}
            action={
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
                        {([["joined", `Joined ${joined.length}`], ["not", `Not joined ${notJoined.length}`]] as const).map(([k, l]) => (
                            <button key={k} type="button" onClick={() => setTab(k)}
                                className={cn("px-2.5 py-1 rounded-md tabular-nums", tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{l}</button>
                        ))}
                    </div>
                    <div className="relative">
                        <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Store, city, state…" className="h-8 w-[190px] pl-8 text-xs" aria-label="Search stores" />
                    </div>
                    <button type="button" onClick={exportShown} disabled={tab === "joined" ? !joinedShown.length : !notShown.length}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                        <Download className="h-3.5 w-3.5" /> Export
                    </button>
                </div>
            }>
            {tab === "not" && closed > 0 && (
                <p className="mb-3 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
                    {closed === notJoined.length ? "The scheme is not open to any of these stores yet, so they cannot see it to join."
                        : `The scheme is not open to ${closed} of these stores, so they cannot see it to join.`} Change who can take part in the scheme's settings.
                </p>
            )}
            <div className="max-h-[440px] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm" style={{ minWidth: tab === "joined" ? 420 + months.length * 96 : undefined }}>
                    <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500">
                        {tab === "joined" ? (
                            <tr>
                                <th className="px-3 py-2 text-left font-semibold w-14 sticky left-0 bg-slate-50">Rank</th>
                                <th className="px-3 py-2 text-left font-semibold min-w-[200px]">Store</th>
                                {months.map(m => <th key={m} className="px-3 py-2 text-right font-semibold w-24 whitespace-nowrap">{formatMonth(m)}</th>)}
                                {hasScore && <th className="px-3 py-2 text-right font-semibold w-20">Total</th>}
                                <th className="px-3 py-2 text-right font-semibold w-24 hidden sm:table-cell">Approved</th>
                            </tr>
                        ) : (
                            <tr>
                                <th className="px-3 py-2 text-left font-semibold">Store</th>
                                <th className="px-3 py-2 text-left font-semibold w-28 hidden sm:table-cell">Code</th>
                                <th className="px-3 py-2 text-left font-semibold w-40 hidden md:table-cell">State</th>
                                <th className="px-3 py-2 text-right font-semibold w-36">Can see it</th>
                            </tr>
                        )}
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {tab === "joined" ? joinedShown.map(r => (
                            <tr key={r.store_id} className="hover:bg-slate-50">
                                <td className="px-3 py-2 tabular-nums text-xs text-slate-400 sticky left-0 bg-white">{r.rank ? `#${r.rank}` : "—"}</td>
                                <td className="px-3 py-2 max-w-[260px]">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="font-medium text-slate-800 truncate">{r.store_name}</span>
                                        {r.club && <span title={r.club.name} className="shrink-0" style={{ color: (CLUB_COLORS[r.club.color] ?? CLUB_COLORS.slate).swatch }}><ClubIcon icon={r.club.icon} className="h-3.5 w-3.5" /></span>}
                                    </div>
                                    <div className="text-xs text-slate-400 truncate">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</div>
                                </td>
                                {months.map(m => {
                                    const x = r.months.get(m);
                                    return (
                                        <td key={m} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                                            {x ? <>
                                                <div className="text-slate-800">{fmt(x.points)}</div>
                                                {x.entries > 0 && <div className="text-[11px] text-slate-400">{x.entries} entr{x.entries === 1 ? "y" : "ies"}</div>}
                                            </> : <span className="text-slate-300">—</span>}
                                        </td>
                                    );
                                })}
                                {hasScore && <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{fmt(r.score)}</td>}
                                <td className="px-3 py-2 text-right tabular-nums text-slate-600 hidden sm:table-cell">{r.approved}</td>
                            </tr>
                        )) : notShown.map(r => (
                            <tr key={r.store_id} className="hover:bg-slate-50">
                                <td className="px-3 py-2">
                                    <div className="font-medium text-slate-800 truncate">{r.store_name}</div>
                                    <div className="text-xs text-slate-400 truncate">{r.city || "—"}</div>
                                </td>
                                <td className="px-3 py-2 text-xs text-slate-500 hidden sm:table-cell">{r.store_code ?? "—"}</td>
                                <td className="px-3 py-2 text-xs text-slate-500 truncate hidden md:table-cell">{r.state ? stateLabel(stateKey(r.state)) : "—"}</td>
                                <td className="px-3 py-2 text-right">
                                    <span className={cn("inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                                        r.can_see ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500")}>
                                        {r.can_see ? "Yes, not joined" : "Not open to them"}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {(tab === "joined" ? !joinedShown.length : !notShown.length) && (
                    <p className="py-10 text-center text-sm text-slate-400">{needle ? "No store matches." : tab === "joined" ? "Nobody has joined yet." : "Every verified franchise has joined."}</p>
                )}
            </div>
            <p className="mt-2 text-xs text-slate-400 tabular-nums">
                {tab === "joined" ? `${joinedShown.length} of ${joined.length} stores` : `${notShown.length} of ${notJoined.length} stores`}
            </p>
        </Panel>
    );
}
