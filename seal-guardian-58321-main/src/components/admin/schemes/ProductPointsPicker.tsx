import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import type { ProductPoints } from "@/lib/schemes";

/**
 * Which products a scheme is on, and what each is worth. Picked from the
 * warranty products or the product catalogue, or typed by hand for anything
 * in neither. Ids say where a product came from: "w:12" warranty, "c:40"
 * catalogue, "m_…" typed by hand.
 */

interface Option { id: string; name: string; group: string | null; code?: string | null }
type Source = "warranty" | "catalogue" | "manual";

const SOURCE_LABEL: Record<Source, string> = { warranty: "Warranty product", catalogue: "Catalogue", manual: "Added by hand" };
const sourceOf = (id: string): Source => (id.startsWith("w:") ? "warranty" : id.startsWith("c:") ? "catalogue" : "manual");

export function ProductPointsPicker({ products, onChange, brand }: {
    products: ProductPoints[];
    onChange: (p: ProductPoints[]) => void;
    /* The scheme's brand, to show only that brand's catalogue products first. */
    brand: "AF" | "AC" | null;
}) {
    const [lists, setLists] = useState<{ warranty: Option[]; catalogue: Option[] } | null>(null);
    const [tab, setTab] = useState<Source>("warranty");
    const [search, setSearch] = useState("");
    const [defaultPoints, setDefaultPoints] = useState("1");
    const [manual, setManual] = useState({ name: "", points: "" });
    const [allPoints, setAllPoints] = useState("");

    useEffect(() => {
        api.get("/schemes/admin/products")
            .then(r => setLists({ warranty: r.data.warranty || [], catalogue: r.data.catalogue || [] }))
            .catch(() => setLists({ warranty: [], catalogue: [] }));
    }, []);

    const chosen = useMemo(() => new Set(products.map(p => p.id)), [products]);
    const options = useMemo(() => {
        if (!lists || tab === "manual") return [];
        const q = search.trim().toLowerCase();
        let list = lists[tab];
        if (tab === "catalogue" && brand) list = list.filter(o => !o.group || o.group === brand);
        return list.filter(o => !q || [o.name, o.group, o.code].some(v => String(v ?? "").toLowerCase().includes(q)));
    }, [lists, tab, search, brand]);

    const pts = () => Math.max(Number(defaultPoints) || 1, 0);
    const toggle = (o: Option) => onChange(chosen.has(o.id)
        ? products.filter(p => p.id !== o.id)
        : [...products, { id: o.id, name: o.name, points: pts() }]);
    const addShown = () => onChange([...products, ...options.filter(o => !chosen.has(o.id)).map(o => ({ id: o.id, name: o.name, points: pts() }))]);

    return (
        <div className="space-y-3">
            {/* Pick */}
            <div className="rounded-lg border border-slate-200">
                <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-2 pt-2">
                    {(["warranty", "catalogue", "manual"] as Source[]).map(s => (
                        <button key={s} type="button" onClick={() => { setTab(s); setSearch(""); }}
                            className={`px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px ${tab === s ? "border-orange-500 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                            {s === "warranty" ? `Warranty products${lists ? ` (${lists.warranty.length})` : ""}`
                                : s === "catalogue" ? `Product catalogue${lists ? ` (${brand ? lists.catalogue.filter(o => !o.group || o.group === brand).length : lists.catalogue.length})` : ""}`
                                    : "Add by hand"}
                        </button>
                    ))}
                </div>

                {tab === "manual" ? (
                    <div className="flex flex-wrap items-center gap-2 p-3 text-xs text-slate-600">
                        <Input value={manual.name} onChange={e => setManual(m => ({ ...m, name: e.target.value }))} placeholder="Product name" aria-label="Product name" className="h-9 w-[240px]" />
                        <Input type="number" min={0} step="any" value={manual.points} onChange={e => setManual(m => ({ ...m, points: e.target.value }))} placeholder="Points" aria-label="Points" className="h-9 w-24" />
                        <Button type="button" size="sm" variant="outline" disabled={!manual.name.trim() || !(Number(manual.points) > 0)}
                            onClick={() => { onChange([...products, { id: `m_${Math.random().toString(36).slice(2, 8)}`, name: manual.name.trim(), points: Number(manual.points) }]); setManual({ name: "", points: "" }); }}>
                            <Plus className="h-4 w-4 mr-1" /> Add
                        </Button>
                    </div>
                ) : (
                    <div className="p-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative flex-1 min-w-[180px]">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products" className="pl-8 h-9" />
                            </div>
                            <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                New ones get
                                <Input type="number" min={0} step="any" value={defaultPoints} onChange={e => setDefaultPoints(e.target.value)} className="h-9 w-20" aria-label="Points for products you tick" />
                                points
                            </label>
                            <Button type="button" size="sm" variant="outline" disabled={!options.some(o => !chosen.has(o.id))} onClick={addShown}>
                                Add all {search ? "shown" : ""}
                            </Button>
                        </div>
                        {tab === "catalogue" && brand && <p className="text-[11px] text-slate-400">Showing {brand} products, as this scheme is for {brand} stores.</p>}
                        <div className="max-h-52 overflow-y-auto rounded-md border border-slate-100 divide-y divide-slate-100">
                            {!lists ? (
                                <p className="flex items-center gap-2 px-3 py-3 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading products…</p>
                            ) : !options.length ? (
                                <p className="px-3 py-3 text-xs text-slate-400">No products match.</p>
                            ) : options.map(o => (
                                <label key={o.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                                    <Checkbox checked={chosen.has(o.id)} onCheckedChange={() => toggle(o)} />
                                    <span className="truncate text-slate-800">{o.name}</span>
                                    {o.group && <span className="text-[10px] uppercase tracking-wide text-slate-400 shrink-0">{o.group}</span>}
                                </label>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Chosen, with points */}
            <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-700">{products.length} product{products.length === 1 ? "" : "s"} in this scheme</p>
                    {products.length > 1 && (
                        <span className="flex items-center gap-1.5 text-xs text-slate-600">
                            Set all to
                            <Input type="number" min={0} step="any" value={allPoints} onChange={e => setAllPoints(e.target.value)} className="h-8 w-20" aria-label="Points for every product" />
                            <Button type="button" size="sm" variant="outline" disabled={!(Number(allPoints) > 0)}
                                onClick={() => onChange(products.map(p => ({ ...p, points: Number(allPoints) })))}>Apply</Button>
                        </span>
                    )}
                </div>
                {!products.length ? (
                    <p className="text-xs text-slate-400">Tick products above, or add one by hand.</p>
                ) : (
                    <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto">
                        {products.map((p, i) => (
                            <div key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                                <span className="flex-1 min-w-[160px] truncate text-slate-800" title={p.name}>{p.name}</span>
                                <span className="text-[10px] uppercase tracking-wide text-slate-400">{SOURCE_LABEL[sourceOf(p.id)]}</span>
                                <Input type="number" min={0} step="any" value={p.points} aria-label={`Points for ${p.name}`} className="h-8 w-20"
                                    onChange={e => onChange(products.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))} />
                                <span className="text-xs text-slate-500">pts each</span>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-rose-500" aria-label={`Remove ${p.name}`}
                                    onClick={() => onChange(products.filter((_, j) => j !== i))}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
