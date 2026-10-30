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
    /* The store's brand (AF, AC or AFAC), to say which distributors suit it. */
    brand?: string;
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

/**
 * Map one or many stores to a distributor from the sourcing map: pick the
 * distributor (its brand checked against the stores), then what they may buy
 * from it — everything it sells, or only the categories ticked.
 */
function MapToDistributorDialog({ stores, onClose, onDone }: { stores: FranchiseRow[]; onClose: () => void; onDone: () => void }) {
    const { toast } = useToast();
    const [dists, setDists] = useState<{ id: string; name: string; city: string | null; state: string | null; allowed_brands: string | null }[] | null>(null);
    const [find, setFind] = useState("");
    const [distId, setDistId] = useState<string | null>(null);
    const [mode, setMode] = useState<"all" | "some">("all");
    const [cats, setCats] = useState<LimitCategory[] | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        api.get("/admin/distributors").then(r => setDists(r.data.distributors ?? []))
            .catch(e => { toast({ title: "Could not load distributors", description: getErrorMessage(e, ""), variant: "destructive" }); onClose(); });
    }, []);
    useEffect(() => {
        if (!distId) return;
        setCats(null);
        api.get(`/admin/distributors/${distId}/categories`)
            .then(r => setCats((r.data.categories ?? []).map((c: any) => ({ id: c.id, name: c.name, parentName: null, brand: c.brand, productCount: c.productCount, allowed: false, path: c.path }))))
            .catch(() => setCats([]));
    }, [distId]);

    const fits = (d: { allowed_brands: string | null }, s: FranchiseRow) => {
        const db = d.allowed_brands || "AF", sb = s.brand || "AF";
        return db === "AFAC" || sb === "AFAC" || db === sb;
    };
    const needle = find.trim().toLowerCase();
    const shown = (dists ?? []).filter(d => !needle || [d.name, d.city, d.state].some(x => String(x ?? "").toLowerCase().includes(needle)));
    const chosen = dists?.find(d => d.id === distId) ?? null;
    const misfit = chosen ? stores.filter(s => !fits(chosen, s)).length : 0;
    const already = chosen ? stores.filter(s => s.distributors.some(x => x.id === chosen.id)).length : 0;
    const ticked = (cats ?? []).filter(c => c.allowed).map(c => c.id);

    const save = async () => {
        if (!chosen) return;
        if (mode === "some" && !ticked.length) return toast({ title: "Tick at least one category, or let them buy everything", variant: "destructive" });
        setBusy(true);
        try {
            const r = await api.post(`/admin/distributors/${chosen.id}/franchise-assignments`, {
                vendorIds: stores.map(s => s.franchise_user_id),
                ...(mode === "some" ? { categoryIds: ticked } : {}),
            });
            const skipped: { name: string; reason: string }[] = r.data.skipped ?? [];
            toast({
                title: r.data.added ? `${r.data.added} mapped to ${chosen.name}` : "Nothing mapped",
                description: skipped.length ? `${skipped.length} skipped: ${skipped.slice(0, 3).map(x => `${x.name} (${x.reason})`).join(", ")}${skipped.length > 3 ? "…" : ""}` : undefined,
                variant: r.data.added ? undefined : "destructive",
            });
            onDone();
        } catch (e) {
            toast({ title: "Not mapped", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setBusy(false); }
    };

    return (
        <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
            <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">
                <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
                    <DialogTitle className="text-base">Map to a distributor</DialogTitle>
                    <DialogDescription className="text-xs">
                        {stores.length === 1 ? <b>{stores[0].store_name}</b> : <><b>{stores.length} stores</b>: {stores.slice(0, 3).map(s => s.store_name).join(", ")}{stores.length > 3 ? "…" : ""}</>}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                    <section className="space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">1 · Distributor</p>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                            <Input value={find} onChange={e => setFind(e.target.value)} placeholder="Search distributor, city or state" className="h-10 pl-9" aria-label="Search distributors" />
                        </div>
                        <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                            {dists === null ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>
                                : !shown.length ? <p className="py-3 text-sm text-slate-500">No distributor found.</p>
                                : shown.map(d => {
                                    const off = stores.filter(s => !fits(d, s)).length;
                                    const on = d.id === distId;
                                    return (
                                        <button key={d.id} type="button" onClick={() => { setDistId(d.id); setMode("all"); }} aria-pressed={on}
                                            className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${on ? "border-orange-400 bg-orange-50" : "border-slate-100 hover:bg-slate-50"}`}>
                                            <Building2 className="h-4 w-4 shrink-0 text-orange-500" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-bold text-slate-800">{d.name}</span>
                                                <span className="block truncate text-[11px] text-slate-500">{[d.city, d.state].filter(Boolean).join(", ")}</span>
                                            </span>
                                            <Badge variant="secondary" className="shrink-0 border border-slate-200 bg-white text-[10px] text-slate-500">{d.allowed_brands || "AF"}</Badge>
                                            {off > 0 && <span className="shrink-0 text-[10px] font-bold text-amber-700">{off === stores.length ? "Brand doesn't fit" : `${off} brand mismatch`}</span>}
                                        </button>
                                    );
                                })}
                        </div>
                    </section>

                    {chosen && (
                        <section className="space-y-2">
                            <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">2 · What they can buy from {chosen.name}</p>
                            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                                {([["all", "Everything it sells"], ["some", "Only some categories"]] as const).map(([v, label]) => (
                                    <button key={v} type="button" onClick={() => setMode(v)} aria-pressed={mode === v}
                                        className={`min-h-[40px] rounded-lg text-sm font-bold ${mode === v ? "bg-white text-slate-900 shadow" : "text-slate-600"}`}>{label}</button>
                                ))}
                            </div>
                            {mode === "some" && (cats === null ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>
                                : !cats.length ? <p className="text-sm text-slate-500">This distributor has no categories assigned yet.</p>
                                : <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-100 p-1">
                                    <LimitBranch group={limitTree(cats)} level={0} onSet={(ids, allowed) => setCats(cs => (cs ?? []).map(c => (ids.has(c.id) ? { ...c, allowed } : c)))} />
                                </div>)}
                            {(misfit > 0 || already > 0) && (
                                <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                    <span>{[misfit ? `${misfit} store${misfit === 1 ? "" : "s"} won't be mapped (brand doesn't fit)` : null, already ? `${already} already mapped here` : null].filter(Boolean).join(" · ")}</span>
                                </p>
                            )}
                        </section>
                    )}
                </div>

                <DialogFooter className="gap-2 border-t border-slate-100 px-5 py-3">
                    <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button onClick={save} disabled={busy || !chosen || misfit + already >= stores.length} className="bg-orange-600 text-white hover:bg-orange-700">
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Map {stores.length - misfit - already > 1 ? `${stores.length - misfit - already} stores` : "store"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
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
    // Stores ticked to map (on the Unmapped tab), and the stores the map dialog is open for.
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [mapFor, setMapFor] = useState<FranchiseRow[] | null>(null);
    const togglePick = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    useEffect(() => { setPicked(new Set()); }, [filter]);

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

            {filter === "unmapped" && visible.length > 0 && (
                <label className="flex cursor-pointer items-center gap-3 px-3 text-xs font-bold text-slate-600">
                    <Checkbox
                        checked={visible.every(f => picked.has(f.franchise_user_id)) ? true : visible.some(f => picked.has(f.franchise_user_id)) ? "indeterminate" : false}
                        onCheckedChange={() => setPicked(p => {
                            const all = visible.every(f => p.has(f.franchise_user_id));
                            const n = new Set(p);
                            visible.forEach(f => (all ? n.delete(f.franchise_user_id) : n.add(f.franchise_user_id)));
                            return n;
                        })} />
                    Select all shown ({visible.length})
                </label>
            )}

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
                            <Card key={f.franchise_user_id} className={`shadow-none overflow-hidden ${picked.has(f.franchise_user_id) ? "border-orange-300" : "border-slate-100"}`}>
                                <div className="flex items-stretch">
                                {filter === "unmapped" && (
                                    <label className="flex shrink-0 cursor-pointer items-center pl-3">
                                        <Checkbox checked={picked.has(f.franchise_user_id)} onCheckedChange={() => togglePick(f.franchise_user_id)} aria-label={`Select ${f.store_name}`} />
                                    </label>
                                )}
                                <button
                                    onClick={() => setExpanded(isOpen ? null : f.franchise_user_id)}
                                    className="min-w-0 flex-1 text-left p-3 hover:bg-orange-50/40 transition-colors"
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
                                <div className="flex shrink-0 items-center pr-3">
                                    <Button variant="outline" size="sm" onClick={() => setMapFor([f])} className="h-8 border-slate-200 text-[11px]" aria-label={`Map ${f.store_name} to a distributor`}>
                                        <Building2 className="mr-1 h-3 w-3" /> + Distributor
                                    </Button>
                                </div>
                                </div>

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

            {picked.size > 0 && (
                <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-xl">
                    <span className="text-sm font-bold">{picked.size} store{picked.size === 1 ? "" : "s"} selected</span>
                    <div className="flex gap-2">
                        <Button variant="ghost" className="h-10 text-white hover:bg-white/10 hover:text-white" onClick={() => setPicked(new Set())}>Clear</Button>
                        <Button className="h-10 bg-orange-500 font-bold text-white hover:bg-orange-600" onClick={() => setMapFor(rows.filter(r => picked.has(r.franchise_user_id)))}>
                            <Building2 className="mr-1.5 h-4 w-4" /> Map to a distributor
                        </Button>
                    </div>
                </div>
            )}
            {mapFor && <MapToDistributorDialog stores={mapFor} onClose={() => setMapFor(null)} onDone={() => { setMapFor(null); setPicked(new Set()); fetchMap(); }} />}

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
