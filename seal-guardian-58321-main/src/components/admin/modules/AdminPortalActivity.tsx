import { useCallback, useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
    Activity, ArrowDown, ArrowUp, Clock, Eye, FileCheck2, Gift, Image as ImageIcon, KeyRound, Loader2, LogIn,
    Package, RefreshCw, Search, ShieldCheck, Truck, UserPlus,
} from "lucide-react";

/**
 * What franchises and distributors do in their portal: time spent, how often
 * they come back, and what they did (warranties, orders, POSM, schemes…).
 *
 * Time and pages are tracked from the day the tracker went live; everything
 * else comes from the records the portal already keeps, so it has history.
 */

interface StoreRow {
    id: string; name: string; city: string | null; state: string | null;
    is_franchise: boolean; is_distributor: boolean;
    minutes: number; active_days: number; opens: number; login_codes: number; active_in_range: boolean;
    warranties: number; verified: number; orders: number; incoming: number;
    last_active: string | null; last_portal: string | null;
}

interface StoreDetail {
    days: number; from: string; to: string;
    store: { id: string; name: string; city: string | null; state: string | null; is_franchise: boolean; is_distributor: boolean };
    summary: { minutes: number; active_days: number; opens: number; login_codes: number; warranties: number; verified: number; orders: number; last_portal: string | null };
    per_day: { day: string; minutes: number }[];
    per_page: { module: string; label: string; minutes: number }[];
    timeline: { at: string; kind: string; title: string; detail?: string | null }[];
    tracking_since: string | null;
}

/* ─── Small helpers ──────────────────────────────────────────────────────── */

export const formatMinutes = (m: number) => {
    if (!m) return "—";
    const h = Math.floor(m / 60), r = m % 60;
    return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`;
};

const ago = (iso: string | null) => {
    if (!iso) return "Never";
    const t = new Date(iso).getTime();
    const mins = Math.round((Date.now() - t) / 60_000);
    if (mins < 2) return "Just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const d = Math.round(hours / 24);
    return d === 1 ? "Yesterday" : `${d} days ago`;
};
const daysSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Infinity);

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
});
const sinceDay = (iso: string | null) => iso
    ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })
    : null;

const TIMELINE_ICON: Record<string, { icon: typeof Activity; tone: string }> = {
    open: { icon: LogIn, tone: "bg-slate-100 text-slate-600" },
    login: { icon: KeyRound, tone: "bg-slate-100 text-slate-500" },
    page: { icon: Eye, tone: "bg-sky-50 text-sky-600" },
    warranty: { icon: ShieldCheck, tone: "bg-orange-50 text-orange-600" },
    verify: { icon: FileCheck2, tone: "bg-emerald-50 text-emerald-600" },
    order: { icon: Package, tone: "bg-indigo-50 text-indigo-600" },
    incoming: { icon: Truck, tone: "bg-violet-50 text-violet-600" },
    posm: { icon: ImageIcon, tone: "bg-pink-50 text-pink-600" },
    scheme: { icon: Gift, tone: "bg-amber-50 text-amber-600" },
    manpower: { icon: UserPlus, tone: "bg-teal-50 text-teal-600" },
};

const roleLabel = (s: { is_franchise: boolean; is_distributor: boolean }) =>
    s.is_franchise && s.is_distributor ? "Franchise + Distributor" : s.is_distributor ? "Distributor" : "Franchise";

/* ─── The date range ─────────────────────────────────────────────────────── */

export type RangeChoice = { preset: "today" | "7" | "30" | "90" | "custom"; from: string; to: string };
const PRESETS: [RangeChoice["preset"], string][] = [["today", "Today"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["custom", "Custom"]];
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const DEFAULT_RANGE: RangeChoice = { preset: "30", from: "", to: "" };

/** What the API takes: a number of days for a preset, the two dates for a custom range. */
const rangeParams = (r: RangeChoice) => r.preset === "custom" && r.from && r.to ? { from: r.from, to: r.to }
    : r.preset === "today" ? { days: 1 } : { days: r.preset === "custom" ? 30 : Number(r.preset) };

const shortDay = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
/** "2 Oct – 8 Oct 2026", for headings and empty states. */
const rangeLabel = (from?: string, to?: string) => (!from || !to ? "" : from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`);

function RangePicker({ value, onChange }: { value: RangeChoice; onChange: (r: RangeChoice) => void }) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
                {PRESETS.map(([k, l]) => (
                    <button key={k} type="button"
                        onClick={() => onChange(k === "custom"
                            ? { preset: "custom", from: value.from || new Date(Date.now() + 5.5 * 3600_000 - 29 * 86_400_000).toISOString().slice(0, 10), to: value.to || istToday() }
                            : { ...value, preset: k })}
                        className={cn("px-3 py-1.5 rounded-md", value.preset === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
                        {l}
                    </button>
                ))}
            </div>
            {value.preset === "custom" && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <input type="date" value={value.from} max={value.to || istToday()} aria-label="From"
                        onChange={e => onChange({ ...value, from: e.target.value })}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700" />
                    <span>to</span>
                    <input type="date" value={value.to} min={value.from || undefined} max={istToday()} aria-label="To"
                        onChange={e => onChange({ ...value, to: e.target.value })}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700" />
                </div>
            )}
        </div>
    );
}

/* ─── One store ──────────────────────────────────────────────────────────── */

/** One franchise or distributor's activity: totals, time per day and page, and a timeline. */
export function StoreActivityPanel({ vendorId, initialRange = DEFAULT_RANGE }: { vendorId: string; initialRange?: RangeChoice }) {
    const { toast } = useToast();
    const [range, setRange] = useState<RangeChoice>(initialRange);
    const [data, setData] = useState<StoreDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [kind, setKind] = useState<string>("all");

    useEffect(() => {
        let alive = true;
        setLoading(true);
        api.get(`/admin/activity/${vendorId}`, { params: rangeParams(range) })
            .then(r => alive && setData(r.data))
            .catch(e => alive && toast({ title: "Could not load activity", description: getErrorMessage(e, "Try again"), variant: "destructive" }))
            .finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, [vendorId, range.preset, range.from, range.to, toast]);

    /* Every day of the period, with zero minutes where nothing was tracked. */
    const chart = useMemo(() => {
        if (!data) return [];
        const by = new Map(data.per_day.map(d => [d.day, d.minutes]));
        const out: { day: string; minutes: number }[] = [];
        for (let t = Date.parse(`${data.from}T00:00:00Z`); t <= Date.parse(`${data.to}T00:00:00Z`) && out.length < 400; t += 86_400_000) {
            const d = new Date(t).toISOString().slice(0, 10);
            out.push({ day: d, minutes: by.get(d) ?? 0 });
        }
        return out;
    }, [data]);
    const maxDay = Math.max(1, ...chart.map(c => c.minutes));
    const pageTotal = Math.max(1, (data?.per_page ?? []).reduce((a, p) => a + p.minutes, 0));
    const kinds = useMemo(() => [...new Set((data?.timeline ?? []).map(t => t.kind))], [data]);
    const shown = (data?.timeline ?? []).filter(t => kind === "all" || t.kind === kind);

    if (loading && !data) {
        return <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /> Loading activity…</div>;
    }
    if (!data) return null;
    const s = data.summary;
    const since = sinceDay(data.tracking_since);

    return (
        <div className={cn("space-y-5", loading && "opacity-60")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                    {since ? <>Time and pages tracked since <b>{since}</b>; warranties, orders and the rest include earlier history.</>
                        : <>Time and pages are tracked from today; warranties, orders and the rest include earlier history.</>}
                </p>
                <RangePicker value={range} onChange={setRange} />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Time in portal" value={formatMinutes(s.minutes)}
                    hint={s.active_days ? `avg ${formatMinutes(Math.round(s.minutes / s.active_days))} per active day` : undefined} />
                <Tile label="Active days" value={`${s.active_days}`} hint={`of ${data.days} day${data.days === 1 ? "" : "s"}`} />
                <Tile label="Portal opens" value={`${s.opens}`} hint={`${s.login_codes} login code${s.login_codes === 1 ? "" : "s"} sent`} />
                <Tile label="Last seen in portal" value={ago(s.last_portal)} hint={s.last_portal ? when(s.last_portal) : undefined} />
            </div>
            <div className="grid grid-cols-3 gap-3">
                <Tile small label="Warranties registered" value={`${s.warranties}`} />
                <Tile small label="Warranties verified" value={`${s.verified}`} />
                <Tile small label="Orders placed" value={`${s.orders}`} />
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
                <section className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-800 mb-3">Minutes in the portal, per day</p>
                    <div className="flex items-end gap-[3px] h-28">
                        {chart.map(c => (
                            <div key={c.day} title={`${new Date(`${c.day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}: ${formatMinutes(c.minutes)}`}
                                className={cn("flex-1 rounded-t", c.minutes ? "bg-orange-400 hover:bg-orange-500" : "bg-slate-100")}
                                style={{ height: `${c.minutes ? Math.max(6, (c.minutes / maxDay) * 100) : 3}%` }} />
                        ))}
                    </div>
                    <div className="flex justify-between mt-1.5 text-[10px] text-slate-400">
                        <span>{chart[0] && new Date(`${chart[0].day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                        <span>{chart.length ? new Date(`${chart[chart.length - 1].day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}</span>
                    </div>
                </section>
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-800 mb-3">Where the time goes</p>
                    {data.per_page.length === 0 ? (
                        <p className="text-xs text-slate-400 py-6 text-center">No time tracked yet.</p>
                    ) : (
                        <ul className="space-y-2">
                            {data.per_page.slice(0, 8).map(p => (
                                <li key={p.module}>
                                    <div className="flex justify-between text-xs"><span className="text-slate-700">{p.label}</span><span className="tabular-nums text-slate-500">{formatMinutes(p.minutes)}</span></div>
                                    <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                        <div className="h-full rounded-full bg-sky-500" style={{ width: `${(p.minutes / pageTotal) * 100}%` }} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-800">Timeline <span className="font-normal text-slate-400">· newest first</span></p>
                    <select value={kind} onChange={e => setKind(e.target.value)}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700">
                        <option value="all">Everything ({data.timeline.length})</option>
                        {kinds.map(k => <option key={k} value={k}>{KIND_LABEL[k] ?? k} ({data.timeline.filter(t => t.kind === k).length})</option>)}
                    </select>
                </div>
                {shown.length === 0 ? (
                    <p className="text-sm text-slate-400 py-10 text-center">Nothing between {rangeLabel(data.from, data.to)}.</p>
                ) : (
                    <ol className="max-h-[520px] overflow-y-auto divide-y divide-slate-50">
                        {shown.map((t, i) => {
                            const meta = TIMELINE_ICON[t.kind] ?? TIMELINE_ICON.page;
                            return (
                                <li key={`${t.at}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
                                    <span className={cn("h-7 w-7 shrink-0 rounded-lg grid place-items-center", meta.tone)}><meta.icon className="h-3.5 w-3.5" /></span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm text-slate-800">{t.title}</p>
                                        {t.detail && <p className="text-xs text-slate-500 truncate">{t.detail}</p>}
                                    </div>
                                    <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{when(t.at)}</span>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </section>
        </div>
    );
}

const KIND_LABEL: Record<string, string> = {
    open: "Portal opens", login: "Login codes", page: "Pages viewed", warranty: "Warranties registered",
    verify: "Warranties verified", order: "Orders placed", incoming: "Orders received", posm: "POSM requests",
    scheme: "Scheme entries", manpower: "Manpower added",
};

function Tile({ label, value, hint, small }: { label: string; value: string; hint?: string; small?: boolean }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 min-w-0">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className={cn("font-bold text-slate-900 tabular-nums leading-tight mt-0.5", small ? "text-xl" : "text-2xl")}>{value}</p>
            {hint && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{hint}</p>}
        </div>
    );
}

/* ─── Everyone ───────────────────────────────────────────────────────────── */

type SortKey = "name" | "last_active" | "minutes" | "active_days" | "opens" | "warranties" | "verified" | "orders";

export const AdminPortalActivity = () => {
    const { toast } = useToast();
    const [range, setRange] = useState<RangeChoice>(DEFAULT_RANGE);
    const [shownRange, setShownRange] = useState<{ from: string; to: string } | null>(null);
    const [role, setRole] = useState<"all" | "franchise" | "distributor">("all");
    /* Active = did anything in the chosen range: portal use, a login code, a warranty, an order. */
    const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
    const [q, setQ] = useState("");
    const [rows, setRows] = useState<StoreRow[] | null>(null);
    const [since, setSince] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "last_active", dir: -1 });
    const [open, setOpen] = useState<StoreRow | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        // A custom range waits for both dates.
        if (range.preset === "custom" && (!range.from || !range.to)) return Promise.resolve();
        return api.get("/admin/activity", { params: { ...rangeParams(range), role } })
            .then(r => { setRows(r.data.stores || []); setSince(r.data.tracking_since ?? null); setShownRange({ from: r.data.from, to: r.data.to }); })
            .catch(e => toast({ title: "Could not load activity", description: getErrorMessage(e, "Try again"), variant: "destructive" }))
            .finally(() => setLoading(false));
    }, [range.preset, range.from, range.to, role, toast]);
    useEffect(() => { load(); }, [load]);

    const counts = useMemo(() => ({
        all: rows?.length ?? 0,
        active: (rows ?? []).filter(r => r.active_in_range).length,
        inactive: (rows ?? []).filter(r => !r.active_in_range).length,
    }), [rows]);

    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase();
        const list = (rows ?? []).filter(r =>
            (status === "all" || (status === "active" ? r.active_in_range : !r.active_in_range))
            && (!needle || r.name.toLowerCase().includes(needle) || (r.city ?? "").toLowerCase().includes(needle) || (r.state ?? "").toLowerCase().includes(needle)));
        const val = (r: StoreRow) => sort.key === "name" ? r.name.toLowerCase()
            : sort.key === "last_active" ? (r.last_active ? new Date(r.last_active).getTime() : 0) : Number(r[sort.key]);
        return [...list].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
    }, [rows, q, status, sort]);

    const totals = useMemo(() => ({
        minutes: (rows ?? []).reduce((a, r) => a + r.minutes, 0),
        activeStores: (rows ?? []).filter(r => r.minutes > 0).length,
    }), [rows]);

    const head = (key: SortKey, label: string, right = false) => (
        <th className={cn("px-3 py-2.5 font-semibold whitespace-nowrap", right && "text-right")}>
            <button type="button" onClick={() => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}
                className={cn("inline-flex items-center gap-1 hover:text-slate-900", sort.key === key && "text-slate-900")}>
                {label}
                {sort.key === key && (sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </button>
        </th>
    );

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2"><Activity className="h-6 w-6 text-orange-500" /> Portal Activity</h2>
                    <p className="text-sm text-slate-500 mt-1">
                        What franchises and distributors do in their portal, and for how long.
                        {since ? <> Time tracked since <b>{sinceDay(since)}</b>.</> : <> Time is tracked from today.</>}
                        {shownRange && <> Showing <b>{rangeLabel(shownRange.from, shownRange.to)}</b>.</>}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <RangePicker value={range} onChange={setRange} />
                    <button type="button" onClick={() => load()} disabled={loading} aria-label="Refresh"
                        className="h-9 w-9 grid place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800">
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Stores" value={`${counts.all}`} hint={role === "all" ? "franchises and distributors" : role === "franchise" ? "franchises" : "distributors"} />
                <Tile label="Active in this range" value={`${counts.active}`} hint="a login, portal use, warranty or order" />
                <Tile label="Not active in this range" value={`${counts.inactive}`} hint="nothing at all in these dates" />
                <Tile label="Time in portal" value={formatMinutes(totals.minutes)} hint={`${totals.activeStores} stores used it`} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
                    {([["all", "All"], ["franchise", "Franchises"], ["distributor", "Distributors"]] as const).map(([k, l]) => (
                        <button key={k} type="button" onClick={() => setRole(k)}
                            className={cn("px-3 py-1.5 rounded-md", role === k ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800")}>{l}</button>
                    ))}
                </div>
                <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
                    {([["all", "Anyone", counts.all], ["active", "Active", counts.active], ["inactive", "Not active", counts.inactive]] as const).map(([k, l, n]) => (
                        <button key={k} type="button" onClick={() => setStatus(k)}
                            className={cn("px-3 py-1.5 rounded-md", status === k ? "bg-orange-500 text-white" : "text-slate-500 hover:text-slate-800")}>
                            {l} <span className="tabular-nums opacity-70">{n}</span>
                        </button>
                    ))}
                </div>
                <div className="relative ml-auto w-full sm:w-64">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store, city or state…" className="pl-8 h-9" />
                </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="overflow-auto max-h-[calc(100vh-330px)]">
                    <table className="w-full text-sm min-w-[980px]">
                        <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500 text-left shadow-[0_1px_0_0_rgb(226,232,240)]">
                            <tr>
                                {head("name", "Store")}
                                {head("last_active", "Last active")}
                                {head("minutes", "Time in portal", true)}
                                {head("active_days", "Active days", true)}
                                {head("opens", "Portal opens", true)}
                                {head("warranties", "Warranties", true)}
                                {head("verified", "Verified", true)}
                                {head("orders", "Orders", true)}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows === null ? (
                                <tr><td colSpan={8} className="py-16 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin inline mr-2 text-orange-500" />Loading…</td></tr>
                            ) : shown.length === 0 ? (
                                <tr><td colSpan={8} className="py-16 text-center text-slate-400">No stores match.</td></tr>
                            ) : shown.map(r => {
                                const idle = daysSince(r.last_active);
                                return (
                                    <tr key={r.id} onClick={() => setOpen(r)} className="cursor-pointer hover:bg-orange-50/40">
                                        <td className="px-3 py-2.5 max-w-[280px]">
                                            <p className="font-semibold text-slate-900 truncate">{r.name}</p>
                                            <p className="text-[11px] text-slate-400 truncate">{roleLabel(r)}{r.city ? ` · ${r.city}` : ""}{r.state ? `, ${r.state}` : ""}</p>
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">
                                            <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium",
                                                idle <= 7 ? "text-emerald-700" : idle <= 14 ? "text-amber-700" : "text-rose-600")}>
                                                <span className={cn("h-1.5 w-1.5 rounded-full", idle <= 7 ? "bg-emerald-500" : idle <= 14 ? "bg-amber-500" : "bg-rose-500")} />
                                                {ago(r.last_active)}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{formatMinutes(r.minutes)}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.active_days || "—"}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                                            {r.opens || "—"}{r.login_codes ? <span className="block text-[10px] text-slate-400">{r.login_codes} code{r.login_codes === 1 ? "" : "s"}</span> : null}
                                        </td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.warranties || "—"}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.verified || "—"}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                                            {r.orders || "—"}{r.is_distributor && r.incoming ? <span className="block text-[10px] text-violet-600">{r.incoming} received</span> : null}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {rows && <p className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">{shown.length} of {rows.length} stores · tap a store for its timeline</p>}
            </div>

            <Sheet open={Boolean(open)} onOpenChange={o => { if (!o) setOpen(null); }}>
                <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
                    {open && (
                        <>
                            <SheetHeader className="text-left mb-4">
                                <SheetTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-orange-500" /> {open.name}</SheetTitle>
                                <SheetDescription>{roleLabel(open)}{open.city ? ` · ${open.city}` : ""}{open.state ? `, ${open.state}` : ""}</SheetDescription>
                            </SheetHeader>
                            <StoreActivityPanel vendorId={open.id} initialRange={range} />
                        </>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
};
