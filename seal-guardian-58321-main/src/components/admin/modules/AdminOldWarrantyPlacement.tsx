import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { storeMatches } from "@/lib/storeSearch";

/**
 * Admin › Old Warranties: which store each old store name went to (By
 * franchise), the names with no store in the portal, and the ones still to
 * confirm. Placing or moving a name moves all its warranties; the store sees
 * them on its Old Warranties page straight away.
 */

export type OwTab = "stores" | "none" | "open" | "all";
type Summary = { total: number; placed: number; stores: number; no_store: { names: number; rows: number }; open: { names: number; rows: number } };
type StoreRow = { store_id: string; store_name: string; store_code: string | null; city: string | null; state: string | null; brand: string; rows: number; period: string; names: string };
type Group = { id: string; name: string | null; email: string | null; rows: number; period: string; note?: string | null; candidates?: { store_id: string; store_name: string; city: string | null; why: string | null }[] };
type PickStore = { id: string; name: string; code: string | null; city: string | null };

const fmt = (n: number) => n.toLocaleString("en-IN");
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

function useCanPlace() {
    const { user, hasPermission } = useAuth() as any;
    return Boolean(user?.isSuperAdmin) || hasPermission?.("old_warranties", "write");
}

/** The tab bar with counts. */
export function OldWarrantyTabs({ tab, onTab, reload }: { tab: OwTab; onTab: (t: OwTab) => void; reload: number }) {
    const [s, setS] = useState<Summary | null>(null);
    useEffect(() => { api.get("/admin/old-warranties/placement/summary").then(r => setS(r.data)).catch(() => setS(null)); }, [reload]);
    const tabs: [OwTab, string, string][] = [
        ["stores", "By franchise", s ? fmt(s.stores) : ""],
        ["none", "Store not found", s ? fmt(s.no_store.names) : ""],
        ["open", "To confirm", s ? fmt(s.open.names) : ""],
        ["all", "All warranties", s ? fmt(s.total) : ""],
    ];
    return (
        <div className="space-y-3">
            {s && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[
                        ["All old warranties", fmt(s.total), ""],
                        ["On a franchise", fmt(s.placed), `${fmt(s.stores)} stores`],
                        ["Store not found", fmt(s.no_store.rows), `${fmt(s.no_store.names)} old store names`],
                        ["To confirm", fmt(s.open.rows), `${fmt(s.open.names)} old store names`],
                    ].map(([l, v, sub]) => (
                        <div key={l} className="rounded-xl border bg-white px-4 py-3">
                            <p className="text-xs font-semibold text-slate-500">{l}</p>
                            <p className="text-2xl font-black tabular-nums text-slate-900">{v}</p>
                            {sub && <p className="text-xs text-slate-500">{sub}</p>}
                        </div>
                    ))}
                </div>
            )}
            <div className="flex flex-wrap gap-1 border-b" role="tablist">
                {tabs.map(([k, l, n]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => onTab(k)}
                        className={cn("-mb-px border-b-2 px-4 py-2.5 text-sm", tab === k ? "border-orange-600 font-bold text-orange-800" : "border-transparent font-semibold text-slate-500 hover:text-slate-800")}>
                        {l}{n && <span className={cn("ml-1.5 rounded-full px-2 py-0.5 text-xs", tab === k ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-600")}>{n}</span>}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** Pick a store for an old store name: the suggested ones first, any store by search, or "no store in the portal". */
function PlaceDialog({ group, title, allowNone, onClose, onPlaced }: { group: Group; title: string; allowNone: boolean; onClose: () => void; onPlaced: () => void }) {
    const { toast } = useToast();
    const [stores, setStores] = useState<PickStore[] | null>(null);
    const [q, setQ] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        api.get("/admin/vendors").then(r => setStores((r.data.vendors || r.data.data || [])
            .map((v: any) => ({ id: String(v.vendor_details_id ?? v.id), name: String(v.store_name ?? "").trim(), code: v.store_code ?? null, city: v.city ?? null }))
            .filter((v: PickStore) => v.name).sort((a: PickStore, b: PickStore) => a.name.localeCompare(b.name)))).catch(() => setStores([]));
    }, []);
    const list = useMemo(() => (q.trim() ? (stores ?? []).filter(s => storeMatches(q.trim().toLowerCase(), [s.name, s.code, s.city])).slice(0, 30) : []), [stores, q]);
    const place = async (storeId: string | null, name: string) => {
        setBusy(true);
        try {
            const r = await api.post(`/admin/old-warranties/placement/groups/${group.id}/place`, { store_id: storeId });
            toast({ title: storeId ? `${fmt(r.data.moved)} warranties placed on ${name}` : `Marked: no store in the portal (${fmt(r.data.moved)} warranties)` });
            onPlaced();
        } catch (e) {
            toast({ title: "Could not save it", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setBusy(false); }
    };
    return (
        <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
            <DialogContent className="max-w-[calc(100%-1.5rem)] rounded-2xl sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-lg font-black">{title}</DialogTitle>
                    <DialogDescription>{group.name || "(no store name)"}{group.email ? ` · ${group.email}` : ""} · {fmt(group.rows)} warranties{group.period ? ` · ${group.period}` : ""}</DialogDescription>
                </DialogHeader>
                {group.note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{group.note}</p>}
                {!!group.candidates?.length && (
                    <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-slate-500">Suggested</p>
                        {group.candidates.map(c => (
                            <button key={c.store_id} type="button" disabled={busy} onClick={() => place(c.store_id, c.store_name)} className="w-full rounded-lg border px-3 py-2 text-left text-sm hover:border-orange-300 hover:bg-orange-50 disabled:opacity-50">
                                <span className="block font-semibold text-slate-900">{c.store_name}{c.city && <span className="font-normal text-slate-500"> · {c.city}</span>}</span>
                                {c.why && <span className="block text-xs text-slate-500">{c.why}</span>}
                            </button>
                        ))}
                    </div>
                )}
                <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-slate-500">Other store</p>
                    <div className="relative"><Search className="absolute left-2.5 top-3 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store, code or city" className="h-10 pl-8" aria-label="Search store, code or city" /></div>
                    {q.trim() && (
                        <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                            {!stores && <li className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-orange-500" /></li>}
                            {list.map(s => (
                                <li key={s.id}><button type="button" disabled={busy} onClick={() => place(s.id, s.name)} className="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 disabled:opacity-50">
                                    <span className="font-semibold text-slate-900">{s.name}</span><span className="text-xs text-slate-500"> {[s.code, s.city].filter(Boolean).join(" · ")}</span>
                                </button></li>
                            ))}
                            {stores && !list.length && <li className="px-3 py-4 text-center text-sm text-slate-500">No store matches.</li>}
                        </ul>
                    )}
                </div>
                {allowNone && (
                    <Button variant="outline" disabled={busy} onClick={() => place(null, "")} className="w-full">No store in the portal</Button>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** One store's old warranties, paged, with search and year (also on the admin's franchise page). */
export function OldWarrantyStoreRows({ storeId }: { storeId: string }) {
    const [q, setQ] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [d, setD] = useState<{ rows: any[]; total: number; pages: number } | null>(null);
    useEffect(() => { const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 400); return () => clearTimeout(t); }, [q]);
    useEffect(() => {
        const p = new URLSearchParams({ store_id: storeId, page: String(page), limit: "25", ...(query ? { search: query } : {}) });
        api.get(`/admin/old-warranties/seatcovers?${p}`).then(r => {
            const data = r.data.data ?? r.data; const pg = r.data.pagination ?? data.pagination ?? {};
            setD({ rows: data.warranties ?? [], total: pg.totalCount ?? 0, pages: pg.totalPages ?? 1 });
        }).catch(() => setD({ rows: [], total: 0, pages: 1 }));
    }, [storeId, query, page]);
    return (
        <div className="space-y-2">
            <div className="relative max-w-md"><Search className="absolute left-2.5 top-3 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customer, phone, UID or product" className="h-10 pl-8" aria-label="Search old warranties" /></div>
            <div className="overflow-x-auto rounded-xl border bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">UID</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Warranty</th><th className="px-3 py-2">Purchased</th><th className="px-3 py-2">Old store name</th></tr></thead>
                    <tbody className="divide-y">
                        {(d?.rows ?? []).map((w: any) => (
                            <tr key={w.id}>
                                <td className="px-3 py-2 font-mono text-xs text-slate-600">{w.uid}</td>
                                <td className="px-3 py-2 font-semibold">{w.customer_name}<span className="block text-xs font-normal text-slate-500">{w.customer_mobile}</span></td>
                                <td className="px-3 py-2">{w.product_name}</td>
                                <td className="px-3 py-2 text-slate-600">{w.warranty_type || "Not recorded"}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{day(w.purchase_date)}</td>
                                <td className="px-3 py-2 text-xs text-slate-500">{w.store_name}</td>
                            </tr>
                        ))}
                        {d && !d.rows.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No old warranties here.</td></tr>}
                        {!d && <tr><td colSpan={6} className="px-3 py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-orange-500" /></td></tr>}
                    </tbody>
                </table>
            </div>
            {d && d.pages > 1 && (
                <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="mr-auto text-slate-500">{fmt(d.total)} old warranties</span>
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
                    <span className="tabular-nums text-slate-600">Page {page} of {d.pages}</span>
                    <Button size="sm" variant="outline" disabled={page >= d.pages} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
                </div>
            )}
        </div>
    );
}

/** One store: the old names placed on it (each can be moved), and its warranties. */
function StoreView({ storeId, onBack, onChanged }: { storeId: string; onBack: () => void; onChanged: () => void }) {
    const [d, setD] = useState<{ store: any; total: number; years: { year: number; n: number }[]; groups: Group[] } | null>(null);
    const [moving, setMoving] = useState<Group | null>(null);
    const [v, setV] = useState(0);
    const canPlace = useCanPlace();
    useEffect(() => { api.get(`/admin/old-warranties/placement/stores/${storeId}`).then(r => setD(r.data)).catch(() => setD(null)); }, [storeId, v]);
    if (!d) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    return (
        <div className="space-y-4">
            <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-orange-700 hover:underline"><ChevronLeft className="h-4 w-4" />By franchise</button>
            <div>
                <h3 className="text-xl font-black text-slate-900">{d.store.store_name}</h3>
                <p className="text-sm text-slate-500">{[d.store.store_code, d.store.city, d.store.state, d.store.brand].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <div className="rounded-xl border bg-white px-4 py-2"><p className="text-xs font-semibold text-slate-500">Old warranties</p><p className="text-xl font-black tabular-nums">{fmt(d.total)}</p></div>
                {d.years.map(y => <div key={y.year} className="rounded-xl border bg-white px-4 py-2"><p className="text-xs font-semibold text-slate-500">{y.year}</p><p className="text-xl font-black tabular-nums">{fmt(y.n)}</p></div>)}
            </div>
            <div className="rounded-xl border bg-white p-3">
                <p className="mb-2 text-sm font-bold">Entered in the old portal as</p>
                <ul className="divide-y">
                    {d.groups.map(g => (
                        <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                            <span>{g.name || "(no store name)"}<span className="text-slate-500"> · {g.email || "no email"} · <b className="tabular-nums text-slate-800">{fmt(g.rows)}</b>{g.period ? ` · ${g.period}` : ""}</span></span>
                            {canPlace && <Button size="sm" variant="outline" className="border-orange-200 text-orange-700" onClick={() => setMoving(g)}>Move to another store</Button>}
                        </li>
                    ))}
                </ul>
            </div>
            <OldWarrantyStoreRows key={v} storeId={d.store.store_id} />
            {moving && <PlaceDialog group={moving} title="Move to another store" allowNone onClose={() => setMoving(null)} onPlaced={() => { setMoving(null); setV(n => n + 1); onChanged(); }} />}
        </div>
    );
}

function ByFranchise({ onChanged }: { onChanged: () => void }) {
    const [q, setQ] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [d, setD] = useState<{ stores: StoreRow[]; total: number; pages: number } | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    useEffect(() => { const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 400); return () => clearTimeout(t); }, [q]);
    const load = useCallback(() => api.get("/admin/old-warranties/placement/stores", { params: { ...(query ? { q: query } : {}), page } }).then(r => setD(r.data)).catch(() => setD({ stores: [], total: 0, pages: 1 })), [query, page]);
    useEffect(() => { load(); }, [load]);
    if (open) return <StoreView storeId={open} onBack={() => { setOpen(null); load(); }} onChanged={onChanged} />;
    return (
        <div className="space-y-3">
            <div className="relative max-w-md"><Search className="absolute left-2.5 top-3 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store, code or city" className="h-10 pl-8" aria-label="Search store" /></div>
            <div className="overflow-x-auto rounded-xl border bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Store</th><th className="px-3 py-2">City</th><th className="px-3 py-2">Brand</th><th className="px-3 py-2 text-right">Old warranties</th><th className="px-3 py-2">Period</th><th className="px-3 py-2">Entered in old portal as</th></tr></thead>
                    <tbody className="divide-y">
                        {(d?.stores ?? []).map(s => (
                            <tr key={s.store_id} className="cursor-pointer hover:bg-orange-50/40" onClick={() => setOpen(s.store_id)}>
                                <td className="px-3 py-2 font-semibold text-slate-900">{s.store_name}{s.store_code && <span className="block text-xs font-normal text-slate-500">{s.store_code}</span>}</td>
                                <td className="px-3 py-2 text-slate-600">{[s.city, s.state].filter(Boolean).join(", ")}</td>
                                <td className="px-3 py-2 text-slate-600">{s.brand}</td>
                                <td className="px-3 py-2 text-right font-bold tabular-nums">{fmt(s.rows)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{s.period}</td>
                                <td className="max-w-[320px] px-3 py-2 text-xs text-slate-500">{s.names}</td>
                            </tr>
                        ))}
                        {d && !d.stores.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No store matches.</td></tr>}
                        {!d && <tr><td colSpan={6} className="px-3 py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-orange-500" /></td></tr>}
                    </tbody>
                </table>
            </div>
            {d && d.pages > 1 && (
                <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="mr-auto text-slate-500">{fmt(d.total)} stores</span>
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
                    <span className="tabular-nums text-slate-600">Page {page} of {d.pages}</span>
                    <Button size="sm" variant="outline" disabled={page >= d.pages} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
                </div>
            )}
        </div>
    );
}

/** Old store names with no store in the portal, or still to confirm: place each on a store. */
function Names({ state, onChanged }: { state: "no_store" | "open"; onChanged: () => void }) {
    const [groups, setGroups] = useState<Group[] | null>(null);
    const [placing, setPlacing] = useState<Group | null>(null);
    const [viewing, setViewing] = useState<Group | null>(null);
    const canPlace = useCanPlace();
    const load = useCallback(() => api.get("/admin/old-warranties/placement/groups", { params: { state } }).then(r => setGroups(r.data.groups)).catch(() => setGroups([])), [state]);
    useEffect(() => { load(); }, [load]);
    if (!groups) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    return (
        <div className="space-y-3">
            <p className="text-sm text-slate-500">{state === "open"
                ? "Old store names not placed yet. Pick the store the warranties belong to; the store sees them straight away."
                : "Old store names with no store in the portal. When the store joins, place its warranties on it."}</p>
            <ul className="divide-y rounded-xl border bg-white">
                {groups.map(g => (
                    <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-900">{g.name || "(no store name)"} <span className="font-normal text-slate-500">· {g.email || "no email"}</span></p>
                            <p className="text-xs text-slate-500">{fmt(g.rows)} warranties{g.period ? ` · ${g.period}` : ""}{g.candidates?.length ? ` · suggested: ${g.candidates.map(c => c.store_name).join(", ")}` : ""}</p>
                            {g.note && <p className="mt-1 text-xs text-amber-800">{g.note}</p>}
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => setViewing(viewing?.id === g.id ? null : g)}>{viewing?.id === g.id ? "Hide" : "View warranties"}</Button>
                            {canPlace && <Button size="sm" className="bg-orange-600 hover:bg-orange-700" onClick={() => setPlacing(g)}>Place on a store</Button>}
                        </div>
                        {viewing?.id === g.id && <div className="w-full"><GroupRows group={g} /></div>}
                    </li>
                ))}
                {!groups.length && <li className="px-4 py-10 text-center text-sm text-slate-500">{state === "open" ? "Nothing left to confirm." : "Every old store name is on a store."}</li>}
            </ul>
            {placing && <PlaceDialog group={placing} title="Place on a store" allowNone={state === "open"} onClose={() => setPlacing(null)} onPlaced={() => { setPlacing(null); load(); onChanged(); }} />}
        </div>
    );
}

/** The warranties of one old store name (by the name as written). */
function GroupRows({ group }: { group: Group }) {
    const [rows, setRows] = useState<any[] | null>(null);
    useEffect(() => {
        const p = new URLSearchParams({ store_name: group.name ?? "", limit: "50" });
        api.get(`/admin/old-warranties/seatcovers?${p}`).then(r => { const data = r.data.data ?? r.data; setRows((data.warranties ?? data.data ?? data ?? []).filter((w: any) => (w.store_email || null) === (group.email || null) || !group.email)); }).catch(() => setRows([]));
    }, [group]);
    if (!rows) return <Loader2 className="mx-auto my-3 h-5 w-5 animate-spin text-orange-500" />;
    return (
        <div className="mt-2 max-h-72 overflow-auto rounded-lg border">
            <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1.5">UID</th><th className="px-2 py-1.5">Customer</th><th className="px-2 py-1.5">Product</th><th className="px-2 py-1.5">Purchased</th></tr></thead>
                <tbody className="divide-y">{rows.map((w: any) => <tr key={w.id}><td className="px-2 py-1.5 font-mono">{w.uid}</td><td className="px-2 py-1.5">{w.customer_name} <span className="text-slate-500">{w.customer_mobile}</span></td><td className="px-2 py-1.5">{w.product_name}</td><td className="whitespace-nowrap px-2 py-1.5">{day(w.purchase_date)}</td></tr>)}</tbody>
            </table>
        </div>
    );
}

/** The first three tabs (the fourth, All warranties, is the existing table). */
export function OldWarrantyPlacement({ tab, onChanged }: { tab: Exclude<OwTab, "all">; onChanged: () => void }) {
    if (tab === "stores") return <ByFranchise onChanged={onChanged} />;
    return <Names key={tab} state={tab === "open" ? "open" : "no_store"} onChanged={onChanged} />;
}
