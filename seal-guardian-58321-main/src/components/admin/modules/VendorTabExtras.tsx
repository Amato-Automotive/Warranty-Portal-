import { useEffect, useState } from "react";
import { Loader2, Package, Truck } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { STATUS, type Claim, type ClaimStatus } from "@/lib/claims";
import { shortDate, type HistoryLine, type StoreSummary } from "@/lib/posmHistory";
import { StoreDetail } from "./POSMHistory";

/**
 * The franchise page's extras (28 Nov): the counts beside its tabs, the
 * store's POSM shipments under its POSM requests, and its warranty claims
 * (the portal's and the plant sheet's).
 */

export type TabCounts = {
    old_warranties: number | null; orders: number | null; posm_requests: number | null; posm_shipments: number | null;
    complaints: number | null; audits: number | null; sourcing: number | null; claims: number | null; announcements: number | null;
};

/** The counts for one store; null until loaded, and a count stays null if it could not be read. */
export function useTabCounts(storeId: string | null | undefined) {
    const [c, setC] = useState<TabCounts | null>(null);
    useEffect(() => {
        if (!storeId) return;
        let live = true;
        api.get(`/admin/vendors/${storeId}/tab-counts`).then(r => { if (live) setC(r.data.counts); }).catch(() => {});
        return () => { live = false; };
    }, [storeId]);
    return c;
}

/** "Old warranties (4,650)", or just the name while the count is unknown. */
export const withCount = (label: string, n: number | null | undefined) => (n == null ? label : `${label} (${n.toLocaleString("en-IN")})`);

const fmtDay = (d: string | null | undefined) => (d ? shortDate(String(d).slice(0, 10)) : "");

/** What the plant and the Noida office have sent the store (the POSM sheet), with the full admin view a click away. */
export function VendorPosmShipments({ storeId }: { storeId: string }) {
    const [d, setD] = useState<{ summary: StoreSummary; approval_label: string; lines: HistoryLine[] } | null>(null);
    const [error, setError] = useState("");
    const [open, setOpen] = useState(false);
    const [all, setAll] = useState(false);
    const load = () => api.get(`/posm/admin/history/stores/${storeId}`).then(r => setD(r.data)).catch(e => setError(getErrorMessage(e, "Could not load the shipments")));
    useEffect(() => { load(); }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps
    if (error) return <p className="text-sm text-slate-500">{error}</p>;
    if (!d) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>;
    const lines = all ? d.lines : d.lines.slice(0, 10);
    const lim = (label: string, v: StoreSummary["frp"]) => `${label} ${v.sent}${v.limit != null ? ` of ${v.limit}` : ""}${v.pending ? ` (+${v.pending} coming)` : ""}`;
    return (
        <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Truck className="h-4 w-4 text-orange-500" />Shipments ({d.lines.length})</h3>
                {d.lines.length > 0 && <span className="text-sm text-slate-500">{lim("FRP", d.summary.frp)} · {lim("Sample Jackets", d.summary.jacket)} · {d.approval_label}</span>}
                <button type="button" onClick={() => setOpen(true)} className="ml-auto rounded-full border border-orange-200 px-3 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-50">Open in POSM history</button>
            </div>
            {!d.lines.length ? <p className="text-sm text-slate-500">Nothing sent to this store on the POSM sheet yet.</p> : (
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Asked</th><th className="px-3 py-2">Sent</th><th className="px-3 py-2">Courier</th><th className="px-3 py-2">From</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                            {lines.map(l => (
                                <tr key={l.id}>
                                    <td className="px-3 py-2"><span className="font-semibold text-slate-900">{l.item}</span>{l.design && <span className="block text-xs text-slate-500">{[l.design, [l.major_colour, l.minor_colour].filter(Boolean).join(" / ")].filter(Boolean).join(" · ")}</span>}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{l.qty}</td>
                                    <td className="px-3 py-2 text-xs font-semibold text-slate-700">{l.status}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{fmtDay(l.request_date)}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{fmtDay(l.dispatch_date)}</td>
                                    <td className="px-3 py-2 text-xs text-slate-500">{[l.courier, l.docket_no].filter(Boolean).join(" · ")}</td>
                                    <td className="px-3 py-2 text-xs text-slate-500">{l.source}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {d.lines.length > 10 && <button type="button" onClick={() => setAll(v => !v)} className="w-full border-t border-slate-100 py-2 text-xs font-semibold text-orange-600 hover:bg-orange-50/40">{all ? "Show fewer" : `Show all ${d.lines.length}`}</button>}
                </div>
            )}
            {open && <StoreDetail storeId={storeId} onClose={() => setOpen(false)} onChanged={load} />}
        </section>
    );
}

/** Every warranty claim on the store: raised in the portal, and the plant sheet's rows placed on it. */
export function VendorClaimsTab({ storeId }: { storeId: string }) {
    const [rows, setRows] = useState<Claim[] | null>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        api.get("/claims/admin/all", { params: { store: storeId, sources: "all" } })
            .then(r => setRows(r.data.claims ?? []))
            .catch(e => { setRows([]); setError(getErrorMessage(e, "Could not load the claims")); });
    }, [storeId]);
    if (!rows) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    if (error) return <p className="py-10 text-center text-sm text-slate-500">{error}</p>;
    if (!rows.length) return (
        <div className="flex flex-col items-center gap-2 py-14 text-slate-500"><Package className="h-8 w-8 text-slate-300" /><p className="text-sm">No warranty claims on this store.</p></div>
    );
    return (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Claim</th><th className="px-3 py-2">Customer &amp; car</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Issue</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                    {rows.map(c => (
                        <tr key={c.id} className="align-top">
                            <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                                <span className="font-mono font-semibold text-slate-900">{c.claim_no}</span>
                                <span className="block text-slate-500">{fmtDay(c.created_at)} · {c.raised_via === "sheet" ? "Plant sheet" : "Portal"}</span>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-slate-700">{c.snapshot?.customer_name || (c.raised_via === "sheet" ? <span className="text-slate-400">Not on the sheet</span> : "—")}{c.snapshot?.customer_phone && <span className="block font-mono text-slate-500">{c.snapshot.customer_phone}</span>}{(c.snapshot?.car || c.snapshot?.registration_number) && <span className="block text-slate-500">{[c.snapshot?.registration_number, c.snapshot?.car].filter(Boolean).join(" · ")}</span>}</td>
                            <td className="px-3 py-2.5 text-xs text-slate-700">{c.snapshot?.product_name || "—"}{c.warranty_uid && <span className="block font-mono text-slate-400">{c.warranty_uid}</span>}</td>
                            <td className="px-3 py-2.5 text-xs text-slate-700">{c.problem_text}</td>
                            <td className="px-3 py-2.5 text-xs">
                                <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 font-bold", STATUS[c.status as ClaimStatus]?.tone)}>{c.status_text}</span>
                                {c.waiting_on && <span className="mt-0.5 block text-slate-400">Waiting on {c.waiting_on}</span>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
