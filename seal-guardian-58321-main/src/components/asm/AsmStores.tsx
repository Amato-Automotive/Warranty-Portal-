import { useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Loader2, Search, Store, X } from "lucide-react";
import { AsmStoreDetail } from "./AsmStoreDetail";
import { StorePulse } from "./StorePulse";
import {
    type AsmStoreSummary, displayName, isLive, monthName, statusNote, storeAvatar, storeInitials,
} from "@/lib/asmStores";

/**
 * The franchises and distributors this ASM looks after, read-only; head office
 * assigns them. The roster by city, each store with its last twelve weeks of
 * warranties so a slowing store shows without opening it. It describes the
 * stores; it does not tell the ASM whom to call (owner's call, 9 Oct 2026).
 */


const Initials = ({ s, className }: { s: AsmStoreSummary; className?: string }) => (
    <span className={cn(
        "shrink-0 rounded-xl text-white font-bold flex items-center justify-center",
        isLive(s) ? storeAvatar(s.vendor_details_id) : "bg-slate-300",
        className
    )}>
        {storeInitials(s.store_name)}
    </span>
);

export const AsmStores = () => {
    const [stores, setStores] = useState<AsmStoreSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [openId, setOpenId] = useState<string | null>(null);

    useEffect(() => {
        api.get("/asm-portal/stores")
            .then(res => setStores(res.data.stores || []))
            .catch(e => setError(getErrorMessage(e, "Could not load your stores")))
            .finally(() => setLoading(false));
    }, []);

    // City groups, biggest first; live stores by this month's warranties, then the rest.
    const cities = useMemo(() => {
        const q = search.trim().toLowerCase();
        const match = (s: AsmStoreSummary) => !q || [s.store_name, s.store_code, s.city, s.state, s.contact_name, s.phone_number]
            .some(v => (v || "").toLowerCase().includes(q));
        const groups = new Map<string, AsmStoreSummary[]>();
        for (const s of stores.filter(match)) {
            const city = s.city?.trim() || "No city";
            groups.set(city, [...(groups.get(city) || []), s]);
        }
        return [...groups.entries()]
            .map(([city, list]) => ({
                city,
                list: list.sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.warranties_this_month - a.warranties_this_month),
            }))
            .sort((a, b) => b.list.length - a.list.length || a.city.localeCompare(b.city));
    }, [stores, search]);

    const open = (id: string | null) => {
        setOpenId(id);
        document.getElementById("main-dashboard-content-area")?.scrollTo({ top: 0 });
    };

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
        return <div className="rounded-2xl border border-rose-100 bg-rose-50 p-6 text-center text-sm text-rose-700">{error}</div>;
    }

    if (stores.length === 0) {
        return (
            <div className="max-w-sm mx-auto py-16 text-center">
                <Store className="h-8 w-8 text-orange-300 mx-auto mb-3" />
                <p className="text-base font-semibold text-slate-800">No stores under you yet</p>
                <p className="text-sm text-slate-500 mt-1">Head office assigns franchises and distributors to you. They will show up here with their numbers.</p>
            </div>
        );
    }

    const monthTotal = stores.reduce((n, s) => n + s.warranties_this_month, 0);
    const cityCount = new Set(stores.map(s => s.city?.trim() || "")).size;

    return (
        <div className="max-w-4xl space-y-8">
            {/* The territory in one sentence */}
            <p className="text-lg md:text-xl text-slate-500 leading-snug">
                <span className="text-slate-900 font-semibold">{stores.length} stores</span> across {cityCount} {cityCount === 1 ? "city" : "cities"},{" "}
                <span className="text-slate-900 font-semibold tabular-nums">{monthTotal.toLocaleString("en-IN")} warranties</span> so far in {monthName(0)}.
            </p>

            {/* Every store, by city */}
            <section>
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-slate-900">All stores</h2>
                    <p className="hidden sm:block text-xs text-slate-400">Bars are warranties per week, last 12 weeks</p>
                </div>

                <div className="relative mt-3">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Find a store, city, code or owner"
                        className="w-full h-11 pl-10 pr-9 rounded-xl border border-slate-200 bg-white text-[15px] placeholder:text-slate-400 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Clear search">
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {cities.length === 0 ? (
                    <p className="py-10 text-center text-sm text-slate-500">
                        No store matches "{search.trim()}". <button onClick={() => setSearch("")} className="font-medium text-orange-700 hover:underline">Clear search</button>
                    </p>
                ) : (
                    <div className="mt-5 space-y-6">
                        {cities.map(({ city, list }) => (
                            <div key={city}>
                                <h3 className="text-sm text-slate-500 flex items-baseline gap-2 px-1">
                                    <span className="font-semibold text-slate-700">{city}</span>
                                    <span className="tabular-nums text-slate-400">{list.length}</span>
                                </h3>
                                <ul className="mt-2 rounded-2xl border border-slate-200/80 bg-white divide-y divide-slate-100 overflow-hidden">
                                    {list.map(s => {
                                        const note = statusNote(s);
                                        const flagged = s.grievances_open > 0;
                                        return (
                                            <li key={s.vendor_details_id}>
                                                <button
                                                    onClick={() => open(s.vendor_details_id)}
                                                    className="w-full text-left flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-slate-50 active:bg-orange-50/60 transition-colors focus-visible:outline-none focus-visible:bg-orange-50"
                                                >
                                                    <Initials s={s} className="h-10 w-10 text-sm" />
                                                    <div className="min-w-0 flex-1">
                                                        <p className={cn("text-[15px] font-semibold truncate flex items-center gap-1.5", isLive(s) ? "text-slate-900" : "text-slate-400")}>
                                                            <span className="truncate">{displayName(s.store_name)}</span>
                                                            {flagged && <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" title="Open grievance" />}
                                                        </p>
                                                        <div className="flex items-center gap-3 mt-1">
                                                            <p className="text-xs text-slate-400 truncate">
                                                                {[s.is_distributor ? "Distributor" : null, note, s.store_code].filter(Boolean).join(", ")}
                                                            </p>
                                                            {/* Phones: the pulse rides under the name so the name keeps the width */}
                                                            <StorePulse weekly={s.weekly} muted={!isLive(s)} className="sm:hidden !h-4 w-16 shrink-0 ml-auto" />
                                                        </div>
                                                    </div>
                                                    <StorePulse weekly={s.weekly} muted={!isLive(s)} className="hidden sm:flex w-28 lg:w-40 shrink-0" />
                                                    <div className="w-12 sm:w-14 text-right shrink-0">
                                                        <p className={cn("text-lg font-semibold tabular-nums leading-none", isLive(s) ? "text-slate-900" : "text-slate-400")}>
                                                            {s.warranties_this_month.toLocaleString("en-IN")}
                                                        </p>
                                                        <p className="text-[11px] text-slate-400 mt-1">{monthName(0, "short")}</p>
                                                    </div>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <p className="text-xs text-slate-400">Head office decides which stores are yours. Ask them to add or move one.</p>
        </div>
    );
};
