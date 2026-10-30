import { useState, useEffect, useMemo } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { downloadCSV } from "@/lib/utils";
import {
    Search, Loader2, Store, Building2, RefreshCw, Download, X,
    ChevronRight, Layers, AlertTriangle, SlidersHorizontal
} from "lucide-react";

interface MappedDistributor {
    id: string;
    name: string;
    city: string | null;
    brands: string | null;
    categories: string[];
    hasLimit: boolean;
}

interface LimitCategory {
    id: string;
    name: string;
    parentName: string | null;
    brand: "AF" | "AC";
    productCount: number;
    allowed: boolean;
    /* Its ancestors from the top, e.g. Mats for PU/PVC. */
    path?: { id: string; name: string }[];
}

/** A category above the ones a distributor sells ("Mats"), with what sits under it. */
interface LimitGroup { id: string; name: string; groups: LimitGroup[]; items: LimitCategory[] }

/** The distributor's categories as a tree, by their paths; ones without a path sit at the top. */
function limitTree(cats: LimitCategory[]): LimitGroup {
    const root: LimitGroup = { id: "", name: "", groups: [], items: [] };
    for (const cat of cats) {
        let at = root;
        for (const step of cat.path ?? []) {
            let next = at.groups.find(g => g.id === step.id);
            if (!next) { next = { id: step.id, name: step.name, groups: [], items: [] }; at.groups.push(next); }
            at = next;
        }
        at.items.push(cat);
    }
    const sort = (g: LimitGroup) => { g.groups.sort((a, b) => a.name.localeCompare(b.name)); g.items.sort((a, b) => a.name.localeCompare(b.name)); g.groups.forEach(sort); };
    sort(root);
    return root;
}
const leavesIn = (g: LimitGroup): LimitCategory[] => [...g.items, ...g.groups.flatMap(leavesIn)];

interface FranchiseRow {
    franchise_user_id: string;
    franchise_id: string;
    store_name: string;
    store_code: string | null;
    city: string | null;
    state: string | null;
    is_distributor: boolean;
    distributors: MappedDistributor[];
}

type Filter = "all" | "multi" | "mapped" | "unmapped";

/** One level of the limit tree: its sub-groups (each with a tick for all under it), then its categories. */
function LimitBranch({ group, level, onSet }: { group: LimitGroup; level: number; onSet: (ids: Set<string>, allowed: boolean) => void }) {
    const brandTag = (brand: "AF" | "AC") => (
        // AF and AC trees reuse the same names — show the brand so identical-looking rows are distinguishable.
        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${brand === "AC" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>{brand}</span>
    );
    return (
        <>
            {group.groups.map(g => {
                const leaves = leavesIn(g);
                const on = leaves.filter(c => c.allowed).length;
                return (
                    <div key={g.id} className="space-y-1">
                        <label className="flex cursor-pointer items-center gap-3 rounded-xl p-2 hover:bg-slate-50" style={{ paddingLeft: `${8 + level * 20}px` }}>
                            <Checkbox checked={on === leaves.length ? true : on > 0 ? "indeterminate" : false}
                                onCheckedChange={() => onSet(new Set(leaves.map(c => c.id)), on < leaves.length)} />
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                                <span className="truncate text-sm font-bold text-slate-800">{g.name}</span>
                                {level === 0 && leaves[0] && brandTag(leaves[0].brand)}
                            </span>
                            <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{on} of {leaves.length}</span>
                        </label>
                        <LimitBranch group={g} level={level + 1} onSet={onSet} />
                    </div>
                );
            })}
            {group.items.map(cat => (
                <label
                    key={cat.id}
                    style={{ marginLeft: `${level * 20}px` }}
                    className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                        cat.allowed ? "border-orange-200 bg-orange-50/50" : "border-slate-100 hover:bg-slate-50"
                    }`}
                >
                    <Checkbox checked={cat.allowed} onCheckedChange={v => onSet(new Set([cat.id]), Boolean(v))} />
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="text-sm font-semibold text-slate-700 truncate">{cat.name}</span>
                        {level === 0 && brandTag(cat.brand)}
                    </span>
                    <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                        {cat.productCount} product{cat.productCount === 1 ? "" : "s"}
                    </span>
                </label>
            ))}
        </>
    );
}

export const AdminFranchiseDistributorMap = () => {
    const { toast } = useToast();
    const [rows, setRows] = useState<FranchiseRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<Filter>("all");
    const [expanded, setExpanded] = useState<string | null>(null);

    // Per-mapping category limit editor
    const [editTarget, setEditTarget] = useState<{ franchise: FranchiseRow; distributor: MappedDistributor } | null>(null);
    const [limitCats, setLimitCats] = useState<LimitCategory[]>([]);
    const [limitLoading, setLimitLoading] = useState(false);
    const [limitSaving, setLimitSaving] = useState(false);

    const openLimitEditor = async (franchise: FranchiseRow, distributor: MappedDistributor) => {
        setEditTarget({ franchise, distributor });
        setLimitLoading(true);
        setLimitCats([]);
        try {
            const res = await api.get(
                `/admin/franchises/${franchise.franchise_user_id}/distributors/${distributor.id}/categories`
            );
            setLimitCats(res.data.categories || []);
        } catch (error: any) {
            toast({
                title: "Could not load categories",
                description: getErrorMessage(error, "Failed to load category list"),
                variant: "destructive"
            });
            setEditTarget(null);
        } finally {
            setLimitLoading(false);
        }
    };

    const saveLimits = async () => {
        if (!editTarget) return;
        setLimitSaving(true);
        const selected = limitCats.filter(c => c.allowed).map(c => c.id);
        // Everything ticked is the same as no restriction — store it as "inherit"
        // so the mapping keeps following the distributor as their range changes.
        const inherit = selected.length === limitCats.length;
        try {
            const res = await api.put(
                `/admin/franchises/${editTarget.franchise.franchise_user_id}/distributors/${editTarget.distributor.id}/categories`,
                inherit ? { inherit: true } : { categoryIds: selected }
            );
            toast({ title: "Saved", description: res.data.message });
            setEditTarget(null);
            fetchMap();
        } catch (error: any) {
            toast({
                title: "Could not save",
                description: getErrorMessage(error, "Failed to save category limits"),
                variant: "destructive"
            });
        } finally {
            setLimitSaving(false);
        }
    };

    const fetchMap = async (showToast = false) => {
        setRefreshing(true);
        try {
            const res = await api.get("/admin/franchises/distributor-map");
            setRows(res.data.franchises || []);
            if (showToast) toast({ title: "Refreshed", description: `${res.data.summary?.total ?? 0} franchises loaded.` });
        } catch (error: any) {
            toast({
                title: "Could not load mapping",
                description: getErrorMessage(error, "Failed to load franchise-distributor map"),
                variant: "destructive"
            });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => { fetchMap(); }, []);

    const counts = useMemo(() => ({
        all: rows.length,
        mapped: rows.filter(r => r.distributors.length > 0).length,
        multi: rows.filter(r => r.distributors.length > 1).length,
        unmapped: rows.filter(r => r.distributors.length === 0).length,
    }), [rows]);

    const visible = useMemo(() => {
        let list = rows;
        if (filter === "multi")    list = list.filter(r => r.distributors.length > 1);
        if (filter === "mapped")   list = list.filter(r => r.distributors.length > 0);
        if (filter === "unmapped") list = list.filter(r => r.distributors.length === 0);

        const q = search.trim().toLowerCase();
        if (q) {
            list = list.filter(r =>
                (r.store_name || "").toLowerCase().includes(q) ||
                (r.store_code || "").toLowerCase().includes(q) ||
                (r.city || "").toLowerCase().includes(q) ||
                r.distributors.some(d => (d.name || "").toLowerCase().includes(q))
            );
        }
        return list;
    }, [rows, filter, search]);

    const handleExport = () => {
        // One row per franchise-distributor pair so the sheet is pivot-friendly.
        const flat = rows.flatMap(r =>
            r.distributors.length === 0
                ? [{
                    Franchise: r.store_name, "Store Code": r.store_code || "", City: r.city || "",
                    Distributor: "(none)", "Distributor City": "", Brands: "", Scope: "", Categories: ""
                }]
                : r.distributors.map(d => ({
                    Franchise: r.store_name, "Store Code": r.store_code || "", City: r.city || "",
                    Distributor: d.name, "Distributor City": d.city || "",
                    Brands: d.brands || "", Scope: d.hasLimit ? "Limited" : "All categories",
                    Categories: d.categories.join("; ")
                }))
        );
        downloadCSV(flat, `franchise-distributor-map-${new Date().toISOString().slice(0, 10)}.csv`);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
            </div>
        );
    }

    const tabs: { k: Filter; label: string; tone: string; bar: string }[] = [
        { k: "all",      label: "All",              tone: "text-slate-700",  bar: "bg-slate-700" },
        { k: "mapped",   label: "Mapped",           tone: "text-emerald-600", bar: "bg-emerald-500" },
        { k: "multi",    label: "Multi-Distributor", tone: "text-orange-600", bar: "bg-orange-500" },
        { k: "unmapped", label: "Unmapped",         tone: "text-rose-600",   bar: "bg-rose-500" },
    ];

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 shrink-0 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-500">
                        <Layers className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-[15px] font-bold leading-tight">Franchise → Distributor Map</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Which distributors each franchise buys from, and the categories available from each.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                    <div className="relative w-full sm:w-[260px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                        <Input
                            placeholder="Search franchise or distributor..."
                            className="pl-9 pr-8 h-9 text-sm bg-slate-50 border-slate-200 focus-visible:bg-white"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {search && (
                            <button
                                onClick={() => setSearch("")}
                                aria-label="Clear search"
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    <Button variant="outline" size="icon" onClick={() => fetchMap(true)} disabled={refreshing}
                        title="Refresh" aria-label="Refresh" className="h-9 w-9 shrink-0 border-slate-200">
                        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    </Button>
                    <Button variant="outline" size="icon" onClick={handleExport}
                        title="Export CSV" aria-label="Export CSV" className="h-9 w-9 shrink-0 border-slate-200">
                        <Download className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            {/* Filter rail */}
            <div className="flex items-center gap-1 border-b border-slate-100 overflow-x-auto no-scrollbar">
                {tabs.map(t => {
                    const active = filter === t.k;
                    return (
                        <button
                            key={t.k}
                            onClick={() => setFilter(t.k)}
                            className={`relative shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                                active ? t.tone : "text-slate-400 hover:text-slate-600"
                            }`}
                        >
                            {t.label}
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
                                active ? "bg-slate-100 text-slate-600" : "bg-slate-100 text-slate-400"
                            }`}>
                                {counts[t.k]}
                            </span>
                            {active && <span className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${t.bar}`} />}
                        </button>
                    );
                })}
            </div>

            {/* Rows */}
            {visible.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                    <Store className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-bold">No franchises found</p>
                    <p className="text-xs mt-1">Try a different filter or search.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {visible.map(f => {
                        const isOpen = expanded === f.franchise_user_id;
                        const count = f.distributors.length;
                        return (
                            <Card key={f.franchise_user_id} className="border-slate-100 shadow-none overflow-hidden">
                                <button
                                    onClick={() => setExpanded(isOpen ? null : f.franchise_user_id)}
                                    className="w-full text-left p-3 hover:bg-orange-50/40 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <ChevronRight className={`h-4 w-4 shrink-0 text-slate-300 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="font-bold text-sm text-slate-800 truncate">{f.store_name}</p>
                                                {f.store_code && (
                                                    <span className="text-[10px] font-mono text-slate-400">{f.store_code}</span>
                                                )}
                                                {f.is_distributor && (
                                                    <Badge variant="secondary" className="bg-violet-50 text-violet-600 border-none text-[10px]">
                                                        Also a distributor
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-slate-400 mt-0.5">
                                                {[f.city, f.state].filter(Boolean).join(", ") || "—"}
                                            </p>
                                        </div>

                                        <div className="shrink-0">
                                            {count === 0 ? (
                                                <Badge className="bg-rose-50 text-rose-600 border-rose-200 gap-1">
                                                    <AlertTriangle className="h-3 w-3" /> Unmapped
                                                </Badge>
                                            ) : (
                                                <Badge className={count > 1
                                                    ? "bg-orange-100 text-orange-700 border-orange-200"
                                                    : "bg-slate-100 text-slate-600 border-slate-200"}>
                                                    {count} distributor{count > 1 ? "s" : ""}
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                </button>

                                {isOpen && count > 0 && (
                                    <CardContent className="pt-0 pb-3 px-3 space-y-2">
                                        {f.distributors.map(d => (
                                            <div key={d.id} className="ml-7 p-3 rounded-xl border border-slate-100 bg-slate-50/60">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Building2 className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                                                    <p className="font-bold text-sm text-slate-700">{d.name}</p>
                                                    {d.city && <span className="text-[11px] text-slate-400">{d.city}</span>}
                                                    {d.brands && (
                                                        <Badge variant="secondary" className="bg-white text-slate-500 border border-slate-200 text-[10px]">
                                                            {d.brands}
                                                        </Badge>
                                                    )}
                                                    {d.hasLimit ? (
                                                        <Badge className={d.categories.length === 0
                                                            ? "bg-amber-100 text-amber-700 border-amber-200 text-[10px]"
                                                            : "bg-orange-100 text-orange-700 border-orange-200 text-[10px]"}>
                                                            {d.categories.length === 0 ? "None approved" : "Limited"}
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary" className="bg-slate-100 text-slate-500 border-none text-[10px]">
                                                            All categories
                                                        </Badge>
                                                    )}
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => openLimitEditor(f, d)}
                                                        className="h-7 ml-auto text-[11px] border-slate-200"
                                                    >
                                                        <SlidersHorizontal className="h-3 w-3 mr-1.5" /> Set limit
                                                    </Button>
                                                </div>
                                                <div className="mt-2">
                                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                                                        Can buy
                                                    </p>
                                                    {d.categories.length === 0 ? (
                                                        <p className="text-[11px] italic text-amber-600">
                                                            {d.hasLimit
                                                                ? "No categories approved yet — this store cannot order from here."
                                                                : "This distributor has no categories assigned, so nothing is purchasable."}
                                                        </p>
                                                    ) : (
                                                        <div className="flex flex-wrap gap-1">
                                                            {d.categories.map(cat => (
                                                                <span key={cat} className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                                                                    {cat}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}

                                        {/* Overlapping categories across distributors mean the same product
                                            appears twice for this store — worth flagging, now fixable. */}
                                        {count > 1 && (() => {
                                            const seen = new Map<string, number>();
                                            f.distributors.forEach(d => d.categories.forEach(cat =>
                                                seen.set(cat, (seen.get(cat) || 0) + 1)));
                                            const overlap = [...seen.entries()].filter(([, n]) => n > 1).map(([cat]) => cat);
                                            if (overlap.length === 0) return null;
                                            return (
                                                <p className="ml-7 text-[11px] text-amber-600 flex items-start gap-1.5">
                                                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                                                    <span>
                                                        <b>{overlap.join(", ")}</b> {overlap.length > 1 ? "are" : "is"} available from more than
                                                        one distributor, so this store sees the same products twice.
                                                        Use <b>Set limit</b> to decide who supplies what.
                                                    </span>
                                                </p>
                                            );
                                        })()}
                                    </CardContent>
                                )}
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Per-mapping category limit editor */}
            <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null); }}>
                <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                        <DialogTitle className="text-base">What can this store buy here?</DialogTitle>
                        <DialogDescription className="text-xs">
                            {editTarget && (
                                <>
                                    <b>{editTarget.franchise.store_name}</b> buying from <b>{editTarget.distributor.name}</b>.
                                    Tick only the categories they may purchase. This does not change what the
                                    distributor sells to anyone else.
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    {limitLoading ? (
                        <div className="flex items-center justify-center py-10">
                            <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                        </div>
                    ) : limitCats.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">
                            This distributor has no categories assigned, so there is nothing to limit.
                        </p>
                    ) : (
                        <>
                            <div className="flex items-center justify-between px-1">
                                <p className="text-[11px] font-bold text-slate-500">
                                    {limitCats.filter(c => c.allowed).length} of {limitCats.length} selected
                                </p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setLimitCats(cs => cs.map(c => ({ ...c, allowed: true })))}
                                        className="text-[11px] font-bold text-orange-600 hover:underline"
                                    >
                                        Select all
                                    </button>
                                    <span className="text-slate-300">·</span>
                                    <button
                                        onClick={() => setLimitCats(cs => cs.map(c => ({ ...c, allowed: false })))}
                                        className="text-[11px] font-bold text-slate-500 hover:underline"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>

                            {/* As a tree: a parent (Mats) ticks or clears everything under it,
                                and each category under it (PU/PVC, TPE) can be ticked on its own. */}
                            <div className="max-h-[420px] overflow-y-auto space-y-1 pr-1">
                                <LimitBranch group={limitTree(limitCats)} level={0}
                                    onSet={(ids, allowed) => setLimitCats(cs => cs.map(c => (ids.has(c.id) ? { ...c, allowed } : c)))} />
                            </div>

                            {limitCats.every(c => c.allowed) && (
                                <p className="text-[11px] text-slate-500 px-1">
                                    All ticked — saved as “no limit”, so this store automatically gets any new
                                    category the distributor adds later.
                                </p>
                            )}
                            {limitCats.every(c => !c.allowed) && (
                                <p className="text-[11px] text-amber-600 px-1 flex items-start gap-1.5">
                                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                                    <span>
                                        Nothing ticked — the mapping stays, but this store won't be able to order
                                        anything from this distributor until you approve a category.
                                    </span>
                                </p>
                            )}
                        </>
                    )}

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
                        <Button
                            onClick={saveLimits}
                            disabled={limitSaving || limitLoading || limitCats.length === 0}
                            className="bg-orange-600 hover:bg-orange-700 text-white"
                        >
                            {limitSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
