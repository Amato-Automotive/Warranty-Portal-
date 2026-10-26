import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Check, Download, FileSpreadsheet, History, Loader2, Pencil, Plus, Search, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    formatMonth, growthTarget, stepBenefit,
    type Period, type Scheme, type SchemeSettings, type TargetStep, type TargetStore, type WarrantyStats,
} from "@/lib/schemes";
import { StepsEditor } from "./TargetSettingsEditor";

/**
 * A scheme run by targets, for the admin. Counted from warranties (the usual
 * case): each franchise's approved warranties per period are counted for
 * you; you see its monthly history and average, give it a growth % (which
 * makes its target) and its reward. Typed figures: you enter targets and
 * achievement yourself. Either way the grid saves together, changing a
 * figure already set needs a reason, and every change is kept.
 */

interface Data {
    periods: Period[]; stores: TargetStore[]; settings: SchemeSettings; current: string | null;
    franchises: { id: string; code: string | null; name: string; city: string | null; state: string | null }[];
}
type Cell = { target?: string; achieved?: string };
type Terms = { growth_pct?: string; reward?: string };
const ALL = "__all";
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : Number(n).toLocaleString("en-IN"));
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function TargetsTab({ scheme, refreshKey }: { scheme: Scheme; refreshKey: number }) {
    const { toast } = useToast();
    const [data, setData] = useState<Data | null>(null);
    const [period, setPeriod] = useState<string>("");
    const [q, setQ] = useState("");
    const [edits, setEdits] = useState<Record<string, Cell>>({});
    const [terms, setTerms] = useState<Record<string, Terms>>({});
    const [bulk, setBulk] = useState({ growth: "", reward: "" });
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState<TargetStore | "new" | null>(null);
    const [removing, setRemoving] = useState<TargetStore | null>(null);
    const [history, setHistory] = useState<TargetStore | null>(null);
    const [importOpen, setImportOpen] = useState(false);

    const load = useCallback(() => api.get(`/schemes/admin/${scheme.id}/targets`).then(r => {
        setData(r.data);
        setPeriod(p => p || r.data.current || r.data.periods[0]?.key || "");
    }).catch(e => toast({ title: "Could not load the targets", description: getErrorMessage(e, ""), variant: "destructive" })), [scheme.id]);
    useEffect(() => { load(); }, [load, refreshKey]);

    const settings = data?.settings ?? scheme.settings;
    const byWarranty = settings.source === "warranties";
    const unit = settings.unit || "sets";
    const many = (data?.periods.length ?? 0) > 1;
    const whole = period === ALL;
    const periodMonths = data?.periods.find(p => p.key === period)?.months.length ?? 1;

    const shown = useMemo(() => {
        const n = q.trim().toLowerCase();
        return (data?.stores ?? []).filter(s => !n || [s.store_name, s.city, s.state].some(v => String(v ?? "").toLowerCase().includes(n)));
    }, [data, q]);

    /* Each franchise's figures for the chosen period, or its totals over the whole scheme. */
    const rowOf = (s: TargetStore) => {
        if (!whole) {
            const f = s.figures[period];
            return { target: f?.target ?? null, achieved: f?.achieved ?? null, pending: f?.pending ?? null, result: f?.result ?? null, paid: Boolean(f?.paid_at), reached: 0, earned: 0 };
        }
        const fs = Object.values(s.figures);
        const sum = (k: "target" | "achieved" | "pending") => fs.some(f => f[k] !== null) ? fs.reduce((n, f) => n + (f[k] ?? 0), 0) : null;
        return {
            target: sum("target"), achieved: sum("achieved"), pending: sum("pending"), result: null, paid: false,
            reached: fs.filter(f => f.result.step).length, earned: fs.reduce((n, f) => n + (f.result.benefit_rupees ?? 0), 0),
        };
    };

    const totals = useMemo(() => {
        let target = 0, achieved = 0, benefit = 0, reached = 0;
        for (const s of data?.stores ?? []) {
            for (const [k, f] of Object.entries(s.figures)) {
                if (!whole && k !== period) continue;
                target += f.target ?? 0; achieved += f.achieved ?? 0;
                benefit += f.result.benefit_rupees ?? 0;
                if (f.result.benefit) reached++;
            }
        }
        return { target, achieved, benefit, reached };
    }, [data, period, whole]);

    /* ─── Edits ─── */
    const key = (s: TargetStore) => `${s.store_id}|${period}`;
    const cellValue = (s: TargetStore, field: "target" | "achieved") => {
        const e = edits[key(s)]?.[field];
        return e !== undefined ? e : String(s.figures[period]?.[field] ?? "");
    };
    const setCell = (s: TargetStore, field: "target" | "achieved", v: string) => {
        const saved = s.figures[period]?.[field];
        setEdits(prev => {
            const next = { ...prev, [key(s)]: { ...prev[key(s)], [field]: v } };
            if ((v === "" && (saved === null || saved === undefined)) || (v !== "" && Number(v) === saved)) delete next[key(s)]![field];
            if (!Object.keys(next[key(s)]!).length) delete next[key(s)];
            return next;
        });
    };
    const termValue = (s: TargetStore, field: "growth_pct" | "reward") => {
        const e = terms[s.store_id]?.[field];
        return e !== undefined ? e : String(s[field] ?? "");
    };
    const setTerm = (s: TargetStore, field: "growth_pct" | "reward", v: string) => {
        const saved = String(s[field] ?? "");
        setTerms(prev => {
            const next = { ...prev, [s.store_id]: { ...prev[s.store_id], [field]: v } };
            if (v.trim() === saved) delete next[s.store_id]![field];
            if (!Object.keys(next[s.store_id]!).length) delete next[s.store_id];
            return next;
        });
    };
    const applyBulk = (field: "growth_pct" | "reward", v: string) => { for (const s of shown) setTerm(s, field, v); };

    const termChanges = Object.entries(terms).map(([store_id, t]) => ({ store_id, ...t }));
    const regrown = new Set(termChanges.filter(t => t.growth_pct !== undefined).map(t => t.store_id));
    /* A store whose growth changed gets its targets from the growth, not from typed cells. */
    const changes = Object.entries(edits).map(([k, c]) => {
        const [store_id, p] = k.split("|");
        return {
            store_id, period: p,
            ...(c.target !== undefined ? { target: c.target === "" ? null : Number(c.target) } : {}),
            ...(c.achieved !== undefined ? { achieved: c.achieved === "" ? null : Number(c.achieved) } : {}),
        };
    }).filter(c => !regrown.has(c.store_id));
    const count = new Set([...changes.map(c => c.store_id), ...termChanges.map(t => t.store_id)]).size;
    /* A reason is needed when a figure already set is changed — a new growth changes the targets set from the old one. */
    const needsReason = changes.some(c => {
        const f = data?.stores.find(x => x.store_id === c.store_id)?.figures[c.period];
        return ("target" in c && f?.target != null) || ("achieved" in c && f?.achieved != null);
    }) || [...regrown].some(id => Object.values(data?.stores.find(x => x.store_id === id)?.figures ?? {}).some(f => f.target != null));

    const save = async () => {
        if (termChanges.some(t => t.growth_pct !== undefined && t.growth_pct !== "" && !Number.isFinite(Number(t.growth_pct)))) {
            return toast({ title: "Growth must be a number", variant: "destructive" });
        }
        setSaving(true);
        try {
            if (termChanges.length) await api.put(`/schemes/admin/${scheme.id}/targets/terms`, { stores: termChanges, reason: reason.trim() || undefined });
            if (changes.length) await api.put(`/schemes/admin/${scheme.id}/targets/figures`, { changes, reason: reason.trim() || undefined });
            toast({ title: `Saved ${count} ${count === 1 ? "franchise" : "franchises"}` });
            setEdits({}); setTerms({}); setReason("");
            await load();
        } catch (e) {
            toast({ title: "Not saved", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setSaving(false); }
    };

    const setPaid = async (s: TargetStore, paid: boolean) => {
        try {
            await api.put(`/schemes/admin/${scheme.id}/targets/paid`, { store_id: s.store_id, period, paid });
            toast({ title: paid ? `${s.store_name}: marked paid` : `${s.store_name}: back to "to pay"` });
            load();
        } catch (e) { toast({ title: "Not saved", description: getErrorMessage(e, ""), variant: "destructive" }); }
    };

    const exportSheet = () => {
        if (!data) return;
        const head = ["Store code", "Store", "City", ...(byWarranty ? ["Average / month", "Growth %", "Reward"] : []), "Period", `Target (${unit})`, `Achieved (${unit})`, ...(byWarranty ? ["Waiting approval"] : []), "% of target", "Result", "Paid"];
        const rows: (string | number)[][] = [head];
        const codes = new Map(data.franchises.map(f => [f.id, f.code]));
        for (const s of data.stores) for (const p of data.periods) {
            const f = s.figures[p.key];
            rows.push([
                codes.get(s.store_id) ?? "", s.store_name, s.city ?? "",
                ...(byWarranty ? [s.stats?.average ?? "", s.growth_pct ?? "", s.reward ?? ""] : []),
                p.label, f?.target ?? "", f?.achieved ?? "", ...(byWarranty ? [f?.pending ?? ""] : []),
                f?.result.pct ?? "", f?.result.benefit ?? "", f?.paid_at ? "Paid" : "",
            ]);
        }
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Targets");
        XLSX.writeFile(wb, `${scheme.title.replace(/[^\w]+/g, "-")}-targets.xlsx`);
    };

    if (!data) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    const label = data.periods.find(p => p.key === period)?.label ?? "Whole scheme";
    const dirty = count > 0;
    const pickPeriod = (k: string) => { if (dirty) toast({ title: "Save or discard your changes first" }); else setPeriod(k); };

    /* ─── Cells ─── */
    type Row = ReturnType<typeof rowOf>;
    const pctOf = (r: Row) => r.result?.pct ?? (r.target ? Math.round(((r.achieved ?? 0) / r.target) * 100) : null);
    const resultCell = (r: Row) => {
        if (whole) return <span className="text-xs text-slate-600">{r.reached ? `Reached in ${r.reached} ${r.reached === 1 ? "period" : "periods"}` : "—"}</span>;
        const res = r.result;
        if (!res || !r.target) return <span className="text-xs text-slate-400">No target</span>;
        if (res.benefit) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800"><Check className="h-3.5 w-3.5" />{byWarranty ? "Reached" : `Step ${res.step_no}`}</span>;
        const left = Math.max(r.target - (r.achieved ?? 0), 0);
        return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{byWarranty ? `${fmt(left)} to go` : "Not yet"}</span>;
    };
    const benefitText = (s: TargetStore, r: Row) => whole ? (r.earned ? rupees(r.earned) : "—") : r.result?.benefit ?? (byWarranty ? "—" : "—");
    const paidCell = (s: TargetStore, r: Row) => whole || !r.result?.benefit ? <span className="text-xs text-slate-400">—</span>
        : r.paid ? (
            <button type="button" onClick={() => setPaid(s, false)} title="Mark not paid" className="inline-flex h-9 items-center gap-1 rounded-full bg-sky-100 px-3 text-xs font-bold text-sky-800 hover:bg-sky-200">
                <Check className="h-3.5 w-3.5" /> Paid
            </button>
        ) : <Button size="sm" variant="outline" className="h-9" onClick={() => setPaid(s, true)}>Mark paid</Button>;
    const numInput = (s: TargetStore, field: "target" | "achieved", className = "") => {
        if (whole || (field === "achieved" && byWarranty)) {
            const r = rowOf(s);
            return (
                <span className="tabular-nums">
                    <span className="font-semibold">{fmt(r[field]) || (field === "achieved" ? "0" : "—")}</span>
                    {field === "achieved" && byWarranty && r.pending ? <span className="block text-xs text-amber-700">+{fmt(r.pending)} waiting</span> : null}
                </span>
            );
        }
        /* A changed growth shows the target it will make. */
        const g = terms[s.store_id]?.growth_pct;
        if (field === "target" && g !== undefined && g !== "" && s.stats) {
            return <span className="tabular-nums font-semibold text-orange-700" title="From the new growth">→ {fmt(growthTarget(s.stats.average, Number(g), periodMonths))}</span>;
        }
        return <Input type="number" inputMode="decimal" min={0} value={cellValue(s, field)} onChange={e => setCell(s, field, e.target.value)}
            aria-label={`${field === "target" ? "Target" : "Achieved"} for ${s.store_name}`}
            className={cn("h-10 w-24 tabular-nums", edits[key(s)]?.[field] !== undefined && "border-orange-400 bg-orange-50", className)} />;
    };
    const growthInput = (s: TargetStore, className = "") => (
        <div className="relative">
            <Input type="number" inputMode="decimal" value={termValue(s, "growth_pct")} onChange={e => setTerm(s, "growth_pct", e.target.value)} placeholder="0"
                aria-label={`Growth % for ${s.store_name}`} className={cn("h-10 w-20 pr-6 tabular-nums", terms[s.store_id]?.growth_pct !== undefined && "border-orange-400 bg-orange-50", className)} />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">%</span>
        </div>
    );
    const rewardInput = (s: TargetStore, className = "") => (
        <Input value={termValue(s, "reward")} onChange={e => setTerm(s, "reward", e.target.value)} placeholder="e.g. ₹5,000" maxLength={160}
            aria-label={`Reward for ${s.store_name}`} className={cn("h-10 w-36", terms[s.store_id]?.reward !== undefined && "border-orange-400 bg-orange-50", className)} />
    );
    const actions = (s: TargetStore) => (
        <div className="flex justify-end gap-1">
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setHistory(s)} aria-label={`Warranties and changes for ${s.store_name}`}><History className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setEditing(s)} aria-label={`Edit ${s.store_name}`}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-9 w-9 text-rose-600" onClick={() => setRemoving(s)} aria-label={`Remove ${s.store_name}`}><Trash2 className="h-4 w-4" /></Button>
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 [&>*]:shrink-0">
                    {data.periods.map(p => (
                        <button key={p.key} type="button" onClick={() => pickPeriod(p.key)}
                            className={cn("h-10 rounded-full px-4 text-sm font-semibold whitespace-nowrap", period === p.key ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-800")}>
                            {p.label}
                        </button>
                    ))}
                    {many && (
                        <button type="button" onClick={() => pickPeriod(ALL)}
                            className={cn("h-10 rounded-full px-4 text-sm font-semibold whitespace-nowrap", whole ? "bg-slate-900 text-white" : "border border-dashed border-slate-400 bg-white text-slate-800")}>
                            Whole scheme
                        </button>
                    )}
                </div>
                <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
                    {!byWarranty && <Button variant="outline" onClick={() => setImportOpen(true)}><FileSpreadsheet className="h-4 w-4 mr-1" />Import</Button>}
                    <Button variant="outline" onClick={exportSheet} disabled={!data.stores.length}><Download className="h-4 w-4 mr-1" />Export</Button>
                    <Button className={cn("bg-orange-500 hover:bg-orange-600", byWarranty && "col-span-2")} onClick={() => setEditing("new")}><Plus className="h-4 w-4 mr-1" />Add franchise</Button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                    ["Franchises", fmt(data.stores.length)],
                    [`Target · ${label}`, `${fmt(totals.target) || 0} ${unit}`],
                    [byWarranty ? "Approved so far" : "Achieved", `${fmt(totals.achieved) || 0} ${unit}`],
                    byWarranty || settings.benefit !== "per_unit" ? ["Reached the target", `${totals.reached}`] : ["Benefit earned", rupees(totals.benefit)],
                ] as const).map(([l, v]) => (
                    <div key={l} className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold text-slate-500">{l}</p>
                        <p className="text-lg font-extrabold text-slate-900 tabular-nums">{v}</p>
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search franchise or city" className="h-10 pl-9" aria-label="Search franchises" />
                </div>
                {byWarranty ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-xs font-semibold text-slate-600">For all {q ? "shown" : ""}:</span>
                        <Input type="number" value={bulk.growth} onChange={e => setBulk(b => ({ ...b, growth: e.target.value }))} placeholder="Growth %" className="h-10 w-28" aria-label="Growth % for all" />
                        <Button variant="outline" className="h-10" disabled={bulk.growth === ""} onClick={() => applyBulk("growth_pct", bulk.growth)}>Apply</Button>
                        <Input value={bulk.reward} onChange={e => setBulk(b => ({ ...b, reward: e.target.value }))} placeholder="Reward" className="h-10 w-32" aria-label="Reward for all" />
                        <Button variant="outline" className="h-10" disabled={!bulk.reward.trim()} onClick={() => applyBulk("reward", bulk.reward)}>Apply</Button>
                    </div>
                ) : (
                    <p className="text-xs text-slate-500">Steps: {settings.steps.map(st => `${st.pct}% → ${stepBenefit(st, settings.benefit, unit)}`).join(" · ") || "none set"}</p>
                )}
            </div>
            {byWarranty && (
                <p className="text-xs text-slate-500">
                    Average = approved warranties a month over {settings.baseline_months === 1 ? "the month" : `the ${settings.baseline_months} months`} before the scheme starts. Target = average × (1 + growth %). The franchise sees only its target number and reward.
                </p>
            )}

            {!data.stores.length ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                    <p className="font-semibold text-slate-900">No franchises on this scheme yet</p>
                    <p className="text-sm text-slate-500">{byWarranty ? "Add a franchise to see its warranties, then give it a growth % and a reward." : "Add them one by one, or import a sheet of stores and targets."}</p>
                </div>
            ) : (
                <>
                    {/* Phone: a card per franchise. */}
                    <div className="space-y-2 md:hidden">
                        {shown.map(s => {
                            const r = rowOf(s);
                            return (
                                <div key={s.store_id} className={cn("rounded-xl border bg-white p-3 space-y-3", terms[s.store_id] || edits[key(s)] ? "border-orange-300" : "border-slate-200")}>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-slate-900">{s.store_name}</p>
                                            <p className="text-xs text-slate-500">{[s.city, byWarranty && s.stats ? `avg ${fmt(s.stats.average)} / month` : s.own_steps ? "own steps" : null].filter(Boolean).join(" · ")}</p>
                                        </div>
                                        {resultCell(r)}
                                    </div>
                                    {byWarranty && (
                                        <div className="grid grid-cols-[auto_1fr] gap-2">
                                            <label className="space-y-1 text-xs font-semibold text-slate-600">Growth{growthInput(s)}</label>
                                            <label className="space-y-1 text-xs font-semibold text-slate-600">Reward{rewardInput(s, "w-full")}</label>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-3 gap-2 items-end">
                                        <label className="space-y-1 text-xs font-semibold text-slate-600">Target{numInput(s, "target", "w-full")}</label>
                                        <div className="space-y-1 text-xs font-semibold text-slate-600">{byWarranty ? "Approved" : "Achieved"}<div className="text-sm">{numInput(s, "achieved", "w-full")}</div></div>
                                        <div className="text-right"><p className="text-xs font-semibold text-slate-600">%</p><p className="text-lg font-extrabold tabular-nums">{pctOf(r) === null ? "—" : `${pctOf(r)}%`}</p></div>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                                        <div className="min-w-0"><p className="text-xs text-slate-500">{byWarranty ? "Earned" : "Benefit"}</p><p className="truncate font-bold text-slate-900">{benefitText(s, r)}</p></div>
                                        <div className="flex items-center gap-1">{paidCell(s, r)}{actions(s)}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Wider screens: the grid. */}
                    <div className="hidden md:block rounded-xl border border-slate-200 bg-white overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-4 py-3">Franchise</th>
                                    {byWarranty && <><th className="px-3 py-3">Avg / month</th><th className="px-3 py-3">Growth</th></>}
                                    <th className="px-3 py-3">Target</th>
                                    <th className="px-3 py-3">{byWarranty ? "Approved" : "Achieved"}</th>
                                    <th className="px-3 py-3">%</th>
                                    {byWarranty && <th className="px-3 py-3">Reward</th>}
                                    <th className="px-3 py-3">Result</th>
                                    {!byWarranty && <th className="px-3 py-3">Benefit</th>}
                                    <th className="px-3 py-3">Paid</th><th className="px-3 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map(s => {
                                    const r = rowOf(s);
                                    const pct = pctOf(r);
                                    return (
                                        <tr key={s.store_id} className={cn("border-t border-slate-100", (terms[s.store_id] || edits[key(s)]) && "bg-orange-50/40")}>
                                            <td className="px-4 py-2.5">
                                                <p className="font-semibold text-slate-900">{s.store_name}</p>
                                                <p className="text-xs text-slate-500">{[s.city, !byWarranty ? (s.own_steps ? "own steps" : "scheme steps") : null].filter(Boolean).join(" · ")}</p>
                                            </td>
                                            {byWarranty && <>
                                                <td className="px-3 py-2.5 tabular-nums">
                                                    <button type="button" onClick={() => setHistory(s)} className="font-semibold text-slate-900 underline decoration-dotted underline-offset-2 hover:text-orange-700" title="See its months">
                                                        {fmt(s.stats?.average ?? 0)}
                                                    </button>
                                                </td>
                                                <td className="px-3 py-2.5">{growthInput(s)}</td>
                                            </>}
                                            <td className="px-3 py-2.5">{numInput(s, "target")}</td>
                                            <td className="px-3 py-2.5">{numInput(s, "achieved")}</td>
                                            <td className="px-3 py-2.5 font-bold tabular-nums">{pct === null ? "—" : `${pct}%`}</td>
                                            {byWarranty && <td className="px-3 py-2.5">{rewardInput(s)}</td>}
                                            <td className="px-3 py-2.5">{resultCell(r)}</td>
                                            {!byWarranty && (
                                                <td className="px-3 py-2.5">
                                                    <p className="font-semibold text-slate-900">{benefitText(s, r)}</p>
                                                    {!whole && r.result?.step && settings.benefit === "per_unit" && <p className="text-xs text-slate-500">{fmt(r.achieved)} × {stepBenefit(r.result.step, settings.benefit, unit)}</p>}
                                                </td>
                                            )}
                                            <td className="px-3 py-2.5">{paidCell(s, r)}</td>
                                            <td className="px-3 py-2.5">{actions(s)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {dirty && (
                <>
                    <div className="h-28 md:h-20" aria-hidden />
                    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-orange-200 bg-white/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                        <div className="mx-auto flex max-w-5xl flex-col gap-2 md:flex-row md:items-center">
                            <p className="text-sm font-semibold text-slate-900 shrink-0">{count} {count === 1 ? "franchise" : "franchises"} changed</p>
                            <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={300}
                                placeholder={needsReason ? "Reason for the change (needed)" : "Note (optional)"} aria-label="Reason for the change" className="h-11 md:flex-1" />
                            <div className="grid grid-cols-2 gap-2 md:flex">
                                <Button variant="outline" className="h-11" onClick={() => { setEdits({}); setTerms({}); setReason(""); }}><Undo2 className="h-4 w-4 mr-1" />Discard</Button>
                                <Button className="h-11 bg-orange-500 hover:bg-orange-600" disabled={saving || (needsReason && reason.trim().length < 3)} onClick={save}>
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                                </Button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            <StoreDialog scheme={scheme} data={data} store={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />
            <RemoveDialog scheme={scheme} store={removing} onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); load(); }} />
            <HistoryDialog store={history} periods={data.periods} unit={unit} settings={settings} onClose={() => setHistory(null)} />
            {!byWarranty && <TargetImportDialog open={importOpen} scheme={scheme} data={data} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} />}
        </div>
    );
}

/* ─── A store's warranties by month ───────────────────────────────────────── */

function WarrantyMonths({ stats, months }: { stats: WarrantyStats; months: number }) {
    const base = new Set(stats.average_over);
    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-slate-700">Warranties per month</p>
                <p className="text-sm">Average <b className="tabular-nums">{stats.average.toLocaleString("en-IN")}</b> approved / month <span className="text-xs text-slate-500">({months === 1 ? "last month" : `last ${months} months`})</span></p>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2">Month</th><th className="px-2 py-2 text-right">Approved</th><th className="px-2 py-2 text-right">Waiting</th><th className="px-2 py-2 text-right">Rejected</th></tr></thead>
                    <tbody>
                        {[...stats.months].reverse().map(m => (
                            <tr key={m.month} className={cn("border-t border-slate-100", base.has(m.month) && "bg-orange-50/60")}>
                                <td className="px-3 py-1.5 font-medium text-slate-800">{formatMonth(m.month)}{base.has(m.month) && <span className="ml-1 text-[10px] font-bold text-orange-700">avg</span>}</td>
                                <td className="px-2 py-1.5 text-right font-bold tabular-nums">{m.approved}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{m.pending || ""}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-rose-600">{m.rejected || ""}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ─── Add or edit a franchise ─────────────────────────────────────────────── */

function StoreDialog({ scheme, data, store, onClose, onDone }: {
    scheme: Scheme; data: Data; store: TargetStore | "new" | null; onClose: () => void; onDone: () => void;
}) {
    const { toast } = useToast();
    const existing = store && store !== "new" ? store : null;
    const isNew = store === "new";
    const settings = data.settings;
    const byWarranty = settings.source === "warranties";
    const unit = settings.unit || "sets";
    const [storeId, setStoreId] = useState("");
    const [stats, setStats] = useState<WarrantyStats | null>(null);
    const [growth, setGrowth] = useState("");
    const [reward, setReward] = useState("");
    const [targets, setTargets] = useState<Record<string, string>>({});
    const [own, setOwn] = useState(false);
    const [steps, setSteps] = useState<TargetStep[]>([]);
    const [note, setNote] = useState("");
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!store) return;
        setStoreId(existing?.store_id ?? "");
        setStats(existing?.stats ?? null);
        setGrowth(existing?.growth_pct != null ? String(existing.growth_pct) : "");
        setReward(existing?.reward ?? "");
        setTargets(Object.fromEntries(data.periods.map(p => [p.key, existing?.figures[p.key]?.target != null ? String(existing.figures[p.key].target) : ""])));
        setOwn(Boolean(existing?.own_steps));
        setSteps(existing?.own_steps ?? settings.steps.map(x => ({ ...x })));
        setNote(existing?.note ?? ""); setReason("");
    }, [store]);
    /* A franchise being added: its warranties, to set its growth from. */
    useEffect(() => {
        if (!isNew || !storeId || !byWarranty) return;
        setStats(null);
        api.get(`/schemes/admin/${scheme.id}/targets/stats`, { params: { store_id: storeId } }).then(r => setStats(r.data.stats)).catch(() => setStats(null));
    }, [storeId, isNew]);

    const preview = byWarranty && stats && growth !== "" && Number.isFinite(Number(growth))
        ? data.periods.map(p => ({ label: p.label, target: growthTarget(stats.average, Number(growth), p.months.length) })) : null;
    const hadTargets = Boolean(existing && Object.values(existing.figures).some(f => f.target != null));
    const changedSet = Boolean(existing) && (byWarranty
        ? hadTargets && growth !== String(existing!.growth_pct ?? "")
        : data.periods.some(p => { const was = existing!.figures[p.key]?.target; return was != null && targets[p.key] !== String(was); }));

    const save = async () => {
        if (!storeId) return toast({ title: "Choose the franchise", variant: "destructive" });
        setSaving(true);
        try {
            const before = existing?.figures ?? {};
            const body = byWarranty
                ? { store_id: storeId, growth_pct: growth === "" ? null : Number(growth), reward, note, reason: reason.trim() || undefined }
                : {
                    store_id: storeId, note, reason: reason.trim() || undefined, steps: own ? steps : null,
                    targets: Object.fromEntries(Object.entries(targets).filter(([k, v]) => v !== "" && Number(v) !== before[k]?.target)),
                };
            const r = await api.post(`/schemes/admin/${scheme.id}/targets/stores`, body);
            toast({ title: r.data.added ? "Franchise added" : "Saved", description: r.data.added && scheme.status === "published" ? "It can see the scheme now." : undefined });
            onDone();
        } catch (e) {
            toast({ title: "Not saved", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setSaving(false); }
    };
    const first = data.periods[0]?.key;

    return (
        <Dialog open={Boolean(store)} onOpenChange={o => { if (!o && !saving) onClose(); }}>
            <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isNew ? "Add a franchise" : existing?.store_name}</DialogTitle>
                    <DialogDescription>{byWarranty ? "See its warranties, then give it a growth % and a reward. It sees only the number and the reward." : isNew ? "It sees this scheme once it's published." : "Targets, its steps and a note."}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    {isNew && (
                        <div className="space-y-1">
                            <p className="text-xs font-semibold text-slate-700">Franchise</p>
                            <Combobox
                                options={data.franchises.map(f => ({ value: f.id, label: [f.name, f.city, f.code].filter(Boolean).join(" · ") }))}
                                value={storeId} onChange={setStoreId}
                                placeholder="Choose a franchise" searchPlaceholder="Type a name, city or code…" emptyMessage="No franchise matches."
                                className="h-11 font-normal text-sm" />
                        </div>
                    )}

                    {byWarranty ? (
                        <>
                            {storeId && (stats ? <WarrantyMonths stats={stats} months={settings.baseline_months} /> : <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>)}
                            <div className="grid grid-cols-[110px_1fr] gap-3">
                                <label className="space-y-1"><span className="block text-xs font-semibold text-slate-700">Growth %</span>
                                    <Input type="number" inputMode="decimal" value={growth} onChange={e => setGrowth(e.target.value)} placeholder="e.g. 20" /></label>
                                <label className="space-y-1"><span className="block text-xs font-semibold text-slate-700">Reward on reaching the target</span>
                                    <Input value={reward} onChange={e => setReward(e.target.value)} placeholder="e.g. ₹5,000 or 2 seat covers free" maxLength={160} /></label>
                            </div>
                            {preview && (
                                <div className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-950">
                                    <p className="text-xs font-semibold">Its target (what the franchise sees)</p>
                                    <p className="mt-0.5">{preview.slice(0, 6).map(p => `${p.label}: ${p.target.toLocaleString("en-IN")}`).join(" · ")}{preview.length > 6 ? " …" : ""} {unit}</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-semibold text-slate-700">Target in {unit}{data.periods.length > 1 ? ", each period" : ""}</p>
                                    {data.periods.length > 1 && first && (
                                        <button type="button" className="text-xs font-semibold text-orange-600 hover:underline"
                                            onClick={() => setTargets(t => Object.fromEntries(data.periods.map(p => [p.key, t[first]])))}>
                                            Same as {data.periods[0].label} for all
                                        </button>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                    {data.periods.map(p => (
                                        <label key={p.key} className="space-y-1">
                                            <span className="block text-xs text-slate-500">{p.label}</span>
                                            <Input type="number" inputMode="decimal" min={0} value={targets[p.key] ?? ""} onChange={e => setTargets(t => ({ ...t, [p.key]: e.target.value }))} className="h-10" />
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-700">Reward steps</p>
                                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={!own} onChange={() => setOwn(false)} className="accent-orange-600" />
                                    The scheme's: {settings.steps.map(st => `${st.pct}% → ${stepBenefit(st, settings.benefit, unit)}`).join(" · ")}</label>
                                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={own} onChange={() => setOwn(true)} className="accent-orange-600" />Own steps for this franchise</label>
                                {own && <div className="rounded-lg border border-slate-200 p-3"><StepsEditor steps={steps} benefit={settings.benefit} unit={unit} onChange={setSteps} /></div>}
                            </div>
                        </>
                    )}
                    <label className="block space-y-1"><span className="block text-xs font-semibold text-slate-700">Note (only the head office sees it)</span>
                        <Input value={note} onChange={e => setNote(e.target.value)} maxLength={300} /></label>
                    {changedSet && (
                        <label className="block space-y-1"><span className="block text-xs font-semibold text-slate-700">Reason for changing its target (needed)</span>
                            <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} /></label>
                    )}
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button className="bg-orange-500 hover:bg-orange-600" onClick={save} disabled={saving || (changedSet && reason.trim().length < 3)}>
                        {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{isNew ? "Add to the scheme" : "Save"}
                    </Button>
                </DialogFooter>
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
            toast({ title: `${store.store_name} removed from the scheme` });
            onDone();
        } catch (e) { toast({ title: "Not removed", description: getErrorMessage(e, ""), variant: "destructive" }); }
        finally { setBusy(false); }
    };
    return (
        <Dialog open={Boolean(store)} onOpenChange={o => { if (!o && !busy) onClose(); }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Remove {store?.store_name}?</DialogTitle>
                    <DialogDescription>It stops seeing this scheme, and its targets are taken off. They stay in the activity log.</DialogDescription>
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

function HistoryDialog({ store, periods, unit, settings, onClose }: { store: TargetStore | null; periods: Period[]; unit: string; settings: SchemeSettings; onClose: () => void }) {
    const items = store ? periods.flatMap(p => (store.figures[p.key]?.history ?? []).map(h => ({ ...h, period: p.label }))).sort((a, b) => b.at.localeCompare(a.at)) : [];
    const FIELD = { target: "Target", achieved: "Achieved", paid: "Payment" } as const;
    return (
        <Dialog open={Boolean(store)} onOpenChange={o => { if (!o) onClose(); }}>
            <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{store?.store_name}</DialogTitle>
                    <DialogDescription>{store?.stats ? "Its warranties, and every change to its targets and payments." : "Every target, achieved figure and payment, newest first."}</DialogDescription>
                </DialogHeader>
                {store?.stats && <WarrantyMonths stats={store.stats} months={settings.baseline_months} />}
                {store?.growth_pct != null && <p className="text-sm">Growth <b>{store.growth_pct}%</b>{store.reward ? <> · reward <b>{store.reward}</b></> : null}</p>}
                <p className="text-xs font-semibold text-slate-700">Changes</p>
                {!items.length ? <p className="text-sm text-slate-500">Nothing yet.</p> : (
                    <ol className="space-y-2.5">
                        {items.map((h, i) => (
                            <li key={i} className="text-sm">
                                <p className="font-semibold text-slate-900">{h.period} · {FIELD[h.field]}: {h.from ?? "—"} → {h.to ?? "—"}{h.field !== "paid" ? ` ${unit}` : ""}</p>
                                <p className="text-xs text-slate-500">{when(h.at)}{h.by ? ` · ${h.by}` : ""}</p>
                                {h.reason && <p className="mt-0.5 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">{h.reason}</p>}
                            </li>
                        ))}
                    </ol>
                )}
            </DialogContent>
        </Dialog>
    );
}

/* ─── Import from a sheet (typed figures) ─────────────────────────────────── */

interface Plan { rows: number; changes: number; new_stores: string[]; problems: { row: number; problem: string }[] }

function TargetImportDialog({ open, scheme, data, onClose, onDone }: { open: boolean; scheme: Scheme; data: Data; onClose: () => void; onDone: () => void }) {
    const { toast } = useToast();
    const [rows, setRows] = useState<{ row: number; store: string; period: unknown; target: unknown; achieved: unknown }[]>([]);
    const [plan, setPlan] = useState<Plan | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (open) { setRows([]); setPlan(null); } }, [open]);

    const template = () => {
        const out: (string | number)[][] = [["Store code or name", "Period", "Target", "Achieved"]];
        const codes = new Map(data.franchises.map(f => [f.id, f.code]));
        for (const s of data.stores) for (const p of data.periods) out.push([codes.get(s.store_id) || s.store_name, p.label, s.figures[p.key]?.target ?? "", s.figures[p.key]?.achieved ?? ""]);
        if (out.length === 1) out.push(["AF-101", data.periods[0]?.label ?? "", 100, ""]);
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(out), "Targets");
        XLSX.writeFile(wb, "targets-template.xlsx");
    };
    const read = async (file: File) => {
        setBusy(true); setPlan(null);
        try {
            const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
            const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
            const head = (grid[0] ?? []).map(h => String(h).toLowerCase());
            const col = (...names: string[]) => head.findIndex(h => names.some(n => h.includes(n)));
            const c = { store: col("store", "code", "franchise"), period: col("period", "month", "quarter"), target: col("target"), achieved: col("achieved", "sold", "actual") };
            if (c.store < 0 || (c.target < 0 && c.achieved < 0)) throw new Error("The first row needs a Store column and a Target or Achieved column");
            const found = grid.slice(1).map((r, i) => ({
                row: i + 2, store: String(r[c.store] ?? "").trim(), period: c.period >= 0 ? r[c.period] : "",
                target: c.target >= 0 ? r[c.target] : "", achieved: c.achieved >= 0 ? r[c.achieved] : "",
            })).filter(r => r.store || r.target || r.achieved);
            setRows(found);
            const p = await api.post(`/schemes/admin/${scheme.id}/targets/import`, { rows: found, dry_run: true });
            setPlan(p.data);
        } catch (e) {
            toast({ title: "Could not read the sheet", description: getErrorMessage(e, "Check the file"), variant: "destructive" });
        } finally { setBusy(false); }
    };
    const run = async () => {
        setBusy(true);
        try {
            const r = await api.post(`/schemes/admin/${scheme.id}/targets/import`, { rows });
            toast({ title: `Imported ${r.data.changes} rows`, description: r.data.new_stores.length ? `${r.data.new_stores.length} franchises added.` : undefined });
            onDone();
        } catch (e) { toast({ title: "Not imported", description: getErrorMessage(e, ""), variant: "destructive" }); }
        finally { setBusy(false); }
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!o && !busy) onClose(); }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Import targets and achievement</DialogTitle>
                    <DialogDescription>One row per franchise and period: store code (or exact name), period, target, achieved. A blank cell changes nothing; franchises not yet on the scheme are added.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <Button variant="outline" size="sm" onClick={template}><Download className="h-4 w-4 mr-1" />Download the sheet with your franchises</Button>
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-5 text-sm font-semibold text-slate-700 hover:border-orange-400">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Choose the filled sheet
                        <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) read(f); }} />
                    </label>
                    {plan && (
                        <div className="space-y-2 text-sm">
                            <p><b>{plan.changes}</b> of {plan.rows} rows will be saved.{plan.new_stores.length ? ` ${plan.new_stores.length} franchises will be added: ${plan.new_stores.slice(0, 8).join(", ")}${plan.new_stores.length > 8 ? "…" : ""}.` : ""}</p>
                            {plan.problems.length > 0 && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                                    <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" />{plan.problems.length} rows will be skipped</p>
                                    <ul className="mt-1 max-h-40 overflow-y-auto list-disc pl-5 text-xs">{plan.problems.map(p => <li key={p.row}>Row {p.row}: {p.problem}</li>)}</ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button className="bg-orange-500 hover:bg-orange-600" disabled={busy || !plan?.changes} onClick={run}>Import {plan?.changes ?? ""} rows</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
