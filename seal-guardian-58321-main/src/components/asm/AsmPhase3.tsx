import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { displayName } from "@/lib/asmStores";
import { AsmStoreDetail } from "./AsmStoreDetail";

/** The ASM's stores' orders to their distributors, and their monthly review & feedback (read-only). */

const fmt = (n: number) => n.toLocaleString("en-IN");
const dateText = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const monthText = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const Loading = () => <div className="flex items-center justify-center gap-3 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-orange-500" />Loading…</div>;

function useStoreOpener() {
    const [openId, setOpenId] = useState<string | null>(null);
    const open = (id: string | null) => { setOpenId(id); document.getElementById("main-dashboard-content-area")?.scrollTo({ top: 0 }); };
    return { open, page: openId ? <AsmStoreDetail storeId={openId} onBack={() => open(null)} /> : null };
}
const StoreLink = ({ id, name, onOpen }: { id: string; name: string; onOpen: (id: string) => void }) => (
    <button type="button" onClick={() => onOpen(id)} className="text-left font-semibold text-slate-900 hover:text-orange-600 hover:underline">{displayName(name)}</button>
);
const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", on ? "bg-orange-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-orange-50")}>{children}</button>
);

/* ---------------- Orders ---------------- */

type Order = { id: string; status: string; total_amount: number; created: string | null; docket_id: string | null; decline_reason: string | null; store_id: string; store_name: string; city: string | null; distributor: string | null; items: number; qty: number };
const ORDER_STATUS: Record<string, { label: string; tone: string }> = {
    pending: { label: "Waiting for distributor", tone: "bg-amber-50 text-amber-800" },
    processing: { label: "Being processed", tone: "bg-blue-50 text-blue-700" },
    confirmed: { label: "Confirmed", tone: "bg-blue-50 text-blue-700" },
    shipped: { label: "Shipped", tone: "bg-violet-50 text-violet-700" },
    delivered: { label: "Delivered", tone: "bg-emerald-50 text-emerald-800" },
    declined: { label: "Declined", tone: "bg-red-50 text-red-700" },
    cancelled: { label: "Cancelled", tone: "bg-slate-100 text-slate-600" },
};
const OPEN_ORDER = new Set(["pending", "processing", "confirmed", "shipped"]);

export function AsmOrders() {
    const { toast } = useToast();
    const [orders, setOrders] = useState<Order[] | null>(null);
    const [only, setOnly] = useState<"open" | "all">("open");
    const { open, page } = useStoreOpener();
    useEffect(() => {
        api.get("/asm-portal/orders").then(r => setOrders(r.data.orders))
            .catch(e => { setOrders([]); toast({ title: "Could not load the orders", description: getErrorMessage(e, "Try again"), variant: "destructive" }); });
    }, [toast]);
    if (page) return page;
    if (!orders) return <Loading />;
    const list = orders.filter(o => only === "all" || OPEN_ORDER.has(o.status));
    const openCount = orders.filter(o => OPEN_ORDER.has(o.status)).length;
    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-500">Orders your stores placed with their distributors on the portal.</p>
            <div className="flex flex-wrap gap-2">
                <Chip on={only === "open"} onClick={() => setOnly("open")}>Open ({openCount})</Chip>
                <Chip on={only === "all"} onClick={() => setOnly("all")}>All ({orders.length})</Chip>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Order</th><th className="px-3 py-2">Store</th><th className="px-3 py-2">Distributor</th><th className="px-3 py-2 text-right">Items</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                        {list.map(o => {
                            const st = ORDER_STATUS[o.status] ?? { label: o.status, tone: "bg-slate-100 text-slate-600" };
                            return (
                                <tr key={o.id}>
                                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-900">{o.id}<span className="block font-sans text-slate-400">{dateText(o.created)}</span></td>
                                    <td className="px-3 py-2.5"><StoreLink id={o.store_id} name={o.store_name} onOpen={open} />{o.city && <span className="block text-xs text-slate-400">{o.city}</span>}</td>
                                    <td className="px-3 py-2.5 text-xs text-slate-700">{o.distributor ?? "—"}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums">{fmt(o.qty)}<span className="block text-xs text-slate-400">{o.items} product{o.items === 1 ? "" : "s"}</span></td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{o.total_amount ? `₹${fmt(o.total_amount)}` : "—"}</td>
                                    <td className="px-3 py-2.5 text-xs"><span className={cn("rounded px-1.5 py-0.5 font-bold", st.tone)}>{st.label}</span>{o.docket_id && <span className="mt-0.5 block text-slate-500">Docket {o.docket_id}</span>}{o.decline_reason && <span className="mt-0.5 block text-slate-500">{o.decline_reason}</span>}</td>
                                </tr>
                            );
                        })}
                        {!list.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{orders.length ? "No open orders." : "Your stores have not placed any orders on the portal yet."}</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ---------------- Review & feedback ---------------- */

type Answer = { qid: string; label: string; type: string; value: string | number | boolean | string[] | null };
type Feedback = { month: string; enabled: boolean; months: string[]; responses: { id: string; store_id: string; store_name: string; city: string | null; submitted: string | null; answers: Answer[] }[]; pending: { store_id: string; store_name: string; city: string | null }[] };

const answerText = (a: Answer) => a.value === null || a.value === "" ? "—" : a.value === true ? "Yes" : a.value === false ? "No" : Array.isArray(a.value) ? a.value.join(", ") : String(a.value);
const NUMERIC = new Set(["scale", "rating", "nps", "number"]);

export function AsmFeedback() {
    const { toast } = useToast();
    const [month, setMonth] = useState<string | null>(null);
    const [d, setD] = useState<Feedback | null>(null);
    const [tab, setTab] = useState<"answered" | "waiting">("answered");
    const [openId, setOpenId] = useState<string | null>(null);
    const { open, page } = useStoreOpener();
    useEffect(() => {
        setD(null);
        api.get("/asm-portal/feedback", { params: month ? { month } : {} }).then(r => setD(r.data))
            .catch(e => { toast({ title: "Could not load the feedback", description: getErrorMessage(e, "Try again"), variant: "destructive" }); });
    }, [month, toast]);
    /* The average of each number question across the stores that answered it. */
    const averages = useMemo(() => {
        const m = new Map<string, { label: string; sum: number; n: number }>();
        for (const r of d?.responses ?? []) for (const a of r.answers) {
            if (!NUMERIC.has(a.type) || typeof a.value !== "number") continue;
            const x = m.get(a.qid) ?? { label: a.label, sum: 0, n: 0 };
            x.sum += a.value; x.n += 1; m.set(a.qid, x);
        }
        return [...m.values()].map(x => ({ label: x.label, avg: Math.round((x.sum / x.n) * 10) / 10, n: x.n }));
    }, [d]);
    if (page) return page;
    if (!d) return <Loading />;
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-slate-500">The monthly review & feedback your stores give head office.{!d.enabled && " The form is switched off at the moment."}</p>
                <select value={d.month} onChange={e => setMonth(e.target.value)} aria-label="Month" className="ml-auto h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
                    {d.months.map(m => <option key={m} value={m}>{monthText(m)}</option>)}
                </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><p className="text-2xl font-black tabular-nums text-slate-900">{d.responses.length}</p><p className="text-sm font-bold text-slate-600">Stores answered</p><p className="text-xs text-slate-400">{monthText(d.month)}</p></div>
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><p className="text-2xl font-black tabular-nums text-slate-900">{d.pending.length}</p><p className="text-sm font-bold text-slate-600">Still to fill it</p><p className="text-xs text-slate-400">stores the form is for</p></div>
            </div>
            {averages.length > 0 && (
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <p className="text-sm font-black text-slate-800">Average ratings from your stores</p>
                    <p className="mb-3 text-xs text-slate-500">Out of 10, across the stores that answered.</p>
                    <ul className="space-y-2">
                        {averages.map(a => (
                            <li key={a.label} className="grid grid-cols-[minmax(0,1fr)_120px_48px] items-center gap-3 text-sm">
                                <span className="truncate text-slate-700" title={a.label}>{a.label}</span>
                                <span className="h-2 rounded-full bg-slate-100" role="img" aria-label={`${a.avg} out of 10`}><span className="block h-2 rounded-full bg-[#257de0]" style={{ width: `${Math.min(100, a.avg * 10)}%` }} /></span>
                                <span className="text-right font-semibold tabular-nums text-slate-900">{a.avg}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <div className="flex flex-wrap gap-2">
                <Chip on={tab === "answered"} onClick={() => setTab("answered")}>Answered ({d.responses.length})</Chip>
                <Chip on={tab === "waiting"} onClick={() => setTab("waiting")}>Still to fill ({d.pending.length})</Chip>
            </div>
            {tab === "waiting" ? (
                <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-sm">
                    {d.pending.map(s => <li key={s.store_id} className="px-4 py-2.5 text-sm"><StoreLink id={s.store_id} name={s.store_name} onOpen={open} />{s.city && <span className="ml-2 text-xs text-slate-400">{s.city}</span>}</li>)}
                    {!d.pending.length && <li className="px-4 py-8 text-center text-sm text-slate-500">Every store has filled it.</li>}
                </ul>
            ) : (
                <ul className="space-y-2">
                    {d.responses.map(r => {
                        const isOpen = openId === r.id;
                        return (
                            <li key={r.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                                    <span className="min-w-0 flex-1"><StoreLink id={r.store_id} name={r.store_name} onOpen={open} /><span className="block text-xs text-slate-400">{[r.city, `filled ${dateText(r.submitted)}`].filter(Boolean).join(" · ")}</span></span>
                                    <button type="button" onClick={() => setOpenId(isOpen ? null : r.id)} aria-expanded={isOpen} className="inline-flex items-center text-xs font-semibold text-orange-600">{isOpen ? "Hide answers" : "See answers"}<ChevronDown className={cn("ml-0.5 h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} /></button>
                                </div>
                                {isOpen && (
                                    <dl className="grid gap-x-6 gap-y-1.5 border-t border-slate-100 px-4 py-3 sm:grid-cols-2">
                                        {r.answers.map(a => <div key={a.qid} className="text-sm"><dt className="text-xs text-slate-400">{a.label}</dt><dd className="text-slate-800">{answerText(a)}</dd></div>)}
                                    </dl>
                                )}
                            </li>
                        );
                    })}
                    {!d.responses.length && <li className="rounded-2xl border border-slate-100 bg-white px-4 py-8 text-center text-sm text-slate-500">No store has filled it for {monthText(d.month)} yet.</li>}
                </ul>
            )}
        </div>
    );
}
