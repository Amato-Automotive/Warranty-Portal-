import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Option 1 in the edit form: each store's target for a month, typed by hand.
 * Stores on Option 1 come first; stores that haven't chosen yet can be given
 * one ahead of time. Stores on Option 2 have no target, so they aren't listed.
 * Changes are held here and saved with the form's Save.
 */

export type TargetEdits = Record<string, Record<string, string>>;
interface Row { store_id: string; store_name: string; store_code: string | null; city: string | null; state: string | null; option: string | null; targets: Record<string, number> }
interface Data { months: { key: string; label: string }[]; current: string; stores: Row[] }

export function StoreTargetsEditor({ schemeId, open, edits, onEdits }: { schemeId: string; open: boolean; edits: TargetEdits; onEdits: (e: TargetEdits) => void }) {
    const [d, setD] = useState<Data | null>(null);
    const [failed, setFailed] = useState(false);
    const [month, setMonth] = useState("");
    const [q, setQ] = useState("");
    const [show, setShow] = useState<"all" | "option1" | "none">("all");

    useEffect(() => {
        if (!open) return;
        setD(null); setFailed(false);
        api.get(`/schemes/admin/${schemeId}/sell-more/targets`)
            .then(r => { setD(r.data); setMonth(r.data.current); })
            .catch(() => setFailed(true));
    }, [open, schemeId]);

    const rows = useMemo(() => {
        const term = q.trim().toLowerCase();
        return (d?.stores ?? [])
            .filter(s => show === "all" || (show === "option1" ? s.option === "sell_more" : !s.option))
            .filter(s => !term || [s.store_name, s.store_code, s.city, s.state].some(v => String(v ?? "").toLowerCase().includes(term)));
    }, [d, q, show]);

    const changed = Object.values(edits).reduce((n, m) => n + Object.keys(m).length, 0);
    const valueOf = (s: Row) => edits[month]?.[s.store_id] ?? (s.targets[month] !== undefined ? String(s.targets[month]) : "");
    const setValue = (s: Row, value: string) => {
        const was = s.targets[month] !== undefined ? String(s.targets[month]) : "";
        const forMonth = { ...(edits[month] ?? {}) };
        if (value === was) delete forMonth[s.store_id]; else forMonth[s.store_id] = value;
        onEdits({ ...edits, [month]: forMonth });
    };

    return (
        <section className="space-y-3 rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h3 className="text-sm font-bold text-slate-900">Option 1: store targets</h3>
                    <p className="text-xs text-slate-500">In calculated points, for the month. A store can request its reward once it reaches its target.</p>
                </div>
                {changed > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">{changed} to save</span>}
            </div>
            {failed ? <p className="text-sm text-rose-600">Could not load the stores.</p>
                : !d ? <p className="text-sm text-slate-500"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Loading stores…</p>
                : (
                    <>
                        <div className="flex flex-wrap gap-2">
                            <select value={month} onChange={e => setMonth(e.target.value)} aria-label="Month" className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-medium">
                                {d.months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                            </select>
                            <select value={show} onChange={e => setShow(e.target.value as typeof show)} aria-label="Stores to show" className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-medium">
                                <option value="all">All stores</option>
                                <option value="option1">On Option 1</option>
                                <option value="none">Not chosen yet</option>
                            </select>
                            <div className="relative min-w-40 flex-1">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store, code, city or state" className="h-9 pl-8" aria-label="Search stores" />
                            </div>
                        </div>
                        <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-100">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-500">
                                    <tr><th className="px-3 py-2 font-semibold">Store</th><th className="px-3 py-2 font-semibold">Option</th><th className="px-3 py-2 text-right font-semibold">Target</th></tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {rows.map(s => (
                                        <tr key={s.store_id}>
                                            <td className="px-3 py-1.5">
                                                <p className="font-medium text-slate-900">{s.store_name}</p>
                                                <p className="text-xs text-slate-500">{[s.store_code, s.city, s.state].filter(Boolean).join(" · ")}</p>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-1.5">
                                                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", s.option ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-600")}>{s.option ? "Option 1" : "Not chosen"}</span>
                                            </td>
                                            <td className="px-3 py-1.5 text-right">
                                                <Input type="number" min={0} step="0.01" inputMode="decimal" value={valueOf(s)} placeholder="Not set" onChange={e => setValue(s, e.target.value)}
                                                    className="ml-auto h-8 w-24 text-right" aria-label={`Target for ${s.store_name}`} />
                                            </td>
                                        </tr>
                                    ))}
                                    {!rows.length && <tr><td colSpan={3} className="px-3 py-6 text-center text-sm text-slate-500">No store matches.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
        </section>
    );
}
