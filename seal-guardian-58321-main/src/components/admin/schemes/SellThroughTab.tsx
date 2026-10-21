import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search } from "lucide-react";
import { formatMonth } from "@/lib/schemes";

/**
 * Sell-through: for each store and month, the units it bought on approved
 * invoices against the warranties it registered for the same products — what
 * it actually sold to customers. Under the target (90% by default) is marked.
 */

interface Store {
    store_id: string; store_name: string; city: string | null; state: string | null;
    months: { month: string; bought: number; sold: number; pct: number | null }[];
}

export function SellThroughTab({ schemeId, refreshKey }: { schemeId: string; refreshKey: number }) {
    const [stores, setStores] = useState<Store[] | null>(null);
    const [q, setQ] = useState("");
    const [target, setTarget] = useState("90");
    const [onlyBelow, setOnlyBelow] = useState(false);

    useEffect(() => {
        setStores(null);
        api.get(`/schemes/admin/${schemeId}/sell-through`).then(r => setStores(r.data.stores || [])).catch(() => setStores([]));
    }, [schemeId, refreshKey]);

    const t = Number(target) || 0;
    const months = useMemo(() => [...new Set((stores ?? []).flatMap(s => s.months.map(m => m.month)))].sort(), [stores]);
    const shown = useMemo(() => (stores ?? []).filter(s => {
        const n = q.trim().toLowerCase();
        if (n && ![s.store_name, s.city, s.state].some(v => String(v ?? "").toLowerCase().includes(n))) return false;
        if (onlyBelow && !s.months.some(m => m.pct !== null && m.pct < t)) return false;
        return true;
    }), [stores, q, onlyBelow, t]);

    if (!stores) return <div className="flex items-center justify-center min-h-[200px] gap-2 text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /> Working it out…</div>;

    return (
        <div className="space-y-3">
            <p className="text-xs text-slate-500">
                Units bought on approved invoices against warranties the store registered for those products in the same month.
                A warranty counts for a series when its product name starts with the series name — "Amaze Series" takes AMAZE and AMAZE DUO.
            </p>
            <div className="rounded-2xl border border-slate-100 bg-white p-3 flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Store or city" className="pl-8 h-9" />
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">Target
                    <Input type="number" min={0} max={100} value={target} onChange={e => setTarget(e.target.value)} className="h-9 w-20" aria-label="Target %" />%
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                    <Checkbox checked={onlyBelow} onCheckedChange={c => setOnlyBelow(Boolean(c))} /> Only stores below target
                </label>
            </div>
            {!shown.length ? (
                <p className="text-sm text-slate-400 py-10 text-center">{stores.length ? "No stores match." : "No approved product entries yet."}</p>
            ) : (
                <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
                    <div className="overflow-auto max-h-[calc(100vh-420px)]">
                        <table className="w-full text-sm text-left" style={{ minWidth: 260 + months.length * 120 }}>
                            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-700 shadow-[0_1px_0_0_rgb(241,245,249)]">
                                <tr>
                                    <th className="px-3 py-2.5 text-xs font-bold uppercase w-[240px]">Store</th>
                                    {months.map(m => <th key={m} className="px-3 py-2.5 text-xs font-bold uppercase text-right">{formatMonth(m)}</th>)}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {shown.map(s => (
                                    <tr key={s.store_id}>
                                        <td className="px-3 py-2.5">
                                            <div className="font-semibold text-slate-800">{s.store_name}</div>
                                            <div className="text-xs text-slate-400">{[s.city, s.state].filter(Boolean).join(", ")}</div>
                                        </td>
                                        {months.map(m => {
                                            const v = s.months.find(x => x.month === m);
                                            const low = v?.pct !== null && v?.pct !== undefined && v.pct < t;
                                            return (
                                                <td key={m} className={`px-3 py-2.5 text-right tabular-nums ${low ? "bg-rose-50" : ""}`}
                                                    title={v ? `Bought ${v.bought}, registered ${v.sold}` : undefined}>
                                                    {!v ? <span className="text-slate-300">—</span> : (
                                                        <>
                                                            <div className={`font-bold ${low ? "text-rose-700" : v.pct === null ? "text-slate-400" : "text-emerald-700"}`}>{v.pct === null ? "—" : `${v.pct}%`}</div>
                                                            <div className="text-[11px] text-slate-500">{v.sold} of {v.bought}</div>
                                                        </>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
