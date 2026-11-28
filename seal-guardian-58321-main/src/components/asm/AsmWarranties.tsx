import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Loader2, Minus, Search, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { displayName } from "@/lib/asmStores";
import { AsmStoreDetail } from "./AsmStoreDetail";
import { StorePulse } from "./StorePulse";
import { AsmSelect } from "./AsmSelect";
import { AsmOldWarranties } from "./AsmOldWarranties";

/**
 * Warranties for the ASM, built around their stores: how the period compares
 * with the one before, the 12-month trend, each store's numbers and where it
 * is heading, and why warranties were rejected. Any store's numbers open its
 * warranties one by one; the "All warranties" tab searches them all.
 *
 * Colours: the trend's three series are statuses (approved / awaiting /
 * rejected), so they use the reserved status colours, with a legend and a
 * tooltip; ups and downs carry an arrow as well as a colour.
 */

type PeriodId = "mtd" | "last_month" | "last_90" | "custom";
const PERIODS: { id: PeriodId; label: string }[] = [
    { id: "mtd", label: "This month" },
    { id: "last_month", label: "Last month" },
    { id: "last_90", label: "Last 90 days" },
    { id: "custom", label: "Custom dates" },
];
/** What the server is asked for: a named period, or custom with its two days. */
type PeriodQuery = { period: PeriodId; from?: string; to?: string };
/** Today in India as YYYY-MM-DD, the latest day the date pickers allow. */
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
type Segment = "growing" | "dropping" | "silent" | "steady" | "new";
type StoreStat = {
    store_id: string; store_name: string; city: string | null; live: boolean; weekly: number[]; last_warranty: string | null;
    current: number; previous: number; change: number | null; approved: number; rejected: number; pending: number; approval_rate: number | null; segment: Segment;
};
type Stats = {
    period: { id: PeriodId; label: string; prevLabel: string; from: string; to: string };
    totals: { current: number; previous: number; change: number | null; approved: number; rejected: number; pending: number; approval_rate: number | null; active_stores: number };
    stores: StoreStat[];
    trend: { month: string; approved: number; rejected: number; pending: number }[];
    reasons: { reason: string; n: number; stores: number }[];
};

const fmt = (n: number) => n.toLocaleString("en-IN");
const dateText = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const monthShort = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
const daysSince = (d: string | null) => (d ? Math.round((Date.now() + 5.5 * 3600_000 - Date.parse(`${d}T00:00:00Z`)) / 86400000) : null);
const STATUS_COLOR = { approved: "#0aac23", pending: "#fbb315", rejected: "#dc3c3d" };

/** Up / down / flat, with an arrow so it never relies on colour alone. */
function Change({ v, flat = 5 }: { v: number | null; flat?: number }) {
    if (v === null) return <span className="text-xs text-slate-400">—</span>;
    const Icon = v > flat ? ArrowUpRight : v < -flat ? ArrowDownRight : Minus;
    return (
        <span className={cn("inline-flex items-center gap-0.5 text-xs font-bold tabular-nums", v > flat ? "text-emerald-700" : v < -flat ? "text-red-700" : "text-slate-500")}>
            <Icon className="h-3.5 w-3.5" aria-hidden />{v > 0 ? "+" : ""}{v}%
        </span>
    );
}

export function AsmWarranties() {
    const [tab, setTab] = useState<"stores" | "list" | "old">("stores");
    const [period, setPeriod] = useState<PeriodId>("mtd");
    /* Custom dates: what is typed, and what was applied (the numbers follow only the applied range). */
    const [draft, setDraft] = useState(() => ({ from: `${istToday().slice(0, 8)}01`, to: istToday() }));
    const [range, setRange] = useState(draft);
    const draftOk = Boolean(draft.from && draft.to && draft.from <= draft.to && draft.to <= istToday());
    const query = useMemo<PeriodQuery>(() => (period === "custom" ? { period, ...range } : { period }), [period, range]);
    const [listFilter, setListFilter] = useState<{ store?: string; storeName?: string; status?: "pending" | "validated" | "rejected" }>({});
    const [openId, setOpenId] = useState<string | null>(null);
    const openStore = (id: string | null) => { setOpenId(id); document.getElementById("main-dashboard-content-area")?.scrollTo({ top: 0 }); };
    const showList = (f: typeof listFilter) => { setListFilter(f); setTab("list"); document.getElementById("main-dashboard-content-area")?.scrollTo({ top: 0 }); };

    if (openId) return <AsmStoreDetail storeId={openId} onBack={() => openStore(null)} />;
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-full bg-white p-1 ring-1 ring-slate-200" role="tablist">
                    {([["stores", "By store"], ["list", "All warranties"], ["old", "Old warranties"]] as const).map(([k, l]) => (
                        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); if (k === "list") setListFilter({}); }}
                            className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", tab === k ? "bg-orange-500 text-white" : "text-slate-600 hover:bg-orange-50")}>{l}</button>
                    ))}
                </div>
                {tab !== "old" && <AsmSelect value={period} onChange={v => setPeriod(v as PeriodId)} label="Period" className="ml-auto"
                    options={PERIODS.map(p => ({ value: p.id, label: p.label }))} />}
            </div>
            {tab !== "old" && period === "custom" && (
                <form onSubmit={e => { e.preventDefault(); if (draftOk) setRange(draft); }}
                    className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                    <CalendarDays className="mb-2 hidden h-4 w-4 text-orange-500 sm:block" aria-hidden />
                    {(["from", "to"] as const).map(k => (
                        <label key={k} className="min-w-0 flex-1 sm:flex-none">
                            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k === "from" ? "From" : "To"}</span>
                            <input type="date" value={draft[k]} max={istToday()} min={k === "to" ? draft.from : undefined}
                                onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                                className="h-9 w-full rounded-full border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-200 sm:w-44" />
                        </label>
                    ))}
                    <button type="submit" disabled={!draftOk || (draft.from === range.from && draft.to === range.to)}
                        className="h-9 w-full rounded-full bg-orange-500 px-5 text-sm font-semibold text-white shadow-sm hover:bg-orange-600 disabled:opacity-40 sm:w-auto">Apply</button>
                    {!draftOk && draft.from && draft.to && <p className="w-full text-xs text-red-600">The start must be on or before the end, and not after today.</p>}
                </form>
            )}
            {tab === "old" ? <AsmOldWarranties onOpenStore={openStore} /> : tab === "stores"
                ? <ByStore period={query} onOpenStore={openStore} onShowList={showList} />
                : <WarrantyList period={query} filter={listFilter} onClearStore={() => setListFilter(f => ({ ...f, store: undefined, storeName: undefined }))} onOpenStore={openStore} />}
        </div>
    );
}

/* ---------------- By store ---------------- */

const SEGMENTS: { id: "all" | Segment | "rejections"; label: string; test: (s: StoreStat) => boolean; hint: string }[] = [
    { id: "all", label: "All stores", test: () => true, hint: "" },
    { id: "dropping", label: "Dropping", test: s => s.segment === "dropping", hint: "Registering clearly fewer than the period before." },
    { id: "silent", label: "Silent", test: s => s.live && s.segment === "silent", hint: "Live stores with no warranty this period." },
    { id: "rejections", label: "With rejections", test: s => s.rejected > 0, hint: "Stores that had warranties rejected this period." },
    { id: "growing", label: "Growing", test: s => s.segment === "growing" || s.segment === "new", hint: "Registering clearly more, or started this period." },
];
const SORTS: { id: string; label: string; cmp: (a: StoreStat, b: StoreStat) => number }[] = [
    { id: "most", label: "Most warranties", cmp: (a, b) => b.current - a.current || b.previous - a.previous },
    { id: "drop", label: "Biggest drop", cmp: (a, b) => (a.current - a.previous) - (b.current - b.previous) },
    { id: "rejected", label: "Most rejected", cmp: (a, b) => b.rejected - a.rejected || b.current - a.current },
    { id: "quiet", label: "Longest since a warranty", cmp: (a, b) => (daysSince(b.last_warranty) ?? 9999) - (daysSince(a.last_warranty) ?? 9999) },
];

function ByStore({ period, onOpenStore, onShowList }: { period: PeriodQuery; onOpenStore: (id: string) => void; onShowList: (f: { store?: string; storeName?: string; status?: "pending" | "validated" | "rejected" }) => void }) {
    const { toast } = useToast();
    const [d, setD] = useState<Stats | null>(null);
    const [seg, setSeg] = useState<(typeof SEGMENTS)[number]["id"]>("all");
    const [sort, setSort] = useState("most");
    const [q, setQ] = useState("");
    useEffect(() => {
        setD(null);
        api.get("/asm-portal/warranty-stats", { params: period }).then(r => setD(r.data))
            .catch(e => toast({ title: "Could not load the warranty numbers", description: getErrorMessage(e, "Try again"), variant: "destructive" }));
    }, [period, toast]);
    const trend = useMemo(() => {
        const t = d?.trend ?? [];
        const first = t.findIndex(m => m.approved + m.rejected + m.pending > 0);
        return (first < 0 ? [] : t.slice(first)).map(m => ({ ...m, label: monthShort(m.month) }));
    }, [d]);
    const rows = useMemo(() => {
        const s = SEGMENTS.find(x => x.id === seg)!;
        const text = q.trim().toLowerCase();
        return (d?.stores ?? []).filter(x => s.test(x) && (!text || `${x.store_name} ${x.city ?? ""}`.toLowerCase().includes(text))).sort(SORTS.find(x => x.id === sort)!.cmp);
    }, [d, seg, sort, q]);
    if (!d) return <div className="flex items-center justify-center gap-3 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-orange-500" />Loading…</div>;
    const t = d.totals;
    const live = d.stores.filter(s => s.live).length;
    const tiles = [
        { label: "Warranties registered", value: fmt(t.current), extra: <><Change v={t.change} /> <span className="text-xs text-slate-400">vs {fmt(t.previous)} in {d.period.prevLabel}</span></> },
        { label: "Approval rate", value: t.approval_rate === null ? "—" : `${t.approval_rate}%`, extra: <span className="text-xs text-slate-400">{fmt(t.approved)} approved of {fmt(t.approved + t.rejected)} decided</span> },
        { label: "Rejected", value: fmt(t.rejected), tone: t.rejected ? "text-red-600" : undefined, extra: <span className="text-xs text-slate-400">{t.pending ? `${fmt(t.pending)} still awaiting approval` : "none awaiting approval"}</span>, onClick: t.rejected ? () => onShowList({ status: "rejected" }) : undefined },
        { label: "Stores registering", value: `${t.active_stores} of ${live}`, extra: <span className="text-xs text-slate-400">live stores with at least one warranty</span> },
    ];
    const segInfo = SEGMENTS.find(x => x.id === seg)!;
    return (
        <div className="space-y-4">
            <p className="text-xs text-slate-500">{d.period.label}, compared with {d.period.prevLabel}.</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {tiles.map(x => {
                    const body = (
                        <>
                            <p className={cn("text-2xl font-black tabular-nums text-slate-900", x.tone)}>{x.value}</p>
                            <p className="text-sm font-bold text-slate-600">{x.label}</p>
                            <p className="mt-0.5">{x.extra}</p>
                        </>
                    );
                    return x.onClick
                        ? <button key={x.label} type="button" onClick={x.onClick} className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm hover:border-orange-200">{body}</button>
                        : <div key={x.label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">{body}</div>;
                })}
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <p className="text-sm font-black text-slate-800">Warranties each month</p>
                    <p className="mb-2 text-xs text-slate-500">All your stores together, by what head office decided.</p>
                    <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={trend} margin={{ top: 4, right: 8, left: -14, bottom: 0 }} barCategoryGap="22%">
                                <CartesianGrid vertical={false} stroke="#e7e7e7" />
                                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#666666" }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: "#666666" }} axisLine={false} tickLine={false} allowDecimals={false} />
                                <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} formatter={(v: number, n: string) => [fmt(v), n]} />
                                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => <span style={{ color: "#666666" }}>{v}</span>} />
                                <Bar isAnimationActive={false} dataKey="approved" name="Approved" stackId="w" fill={STATUS_COLOR.approved} stroke="#ffffff" strokeWidth={1} />
                                <Bar isAnimationActive={false} dataKey="pending" name="Awaiting approval" stackId="w" fill={STATUS_COLOR.pending} stroke="#ffffff" strokeWidth={1} />
                                <Bar isAnimationActive={false} dataKey="rejected" name="Rejected" stackId="w" fill={STATUS_COLOR.rejected} stroke="#ffffff" strokeWidth={1} radius={[3, 3, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <p className="text-sm font-black text-slate-800">Why warranties were rejected</p>
                    <p className="mb-3 text-xs text-slate-500">{d.period.label}. Coach the stores on these before they register.</p>
                    {!d.reasons.length ? <p className="py-6 text-center text-sm text-slate-500">Nothing rejected in this period.</p> : (
                        <ul className="space-y-2.5">
                            {d.reasons.map(r => {
                                const max = d.reasons[0].n || 1;
                                return (
                                    <li key={r.reason} className="text-sm">
                                        <div className="flex justify-between gap-3"><span className="text-slate-700">{r.reason}</span><span className="shrink-0 font-semibold tabular-nums text-slate-900">{fmt(r.n)}</span></div>
                                        <div className="mt-1 flex items-center gap-2">
                                            <span className="h-1.5 flex-1 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-[#dc3c3d]" style={{ width: `${(r.n / max) * 100}%` }} /></span>
                                            <span className="shrink-0 text-[11px] text-slate-400">{r.stores} store{r.stores === 1 ? "" : "s"}</span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                    {SEGMENTS.map(s => {
                        const n = d.stores.filter(s.test).length;
                        return (
                            <button key={s.id} type="button" onClick={() => setSeg(s.id)} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", seg === s.id ? "bg-orange-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-orange-50")}>
                                {s.label} <span className="tabular-nums opacity-80">{n}</span>
                            </button>
                        );
                    })}
                    </div>
                    {/* Search and sort share a row, on a phone too. */}
                    <div className="flex w-full items-center gap-2 lg:ml-auto lg:w-auto">
                        <div className="relative min-w-0 flex-1 lg:w-56 lg:flex-none"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store or city" className="h-9 rounded-full border-slate-200 pl-9 shadow-sm focus-visible:ring-orange-200 focus-visible:ring-offset-0" aria-label="Search store or city" /></div>
                        <AsmSelect value={sort} onChange={setSort} label="Sort stores" className="max-w-[48%] shrink-0"
                            options={SORTS.map(s => ({ value: s.id, label: s.label }))} />
                    </div>
                </div>
                {segInfo.hint && <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">{segInfo.hint}</p>}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500">
                            <tr>
                                <th className="px-4 py-2">Store</th>
                                <th className="px-3 py-2">Last 12 weeks</th>
                                <th className="px-3 py-2 text-right">This period</th>
                                <th className="px-3 py-2 text-right">Before</th>
                                <th className="px-3 py-2">Change</th>
                                <th className="px-3 py-2 text-right">Approval rate</th>
                                <th className="px-3 py-2 text-right">Rejected</th>
                                <th className="px-3 py-2">Last warranty</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.map(s => {
                                const since = daysSince(s.last_warranty);
                                return (
                                    <tr key={s.store_id} className="hover:bg-slate-50/60">
                                        <td className="px-4 py-2.5">
                                            <button type="button" onClick={() => onOpenStore(s.store_id)} className="text-left font-semibold text-slate-900 hover:text-orange-600 hover:underline">{displayName(s.store_name)}</button>
                                            <span className="block text-xs text-slate-400">{s.city}{!s.live && " · not live"}</span>
                                        </td>
                                        <td className="w-32 px-3 py-2.5"><StorePulse weekly={s.weekly} muted={!s.live} /></td>
                                        <td className="px-3 py-2.5 text-right">
                                            {s.current
                                                ? <button type="button" onClick={() => onShowList({ store: s.store_id, storeName: s.store_name })} className="font-bold tabular-nums text-slate-900 underline decoration-slate-300 underline-offset-2 hover:text-orange-600" title="See these warranties">{fmt(s.current)}</button>
                                                : <span className="tabular-nums text-slate-400">0</span>}
                                        </td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{fmt(s.previous)}</td>
                                        <td className="px-3 py-2.5">{s.segment === "new" ? <span className="text-xs font-bold text-emerald-700">Started</span> : s.segment === "silent" && s.previous ? <span className="text-xs font-bold text-red-700">Stopped</span> : <Change v={s.change} flat={s.segment === "steady" ? 1000 : 5} />}</td>
                                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{s.approval_rate === null ? "—" : `${s.approval_rate}%`}</td>
                                        <td className="px-3 py-2.5 text-right">
                                            {s.rejected
                                                ? <button type="button" onClick={() => onShowList({ store: s.store_id, storeName: s.store_name, status: "rejected" })} className="font-bold tabular-nums text-red-700 underline decoration-red-200 underline-offset-2" title="See why">{s.rejected}</button>
                                                : <span className="tabular-nums text-slate-300">0</span>}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">{since === null ? "Never" : since === 0 ? "Today" : since === 1 ? "Yesterday" : `${since} days ago`}</td>
                                    </tr>
                                );
                            })}
                            {!rows.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No stores here.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

/* ---------------- All warranties (one by one) ---------------- */

type Status = "all" | "pending" | "validated" | "rejected";
type Row = {
    uid: string; status: "pending" | "validated" | "rejected"; rejection_reason: string | null; registered: string | null; decided: string | null;
    warranty_type: string | null; product: string | null; customer: string | null; phone: string;
    car: string | null; registration_number: string | null; fitted_by: string | null; store_id: string; store_name: string; city: string | null;
};
type ListData = { page: number; pages: number; counts: Record<Status, number>; warranties: Row[] };
const STATUS: Record<Row["status"], { label: string; tone: string }> = {
    pending: { label: "Awaiting approval", tone: "bg-amber-50 text-amber-800" },
    validated: { label: "Approved", tone: "bg-emerald-50 text-emerald-800" },
    rejected: { label: "Rejected", tone: "bg-red-50 text-red-700" },
};

function WarrantyList({ period, filter, onClearStore, onOpenStore }: {
    period: PeriodQuery; filter: { store?: string; storeName?: string; status?: "pending" | "validated" | "rejected" };
    onClearStore: () => void; onOpenStore: (id: string) => void;
}) {
    const { toast } = useToast();
    const [status, setStatus] = useState<Status>(filter.status ?? "all");
    const [q, setQ] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [d, setD] = useState<ListData | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => { setStatus(filter.status ?? "all"); setPage(1); }, [filter.status, filter.store]);
    useEffect(() => { const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 400); return () => clearTimeout(t); }, [q]);
    useEffect(() => { setPage(1); }, [period]);
    useEffect(() => {
        setLoading(true);
        api.get("/asm-portal/warranties", { params: { ...period, ...(status !== "all" ? { status } : {}), ...(filter.store ? { store: filter.store } : {}), ...(query ? { q: query } : {}), page } })
            .then(r => setD(r.data))
            .catch(e => toast({ title: "Could not load the warranties", description: getErrorMessage(e, "Try again"), variant: "destructive" }))
            .finally(() => setLoading(false));
    }, [period, status, filter.store, query, page, toast]);
    const c = d?.counts ?? { all: 0, pending: 0, validated: 0, rejected: 0 };
    const tabs: [Status, string][] = [["all", "All"], ["pending", "Awaiting approval"], ["validated", "Approved"], ["rejected", "Rejected"]];
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                {filter.store && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1.5 text-sm font-semibold text-orange-800 ring-1 ring-orange-200">
                        {displayName(filter.storeName ?? "Store")}
                        <button type="button" onClick={onClearStore} aria-label="Show all stores" className="rounded-full p-0.5 hover:bg-orange-100"><X className="h-3.5 w-3.5" /></button>
                    </span>
                )}
                {tabs.map(([k, l]) => (
                    <button key={k} type="button" onClick={() => { setStatus(k); setPage(1); }} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", status === k ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50")}>
                        {l} <span className="tabular-nums opacity-80">{fmt(c[k])}</span>
                    </button>
                ))}
                <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="UID, customer or car number" className="h-9 rounded-full border-slate-200 pl-9 shadow-sm focus-visible:ring-orange-200 focus-visible:ring-offset-0" aria-label="Search by UID, customer or car number" /></div>
            </div>
            <div className="relative overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>}
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Registered</th><th className="px-3 py-2">Store</th><th className="px-3 py-2">Customer &amp; car</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Status</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                        {(d?.warranties ?? []).map(w => (
                            <tr key={w.uid} className="align-top">
                                <td className="whitespace-nowrap px-4 py-2.5 text-xs"><span className="font-semibold text-slate-900">{dateText(w.registered)}</span><span className="block font-mono text-slate-400">{w.uid}</span></td>
                                <td className="px-3 py-2.5">
                                    <button type="button" onClick={() => onOpenStore(w.store_id)} className="text-left font-semibold text-slate-900 hover:text-orange-600 hover:underline">{displayName(w.store_name)}</button>
                                    <span className="block text-xs text-slate-400">{[w.city, w.fitted_by && `fitted by ${w.fitted_by}`].filter(Boolean).join(" · ")}</span>
                                </td>
                                <td className="px-3 py-2.5 text-xs text-slate-700">{w.customer || "—"}{w.phone && <span className="ml-1 font-mono text-slate-400">{w.phone}</span>}<span className="block text-slate-500">{[w.registration_number, w.car].filter(Boolean).join(" · ") || "—"}</span></td>
                                <td className="px-3 py-2.5 text-xs text-slate-700">{w.product || "—"}{w.warranty_type && <span className="block text-slate-400">{w.warranty_type}</span>}</td>
                                <td className="px-3 py-2.5 text-xs">
                                    <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 font-bold", STATUS[w.status]?.tone)}>{STATUS[w.status]?.label ?? w.status}</span>
                                    {w.status === "rejected" && w.rejection_reason && <span className="mt-1 block max-w-[260px] text-red-700">{w.rejection_reason}</span>}
                                    {w.decided && w.status !== "pending" && <span className="mt-0.5 block text-slate-400">{dateText(w.decided)}</span>}
                                </td>
                            </tr>
                        ))}
                        {!loading && !(d?.warranties.length) && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No warranties here.</td></tr>}
                    </tbody>
                </table>
            </div>
            {d && d.pages > 1 && (
                <div className="flex items-center justify-end gap-2 text-sm">
                    <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                    <span className="tabular-nums text-slate-600">Page {page} of {d.pages}</span>
                    <button type="button" disabled={page >= d.pages} onClick={() => setPage(p => p + 1)} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
                </div>
            )}
        </div>
    );
}
