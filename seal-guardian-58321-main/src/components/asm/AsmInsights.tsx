import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, ChevronDown, ChevronRight, CircleCheck, Info, Loader2, Package, Search } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { displayName } from "@/lib/asmStores";
import { AsmStoreDetail } from "./AsmStoreDetail";

/**
 * The ASM's alerts (on Home), their stores' Sell More / Buy More, and the
 * POSM each store has had. Every store name opens the store's page.
 */

const fmt = (n: number) => n.toLocaleString("en-IN");
const dateText = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

/** Shows the store's page in place of the list; Back returns to the list as it was. */
function useStoreOpener() {
    const [openId, setOpenId] = useState<string | null>(null);
    const open = (id: string | null) => { setOpenId(id); document.getElementById("main-dashboard-content-area")?.scrollTo({ top: 0 }); };
    const page = openId ? <AsmStoreDetail storeId={openId} onBack={() => open(null)} /> : null;
    return { open, page };
}

const StoreLink = ({ id, name, onOpen }: { id: string; name: string; onOpen: (id: string) => void }) => (
    <button type="button" onClick={() => onOpen(id)} className="text-left font-semibold text-slate-900 hover:text-orange-600 hover:underline">{displayName(name)}</button>
);

const Loading = () => <div className="flex items-center justify-center gap-3 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-orange-500" />Loading…</div>;

/* ---------------- Alerts ---------------- */

type Severity = "critical" | "serious" | "warning" | "good";
type Alert = { key: string; label: string; severity: Severity; why: string; action: string; stores: { store_id: string; store_name: string; city: string | null; detail: string }[] };
const SEV: Record<Severity, { label: string; Icon: typeof Info; icon: string; chip: string }> = {
    critical: { label: "Urgent", Icon: AlertOctagon, icon: "text-red-600 bg-red-50", chip: "bg-red-50 text-red-700" },
    serious: { label: "Act soon", Icon: AlertTriangle, icon: "text-orange-600 bg-orange-50", chip: "bg-orange-50 text-orange-800" },
    warning: { label: "Watch", Icon: Info, icon: "text-amber-600 bg-amber-50", chip: "bg-amber-50 text-amber-800" },
    good: { label: "Good news", Icon: CircleCheck, icon: "text-emerald-700 bg-emerald-50", chip: "bg-emerald-50 text-emerald-800" },
};

/** Home: which stores need the ASM, and why. Opening a store shows its page here. */
export function AsmAlerts() {
    const { toast } = useToast();
    const [alerts, setAlerts] = useState<Alert[] | null>(null);
    const [openKey, setOpenKey] = useState<string | null>(null);
    const { open, page } = useStoreOpener();
    useEffect(() => {
        api.get("/asm-portal/alerts").then(r => setAlerts(r.data.alerts))
            .catch(e => { setAlerts([]); toast({ title: "Could not load your alerts", description: getErrorMessage(e, "Try again"), variant: "destructive" }); });
    }, [toast]);
    if (page) return page;
    if (!alerts) return <Loading />;
    const shown = alerts.filter(a => a.stores.length);
    return (
        <section className="space-y-3">
            <div>
                <h3 className="text-base font-black text-slate-800">Stores that need you</h3>
                <p className="text-xs text-slate-500">Most urgent first. Tap a line to see the stores, and a store to open it.</p>
            </div>
            {!shown.length && <p className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-6 text-center text-sm text-emerald-800">Nothing needs you right now.</p>}
            <ul className="space-y-2">
                {shown.map(a => {
                    const s = SEV[a.severity];
                    const isOpen = openKey === a.key;
                    return (
                        <li key={a.key} className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                            <button type="button" onClick={() => setOpenKey(isOpen ? null : a.key)} aria-expanded={isOpen} className="flex w-full items-start gap-3 p-4 text-left hover:bg-slate-50/70">
                                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", s.icon)} aria-hidden><s.Icon className="h-4 w-4" /></span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-bold text-slate-900">{a.label}</span>
                                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-black uppercase", s.chip)}>{s.label}</span>
                                    </span>
                                    <span className="block text-xs text-slate-600">{a.why}</span>
                                    <span className="block text-[11px] font-semibold text-slate-500">What to do: {a.action}</span>
                                </span>
                                <span className="shrink-0 text-right">
                                    <span className="block text-xl font-black tabular-nums text-slate-800">{fmt(a.stores.length)}</span>
                                    <span className="block text-[10px] font-bold uppercase text-slate-400">store{a.stores.length === 1 ? "" : "s"}</span>
                                </span>
                                <ChevronDown className={cn("mt-2 h-4 w-4 shrink-0 text-slate-400 transition-transform", isOpen && "rotate-180")} />
                            </button>
                            {isOpen && (
                                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                                    {a.stores.map((x, i) => (
                                        <li key={`${x.store_id}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5 text-sm">
                                            <span><StoreLink id={x.store_id} name={x.store_name} onOpen={open} />{x.city && <span className="ml-2 text-xs text-slate-400">{x.city}</span>}</span>
                                            <span className="text-xs text-slate-600">{x.detail}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

/* ---------------- Schemes ---------------- */

type SellRow = { store_id: string; store_name: string; city: string | null; target: number | null; points: number; warranties: number; due_sets: number; reward: string | null; reward_sets: number | null; history: { key: string; label: string; target: number | null; points: number; reward: string | null }[] };
type BuyRow = { store_id: string; store_name: string; city: string | null; distributors: string[]; approved_sets: number; available_sets: number; offer1: { have: number; more: number; ready: boolean } | null; offer2_ready: boolean; ready: boolean; free_sets: number; waiting_sets: number; requests: number };
type Invoice = { id: string; store_id: string; store_name: string; invoice_no: string | null; invoice_date: string | null; sets: number; status: "pending" | "approved" | "rejected"; review_note: string | null; added: string | null; added_by: string };
type Schemes = { program: { title: string; live: boolean; starts_on: string | null; ends_on: string | null } | null; month: { key: string; label: string } | null; sell_more: SellRow[]; buy_more: BuyRow[]; invoices: Invoice[] };

const REWARD: Record<string, string> = { requested: "Asked for", approved: "Approved", sent: "Sent", delivered: "Delivered", rejected: "Declined" };
const INV: Record<Invoice["status"], string> = { pending: "bg-amber-50 text-amber-800", approved: "bg-emerald-50 text-emerald-800", rejected: "bg-red-50 text-red-700" };
const INV_LABEL: Record<Invoice["status"], string> = { pending: "Waiting", approved: "Approved", rejected: "Rejected" };

export function AsmSchemes() {
    const { toast } = useToast();
    const [d, setD] = useState<Schemes | null>(null);
    const [tab, setTab] = useState<"sell" | "buy" | "invoices">("buy");
    const [q, setQ] = useState("");
    const { open, page } = useStoreOpener();
    useEffect(() => {
        api.get("/asm-portal/schemes").then(r => {
            setD(r.data);
            if (r.data.sell_more?.length) setTab("sell");
        }).catch(e => { toast({ title: "Could not load the schemes", description: getErrorMessage(e, "Try again"), variant: "destructive" }); setD({ program: null, month: null, sell_more: [], buy_more: [], invoices: [] }); });
    }, [toast]);
    const match = (name: string, city: string | null) => !q.trim() || `${name} ${city ?? ""}`.toLowerCase().includes(q.trim().toLowerCase());
    const sell = useMemo(() => (d?.sell_more ?? []).filter(s => match(s.store_name, s.city)), [d, q]); // eslint-disable-line react-hooks/exhaustive-deps
    const buy = useMemo(() => (d?.buy_more ?? []).filter(s => match(s.store_name, s.city)).sort((a, b) => b.approved_sets - a.approved_sets || b.waiting_sets - a.waiting_sets || Number(b.ready) - Number(a.ready)), [d, q]); // eslint-disable-line react-hooks/exhaustive-deps
    const inv = useMemo(() => (d?.invoices ?? []).filter(s => match(s.store_name, null)), [d, q]); // eslint-disable-line react-hooks/exhaustive-deps
    if (page) return page;
    if (!d) return <Loading />;
    if (!d.program) return <p className="rounded-2xl border border-slate-100 bg-white px-4 py-10 text-center text-sm text-slate-500">No scheme is running for your stores.</p>;
    const reached = d.sell_more.filter(s => s.target && s.points >= s.target).length;
    const tiles = [
        { label: "Sell More stores", value: d.sell_more.length, sub: d.month ? `${reached} reached the ${d.month.label} target` : "" },
        { label: "Buy More stores", value: d.buy_more.length, sub: `${d.buy_more.filter(b => b.approved_sets > 0).length} with approved invoices` },
        { label: "Invoices waiting", value: d.invoices.filter(i => i.status === "pending").length, sub: "for head office to check" },
        { label: "Rewards ready", value: d.sell_more.filter(s => s.due_sets > 0).length + d.buy_more.filter(b => b.ready && !b.requests).length, sub: "not yet asked for" },
    ];
    return (
        <div className="space-y-5">
            <div className="rounded-2xl border border-orange-100 bg-gradient-to-r from-orange-50 to-white px-4 py-3">
                <p className="text-sm font-black text-slate-900">{d.program.title}</p>
                <p className="text-xs text-slate-500">{dateText(d.program.starts_on)} to {dateText(d.program.ends_on)} · {d.program.live ? "Running" : "Paused by head office"}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {tiles.map(t => (
                    <div key={t.label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                        <p className="text-2xl font-black tabular-nums text-slate-900">{fmt(t.value)}</p>
                        <p className="text-sm font-bold text-slate-600">{t.label}</p>
                        <p className="text-xs text-slate-400">{t.sub}</p>
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {([["sell", `Sell More (${d.sell_more.length})`], ["buy", `Buy More (${d.buy_more.length})`], ["invoices", `Invoices (${d.invoices.length})`]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", tab === k ? "bg-orange-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-orange-50")}>{l}</button>
                ))}
                <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store or city" className="h-9 pl-8" aria-label="Search store or city" /></div>
            </div>

            {tab === "sell" && (
                <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                    <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Option 1: the store earns points on warranties against a monthly target{d.month ? `; this is ${d.month.label}` : ""}.</p>
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Store</th><th className="px-3 py-2 text-right">Target</th><th className="px-3 py-2 text-right">Points</th><th className="px-3 py-2">Progress</th><th className="px-3 py-2">Reward</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                            {sell.map(s => {
                                const pct = s.target ? Math.min(100, Math.round((s.points / s.target) * 100)) : null;
                                return (
                                    <tr key={s.store_id}>
                                        <td className="px-4 py-2.5"><StoreLink id={s.store_id} name={s.store_name} onOpen={open} /><span className="block text-xs text-slate-400">{s.city}</span></td>
                                        <td className="px-3 py-2.5 text-right tabular-nums">{s.target ?? "—"}</td>
                                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmt(s.points)}</td>
                                        <td className="px-3 py-2.5 min-w-[140px]">
                                            {pct === null ? <span className="text-xs text-slate-400">No target set</span> : (
                                                <div className="flex items-center gap-2">
                                                    <div className="h-2 flex-1 rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Target progress"><div className="h-2 rounded-full bg-[#257de0]" style={{ width: `${pct}%` }} /></div>
                                                    <span className="w-9 text-right text-xs tabular-nums text-slate-600">{pct}%</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5 text-xs">{s.due_sets > 0 ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-800">{s.due_sets} set{s.due_sets === 1 ? "" : "s"} to claim</span> : s.reward ? `${REWARD[s.reward] ?? s.reward}${s.reward_sets ? ` · ${s.reward_sets} set${s.reward_sets === 1 ? "" : "s"}` : ""}` : <span className="text-slate-400">—</span>}</td>
                                    </tr>
                                );
                            })}
                            {!sell.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">None of your stores are in Sell More.</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}

            {tab === "buy" && (
                <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                    <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Option 2: seat-cover sets bought (approved invoices) count towards free sets. Offer 1 needs 12 sets.</p>
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Store</th><th className="px-3 py-2 text-right">Sets approved</th><th className="px-3 py-2 text-right">Waiting</th><th className="px-3 py-2">Towards Offer 1</th><th className="px-3 py-2 text-right">Free sets got</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                            {buy.map(s => (
                                <tr key={s.store_id}>
                                    <td className="px-4 py-2.5"><StoreLink id={s.store_id} name={s.store_name} onOpen={open} /><span className="block text-xs text-slate-400">{[s.city, s.distributors.join(", ")].filter(Boolean).join(" · ")}</span></td>
                                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmt(s.approved_sets)}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums">{s.waiting_sets ? fmt(s.waiting_sets) : "—"}</td>
                                    <td className="px-3 py-2.5 text-xs">{s.ready ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-800">{s.requests ? "Free set asked for" : "Free set ready"}</span> : s.offer1 ? `${s.offer1.have} of 12 · ${s.offer1.more} more` : "—"}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums">{s.free_sets || "—"}</td>
                                </tr>
                            ))}
                            {!buy.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">None of your stores are in Buy More.</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}

            {tab === "invoices" && (
                <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Store</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2 text-right">Sets</th><th className="px-3 py-2">Added by</th><th className="px-3 py-2">Status</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                            {inv.map(i => (
                                <tr key={i.id}>
                                    <td className="px-4 py-2.5"><StoreLink id={i.store_id} name={i.store_name} onOpen={open} /></td>
                                    <td className="px-3 py-2.5 text-xs">{i.invoice_no || "—"}<span className="block text-slate-400">{dateText(i.invoice_date)}</span></td>
                                    <td className="px-3 py-2.5 text-right tabular-nums">{i.sets}</td>
                                    <td className="px-3 py-2.5 text-xs">{i.added_by}<span className="block text-slate-400">{dateText(i.added)}</span></td>
                                    <td className="px-3 py-2.5 text-xs"><span className={cn("rounded px-1.5 py-0.5 font-bold", INV[i.status])}>{INV_LABEL[i.status]}</span>{i.status === "rejected" && i.review_note && <span className="mt-0.5 block text-slate-500">{i.review_note}</span>}</td>
                                </tr>
                            ))}
                            {!inv.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No invoices yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

/* ---------------- POSM ---------------- */

type PosmRow = {
    store_id: string; store_name: string; city: string | null; sent: Record<string, number>; items_sent: number;
    frp: { sent: number; limit: number | null; pending: number }; jacket: { sent: number; limit: number | null; pending: number };
    approval: "within" | "reached" | "over" | "new_open" | "new_used"; approval_label: string; plant_open: number; overdue: number; last_sent: string | null;
    low_sales: { frp: number; jackets: number; warranties: number } | null;
};
const LIMIT_TONE: Record<PosmRow["approval"], string> = { within: "bg-emerald-50 text-emerald-800", new_open: "bg-emerald-50 text-emerald-800", reached: "bg-amber-50 text-amber-800", new_used: "bg-amber-50 text-amber-800", over: "bg-red-50 text-red-700" };
const limitText = (x: { sent: number; limit: number | null; pending: number }) => `${x.sent}${x.limit !== null ? ` / ${x.limit}` : ""}${x.pending ? ` (+${x.pending} coming)` : ""}`;
/** Short limit labels for the table; the store page keeps the full sentence. */
const LIMIT_SHORT: Record<PosmRow["approval"], string> = { within: "Within limit", reached: "Limit reached", over: "Over limit", new_open: "New store", new_used: "New: request used" };

export function AsmPosm() {
    const { toast } = useToast();
    const [rows, setRows] = useState<PosmRow[] | null>(null);
    const [q, setQ] = useState("");
    const [only, setOnly] = useState<"all" | "coming" | "limit" | "low">("all");
    const { open, page } = useStoreOpener();
    useEffect(() => {
        api.get("/asm-portal/posm-sent").then(r => setRows(r.data.stores))
            .catch(e => { setRows([]); toast({ title: "Could not load the POSM", description: getErrorMessage(e, "Try again"), variant: "destructive" }); });
    }, [toast]);
    const list = useMemo(() => (rows ?? []).filter(r =>
        (!q.trim() || `${r.store_name} ${r.city ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
        && (only === "all" || (only === "coming" && r.plant_open > 0) || (only === "limit" && ["reached", "over", "new_used"].includes(r.approval)) || (only === "low" && r.low_sales))
    ).sort((a, b) => b.overdue - a.overdue || b.plant_open - a.plant_open || b.items_sent - a.items_sent), [rows, q, only]);
    if (page) return page;
    if (!rows) return <Loading />;
    const chips: [typeof only, string, number][] = [
        ["all", "All stores", rows.length],
        ["coming", "Coming from the plant", rows.filter(r => r.plant_open > 0).length],
        ["limit", "Limit reached / over", rows.filter(r => ["reached", "over", "new_used"].includes(r.approval)).length],
        ["low", "High POSM, low sales", rows.filter(r => r.low_sales).length],
    ];
    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-500">Material sent to your stores by the Noida office and the plant. FRP limit is 2 and Sample Jackets 20 for an old store; more needs head office approval.</p>
            <div className="flex flex-wrap items-center gap-2">
                {chips.map(([k, l, n]) => (
                    <button key={k} type="button" onClick={() => setOnly(k)} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", only === k ? "bg-orange-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-orange-50")}>{l} <span className="tabular-nums opacity-80">{n}</span></button>
                ))}
                <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store or city" className="h-9 pl-8" aria-label="Search store or city" /></div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Store</th><th className="px-3 py-2">FRP</th><th className="px-3 py-2">Jackets</th><th className="px-3 py-2">Limit</th><th className="px-3 py-2">From the plant</th><th className="px-3 py-2">Last sent</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                        {list.map(r => (
                            <tr key={r.store_id}>
                                <td className="px-4 py-2.5">
                                    <StoreLink id={r.store_id} name={r.store_name} onOpen={open} />
                                    <span className="block text-xs text-slate-400">{r.city}{r.items_sent ? ` · ${fmt(r.items_sent)} items in all` : " · nothing sent yet"}</span>
                                    {r.low_sales && <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-orange-50 px-1.5 py-0.5 text-[11px] font-semibold text-orange-800"><AlertTriangle className="h-3 w-3" />High POSM, low sales: {r.low_sales.warranties} warranties in 6 months</span>}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{limitText(r.frp)}</td>
                                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{limitText(r.jacket)}</td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-xs" title={r.approval_label}><span className={cn("rounded px-1.5 py-0.5 font-bold", LIMIT_TONE[r.approval])}>{LIMIT_SHORT[r.approval]}</span></td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-xs">{r.plant_open ? <>{r.plant_open} on the way{r.overdue > 0 && <span className="ml-1 font-bold text-red-700">· {r.overdue} late</span>}</> : <span className="text-slate-400">—</span>}</td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">{dateText(r.last_sent)}</td>
                            </tr>
                        ))}
                        {!list.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No stores here.</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ---------------- One store's POSM (on the store page) ---------------- */

type StoreLine = { id: string; from: string; item: string; qty: number; status: string; request_date: string | null; dispatch_date: string | null; expected_dispatch: string | null; reason: string | null };

export function AsmStorePosm({ storeId }: { storeId: string }) {
    const [d, setD] = useState<{ summary: PosmRow | null; lines: StoreLine[] } | null>(null);
    const [all, setAll] = useState(false);
    useEffect(() => { api.get(`/asm-portal/stores/${storeId}/posm-sent`).then(r => setD(r.data)).catch(() => setD({ summary: null, lines: [] })); }, [storeId]);
    if (!d) return null;
    const s = d.summary;
    const lines = all ? d.lines : d.lines.slice(0, 8);
    return (
        <section>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Package className="h-4 w-4 text-orange-500" />POSM sent</h3>
            {!d.lines.length ? <p className="mt-1 text-sm text-slate-500">Nothing sent to this store yet.</p> : (
                <>
                    {s && (
                        <p className="mt-1 text-sm text-slate-500 leading-relaxed">
                            FRP <span className="font-semibold text-slate-900 tabular-nums">{limitText(s.frp)}</span>, jackets <span className="font-semibold text-slate-900 tabular-nums">{limitText(s.jacket)}</span>.{" "}
                            <span className={cn("rounded px-1.5 py-0.5 text-xs font-bold", LIMIT_TONE[s.approval])}>{s.approval_label}</span>
                            {s.overdue > 0 && <span className="ml-2 text-xs font-bold text-red-700">{s.overdue} late from the plant</span>}
                        </p>
                    )}
                    <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">
                        {lines.map(l => (
                            <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 text-sm">
                                <span><span className="font-semibold text-slate-900">{l.item}</span> <span className="tabular-nums text-slate-600">× {l.qty}</span><span className="ml-2 text-xs text-slate-400">{l.from}</span></span>
                                <span className="text-xs text-slate-600">{l.status}{l.dispatch_date ? ` · ${dateText(l.dispatch_date)}` : l.expected_dispatch ? ` · expected ${dateText(l.expected_dispatch)}` : ""}{l.reason ? ` · ${l.reason}` : ""}</span>
                            </li>
                        ))}
                    </ul>
                    {d.lines.length > 8 && <button type="button" onClick={() => setAll(v => !v)} className="mt-2 inline-flex items-center text-xs font-semibold text-orange-600">{all ? "Show less" : `Show all ${d.lines.length}`}<ChevronRight className={cn("h-3 w-3", all && "rotate-90")} /></button>}
                </>
            )}
        </section>
    );
}
