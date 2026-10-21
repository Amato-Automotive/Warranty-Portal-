import { useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { formatToIST, cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ChevronLeft, Download, Loader2, Mail, MapPin, Paperclip, Plus, RefreshCw, Search, Send, Store, Truck, User, X } from "lucide-react";
import {
    STATUS_LABEL, STAGES, ACTIONS_AT, ACTION_LABEL, HISTORY_TEXT, BRAND_LABEL, decideLine,
    type Brand, type HistoryEntry, type PosmAction, type PosmItem, type PosmLimits, type PosmLine, type Usage,
} from "@/lib/posm";
import { POSMLines, POSMTracker } from "@/components/posm/POSMLines";
import { POSMShop, requestForm } from "@/components/posm/POSMShop";
import { POSMItemBuilder } from "./POSMItemBuilder";

interface POSMRequest {
    id: number;
    ticket_id: string;
    franchise_id: string;
    store_name: string;
    store_code?: string | null;
    store_address?: string | null;
    store_city?: string | null;
    store_state?: string | null;
    store_pincode?: string | null;
    contact_name: string;
    contact_email: string;
    requirement: string;
    created_by_role?: 'franchise' | 'admin' | 'asm';
    created_by_name?: string | null;
    status: string;
    internal_notes: string | null;
    created_at: string;
    updated_at: string;
    allowed_brands?: string | null;
    items?: PosmLine[] | null;
    dispatch?: { courier?: string; tracking?: string; date?: string | null } | null;
    delivery?: { by?: string; at?: string; photos?: string[] } | null;
    history?: HistoryEntry[] | null;
}

interface Message {
    id: number;
    sender_id: string;
    sender_role: 'admin' | 'franchise' | 'asm';
    sender_name?: string | null;
    message: string | null;
    attachments: string[] | null;
    created_at: string;
}

type Limit = PosmLimits & { used_month?: number; used_year?: number };

const STATUS_TONE: Record<string, string> = {
    open: "bg-blue-50 text-blue-700 border-blue-100", under_review: "bg-blue-50 text-blue-700 border-blue-100",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-100", in_production: "bg-amber-50 text-amber-700 border-amber-100",
    pending: "bg-amber-50 text-amber-700 border-amber-100", dispatched: "bg-orange-50 text-orange-700 border-orange-100",
    delivered: "bg-emerald-50 text-emerald-700 border-emerald-100", closed: "bg-slate-100 text-slate-600 border-slate-200",
    rejected: "bg-red-50 text-red-700 border-red-100",
};
const statusText = (s: string) => (s === "open" || s === "under_review" ? "To approve" : STATUS_LABEL[s] ?? s.replace("_", " "));
const StatusPill = ({ status }: { status: string }) => (
    <Badge variant="outline" className={cn("text-[10px] uppercase font-bold whitespace-nowrap", STATUS_TONE[status] || "bg-slate-100 text-slate-600")}>
        {statusText(status)}
    </Badge>
);
const brandsText = (b?: string | null) => {
    const v = String(b ?? "AF").toUpperCase();
    return v === "AFAC" ? "Autoform + Autocruze" : BRAND_LABEL[v as Brand] ?? v;
};
const itemsText = (r: POSMRequest) =>
    r.items?.length ? r.items.map(l => `${l.item_name} ×${l.line_status === 'rejected' ? 0 : (l.approved_qty ?? l.qty)}`).join(", ") : r.requirement;
const stageOf = (s: string) => STAGES.find(x => x.statuses.includes(s))?.key ?? "approve";

export const AdminPOSM = () => {
    const { toast } = useToast();
    const [page, setPage] = useState<'requests' | 'builder'>('requests');
    const [requests, setRequests] = useState<POSMRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [catalogItems, setCatalogItems] = useState<PosmItem[]>([]);

    // The queue
    const [stage, setStage] = useState("approve");
    const [searchQuery, setSearchQuery] = useState("");
    const [itemFilter, setItemFilter] = useState("all");
    const [stateFilter, setStateFilter] = useState("all");
    const [originFilter, setOriginFilter] = useState("all");

    // The ticket open
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [ticket, setTicket] = useState<POSMRequest | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [limits, setLimits] = useState<Record<string, Limit>>({});
    const [actions, setActions] = useState<PosmAction[]>([]);
    const [loadingTicket, setLoadingTicket] = useState(false);
    const [lines, setLines] = useState<PosmLine[]>([]);
    const [pending, setPending] = useState<PosmAction | null>(null);   // reject and dispatch open their small form first
    const [reason, setReason] = useState("");
    const [dispatch, setDispatch] = useState({ courier: "", tracking: "", date: "" });
    const [acting, setActing] = useState(false);
    const [notes, setNotes] = useState("");
    const [savingNotes, setSavingNotes] = useState(false);
    const [reply, setReply] = useState("");
    const [replyFiles, setReplyFiles] = useState<File[]>([]);
    const [sending, setSending] = useState(false);

    // Raising a request on a store's behalf
    const [onBehalfOpen, setOnBehalfOpen] = useState(false);
    const [franchises, setFranchises] = useState<{ id: string; store_name: string; store_code?: string | null; city?: string | null }[]>([]);
    const [franchiseSearch, setFranchiseSearch] = useState("");
    const [onBehalfFranchiseId, setOnBehalfFranchiseId] = useState<string | null>(null);
    const [onBehalfMode, setOnBehalfMode] = useState<'items' | 'text'>('items');
    const [onBehalfRequirement, setOnBehalfRequirement] = useState("");
    const [onBehalfFiles, setOnBehalfFiles] = useState<File[]>([]);
    const [creating, setCreating] = useState(false);
    const [storeShop, setStoreShop] = useState<{ items: PosmItem[]; brands: Brand[]; usage: Usage } | null>(null);
    const [ignoreLimits, setIgnoreLimits] = useState(false);

    /* quiet: a background refresh, with no spinner and no error toast. */
    const fetchRequests = async (quiet = false) => {
        if (!quiet) setLoading(true);
        try {
            const response = await api.get("/posm/admin/all");
            if (response.data.success) setRequests(response.data.data);
        } catch {
            if (!quiet) toast({ title: "Error", description: "Failed to fetch POSM requests", variant: "destructive" });
        } finally {
            if (!quiet) setLoading(false);
        }
    };

    const loadTicket = async (id: number) => {
        setLoadingTicket(true);
        try {
            const r = await api.get(`/posm/${id}`);
            const { messages: msgs, limits: lim, actions: acts, ...t } = r.data.data;
            setTicket(t); setMessages(msgs || []); setLimits(lim || {});
            setActions(acts || ACTIONS_AT[t.status] || []);
            setLines((t.items || []).map((l: PosmLine) => ({ ...l })));
            setNotes(t.internal_notes || "");
            setDispatch({ courier: t.dispatch?.courier || "", tracking: t.dispatch?.tracking || "", date: t.dispatch?.date || new Date().toISOString().slice(0, 10) });
        } catch (e) {
            toast({ title: "Could not open the request", description: getErrorMessage(e, ""), variant: "destructive" });
        } finally {
            setLoadingTicket(false);
        }
    };

    useEffect(() => { fetchRequests(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    /* New requests arrive while the page is open: refresh every 30 seconds and
       whenever the admin comes back to the tab. */
    useEffect(() => {
        const refresh = () => { if (document.visibilityState === "visible") fetchRequests(true); };
        const timer = window.setInterval(refresh, 30_000);
        document.addEventListener("visibilitychange", refresh);
        window.addEventListener("focus", refresh);
        return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (page !== 'requests') return;
        api.get("/posm/catalog").then(r => setCatalogItems(r.data.data.catalog.items || [])).catch(() => setCatalogItems([]));
    }, [page]);
    useEffect(() => {
        setPending(null); setReason(""); setReply(""); setReplyFiles([]);
        if (selectedId != null) loadTicket(selectedId); else setTicket(null);
    }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

    /* ---------- the queue ---------- */
    const states = useMemo(() => [...new Set(requests.map(r => (r.store_state || "").trim()).filter(Boolean))].sort(), [requests]);
    const matches = (r: POSMRequest) => {
        const q = searchQuery.trim().toLowerCase();
        if (q && ![r.ticket_id, r.store_name, r.store_code, r.store_city, r.contact_name, r.requirement].some(v => (v || "").toLowerCase().includes(q))) return false;
        if (itemFilter !== "all" && !(r.items || []).some(l => l.item_id === itemFilter)) return false;
        if (stateFilter !== "all" && (r.store_state || "").trim() !== stateFilter) return false;
        if (originFilter !== "all" && originFilter !== (r.created_by_role ?? "franchise")) return false;
        return true;
    };
    const filtered = requests.filter(matches);
    const counts = Object.fromEntries(STAGES.map(st => [st.key, filtered.filter(r => st.statuses.includes(r.status)).length]));
    // Oldest first while there is work to do; the most recent first once done.
    const queue = filtered.filter(r => stageOf(r.status) === stage)
        .sort((a, b) => stage === "done" ? b.updated_at.localeCompare(a.updated_at) : a.created_at.localeCompare(b.created_at));

    /* ---------- steps ---------- */
    /* Quantities can be set until dispatch: before approval they go with Approve,
       after it with Save quantities. */
    const editable = !!ticket && ["open", "under_review", "pending", "approved", "in_production"].includes(ticket.status) && lines.length > 0;
    const afterApproval = !!ticket && ["approved", "in_production"].includes(ticket.status);
    const linesChanged = !!ticket && JSON.stringify((ticket.items || []).map(l => [l.approved_qty ?? null, l.line_status ?? "pending"]))
        !== JSON.stringify(lines.map(l => [l.approved_qty ?? null, l.line_status ?? "pending"]));
    const [savingLines, setSavingLines] = useState(false);
    const saveLines = async () => {
        if (!ticket) return;
        setSavingLines(true);
        try {
            const r = await api.put(`/posm/${ticket.id}/status`, { decisions: lines.map((l, index) => ({ index, approved_qty: l.approved_qty ?? null, line_status: l.line_status ?? "pending" })) });
            toast({ title: "Quantities saved", description: `${ticket.store_name} is told in their notifications.` });
            setRequests(list => list.map(x => x.id === ticket.id ? { ...x, ...r.data.data } : x));
            loadTicket(ticket.id);
        } catch (e) {
            toast({ title: "Not saved", description: getErrorMessage(e, ""), variant: "destructive" });
        } finally {
            setSavingLines(false);
        }
    };
    const approvable = lines.filter(l => l.line_status !== "rejected" && (l.approved_qty ?? l.qty) > 0).length;

    const act = async (action: PosmAction) => {
        if (!ticket) return;
        if ((action === "reject" || action === "dispatch") && pending !== action) { setPending(action); return; }
        setActing(true);
        try {
            const body: Record<string, unknown> = { action };
            if (action === "approve" && lines.length) body.decisions = lines.map((l, index) => ({ index, approved_qty: l.approved_qty ?? null, line_status: l.line_status ?? "pending" }));
            if (action === "reject") body.reason = reason;
            if (action === "dispatch") body.dispatch = dispatch;
            const r = await api.post(`/posm/${ticket.id}/action`, body);
            const fresh = r.data.data;
            toast({ title: `${ticket.ticket_id}: ${r.data.message}`, description: `${ticket.store_name} is told in their notifications.` });
            setPending(null); setReason("");
            setRequests(list => list.map(x => x.id === ticket.id ? { ...x, ...fresh } : x));
            setStage(stageOf(fresh.status));
            loadTicket(ticket.id);
        } catch (e) {
            toast({ title: "Not done", description: getErrorMessage(e, "Try again."), variant: "destructive" });
        } finally {
            setActing(false);
        }
    };

    const saveNotes = async () => {
        if (!ticket) return;
        setSavingNotes(true);
        try {
            await api.put(`/posm/${ticket.id}/status`, { internalNotes: notes });
            setTicket(t => t ? { ...t, internal_notes: notes } : t);
            toast({ title: "Internal note saved" });
        } catch (e) {
            toast({ title: "Not saved", description: getErrorMessage(e, ""), variant: "destructive" });
        } finally {
            setSavingNotes(false);
        }
    };

    const saveDispatch = async () => {
        if (!ticket) return;
        try {
            await api.put(`/posm/${ticket.id}/status`, { dispatch });
            toast({ title: "Dispatch details saved" });
            loadTicket(ticket.id);
        } catch (e) {
            toast({ title: "Not saved", description: getErrorMessage(e, ""), variant: "destructive" });
        }
    };

    const sendReply = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!ticket || (!reply.trim() && !replyFiles.length)) return;
        setSending(true);
        try {
            const fd = new FormData();
            fd.append("message", reply.trim());
            replyFiles.forEach(f => fd.append("attachments", f));
            await api.post(`/posm/${ticket.id}/messages`, fd, { headers: { "Content-Type": "multipart/form-data" } });
            setReply(""); setReplyFiles([]);
            loadTicket(ticket.id);
        } catch (e) {
            toast({ title: "Message not sent", description: getErrorMessage(e, ""), variant: "destructive" });
        } finally {
            setSending(false);
        }
    };

    /* The timeline and the chat, in time order. Older requests have no
       timeline; their start is the day they were raised. */
    const feed = useMemo(() => {
        if (!ticket) return [];
        const steps = (ticket.history?.length ? ticket.history
            : [{ action: "sent", status: "open", at: ticket.created_at, by_role: ticket.created_by_role ?? "franchise" } as HistoryEntry])
            .map(h => ({ at: h.at, kind: "step" as const, h }));
        const msgs = messages.map(m => ({ at: m.created_at, kind: "msg" as const, m }));
        return [...steps, ...msgs].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    }, [ticket, messages]);

    /* ---------- export ---------- */
    const exportToCSV = () => {
        if (filtered.length === 0) {
            toast({ title: "No Data", description: "No POSM requests to export with current filters.", variant: "destructive" });
            return;
        }
        const headers = ["Date", "Ticket ID", "Franchise", "Store Code", "Address", "City", "State", "Pincode", "Contact Name", "Contact Email",
            "Requirement", "Status", "Raised By", "Raised By Name", "Items (asked / approved)", "Dispatch", "Last Update"];
        const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""').replace(/[\r\n]+/g, " ").trim()}"`;
        const csv = [headers.join(","), ...filtered.map(r => [
            cell(formatToIST(r.created_at)), cell(r.ticket_id), cell(r.store_name), cell(r.store_code), cell(r.store_address), cell(r.store_city),
            cell(r.store_state), cell(r.store_pincode), cell(r.contact_name), cell(r.contact_email), cell(r.requirement), cell(statusText(r.status)),
            cell(r.created_by_role === 'admin' ? 'Admin (on behalf)' : r.created_by_role === 'asm' ? 'ASM (on behalf)' : 'Franchise'), cell(r.created_by_name),
            cell((r.items || []).map(l => `${l.item_name} ${l.qty}/${l.line_status === 'rejected' ? 0 : (l.approved_qty ?? '-')}`).join('; ')),
            cell(r.dispatch?.courier ? [r.dispatch.courier, r.dispatch.tracking, r.dispatch.date].filter(Boolean).join(' ') : ''),
            cell(formatToIST(r.updated_at)),
        ].join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `posm_requests_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        toast({ title: "Exported", description: `${filtered.length} POSM requests exported to CSV.` });
    };

    /* ---------- raise for a store ---------- */
    const openOnBehalf = async () => {
        setOnBehalfOpen(true); setOnBehalfFranchiseId(null); setOnBehalfRequirement(""); setOnBehalfFiles([]);
        setFranchiseSearch(""); setOnBehalfMode('items'); setIgnoreLimits(false); setStoreShop(null);
        if (franchises.length > 0) return;
        try {
            const res = await api.get("/admin/vendors");
            const list = res.data.vendors || res.data.data || [];
            setFranchises(list.map((v: any) => ({ id: v.vendor_details_id ?? v.id, store_name: v.store_name, store_code: v.store_code, city: v.city }))
                .filter((v: any) => v.id && v.store_name));
        } catch (error) {
            toast({ title: "Could not load franchises", description: getErrorMessage(error, "Try reopening the form."), variant: "destructive" });
        }
    };
    useEffect(() => {
        setStoreShop(null);
        if (!onBehalfFranchiseId) return;
        api.get(`/posm/catalog?franchiseId=${encodeURIComponent(onBehalfFranchiseId)}`)
            .then(r => setStoreShop({ items: r.data.data.catalog.items || [], brands: r.data.data.brands || ['AF'], usage: r.data.data.usage || {} }))
            .catch(e => toast({ title: "Could not load the items", description: getErrorMessage(e, "Try again."), variant: "destructive" }));
    }, [onBehalfFranchiseId]); // eslint-disable-line react-hooks/exhaustive-deps

    const afterRaise = (requestId?: number) => {
        setOnBehalfOpen(false);
        fetchRequests();
        setStage("approve");
        if (requestId) setSelectedId(requestId);
    };
    const raiseItems = async (picked: Parameters<typeof requestForm>[0], note: string) => {
        if (!onBehalfFranchiseId) return false;
        try {
            const r = await api.post("/posm/admin/on-behalf/items",
                requestForm(picked, note, { franchiseId: onBehalfFranchiseId, ignore_limits: String(ignoreLimits) }),
                { headers: { "Content-Type": "multipart/form-data" } });
            toast({ title: `Request raised — ${r.data?.data?.ticketId ?? ""}`.trim(), description: r.data?.message });
            afterRaise(r.data?.data?.requestId);
            return true;
        } catch (error) {
            toast({ title: "Could not raise the request", description: getErrorMessage(error, "Failed to submit POSM request"), variant: "destructive" });
            return false;
        }
    };
    const raiseText = async () => {
        if (!onBehalfFranchiseId || !onBehalfRequirement.trim()) return;
        setCreating(true);
        try {
            const fd = new FormData();
            fd.append("franchiseId", onBehalfFranchiseId);
            fd.append("requirement", onBehalfRequirement);
            onBehalfFiles.forEach(file => fd.append("attachments", file));
            const r = await api.post("/posm/admin/on-behalf", fd, { headers: { "Content-Type": "multipart/form-data" } });
            toast({ title: `Request raised — ${r.data?.data?.ticketId ?? ""}`.trim(), description: r.data?.message });
            afterRaise(r.data?.data?.requestId);
        } catch (error) {
            toast({ title: "Could not raise the request", description: getErrorMessage(error, "Failed to submit POSM request"), variant: "destructive" });
        } finally {
            setCreating(false);
        }
    };
    const filteredFranchises = (() => {
        const q = franchiseSearch.trim().toLowerCase();
        const list = q ? franchises.filter(f => [f.store_name, f.store_code, f.city].some(v => (v || "").toLowerCase().includes(q))) : franchises;
        return list.slice(0, 40);
    })();
    const selectedFranchise = franchises.find(f => f.id === onBehalfFranchiseId) || null;

    /* ---------- page ---------- */
    const pageSwitch = (
        <div className="inline-flex rounded-2xl border border-orange-100 bg-white p-1 shadow-sm">
            {([['requests', 'Requests'], ['builder', 'Item builder']] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setPage(v)}
                    className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-colors", page === v ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800")}>
                    {label}
                </button>
            ))}
        </div>
    );
    if (page === 'builder') return <div className="space-y-6">{pageSwitch}<POSMItemBuilder /></div>;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                {pageSwitch}
                <div className="flex flex-wrap gap-2">
                    <Button onClick={openOnBehalf} className="rounded-xl gap-1.5 bg-orange-600 hover:bg-orange-700"><Plus className="h-4 w-4" /> Raise for a store</Button>
                    <Button variant="outline" onClick={exportToCSV} className="rounded-xl gap-1.5 border-orange-100"><Download className="h-4 w-4" /> Export</Button>
                    <Button variant="outline" size="icon" onClick={() => fetchRequests()} className="rounded-xl border-orange-100" aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
                </div>
            </div>

            {/* Stages */}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
                {STAGES.map(st => (
                    <button key={st.key} type="button" onClick={() => { setStage(st.key); setSelectedId(null); }}
                        className={cn("shrink-0 rounded-xl border px-3.5 py-2 text-sm font-bold transition-colors",
                            stage === st.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
                        {st.label}
                        <span className={cn("ml-1.5 tabular-nums", stage === st.key ? "text-white/70" : st.key === "approve" && counts[st.key] ? "text-orange-600" : "text-slate-400")}>{counts[st.key] ?? 0}</span>
                    </button>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input placeholder="Search store, ticket, city…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 h-10 rounded-xl bg-white" />
                </div>
                <Select value={itemFilter} onValueChange={setItemFilter}>
                    <SelectTrigger className="w-[160px] h-10 rounded-xl bg-white"><SelectValue placeholder="Item" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All items</SelectItem>{catalogItems.map(it => <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={stateFilter} onValueChange={setStateFilter}>
                    <SelectTrigger className="w-[150px] h-10 rounded-xl bg-white"><SelectValue placeholder="State" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All states</SelectItem>{states.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={originFilter} onValueChange={setOriginFilter}>
                    <SelectTrigger className="w-[160px] h-10 rounded-xl bg-white"><SelectValue placeholder="Raised by" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">Raised by anyone</SelectItem><SelectItem value="franchise">By the store</SelectItem><SelectItem value="asm">By ASM</SelectItem><SelectItem value="admin">By admin</SelectItem></SelectContent>
                </Select>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-4 items-start">
                {/* The queue */}
                <div className={cn("rounded-2xl border border-slate-100 bg-white overflow-hidden", selectedId != null && "hidden lg:block")}>
                    {loading ? (
                        <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
                    ) : queue.length === 0 ? (
                        <p className="p-8 text-center text-sm text-slate-400">Nothing in {STAGES.find(s => s.key === stage)?.label} right now.</p>
                    ) : (
                        <div className="divide-y divide-slate-50 max-h-[72vh] overflow-y-auto">
                            {queue.map(r => (
                                <button key={r.id} type="button" onClick={() => setSelectedId(r.id)}
                                    className={cn("w-full text-left p-4 space-y-1 hover:bg-slate-50", selectedId === r.id && "bg-orange-50/70 hover:bg-orange-50/70")}>
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="font-bold text-slate-800 leading-tight">{r.store_name}</p>
                                        <span className="text-[11px] text-slate-400 whitespace-nowrap">{formatToIST(r.created_at)}</span>
                                    </div>
                                    <p className="text-[11px] text-slate-400">
                                        {[r.store_city, r.store_state].filter(Boolean).join(" · ")} · <span className="font-mono">{r.ticket_id}</span>
                                        {r.created_by_role === 'admin' && <span className="ml-1 text-purple-600 font-semibold">· by admin</span>}
                                        {r.created_by_role === 'asm' && <span className="ml-1 text-sky-700 font-semibold">· by ASM</span>}
                                    </p>
                                    <p className="text-sm text-slate-600 line-clamp-2">{itemsText(r)}</p>
                                    {stage === "done" && <StatusPill status={r.status} />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* The ticket */}
                {selectedId == null ? (
                    <div className="hidden lg:grid rounded-2xl border border-dashed border-slate-200 bg-white/60 p-12 place-items-center text-center text-sm text-slate-400">
                        Pick a request from the list.
                    </div>
                ) : !ticket || (loadingTicket && ticket.id !== selectedId) ? (
                    <div className="rounded-2xl border border-slate-100 bg-white p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
                ) : (
                    <div className="rounded-2xl border border-slate-100 bg-white p-4 sm:p-5 space-y-5 min-w-0">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex items-start gap-2 min-w-0">
                                <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8 -ml-1" onClick={() => setSelectedId(null)} aria-label="Back to the list"><ChevronLeft className="h-5 w-5" /></Button>
                                <div className="min-w-0">
                                    <p className="text-xs font-mono text-slate-400">{ticket.ticket_id} · {formatToIST(ticket.created_at)}</p>
                                    <h2 className="text-xl font-black text-slate-800 leading-tight">{ticket.store_name}</h2>
                                    <p className="text-xs text-slate-500">
                                        {[ticket.store_city, ticket.store_state].filter(Boolean).join(", ")} · {brandsText(ticket.allowed_brands)}
                                        {ticket.created_by_role === 'admin' && <span className="text-purple-600"> · raised by {ticket.created_by_name || "an admin"}</span>}
                                        {ticket.created_by_role === 'asm' && <span className="text-sky-700"> · raised by {ticket.created_by_name || "the ASM"} (ASM)</span>}
                                    </p>
                                </div>
                            </div>
                            <StatusPill status={ticket.status} />
                        </div>

                        {/* The actions open at this stage */}
                        {actions.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex flex-wrap gap-2">
                                    {actions.map(a => {
                                        const primary = ["approve", "start", "dispatch", "resume", "deliver"].includes(a);
                                        const label = a === "approve" && lines.length ? `Approve ${approvable} item${approvable === 1 ? "" : "s"}` : ACTION_LABEL[a];
                                        return (
                                            <Button key={a} size="sm" disabled={acting || (a === "approve" && lines.length > 0 && approvable === 0)}
                                                onClick={() => act(a)} variant={primary ? "default" : "outline"}
                                                className={cn("rounded-xl", primary && (a === "approve" || a === "deliver" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-orange-600 hover:bg-orange-700"),
                                                    a === "reject" && "text-red-600 hover:text-red-700")}>
                                                {label}
                                            </Button>
                                        );
                                    })}
                                    {acting && <Loader2 className="h-4 w-4 animate-spin text-slate-400 self-center" />}
                                </div>
                                {pending === "reject" && (
                                    <div className="rounded-xl bg-red-50/70 border border-red-100 p-3 space-y-2">
                                        <label htmlFor="posm-reason" className="text-xs font-semibold text-red-800">Reason (the store sees it)</label>
                                        <Textarea id="posm-reason" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. The FRP limit for this month is reached" className="bg-white" />
                                        <div className="flex justify-end gap-2">
                                            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
                                            <Button size="sm" disabled={acting || reason.trim().length < 3} onClick={() => act("reject")} className="bg-red-600 hover:bg-red-700">Reject request</Button>
                                        </div>
                                    </div>
                                )}
                                {pending === "dispatch" && (
                                    <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-2">
                                        <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px] gap-2">
                                            <Input value={dispatch.courier} onChange={e => setDispatch(d => ({ ...d, courier: e.target.value }))} placeholder="Courier, by hand, distributor…" aria-label="How it is sent" className="bg-white" />
                                            <Input value={dispatch.tracking} onChange={e => setDispatch(d => ({ ...d, tracking: e.target.value }))} placeholder="Tracking / docket no." aria-label="Tracking number" className="bg-white" />
                                            <Input type="date" value={dispatch.date} onChange={e => setDispatch(d => ({ ...d, date: e.target.value }))} aria-label="Dispatch date" className="bg-white" />
                                        </div>
                                        <div className="flex justify-end gap-2">
                                            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
                                            <Button size="sm" disabled={acting || !dispatch.courier.trim()} onClick={() => act("dispatch")} className="bg-orange-600 hover:bg-orange-700">Mark dispatched</Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {ticket.items?.length ? <POSMTracker status={ticket.status} /> : null}

                        {/* Shipment */}
                        {ticket.dispatch?.courier && (
                            <div className="rounded-xl bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <Truck className="h-5 w-5 text-orange-500 shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Shipment</p>
                                        <p className="font-bold text-slate-800 break-words">{ticket.dispatch.courier}{ticket.dispatch.tracking ? ` · ${ticket.dispatch.tracking}` : ""}</p>
                                    </div>
                                </div>
                                <div className="text-right text-xs text-slate-500">
                                    {ticket.dispatch.date && <p>Dispatched {ticket.dispatch.date.split("-").reverse().join("/")}</p>}
                                    {ticket.delivery?.at && <p className="text-emerald-700 font-semibold">Delivered {formatToIST(ticket.delivery.at)} · {ticket.delivery.by === 'franchise' ? "confirmed by the store" : "marked by admin"}</p>}
                                </div>
                                {ticket.status === "dispatched" && (
                                    <details className="w-full">
                                        <summary className="text-xs text-slate-500 cursor-pointer">Correct the dispatch details</summary>
                                        <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px_auto] gap-2 mt-2">
                                            <Input value={dispatch.courier} onChange={e => setDispatch(d => ({ ...d, courier: e.target.value }))} aria-label="How it is sent" className="bg-white h-9" />
                                            <Input value={dispatch.tracking} onChange={e => setDispatch(d => ({ ...d, tracking: e.target.value }))} aria-label="Tracking number" className="bg-white h-9" />
                                            <Input type="date" value={dispatch.date} onChange={e => setDispatch(d => ({ ...d, date: e.target.value }))} aria-label="Dispatch date" className="bg-white h-9" />
                                            <Button size="sm" variant="outline" onClick={saveDispatch}>Save</Button>
                                        </div>
                                    </details>
                                )}
                            </div>
                        )}

                        {/* Items */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black text-slate-800">Items</h3>
                                {editable && !afterApproval && <span className="text-[11px] text-slate-400">Set what you'll send (0 = not approved), then Approve</span>}
                                {afterApproval && (
                                    <div className="flex items-center gap-2">
                                        {linesChanged && <Button size="sm" variant="ghost" onClick={() => setLines((ticket.items || []).map(l => ({ ...l })))}>Undo</Button>}
                                        <Button size="sm" variant="outline" disabled={!linesChanged || savingLines} onClick={saveLines}>
                                            {savingLines && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Save quantities
                                        </Button>
                                    </div>
                                )}
                            </div>
                            {lines.length ? (
                                <POSMLines lines={lines} items={catalogItems} limits={limits} disabled={acting}
                                    onDecide={editable ? (i, p) => setLines(ls => ls.map((l, j) => j === i ? decideLine(l, p) : l)) : undefined} />
                            ) : (
                                <p className="text-sm text-slate-600 whitespace-pre-wrap rounded-xl bg-slate-50 p-3">{ticket.requirement}</p>
                            )}
                        </div>

                        {/* Store */}
                        <div className="grid sm:grid-cols-3 gap-2 text-xs">
                            <p className="flex items-center gap-1.5 text-slate-600 min-w-0"><User className="h-3.5 w-3.5 text-slate-400 shrink-0" /><span className="truncate">{ticket.contact_name || "—"}</span></p>
                            <p className="flex items-center gap-1.5 text-slate-600 min-w-0"><Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" /><span className="truncate">{ticket.contact_email || "—"}</span></p>
                            <p className="flex items-center gap-1.5 text-slate-600 min-w-0"><MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" /><span className="truncate">{[ticket.store_address, ticket.store_pincode].filter(Boolean).join(", ") || "—"}</span></p>
                        </div>

                        {/* Timeline & messages */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-black text-slate-800">Timeline & messages</h3>
                            <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
                                {feed.map((f, i) => f.kind === "step" ? (
                                    <p key={`s${i}`} className="text-center text-[11px] font-semibold text-slate-400">
                                        {formatToIST(f.h.at)} · {HISTORY_TEXT[f.h.action] ?? f.h.action}
                                        {f.h.note ? ` · ${f.h.note}` : ""}
                                        {f.h.by_role === "admin" && f.h.by_name ? ` · ${f.h.by_name}` : f.h.by_role === "asm" ? ` · ${f.h.by_name || "ASM"} (ASM)` : f.h.by_role === "franchise" ? " · by the store" : ""}
                                    </p>
                                ) : (
                                    <div key={`m${f.m.id}`} className={cn("flex flex-col max-w-[85%]", f.m.sender_role === "admin" ? "ml-auto items-end" : "mr-auto items-start")}>
                                        <div className={cn("px-3 py-2 rounded-2xl text-sm", f.m.sender_role === "admin" ? "bg-slate-900 text-white rounded-br-md" : f.m.sender_role === "asm" ? "bg-sky-50 text-slate-800 rounded-bl-md" : "bg-slate-100 text-slate-800 rounded-bl-md")}>
                                            {f.m.message && <p className="whitespace-pre-wrap">{f.m.message}</p>}
                                            {f.m.attachments?.length ? (
                                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                                    {f.m.attachments.map((url, k) => (
                                                        <a key={k} href={url} target="_blank" rel="noopener noreferrer"
                                                            className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold", f.m.sender_role === "admin" ? "bg-white/15 text-white" : "bg-white text-slate-600")}>
                                                            <Paperclip className="h-3 w-3" /> File {k + 1}
                                                        </a>
                                                    ))}
                                                </div>
                                            ) : null}
                                        </div>
                                        <span className="text-[10px] text-slate-400 mt-0.5">{f.m.sender_role === "admin" ? "Autoform team" : f.m.sender_role === "asm" ? `${f.m.sender_name || "ASM"} (ASM)` : ticket.store_name} · {formatToIST(f.m.created_at)}</span>
                                    </div>
                                ))}
                            </div>
                            <form onSubmit={sendReply} className="space-y-2">
                                {replyFiles.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {replyFiles.map((f, i) => (
                                            <Badge key={i} variant="secondary" className="pr-1 gap-1 bg-orange-50 text-orange-700 border-orange-100">
                                                <span className="truncate max-w-[150px]">{f.name}</span>
                                                <X className="h-3 w-3 cursor-pointer" onClick={() => setReplyFiles(p => p.filter((_, j) => j !== i))} />
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                                <div className="flex items-center gap-2">
                                    <input id="admin-posm-file" type="file" multiple className="hidden"
                                        onChange={e => { const fl = e.target.files; if (fl) setReplyFiles(p => [...p, ...Array.from(fl)].slice(0, 5)); e.target.value = ""; }} />
                                    <label htmlFor="admin-posm-file" className="p-2 text-slate-400 hover:text-orange-500 cursor-pointer" aria-label="Attach a file"><Paperclip className="h-5 w-5" /></label>
                                    <Input value={reply} onChange={e => setReply(e.target.value)} placeholder={`Write to ${ticket.store_name}…`} className="rounded-xl" aria-label="Message to the store" />
                                    <Button type="submit" size="icon" disabled={sending || (!reply.trim() && !replyFiles.length)} className="rounded-xl bg-orange-500 hover:bg-orange-600 shrink-0" aria-label="Send">
                                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </form>
                        </div>

                        {/* Internal note */}
                        <div className="space-y-1.5 rounded-xl bg-amber-50/50 border border-amber-100 p-3">
                            <label htmlFor="posm-notes" className="text-xs font-bold text-amber-900">Internal note · only admins see it</label>
                            <div className="flex gap-2">
                                <Textarea id="posm-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. FRP from the Noida warehouse" className="bg-white text-sm" />
                                <Button size="sm" variant="outline" disabled={savingNotes || notes === (ticket.internal_notes || "")} onClick={saveNotes} className="self-end">
                                    {savingNotes ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Raise a request on a store's behalf */}
            <Dialog open={onBehalfOpen} onOpenChange={(v) => { if (!v && !creating) setOnBehalfOpen(false); }}>
                <DialogContent className={cn("max-h-[92vh] flex flex-col p-0 gap-0", selectedFranchise && onBehalfMode === 'items' ? "max-w-6xl" : "max-w-xl")}>
                    <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
                        <DialogTitle className="text-base flex items-center gap-2"><Store className="h-4 w-4 text-orange-500" /> Raise a POSM request for a store</DialogTitle>
                        <DialogDescription className="text-xs">For requirements received by phone or email. Pick the store, then its items as the store would.</DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Store</p>
                            {selectedFranchise ? (
                                <div className="flex items-center justify-between p-3 rounded-xl border border-orange-200 bg-orange-50">
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-slate-800 truncate">{selectedFranchise.store_name}</p>
                                        <p className="text-[11px] text-slate-500">{[selectedFranchise.store_code, selectedFranchise.city].filter(Boolean).join(" · ")}</p>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => setOnBehalfFranchiseId(null)} className="text-xs shrink-0">Change</Button>
                                </div>
                            ) : (
                                <>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                                        <Input autoFocus placeholder="Search by name, code or city..." className="pl-9 h-9 text-sm" value={franchiseSearch} onChange={(e) => setFranchiseSearch(e.target.value)} />
                                    </div>
                                    <div className="mt-2 max-h-56 overflow-y-auto space-y-1">
                                        {filteredFranchises.map(f => (
                                            <button key={f.id} onClick={() => setOnBehalfFranchiseId(f.id)}
                                                className="w-full text-left p-2.5 rounded-lg border border-slate-100 hover:border-orange-200 hover:bg-orange-50/50 transition-colors">
                                                <p className="text-sm font-semibold text-slate-700 truncate">{f.store_name}</p>
                                                <p className="text-[11px] text-slate-400">{[f.store_code, f.city].filter(Boolean).join(" · ")}</p>
                                            </button>
                                        ))}
                                        {filteredFranchises.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No store matches that search.</p>}
                                    </div>
                                </>
                            )}
                        </div>

                        {selectedFranchise && (
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="inline-flex rounded-xl border border-slate-200 p-1 bg-white">
                                    {([['items', 'Pick items'], ['text', 'Free text']] as const).map(([m, label]) => (
                                        <button key={m} type="button" onClick={() => setOnBehalfMode(m)}
                                            className={cn("px-3 py-1.5 rounded-lg text-xs font-bold", onBehalfMode === m ? "bg-slate-900 text-white" : "text-slate-500")}>{label}</button>
                                    ))}
                                </div>
                                {onBehalfMode === 'items' && (
                                    <label className="flex items-center gap-2 text-xs text-slate-600">
                                        <Switch checked={ignoreLimits} onCheckedChange={setIgnoreLimits} aria-label="Ignore item limits" /> Ignore the item limits for this request
                                    </label>
                                )}
                            </div>
                        )}

                        {selectedFranchise && onBehalfMode === 'items' && (
                            storeShop
                                ? <POSMShop key={selectedFranchise.id} items={storeShop.items} brands={storeShop.brands} usage={storeShop.usage}
                                    ignoreLimits={ignoreLimits} onSend={raiseItems} sendLabel="Raise request" forStore={selectedFranchise.store_name} />
                                : <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
                        )}

                        {selectedFranchise && onBehalfMode === 'text' && (
                            <>
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Requirement</p>
                                    <Textarea value={onBehalfRequirement} onChange={(e) => setOnBehalfRequirement(e.target.value)}
                                        placeholder="What the store asked for - material, size, quantity, where it goes..." rows={5} className="text-sm resize-none" />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Attachments <span className="font-medium normal-case tracking-normal">(optional, up to 5)</span></p>
                                    <input type="file" id="posm-on-behalf-file" multiple className="hidden"
                                        onChange={(e) => { if (e.target.files) setOnBehalfFiles(prev => [...prev, ...Array.from(e.target.files!)].slice(0, 5)); e.target.value = ""; }} />
                                    <label htmlFor="posm-on-behalf-file" className="border-2 border-dashed border-slate-100 rounded-xl p-5 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 hover:border-orange-200 transition-all text-slate-400 hover:text-orange-500">
                                        <Paperclip className="h-6 w-6 mb-1.5" /><span className="text-xs font-medium">Click to attach files</span>
                                    </label>
                                    {onBehalfFiles.length > 0 && (
                                        <div className="mt-2 space-y-1">
                                            {onBehalfFiles.map((file, i) => (
                                                <div key={i} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                                                    <span className="truncate text-slate-600">{file.name}</span>
                                                    <button onClick={() => setOnBehalfFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500 shrink-0 ml-2" aria-label={`Remove ${file.name}`}><X className="h-3.5 w-3.5" /></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                    <DialogFooter className="px-6 py-4 border-t border-slate-100 shrink-0">
                        <Button variant="outline" onClick={() => setOnBehalfOpen(false)} disabled={creating}>Close</Button>
                        {onBehalfMode === 'text' && (
                            <Button onClick={raiseText} disabled={!onBehalfFranchiseId || !onBehalfRequirement.trim() || creating} className="bg-orange-600 hover:bg-orange-700">
                                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />} Raise request
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
