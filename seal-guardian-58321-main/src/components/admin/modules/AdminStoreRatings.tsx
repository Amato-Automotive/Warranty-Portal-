import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Loader2, Star } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, downloadCSV } from "@/lib/utils";

/**
 * Store ratings for the admin: the network overview (who is rated how, and who
 * needs attention), and one store against the network. Reads only; ratings are
 * given by customers.
 */

type PeriodKey = "today" | "7" | "15" | "30" | "overall" | "custom";
const PERIODS: [PeriodKey, string][] = [["today", "Today"], ["7", "Last 7 days"], ["15", "Last 15 days"], ["30", "Last 30 days"], ["overall", "Overall"], ["custom", "Custom range"]];
type Split = Record<"1" | "2" | "3" | "4" | "5", number>;
interface Month { month: string; average: number | null; count: number }
interface Row {
    store_id: string; name: string; brand: string; state: string | null; city: string | null; average: number | null; ratings: number;
    period_average: number | null; period_ratings: number; previous_average: number | null; change: number | null; needs_attention: boolean;
}
interface Overview {
    range: { label: string };
    options: { states: string[]; products: string[] };
    summary: { average: number | null; ratings: number; stores_rated: number; stores_total: number; below_low: number; warranties_rated_pct: number | null };
    by_month: Month[]; split: Split; stores: Row[];
}
interface Detail {
    range: { label: string };
    store: { store_id: string; name: string; brand: string; state: string | null; city: string | null };
    average: number | null; ratings: number;
    period: { average: number | null; ratings: number; previous_average: number | null; change: number | null };
    low: { count: number; of: number }; network_average: number | null; split: Split;
    by_month: { month: string; store: number | null; network: number | null }[];
    list: { day: string; stars: number; customer: string; phone: string; product: string | null; warranty_uid: string | null }[];
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toFixed(1));
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Change({ v }: { v: number | null }) {
    if (v === null) return <span className="text-slate-400">–</span>;
    if (v === 0) return <span className="text-slate-500">= 0.0</span>;
    return <span className={cn("font-semibold", v < 0 ? "text-rose-600" : "text-emerald-600")}>{v < 0 ? "▼" : "▲"} {Math.abs(v).toFixed(1)}</span>;
}

/** Month by month averages as a line, with a second line when given. Gaps (no ratings) break the line. */
function Lines({ months, a, b }: { months: string[]; a: (number | null)[]; b?: (number | null)[] }) {
    const W = 520, H = 170, L = 28, R = 12, T = 10, B = 24;
    const lo = 1, hi = 5;
    const x = (i: number) => L + (months.length <= 1 ? 0 : (i * (W - L - R)) / (months.length - 1));
    const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
    const path = (vals: (number | null)[]) => vals.map((v, i) => (v === null ? "" : `${vals.slice(0, i).some(p => p !== null) && vals[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(" ");
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Average by month">
            {[1, 2, 3, 4, 5].map(g => <g key={g}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="#e2e8f0" /><text x={L - 6} y={y(g) + 4} textAnchor="end" fontSize="10" fill="#64748b">{g}</text></g>)}
            {months.map((m, i) => <text key={m} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#64748b">{monthName(m)}</text>)}
            {b && <path d={path(b)} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" />}
            <path d={path(a)} fill="none" stroke="#ea580c" strokeWidth="2.5" />
            {a.map((v, i) => v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="#ea580c" />)}
        </svg>
    );
}

function SplitBars({ split }: { split: Split }) {
    const total = (["1", "2", "3", "4", "5"] as const).reduce((n, k) => n + split[k], 0);
    return (
        <ul className="space-y-1.5">
            {(["5", "4", "3", "2", "1"] as const).map(k => (
                <li key={k} className="flex items-center gap-2 text-sm">
                    <span className="w-8 shrink-0 font-semibold text-slate-700">{k} ★</span>
                    <span className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-orange-500" style={{ width: `${total ? (split[k] / total) * 100 : 0}%` }} /></span>
                    <span className="w-12 shrink-0 text-right tabular-nums text-slate-600">{split[k].toLocaleString("en-IN")}</span>
                </li>
            ))}
        </ul>
    );
}

function Tile({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
    return (
        <div className="bg-white px-4 py-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={cn("text-2xl font-bold tabular-nums", warn && "text-rose-600")}>{value}</p>
            {note && <p className="text-xs text-slate-500">{note}</p>}
        </div>
    );
}

function PeriodPicker({ period, from, to, onChange }: { period: PeriodKey; from: string; to: string; onChange: (p: PeriodKey, f: string, t: string) => void }) {
    return (
        <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs font-semibold text-slate-600">Period
                <select value={period} onChange={e => onChange(e.target.value as PeriodKey, from, to)} className="block h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal text-slate-900">
                    {PERIODS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
            </label>
            {period === "custom" && <>
                <label className="space-y-1 text-xs font-semibold text-slate-600">From<Input type="date" value={from} max={to || undefined} onChange={e => onChange(period, e.target.value, to)} className="h-9 w-40" /></label>
                <label className="space-y-1 text-xs font-semibold text-slate-600">To<Input type="date" value={to} min={from || undefined} onChange={e => onChange(period, from, e.target.value)} className="h-9 w-40" /></label>
            </>}
        </div>
    );
}

const query = (p: PeriodKey, f: string, t: string) => {
    const q = new URLSearchParams({ period: p });
    if (p === "custom" && f && t) { q.set("from", f); q.set("to", t); }
    return q;
};

function StoreView({ id, period, from, to, onBack }: { id: string; period: PeriodKey; from: string; to: string; onBack: () => void }) {
    const { toast } = useToast();
    const [d, setD] = useState<Detail | null>(null);
    const [p, setP] = useState(period); const [f, setF] = useState(from); const [t, setT] = useState(to);
    const [show, setShow] = useState<"all" | "low" | "three" | "high">("all");
    useEffect(() => {
        if (p === "custom" && !(f && t)) return;
        api.get(`/admin/store-ratings/${id}?${query(p, f, t)}`).then(r => setD(r.data))
            .catch(e => toast({ title: "Could not load this store", description: getErrorMessage(e, "Try again"), variant: "destructive" }));
    }, [id, p, f, t, toast]);
    const list = useMemo(() => (d?.list ?? []).filter(r => show === "all" || (show === "low" ? r.stars <= 2 : show === "three" ? r.stars === 3 : r.stars >= 4)), [d, show]);
    if (!d) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    const diff = d.average !== null && d.network_average !== null ? Math.round((d.average - d.network_average) * 10) / 10 : null;
    const count = (fn: (s: number) => boolean) => d.list.filter(r => fn(r.stars)).length;
    const exportRows = () => downloadCSV(list.map(r => ({ Date: r.day, Stars: r.stars, Customer: r.customer, Phone: r.phone, Product: r.product ?? "", Warranty: r.warranty_uid ?? "" })), `ratings_${d.store.name.replace(/\W+/g, "_")}.csv`);
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <button type="button" onClick={onBack} className="mb-1 inline-flex items-center gap-1 text-sm font-semibold text-orange-700 hover:underline"><ArrowLeft className="h-4 w-4" />All stores</button>
                    <h2 className="text-xl font-extrabold text-slate-900">{d.store.name}</h2>
                    <p className="text-sm text-slate-600">{[d.store.brand === "AFAC" ? "AF+AC" : d.store.brand, [d.store.city, d.store.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <PeriodPicker period={p} from={f} to={t} onChange={(a, b, c) => { setP(a); setF(b); setT(c); }} />
                    <Button variant="outline" size="sm" className="h-9" onClick={exportRows} disabled={!list.length}><Download className="mr-1.5 h-4 w-4" />Export this store's ratings</Button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 lg:grid-cols-4">
                <Tile label="Average" value={fmt(d.average)} note={`from ${d.ratings} ratings`} />
                <Tile label={`In the period (${d.range.label.toLowerCase()})`} value={fmt(d.period.average)} note={d.period.change !== null ? `${d.period.change < 0 ? "▼" : d.period.change > 0 ? "▲" : "="} ${Math.abs(d.period.change).toFixed(1)} · ${d.period.ratings} ratings` : `${d.period.ratings} ratings`} warn={d.period.change !== null && d.period.change < 0} />
                <Tile label="Rated 1 or 2 stars" value={String(d.low.count)} note={`of ${d.low.of}`} />
                <Tile label="Network average" value={fmt(d.network_average)} note={diff === null ? undefined : diff === 0 ? "this store matches it" : `this store is ${Math.abs(diff).toFixed(1)} ${diff < 0 ? "below" : "above"}`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="mb-3 text-sm font-bold text-slate-900">How this store's ratings split</h3>
                    <SplitBars split={d.split} />
                </section>
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="mb-1 text-sm font-bold text-slate-900">This store's average by month, against the network</h3>
                    <p className="mb-2 flex gap-4 text-xs text-slate-600"><span><span className="mr-1 inline-block h-0.5 w-4 bg-orange-600 align-middle" />This store</span><span><span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-400 align-middle" />Network</span></p>
                    <Lines months={d.by_month.map(m => m.month)} a={d.by_month.map(m => m.store)} b={d.by_month.map(m => m.network)} />
                </section>
            </div>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                    <h3 className="text-sm font-bold text-slate-900">Every rating</h3>
                    <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
                        {([["all", `All ${d.list.length}`], ["low", `1 to 2 stars · ${count(s => s <= 2)}`], ["three", `3 stars · ${count(s => s === 3)}`], ["high", `4 to 5 stars · ${count(s => s >= 4)}`]] as const).map(([k, text]) => (
                            <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={cn("rounded-md px-2.5 py-1", show === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{text}</button>
                        ))}
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2.5 font-semibold">Date</th><th className="px-3 py-2.5 font-semibold">Stars</th><th className="px-3 py-2.5 font-semibold">Customer</th><th className="px-3 py-2.5 font-semibold">Product</th><th className="px-3 py-2.5 font-semibold">Warranty</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                            {list.map((r, i) => (
                                <tr key={`${r.day}-${r.warranty_uid ?? i}`}>
                                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{dayName(r.day)}</td>
                                    <td className="whitespace-nowrap px-3 py-2 font-semibold">{r.stars} ★</td>
                                    <td className="px-3 py-2">{r.customer}<span className="block text-xs text-slate-500">{r.phone}</span></td>
                                    <td className="px-3 py-2 text-slate-700">{r.product ?? "–"}</td>
                                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.warranty_uid ?? "–"}</td>
                                </tr>
                            ))}
                            {!list.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">{d.ratings ? "No rating matches this filter." : "No ratings yet."}</td></tr>}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

export function AdminStoreRatings() {
    const { toast } = useToast();
    const [period, setPeriod] = useState<PeriodKey>("30");
    const [from, setFrom] = useState(""); const [to, setTo] = useState("");
    const [brand, setBrand] = useState("all"); const [state, setState] = useState("all"); const [product, setProduct] = useState("all"); const [avg, setAvg] = useState("any");
    const [sort, setSort] = useState<"low" | "high" | "most" | "drop">("low");
    const [d, setD] = useState<Overview | null>(null);
    const [open, setOpen] = useState<string | null>(null);

    const load = useCallback(() => {
        if (period === "custom" && !(from && to)) return;
        const q = query(period, from, to);
        if (brand !== "all") q.set("brand", brand); if (state !== "all") q.set("state", state); if (product !== "all") q.set("product", product); if (avg !== "any") q.set("avg", avg);
        api.get(`/admin/store-ratings?${q}`).then(r => setD(r.data))
            .catch(e => toast({ title: "Could not load the ratings", description: getErrorMessage(e, "Try again"), variant: "destructive" }));
    }, [period, from, to, brand, state, product, avg, toast]);
    useEffect(() => { load(); }, [load]);

    const rows = useMemo(() => {
        const list = [...(d?.stores ?? [])];
        const key = (r: Row) => (period === "overall" ? r.average : r.period_average);
        const by = {
            low: (a: Row, b: Row) => (key(a) ?? 99) - (key(b) ?? 99),
            high: (a: Row, b: Row) => (key(b) ?? -1) - (key(a) ?? -1),
            most: (a: Row, b: Row) => b.ratings - a.ratings,
            drop: (a: Row, b: Row) => (a.change ?? 99) - (b.change ?? 99),
        }[sort];
        return list.sort((a, b) => by(a, b) || a.name.localeCompare(b.name));
    }, [d, sort, period]);

    if (open) return <StoreView id={open} period={period} from={from} to={to} onBack={() => setOpen(null)} />;

    const exportRows = () => downloadCSV(rows.map(r => ({
        Store: r.name, Brand: r.brand, State: r.state ?? "", City: r.city ?? "", "Average": r.average ?? "", "Ratings": r.ratings,
        "Average in the period": r.period_average ?? "", "Ratings in the period": r.period_ratings, "Average before": r.previous_average ?? "", "Change": r.change ?? "", "Needs attention": r.needs_attention ? "Yes" : "",
    })), "store_ratings.csv");
    const select = (label: string, value: string, set: (v: string) => void, options: [string, string][]) => (
        <label className="space-y-1 text-xs font-semibold text-slate-600">{label}
            <select value={value} onChange={e => set(e.target.value)} className="block h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal text-slate-900">
                {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
        </label>
    );
    const s = d?.summary;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-xl font-extrabold text-slate-900"><Star className="h-5 w-5 text-orange-500" />Store ratings</h2>
                    <p className="text-sm text-slate-600">What customers rated their store, across the network</p>
                </div>
                <Button variant="outline" size="sm" className="h-9" onClick={exportRows} disabled={!rows.length}><Download className="mr-1.5 h-4 w-4" />Export CSV</Button>
            </div>

            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <PeriodPicker period={period} from={from} to={to} onChange={(p, f, t) => { setPeriod(p); setFrom(f); setTo(t); }} />
                {select("Brand", brand, setBrand, [["all", "All"], ["AF", "AF"], ["AC", "AC"], ["AFAC", "AFAC"]])}
                {select("State", state, setState, [["all", "All states"], ...(d?.options.states ?? []).map(x => [x, x] as [string, string])])}
                {select("Product", product, setProduct, [["all", "All products"], ...(d?.options.products ?? []).map(x => [x, x] as [string, string])])}
                {select("Average", avg, setAvg, [["any", "Any"], ["below4", "Below 4.0"], ["4to45", "4.0 to 4.5"], ["above45", "Above 4.5"]])}
            </div>

            {!d || !s ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div> : (
                <>
                    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 lg:grid-cols-4">
                        <Tile label="Network average" value={fmt(s.average)} note={`from ${s.ratings.toLocaleString("en-IN")} ratings`} />
                        <Tile label="Stores rated" value={String(s.stores_rated)} note={`of ${s.stores_total} stores`} />
                        <Tile label="Below 4.0 average" value={String(s.below_low)} note="stores" warn={s.below_low > 0} />
                        <Tile label="Warranties rated" value={s.warranties_rated_pct === null ? "–" : `${s.warranties_rated_pct}%`} note="of registered" />
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <section className="rounded-xl border border-slate-200 bg-white p-4">
                            <h3 className="mb-2 text-sm font-bold text-slate-900">Network average by month</h3>
                            <Lines months={d.by_month.map(m => m.month)} a={d.by_month.map(m => m.average)} />
                        </section>
                        <section className="rounded-xl border border-slate-200 bg-white p-4">
                            <h3 className="mb-3 text-sm font-bold text-slate-900">How the ratings split</h3>
                            <SplitBars split={d.split} />
                        </section>
                    </div>

                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                            <h3 className="text-sm font-bold text-slate-900">Stores · {rows.length}</h3>
                            {select("Sort by", sort, v => setSort(v as typeof sort), [["low", "Lowest average first"], ["high", "Highest average first"], ["most", "Most ratings"], ["drop", "Biggest drop"]])}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[820px] text-sm">
                                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                                    <tr><th className="px-3 py-2.5 font-semibold">Store</th><th className="px-3 py-2.5 font-semibold">Brand</th><th className="px-3 py-2.5 font-semibold">State</th><th className="px-3 py-2.5 text-right font-semibold">Average</th><th className="px-3 py-2.5 text-right font-semibold">Ratings</th><th className="px-3 py-2.5 text-right font-semibold">In the period</th><th className="px-3 py-2.5 text-right font-semibold">Change vs the period before</th><th className="px-3 py-2.5 font-semibold">Flag</th></tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {rows.map(r => (
                                        <tr key={r.store_id} className="cursor-pointer hover:bg-orange-50/40" onClick={() => setOpen(r.store_id)}>
                                            <td className="px-3 py-2 font-semibold text-slate-900">{r.name}</td>
                                            <td className="px-3 py-2 text-slate-600">{r.brand}</td>
                                            <td className="px-3 py-2 text-slate-600">{r.state ?? "–"}</td>
                                            <td className="px-3 py-2 text-right font-bold tabular-nums">{fmt(r.average)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums">{r.ratings}</td>
                                            <td className="px-3 py-2 text-right tabular-nums">{fmt(r.period_average)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums"><Change v={r.change} /></td>
                                            <td className="px-3 py-2">{r.needs_attention && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">Needs attention</span>}</td>
                                        </tr>
                                    ))}
                                    {!rows.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">No store matches.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
