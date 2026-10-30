import { useMemo, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { averageOn, type AverageBasis, type Period, type Scheme, type SchemeSettings, type TargetStore } from "@/lib/schemes";

/**
 * Step 3 of a target scheme, month by month: each franchise gets its own
 * target for each month (period) the scheme runs, plus its reward (and, in
 * points, its store type). The same step with one target for every month is
 * TargetsView / PointsTargetsView; the two are switched in TargetsTab.
 */

interface Data { periods: Period[]; stores: TargetStore[]; settings: SchemeSettings }
type Row = { targets: Record<string, string>; reward?: string; tier?: string };

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-IN"));
const shortLabel = (p: Period) => p.label.replace(/ \d{4}$/, "");

/** Whether any franchise already has different targets in different months. */
export function hasMonthlyTargets(data: Data) {
    return data.stores.some(s => new Set(data.periods.map(p => s.figures[p.key]?.target ?? null)).size > 1);
}

export function MonthTargets({ scheme, data, basis, onMonths, onRemove, onBack, onSaved }: {
    scheme: Scheme; data: Data; basis: AverageBasis;
    onMonths: (s: TargetStore) => void; onRemove: (s: TargetStore) => void; onBack: () => void; onSaved: (started: boolean) => Promise<void>;
}) {
    const { toast } = useToast();
    const points = data.settings.measure === "points";
    const unit = points ? "points" : "warranties";
    const tiers = data.settings.points?.tiers ?? [];
    const [edits, setEdits] = useState<Record<string, Row>>({});
    const [all, setAll] = useState({ period: "", target: "" });
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState<"save" | "start" | null>(null);
    const draft = scheme.status === "draft";

    const savedTarget = (s: TargetStore, key: string) => {
        const t = s.figures[key]?.target;
        return t === null || t === undefined ? "" : String(t);
    };
    const target = (s: TargetStore, key: string) => edits[s.store_id]?.targets[key] ?? savedTarget(s, key);
    const reward = (s: TargetStore) => edits[s.store_id]?.reward ?? s.reward ?? "";
    const tier = (s: TargetStore) => edits[s.store_id]?.tier ?? s.tier ?? tiers[0]?.id ?? "";
    const timesOf = (s: TargetStore) => (points ? tiers.find(t => t.id === tier(s))?.times ?? 1 : 1);

    const setTarget = (s: TargetStore, key: string, v: string) => setEdits(prev => {
        const row: Row = { ...(prev[s.store_id] ?? { targets: {} }), targets: { ...(prev[s.store_id]?.targets ?? {}) } };
        if (v.trim() === savedTarget(s, key)) delete row.targets[key]; else row.targets[key] = v;
        return { ...prev, [s.store_id]: row };
    });
    const setField = (s: TargetStore, k: "reward" | "tier", v: string) => setEdits(prev => {
        const row: Row = { ...(prev[s.store_id] ?? { targets: {} }) };
        const saved = k === "reward" ? s.reward ?? "" : s.tier ?? tiers[0]?.id ?? "";
        if (v === saved) delete row[k]; else row[k] = v;
        return { ...prev, [s.store_id]: row };
    });

    const changed = Object.entries(edits).filter(([, r]) => Object.keys(r.targets).length || r.reward !== undefined || r.tier !== undefined);
    /* Changing a target already set needs a reason, as everywhere else on a target scheme. */
    const needsReason = data.stores.some(s => Object.keys(edits[s.store_id]?.targets ?? {}).some(k => savedTarget(s, k) !== ""));
    const missing = data.stores.filter(s => data.periods.some(p => !(Number(target(s, p.key)) > 0)) || !reward(s).trim());
    const totals = useMemo(() => Object.fromEntries(data.periods.map(p => [p.key, data.stores.reduce((n, s) => n + (Number(target(s, p.key)) || 0), 0)])), [data, edits]);

    const apply = () => {
        const keys = all.period ? [all.period] : data.periods.map(p => p.key);
        for (const s of data.stores) for (const k of keys) setTarget(s, k, all.target);
    };

    const save = async (start: boolean) => {
        if (start && missing.length) return toast({ title: `${missing.length} ${missing.length === 1 ? "franchise needs" : "franchises need"} a target every month and a reward`, variant: "destructive" });
        const bad = changed.flatMap(([, r]) => Object.values(r.targets)).find(v => v.trim() !== "" && !(Number(v) > 0));
        if (bad !== undefined) return toast({ title: "Every target must be a number above 0", variant: "destructive" });
        setBusy(start ? "start" : "save");
        try {
            const figures = changed.flatMap(([store_id, r]) => Object.entries(r.targets).filter(([, v]) => v.trim() !== "").map(([period, v]) => ({ store_id, period, target: Number(v) })));
            if (figures.length) await api.put(`/schemes/admin/${scheme.id}/targets/figures`, { changes: figures, reason: reason.trim() || undefined });
            const terms = changed.filter(([, r]) => r.reward !== undefined || r.tier !== undefined)
                .map(([store_id, r]) => ({ store_id, ...(r.reward !== undefined ? { reward: r.reward } : {}), ...(r.tier !== undefined ? { tier: r.tier } : {}) }));
            if (terms.length) await api.put(`/schemes/admin/${scheme.id}/targets/terms`, { stores: terms });
            if (start && draft) await api.post(`/schemes/admin/${scheme.id}/publish`);
            toast({ title: start && draft ? "Scheme started" : "Saved", description: start && draft ? "The franchises can see their targets now." : undefined });
            setEdits({}); setReason("");
            await onSaved(start);
        } catch (e) {
            toast({ title: "Not saved", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setBusy(null); }
    };

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-2xl font-extrabold text-slate-900">Each franchise's target, month by month</h2>
                <p className="mt-1 text-sm text-slate-600">Type a target in {unit} for every month, and the reward on reaching it.</p>
            </div>

            <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <span className="self-center text-sm font-bold text-slate-800">Same for everyone:</span>
                <label className="space-y-1"><span className="block text-xs text-slate-500">Month</span>
                    <select value={all.period} onChange={e => setAll(a => ({ ...a, period: e.target.value }))} className="h-11 rounded-md border border-slate-300 bg-white px-2 text-sm">
                        <option value="">Every month</option>{data.periods.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select></label>
                <label className="space-y-1"><span className="block text-xs text-slate-500">Target {unit}</span>
                    <Input type="number" inputMode="decimal" value={all.target} onChange={e => setAll(a => ({ ...a, target: e.target.value }))} className="h-11 w-28" /></label>
                <Button className="h-11 bg-slate-900 font-bold" disabled={!(Number(all.target) > 0)} onClick={apply}>Apply to all</Button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        <tr>
                            <th className="px-4 py-3">Franchise</th>
                            <th className="px-2 py-3">Avg / month</th>
                            {points && <th className="px-2 py-3">Store type</th>}
                            {data.periods.map(p => <th key={p.key} className="px-2 py-3">{shortLabel(p)}</th>)}
                            <th className="px-2 py-3">Reward</th>
                            <th className="w-12" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {data.stores.map(s => {
                            const avg = Math.round(averageOn(s.stats?.averages, basis) * timesOf(s) * 10) / 10;
                            return (
                                <tr key={s.store_id} className={cn(edits[s.store_id] && "bg-orange-50/40")}>
                                    <td className="px-4 py-2.5"><b className="block max-w-[220px] truncate text-slate-900">{s.store_name}</b><span className="text-xs text-slate-500">{s.city}</span></td>
                                    <td className="px-2 py-2.5">
                                        <button type="button" onClick={() => onMonths(s)} title="See its months"
                                            className="font-bold tabular-nums underline decoration-dotted underline-offset-4">{fmt(avg)}</button>
                                    </td>
                                    {points && (
                                        <td className="px-2 py-2.5">
                                            <select value={tier(s)} onChange={e => setField(s, "tier", e.target.value)} aria-label={`Store type for ${s.store_name}`}
                                                className={cn("h-11 rounded-md border border-slate-300 bg-white px-2 text-sm", edits[s.store_id]?.tier !== undefined && "border-orange-500 bg-orange-50")}>
                                                {tiers.map(t => <option key={t.id} value={t.id}>{t.name} ×{t.times}</option>)}
                                            </select>
                                        </td>
                                    )}
                                    {data.periods.map(p => (
                                        <td key={p.key} className="px-2 py-2.5">
                                            <Input type="number" inputMode="decimal" value={target(s, p.key)} onChange={e => setTarget(s, p.key, e.target.value)} placeholder="0"
                                                aria-label={`${s.store_name} target for ${p.label}`}
                                                className={cn("h-11 w-24", edits[s.store_id]?.targets[p.key] !== undefined && "border-orange-500 bg-orange-50")} />
                                        </td>
                                    ))}
                                    <td className="px-2 py-2.5">
                                        <Input value={reward(s)} onChange={e => setField(s, "reward", e.target.value)} maxLength={160} aria-label={`Reward for ${s.store_name}`}
                                            className={cn("h-11 w-44", edits[s.store_id]?.reward !== undefined && "border-orange-500 bg-orange-50")} />
                                    </td>
                                    <td className="pr-2">
                                        <Button size="icon" variant="ghost" className="h-10 w-10 text-rose-600" onClick={() => onRemove(s)} aria-label={`Remove ${s.store_name}`}><Trash2 className="h-4 w-4" /></Button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot className="bg-slate-50 text-xs font-bold text-slate-600">
                        <tr>
                            <td className="px-4 py-3" colSpan={points ? 3 : 2}>Total {unit}</td>
                            {data.periods.map(p => <td key={p.key} className="px-2 py-3 tabular-nums">{fmt(totals[p.key])}</td>)}
                            <td colSpan={2} />
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div className="sticky bottom-0 z-20 space-y-2 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm"><b>{data.stores.length} franchises</b> · {data.periods.length} months</span>
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
                {needsReason && <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why the target changed (needed — it changes targets already set)" maxLength={300} className="h-11" aria-label="Reason" />}
                {draft && missing.length > 0 && <p className="text-xs text-slate-500">{missing.length} still need a target every month and a reward before you can start.</p>}
            </div>
        </div>
    );
}
