import { useEffect, useMemo, useState } from "react";
import { Factory, Loader2, PackageCheck, Truck } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { designLine, shortDate, type StoreSummary } from "@/lib/posmHistory";

/**
 * A store's own POSM: its FRP and Sample Jacket allowance, what is still
 * coming, and what it has received, one card per shipment with its courier
 * and docket. Head office's notes (reasons, remarks), the expected date and
 * the urgent mark are never sent to the store (decided 27 Nov).
 */

interface Line {
    id: string; from: "Plant" | "Head office"; item: string; design: string | null; major_colour: string | null; minor_colour: string | null; qty: number; status: string;
    request_date: string | null; dispatch_date: string | null; delivery_date: string | null; courier: string | null; docket_no: string | null;
    dispatch_group: string | null; ticket_id: string | null;
}
type History = { summary: StoreSummary; store_type: "old" | "new"; lines: Line[] };

const COMING = new Set(["Not updated", "WIP", "Ready to dispatch", "On hold", "Out of stock"]);
/** The plant's words, as a store reads them. */
const STORE_STATUS: Record<string, string> = {
    "Not updated": "Ordered", WIP: "Being made", "Ready to dispatch": "Ready to send", "On hold": "On hold", "Out of stock": "Waiting for stock",
    Dispatched: "Sent", "In Transit": "On the way", Delivered: "Delivered", Return: "Returned",
};
const TONE: Record<string, string> = {
    "Ready to dispatch": "bg-emerald-50 text-emerald-700", "On hold": "bg-rose-50 text-rose-700", "Out of stock": "bg-rose-50 text-rose-700",
    Dispatched: "bg-sky-50 text-sky-700", "In Transit": "bg-sky-50 text-sky-700", Delivered: "bg-emerald-50 text-emerald-700", Return: "bg-gray-100 text-gray-600",
};
const pill = (status: string) => <span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE[status] ?? "bg-amber-50 text-amber-800")}>{STORE_STATUS[status] ?? status}</span>;

function useHistory() {
    const [d, setD] = useState<History | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { api.get("/posm/history").then(r => setD(r.data)).catch(e => setError(getErrorMessage(e, "Could not load what you have received"))); }, []);
    return { d, error };
}

function Allowance({ label, v, compact }: { label: string; v: StoreSummary["frp"]; compact?: boolean }) {
    const left = v.limit === null ? null : Math.max(0, v.limit - v.sent - v.pending);
    return (
        <div className={cn("rounded-2xl border border-gray-100 bg-white", compact ? "px-3 py-2" : "px-4 py-3")}>
            <p className="text-xs font-semibold text-gray-500">{label} received</p>
            <p className={cn("font-black tabular-nums text-gray-900", compact ? "text-lg" : "text-2xl")}>{v.sent}{v.limit !== null && <span className="text-sm font-bold text-gray-400"> of {v.limit}</span>}</p>
            {v.pending > 0 && <p className="text-xs text-amber-700">{v.pending} more coming</p>}
            {left !== null && <p className={cn("text-xs", left ? "text-gray-500" : "font-semibold text-amber-700")}>{left ? `You can ask for ${left} more` : "More needs approval from head office"}</p>}
        </div>
    );
}

/** The FRP / Sample Jacket allowance, small, for the Order screen. */
export function POSMAllowanceStrip() {
    const { d } = useHistory();
    if (!d || (d.summary.frp.limit === null && d.summary.jacket.limit === null)) return null;
    return (
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <Allowance label="FRP" v={d.summary.frp} compact />
            <Allowance label="Sample Jackets" v={d.summary.jacket} compact />
        </div>
    );
}

export function POSMReceived() {
    const { d, error } = useHistory();
    const { coming, shipments } = useMemo(() => {
        const lines = d?.lines ?? [];
        const coming = lines.filter(l => COMING.has(l.status))
            .sort((a, b) => (b.request_date ?? "").localeCompare(a.request_date ?? ""));
        /* One card per shipment: the Noida office's dispatch group, else the same day, docket and courier. */
        const groups = new Map<string, Line[]>();
        for (const l of lines.filter(x => !COMING.has(x.status))) {
            const key = l.dispatch_group ?? [l.from, l.dispatch_date ?? "", l.docket_no ?? "", l.courier ?? ""].join("|");
            groups.set(key, [...(groups.get(key) ?? []), l]);
        }
        const shipments = [...groups.values()].sort((a, b) => (b[0].dispatch_date ?? b[0].request_date ?? "").localeCompare(a[0].dispatch_date ?? a[0].request_date ?? ""));
        return { coming, shipments };
    }, [d]);

    if (error) return <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500">{error}</div>;
    if (!d) return <div className="flex justify-center rounded-2xl border border-gray-100 bg-white p-10"><Loader2 className="h-6 w-6 animate-spin text-brand-orange" /></div>;
    if (!d.lines.length) return <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500">No POSM has been sent to your store yet.</div>;

    const s = d.summary;
    const others = Object.entries(s.sent).filter(([k]) => k !== "FRP" && k !== "Sample Jacket").sort((a, b) => a[0].localeCompare(b[0]));

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Allowance label="FRP" v={s.frp} />
                <Allowance label="Sample Jackets" v={s.jacket} />
            </div>
            {others.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {others.map(([k, n]) => <span key={k} className="rounded-full border border-gray-100 bg-white px-3 py-1 text-xs text-gray-700">{k} <b className="tabular-nums">{n}</b></span>)}
                </div>
            )}

            {coming.length > 0 && (
                <section className="space-y-2">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800"><Factory className="h-4 w-4 text-brand-orange" />Coming to you ({coming.length})</h3>
                    <ul className="divide-y divide-gray-50 overflow-hidden rounded-2xl border border-gray-100 bg-white">
                        {coming.map(l => {
                            return (
                                <li key={l.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-gray-900">
                                            {l.item} <span className="font-normal text-gray-500">× {l.qty}</span>{designLine(l) && <span className="font-normal text-gray-600"> · {designLine(l)}</span>}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            {[l.request_date ? `Asked ${shortDate(l.request_date)}` : null, l.ticket_id ? `request ${l.ticket_id}` : null].filter(Boolean).join(" · ")}
                                        </p>
                                    </div>
                                    {pill(l.status)}
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {shipments.length > 0 && (
                <section className="space-y-2">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800"><PackageCheck className="h-4 w-4 text-brand-orange" />Received ({shipments.length} shipment{shipments.length === 1 ? "" : "s"})</h3>
                    <ul className="space-y-2">
                        {shipments.map(g => {
                            const f = g[0];
                            const status = g.every(l => l.status === "Delivered") ? "Delivered" : g.some(l => l.status === "In Transit") ? "In Transit" : f.status;
                            return (
                                <li key={f.id} className="rounded-2xl border border-gray-100 bg-white px-4 py-3">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-gray-900">{f.dispatch_date ? `Sent ${shortDate(f.dispatch_date)}` : "Sent"} <span className="font-normal text-gray-500">· {f.from === "Plant" ? "from the plant" : "from head office"}</span></p>
                                            {(f.courier || f.docket_no) && <p className="flex items-center gap-1 text-xs text-gray-500"><Truck className="h-3 w-3" />{[f.courier, f.docket_no && `docket ${f.docket_no}`].filter(Boolean).join(" · ")}</p>}
                                            {f.delivery_date && <p className="text-xs text-gray-500">Delivered {shortDate(f.delivery_date)}</p>}
                                        </div>
                                        {pill(status)}
                                    </div>
                                    <ul className="mt-2 flex flex-wrap gap-1.5">
                                        {g.map(l => (
                                            <li key={l.id} className="rounded-lg bg-gray-50 px-2.5 py-1 text-xs text-gray-700">
                                                {l.item} <b className="tabular-nums">× {l.qty}</b>{designLine(l) && <span className="text-gray-500"> · {designLine(l)}</span>}
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}
        </div>
    );
}
