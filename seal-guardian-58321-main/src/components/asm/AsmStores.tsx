import { useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowDownUp, ChevronRight, Filter, Loader2, MapPin, Search, ShieldCheck, Store, X } from "lucide-react";
import { AsmStoreDetail } from "./AsmStoreDetail";
import { StorePulse } from "./StorePulse";
import {
    type AsmStoreSummary, QUIET_DAYS, daysSinceWarranty, displayName, isLive, monthName, statusNote, storeAvatar, storeInitials,
} from "@/lib/asmStores";

/**
 * The franchises and distributors this ASM looks after, read-only; head office
 * assigns them. The roster by city, each store with its last twelve weeks of
 * warranties so a slowing store shows without opening it. It describes the
 * stores; it does not tell the ASM whom to call (owner's call, 9 Oct 2026) —
 * so the filters are plain facts about a store, never a to-do list.
 *
 * The toolbar is the franchise Warranties screen's: search, status tabs (a
 * dropdown on phones), and a Filter button that opens Advanced Filters.
 * Everything filters in the browser; the list already carries every field.
 */

type Status = "all" | "live" | "inactive" | "pending";
type Kind = "all" | "franchise" | "distributor";
type Activity = "all" | "complaints" | "posm" | "quiet";
type Sort = "city" | "most" | "fewest" | "quiet" | "name";

const SORTS: { id: Sort; label: string }[] = [
    { id: "city", label: "Group by city" },
    { id: "most", label: "Most warranties this month" },
    { id: "fewest", label: "Fewest warranties this month" },
    { id: "quiet", label: "Longest since a warranty" },
    { id: "name", label: "Name A–Z" },
];

const statusOf = (s: AsmStoreSummary): Exclude<Status, "all"> => !s.is_verified ? "pending" : !s.is_active ? "inactive" : "live";
const ACTIVITY_TEST: Record<Exclude<Activity, "all">, (s: AsmStoreSummary) => boolean> = {
    complaints: s => s.grievances_open > 0,
    posm: s => s.posm_open > 0,
    quiet: s => isLive(s) && (daysSinceWarranty(s) ?? Infinity) >= QUIET_DAYS,
};

// The franchise Warranties screen's filter controls.
const TRIGGER = "w-full h-10 md:h-11 bg-white border-orange-100 rounded-xl md:rounded-2xl text-[10px] md:text-xs font-bold shadow-sm hover:border-orange-200 transition-colors focus:ring-orange-500/20";
const CONTENT = "rounded-xl md:rounded-2xl border-orange-100 shadow-2xl p-1";
const ITEM = "rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold py-2 md:py-2.5";

const Initials = ({ s, className }: { s: AsmStoreSummary; className?: string }) => (
    <span className={cn(
        "shrink-0 rounded-xl text-white font-bold flex items-center justify-center",
        isLive(s) ? storeAvatar(s.vendor_details_id) : "bg-slate-300",
        className
    )}>
        {storeInitials(s.store_name)}
    </span>
);

const StoreRow = ({ s, onOpen, showCity }: { s: AsmStoreSummary; onOpen: () => void; showCity?: boolean }) => {
    const note = statusNote(s);
    return (
        <li>
            <button
                onClick={onOpen}
                className="w-full text-left flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-orange-50/40 active:bg-orange-50/60 transition-colors focus-visible:outline-none focus-visible:bg-orange-50"
            >
                <Initials s={s} className="h-10 w-10 text-sm" />
                <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-bold truncate flex items-center gap-1.5", isLive(s) ? "text-slate-800" : "text-slate-400")}>
                        <span className="truncate">{displayName(s.store_name)}</span>
                        {s.grievances_open > 0 && <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" title="Open complaint" />}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                        <p className="text-xs text-slate-400 truncate">
                            {[showCity ? s.city?.trim() : null, s.is_distributor ? "Distributor" : null, note, s.store_code].filter(Boolean).join(" · ")}
                        </p>
                        {/* Phones: the pulse rides under the name so the name keeps the width */}
                        <StorePulse weekly={s.weekly} muted={!isLive(s)} className="sm:hidden !h-4 w-16 shrink-0 ml-auto" />
                    </div>
                </div>
                <StorePulse weekly={s.weekly} muted={!isLive(s)} className="hidden sm:flex w-28 lg:w-40 shrink-0" />
                <div className="w-12 sm:w-14 text-right shrink-0">
                    <p className={cn("text-lg font-black tabular-nums leading-none", isLive(s) ? "text-slate-900" : "text-slate-400")}>
                        {s.warranties_this_month.toLocaleString("en-IN")}
                    </p>
                    <p className="text-[10px] font-bold uppercase text-slate-400 mt-1">{monthName(0, "short")}</p>
                </div>
            </button>
        </li>
    );
};

export const AsmStores = () => {
    const [stores, setStores] = useState<AsmStoreSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [openId, setOpenId] = useState<string | null>(null);

    const [search, setSearch] = useState("");
    const [status, setStatus] = useState<Status>("all");
    const [showFilters, setShowFilters] = useState(false);
    const [kind, setKind] = useState<Kind>("all");
    const [activity, setActivity] = useState<Activity>("all");
    const [state, setState] = useState("all");
    const [city, setCity] = useState("all");
    const [sort, setSort] = useState<Sort>("city");

    useEffect(() => {
        api.get("/asm-portal/stores")
            .then(res => setStores(res.data.stores || []))
            .catch(e => setError(getErrorMessage(e, "Could not load your stores")))
            .finally(() => setLoading(false));
    }, []);

    const states = useMemo(() => [...new Set(stores.map(s => s.state?.trim()).filter(Boolean) as string[])].sort(), [stores]);
    // Cities follow the state picked, so the list never offers one that would show nothing.
    const cityOptions = useMemo(() => [...new Set(stores
        .filter(s => state === "all" || s.state?.trim() === state)
        .map(s => s.city?.trim()).filter(Boolean) as string[])].sort(), [stores, state]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return stores.filter(s =>
            (!q || [s.store_name, s.store_code, s.city, s.state, s.contact_name, s.phone_number].some(v => (v || "").toLowerCase().includes(q)))
            && (status === "all" || statusOf(s) === status)
            && (kind === "all" || (kind === "distributor" ? s.is_distributor : !s.is_distributor))
            && (activity === "all" || ACTIVITY_TEST[activity](s))
            && (state === "all" || s.state?.trim() === state)
            && (city === "all" || s.city?.trim() === city)
        );
    }, [stores, search, status, kind, activity, state, city]);

    // By city: groups biggest first, live stores by this month's warranties, then the rest.
    const cities = useMemo(() => {
        const groups = new Map<string, AsmStoreSummary[]>();
        for (const s of filtered) {
            const c = s.city?.trim() || "No city";
            groups.set(c, [...(groups.get(c) || []), s]);
        }
        return [...groups.entries()]
            .map(([c, list]) => ({
                city: c,
                list: list.sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.warranties_this_month - a.warranties_this_month),
            }))
            .sort((a, b) => b.list.length - a.list.length || a.city.localeCompare(b.city));
    }, [filtered]);

    const sorted = useMemo(() => {
        const since = (s: AsmStoreSummary) => daysSinceWarranty(s) ?? Infinity;
        const by: Record<Exclude<Sort, "city">, (a: AsmStoreSummary, b: AsmStoreSummary) => number> = {
            most: (a, b) => b.warranties_this_month - a.warranties_this_month,
            fewest: (a, b) => a.warranties_this_month - b.warranties_this_month,
            quiet: (a, b) => since(b) - since(a),
            name: (a, b) => displayName(a.store_name).localeCompare(displayName(b.store_name)),
        };
        return sort === "city" ? [] : [...filtered].sort(by[sort]);
    }, [filtered, sort]);

    // What the Filter button's dot counts: everything in Advanced Filters.
    const panelFilters = (kind !== "all" ? 1 : 0) + (activity !== "all" ? 1 : 0) + (state !== "all" ? 1 : 0)
        + (city !== "all" ? 1 : 0) + (sort !== "city" ? 1 : 0);
    const narrowed = filtered.length !== stores.length;
    const clear = () => {
        setSearch(""); setStatus("all"); setKind("all"); setActivity("all"); setState("all"); setCity("all"); setSort("city");
    };

    const open = (id: string | null) => {
        setOpenId(id);
        document.getElementById("main-dashboard-content-area")?.scrollTo({ top: 0 });
    };

    // The list stays mounted behind a store page, so filters survive Back.
    if (openId) return <AsmStoreDetail storeId={openId} onBack={() => open(null)} />;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                <span className="text-sm">Loading your stores…</span>
            </div>
        );
    }

    if (error) {
        return <div className="rounded-[28px] border border-rose-100 bg-rose-50 p-6 text-center text-sm text-rose-700">{error}</div>;
    }

    if (stores.length === 0) {
        return (
            <div className="rounded-[32px] border border-dashed border-orange-200 bg-white/40 p-12 text-center">
                <div className="h-16 w-16 bg-orange-50 rounded-3xl flex items-center justify-center mx-auto mb-5 border border-orange-100">
                    <Store className="h-7 w-7 text-orange-500" />
                </div>
                <h3 className="text-lg font-black tracking-tight text-slate-800 uppercase mb-2">No stores under you yet</h3>
                <p className="text-sm text-slate-500 max-w-sm mx-auto">Head office assigns franchises and distributors to you. They will show up here with their numbers.</p>
            </div>
        );
    }

    const count = (test: (s: AsmStoreSummary) => boolean) => stores.filter(test).length;
    const monthTotal = stores.reduce((n, s) => n + s.warranties_this_month, 0);
    const cityCount = new Set(stores.map(s => s.city?.trim() || "")).size;

    const STATUSES: { id: Status; label: string; count: number; badge: string; text: string; hint: string }[] = [
        { id: "all", label: "All", count: stores.length, badge: "bg-orange-100 text-orange-700", text: "text-orange-600", hint: "Every store head office has put under you" },
        { id: "live", label: "Live", count: count(s => statusOf(s) === "live"), badge: "bg-green-100 text-green-700", text: "text-green-600", hint: "Approved and active stores" },
        { id: "inactive", label: "Inactive", count: count(s => statusOf(s) === "inactive"), badge: "bg-slate-100 text-slate-600", text: "text-slate-600", hint: "Stores head office has switched off" },
        { id: "pending", label: "Not approved", count: count(s => statusOf(s) === "pending"), badge: "bg-amber-100 text-amber-700", text: "text-amber-600", hint: "Registered, not yet approved by head office" },
    ];
    const current = STATUSES.find(x => x.id === status)!;

    const searchBox = (className: string) => (
        <div className={cn("relative group", className)}>
            <Search className="absolute left-3 lg:left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
            <input
                type="text"
                placeholder="Search store, city, code or owner..."
                className="w-full h-10 lg:h-11 pl-10 lg:pl-11 pr-9 rounded-xl lg:rounded-2xl border border-slate-100 bg-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/20 focus-visible:border-orange-500/30 text-sm transition-all shadow-sm"
                value={search}
                onChange={e => setSearch(e.target.value)}
            />
            {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Clear search">
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
    );

    const filterButton = (className: string) => (
        <Button
            variant="outline"
            onClick={() => setShowFilters(f => !f)}
            className={cn(className, "p-0 border-orange-100 shadow-sm shrink-0 flex items-center justify-center transition-all",
                showFilters ? "bg-orange-500 text-white border-orange-500 shadow-orange-500/20 hover:bg-orange-600 hover:text-white"
                    : "bg-white text-slate-700 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200")}
            title="Filters"
        >
            <div className="relative">
                <Filter className="h-4 w-4" />
                {panelFilters > 0 && <span className="absolute -top-1.5 -right-1.5 h-2.5 w-2.5 rounded-full bg-red-500 border border-white" />}
            </div>
        </Button>
    );

    return (
        <div className="space-y-6">
            {/* The territory at a glance */}
            <div className="grid grid-cols-3 gap-3 md:gap-4">
                {[
                    { label: "Stores", value: stores.length, icon: Store, tone: "bg-orange-50 text-orange-600" },
                    { label: "Cities", value: cityCount, icon: MapPin, tone: "bg-blue-50 text-blue-600" },
                    { label: `Warranties · ${monthName(0, "short")}`, value: monthTotal, icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-600" },
                ].map(c => (
                    <div key={c.label} className="rounded-3xl border border-orange-100 bg-white p-3 md:p-5 shadow-sm">
                        <span className={cn("h-8 w-8 md:h-10 md:w-10 rounded-xl flex items-center justify-center", c.tone)}>
                            <c.icon className="h-4 w-4 md:h-5 md:w-5" />
                        </span>
                        <p className="text-xl md:text-3xl font-black text-slate-900 tabular-nums mt-3 leading-none">{c.value.toLocaleString("en-IN")}</p>
                        <p className="text-[10px] md:text-xs font-bold text-slate-500 mt-1.5 truncate">{c.label}</p>
                    </div>
                ))}
            </div>

            <div>
                {/* ===== MOBILE (lg:hidden): search + filter, then status ===== */}
                <div className="lg:hidden space-y-3 mb-4">
                    <div className="flex items-center gap-2">
                        {searchBox("flex-1")}
                        {filterButton("h-10 w-10 rounded-xl")}
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full h-10 rounded-xl border-orange-100 bg-white font-bold flex items-center justify-between px-4 shadow-sm">
                                <div className="flex items-center gap-2">
                                    <div className="w-1 h-5 bg-orange-500 rounded-full" />
                                    <span className="text-[10px] uppercase tracking-wider font-black text-slate-400">Status:</span>
                                    <span className="text-xs font-black text-orange-600 uppercase">{current.label}</span>
                                </div>
                                <ChevronRight className="h-4 w-4 text-orange-500 rotate-90" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[calc(100vw-2.5rem)] p-3 rounded-3xl border-orange-100 shadow-2xl bg-white mt-2 z-[100]" align="center">
                            {STATUSES.map(st => (
                                <DropdownMenuItem key={st.id} onClick={() => setStatus(st.id)} className="flex flex-col items-start p-3 rounded-2xl cursor-pointer">
                                    <div className="flex items-center justify-between w-full">
                                        <span className={cn("text-xs font-black uppercase", status === st.id ? st.text : "text-slate-500")}>{st.label}</span>
                                        <span className={cn("font-black px-3 py-0.5 rounded-full text-[10px] tabular-nums", st.badge)}>{st.count}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-medium mt-1">{st.hint}</span>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {/* ===== DESKTOP (lg+): search, then status tabs + filter ===== */}
                <div className="hidden lg:flex items-center mb-4">{searchBox("w-96")}</div>
                <div className="hidden lg:flex gap-6 items-center justify-between mb-6 py-5 px-4 rounded-3xl border border-orange-100 shadow-sm">
                    <div className="bg-white/50 p-1 rounded-full h-11 flex flex-row gap-1 shadow-sm border border-orange-100/50 backdrop-blur-sm">
                        {STATUSES.map(st => (
                            <button
                                key={st.id}
                                onClick={() => setStatus(st.id)}
                                className={cn(
                                    "rounded-full px-5 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all duration-300 border",
                                    status === st.id ? cn("bg-white shadow-md border-orange-100", st.text) : "text-slate-500 border-transparent hover:text-orange-600"
                                )}
                            >
                                {st.label}
                                <span className={cn("py-0.5 px-2 rounded-full text-[10px] font-black", st.badge)}>{st.count}</span>
                            </button>
                        ))}
                    </div>
                    {filterButton("h-11 w-11 rounded-full")}
                </div>

                {/* What this status shows */}
                <div className="px-1 mb-4">
                    <p className="text-xs text-slate-500 font-medium flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-orange-400" />
                        {current.hint}
                        {narrowed && <span className="ml-auto tabular-nums">Showing <span className="font-black text-slate-800">{filtered.length}</span> of {stores.length}</span>}
                    </p>
                </div>

                {/* Advanced filters & sort */}
                {showFilters && (
                    <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-center p-4 md:p-6 bg-slate-50/50 rounded-2xl md:rounded-[32px] border border-orange-100/50 animate-in slide-in-from-top-4 fade-in duration-500 mb-6 shadow-inner">
                        <div className="flex items-center gap-2 mr-2 w-full md:w-auto">
                            <div className="w-1 h-5 md:w-1.5 md:h-6 bg-orange-500 rounded-full" />
                            <span className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest">Advanced Filters</span>
                        </div>

                        <div className="w-full sm:w-[170px]">
                            <Select value={kind} onValueChange={v => setKind(v as Kind)}>
                                <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
                                <SelectContent className={CONTENT}>
                                    <SelectItem value="all" className={ITEM}>All store types</SelectItem>
                                    <SelectItem value="franchise" className={ITEM}>Franchises ({count(x => !x.is_distributor)})</SelectItem>
                                    <SelectItem value="distributor" className={ITEM}>Distributors ({count(x => x.is_distributor)})</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="w-full sm:w-[210px]">
                            <Select value={activity} onValueChange={v => setActivity(v as Activity)}>
                                <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
                                <SelectContent className={CONTENT}>
                                    <SelectItem value="all" className={ITEM}>Any activity</SelectItem>
                                    <SelectItem value="complaints" className={ITEM}>Open complaints ({count(ACTIVITY_TEST.complaints)})</SelectItem>
                                    <SelectItem value="posm" className={ITEM}>POSM open ({count(ACTIVITY_TEST.posm)})</SelectItem>
                                    <SelectItem value="quiet" className={ITEM}>No warranty {QUIET_DAYS}+ days ({count(ACTIVITY_TEST.quiet)})</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {states.length > 1 && (
                            <div className="w-full sm:w-[170px]">
                                <Select value={state} onValueChange={v => { setState(v); setCity("all"); }}>
                                    <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
                                    <SelectContent className={CONTENT}>
                                        <SelectItem value="all" className={ITEM}>All states</SelectItem>
                                        {states.map(x => <SelectItem key={x} value={x} className={ITEM}>{x}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {cityOptions.length > 1 && (
                            <div className="w-full sm:w-[170px]">
                                <Select value={city} onValueChange={setCity}>
                                    <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
                                    <SelectContent className={CONTENT}>
                                        <SelectItem value="all" className={ITEM}>All cities</SelectItem>
                                        {cityOptions.map(x => <SelectItem key={x} value={x} className={ITEM}>{x}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="w-full sm:w-[220px]">
                            <Select value={sort} onValueChange={v => setSort(v as Sort)}>
                                <SelectTrigger className={TRIGGER}>
                                    <span className="flex items-center gap-2 truncate"><ArrowDownUp className="h-3.5 w-3.5 text-orange-500 shrink-0" /><SelectValue /></span>
                                </SelectTrigger>
                                <SelectContent className={CONTENT}>
                                    {SORTS.map(x => <SelectItem key={x.id} value={x.id} className={ITEM}>{x.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>

                        {panelFilters > 0 && (
                            <Button variant="ghost" onClick={() => { setKind("all"); setActivity("all"); setState("all"); setCity("all"); setSort("city"); }}
                                className="h-10 md:h-11 px-4 rounded-xl md:rounded-2xl text-[10px] md:text-xs font-black uppercase tracking-wider text-orange-600 hover:bg-orange-50 w-full sm:w-auto">
                                <X className="h-3.5 w-3.5 mr-1.5" /> Reset
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {filtered.length === 0 ? (
                <div className="rounded-[32px] border border-dashed border-orange-200 bg-white/40 p-12 text-center">
                    <div className="h-16 w-16 bg-orange-50 rounded-3xl flex items-center justify-center mx-auto mb-5 border border-orange-100">
                        <Search className="h-7 w-7 text-orange-500" />
                    </div>
                    <h3 className="text-lg font-black tracking-tight text-slate-800 uppercase mb-2">No stores found</h3>
                    <p className="text-sm text-slate-500">No store matches this search and these filters.</p>
                    <Button variant="outline" onClick={clear} className="mt-5 rounded-full border-orange-100 text-orange-600 font-bold hover:bg-orange-50">Clear all</Button>
                </div>
            ) : sort === "city" ? (
                <div className="space-y-6">
                    {cities.map(({ city: c, list }) => (
                        <div key={c}>
                            <h3 className="flex items-center gap-2 px-1">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{c}</span>
                                <span className="py-0.5 px-2 rounded-full bg-orange-50 text-orange-600 text-[10px] font-black tabular-nums">{list.length}</span>
                            </h3>
                            <ul className="mt-2 rounded-[24px] border border-orange-100 bg-white shadow-sm divide-y divide-orange-50 overflow-hidden">
                                {list.map(s => <StoreRow key={s.vendor_details_id} s={s} onOpen={() => open(s.vendor_details_id)} />)}
                            </ul>
                        </div>
                    ))}
                </div>
            ) : (
                <ul className="rounded-[24px] border border-orange-100 bg-white shadow-sm divide-y divide-orange-50 overflow-hidden">
                    {sorted.map(s => <StoreRow key={s.vendor_details_id} s={s} showCity onOpen={() => open(s.vendor_details_id)} />)}
                </ul>
            )}

            <p className="text-xs text-slate-400 px-1">Head office decides which stores are yours. Ask them to add or move one.</p>
        </div>
    );
};
