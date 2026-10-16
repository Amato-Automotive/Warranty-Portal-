import { useState, useEffect, useMemo, useCallback } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { Loader2, PhoneIncoming, Phone, Copy, TrendingUp, TrendingDown } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

/**
 * The store's own leads, and how each one is going.
 *
 * A lead appears here once the store was actually sent it — the customer
 * picked the store on WhatsApp, or Autoform sent it after a call. The status
 * is the auditor's, who calls every customer back; the store sees how its
 * leads end without having to ask. Read-only: the store does not change a
 * lead from here.
 *
 * Never shown: the auditor's reason or internal notes, or which other stores
 * the customer was offered — the server does not send them.
 */

/* An outcome from the admin's list, or "pending" before anyone has called. */
type Status = string;

interface StoreLead {
    id: string;
    received: string | null;     // "2026-09-30 14:05", IST
    customer_name: string | null;
    customer_phone: string | null;
    product: string | null;
    car: string | null;
    pincode: string | null;
    state: string | null;
    via: "customer" | "autoform";
    status: Status;
    status_at: string | null;
    /* Which group the outcome counts in, set by the admin (Lead settings). */
    group?: Group;
}

/*
 * How a lead ended, in five groups for the bar and the filter. The four call
 * outcomes that mean "we could not get through" are one group: to a store
 * they mean the same thing.
 *
 * Colours: won, follow up and lost were checked with the dataviz validator
 * (colour-blind separation and contrast pass); the two greys are not results,
 * so they stay grey on purpose, and every part carries its name and count.
 */
type Group = "won" | "follow" | "lost" | "noanswer" | "pending";
const GROUPS: { key: Group; label: string; color: string }[] = [
    { key: "won", label: "Won", color: "#047857" },
    { key: "follow", label: "Follow up", color: "#d97706" },
    { key: "lost", label: "Lost", color: "#e11d48" },
    { key: "noanswer", label: "No answer", color: "#64748b" },
    { key: "pending", label: "Not called yet", color: "#cbd5e1" },
];
const groupOf = (l: { status: Status; group?: Group }): Group => l.group ?? (
    l.status === "closed_won" ? "won" : l.status === "follow_up" ? "follow" : l.status === "closed_lost" ? "lost" : l.status === "pending" ? "pending" : "noanswer");

const PERIODS = [
    { key: "30", label: "Last 30 days" },
    { key: "month", label: "This month" },
    { key: "last-month", label: "Last month" },
    { key: "all", label: "All time" },
    { key: "custom", label: "Custom" },
] as const;
type Period = typeof PERIODS[number]["key"];

/* Today in IST, as "YYYY-MM-DD" — the leads' times are IST too. */
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

const DAY = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
const shortDay = (day: string) => new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/* The first and last day of a period, IST, both included. */
function periodBounds(period: Period, from: string, to: string, firstLead: string | null): { start: string; end: string } {
    const today = istToday();
    if (period === "30") return { start: addDays(today, -29), end: today };
    if (period === "month") return { start: today.slice(0, 8) + "01", end: today };
    if (period === "last-month") {
        const lastOfPrev = addDays(today.slice(0, 8) + "01", -1);
        return { start: lastOfPrev.slice(0, 8) + "01", end: lastOfPrev };
    }
    const start = (period === "custom" && from) ? from : (firstLead ?? today);
    const end = (period === "custom" && to) ? to : today;
    return start <= end ? { start, end } : { start: end, end: start };
}

const dayOf = (l: StoreLead) => (l.received ?? "").slice(0, 10);

const formatReceived = (r: string | null) => {
    if (!r) return "—";
    const [d, t] = r.split(" ");
    const date = new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
    if (!t) return date;
    const [h, min] = t.split(":").map(Number);
    return `${date}, ${((h + 11) % 12) + 1}:${String(min).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

const formatPhone = (p: string | null) => {
    const ten = String(p ?? "").replace(/\D/g, "").slice(-10);
    return ten.length === 10 ? `${ten.slice(0, 5)} ${ten.slice(5)}` : (p || "—");
};

/** Where the page opens: the home's tiles open it on their own period or status. */
export interface LeadsView { period?: Period; from?: string; to?: string; status?: "all" | Group }

export const FranchiseLeads = ({ initial }: { initial?: LeadsView } = {}) => {
    const { toast } = useToast();
    const { t, tr } = useLanguage();
    const [leads, setLeads] = useState<StoreLead[]>([]);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<Period>(initial?.period ?? "30");
    const [from, setFrom] = useState(initial?.from ?? "");
    const [to, setTo] = useState(initial?.to ?? "");
    const [status, setStatus] = useState<"all" | Group>(initial?.status ?? "all");

    const load = useCallback((quiet = false) => {
        return api.get("/vendor/leads")
            .then(res => setLeads(res.data.leads || []))
            .catch(error => {
                if (quiet) return;
                toast({
                    title: "Could not load your leads",
                    description: getErrorMessage(error, "Please try again in a moment"),
                    variant: "destructive",
                });
            })
            .finally(() => setLoading(false));
    }, [toast]);

    useEffect(() => { load(); }, [load]);

    /* The auditor's updates arrive without anyone here doing anything, so the
       page looks again every minute while it is open. */
    useEffect(() => {
        const id = setInterval(() => { if (document.visibilityState === "visible") load(true); }, 60_000);
        return () => clearInterval(id);
    }, [load]);

    const firstLead = useMemo(() => leads.map(dayOf).filter(Boolean).sort()[0] ?? null, [leads]);
    const bounds = useMemo(() => periodBounds(period, from, to, firstLead), [period, from, to, firstLead]);
    const inRange = useMemo(
        () => leads.filter(l => { const d = dayOf(l); return d >= bounds.start && d <= bounds.end; }),
        [leads, bounds],
    );
    const counts = useMemo(() => {
        const c: Record<string, number> = { all: inRange.length };
        for (const l of inRange) { const g = groupOf(l); c[g] = (c[g] ?? 0) + 1; }
        return c;
    }, [inRange]);
    const shown = status === "all" ? inRange : inRange.filter(l => groupOf(l) === status);

    /* The same length of time just before, for "3 more than the 30 days
       before". All time has nothing before it. */
    const span = daysBetween(bounds.start, bounds.end) + 1;
    const previous = period === "all" ? null : leads.filter(l => {
        const d = dayOf(l);
        return d >= addDays(bounds.start, -span) && d <= addDays(bounds.start, -1);
    }).length;
    const change = previous === null ? null : inRange.length - previous;

    /* Called = the auditor has an outcome; conversion is won out of those. */
    const called = inRange.length - (counts.pending ?? 0);
    const conversion = called ? Math.round(((counts.won ?? 0) / called) * 100) : null;

    /* Leads over time: by day for up to ~6 weeks, by week (from Monday) beyond. */
    const weekly = span > 45;
    const buckets = useMemo(() => {
        const out: { key: string; label: string; won: number; other: number }[] = [];
        const index = new Map<string, number>();
        const keyOf = (day: string) => {
            if (!weekly) return day;
            const dow = (new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7;   // Monday = 0
            return addDays(day, -dow);
        };
        for (let d = bounds.start; d <= bounds.end && out.length < 400; d = addDays(d, 1)) {
            const k = keyOf(d);
            if (!index.has(k)) {
                index.set(k, out.length);
                out.push({ key: k, label: weekly ? tr(`Week of ${shortDay(k)}`, `${shortDay(k)} का हफ़्ता`) : shortDay(k), won: 0, other: 0 });
            }
        }
        for (const l of inRange) {
            const i = index.get(keyOf(dayOf(l)));
            if (i === undefined) continue;
            if (groupOf(l) === "won") out[i].won++; else out[i].other++;
        }
        return out;
    }, [inRange, bounds, weekly, tr]);
    const spark = buckets.slice(-14);
    const sparkMax = Math.max(1, ...spark.map(b => b.won + b.other));
    const periodName = t(PERIODS.find(p => p.key === period)?.label ?? "").toLowerCase();

    const copy = (phone: string | null) => {
        if (!phone) return;
        navigator.clipboard?.writeText(phone)
            .then(() => toast({ title: t("Number copied"), description: formatPhone(phone) }))
            .catch(() => { /* clipboard blocked: the number is on screen to read */ });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px] gap-3 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                <span className="text-sm font-medium">{t("Loading your leads…")}</span>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-black tracking-tight text-slate-800 uppercase">{t("My Leads")}</h2>
                    <p className="text-sm text-slate-500 mt-1 max-w-2xl">
                        {t("Customers Autoform sent to your store. Our team calls every customer back, and the status shows how each one went.")}
                    </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold">
                    {PERIODS.map(p => (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => setPeriod(p.key)}
                            className={`px-3 py-1.5 rounded-lg transition-colors ${period === p.key ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-800"}`}
                        >
                            {t(p.label)}
                        </button>
                    ))}
                </div>
                {period === "custom" && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <input
                            type="date" value={from} max={to || undefined}
                            onChange={e => setFrom(e.target.value)} aria-label={t("From")}
                            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
                        />
                        <span>{t("to")}</span>
                        <input
                            type="date" value={to} min={from || undefined}
                            onChange={e => setTo(e.target.value)} aria-label={t("To")}
                            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
                        />
                    </div>
                )}
                </div>
            </div>

            {/* Four headline numbers. Leads, Won and To follow up also filter the list. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <button type="button" onClick={() => setStatus("all")}
                    className={`rounded-2xl border bg-white p-4 text-left transition-colors ${status === "all" ? "border-orange-300 ring-1 ring-orange-100" : "border-slate-100 hover:border-slate-200"}`}>
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">{t("Leads")}</p>
                    <div className="flex items-end justify-between gap-2 mt-1">
                        <p className={`text-3xl font-black tabular-nums ${inRange.length ? "text-slate-800" : "text-slate-300"}`}>{inRange.length}</p>
                        {/* A tiny trend: the last 14 bars of the chart below. */}
                        <div className="flex items-end gap-[2px] h-8" aria-hidden>
                            {spark.map(b => (
                                <span key={b.key} className="w-1.5 rounded-t-sm bg-slate-300"
                                    style={{ height: `${Math.max(8, ((b.won + b.other) / sparkMax) * 100)}%`, opacity: b.won + b.other ? 1 : 0.35 }} />
                            ))}
                        </div>
                    </div>
                    <p className="text-[11px] mt-1 flex flex-wrap items-center gap-1 text-slate-500">
                        {change === null ? t("since your first lead")
                            : change > 0 ? <><TrendingUp className="h-3 w-3 text-emerald-600" /><span className="font-semibold text-emerald-700">{tr(`${change} more`, `${change} ज़्यादा`)}</span> {tr(`than the ${span === 1 ? "day" : `${span} days`} before`, `(पिछले ${span === 1 ? "दिन" : `${span} दिनों`} से)`)}</>
                            : change < 0 ? <><TrendingDown className="h-3 w-3 text-rose-600" /><span className="font-semibold text-rose-600">{tr(`${-change} fewer`, `${-change} कम`)}</span> {tr(`than the ${span === 1 ? "day" : `${span} days`} before`, `(पिछले ${span === 1 ? "दिन" : `${span} दिनों`} से)`)}</>
                            : <>{tr(`same as the ${span === 1 ? "day" : `${span} days`} before`, `पिछले ${span === 1 ? "दिन" : `${span} दिनों`} जितनी`)}</>}
                    </p>
                </button>

                <button type="button" onClick={() => setStatus(status === "won" ? "all" : "won")}
                    className={`rounded-2xl border bg-white p-4 text-left transition-colors ${status === "won" ? "border-orange-300 ring-1 ring-orange-100" : "border-slate-100 hover:border-slate-200"}`}>
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">{t("Won")}</p>
                    <p className={`text-3xl font-black tabular-nums mt-1 ${counts.won ? "text-emerald-700" : "text-slate-300"}`}>{counts.won ?? 0}</p>
                    <p className="text-[11px] mt-1 text-slate-500">{tr(`of ${called} customer${called === 1 ? "" : "s"} called`, `कॉल किए गए ${called} ग्राहकों में से`)}</p>
                </button>

                <div className="rounded-2xl border border-slate-100 bg-white p-4">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">{t("Conversion")}</p>
                    <p className={`text-3xl font-black tabular-nums mt-1 ${conversion ? "text-slate-800" : "text-slate-300"}`}>
                        {conversion === null ? "—" : `${conversion}%`}
                    </p>
                    <p className="text-[11px] mt-1 text-slate-500">
                        {conversion === null ? t("once our team has called your leads") : t("won out of customers called")}
                    </p>
                </div>

                <button type="button" onClick={() => setStatus(status === "follow" ? "all" : "follow")}
                    className={`rounded-2xl border p-4 text-left transition-colors ${status === "follow" ? "border-orange-300 ring-1 ring-orange-100 bg-white" : counts.follow ? "border-amber-200 bg-amber-50/50 hover:border-amber-300" : "border-slate-100 bg-white hover:border-slate-200"}`}>
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">{t("To follow up")}</p>
                    <p className={`text-3xl font-black tabular-nums mt-1 ${counts.follow ? "text-amber-600" : "text-slate-300"}`}>{counts.follow ?? 0}</p>
                    <p className="text-[11px] mt-1 text-slate-500">{counts.follow ? t("customers still deciding — call them") : t("nobody waiting")}</p>
                </button>
            </div>

            {/* How the leads ended: one bar, split by outcome. Each part, and its
                label below, filters the list; clicking it again clears. */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <div className="flex items-baseline justify-between gap-2 mb-3">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-800">{t("How your leads ended")}</p>
                    <p className="text-[11px] text-slate-400">{tr(`${inRange.length} lead${inRange.length === 1 ? "" : "s"}`, `${inRange.length} लीड`)} · {periodName}</p>
                </div>
                {inRange.length === 0 ? (
                    <div className="h-3 rounded-full bg-slate-100" />
                ) : (
                    <div className="flex h-3 rounded-full overflow-hidden gap-[2px] bg-white">
                        {GROUPS.filter(g => counts[g.key]).map(g => (
                            <button key={g.key} type="button" title={`${t(g.label)}: ${counts[g.key]}`}
                                onClick={() => setStatus(status === g.key ? "all" : g.key)}
                                className="h-full transition-opacity"
                                style={{ width: `${(counts[g.key] / inRange.length) * 100}%`, background: g.color, opacity: status === "all" || status === g.key ? 1 : 0.3 }} />
                        ))}
                    </div>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
                    {GROUPS.map(g => {
                        const n = counts[g.key] ?? 0;
                        const selected = status === g.key;
                        return (
                            <button key={g.key} type="button" disabled={!n}
                                onClick={() => setStatus(selected ? "all" : g.key)}
                                className={`flex items-center gap-1.5 text-xs rounded-md px-1.5 py-0.5 ${selected ? "bg-orange-50 font-bold" : ""} ${n ? "hover:bg-slate-50" : "opacity-40 cursor-default"}`}>
                                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: g.color }} />
                                <span className="text-slate-700">{t(g.label)}</span>
                                <span className="tabular-nums font-semibold text-slate-800">{n}</span>
                                {inRange.length > 0 && n > 0 && <span className="text-slate-400">{Math.round((n / inRange.length) * 100)}%</span>}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Leads over time, the won part darker. A store with only a couple of
                leads gets a note instead of a near-empty chart. */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <div className="flex items-baseline justify-between gap-2 mb-2">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-800">{t("Leads over time")}</p>
                    <p className="text-[11px] text-slate-400">{weekly ? t("by week") : t("by day")} · {shortDay(bounds.start)} – {shortDay(bounds.end)}</p>
                </div>
                {inRange.length < 3 ? (
                    <p className="text-xs text-slate-400 py-8 text-center">
                        {inRange.length === 0 ? t("No leads in this period.") : t("The chart appears once you have a few more leads in this period.")}
                    </p>
                ) : (
                    <>
                        <div className="h-[180px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={buckets} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap="20%">
                                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                                        interval="preserveStartEnd" minTickGap={18}
                                        tickFormatter={(v: string) => v.replace("Week of ", "").replace(" का हफ़्ता", "")} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40} />
                                    <Tooltip
                                        cursor={{ fill: "#f8fafc" }}
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const b = payload[0].payload as { label: string; won: number; other: number };
                                            const total = b.won + b.other;
                                            return (
                                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm text-xs">
                                                    <p className="font-bold text-slate-800">{b.label} · {tr(`${total} lead${total === 1 ? "" : "s"}`, `${total} लीड`)}</p>
                                                    <p className="text-emerald-700">{t("Won")} {b.won}</p>
                                                </div>
                                            );
                                        }}
                                    />
                                    <Bar dataKey="won" stackId="l" fill="#047857" stroke="#fff" strokeWidth={1} maxBarSize={28} />
                                    <Bar dataKey="other" stackId="l" fill="#cbd5e1" stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-slate-600">
                            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#047857" }} />{t("Won")}</span>
                            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#cbd5e1" }} />{t("Other leads")}</span>
                        </div>
                    </>
                )}
            </div>

            {shown.length === 0 ? (
                <div className="rounded-[32px] border border-dashed border-orange-200 bg-white/40 p-12 text-center">
                    <div className="h-20 w-20 bg-orange-50 rounded-[28px] flex items-center justify-center mx-auto mb-6 border border-orange-100">
                        <PhoneIncoming className="h-9 w-9 text-orange-500 opacity-80" />
                    </div>
                    <h3 className="text-xl font-black tracking-tight text-slate-800 uppercase mb-2">
                        {leads.length === 0 ? t("No leads yet") : t("No leads here")}
                    </h3>
                    <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
                        {leads.length === 0
                            ? t("When a customer picks your store on WhatsApp, or our team sends a customer to you, they will appear here — with how the call went.")
                            : t("Nothing matches this period and outcome. Try another period, or tap Leads to see them all.")}
                    </p>
                </div>
            ) : (
                /* A table in its own box: it scrolls both ways inside the page, with
                   the headings pinned, so a long list never stretches the page and
                   the sideways scrollbar is always on screen. */
                <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
                    <div className="relative w-full overflow-auto max-h-[calc(100vh-320px)]">
                        <table className="w-full text-sm text-left min-w-[680px]">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-700 shadow-[0_1px_0_0_rgb(241,245,249)]">
                                <tr>
                                    <th className="px-4 py-3 w-[130px] text-xs font-bold uppercase tracking-wide">{t("Date")}</th>
                                    <th className="px-4 py-3 w-[190px] text-xs font-bold uppercase tracking-wide">{t("Customer")}</th>
                                    <th className="px-4 py-3 w-[120px] text-xs font-bold uppercase tracking-wide">{t("Product")}</th>
                                    <th className="px-4 py-3 w-[150px] text-xs font-bold uppercase tracking-wide">{t("Car")}</th>
                                    <th className="px-4 py-3 w-[160px] text-xs font-bold uppercase tracking-wide">{t("Area")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {shown.map(l => (
                                    <tr key={l.id} className="hover:bg-orange-50/40 transition-colors">
                                        <td className="px-4 py-3 align-top text-xs text-slate-500 tabular-nums whitespace-nowrap">
                                            {formatReceived(l.received)}
                                        </td>
                                        <td className="px-4 py-3 align-top">
                                            <div className="font-semibold text-slate-800 truncate max-w-[180px]" title={l.customer_name || ""}>
                                                {l.customer_name || t("Customer")}
                                            </div>
                                            <div className="flex items-center gap-1 mt-0.5">
                                                <a href={`tel:${String(l.customer_phone ?? "").replace(/\D/g, "").slice(-10)}`}
                                                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-orange-600 tabular-nums">
                                                    <Phone className="h-3 w-3" /> {formatPhone(l.customer_phone)}
                                                </a>
                                                <button type="button" onClick={() => copy(l.customer_phone)}
                                                    className="p-1 rounded text-slate-400 hover:text-orange-600 hover:bg-orange-50" aria-label={t("Copy number")} title={t("Copy number")}>
                                                    <Copy className="h-3 w-3" />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 align-top text-slate-700">{l.product || <span className="text-slate-300">—</span>}</td>
                                        <td className="px-4 py-3 align-top text-slate-700">
                                            <span className="block truncate max-w-[140px]" title={l.car || ""}>{l.car || <span className="text-slate-300">—</span>}</span>
                                        </td>
                                        <td className="px-4 py-3 align-top text-slate-700">
                                            {l.pincode || l.state ? (
                                                <>
                                                    {l.pincode && <div className="font-mono text-xs">{l.pincode}</div>}
                                                    {l.state && <div className="text-xs text-slate-500">{l.state}</div>}
                                                </>
                                            ) : <span className="text-slate-300">—</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">
                        {tr(`${shown.length} lead${shown.length === 1 ? "" : "s"}`, `${shown.length} लीड`)}
                    </div>
                </div>
            )}
        </div>
    );
};
