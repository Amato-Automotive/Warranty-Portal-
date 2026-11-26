import { useEffect, useState } from "react";
import { Loader2, Truck } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { STATUS_TONE, designLine, shortDate, type StoreSummary } from "@/lib/posmHistory";

/**
 * A store's own POSM history: what head office (the Noida office and the
 * plant) has sent it, what is still being made, and its FRP and Sample
 * Jacket allowance.
 */

interface Line { id: string; item: string; design: string | null; major_colour: string | null; minor_colour: string | null; qty: number; status: string; request_date: string | null; dispatch_date: string | null; delivery_date: string | null; courier: string | null; docket_no: string | null }

export function POSMReceived() {
    const [d, setD] = useState<{ summary: StoreSummary; store_type: "old" | "new"; lines: Line[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { api.get("/posm/history").then(r => setD(r.data)).catch(e => setError(getErrorMessage(e, "Could not load what you have received"))); }, []);

    if (error) return <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500">{error}</div>;
    if (!d) return <div className="flex justify-center rounded-2xl border border-gray-100 bg-white p-10"><Loader2 className="h-6 w-6 animate-spin text-brand-orange" /></div>;
    if (!d.lines.length) return <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500">No POSM has been sent to your store yet.</div>;

    const s = d.summary;
    const allowance = (label: string, v: StoreSummary["frp"]) => (
        <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3">
            <p className="text-xs font-semibold text-gray-500">{label} received</p>
            <p className="text-2xl font-black tabular-nums text-gray-900">{v.sent}{v.limit !== null && <span className="text-base font-bold text-gray-400"> / {v.limit}</span>}</p>
            {v.pending > 0 && <p className="text-xs text-amber-700">{v.pending} being made</p>}
            {v.limit !== null && <p className={cn("text-xs", v.left ? "text-gray-500" : "font-semibold text-amber-700")}>{v.left ? `${v.left} more without approval` : "More needs approval from head office"}</p>}
        </div>
    );
    const others = Object.entries(s.sent).filter(([k]) => k !== "FRP" && k !== "Sample Jacket").sort((a, b) => a[0].localeCompare(b[0]));

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {allowance("FRP", s.frp)}
                {allowance("Sample Jackets", s.jacket)}
            </div>
            {d.store_type === "new" && s.needs_approval && <p className="text-sm text-amber-700">Your one-time FRP and Sample Jacket request has been used. More needs approval from head office.</p>}
            {others.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {others.map(([k, n]) => <span key={k} className="rounded-full border border-gray-100 bg-white px-3 py-1 text-xs text-gray-700">{k} <b className="tabular-nums">{n}</b></span>)}
                </div>
            )}
            <ul className="divide-y divide-gray-50 overflow-hidden rounded-2xl border border-gray-100 bg-white">
                {d.lines.map(l => (
                    <li key={l.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-gray-900">{l.item} <span className="font-normal text-gray-500">× {l.qty}</span>{designLine(l) && <span className="font-normal text-gray-600"> · {designLine(l)}</span>}</p>
                            <p className="text-xs text-gray-500">
                                {[l.dispatch_date ? `Sent ${shortDate(l.dispatch_date)}` : l.request_date ? `Asked ${shortDate(l.request_date)}` : null, l.delivery_date ? `delivered ${shortDate(l.delivery_date)}` : null].filter(Boolean).join(" · ")}
                            </p>
                            {(l.courier || l.docket_no) && <p className="flex items-center gap-1 text-xs text-gray-500"><Truck className="h-3 w-3" />{[l.courier, l.docket_no].filter(Boolean).join(" · ")}</p>}
                        </div>
                        <span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_TONE(l.status))}>{l.status}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
