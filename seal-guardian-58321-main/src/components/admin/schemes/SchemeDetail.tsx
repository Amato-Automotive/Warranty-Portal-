import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadCSV } from "@/lib/utils";
import { Combobox } from "@/components/ui/combobox";
import { ClubBadge } from "@/components/schemes/ClubBadge";
import { AddEntryDialog } from "./AddEntryDialog";
import { CorrectEntryDialog } from "./CorrectEntryDialog";
import { ImportDialog } from "./ImportDialog";
import { SellThroughTab } from "./SellThroughTab";
import { SchemeOverview } from "./SchemeOverview";
import { ReviewQueue, type InvoiceOut } from "./ReviewQueue";
import { type AdminEntry as Entry, type AdminDetail as Detail, stateKey, stateLabel, istDay } from "./adminTypes";
import { cn } from "@/lib/utils";
import { ArrowLeft, Check, X, Download, Loader2, Paperclip, Pencil, Send, Ban, Copy as CopyIcon, Plus, Trash2, Search, RefreshCw, FileSpreadsheet, FilePlus2, CalendarDays, Gift, ChevronRight } from "lucide-react";
import {
    CATEGORY_LABEL, STATE_META, ENTRY_META, rewardSummary, formatWindow, formatDay, formatMonth,
    type Scheme,
} from "@/lib/schemes";

/**
 * One scheme, as the admin runs it: entries to review, the leaderboard and
 * payouts, who joined, and hand adjustments.
 */

const matches = (q: string, ...vals: (string | null | undefined)[]) => {
    const n = q.trim().toLowerCase();
    return !n || vals.some(v => String(v ?? "").toLowerCase().includes(n));
};

/** One row of filters: a search box, then whatever selects and inputs a tab needs. */
function FilterBar({ q, onQ, placeholder, children, shown, total, onClear, active }: {
    q: string; onQ: (v: string) => void; placeholder: string; children?: React.ReactNode;
    shown: number; total: number; onClear: () => void; active: boolean;
}) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input value={q} onChange={e => onQ(e.target.value)} placeholder={placeholder} className="pl-8 h-9" aria-label="Search" />
                </div>
                {children}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Showing <b className="text-slate-700 tabular-nums">{shown}</b> of <span className="tabular-nums">{total}</span></span>
                {active && <button type="button" onClick={onClear} className="font-semibold text-orange-600 hover:underline">Clear filters</button>}
            </div>
        </div>
    );
}

const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function SchemeDetail({ id, onBack, onEdit, onChanged, startOnReview = false }: {
    id: string; onBack: () => void; onEdit: (s: Scheme) => void; onChanged: () => void; startOnReview?: boolean;
}) {
    const { toast } = useToast();
    const [data, setData] = useState<Detail | null>(null);
    const [tab, setTab] = useState<"overview" | "entries" | "leaderboard" | "participants" | "adjustments" | "sellthrough">(startOnReview ? "entries" : "overview");
    const [entryFilter, setEntryFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
    const [busy, setBusy] = useState<string | null>(null);
    const [scoreEdit, setScoreEdit] = useState<Record<string, string>>({});
    const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);
    /* Approving a products scheme: the lines read off the invoice. */
    const [adjust, setAdjust] = useState({ store_id: "", points: "", note: "" });
    const [confirmEnd, setConfirmEnd] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [correcting, setCorrecting] = useState<Entry | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [ef, setEf] = useState({ q: "", store: "all", state: "all", from: "", to: "", minPts: "", maxPts: "", product: "all" });
    /* The entries list by day (all stores together) or by store, each store's days inside it. */
    const [groupBy, setGroupBy] = useState<"day" | "store">("day");
    const [openStores, setOpenStores] = useState<Set<string>>(new Set());
    /* An entry sent to the review queue from the table opens there first. */
    const [queueStart, setQueueStart] = useState<string | null>(null);
    const [lf, setLf] = useState({ q: "", store: "all", state: "all", club: "all", reward: "all", paid: "all", minScore: "", sort: "rank" });
    const [pf, setPf] = useState({ q: "", store: "all", state: "all", entries: "all" });

    const load = useCallback(() => {
        return api.get(`/schemes/admin/${id}`)
            .then(r => setData(r.data))
            .catch(e => toast({ title: "Could not load the scheme", description: getErrorMessage(e, "Try again"), variant: "destructive" }));
    }, [id, toast]);
    useEffect(() => { load(); }, [load]);

    const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
        setBusy(key);
        try { await fn(); toast({ title: done }); load(); onChanged(); }
        catch (e) { toast({ title: "That didn't work", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }
        finally { setBusy(null); }
    };

    /* Every state that appears in this scheme, for the state filters. */
    const stateOptions = useMemo(() => {
        const keys = new Set<string>();
        for (const x of [...(data?.entries ?? []), ...(data?.leaderboard ?? []), ...(data?.participants ?? [])]) {
            const k = stateKey(x.state);
            if (k) keys.add(k);
        }
        return [...keys].sort();
    }, [data]);

    const storeOptions = useMemo(() => {
        const m = new Map<string, string>();
        for (const x of [...(data?.participants ?? []), ...(data?.leaderboard ?? []), ...(data?.entries ?? [])]) {
            if (!m.has(x.store_id)) m.set(x.store_id, [x.store_name, x.city].filter(Boolean).join(" · "));
        }
        return [{ value: "all", label: "All stores" },
            ...[...m].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
    }, [data]);

    const entries = useMemo(() => (data?.entries ?? []).filter(e => {
        if (entryFilter !== "all" && e.status !== entryFilter) return false;
        if (ef.store !== "all" && e.store_id !== ef.store) return false;
        if (!matches(ef.q, e.store_name, e.city, e.state, ...Object.values(e.answers))) return false;
        if (ef.state !== "all" && stateKey(e.state) !== ef.state) return false;
        const day = istDay(e.created_at);
        if (ef.from && day < ef.from) return false;
        if (ef.to && day > ef.to) return false;
        if (ef.minPts !== "" && e.score < Number(ef.minPts)) return false;
        if (ef.maxPts !== "" && e.score > Number(ef.maxPts)) return false;
        if (ef.product !== "all" && !(e.lines ?? []).some(l => l.product_id === ef.product)) return false;
        return true;
    }), [data, entryFilter, ef]);

    /* Every month any store has points in, for the month columns. */
    const boardMonths = useMemo(() => [...new Set((data?.leaderboard ?? []).flatMap(r => r.months.map(m => m.month)))].sort(), [data]);
    const board = useMemo(() => {
        const rows = (data?.leaderboard ?? []).filter(r => {
            if (lf.store !== "all" && r.store_id !== lf.store) return false;
            if (lf.club !== "all" && (r.club?.id ?? "none") !== lf.club) return false;
            if (!matches(lf.q, r.store_name, r.city, r.state)) return false;
            if (lf.state !== "all" && stateKey(r.state) !== lf.state) return false;
            if (lf.reward === "earned" && !r.reward) return false;
            if (lf.reward === "none" && r.reward) return false;
            if (lf.paid === "paid" && !r.paid_at) return false;
            if (lf.paid === "unpaid" && (!r.reward || r.paid_at)) return false;
            if (lf.minScore !== "" && r.score < Number(lf.minScore)) return false;
            return true;
        });
        if (lf.sort === "name") rows.sort((a, b) => a.store_name.localeCompare(b.store_name));
        if (lf.sort === "approved") rows.sort((a, b) => b.approved - a.approved || a.rank - b.rank);
        return rows;
    }, [data, lf]);

    const entryCount = useMemo(() => {
        const m = new Map<string, number>();
        for (const e of data?.entries ?? []) m.set(e.store_id, (m.get(e.store_id) ?? 0) + 1);
        return m;
    }, [data]);
    const joined = useMemo(() => (data?.participants ?? []).filter(p => {
        if (pf.store !== "all" && p.store_id !== pf.store) return false;
        if (!matches(pf.q, p.store_name, p.city, p.state)) return false;
        if (pf.state !== "all" && stateKey(p.state) !== pf.state) return false;
        const n = entryCount.get(p.store_id) ?? 0;
        if (pf.entries === "with" && !n) return false;
        if (pf.entries === "without" && n) return false;
        return true;
    }), [data, pf, entryCount]);
    /* Entries by the IST day they were sent, newest day first — a store can send
       several on one day, and they are reviewed day by day. */
    const byDay = useMemo(() => {
        const groups = new Map<string, Entry[]>();
        for (const e of entries) {
            const day = new Date(new Date(e.created_at).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
            groups.set(day, [...(groups.get(day) ?? []), e]);
        }
        return [...groups].sort((a, b) => b[0].localeCompare(a[0])).map(([day, items]) => ({
            day, items,
            pending: items.filter(e => e.status === "pending").length,
            stores: new Set(items.map(e => e.store_id)).size,
        }));
    }, [entries]);
    /* Entries by store (most to review first, then by name), and each store's by day, newest first. */
    const byStore = useMemo(() => {
        const stores = new Map<string, Entry[]>();
        for (const e of entries) stores.set(e.store_id, [...(stores.get(e.store_id) ?? []), e]);
        return [...stores].map(([store_id, items]) => {
            const days = new Map<string, Entry[]>();
            for (const e of items) days.set(istDay(e.created_at), [...(days.get(istDay(e.created_at)) ?? []), e]);
            return {
                store_id, store_name: items[0].store_name, place: [items[0].city, items[0].state].filter(Boolean).join(", "),
                count: items.length,
                pending: items.filter(e => e.status === "pending").length,
                points: items.filter(e => e.status === "approved").reduce((n, e) => n + e.score, 0),
                days: [...days].sort((a, b) => b[0].localeCompare(a[0])).map(([day, list]) => ({ day, items: list })),
            };
        }).sort((a, b) => b.pending - a.pending || a.store_name.localeCompare(b.store_name));
    }, [entries]);
    const toggleStore = (id: string) => setOpenStores(m => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    if (!data) {
        return <div className="flex items-center justify-center min-h-[300px] gap-2 text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /> Loading…</div>;
    }
    const s = data.scheme;
    const hasScore = s.score_rule.mode !== "none";
    const pending = data.entries.filter(e => e.status === "pending").length;
    const fieldLabel = (fid: string) => s.fields.find(f => f.id === fid)?.label ?? fid;

    const products = s.score_rule.mode === "products" ? s.score_rule.products : [];
    const review = (e: Entry, status: "approved" | "rejected", note?: string, lines?: { product_id: string; qty: number }[]) =>
        act(e.id, () => api.put(`/schemes/admin/entries/${e.id}`, {
            status, note,
            ...(lines ? { lines } : {}),
            ...(status === "approved" && !lines && scoreEdit[e.id] !== undefined ? { score: scoreEdit[e.id] } : {}),
        }), status === "approved" ? "Entry approved" : "Entry rejected");
    const reviewFromQueue = (e: Entry, status: "approved" | "rejected", o: { note?: string; lines?: { product_id: string; qty: number }[]; score?: string; invoice_no?: string; invoices?: InvoiceOut[] }) =>
        act(e.id, () => api.put(`/schemes/admin/entries/${e.id}`, {
            status, note: o.note, ...(o.lines ? { lines: o.lines } : {}), ...(status === "approved" && o.score !== undefined ? { score: o.score } : {}),
            ...(o.invoice_no !== undefined ? { invoice_no: o.invoice_no } : {}),
            ...(o.invoices ? { invoices: o.invoices } : {}),
        }), status === "approved" ? "Entry approved" : "Entry rejected");

    const exportBoard = () => downloadCSV(board.map(r => ({
        Rank: r.rank, Store: r.store_name, City: r.city ?? "", State: r.state ?? "",
        Score: r.score, Club: r.club?.name ?? "",
        ...Object.fromEntries(boardMonths.map(m => [formatMonth(m), r.months.find(x => x.month === m)?.points ?? 0])),
        "Approved entries": r.approved, Reward: r.reward ?? "", Paid: r.paid_at ? "Yes" : "No",
        Delivery: r.delivery === "delivered" ? "Delivered" : r.delivery === "dispatched" ? "Dispatched" : "",
    })), `${s.title.replace(/[^a-z0-9]+/gi, "-")}-leaderboard.csv`);

    const exportEntries = () => downloadCSV(entries.map(e => ({
        Date: when(e.created_at), Store: e.store_name, City: e.city ?? "", State: e.state ?? "",
        Source: e.source === "import" ? "Imported" : e.source === "admin" ? "Added by admin" : "Store", "Invoice no": e.invoice_no ?? "",
        Status: ENTRY_META[e.status].label, Score: e.score,
        ...Object.fromEntries(s.fields.filter(f => f.type !== "file").map(f => [f.label, e.answers[f.id] ?? ""])),
        ...Object.fromEntries(s.fields.filter(f => f.type === "file").map(f => [f.label, (e.files[f.id] ?? []).map(x => x.url).join(" ")])),
        Products: (e.lines ?? []).map(l => `${l.name} x ${l.qty}`).join("; "),
        Note: e.review_note ?? "",
    })), `${s.title.replace(/[^a-z0-9]+/gi, "-")}-entries.csv`);

    /** One entry as a table row; used by both groupings. */
    const entryRow = (e: Entry) => (
                                            <tr key={e.id} className="align-top">
                                                <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">{when(e.created_at)}</td>
                                                <td className="px-3 py-3">
                                                    <div className="font-semibold text-slate-800">{e.store_name}</div>
                                                    <div className="text-xs text-slate-400">{[e.city, e.state].filter(Boolean).join(", ")}</div>
                                                </td>
                                                <td className="px-3 py-3 text-xs text-slate-700 space-y-1">
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        {e.source !== "store" && <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">{e.source === "import" ? "Imported" : "Added by admin"}</span>}
                                                        {e.invoice_no && <span className="text-slate-500">Invoice {e.invoice_no}</span>}
                                                        {!!e.edits?.length && (
                                                            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700"
                                                                title={e.edits.map(ed => `${new Date(ed.at).toLocaleDateString("en-GB")} ${ed.by_name ?? ""}: ${ed.changes.join("; ")}`).join("\n")}>
                                                                Corrected{e.edits.length > 1 ? ` ×${e.edits.length}` : ""}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {e.status === "pending" && (e.claimed_lines ?? []).length > 0 && (
                                                        <div className="rounded-md bg-sky-50 border border-sky-100 px-2 py-1">
                                                            <span className="text-sky-700 font-semibold">Store says: </span>
                                                            {(e.claimed_lines ?? []).map(l => `${l.name} × ${l.qty}`).join(", ")}
                                                            <span className="text-sky-700"> = {e.score} pts</span>
                                                        </div>
                                                    )}
                                                    {s.fields.filter(f => f.type !== "file" && e.answers[f.id]).map(f => (
                                                        <div key={f.id}><span className="text-slate-400">{f.label}:</span> {e.answers[f.id]}</div>
                                                    ))}
                                                    {Object.entries(e.files).map(([fid, list]) => (
                                                        <div key={fid} className="flex flex-wrap items-center gap-1.5">
                                                            <span className="text-slate-400">{fieldLabel(fid)}:</span>
                                                            {list.map(f => (
                                                                <a key={f.url} href={f.url} target="_blank" rel="noreferrer"
                                                                    className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-sky-700 hover:bg-sky-50">
                                                                    <Paperclip className="h-3 w-3" />{f.name}
                                                                </a>
                                                            ))}
                                                        </div>
                                                    ))}
                                                </td>
                                                {hasScore && (
                                                    <td className="px-3 py-3">
                                                        {products.length ? (
                                                            e.status === "approved" ? (
                                                                <div className="text-xs space-y-0.5">
                                                                    {(e.invoices ?? []).length > 1
                                                                        ? (e.invoices ?? []).map((inv, k) => <div key={k} className="whitespace-nowrap"><span className="text-slate-400">#{inv.invoice_no}</span> = <b>{inv.points}</b></div>)
                                                                        : (e.lines ?? []).map(l => <div key={l.product_id} className="whitespace-nowrap">{l.name} × {l.qty} = <b>{l.subtotal}</b></div>)}
                                                                    <div className="font-bold text-slate-800">Total {e.score}</div>
                                                                </div>
                                                            ) : <span className="text-slate-300">—</span>
                                                        ) : e.status === "pending" ? (
                                                            <Input type="number" min={0} className="h-8 w-20 text-sm" aria-label="Score"
                                                                value={scoreEdit[e.id] ?? String(e.score)}
                                                                onChange={ev => setScoreEdit(m => ({ ...m, [e.id]: ev.target.value }))} />
                                                        ) : <span className="font-semibold tabular-nums">{e.score}</span>}
                                                    </td>
                                                )}
                                                <td className="px-3 py-3">
                                                    {e.status === "pending" ? (
                                                        rejecting?.id === e.id ? (
                                                            <div className="space-y-1.5">
                                                                <Input autoFocus className="h-8 text-xs" placeholder="Why? The store sees this" value={rejecting.note}
                                                                    onChange={ev => setRejecting({ id: e.id, note: ev.target.value })} />
                                                                <div className="flex gap-1.5">
                                                                    <Button size="sm" variant="destructive" disabled={!rejecting.note.trim() || busy === e.id}
                                                                        onClick={() => { const note = rejecting.note; setRejecting(null); review(e, "rejected", note); }}>Reject</Button>
                                                                    <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex gap-1.5">
                                                                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy === e.id}
                                                                    title={products.length ? "Opens it in the review queue, to read it invoice by invoice" : undefined}
                                                                    onClick={() => {
                                                                        /* A products entry is read invoice by invoice: that is the review queue. */
                                                                        if (products.length) { setQueueStart(e.id); setEntryFilter("pending"); }
                                                                        else review(e, "approved");
                                                                    }}>
                                                                    <Check className="h-4 w-4 mr-1" /> {products.length ? "Review" : "Approve"}
                                                                </Button>
                                                                <Button size="sm" variant="outline" onClick={() => setRejecting({ id: e.id, note: "" })}>
                                                                    <X className="h-4 w-4 mr-1" /> Reject
                                                                </Button>
                                                                <Button size="sm" variant="ghost" onClick={() => setCorrecting(e)} title="Correct what the store sent">
                                                                    <Pencil className="h-4 w-4 mr-1" /> Correct
                                                                </Button>
                                                            </div>
                                                        )
                                                    ) : (
                                                        <div className="space-y-1">
                                                            <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${ENTRY_META[e.status].tone}`}>{ENTRY_META[e.status].label}</span>
                                                            {e.review_note && <p className="text-xs text-slate-500">{e.review_note}</p>}
                                                            <button type="button" className="block text-[11px] text-slate-400 hover:text-orange-600"
                                                                onClick={() => act(e.id, () => api.put(`/schemes/admin/entries/${e.id}`, { status: "pending" }), "Moved back to review")}>
                                                                Undo
                                                            </button>
                                                            <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-orange-600"
                                                                onClick={() => setCorrecting(e)}>
                                                                <Pencil className="h-3 w-3" /> Correct
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
    );

    return (
        <div className="space-y-5">
            <button type="button" onClick={onBack} className="text-sm font-medium text-slate-500 hover:text-orange-600 flex items-center gap-1.5">
                <ArrowLeft className="h-4 w-4" /> All schemes
            </button>
            <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="h-20 w-16 shrink-0 rounded-lg overflow-hidden bg-slate-100 hidden sm:block">
                    {s.banner_url ? <img src={s.banner_url} alt="" className="h-full w-full object-cover object-top" />
                        : <div className="h-full w-full flex items-center justify-center bg-orange-50"><Gift className="h-6 w-6 text-orange-300" /></div>}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold text-slate-900 truncate">{s.title}</h2>
                        <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", STATE_META[s.state].tone)}>{STATE_META[s.state].label}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-slate-500">
                        <span>{CATEGORY_LABEL[s.category]}</span>
                        <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{s.windows.length === 1 ? formatWindow(s.windows[0]) : `${s.windows.length} windows · ${formatWindow(s.windows[0])} …`}</span>
                        {s.open_window ? <span className="font-medium text-emerald-700">Open now, until {formatWindow(s.open_window).split(" → ")[1]}</span>
                            : s.next_window ? <span className="text-sky-700">Next opens {formatWindow(s.next_window).split(" → ")[0]}</span> : null}
                        {rewardSummary(s.rewards) && <span className="text-slate-600">{rewardSummary(s.rewards)}</span>}
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    <Button variant="outline" size="sm" disabled={refreshing} aria-label="Refresh" title="Refresh entries and the leaderboard"
                        onClick={() => { setRefreshing(true); setReloadKey(k => k + 1); load().finally(() => setRefreshing(false)); }}>
                        <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}><FilePlus2 className="h-4 w-4 mr-1" /> Add entry</Button>
                    {products.length > 0 && (
                        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><FileSpreadsheet className="h-4 w-4 mr-1" /> Import Excel</Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => onEdit(s)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
                    <Button variant="outline" size="sm" disabled={busy === "copy"} onClick={() => act("copy", () => api.post(`/schemes/admin/${s.id}/copy`), "Copied as a new draft")}>
                        <CopyIcon className="h-4 w-4 mr-1" /> Copy
                    </Button>
                    {s.status === "draft" && (
                        <Button size="sm" className="bg-orange-500 hover:bg-orange-600" disabled={busy === "publish"}
                            onClick={() => act("publish", () => api.post(`/schemes/admin/${s.id}/publish`), "Scheme published")}>
                            <Send className="h-4 w-4 mr-1" /> Publish
                        </Button>
                    )}
                    {s.status === "published" && (confirmEnd ? (
                        <span className="flex items-center gap-1.5 text-xs text-slate-600">
                            End it now?
                            <Button size="sm" variant="destructive" disabled={busy === "end"} onClick={() => { setConfirmEnd(false); act("end", () => api.post(`/schemes/admin/${s.id}/end`), "Scheme ended"); }}>Yes, end</Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>No</Button>
                        </span>
                    ) : (
                        <Button variant="outline" size="sm" className="text-rose-600 hover:text-rose-700" onClick={() => setConfirmEnd(true)}><Ban className="h-4 w-4 mr-1" /> End now</Button>
                    ))}
                </div>
            </div>

            <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
                {([
                    ["overview", "Overview"],
                    ["entries", "Review"],
                    ["leaderboard", hasScore ? "Leaderboard & payouts" : "Payouts"],
                    ["participants", `Stores (${data.participants.length})`],
                    ...(products.length ? [["sellthrough", "Sell-through"]] : []),
                    ["adjustments", "Adjustments"],
                ] as [typeof tab, string][]).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setTab(k)}
                        className={cn("px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex items-center gap-1.5",
                            tab === k ? "border-orange-500 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800")}>
                        {l}
                        {k === "entries" && pending > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white tabular-nums">{pending}</span>}
                    </button>
                ))}
            </div>

            {tab === "overview" && <SchemeOverview data={data} onReview={() => { setEntryFilter("pending"); setTab("entries"); }} />}

            {tab === "entries" && (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm font-medium">
                            {(["pending", "approved", "rejected", "all"] as const).map(f => {
                                const n = f === "all" ? data.entries.length : data.entries.filter(e => e.status === f).length;
                                return (
                                    <button key={f} type="button" onClick={() => setEntryFilter(f)}
                                        className={cn("px-3 py-1 rounded-md", entryFilter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
                                        {f === "all" ? "All" : f === "pending" ? "Waiting" : ENTRY_META[f].label} <span className="tabular-nums text-slate-400">{n}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex items-center gap-2">
                            {entryFilter !== "pending" && (
                                <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium" role="group" aria-label="Group entries by">
                                    <span className="px-2 text-slate-400">Group by</span>
                                    {([["day", "Date"], ["store", "Store"]] as const).map(([k, l]) => (
                                        <button key={k} type="button" onClick={() => setGroupBy(k)} aria-pressed={groupBy === k}
                                            className={cn("px-2.5 py-1 rounded-md", groupBy === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{l}</button>
                                    ))}
                                </div>
                            )}
                            <Button variant="outline" size="sm" onClick={exportEntries} disabled={!entries.length}><Download className="h-4 w-4 mr-1" /> Export shown</Button>
                        </div>
                    </div>
                    <FilterBar q={ef.q} onQ={q => setEf(f => ({ ...f, q }))} placeholder="Search city, invoice number, anything typed…"
                        shown={entries.length} total={data.entries.filter(e => entryFilter === "all" || e.status === entryFilter).length}
                        active={JSON.stringify(ef) !== JSON.stringify({ q: "", store: "all", state: "all", from: "", to: "", minPts: "", maxPts: "", product: "all" })} onClear={() => setEf({ q: "", store: "all", state: "all", from: "", to: "", minPts: "", maxPts: "", product: "all" })}>
                        <Combobox options={storeOptions} value={ef.store} onChange={v => setEf(f => ({ ...f, store: v || "all" }))}
                            placeholder="All stores" searchPlaceholder="Type a store or city…" emptyMessage="No store matches."
                            className="h-9 w-[240px] font-normal text-sm" />
                                                    <Select value={ef.state} onValueChange={v => setEf(f => ({ ...f, state: v }))}>
                                <SelectTrigger className="h-9 w-[170px]" aria-label="State"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All states</SelectItem>
                                    {stateOptions.map(k => <SelectItem key={k} value={k}>{stateLabel(k)}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        <label className="flex items-center gap-1.5 text-xs text-slate-600">From
                            <Input type="date" value={ef.from} max={ef.to || undefined} onChange={e => setEf(f => ({ ...f, from: e.target.value }))} className="h-9 w-[150px]" aria-label="From date" />
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-slate-600">To
                            <Input type="date" value={ef.to} min={ef.from || undefined} onChange={e => setEf(f => ({ ...f, to: e.target.value }))} className="h-9 w-[150px]" aria-label="To date" />
                        </label>
                        {hasScore && (
                            <label className="flex items-center gap-1.5 text-xs text-slate-600">Points
                                <Input type="number" min={0} value={ef.minPts} onChange={e => setEf(f => ({ ...f, minPts: e.target.value }))} placeholder="min" className="h-9 w-20" aria-label="Minimum points" />
                                –
                                <Input type="number" min={0} value={ef.maxPts} onChange={e => setEf(f => ({ ...f, maxPts: e.target.value }))} placeholder="max" className="h-9 w-20" aria-label="Maximum points" />
                            </label>
                        )}
                        {products.length > 0 && (
                            <Select value={ef.product} onValueChange={v => setEf(f => ({ ...f, product: v }))}>
                                <SelectTrigger className="h-9 w-[200px]" aria-label="Product"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Any product</SelectItem>
                                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        )}
                    </FilterBar>
                    {entryFilter === "pending" ? (
                        <ReviewQueue key={queueStart ?? "queue"} scheme={s} entries={entries} busy={busy} onReview={reviewFromQueue} startId={queueStart} />
                    ) : !entries.length ? (
                        <p className="text-sm text-slate-400 py-10 text-center">No entries match.</p>
                    ) : (
                        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                            <div className="overflow-auto max-h-[calc(100vh-380px)]">
                                <table className="w-full text-sm text-left min-w-[900px]">
                                    <thead className="sticky top-0 z-10 bg-slate-50 text-slate-700 shadow-[0_1px_0_0_rgb(241,245,249)]">
                                        <tr>
                                            <th className="px-3 py-2.5 w-[120px] text-xs font-semibold text-slate-500">Date</th>
                                            <th className="px-3 py-2.5 w-[170px] text-xs font-semibold text-slate-500">Store</th>
                                            <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Submitted</th>
                                            {hasScore && <th className="px-3 py-2.5 w-[100px] text-xs font-semibold text-slate-500">Score</th>}
                                            <th className="px-3 py-2.5 w-[220px] text-xs font-semibold text-slate-500">Review</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {groupBy === "store" && byStore.map(st => {
                                            const open = openStores.has(st.store_id) || ef.store !== "all" || byStore.length === 1;
                                            return (
                                                <Fragment key={st.store_id}>
                                                    <tr className="bg-slate-50 hover:bg-slate-100 cursor-pointer" onClick={() => toggleStore(st.store_id)}>
                                                        <td colSpan={hasScore ? 5 : 4} className="px-3 py-2.5">
                                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                                <span className="flex items-center gap-2 min-w-0">
                                                                    <ChevronRight className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-90")} />
                                                                    <span className="font-bold text-slate-800 truncate">{st.store_name}</span>
                                                                    {st.place && <span className="text-xs text-slate-400 truncate">{st.place}</span>}
                                                                </span>
                                                                <span className="text-xs text-slate-500">
                                                                    {st.count} entr{st.count === 1 ? "y" : "ies"} · {st.days.length} day{st.days.length === 1 ? "" : "s"}
                                                                    {st.pending ? <span className="text-amber-700 font-semibold"> · {st.pending} to review</span> : ""}
                                                                    {hasScore && <> · <b className="tabular-nums text-slate-800">{st.points} pts</b> approved</>}
                                                                </span>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {open && st.days.map(d => (
                                                        <Fragment key={d.day}>
                                                            <tr>
                                                                <td colSpan={hasScore ? 5 : 4} className="pl-9 pr-3 py-1.5 text-xs font-semibold text-slate-600 bg-white">
                                                                    {formatDay(d.day)} <span className="font-normal text-slate-400">· {d.items.length} entr{d.items.length === 1 ? "y" : "ies"}</span>
                                                                </td>
                                                            </tr>
                                                            {d.items.map(entryRow)}
                                                        </Fragment>
                                                    ))}
                                                </Fragment>
                                            );
                                        })}
                                        {groupBy === "day" && byDay.map(group => (
                                            <Fragment key={group.day}>
                                                <tr className="bg-slate-50">
                                                    <td colSpan={hasScore ? 5 : 4} className="px-3 py-2 text-xs font-bold text-slate-700">
                                                        {formatDay(group.day)}
                                                        <span className="ml-2 font-normal text-slate-500">{group.items.length} entr{group.items.length === 1 ? "y" : "ies"}{group.pending ? ` · ${group.pending} to review` : ""} · {group.stores} store{group.stores === 1 ? "" : "s"}</span>
                                                    </td>
                                                </tr>
                                                {group.items.map(entryRow)}
                                            </Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {tab === "leaderboard" && (
                <div className="space-y-3">
                    <div className="flex justify-end">
                        <Button variant="outline" size="sm" onClick={exportBoard} disabled={!board.length}><Download className="h-4 w-4 mr-1" /> Export shown to Excel</Button>
                    </div>
                    <FilterBar q={lf.q} onQ={q => setLf(f => ({ ...f, q }))} placeholder="Search store or city"
                        shown={board.length} total={data.leaderboard.length}
                        active={JSON.stringify(lf) !== JSON.stringify({ q: "", store: "all", state: "all", club: "all", reward: "all", paid: "all", minScore: "", sort: "rank" })} onClear={() => setLf({ q: "", store: "all", state: "all", club: "all", reward: "all", paid: "all", minScore: "", sort: "rank" })}>
                        <Combobox options={storeOptions} value={lf.store} onChange={v => setLf(f => ({ ...f, store: v || "all" }))}
                            placeholder="All stores" searchPlaceholder="Type a store or city…" emptyMessage="No store matches."
                            className="h-9 w-[240px] font-normal text-sm" />
                                                    <Select value={lf.state} onValueChange={v => setLf(f => ({ ...f, state: v }))}>
                                <SelectTrigger className="h-9 w-[170px]" aria-label="State"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All states</SelectItem>
                                    {stateOptions.map(k => <SelectItem key={k} value={k}>{stateLabel(k)}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        {s.clubs.length > 0 && (
                            <Select value={lf.club} onValueChange={v => setLf(f => ({ ...f, club: v }))}>
                                <SelectTrigger className="h-9 w-[160px]" aria-label="Club"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Any club</SelectItem>
                                    {[...s.clubs].sort((a, b) => b.min - a.min).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                    <SelectItem value="none">No club yet</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                        <Select value={lf.reward} onValueChange={v => setLf(f => ({ ...f, reward: v }))}>
                            <SelectTrigger className="h-9 w-[160px]" aria-label="Reward"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Any reward</SelectItem>
                                <SelectItem value="earned">Earned a reward</SelectItem>
                                <SelectItem value="none">No reward yet</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={lf.paid} onValueChange={v => setLf(f => ({ ...f, paid: v }))}>
                            <SelectTrigger className="h-9 w-[150px]" aria-label="Paid"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Paid or not</SelectItem>
                                <SelectItem value="unpaid">To be paid</SelectItem>
                                <SelectItem value="paid">Paid</SelectItem>
                            </SelectContent>
                        </Select>
                        {hasScore && (
                            <label className="flex items-center gap-1.5 text-xs text-slate-600">Score at least
                                <Input type="number" min={0} value={lf.minScore} onChange={e => setLf(f => ({ ...f, minScore: e.target.value }))} className="h-9 w-20" aria-label="Minimum score" />
                            </label>
                        )}
                        <Select value={lf.sort} onValueChange={v => setLf(f => ({ ...f, sort: v }))}>
                            <SelectTrigger className="h-9 w-[170px]" aria-label="Sort"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="rank">{hasScore ? "Sort: rank" : "Sort: default"}</SelectItem>
                                <SelectItem value="approved">Sort: most entries</SelectItem>
                                <SelectItem value="name">Sort: store name</SelectItem>
                            </SelectContent>
                        </Select>
                    </FilterBar>
                    {s.clubs.length > 0 && data.leaderboard.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            {[...s.clubs].sort((a, b) => b.min - a.min).map(c => {
                                const n = data.leaderboard.filter(r => r.club?.id === c.id).length;
                                return (
                                    <button key={c.id} type="button" onClick={() => setLf(f => ({ ...f, club: f.club === c.id ? "all" : c.id }))}
                                        className={`flex items-center gap-1.5 rounded-full px-1 py-0.5 ${lf.club === c.id ? "ring-2 ring-orange-300" : ""}`}>
                                        <ClubBadge club={c} /> <span className="text-xs font-bold tabular-nums text-slate-700">{n}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {!board.length ? (
                        <p className="text-sm text-slate-400 py-10 text-center">{data.leaderboard.length ? "No stores match." : "Nobody has an approved entry yet."}</p>
                    ) : (
                        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                            <div className="overflow-auto max-h-[calc(100vh-380px)]">
                                <table className="w-full text-sm text-left min-w-[760px]">
                                    <thead className="sticky top-0 z-10 bg-slate-50 text-slate-700 shadow-[0_1px_0_0_rgb(241,245,249)]">
                                        <tr>
                                            {hasScore && <th className="px-3 py-2.5 w-[70px] text-xs font-semibold text-slate-500">Rank</th>}
                                            <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Store</th>
                                            {hasScore && <th className="px-3 py-2.5 w-[90px] text-xs font-semibold text-slate-500">Score</th>}
                                            {s.clubs.length > 0 && <th className="px-3 py-2.5 w-[140px] text-xs font-semibold text-slate-500">Club</th>}
                                            {hasScore && boardMonths.map(m => <th key={m} className="px-2 py-2.5 w-[70px] text-xs font-semibold text-slate-500 text-right">{formatMonth(m)}</th>)}
                                            <th className="px-3 py-2.5 w-[110px] text-xs font-semibold text-slate-500">Approved</th>
                                            <th className="px-3 py-2.5 w-[170px] text-xs font-semibold text-slate-500">Reward</th>
                                            <th className="px-3 py-2.5 w-[150px] text-xs font-semibold text-slate-500">Paid</th>
                                            <th className="px-3 py-2.5 w-[150px] text-xs font-semibold text-slate-500">Delivery</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {board.map(r => (
                                            <tr key={r.store_id}>
                                                {hasScore && <td className="px-3 py-2.5 font-bold tabular-nums text-slate-700">#{r.rank}</td>}
                                                <td className="px-3 py-2.5">
                                                    <div className="font-semibold text-slate-800">{r.store_name}</div>
                                                    <div className="text-xs text-slate-400">{[r.city, r.state].filter(Boolean).join(", ")}</div>
                                                </td>
                                                {hasScore && <td className="px-3 py-2.5 font-semibold tabular-nums">{r.score}</td>}
                                                {s.clubs.length > 0 && <td className="px-3 py-2.5">{r.club ? <ClubBadge club={r.club} /> : <span className="text-slate-300">—</span>}</td>}
                                                {hasScore && boardMonths.map(m => {
                                                    const v = r.months.find(x => x.month === m)?.points;
                                                    return <td key={m} className="px-2 py-2.5 text-right tabular-nums text-xs text-slate-600">{v ? v : <span className="text-slate-300">—</span>}</td>;
                                                })}
                                                <td className="px-3 py-2.5 tabular-nums text-slate-600">{r.approved}</td>
                                                <td className="px-3 py-2.5 text-slate-800">{r.reward ?? <span className="text-slate-300">—</span>}</td>
                                                <td className="px-3 py-2.5">
                                                    {r.reward ? (
                                                        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                                            <input type="checkbox" checked={Boolean(r.paid_at)} disabled={busy === `pay-${r.store_id}`}
                                                                onChange={ev => act(`pay-${r.store_id}`, () => api.put(`/schemes/admin/${s.id}/payouts/${r.store_id}`, { paid: ev.target.checked, reward: r.reward }), ev.target.checked ? "Marked as paid" : "Marked as not paid")} />
                                                            {r.paid_at ? `Paid ${formatDay(String(r.paid_at))}` : "Not paid"}
                                                        </label>
                                                    ) : <span className="text-slate-300">—</span>}
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    {r.reward ? (
                                                        <Select value={r.delivery ?? "none"} disabled={busy === `del-${r.store_id}`}
                                                            onValueChange={v => act(`del-${r.store_id}`, () => api.put(`/schemes/admin/${s.id}/payouts/${r.store_id}`, { delivery: v === "none" ? null : v, reward: r.reward }), v === "none" ? "Delivery cleared" : v === "dispatched" ? "Marked as dispatched" : "Marked as delivered")}>
                                                            <SelectTrigger className="h-8 text-xs w-[130px]" aria-label="Delivery"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="none">Not sent</SelectItem>
                                                                <SelectItem value="dispatched">Dispatched</SelectItem>
                                                                <SelectItem value="delivered">Delivered</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    ) : <span className="text-slate-300">—</span>}
                                                    {r.delivered_at ? <div className="text-[10px] text-slate-400 mt-0.5">{formatDay(String(r.delivered_at))}</div>
                                                        : r.dispatched_at ? <div className="text-[10px] text-slate-400 mt-0.5">since {formatDay(String(r.dispatched_at))}</div> : null}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {tab === "participants" && (
                !data.participants.length ? <p className="text-sm text-slate-400 py-10 text-center">No store has joined yet.</p> : (
                    <div className="space-y-3">
                        <FilterBar q={pf.q} onQ={q => setPf(f => ({ ...f, q }))} placeholder="Search store or city"
                            shown={joined.length} total={data.participants.length}
                            active={JSON.stringify(pf) !== JSON.stringify({ q: "", store: "all", state: "all", entries: "all" })} onClear={() => setPf({ q: "", store: "all", state: "all", entries: "all" })}>
                            <Combobox options={storeOptions} value={pf.store} onChange={v => setPf(f => ({ ...f, store: v || "all" }))}
                            placeholder="All stores" searchPlaceholder="Type a store or city…" emptyMessage="No store matches."
                            className="h-9 w-[240px] font-normal text-sm" />
                                                    <Select value={pf.state} onValueChange={v => setPf(f => ({ ...f, state: v }))}>
                                <SelectTrigger className="h-9 w-[170px]" aria-label="State"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All states</SelectItem>
                                    {stateOptions.map(k => <SelectItem key={k} value={k}>{stateLabel(k)}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <Select value={pf.entries} onValueChange={v => setPf(f => ({ ...f, entries: v }))}>
                                <SelectTrigger className="h-9 w-[200px]" aria-label="Entries"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">With or without entries</SelectItem>
                                    <SelectItem value="with">Sent entries</SelectItem>
                                    <SelectItem value="without">Joined, nothing sent yet</SelectItem>
                                </SelectContent>
                            </Select>
                        </FilterBar>
                        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 max-h-[calc(100vh-420px)] overflow-auto">
                            {joined.map(p => (
                                <div key={p.store_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                                    <span className="font-semibold text-slate-800">{p.store_name}
                                        <span className="ml-2 text-xs font-normal text-slate-400">{[p.city, p.state].filter(Boolean).join(", ")}</span></span>
                                    <span className="text-xs text-slate-500">
                                        {entryCount.get(p.store_id) ?? 0} entr{(entryCount.get(p.store_id) ?? 0) === 1 ? "y" : "ies"} · joined {when(p.joined_at)}
                                    </span>
                                </div>
                            ))}
                            {!joined.length && <p className="px-4 py-6 text-sm text-slate-400 text-center">No stores match.</p>}
                        </div>
                    </div>
                )
            )}

            {tab === "sellthrough" && <SellThroughTab schemeId={s.id} refreshKey={reloadKey} />}

            {tab === "adjustments" && (
                <div className="space-y-3">
                    {hasScore ? (
                        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                            <p className="text-sm font-semibold text-slate-900">Add or remove points</p>
                            <p className="text-xs text-slate-500">For something settled outside the app. Use a minus number to take points away.</p>
                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px_1fr_auto] gap-2">
                                <Combobox
                                    options={data.participants.map(p => ({ value: p.store_id, label: [p.store_name, p.city].filter(Boolean).join(" · ") }))
                                        .sort((a, b) => a.label.localeCompare(b.label))}
                                    value={adjust.store_id} onChange={v => setAdjust(a => ({ ...a, store_id: v }))}
                                    placeholder="Store that joined" searchPlaceholder="Type a store or city…" emptyMessage="No store matches."
                                    className="h-10 font-normal text-sm" />
                                <Input type="number" value={adjust.points} onChange={e => setAdjust(a => ({ ...a, points: e.target.value }))} placeholder="Points" aria-label="Points" />
                                <Input value={adjust.note} onChange={e => setAdjust(a => ({ ...a, note: e.target.value }))} placeholder="Why" aria-label="Note" />
                                <Button disabled={!adjust.store_id || !Number(adjust.points) || !adjust.note.trim() || busy === "adjust"}
                                    onClick={() => act("adjust", () => api.post(`/schemes/admin/${s.id}/adjust`, adjust).then(() => setAdjust({ store_id: "", points: "", note: "" })), "Points saved")}>
                                    Save
                                </Button>
                            </div>
                        </div>
                    ) : <p className="text-sm text-slate-400">This scheme has no score, so there's nothing to adjust.</p>}
                    {data.adjustments.length > 0 && (
                        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                            {data.adjustments.map(a => (
                                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                                    <span><span className="font-semibold text-slate-800">{a.store_name}</span>
                                        <span className={`ml-2 font-bold tabular-nums ${a.points > 0 ? "text-emerald-700" : "text-rose-600"}`}>{a.points > 0 ? "+" : ""}{a.points}</span>
                                        <span className="ml-2 text-slate-500">{a.note}</span></span>
                                    <span className="text-xs text-slate-400">{when(a.created_at)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            <CorrectEntryDialog entry={correcting} scheme={s} onClose={() => setCorrecting(null)}
                onDone={() => { setCorrecting(null); setReloadKey(k => k + 1); load(); onChanged(); }} />
            <AddEntryDialog open={addOpen} scheme={s} onClose={() => setAddOpen(false)}
                onDone={() => { setAddOpen(false); setReloadKey(k => k + 1); load(); onChanged(); }} />
            {products.length > 0 && (
                <ImportDialog open={importOpen} scheme={s} onClose={() => setImportOpen(false)}
                    onDone={() => { setImportOpen(false); setReloadKey(k => k + 1); load(); onChanged(); }} />
            )}
        </div>
    );
}
