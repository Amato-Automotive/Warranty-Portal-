import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, History, Loader2, Search, X } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { displayName } from "@/lib/asmStores";
import type { ClaimWarranty } from "@/lib/claims";
import { OldCover } from "@/components/fms/FranchiseOldWarranties";

/**
 * The old-portal warranties placed on the ASM's stores (2023 – Apr 2026),
 * view only: the store raises any claim. The ASM sees which stores have how
 * many, their cover now, and finds a customer across all their stores.
 * Full customer details, as the store sees them (decided 28 Nov).
 */

type CoverId = "covered" | "over" | "not_recorded";
type OldRow = ClaimWarranty & { old: true; purchase_date: string | null; store_id: string; store_name: string };
type StoreRow = { store_id: string; store_name: string; city: string | null; n: number; covered: number; over: number; not_recorded: number; first: string | null; last: string | null };
type Data = {
    total: number; found: number; page: number; pages: number;
    years: { year: number; n: number }[]; cover: Record<CoverId, number>;
    stores: StoreRow[]; warranties: OldRow[];
};

const fmt = (n: number) => n.toLocaleString("en-IN");
const day = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const month = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }) : "");
const period = (a: string | null, b: string | null) => (a && b && month(a) !== month(b) ? `${month(a)} – ${month(b)}` : month(a || b));
const COVERS: { id: CoverId; label: string; tone: string }[] = [
    { id: "covered", label: "Covered now", tone: "text-emerald-700" },
    { id: "over", label: "Cover over", tone: "text-slate-600" },
    { id: "not_recorded", label: "Cover not recorded", tone: "text-amber-800" },
];

function useOldWarranties(params: Record<string, string | number | undefined>) {
    const { toast } = useToast();
    const [d, setD] = useState<Data | null>(null);
    const [loading, setLoading] = useState(true);
    const key = JSON.stringify(params);
    useEffect(() => {
        setLoading(true);
        const p = Object.fromEntries(Object.entries(JSON.parse(key)).filter(([, v]) => v !== undefined && v !== ""));
        api.get("/asm-portal/old-warranties", { params: p })
            .then(r => setD(r.data))
            .catch(e => toast({ title: "Could not load the old warranties", description: getErrorMessage(e, "Try again"), variant: "destructive" }))
            .finally(() => setLoading(false));
    }, [key, toast]);
    return { d, loading };
}

/** The list with search, year and cover filters; fixed to one store when `storeId` is given. */
function OldList({ storeId, store, onClearStore, onOpenStore, cover, onCover, showStore }: {
    storeId?: string; store?: { id: string; name: string } | null; onClearStore?: () => void; onOpenStore?: (id: string) => void;
    cover: CoverId | ""; onCover: (c: CoverId | "") => void; showStore: boolean;
}) {
    const [q, setQ] = useState("");
    const [query, setQuery] = useState("");
    const [year, setYear] = useState("");
    const [page, setPage] = useState(1);
    const sid = storeId ?? store?.id;
    useEffect(() => { const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 400); return () => clearTimeout(t); }, [q]);
    useEffect(() => { setPage(1); }, [sid, cover, year]);
    const { d, loading } = useOldWarranties({ store: sid, q: query, year, cover, page });
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                {store && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1.5 text-sm font-semibold text-orange-800 ring-1 ring-orange-200">
                        {displayName(store.name)}
                        <button type="button" onClick={onClearStore} aria-label="Show all stores" className="rounded-full p-0.5 hover:bg-orange-100"><X className="h-3.5 w-3.5" /></button>
                    </span>
                )}
                {cover && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">
                        {COVERS.find(c => c.id === cover)?.label}
                        <button type="button" onClick={() => onCover("")} aria-label="Any cover" className="rounded-full p-0.5 hover:bg-slate-700"><X className="h-3.5 w-3.5" /></button>
                    </span>
                )}
                <select value={year} onChange={e => setYear(e.target.value)} aria-label="Year" className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm">
                    <option value="">All years</option>
                    {(d?.years ?? []).map(y => <option key={y.year} value={y.year}>{y.year}</option>)}
                </select>
                <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Customer name, mobile or UID" className="h-9 rounded-full border-slate-200 pl-9 shadow-sm focus-visible:ring-orange-200 focus-visible:ring-offset-0" aria-label="Search by customer name, mobile or UID" /></div>
            </div>
            <div className="relative overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>}
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>
                        <th className="px-4 py-2">Bought</th>{showStore && <th className="px-3 py-2">Store</th>}<th className="px-3 py-2">Customer</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Cover</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                        {(d?.warranties ?? []).map(w => (
                            <tr key={w.uid + (w.purchase_date ?? "")} className="align-top">
                                <td className="whitespace-nowrap px-4 py-2.5 text-xs"><span className="font-semibold text-slate-900">{day(w.purchase_date)}</span><span className="block font-mono text-slate-400">{w.uid}</span></td>
                                {showStore && (
                                    <td className="px-3 py-2.5">
                                        {onOpenStore
                                            ? <button type="button" onClick={() => onOpenStore(w.store_id)} className="text-left font-semibold text-slate-900 hover:text-orange-600 hover:underline">{displayName(w.store_name)}</button>
                                            : <span className="font-semibold text-slate-900">{displayName(w.store_name)}</span>}
                                    </td>
                                )}
                                <td className="px-3 py-2.5 text-xs text-slate-700">{w.customer_name || "—"}{w.customer_phone && <span className="block font-mono text-slate-500">{w.customer_phone}</span>}</td>
                                <td className="px-3 py-2.5 text-xs text-slate-700">{w.product_name || "—"}{w.warranty_type && <span className="block text-slate-400">{w.warranty_type}</span>}</td>
                                <td className="px-3 py-2.5 text-xs"><OldCover w={w} /></td>
                            </tr>
                        ))}
                        {!loading && !(d?.warranties.length) && <tr><td colSpan={showStore ? 5 : 4} className="px-4 py-8 text-center text-slate-500">No old warranty matches.</td></tr>}
                    </tbody>
                </table>
            </div>
            {d && d.found > 0 && (
                <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="mr-auto text-slate-500">{fmt(d.found)} found</span>
                    {d.pages > 1 && <>
                        <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-full border border-slate-200 bg-white p-1.5 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                        <span className="tabular-nums text-slate-600">Page {page} of {d.pages}</span>
                        <button type="button" disabled={page >= d.pages} onClick={() => setPage(p => p + 1)} className="rounded-full border border-slate-200 bg-white p-1.5 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
                    </>}
                </div>
            )}
        </div>
    );
}

function CoverTiles({ d, cover, onCover }: { d: Data; cover: CoverId | ""; onCover: (c: CoverId | "") => void }) {
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <button type="button" onClick={() => onCover("")} className={cn("rounded-2xl border bg-white px-4 py-3 text-left shadow-sm", !cover ? "border-orange-300 ring-2 ring-orange-100" : "border-slate-100 hover:border-slate-200")}>
                <p className="text-2xl font-bold tabular-nums text-slate-900">{fmt(d.total)}</p><p className="text-xs font-semibold text-slate-500">Old warranties</p>
            </button>
            {COVERS.map(c => (
                <button key={c.id} type="button" onClick={() => onCover(cover === c.id ? "" : c.id)} aria-pressed={cover === c.id}
                    className={cn("rounded-2xl border bg-white px-4 py-3 text-left shadow-sm", cover === c.id ? "border-orange-300 ring-2 ring-orange-100" : "border-slate-100 hover:border-slate-200")}>
                    <p className={cn("text-2xl font-bold tabular-nums", c.tone)}>{fmt(d.cover[c.id])}</p><p className="text-xs font-semibold text-slate-500">{c.label}</p>
                </button>
            ))}
        </div>
    );
}

/** Warranties › Old warranties: the ASM's stores with old warranties, and all of them in one searchable list. */
export function AsmOldWarranties({ onOpenStore }: { onOpenStore: (id: string) => void }) {
    const { d } = useOldWarranties({});
    const [store, setStore] = useState<{ id: string; name: string } | null>(null);
    const [cover, setCover] = useState<CoverId | "">("");
    const [allStores, setAllStores] = useState(false);
    if (!d) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>;
    if (!d.total) return <p className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-500">None of your stores has warranties from the old portal.</p>;
    const shown = allStores ? d.stores : d.stores.slice(0, 8);
    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-500">Seat cover warranties your stores registered on the old portal{d.years.length ? `, ${d.years[0].year} to ${d.years[d.years.length - 1].year}` : ""}. A store raises a claim on one from its own Old Warranties page.</p>
            <CoverTiles d={d} cover={cover} onCover={setCover} />
            <section className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>
                        <th className="px-4 py-2">Store ({d.stores.length})</th><th className="px-3 py-2 text-right">Old warranties</th><th className="px-3 py-2 text-right">Covered now</th><th className="px-3 py-2 text-right">Cover over</th><th className="px-3 py-2 text-right">Not recorded</th><th className="px-3 py-2">Period</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                        {shown.map(s => (
                            <tr key={s.store_id} className={cn("cursor-pointer hover:bg-orange-50/40", store?.id === s.store_id && "bg-orange-50")} onClick={() => setStore({ id: s.store_id, name: s.store_name })}>
                                <td className="px-4 py-2.5">
                                    <button type="button" onClick={e => { e.stopPropagation(); onOpenStore(s.store_id); }} className="text-left font-semibold text-slate-900 hover:text-orange-600 hover:underline">{displayName(s.store_name)}</button>
                                    {s.city && <span className="block text-xs text-slate-400">{s.city}</span>}
                                </td>
                                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{fmt(s.n)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{fmt(s.covered)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(s.over)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-amber-800">{fmt(s.not_recorded)}</td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">{period(s.first, s.last)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {d.stores.length > 8 && (
                    <button type="button" onClick={() => setAllStores(v => !v)} className="flex w-full items-center justify-center gap-1 border-t border-slate-100 py-2 text-xs font-semibold text-orange-600 hover:bg-orange-50/40">
                        {allStores ? "Show fewer stores" : `Show all ${d.stores.length} stores`}<ChevronRight className={cn("h-3 w-3", allStores && "-rotate-90")} />
                    </button>
                )}
            </section>
            <OldList store={store} onClearStore={() => setStore(null)} onOpenStore={onOpenStore} cover={cover} onCover={setCover} showStore={!store} />
        </div>
    );
}

/** The store page's Old warranties section: its counts by cover, and its list. */
export function AsmStoreOldWarranties({ storeId }: { storeId: string }) {
    const { d } = useOldWarranties({ store: storeId, page: 1 });
    const [open, setOpen] = useState(false);
    const [cover, setCover] = useState<CoverId | "">("");
    const mine = d?.stores.find(s => s.store_id === storeId);
    if (!d || !mine) return null;
    return (
        <section>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900"><History className="h-4 w-4 text-orange-500" />Old warranties</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
                <span className="font-semibold tabular-nums text-slate-900">{fmt(mine.n)}</span> from the old portal ({period(mine.first, mine.last)}):{" "}
                <span className="font-semibold tabular-nums text-emerald-700">{fmt(mine.covered)}</span> covered now,{" "}
                <span className="font-semibold tabular-nums text-slate-700">{fmt(mine.over)}</span> cover over,{" "}
                <span className="font-semibold tabular-nums text-amber-800">{fmt(mine.not_recorded)}</span> cover not recorded.
            </p>
            {open
                ? <div className="mt-3"><OldList storeId={storeId} cover={cover} onCover={setCover} showStore={false} /></div>
                : <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex items-center text-xs font-semibold text-orange-600">See them<ChevronRight className="h-3 w-3" /></button>}
        </section>
    );
}
