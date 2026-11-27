import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, Truck } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, formatToIST } from "@/lib/utils";
import { storeMatches } from "@/lib/storeSearch";
import { STATUS_LABEL, type Brand, type PosmItem, type PosmLine, type Usage } from "@/lib/posm";
import { POSMShop, requestForm } from "./POSMShop";

/**
 * A distributor's POSM for its stores: what each store has asked for and
 * where it stands, and a new request for any one of them, from that store's
 * own items and limits. The request is the store's; the store is told the
 * distributor raised it. Urgent is left to the ASM and head office.
 */

type Store = { id: string; store_name: string; store_code: string | null; city: string | null };
type Req = {
    id: number; ticket_id: string; requirement: string; status: string | null; items: PosmLine[] | null; created_by_role: string; created_by_name: string | null;
    created_at: string; store_id: string; store_name: string; city: string | null; dispatch: { courier?: string; tracking?: string } | null;
};
const DONE = new Set(["delivered", "closed", "rejected"]);
const tone = (s: string) => (s === "rejected" ? "bg-rose-50 text-rose-700" : DONE.has(s) ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800");
const sentence = (v: string) => { const t = v.replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const raisedBy = (r: Req) => (r.created_by_role === "distributor" ? "You" : r.created_by_role === "admin" ? "Head office" : r.created_by_role === "asm" ? `${r.created_by_name || "ASM"} (ASM)` : "The store");

/** Raise for one store: its catalog, brands and limits, as the store itself would see them. */
function RaiseForStore({ store, onClose, onRaised }: { store: Store; onClose: () => void; onRaised: () => void }) {
    const { toast } = useToast();
    const [shop, setShop] = useState<{ items: PosmItem[]; brands: Brand[]; usage: Usage } | null>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        api.get(`/posm/distributor/stores/${store.id}/catalog`)
            .then(r => { const d = r.data.data; setShop({ items: d.catalog.items, brands: d.brands, usage: d.usage }); })
            .catch(e => setError(getErrorMessage(e, "Could not load the POSM items")));
    }, [store.id]);
    const send = async (lines: Parameters<typeof requestForm>[0], note: string) => {
        try {
            const r = await api.post(`/posm/distributor/stores/${store.id}/items`, requestForm(lines, note), { headers: { "Content-Type": "multipart/form-data" } });
            toast({ title: `Request raised: ${r.data?.data?.ticketId ?? ""}`.trim(), description: r.data?.message });
            onRaised();
            return true;
        } catch (e) {
            toast({ title: "Could not raise the request", description: getErrorMessage(e, "Please try again."), variant: "destructive" });
            return false;
        }
    };
    return (
        <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
            <DialogContent className="flex max-h-[92vh] max-w-6xl flex-col gap-0 p-0">
                <DialogHeader className="shrink-0 border-b border-gray-100 px-6 pb-4 pt-6">
                    <DialogTitle className="text-base">POSM for {store.store_name}</DialogTitle>
                    <DialogDescription className="text-xs">The store's own items and limits. It goes to head office as the store's request, marked as raised by you, and the store is told.</DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                    {error ? <p className="py-10 text-center text-sm text-rose-600">{error}</p>
                        : shop ? <POSMShop items={shop.items} brands={shop.brands} usage={shop.usage} onSend={send} sendLabel="Raise request" forStore={store.store_name} />
                        : <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function DistributorPOSM() {
    const { toast } = useToast();
    const [stores, setStores] = useState<Store[] | null>(null);
    const [rows, setRows] = useState<Req[] | null>(null);
    const [only, setOnly] = useState<"open" | "all">("open");
    const [q, setQ] = useState("");
    const [picking, setPicking] = useState(false);
    const [pickQ, setPickQ] = useState("");
    const [raiseFor, setRaiseFor] = useState<Store | null>(null);

    const load = useCallback(() => api.get("/posm/distributor/requests").then(r => setRows(r.data.requests))
        .catch(e => { setRows([]); toast({ title: "Could not load the requests", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }), [toast]);
    useEffect(() => {
        load();
        api.get("/posm/distributor/stores").then(r => setStores(r.data.stores)).catch(() => setStores([]));
    }, [load]);

    const list = useMemo(() => (rows ?? []).filter(r => (only === "all" || !DONE.has(r.status || "open"))
        && (!q.trim() || storeMatches(q.trim().toLowerCase(), [r.store_name, r.ticket_id, r.city]))), [rows, only, q]);
    const pickList = useMemo(() => (stores ?? []).filter(s => !pickQ.trim() || storeMatches(pickQ.trim().toLowerCase(), [s.store_name, s.store_code, s.city])), [stores, pickQ]);

    if (!rows) return <div className="flex justify-center rounded-2xl border border-gray-100 bg-white p-10"><Loader2 className="h-6 w-6 animate-spin text-brand-orange" /></div>;
    const openCount = rows.filter(r => !DONE.has(r.status || "open")).length;
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                {([["open", `Open (${openCount})`], ["all", `All (${rows.length})`]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setOnly(k)} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", only === k ? "bg-gray-900 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50")}>{l}</button>
                ))}
                <div className="relative min-w-[180px] flex-1 sm:max-w-xs"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Store or ticket" className="h-9 pl-8" aria-label="Search store or ticket" /></div>
                <Button className="ml-auto bg-orange-500 hover:bg-orange-600" disabled={!stores?.length} onClick={() => setPicking(true)}><Plus className="mr-1.5 h-4 w-4" />New request for a store</Button>
            </div>
            {stores && !stores.length && <p className="text-sm text-gray-500">No stores are linked to you yet. Head office links stores to their distributor.</p>}
            <ul className="divide-y divide-gray-50 overflow-hidden rounded-2xl border border-gray-100 bg-white">
                {list.map(r => {
                    const status = r.status || "open";
                    return (
                        <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-gray-900">{r.store_name}{r.city && <span className="font-normal text-gray-500"> · {r.city}</span>}</p>
                                <p className="text-sm text-gray-700 line-clamp-2">{r.items?.length ? r.items.map(l => `${l.item_name} ×${l.approved_qty ?? l.qty}`).join(", ") : r.requirement}</p>
                                <p className="text-[11px] text-gray-400">
                                    <span className="font-mono">{r.ticket_id}</span> · {formatToIST(r.created_at)} · raised by {raisedBy(r)}
                                </p>
                                {status === "dispatched" && r.dispatch?.courier && <p className="flex items-center gap-1 text-xs text-gray-500"><Truck className="h-3 w-3" />{[r.dispatch.courier, r.dispatch.tracking].filter(Boolean).join(" · ")}</p>}
                            </div>
                            <span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", tone(status))}>{STATUS_LABEL[status] ?? sentence(status)}</span>
                        </li>
                    );
                })}
                {!list.length && <li className="px-4 py-10 text-center text-sm text-gray-500">{rows.length ? "No open requests." : "None of your stores has a POSM request yet."}</li>}
            </ul>

            <Dialog open={picking} onOpenChange={o => { setPicking(o); if (!o) setPickQ(""); }}>
                <DialogContent className="max-w-[calc(100%-1.5rem)] rounded-2xl sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black">New POSM request</DialogTitle>
                        <DialogDescription>Which of your stores is it for?</DialogDescription>
                    </DialogHeader>
                    <div className="relative"><Search className="absolute left-2.5 top-3 h-4 w-4 text-gray-400" /><Input value={pickQ} onChange={e => setPickQ(e.target.value)} placeholder="Search store, code or city" className="h-10 pl-8" autoFocus aria-label="Search store, code or city" /></div>
                    <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                        {pickList.map(s => (
                            <li key={s.id}><button type="button" onClick={() => { setPicking(false); setPickQ(""); setRaiseFor(s); }} className="w-full px-3 py-2.5 text-left text-sm hover:bg-orange-50">
                                <span className="block font-semibold text-gray-900">{s.store_name}</span><span className="block text-xs text-gray-500">{[s.store_code, s.city].filter(Boolean).join(" · ")}</span>
                            </button></li>
                        ))}
                        {!pickList.length && <li className="px-3 py-6 text-center text-sm text-gray-500">No store matches.</li>}
                    </ul>
                </DialogContent>
            </Dialog>
            {raiseFor && <RaiseForStore store={raiseFor} onClose={() => setRaiseFor(null)} onRaised={() => { setRaiseFor(null); setOnly("open"); load(); }} />}
        </div>
    );
}
