import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { displayName } from "@/lib/asmStores";
import { STATUS_LABEL } from "@/lib/posm";
import { AsmStoreDetail } from "./AsmStoreDetail";
import { AsmRaisePosm } from "./AsmRaisePosm";
import { AsmRaiseGrievance } from "./AsmRaiseGrievance";
import { AsmPosm } from "./AsmInsights";

/**
 * POSM and complaints for all of the ASM's stores in one place: what each
 * store has asked for and where it stands, and raising a new POSM request or
 * complaint for any store — the same forms as on the store's own page.
 * A ticket's chat and remarks live on the store's page; a row opens it.
 */

type PickStore = { id: string; name: string; city: string | null; live: boolean };
const fmtDay = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const sentence = (v: string) => { const s = v.replace(/_/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); };
const raisedBy = (role: string, name: string | null) => (role === "admin" ? "Head office" : role === "asm" ? `${name || "ASM"} (you)` : role === "customer" ? "Customer" : "Store");
const Loading = () => <div className="flex items-center justify-center gap-3 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-orange-500" />Loading…</div>;
const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", on ? "bg-orange-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-orange-50")}>{children}</button>
);

function useStoreOpener() {
    const [openId, setOpenId] = useState<string | null>(null);
    const open = (id: string | null) => { setOpenId(id); document.getElementById("main-dashboard-content-area")?.scrollTo({ top: 0 }); };
    return { open, page: openId ? <AsmStoreDetail storeId={openId} onBack={() => open(null)} /> : null };
}

/** Pick which of the ASM's stores a new request or complaint is for. */
function StorePicker({ open, title, onClose, onPick }: { open: boolean; title: string; onClose: () => void; onPick: (s: PickStore) => void }) {
    const [stores, setStores] = useState<PickStore[] | null>(null);
    const [q, setQ] = useState("");
    useEffect(() => {
        if (!open || stores) return;
        api.get("/asm-portal/stores").then(r => setStores((r.data.stores ?? []).map((s: any) => ({
            id: String(s.vendor_details_id), name: displayName(String(s.store_name ?? "")), city: s.city ?? null, live: Boolean(s.is_verified && s.is_active),
        })).sort((a: PickStore, b: PickStore) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name)))).catch(() => setStores([]));
    }, [open, stores]);
    const list = useMemo(() => {
        const t = q.trim().toLowerCase();
        return (stores ?? []).filter(s => !t || `${s.name} ${s.city ?? ""}`.toLowerCase().includes(t));
    }, [stores, q]);
    return (
        <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); setQ(""); } }}>
            <DialogContent className="max-w-[calc(100%-1.5rem)] rounded-2xl sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-lg font-black">{title}</DialogTitle>
                    <DialogDescription>Which store is it for?</DialogDescription>
                </DialogHeader>
                <div className="relative"><Search className="absolute left-2.5 top-3 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store or city" className="h-10 pl-8" autoFocus aria-label="Search store or city" /></div>
                <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                    {!stores && <li className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></li>}
                    {list.map(s => (
                        <li key={s.id}>
                            <button type="button" onClick={() => { onPick(s); setQ(""); }} className="w-full px-3 py-2.5 text-left text-sm hover:bg-orange-50">
                                <span className="block font-semibold text-slate-900">{s.name}</span>
                                <span className="block text-xs text-slate-500">{[s.city, !s.live && "not live"].filter(Boolean).join(" · ")}</span>
                            </button>
                        </li>
                    ))}
                    {stores && !list.length && <li className="px-3 py-6 text-center text-sm text-slate-500">No store matches.</li>}
                </ul>
            </DialogContent>
        </Dialog>
    );
}

/* ---------------- POSM: sent to stores + requests ---------------- */

type Request = { id: number; ticket_id: string; status: string; urgent: boolean; urgent_by: string | null; what: string; created_by_role: string; created_by_name: string | null; created: string | null; updated: string | null; store_id: string; store_name: string; city: string | null };
const POSM_DONE = new Set(["delivered", "closed", "rejected"]);
const reqTone = (s: string) => (s === "rejected" ? "bg-red-50 text-red-700" : POSM_DONE.has(s) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800");

export function AsmPosmHub() {
    const [tab, setTab] = useState<"sent" | "requests">("sent");
    const [picking, setPicking] = useState(false);
    const [raiseFor, setRaiseFor] = useState<PickStore | null>(null);
    const [reload, setReload] = useState(0);
    return (
        <div className="space-y-4">
            {/* Tabs and the button stay on one line, a phone too: tighter padding and a shorter label below sm. */}
            <div className="flex items-center justify-between gap-2">
                <div className="inline-flex shrink-0 rounded-full bg-white p-1 ring-1 ring-slate-200" role="tablist">
                    {([["sent", "Sent to stores"], ["requests", "Requests"]] as const).map(([k, l]) => (
                        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                            className={cn("whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-semibold sm:px-4 sm:text-sm", tab === k ? "bg-orange-500 text-white" : "text-slate-600 hover:bg-orange-50")}>{l}</button>
                    ))}
                </div>
                <Button className="h-9 shrink-0 whitespace-nowrap rounded-full bg-orange-500 px-3 text-[13px] font-semibold shadow-sm hover:bg-orange-600 sm:px-4 sm:text-sm" onClick={() => setPicking(true)} aria-label="New POSM request">
                    <Plus className="mr-1 h-4 w-4" /><span className="sm:hidden">New request</span><span className="hidden sm:inline">New POSM request</span>
                </Button>
            </div>
            {tab === "sent" ? <AsmPosm /> : <PosmRequests reload={reload} />}
            <StorePicker open={picking} title="New POSM request" onClose={() => setPicking(false)} onPick={s => { setPicking(false); setRaiseFor(s); }} />
            {raiseFor && (
                <AsmRaisePosm storeId={raiseFor.id} storeName={raiseFor.name} open onOpenChange={o => { if (!o) setRaiseFor(null); }}
                    onRaised={() => { setRaiseFor(null); setTab("requests"); setReload(n => n + 1); }} />
            )}
        </div>
    );
}

function PosmRequests({ reload }: { reload: number }) {
    const { toast } = useToast();
    const [rows, setRows] = useState<Request[] | null>(null);
    const [only, setOnly] = useState<"open" | "all">("open");
    const [q, setQ] = useState("");
    const { open, page } = useStoreOpener();
    const load = useCallback(() => api.get("/asm-portal/posm-requests").then(r => setRows(r.data.requests))
        .catch(e => { setRows([]); toast({ title: "Could not load the requests", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }), [toast]);
    useEffect(() => { load(); }, [load, reload]);
    const [busy, setBusy] = useState<number | null>(null);
    /* Urgent: the plant makes it first. The ASM can mark any open request of their stores, the store's own ones too. */
    const setUrgent = async (r: Request, urgent: boolean) => {
        setBusy(r.id);
        try {
            await api.put(`/asm-portal/posm/${r.id}/urgent`, { urgent });
            toast({ title: urgent ? `${r.ticket_id} marked urgent` : `${r.ticket_id} no longer urgent`, description: urgent ? "The plant makes it first." : undefined });
            await load();
        } catch (e) {
            toast({ title: "Could not change it", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setBusy(null); }
    };
    const list = useMemo(() => (rows ?? []).filter(r => (only === "all" || !POSM_DONE.has(r.status))
        && (!q.trim() || `${r.ticket_id} ${r.store_name} ${r.city ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())))
        .sort((a, b) => Number(b.urgent && !POSM_DONE.has(b.status)) - Number(a.urgent && !POSM_DONE.has(a.status))), [rows, only, q]);
    if (page) return page;
    if (!rows) return <Loading />;
    const openCount = rows.filter(r => !POSM_DONE.has(r.status)).length;
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <Chip on={only === "open"} onClick={() => setOnly("open")}>Open ({openCount})</Chip>
                <Chip on={only === "all"} onClick={() => setOnly("all")}>All ({rows.length})</Chip>
                <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Ticket or store" className="h-9 pl-8" aria-label="Search ticket or store" /></div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Request</th><th className="px-3 py-2">Store</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Raised by</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Urgent</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                        {list.map(r => (
                            <tr key={r.id} className={cn("cursor-pointer align-top hover:bg-slate-50/60", r.urgent && !POSM_DONE.has(r.status) && "bg-red-50/40")} onClick={() => open(r.store_id)} title="Open the store to see the request and its chat">
                                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs font-semibold text-slate-900">{r.urgent && !POSM_DONE.has(r.status) && <span className="mb-0.5 block w-fit rounded bg-red-600 px-1 font-sans text-[10px] font-black uppercase text-white" title={r.urgent_by ? `Marked by ${r.urgent_by}` : undefined}>Urgent</span>}{r.ticket_id}<span className="block font-sans font-normal text-slate-400">{fmtDay(r.created)}</span></td>
                                <td className="px-3 py-2.5"><span className="font-semibold text-slate-900">{displayName(r.store_name)}</span>{r.city && <span className="block text-xs text-slate-400">{r.city}</span>}</td>
                                <td className="max-w-[320px] px-3 py-2.5 text-xs text-slate-700">{r.what || "—"}</td>
                                <td className="px-3 py-2.5 text-xs text-slate-600">{raisedBy(r.created_by_role, r.created_by_name)}</td>
                                <td className="px-3 py-2.5 text-xs"><span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 font-bold", reqTone(r.status))}>{STATUS_LABEL[r.status] ?? sentence(r.status)}</span></td>
                                <td className="px-3 py-2.5 text-xs" onClick={e => e.stopPropagation()}>
                                    {POSM_DONE.has(r.status) ? <span className="text-slate-300">—</span> : (
                                        <button type="button" disabled={busy === r.id} onClick={() => setUrgent(r, !r.urgent)}
                                            className={cn("whitespace-nowrap rounded-md border px-2 py-1 font-semibold disabled:opacity-50", r.urgent ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-red-200 text-red-700 hover:bg-red-50")}>
                                            {r.urgent ? "Not urgent" : "Mark urgent"}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {!list.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{rows.length ? "No open requests." : "None of your stores has asked for POSM on the portal yet."}</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ---------------- Complaints ---------------- */

type Complaint = { id: number; ticket_id: string; source_type: "customer" | "franchise"; category: string | null; sub_category: string | null; subject: string | null; status: string; priority: string | null; created_by_role: string; created_by_name: string | null; created: string | null; resolved: string | null; store_id: string; store_name: string; city: string | null };
const COMPLAINT_DONE = new Set(["resolved", "rejected", "closed"]);
const complaintTone = (s: string) => (s === "rejected" ? "bg-red-50 text-red-700" : COMPLAINT_DONE.has(s) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800");

export function AsmComplaints() {
    const { toast } = useToast();
    const [rows, setRows] = useState<Complaint[] | null>(null);
    const [only, setOnly] = useState<"open" | "all">("open");
    const [q, setQ] = useState("");
    const [picking, setPicking] = useState(false);
    const [raiseFor, setRaiseFor] = useState<PickStore | null>(null);
    const { open, page } = useStoreOpener();
    const load = useCallback(() => api.get("/asm-portal/grievances").then(r => setRows(r.data.grievances))
        .catch(e => { setRows([]); toast({ title: "Could not load the complaints", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }), [toast]);
    useEffect(() => { load(); }, [load]);
    const list = useMemo(() => (rows ?? []).filter(r => (only === "all" || !COMPLAINT_DONE.has(r.status))
        && (!q.trim() || `${r.ticket_id} ${r.store_name} ${r.subject ?? ""} ${r.category ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [rows, only, q]);
    if (page) return page;
    if (!rows) return <Loading />;
    const openCount = rows.filter(r => !COMPLAINT_DONE.has(r.status)).length;
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-slate-500">Complaints from your stores and their customers. Open one to read the remarks and reply.</p>
                <Button className="ml-auto bg-orange-500 hover:bg-orange-600" onClick={() => setPicking(true)}><Plus className="mr-1.5 h-4 w-4" />Raise a complaint</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Chip on={only === "open"} onClick={() => setOnly("open")}>Open ({openCount})</Chip>
                <Chip on={only === "all"} onClick={() => setOnly("all")}>All ({rows.length})</Chip>
                <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Ticket, store or subject" className="h-9 pl-8" aria-label="Search ticket, store or subject" /></div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Complaint</th><th className="px-3 py-2">Store</th><th className="px-3 py-2">About</th><th className="px-3 py-2">Raised by</th><th className="px-3 py-2">Status</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                        {list.map(r => (
                            <tr key={r.id} className="cursor-pointer align-top hover:bg-slate-50/60" onClick={() => open(r.store_id)} title="Open the store to see the complaint and its remarks">
                                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs font-semibold text-slate-900">{r.ticket_id}<span className="block font-sans font-normal text-slate-400">{fmtDay(r.created)}</span></td>
                                <td className="px-3 py-2.5"><span className="font-semibold text-slate-900">{displayName(r.store_name)}</span>{r.city && <span className="block text-xs text-slate-400">{r.city}</span>}</td>
                                <td className="max-w-[320px] px-3 py-2.5 text-xs text-slate-700">{r.subject || sentence(r.category ?? "Complaint")}{r.category && r.subject && <span className="block text-slate-400">{sentence(r.category)}{r.sub_category ? ` · ${sentence(r.sub_category)}` : ""}</span>}</td>
                                <td className="px-3 py-2.5 text-xs text-slate-600">{r.source_type === "customer" ? "Customer" : raisedBy(r.created_by_role, r.created_by_name)}</td>
                                <td className="px-3 py-2.5 text-xs"><span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 font-bold", complaintTone(r.status))}>{sentence(r.status)}</span>{r.resolved && <span className="mt-0.5 block text-slate-400">{fmtDay(r.resolved)}</span>}</td>
                            </tr>
                        ))}
                        {!list.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">{rows.length ? "No open complaints." : "No complaints from your stores."}</td></tr>}
                    </tbody>
                </table>
            </div>
            <StorePicker open={picking} title="Raise a complaint" onClose={() => setPicking(false)} onPick={s => { setPicking(false); setRaiseFor(s); }} />
            {raiseFor && (
                <AsmRaiseGrievance storeId={raiseFor.id} storeName={raiseFor.name} open onOpenChange={o => { if (!o) setRaiseFor(null); }}
                    onRaised={() => { setRaiseFor(null); setOnly("open"); load(); }} />
            )}
        </div>
    );
}
