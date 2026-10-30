import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, X } from "lucide-react";
import type { PointsRule, PointSeries } from "@/lib/schemes";

/**
 * A target scheme counted in points: the series (each with its points and the
 * warranty products in it) and the store types (each with its multiplier).
 * The admin adds, renames and removes both; a product sits in one series.
 */

interface Product { name: string; brand: string | null }

const newId = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;

/** The series a product goes in by its name, for a first fill the admin then corrects. */
function seriesByName(name: string): string | null {
    const n = name.toUpperCase();
    if (n.includes("EMPORIO")) return "Emporio";
    if (n.includes("SIGNATURE")) return "Signature";
    if (n.includes("DOBLE")) return "Doble";
    if (n.startsWith("AMAZE")) return "Amaze";
    if (n.includes("SPORTZ")) return "Sportz";
    return null;
}

/** The poster's series and store types, with products put in by name. */
export function startingPoints(products: string[]): PointsRule {
    const series: PointSeries[] = [["Amaze", 0.5], ["Sportz", 0.75], ["Doble", 1], ["Signature", 1.25], ["Emporio", 1.5]]
        .map(([name, points]) => ({ id: newId("s"), name: name as string, points: points as number, products: products.filter(p => seriesByName(p) === name) }));
    return { series, tiers: [{ id: newId("t"), name: "Regular", times: 1 }, { id: newId("t"), name: "Big Daddy", times: 2 }] };
}

export function useWarrantyProducts() {
    const [products, setProducts] = useState<Product[] | null>(null);
    useEffect(() => {
        api.get("/schemes/admin/products")
            .then(r => setProducts((r.data?.warranty ?? []).map((p: any) => ({ name: p.name, brand: p.brand ?? null }))))
            .catch(() => setProducts([]));
    }, []);
    return products;
}

export function PointsRuleEditor({ rule, onChange, products }: { rule: PointsRule; onChange: (r: PointsRule) => void; products: Product[] }) {
    const [adding, setAdding] = useState<string | null>(null);
    const owner = useMemo(() => {
        const m = new Map<string, string>();
        for (const s of rule.series) for (const p of s.products) m.set(p.toLowerCase(), s.id);
        return m;
    }, [rule]);
    const loose = products.filter(p => !owner.has(p.name.toLowerCase()));
    const brandOf = new Map(products.map(p => [p.name.toLowerCase(), p.brand]));

    const setSeries = (id: string, patch: Partial<PointSeries>) => onChange({ ...rule, series: rule.series.map(s => (s.id === id ? { ...s, ...patch } : s)) });
    /* Putting a product in a series takes it out of any other. */
    const moveTo = (id: string, name: string) => onChange({
        ...rule,
        series: rule.series.map(s => s.id === id
            ? { ...s, products: [...s.products.filter(p => p.toLowerCase() !== name.toLowerCase()), name] }
            : { ...s, products: s.products.filter(p => p.toLowerCase() !== name.toLowerCase()) }),
    });

    return (
        <div className="space-y-5">
            <div className="space-y-2">
                <p className="text-sm font-bold text-slate-900">Points for each series</p>
                <div className="space-y-3">
                    {rule.series.map(s => (
                        <div key={s.id} className="rounded-xl border border-slate-200 p-3">
                            <div className="flex flex-wrap items-end gap-2">
                                <label className="min-w-0 flex-1 space-y-1"><span className="block text-xs text-slate-500">Series</span>
                                    <Input value={s.name} onChange={e => setSeries(s.id, { name: e.target.value })} maxLength={40} className="h-11" /></label>
                                <label className="space-y-1"><span className="block text-xs text-slate-500">Points</span>
                                    <Input type="number" inputMode="decimal" step="0.05" min={0} value={Number.isFinite(s.points) ? s.points : ""} onChange={e => setSeries(s.id, { points: e.target.value === "" ? NaN : Number(e.target.value) })} className="h-11 w-24" /></label>
                                <Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-rose-500" aria-label={`Remove ${s.name || "series"}`}
                                    onClick={() => onChange({ ...rule, series: rule.series.filter(x => x.id !== s.id) })}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {s.products.map(p => (
                                    <span key={p} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 text-xs font-semibold text-slate-800">
                                        {p}{brandOf.get(p.toLowerCase()) === "AC" && <span className="text-[10px] text-slate-500">AC</span>}
                                        <button type="button" className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-200" aria-label={`Take ${p} out of ${s.name}`}
                                            onClick={() => setSeries(s.id, { products: s.products.filter(x => x !== p) })}><X className="h-3 w-3" /></button>
                                    </span>
                                ))}
                                {adding === s.id ? (
                                    <select autoFocus className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs" aria-label={`Add a product to ${s.name}`}
                                        value="" onBlur={() => setAdding(null)} onChange={e => { if (e.target.value) moveTo(s.id, e.target.value); setAdding(null); }}>
                                        <option value="">Choose a product…</option>
                                        {loose.length > 0 && <optgroup label="Not in a series">{loose.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>}
                                        <optgroup label="In another series (moves it)">
                                            {products.filter(p => owner.has(p.name.toLowerCase()) && owner.get(p.name.toLowerCase()) !== s.id).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                                        </optgroup>
                                    </select>
                                ) : (
                                    <button type="button" onClick={() => setAdding(s.id)} className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-slate-400 px-2.5 text-xs font-semibold text-slate-700 hover:border-slate-600">
                                        <Plus className="h-3 w-3" />Product
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...rule, series: [...rule.series, { id: newId("s"), name: "", points: NaN, products: [] }] })}>
                    <Plus className="h-4 w-4 mr-1" />Add a series
                </Button>
                {loose.length > 0 && (
                    <details className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-950">
                        <summary className="cursor-pointer font-semibold">{loose.length} products are in no series and earn 0 points</summary>
                        <p className="mt-2 leading-relaxed">{loose.map(p => p.name).join(", ")}</p>
                    </details>
                )}
            </div>

            <div className="space-y-2">
                <p className="text-sm font-bold text-slate-900">Store types</p>
                {rule.tiers.map(t => (
                    <div key={t.id} className="flex items-end gap-2">
                        <label className="min-w-0 flex-1 space-y-1"><span className="block text-xs text-slate-500">Type</span>
                            <Input value={t.name} maxLength={40} className="h-11"
                                onChange={e => onChange({ ...rule, tiers: rule.tiers.map(x => (x.id === t.id ? { ...x, name: e.target.value } : x)) })} /></label>
                        <label className="space-y-1"><span className="block text-xs text-slate-500">Points ×</span>
                            <Input type="number" inputMode="decimal" step="0.5" min={0} value={Number.isFinite(t.times) ? t.times : ""} className="h-11 w-24"
                                onChange={e => onChange({ ...rule, tiers: rule.tiers.map(x => (x.id === t.id ? { ...x, times: e.target.value === "" ? NaN : Number(e.target.value) } : x)) })} /></label>
                        <Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-rose-500" aria-label={`Remove ${t.name || "store type"}`} disabled={rule.tiers.length === 1}
                            onClick={() => onChange({ ...rule, tiers: rule.tiers.filter(x => x.id !== t.id) })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...rule, tiers: [...rule.tiers, { id: newId("t"), name: "", times: 1 }] })}>
                    <Plus className="h-4 w-4 mr-1" />Add a store type
                </Button>
            </div>
        </div>
    );
}
