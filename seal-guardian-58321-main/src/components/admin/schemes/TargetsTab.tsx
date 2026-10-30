import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORE_BRAND_FILTER, storeBrand } from "@/lib/brand";
import * as XLSX from "xlsx";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Download, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    BASIS_LABEL, averageOn, formatMonth, growthTarget,
    type AverageBasis, type Averages, type Period, type Scheme, type SchemeSettings, type TargetFigures, type TargetStore,
} from "@/lib/schemes";

/**
 * A target scheme ("More You Sell, Less It Costs") for the admin, as plain
 * steps: (1) details, in the scheme form; (2) choose the franchises, each with
 * its warranty average; (3) give each a growth % — the target works itself
 * out — and a reward, then start it; and the results while it runs: who has
 * reached, who is on track, who is behind, and which rewards are to pay.
 */

interface Franchise {
    id: string; code: string | null; name: string; city: string | null; state: string | null; brand?: string;
    averages: Averages | null; last_month: number | null; best_month: number | null;
}
interface Data { periods: Period[]; stores: TargetStore[]; settings: SchemeSettings; current: string | null; franchises: Franchise[] }
type Terms = { growth_pct?: string; reward?: string };
type View = "pick" | "targets" | "results";
type Status = "reached" | "on_track" | "behind" | "missed" | "upcoming" | "no_target";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-IN"));
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Where a franchise stands in a period: reached, on track (keeping the period's pace), behind, missed, or not started. */
function statusOf(f: TargetFigures | undefined, p: Period | undefined, today = istToday()): Status {
    if (!f?.target) return "no_target";
    if ((f.achieved ?? 0) >= f.target) return "reached";
    if (p?.from && today < p.from) return "upcoming";
    if (p?.to && today > p.to) return "missed";
    if (!p?.from || !p?.to) return "on_track";
    const total = dayDiff(p.from, p.to) + 1;
    const gone = Math.min(dayDiff(p.from, today) + 1, total);
    return (f.achieved ?? 0) >= (f.target * gone) / total ? "on_track" : "behind";
}
const STATUS: Record<Status, { label: string; tone: string; bar: string }> = {
    reached: { label: "Reached", tone: "bg-emerald-100 text-emerald-800", bar: "bg-emerald-600" },
    on_track: { label: "On track", tone: "bg-blue-100 text-blue-800", bar: "bg-blue-600" },
    behind: { label: "Behind", tone: "bg-amber-100 text-amber-900", bar: "bg-amber-500" },
    missed: { label: "Missed", tone: "bg-rose-100 text-rose-800", bar: "bg-rose-500" },
    upcoming: { label: "Not started", tone: "bg-slate-100 text-slate-700", bar: "bg-slate-400" },
    no_target: { label: "No target", tone: "bg-slate-100 text-slate-500", bar: "bg-slate-300" },
};

/** The steps of a target scheme, done ones ticked. */
export function Stepper({ at, onGo, canGo = [] }: { at: 1 | 2 | 3 | 4; onGo?: (n: 1 | 2 | 3 | 4) => void; canGo?: number[] }) {
    const steps = ["Details", "Franchises", "Targets & rewards", "Results"] as const;
    return (
        <ol className="flex items-center gap-2 overflow-x-auto no-scrollbar text-sm">
            {steps.map((label, i) => {
                const n = (i + 1) as 1 | 2 | 3 | 4;
                const done = n < at, now = n === at, go = onGo && canGo.includes(n) && !now;
                return (
                    <li key={label} className="flex shrink-0 items-center gap-2">
                        {i > 0 && <span className={cn("h-0.5 w-6 sm:w-10", n <= at ? "bg-orange-600" : "bg-slate-300")} aria-hidden />}
                        <button type="button" disabled={!go} onClick={() => go && onGo!(n)}
                            className={cn("rounded-full px-3.5 py-2 font-bold whitespace-nowrap",
                                now ? "bg-orange-600 text-white" : done ? "bg-emerald-100 text-emerald-800" : "border border-slate-300 bg-white text-slate-600",
                                go && "hover:ring-2 hover:ring-orange-300")}>
                            {done ? "✓ " : `${n} `}{label}
                        </button>
                    </li>
                );
            })}
        </ol>
    );
}

/** Which average to look at: overall, the last 3 or 6 months, or dates of one's own. */
function BasisPicker({ basis, onChange }: { basis: AverageBasis; onChange: (b: AverageBasis) => void }) {
    const [range, setRange] = useState({ from: basis.from ?? "", to: basis.to ?? "" });
    return (
        <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1"><span className="block text-xs font-semibold text-slate-600">Average of</span>
                <select value={basis.mode} onChange={e => { const m = e.target.value as AverageBasis["mode"]; onChange(m === "custom" ? { mode: m, from: range.from, to: range.to } : { mode: m }); }}
                    className="h-11 rounded-xl border-2 border-orange-500 bg-orange-50 px-3 text-sm font-bold text-slate-900" aria-label="Average of">
                    <option value="m3">Last 3 months</option><option value="m6">Last 6 months</option><option value="overall">Since it joined</option><option value="custom">Dates I choose…</option>
                </select>
            </label>
            {basis.mode === "custom" && <>
                <label className="space-y-1"><span className="block text-xs text-slate-500">From</span><Input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="h-11" /></label>
                <label className="space-y-1"><span className="block text-xs text-slate-500">To</span><Input type="date" value={range.to} min={range.from || undefined} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="h-11" /></label>
                <Button variant="outline" className="h-11" disabled={!range.from || !range.to || range.to < range.from} onClick={() => onChange({ mode: "custom", ...range })}>Show</Button>
            </>}
        </div>
    );
}

export function TargetsTab({ scheme, refreshKey, onEditDetails, onChanged }: {
    scheme: Scheme; refreshKey: number; onEditDetails?: () => void; onChanged?: () => void;
}) {
    const { toast } = useToast();
    const [data, setData] = useState<Data | null>(null);
    const [view, setView] = useState<View | null>(null);
    const [basis, setBasis] = useState<AverageBasis>({ mode: "m3" });
    const [months, setMonths] = useState<TargetStore | null>(null);
    const [removing, setRemoving] = useState<TargetStore | null>(null);
    const chosen = useRef(false);

    const load = useCallback(() => api.get(`/schemes/admin/${scheme.id}/targets`, {
        params: basis.mode === "custom" && basis.from && basis.to ? { avg_from: basis.from, avg_to: basis.to } : undefined,
    }).then(r => {
        setData(r.data);
        /* Open where the admin left off: no franchises yet → choose them; a draft → targets; running → results. */
        if (!chosen.current) {
            chosen.current = true;
            setView(!r.data.stores.length ? "pick" : scheme.status === "draft" ? "targets" : "results");
        }
    }).catch(e => toast({ title: "Could not load", description: getErrorMessage(e, ""), variant: "destructive" })), [scheme.id, scheme.status, basis]);
    useEffect(() => { load(); }, [load, refreshKey]);

    if (!data || !view) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    const has = data.stores.length > 0;
    const at = view === "pick" ? 2 : view === "targets" ? 3 : 4;
    const go = (n: 1 | 2 | 3 | 4) => (n === 1 ? onEditDetails?.() : setView(n === 2 ? "pick" : n === 3 ? "targets" : "results"));

    return (
        <div className="space-y-5">
            <Stepper at={at} onGo={go} canGo={[1, 2, ...(has ? [3] : []), ...(has && scheme.status !== "draft" ? [4] : [])]} />
            {view === "pick" && <PickView scheme={scheme} data={data} basis={basis} setBasis={setBasis} onBack={() => onEditDetails?.()}
                onDone={async () => { await load(); setView("targets"); }} />}
            {view === "targets" && <TargetsView scheme={scheme} data={data} basis={basis} setBasis={setBasis} onMonths={setMonths} onRemove={setRemoving}
                onBack={() => setView("pick")} onSaved={async started => { await load(); onChanged?.(); if (started) setView("results"); }} />}
            {view === "results" && <ResultsView scheme={scheme} data={data} onMonths={setMonths} onReload={load}
                onEdit={() => setView("targets")} onAdd={() => setView("pick")} />}
            <MonthsDialog store={months} settings={data.settings} basis={basis} onClose={() => setMonths(null)} />
            <RemoveDialog scheme={scheme} store={removing} onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); load(); }} />
        </div>
    );
}

/* ─── Step 2: choose the franchises ───────────────────────────────────────── */

function PickView({ scheme, data, basis, setBasis, onBack, onDone }: {
    scheme: Scheme; data: Data; basis: AverageBasis; setBasis: (b: AverageBasis) => void; onBack: () => void; onDone: () => Promise<void>;
}) {
    const { toast } = useToast();
    const [q, setQ] = useState("");
    const [state, setState] = useState("");
    const [brand, setBrand] = useState("");
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const states = useMemo(() => [...new Set(data.franchises.map(f => (f.state ?? "").trim()).filter(Boolean))].sort(), [data.franchises]);
    const list = useMemo(() => {
        const n = q.trim().toLowerCase();
        return data.franchises
            .filter(f => (!brand || storeBrand(f.brand) === brand) && (!state || (f.state ?? "").trim() === state) && (!n || [f.name, f.city, f.code].some(v => String(v ?? "").toLowerCase().includes(n))))
            .sort((a, b) => averageOn(b.averages, basis) - averageOn(a.averages, basis) || a.name.localeCompare(b.name));
    }, [data.franchises, q, state, brand, basis]);
    const shown = list.slice(0, 200);
    const toggle = (id: string) => setPicked(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });

    const next = async () => {
        if (!picked.size) { if (data.stores.length) return onDone(); return toast({ title: "Tick at least one franchise", variant: "destructive" }); }
        setBusy(true);
        try {
            for (const id of picked) await api.post(`/schemes/admin/${scheme.id}/targets/stores`, { store_id: id });
            toast({ title: `${picked.size} ${picked.size === 1 ? "franchise" : "franchises"} added` });
            setPicked(new Set());
            await onDone();
        } catch (e) {
            toast({ title: "Not all were added", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setBusy(false); }
    };

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-2xl font-extrabold text-slate-900">Which franchises are in it?</h2>
                <p className="mt-1 text-sm text-slate-600">Tick the stores. The number next to each is how many warranties it does in a month, so you can decide.
                    {data.stores.length > 0 && <> <b>{data.stores.length}</b> already in this scheme.</>}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
                <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or city" className="h-11 pl-9" aria-label="Search franchises" />
                </div>
                <select value={state} onChange={e => setState(e.target.value)} aria-label="State" className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm">
                    <option value="">All states</option>{states.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {/* Brand: each on its own, with how many franchises it has. */}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Brand">
                    {STORE_BRAND_FILTER.map(b => (
                        <button key={b.value} type="button" onClick={() => setBrand(b.value)}
                            className={`h-11 rounded-xl border px-3 text-sm font-semibold ${brand === b.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                            {b.label} <span className="opacity-70">{data.franchises.filter(f => !b.value || storeBrand(f.brand) === b.value).length}</span>
                        </button>
                    ))}
                </div>
                <div className="sm:ml-auto"><BasisPicker basis={basis} onChange={setBasis} /></div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="hidden md:grid grid-cols-[48px_2.4fr_1fr_1fr_1fr] gap-2 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <input type="checkbox" aria-label="Tick all shown" className="h-4 w-4 accent-orange-600"
                        checked={shown.length > 0 && shown.every(f => picked.has(f.id))}
                        onChange={e => setPicked(p => { const s = new Set(p); for (const f of shown) e.target.checked ? s.add(f.id) : s.delete(f.id); return s; })} />
                    <span>Franchise</span><span>Avg / month</span><span>Last month</span><span>Best month</span>
                </div>
                <div className="max-h-[52vh] divide-y divide-slate-100 overflow-y-auto">
                    {shown.map(f => (
                        <label key={f.id} className={cn("grid cursor-pointer grid-cols-[32px_1fr_auto] items-center gap-2 px-4 py-3 md:grid-cols-[48px_2.4fr_1fr_1fr_1fr]", picked.has(f.id) && "bg-orange-50")}>
                            <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} className="h-4 w-4 accent-orange-600" />
                            <span className="min-w-0"><span className="block truncate font-semibold text-slate-900">{f.name}</span><span className="block text-xs text-slate-500">{[f.city, f.state, storeBrand(f.brand)].filter(Boolean).join(", ")}</span></span>
                            <span className="text-right md:text-left"><b className="text-base tabular-nums">{fmt(averageOn(f.averages, basis))}</b><span className="ml-1 text-xs text-slate-500 md:hidden">/ month</span></span>
                            <span className="hidden tabular-nums md:block">{fmt(f.last_month)}</span>
                            <span className="hidden tabular-nums md:block">{fmt(f.best_month)}</span>
                        </label>
                    ))}
                    {!shown.length && <p className="p-8 text-center text-sm text-slate-500">No franchise matches.</p>}
                </div>
                <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">Showing {shown.length} of {list.length} · highest average first</p>
            </div>

            <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
                <span className="text-sm"><b>{picked.size}</b> ticked</span>
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                    <Button variant="outline" className="h-12" onClick={onBack}>← Back</Button>
                    <Button className="h-12 bg-orange-600 px-6 font-bold hover:bg-orange-700" disabled={busy} onClick={next}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Next: set targets →"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

/* ─── Step 3: growth and reward → target ──────────────────────────────────── */

function TargetsView({ scheme, data, basis, setBasis, onMonths, onRemove, onBack, onSaved }: {
    scheme: Scheme; data: Data; basis: AverageBasis; setBasis: (b: AverageBasis) => void;
    onMonths: (s: TargetStore) => void; onRemove: (s: TargetStore) => void; onBack: () => void; onSaved: (started: boolean) => Promise<void>;
}) {
    const { toast } = useToast();
    const [terms, setTerms] = useState<Record<string, Terms>>({});
    const [all, setAll] = useState({ growth: "", reward: "" });
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState<"save" | "start" | null>(null);
    const draft = scheme.status === "draft";
    const first = data.periods[0];

    const value = (s: TargetStore, k: "growth_pct" | "reward") => terms[s.store_id]?.[k] ?? String(s[k] ?? "");
    const set = (s: TargetStore, k: "growth_pct" | "reward", v: string) => setTerms(prev => {
        const next = { ...prev, [s.store_id]: { ...prev[s.store_id], [k]: v } };
        if (v.trim() === String(s[k] ?? "")) delete next[s.store_id]![k];
        if (!Object.keys(next[s.store_id]!).length) delete next[s.store_id];
        return next;
    });
    /* The target shown: what the growth on the average shown makes, or the one saved. */
    const targetOf = (s: TargetStore) => {
        const g = value(s, "growth_pct");
        if (terms[s.store_id]?.growth_pct !== undefined && g !== "") return { n: growthTarget(averageOn(s.stats?.averages, basis), Number(g), first?.months.length ?? 1), fresh: true };
        return { n: first ? s.figures[first.key]?.target ?? null : null, fresh: false };
    };
    const total = data.stores.reduce((n, s) => n + (targetOf(s).n ?? 0), 0);
    const missing = data.stores.filter(s => value(s, "growth_pct") === "" || !value(s, "reward").trim());
    const needsReason = Object.entries(terms).some(([id, t]) => t.growth_pct !== undefined && data.stores.find(x => x.store_id === id)?.growth_pct != null);

    const save = async (start: boolean) => {
        if (start && missing.length) return toast({ title: `${missing.length} ${missing.length === 1 ? "franchise needs" : "franchises need"} a growth % and a reward`, variant: "destructive" });
        setBusy(start ? "start" : "save");
        try {
            const changed = Object.entries(terms);
            if (changed.length) await api.put(`/schemes/admin/${scheme.id}/targets/terms`, { stores: changed.map(([store_id, t]) => ({ store_id, ...t })), basis, reason: reason.trim() || undefined });
            if (start && draft) await api.post(`/schemes/admin/${scheme.id}/publish`);
            toast({ title: start && draft ? "Scheme started" : "Saved", description: start && draft ? "The franchises can see their targets now." : undefined });
            setTerms({}); setReason("");
            await onSaved(start);
        } catch (e) {
            toast({ title: "Not saved", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setBusy(null); }
    };

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-2xl font-extrabold text-slate-900">How much more should each one do?</h2>
                <p className="mt-1 text-sm text-slate-600">Type the growth % and the reward. The target is worked out for you: <b>average × (1 + growth %)</b>, for every {first?.from ? "period" : "month"}.</p>
            </div>

            <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <BasisPicker basis={basis} onChange={setBasis} />
                <span className="hidden h-11 w-px bg-slate-200 md:block" aria-hidden />
                <span className="self-center text-sm font-bold text-slate-800">Same for everyone:</span>
                <label className="space-y-1"><span className="block text-xs text-slate-500">Growth %</span>
                    <Input type="number" inputMode="decimal" value={all.growth} onChange={e => setAll(a => ({ ...a, growth: e.target.value }))} className="h-11 w-24" /></label>
                <label className="space-y-1"><span className="block text-xs text-slate-500">Reward</span>
                    <Input value={all.reward} onChange={e => setAll(a => ({ ...a, reward: e.target.value }))} placeholder="e.g. ₹5,000" className="h-11 w-40" /></label>
                <Button className="h-11 bg-slate-900 font-bold" disabled={all.growth === "" && !all.reward.trim()}
                    onClick={() => { for (const s of data.stores) { if (all.growth !== "") set(s, "growth_pct", all.growth); if (all.reward.trim()) set(s, "reward", all.reward); } }}>
                    Apply to all
                </Button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="hidden md:grid grid-cols-[2.2fr_1fr_1fr_1.3fr_1.6fr_44px] gap-3 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <span>Franchise</span><span>Avg / month</span><span>Growth</span><span>Target {first?.from ? "each period" : "each month"}</span><span>Reward on reaching it</span><span />
                </div>
                <div className="divide-y divide-slate-100">
                    {data.stores.map(s => {
                        const t = targetOf(s);
                        const avg = averageOn(s.stats?.averages, basis);
                        return (
                            <div key={s.store_id} className={cn("grid grid-cols-2 items-center gap-3 px-4 py-3.5 md:grid-cols-[2.2fr_1fr_1fr_1.3fr_1.6fr_44px]", terms[s.store_id] && "bg-orange-50/50")}>
                                <span className="col-span-2 min-w-0 md:col-span-1"><b className="block truncate text-slate-900">{s.store_name}</b><span className="text-xs text-slate-500">{s.city}</span></span>
                                <button type="button" onClick={() => onMonths(s)} className="text-left" title="See its months">
                                    <span className="text-xs text-slate-500 md:hidden">Avg / month </span>
                                    <b className="text-base tabular-nums underline decoration-dotted underline-offset-4">{fmt(avg)}</b>
                                </button>
                                <label className="flex items-center gap-1.5"><span className="text-xs text-slate-500 md:hidden">Growth</span>
                                    <Input type="number" inputMode="decimal" value={value(s, "growth_pct")} onChange={e => set(s, "growth_pct", e.target.value)} placeholder="0"
                                        aria-label={`Growth % for ${s.store_name}`} className={cn("h-11 w-20", terms[s.store_id]?.growth_pct !== undefined && "border-orange-500 bg-orange-50")} />
                                    <span className="text-sm text-slate-500">%</span>
                                </label>
                                <span>
                                    <span className="text-xs text-slate-500 md:hidden">Target </span>
                                    <b className={cn("text-xl tabular-nums", t.fresh ? "text-orange-700" : "text-slate-900")}>{fmt(t.n)}</b>
                                    {t.fresh && <span className="block text-xs text-slate-500">{fmt(avg)} × {(1 + Number(value(s, "growth_pct")) / 100).toFixed(2)}</span>}
                                </span>
                                <Input value={value(s, "reward")} onChange={e => set(s, "reward", e.target.value)} placeholder="e.g. ₹5,000" maxLength={160}
                                    aria-label={`Reward for ${s.store_name}`} className={cn("col-span-2 h-11 md:col-span-1", terms[s.store_id]?.reward !== undefined && "border-orange-500 bg-orange-50")} />
                                <Button size="icon" variant="ghost" className="h-10 w-10 text-rose-600" onClick={() => onRemove(s)} aria-label={`Remove ${s.store_name}`}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="sticky bottom-0 z-20 space-y-2 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm"><b>{data.stores.length} franchises</b> · target <b>{fmt(total)}</b> warranties {first?.from ? "per period" : "a month"} in all{data.periods.length ? ` · ${data.periods[0].label}${data.periods.length > 1 ? ` + ${data.periods.length - 1} more` : ""}` : ""}</span>
                    <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
                        <Button variant="outline" className="h-12" onClick={onBack}>← Back</Button>
                        <Button variant="outline" className="h-12" disabled={busy !== null || (needsReason && reason.trim().length < 3)} onClick={() => save(false)}>
                            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : draft ? "Save as draft" : "Save changes"}
                        </Button>
                        {draft && (
                            <Button className="h-12 bg-orange-600 px-6 font-bold hover:bg-orange-700" disabled={busy !== null || (needsReason && reason.trim().length < 3)} onClick={() => save(true)}>
                                {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start the scheme"}
                            </Button>
                        )}
                    </div>
                </div>
                {needsReason && <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why the growth changed (needed — it changes targets already set)" maxLength={300} className="h-11" aria-label="Reason" />}
                {draft && missing.length > 0 && <p className="text-xs text-slate-500">{missing.length} still need a growth % and a reward before you can start.</p>}
            </div>
        </div>
    );
}

/* ─── Results: while it runs, and after ───────────────────────────────────── */

function ResultsView({ scheme, data, onMonths, onReload, onEdit, onAdd }: {
    scheme: Scheme; data: Data; onMonths: (s: TargetStore) => void; onReload: () => Promise<unknown>; onEdit: () => void; onAdd: () => void;
}) {
    const { toast } = useToast();
    const [period, setPeriod] = useState(data.current ?? data.periods[0]?.key ?? "");
    const [filter, setFilter] = useState<Status | "to_pay" | null>(null);
    const [q, setQ] = useState("");
    const today = istToday();
    const p = data.periods.find(x => x.key === period);
    const counted = data.settings.count === "registered" ? "registered" : "approved";

    const rows = data.stores.map(s => ({ s, f: s.figures[period], st: statusOf(s.figures[period], p, today) }));
    const n = (st: Status) => rows.filter(r => r.st === st).length;
    const toPay = rows.filter(r => r.st === "reached" && !r.f?.paid_at).length;
    const paidN = rows.filter(r => r.f?.paid_at).length;
    const shown = rows
        .filter(r => !filter || (filter === "to_pay" ? r.st === "reached" && !r.f?.paid_at : r.st === filter))
        .filter(r => !q.trim() || [r.s.store_name, r.s.city].some(v => String(v ?? "").toLowerCase().includes(q.trim().toLowerCase())))
        .sort((a, b) => ((b.f?.achieved ?? 0) / (b.f?.target || 1)) - ((a.f?.achieved ?? 0) / (a.f?.target || 1)));

    const left = (x: Period) => {
        if (!x.from || !x.to) return "";
        if (today < x.from) return " · starts " + x.from.slice(8) + " " + x.label.split(" ")[1];
        if (today > x.to) return " · ended";
        const d = dayDiff(today, x.to);
        return d === 0 ? " · last day" : ` · ${d} days left`;
    };
    const setPaid = async (s: TargetStore, paid: boolean) => {
        try { await api.put(`/schemes/admin/${scheme.id}/targets/paid`, { store_id: s.store_id, period, paid }); await onReload(); }
        catch (e) { toast({ title: "Not saved", description: getErrorMessage(e, ""), variant: "destructive" }); }
    };
    const exportSheet = () => {
        const out: (string | number)[][] = [["Franchise", "City", "Period", "Target", `Done (${counted})`, "Status", "Reward", "Paid"]];
        for (const s of data.stores) for (const x of data.periods) {
            const f = s.figures[x.key];
            out.push([s.store_name, s.city ?? "", x.label, f?.target ?? "", f?.achieved ?? "", STATUS[statusOf(f, x, today)].label, s.reward ?? "", f?.paid_at ? "Paid" : ""]);
        }
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(out), "Results");
        XLSX.writeFile(wb, `${scheme.title.replace(/[^\w]+/g, "-")}-results.xlsx`);
    };

    const card = (key: Status | "to_pay", label: string, count: number, note: string, tone: string) => (
        <button type="button" onClick={() => setFilter(f => (f === key ? null : key))} aria-pressed={filter === key}
            className={cn("rounded-2xl border bg-white p-4 text-left", filter === key ? "border-2 border-slate-900" : "border-slate-200 hover:border-slate-400")}>
            <span className={cn("block text-sm font-bold", tone)}>{label}</span>
            <span className="block text-3xl font-extrabold tabular-nums text-slate-900">{count}</span>
            <span className="block text-xs text-slate-500">{note}</span>
        </button>
    );

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-2xl font-extrabold text-slate-900">Results</h2>
                <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
                    <Button variant="outline" className="h-11" onClick={onEdit}><Pencil className="h-4 w-4 mr-1" />Edit targets</Button>
                    <Button variant="outline" className="h-11" onClick={onAdd}><Plus className="h-4 w-4 mr-1" />Add franchises</Button>
                    <Button variant="outline" className="h-11" onClick={exportSheet}><Download className="h-4 w-4 mr-1" />Excel</Button>
                </div>
            </div>

            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 [&>*]:shrink-0">
                {data.periods.map(x => (
                    <button key={x.key} type="button" onClick={() => setPeriod(x.key)}
                        className={cn("h-10 rounded-full px-4 text-sm font-semibold whitespace-nowrap", period === x.key ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-800")}>
                        {x.label}{x.key === period ? left(x) : ""}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {card("reached", "Reached", n("reached"), "rewards earned", "text-emerald-700")}
                {card("on_track", "On track", n("on_track"), "keeping the pace", "text-blue-700")}
                {card(today > (p?.to ?? "9999") ? "missed" : "behind", today > (p?.to ?? "9999") ? "Missed" : "Behind", today > (p?.to ?? "9999") ? n("missed") : n("behind"), today > (p?.to ?? "9999") ? "didn't reach it" : "need a push · call them", "text-amber-700")}
                {card("to_pay", "Rewards to pay", toPay, `${paidN} already paid`, "text-slate-700")}
            </div>

            <div className="relative max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search franchise" className="h-10 pl-9" aria-label="Search franchises" />
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="hidden md:grid grid-cols-[2fr_0.8fr_0.8fr_1.8fr_1.3fr_1.4fr_1fr] gap-3 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <span>Franchise</span><span>Target</span><span>Done</span><span>Progress</span><span>Status</span><span>Reward</span><span>Paid</span>
                </div>
                <div className="divide-y divide-slate-100">
                    {shown.map(({ s, f, st }) => {
                        const pct = f?.target ? Math.min(100, Math.round(((f.achieved ?? 0) / f.target) * 100)) : 0;
                        const togo = f?.target ? Math.max(f.target - (f.achieved ?? 0), 0) : 0;
                        return (
                            <div key={s.store_id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 md:grid-cols-[2fr_0.8fr_0.8fr_1.8fr_1.3fr_1.4fr_1fr]">
                                <button type="button" onClick={() => onMonths(s)} className="min-w-0 text-left"><b className="block truncate text-slate-900 hover:underline">{s.store_name}</b><span className="text-xs text-slate-500">{s.city}</span></button>
                                <b className="hidden tabular-nums md:block">{fmt(f?.target)}</b>
                                <span className="hidden tabular-nums md:block"><b>{fmt(f?.achieved ?? 0)}</b>{f?.pending ? <span className="block text-xs text-amber-700">+{f.pending} waiting</span> : null}</span>
                                <span className="col-span-2 flex items-center gap-2 md:col-span-1">
                                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className={cn("block h-full rounded-full", STATUS[st].bar)} style={{ width: `${pct}%` }} /></span>
                                    <span className="w-24 text-right text-xs tabular-nums text-slate-600 md:hidden">{fmt(f?.achieved ?? 0)} / {fmt(f?.target)}</span>
                                </span>
                                <span className={cn("justify-self-start rounded-full px-2.5 py-1 text-xs font-bold row-start-1 col-start-2 md:row-auto md:col-auto", STATUS[st].tone)}>
                                    {st === "reached" ? "✓ Reached" : st === "on_track" || st === "behind" ? `${STATUS[st].label} · ${fmt(togo)} to go` : STATUS[st].label}
                                </span>
                                <span className="truncate text-sm text-slate-700">{s.reward ?? "—"}</span>
                                <span>
                                    {st === "reached" && (f?.paid_at
                                        ? <button type="button" onClick={() => setPaid(s, false)} className="inline-flex h-9 items-center gap-1 rounded-full bg-sky-100 px-3 text-xs font-bold text-sky-800" title="Mark not paid"><Check className="h-3.5 w-3.5" />Paid</button>
                                        : <Button size="sm" variant="outline" className="h-9" onClick={() => setPaid(s, true)}>Mark paid</Button>)}
                                </span>
                            </div>
                        );
                    })}
                    {!shown.length && <p className="p-8 text-center text-sm text-slate-500">Nobody here.</p>}
                </div>
            </div>

            <div className="grid gap-3 text-sm text-slate-700 md:grid-cols-3">
                <p className="rounded-2xl border border-slate-200 bg-white p-4"><b className="text-emerald-700">Reached</b> — done is at or above the target. The reward is due; mark it paid once given.</p>
                <p className="rounded-2xl border border-slate-200 bg-white p-4"><b className="text-blue-700">On track</b> — keeping the period's pace (e.g. 12 of 30 days gone → at least 40% of the target).</p>
                <p className="rounded-2xl border border-slate-200 bg-white p-4"><b className="text-amber-700">Behind</b> — below that pace. When the period ends, anyone not reached shows <b>Missed</b>; the next one starts fresh.</p>
            </div>
            <p className="text-xs text-slate-500">Counts {counted} warranties, by {data.settings.date_by === "purchase" ? "purchase" : "registration"} date.</p>
        </div>
    );
}

/* ─── A franchise's warranties by month ──────────────────────────────────── */

function MonthsDialog({ store, settings, basis, onClose }: { store: TargetStore | null; settings: SchemeSettings; basis: AverageBasis; onClose: () => void }) {
    const stats = store?.stats ?? null;
    const cells: [AverageBasis["mode"], number | null][] = stats ? [["overall", stats.averages.overall], ["m3", stats.averages.m3], ["m6", stats.averages.m6], ["custom", stats.averages.custom]] : [];
    return (
        <Dialog open={Boolean(store)} onOpenChange={o => { if (!o) onClose(); }}>
            <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{store?.store_name}</DialogTitle>
                    <DialogDescription>
                        {settings.count === "registered" ? "Registered" : "Approved"} warranties a month, by {settings.date_by === "purchase" ? "purchase" : "registration"} date.
                        {store?.basis_average != null && store.basis ? ` Its growth is on ${BASIS_LABEL[store.basis.mode].toLowerCase()}: ${fmt(store.basis_average)}.` : ""}
                    </DialogDescription>
                </DialogHeader>
                {stats && (
                    <>
                        <div className="grid grid-cols-2 gap-2">
                            {cells.filter(([m, v]) => m !== "custom" || v !== null).map(([m, v]) => (
                                <div key={m} className={cn("rounded-xl border p-3", basis.mode === m ? "border-orange-400 bg-orange-50" : "border-slate-200")}>
                                    <p className="text-xs font-semibold text-slate-500">{BASIS_LABEL[m]}</p>
                                    <p className="text-lg font-extrabold tabular-nums">{fmt(v)}</p>
                                </div>
                            ))}
                        </div>
                        <table className="w-full text-sm">
                            <thead className="text-left text-xs text-slate-500"><tr><th className="py-2">Month</th><th className="py-2 text-right">Approved</th><th className="py-2 text-right">Waiting</th><th className="py-2 text-right">Rejected</th></tr></thead>
                            <tbody>
                                {[...stats.months].reverse().map(m => (
                                    <tr key={m.month} className="border-t border-slate-100">
                                        <td className="py-2 pl-1 font-medium">{formatMonth(m.month)}</td>
                                        <td className="py-2 text-right font-bold tabular-nums">{m.approved}</td>
                                        <td className="py-2 text-right tabular-nums text-amber-700">{m.pending || ""}</td>
                                        <td className="py-2 pr-1 text-right tabular-nums text-rose-600">{m.rejected || ""}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

function RemoveDialog({ scheme, store, onClose, onDone }: { scheme: Scheme; store: TargetStore | null; onClose: () => void; onDone: () => void }) {
    const { toast } = useToast();
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => { setReason(""); }, [store]);
    const remove = async () => {
        if (!store) return;
        setBusy(true);
        try {
            await api.delete(`/schemes/admin/${scheme.id}/targets/stores/${store.store_id}`, { data: { reason } });
            toast({ title: `${store.store_name} removed` });
            onDone();
        } catch (e) { toast({ title: "Not removed", description: getErrorMessage(e, ""), variant: "destructive" }); }
        finally { setBusy(false); }
    };
    return (
        <Dialog open={Boolean(store)} onOpenChange={o => { if (!o && !busy) onClose(); }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Remove {store?.store_name}?</DialogTitle>
                    <DialogDescription>It stops seeing this scheme.</DialogDescription>
                </DialogHeader>
                <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why (needed)" maxLength={300} aria-label="Reason" />
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button variant="destructive" onClick={remove} disabled={busy || reason.trim().length < 3}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Remove</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
