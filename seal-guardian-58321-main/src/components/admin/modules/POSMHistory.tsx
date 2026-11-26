import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Link2, Loader2, Search, Trash2 } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, downloadCSV } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { NoidaTab, PlantTab } from "./POSMWork";
import {
    APPROVAL_SHORT, APPROVAL_TONE, FLAG_LABEL, POSM_ITEMS, POSM_STATUSES, STATUS_TONE, designLine, shortDate,
    type Approval, type HistoryLine, type LineFlag, type HistoryStoreRow, type HistoryTotals, type LimitedItem, type StoreSettings, type StoreSummary, type UnlinkedGroup,
} from "@/lib/posmHistory";

/**
 * POSM already sent to each store (Noida office and the plant's depots):
 * per store, what it has had, its FRP and Sample Jacket limits and whether
 * more needs approval; lines not yet linked to a store, to link.
 */

type Filter = "all" | "needs" | Approval | "pending_over" | "flagged" | "unlinked";
const FILTERS: [Filter, string][] = [
    ["all", "All stores"], ["needs", "Needs approval for more"], ["over", "Over limit"], ["reached", "Limit reached"], ["within", "Within limit"],
    ["new_used", "New: one-time used"], ["new_open", "New: one-time open"], ["pending_over", "Plant pending would go over"], ["flagged", "Has lines to check"], ["unlinked", "Not linked to a store"],
];

const LIMIT_TONE: Record<LimitedItem["state"], string> = { ok: "text-slate-900", pending_over: "text-orange-600", reached: "text-amber-700", over: "text-rose-600" };

function Limit({ v, label }: { v: LimitedItem; label: string }) {
    return (
        <span className="block tabular-nums">
            <b className={LIMIT_TONE[v.state]}>{v.sent}</b>
            {v.limit !== null && <span className="text-slate-400"> / {v.limit}</span>}
            {v.pending > 0 && <span className={cn("ml-1.5 text-xs", v.state === "pending_over" ? "font-semibold text-orange-600" : "text-slate-500")} title={`${label} pending at the plant`}>+{v.pending} pending</span>}
        </span>
    );
}

const Badge = ({ a }: { a: Approval }) => <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1", APPROVAL_TONE[a])}>{APPROVAL_SHORT[a]}</span>;

/** One line of history, with the fixes its flags call for. */
function LineRow({ l, onChanged }: { l: HistoryLine; onChanged: () => void }) {
    const { toast } = useToast();
    const [busy, setBusy] = useState(false);
    const [qty, setQty] = useState(String(l.qty));
    const save = async (body: Record<string, unknown>, done: string) => {
        setBusy(true);
        try { await api.put(`/posm/admin/history/lines/${l.id}`, body); toast({ title: done }); onChanged(); }
        catch (e) { toast({ title: "Could not save", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }
        finally { setBusy(false); }
    };
    const remove = async () => {
        setBusy(true);
        try { await api.delete(`/posm/admin/history/lines/${l.id}`); toast({ title: "Line removed" }); onChanged(); }
        catch (e) { toast({ title: "Could not remove", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }
        finally { setBusy(false); }
    };
    return (
        <li className="space-y-1.5 px-3 py-2.5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{l.item} <span className="font-normal text-slate-500">× {l.qty}</span>{designLine(l) && <span className="font-normal text-slate-600"> · {designLine(l)}</span>}</p>
                    <p className="text-xs text-slate-500">
                        {[l.dispatch_date ? `Sent ${shortDate(l.dispatch_date)}` : l.request_date ? `Asked ${shortDate(l.request_date)}` : null,
                            l.delivery_date ? `delivered ${shortDate(l.delivery_date)}` : null, l.source, l.courier, l.docket_no ? `docket ${l.docket_no}` : null].filter(Boolean).join(" · ")}
                    </p>
                    {/* Every other column the sheet has for this line, the filled ones only. */}
                    <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                        {([
                            ["Requested", shortDate(l.request_date)], ["Expected (plant)", shortDate(l.expected_dispatch)], ["Status changed", shortDate(l.status_changed_on)],
                            ["Distributor", l.distributor], ["ASM", l.asm], ["Brand", l.brand], ["Store Old/New", l.store_kind], ["Dispatched by", l.dispatched_by],
                            ["Name in sheet", l.sheet_store_name], ["Reason (hold / delay)", l.reason], ["Remarks", l.remarks], ["Address / Contact", l.address], ["Match note", l.match_note],
                        ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                            <div key={k} className="flex min-w-0 gap-1.5"><dt className="shrink-0 text-slate-400">{k}</dt><dd className="min-w-0 break-words text-slate-700">{v}</dd></div>
                        ))}
                    </dl>
                </div>
                <select value={l.status} disabled={busy} onChange={e => save({ status: e.target.value }, "Status changed")} aria-label={`Status of ${l.item}`}
                    className={cn("h-8 rounded-full border-0 px-2.5 text-xs font-semibold", STATUS_TONE(l.status))}>
                    {POSM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
            </div>
            {l.flags.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    {l.flags.map(f => <span key={f} className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{FLAG_LABEL[f]}</span>)}
                    {l.flags.includes("qty_not_written") && (
                        <span className="flex items-center gap-1">
                            <Input value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ""))} className="h-7 w-16 text-right text-xs" aria-label="Real quantity" />
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy || !Number(qty)} onClick={() => save({ qty: Number(qty) }, "Quantity saved")}>Save qty</Button>
                        </span>
                    )}
                    {l.flags.includes("possible_duplicate") && <>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-rose-600" disabled={busy} onClick={remove}><Trash2 className="mr-1 h-3 w-3" />Remove this copy</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => save({ clear_flags: ["possible_duplicate"] }, "Kept: not a duplicate")}>Not a duplicate</Button>
                    </>}
                    {l.flags.includes("check_match") && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => save({ clear_flags: ["check_match"] }, "Store confirmed")}>Store is right</Button>}
                    {l.match_note && l.flags.includes("check_match") && <span className="text-[11px] text-slate-500">{l.match_note}</span>}
                </div>
            )}
        </li>
    );
}

/** One store: its type and limits, what it has had of each item, and every line. */
function StoreDetail({ storeId, onClose, onChanged }: { storeId: string; onClose: () => void; onChanged: () => void }) {
    const { toast } = useToast();
    const [d, setD] = useState<{ store: any; settings: StoreSettings; summary: StoreSummary; approval_label: string; lines: HistoryLine[] } | null>(null);
    const [form, setForm] = useState<StoreSettings | null>(null);
    const [saving, setSaving] = useState(false);
    const load = useCallback(() => api.get(`/posm/admin/history/stores/${storeId}`).then(r => { setD(r.data); setForm(r.data.settings); })
        .catch(e => toast({ title: "Could not load the store", description: getErrorMessage(e, "Try again"), variant: "destructive" })), [storeId, toast]);
    useEffect(() => { load(); }, [load]);
    const changed = () => { load(); onChanged(); };
    const saveSettings = async () => {
        if (!form) return;
        setSaving(true);
        try { await api.put(`/posm/admin/history/stores/${storeId}/settings`, form); toast({ title: "Saved" }); changed(); }
        catch (e) { toast({ title: "Could not save", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }
        finally { setSaving(false); }
    };
    const dirty = d && form && JSON.stringify({ ...d.settings, type_assumed: false }) !== JSON.stringify({ ...form, type_assumed: false });
    return (
        <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
            <DialogContent className="max-h-[92vh] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl sm:max-w-3xl">
                {!d || !form ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div> : <>
                    <DialogHeader>
                        <DialogTitle className="pr-8 text-lg font-black">{d.store.store_name}</DialogTitle>
                        <DialogDescription>{[d.store.store_code, d.store.city, d.store.state].filter(Boolean).join(" · ")}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2"><Badge a={d.summary.approval} /><span className="text-sm text-slate-600">{d.approval_label}</span></div>

                        <div className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                            <label className="space-y-1"><span className="block text-xs font-semibold text-slate-600">Store type{d.settings.type_assumed && <span className="ml-1 font-normal text-amber-700">(assumed)</span>}</span>
                                <select value={form.store_type} onChange={e => setForm({ ...form, store_type: e.target.value as "old" | "new" })} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                                    <option value="old">Old store</option><option value="new">New store</option>
                                </select></label>
                            <label className="space-y-1"><span className="block text-xs font-semibold text-slate-600">FRP limit</span>
                                <Input type="number" min={0} value={form.frp_limit} disabled={form.store_type === "new"} onChange={e => setForm({ ...form, frp_limit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="h-9" /></label>
                            <label className="space-y-1"><span className="block text-xs font-semibold text-slate-600">Sample Jacket limit</span>
                                <Input type="number" min={0} value={form.jacket_limit} disabled={form.store_type === "new"} onChange={e => setForm({ ...form, jacket_limit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="h-9" /></label>
                            <Button className="h-9 bg-orange-500 font-bold hover:bg-orange-600" disabled={saving || (!dirty && !d.settings.type_assumed)} onClick={saveSettings}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{d.settings.type_assumed && !dirty ? "Confirm" : "Save"}</Button>
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">FRP sent</p><Limit v={d.summary.frp} label="FRP" /></div>
                            <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Sample Jackets sent</p><Limit v={d.summary.jacket} label="Sample Jackets" /></div>
                            <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Lines</p><p className="font-bold tabular-nums">{d.lines.length}</p></div>
                            <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Last sent</p><p className="font-bold">{shortDate(d.summary.last_dispatch) || "—"}</p></div>
                        </div>
                        {Object.keys(d.summary.sent).length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {Object.entries(d.summary.sent).sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{k} <b className="tabular-nums">{n}</b></span>)}
                            </div>
                        )}
                        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                            {d.lines.map(l => <LineRow key={`${l.id}-${l.status}-${l.qty}-${l.flags.join()}`} l={l} onChanged={changed} />)}
                            {!d.lines.length && <li className="px-3 py-8 text-center text-sm text-slate-500">No lines.</li>}
                        </ul>
                    </div>
                </>}
            </DialogContent>
        </Dialog>
    );
}

/** Lines with no store, grouped by the code or name the sheet gave; each group can be linked to a store. */
function Unlinked({ onChanged }: { onChanged: () => void }) {
    const { toast } = useToast();
    const [groups, setGroups] = useState<UnlinkedGroup[] | null>(null);
    const [stores, setStores] = useState<{ id: string; store_name: string; store_code?: string | null; city?: string | null }[]>([]);
    const [linking, setLinking] = useState<UnlinkedGroup | null>(null);
    const [find, setFind] = useState("");
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => api.get("/posm/admin/history/unlinked").then(r => setGroups(r.data.groups))
        .catch(e => toast({ title: "Could not load", description: getErrorMessage(e, "Try again"), variant: "destructive" })), [toast]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (!linking || stores.length) return;
        api.get("/admin/vendors").then(r => setStores((r.data.vendors || r.data.data || []).map((v: any) => ({ id: v.vendor_details_id ?? v.id, store_name: v.store_name, store_code: v.store_code, city: v.city })).filter((v: any) => v.id && v.store_name)))
            .catch(e => toast({ title: "Could not load stores", description: getErrorMessage(e, "Try again"), variant: "destructive" }));
    }, [linking, stores.length, toast]);
    const matches = useMemo(() => {
        const q = find.trim().toLowerCase();
        return (q ? stores.filter(s => [s.store_name, s.store_code, s.city].some(v => (v || "").toLowerCase().includes(q))) : stores).slice(0, 8);
    }, [stores, find]);
    const link = async (storeId: string, name: string) => {
        if (!linking) return;
        setBusy(true);
        try {
            const r = await api.post("/posm/admin/history/link", { group_key: linking.key, store_id: storeId });
            toast({ title: `${r.data.linked} line${r.data.linked === 1 ? "" : "s"} linked to ${name}` });
            setLinking(null); setFind(""); load(); onChanged();
        } catch (e) { toast({ title: "Could not link", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }
        finally { setBusy(false); }
    };
    if (!groups) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    return (
        <>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {groups.map(g => {
                    const items = g.lines.reduce((m: Record<string, number>, l) => ({ ...m, [l.item]: (m[l.item] ?? 0) + l.qty }), {});
                    return (
                        <li key={g.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                            <div className="min-w-[220px] flex-1">
                                <p className="font-semibold text-slate-900">{g.sheet_store_name || "(no store name in the sheet)"}{g.store_code && <span className="ml-2 font-mono text-xs text-rose-600">{g.store_code} · not in portal</span>}</p>
                                <p className="text-xs text-slate-500">{[g.sources.join(", "), g.distributor, g.city, g.state].filter(Boolean).join(" · ")}</p>
                                <p className="text-xs text-slate-600">{g.lines.length} line{g.lines.length === 1 ? "" : "s"}: {Object.entries(items).map(([k, n]) => `${k} ${n}`).join(", ")}</p>
                            </div>
                            {g.sent_to_asm && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800">Sent to ASM</span>}
                            <Button size="sm" variant="outline" className="h-8" onClick={() => { setLinking(g); setFind(g.sheet_store_name ?? ""); }}><Link2 className="mr-1.5 h-3.5 w-3.5" />Link to store</Button>
                        </li>
                    );
                })}
                {!groups.length && <li className="px-4 py-10 text-center text-sm text-slate-500">Every line is linked to a store.</li>}
            </ul>
            {linking && (
                <Dialog open onOpenChange={v => { if (!v && !busy) setLinking(null); }}>
                    <DialogContent className="max-w-[calc(100%-1.5rem)] rounded-2xl sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle className="text-lg font-black">Link to a store</DialogTitle>
                            <DialogDescription>{linking.lines.length} line{linking.lines.length === 1 ? "" : "s"} for "{linking.sheet_store_name || linking.store_code}" will count for the store you pick.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2">
                            <div className="relative"><Search className="absolute left-2.5 top-3 h-4 w-4 text-slate-400" />
                                <Input value={find} onChange={e => setFind(e.target.value)} placeholder="Search store, code or city" className="h-10 pl-8" autoFocus aria-label="Search the store" /></div>
                            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                                {!stores.length && <li className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></li>}
                                {matches.map(s => (
                                    <li key={s.id}><button type="button" disabled={busy} onClick={() => link(s.id, s.store_name)} className="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 disabled:opacity-50">
                                        <span className="block font-semibold text-slate-900">{s.store_name}</span><span className="block text-xs text-slate-500">{[s.store_code, s.city].filter(Boolean).join(" · ")}</span>
                                    </button></li>
                                ))}
                                {stores.length > 0 && !matches.length && <li className="px-3 py-6 text-center text-sm text-slate-500">No store matches.</li>}
                            </ul>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}

const PAGE = 100;
const statusLine = (by: Record<string, number>) => Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");

/** Every line, like the sheet's All Dispatches tab: all columns, filters and a full export. */
function AllDispatches({ onOpenStore }: { onOpenStore: (id: string) => void }) {
    const { toast } = useToast();
    const [lines, setLines] = useState<HistoryLine[] | null>(null);
    const [q, setQ] = useState("");
    const [source, setSource] = useState("all");
    const [status, setStatus] = useState("all");
    const [item, setItem] = useState("all");
    const [flag, setFlag] = useState("all");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [page, setPage] = useState(0);
    useEffect(() => {
        api.get("/posm/admin/history/lines").then(r => setLines(r.data.lines))
            .catch(e => toast({ title: "Could not load the lines", description: getErrorMessage(e, "Try again"), variant: "destructive" }));
    }, [toast]);
    const sources = useMemo(() => [...new Set((lines ?? []).map(l => l.source))].sort(), [lines]);
    const shown = useMemo(() => {
        const term = q.trim().toLowerCase();
        return (lines ?? []).filter(l =>
            (!term || [l.portal_store_name, l.sheet_store_name, l.store_code, l.docket_no, l.distributor, l.asm, l.city, l.design].some(v => String(v ?? "").toLowerCase().includes(term)))
            && (source === "all" || l.source === source) && (status === "all" || l.status === status) && (item === "all" || l.item === item)
            && (flag === "all" || (flag === "unlinked" ? !l.store_id : l.flags.includes(flag as LineFlag)))
            && (!from || (l.dispatch_date ?? l.request_date ?? "") >= from) && (!to || (l.dispatch_date ?? l.request_date ?? "9999") <= to));
    }, [lines, q, source, status, item, flag, from, to]);
    useEffect(() => { setPage(0); }, [q, source, status, item, flag, from, to]);
    if (!lines) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    const exportRows = () => downloadCSV(shown.map(l => ({
        "Source": l.source, "Request Date": l.request_date ?? "", "Dispatch Date": l.dispatch_date ?? "", "Store Code": l.store_code ?? "",
        "Store Name (Portal)": l.portal_store_name ?? "", "Store Name (as in sheet)": l.sheet_store_name ?? "", "City": l.city ?? "", "State": l.state ?? "",
        "Distributor": l.distributor ?? "", "ASM": l.asm ?? "", "Item": l.item, "Design": l.design ?? "", "Major Colour": l.major_colour ?? "", "Minor Colour": l.minor_colour ?? "",
        "Brand": l.brand ?? "", "Store Old/New": l.store_kind ?? "", "Qty": l.qty, "Status": l.status, "Courier": l.courier ?? "", "Docket No.": l.docket_no ?? "",
        "Delivery Date": l.delivery_date ?? "", "Expected Dispatch (plant)": l.expected_dispatch ?? "", "Reason - Hold / Delay / Status Change": l.reason ?? "",
        "Status Last Changed On": l.status_changed_on ?? "", "Dispatched By": l.dispatched_by ?? "", "Remarks": l.remarks ?? "", "Address / Contact": l.address ?? "",
        "Match Note": l.match_note ?? "", "Flags": l.flags.map(f => FLAG_LABEL[f]).join(", "),
    })), "posm_all_dispatches.csv");
    const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";
    const rows = shown.slice(page * PAGE, page * PAGE + PAGE);
    const th = "whitespace-nowrap px-2.5 py-2 font-semibold";
    const td = "px-2.5 py-1.5 align-top";
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
                <div className="relative min-w-[220px] flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Store, code, docket, distributor, ASM, design" className="h-9 pl-8" aria-label="Search lines" /></div>
                <select value={source} onChange={e => setSource(e.target.value)} className={sel} aria-label="Source"><option value="all">All sources</option>{sources.map(s => <option key={s}>{s}</option>)}</select>
                <select value={item} onChange={e => setItem(e.target.value)} className={sel} aria-label="Item"><option value="all">All items</option>{POSM_ITEMS.map(s => <option key={s}>{s}</option>)}</select>
                <select value={status} onChange={e => setStatus(e.target.value)} className={sel} aria-label="Status"><option value="all">All statuses</option>{POSM_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
                <select value={flag} onChange={e => setFlag(e.target.value)} className={sel} aria-label="Flags">
                    <option value="all">Any line</option><option value="unlinked">Not linked to a store</option>
                    {(Object.keys(FLAG_LABEL) as LineFlag[]).map(f => <option key={f} value={f}>{FLAG_LABEL[f]}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs text-slate-500">From<Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-36" /></label>
                <label className="flex items-center gap-1 text-xs text-slate-500">To<Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-36" /></label>
                <Button variant="outline" size="sm" className="h-9" onClick={exportRows} disabled={!shown.length}><Download className="mr-1.5 h-4 w-4" /> Export {shown.length}</Button>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-max min-w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-500 shadow-[0_1px_0_#e2e8f0]">
                        <tr>
                            {["Source", "Request", "Dispatch", "Code", "Store", "City", "State", "Distributor", "ASM", "Item", "Design", "Major", "Minor", "Brand", "Old/New", "Qty", "Status",
                                "Courier", "Docket No.", "Delivered", "Expected (plant)", "Reason", "Status changed", "Dispatched by", "Remarks", "Address / Contact", "Match note"].map(h => <th key={h} className={th}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map(l => (
                            <tr key={l.id} onClick={() => l.store_id && onOpenStore(l.store_id)} className={cn(l.store_id ? "cursor-pointer hover:bg-orange-50/40" : "bg-rose-50/40")}>
                                <td className={cn(td, "whitespace-nowrap")}>{l.source}</td>
                                <td className={cn(td, "whitespace-nowrap")}>{shortDate(l.request_date)}</td>
                                <td className={cn(td, "whitespace-nowrap")}>{shortDate(l.dispatch_date)}</td>
                                <td className={cn(td, "whitespace-nowrap font-mono", !l.store_id && "text-rose-600")}>{l.store_code}</td>
                                <td className={cn(td, "min-w-[180px]")}>
                                    <span className="font-semibold text-slate-900">{l.portal_store_name || l.sheet_store_name}</span>
                                    {l.portal_store_name && l.sheet_store_name && l.portal_store_name.toUpperCase() !== l.sheet_store_name.toUpperCase() && <span className="block text-slate-500">sheet: {l.sheet_store_name}</span>}
                                    {!l.store_id && <span className="block font-semibold text-rose-600">Not linked</span>}
                                    {l.flags.length > 0 && <span className="mt-0.5 flex flex-wrap gap-1">{l.flags.map(f => <span key={f} className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">{FLAG_LABEL[f]}</span>)}</span>}
                                </td>
                                <td className={td}>{l.city}</td><td className={td}>{l.state}</td>
                                <td className={cn(td, "min-w-[120px]")}>{l.distributor}</td><td className={cn(td, "min-w-[110px]")}>{l.asm}</td>
                                <td className={cn(td, "whitespace-nowrap font-semibold")}>{l.item}</td><td className={td}>{l.design}</td>
                                <td className={td}>{l.major_colour}</td><td className={td}>{l.minor_colour}</td><td className={td}>{l.brand}</td><td className={td}>{l.store_kind}</td>
                                <td className={cn(td, "text-right font-bold tabular-nums")}>{l.qty}</td>
                                <td className={td}><span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 font-semibold", STATUS_TONE(l.status))}>{l.status}</span></td>
                                <td className={td}>{l.courier}</td><td className={cn(td, "font-mono")}>{l.docket_no}</td>
                                <td className={cn(td, "whitespace-nowrap")}>{shortDate(l.delivery_date)}</td><td className={cn(td, "whitespace-nowrap")}>{shortDate(l.expected_dispatch)}</td>
                                <td className={cn(td, "min-w-[160px]")}>{l.reason}</td><td className={cn(td, "whitespace-nowrap")}>{shortDate(l.status_changed_on)}</td>
                                <td className={td}>{l.dispatched_by}</td><td className={cn(td, "min-w-[200px]")}>{l.remarks}</td>
                                <td className={cn(td, "min-w-[200px]")}>{l.address}</td><td className={cn(td, "min-w-[160px] text-slate-500")}>{l.match_note}</td>
                            </tr>
                        ))}
                        {!rows.length && <tr><td colSpan={27} className="px-4 py-10 text-center text-sm text-slate-500">No line matches.</td></tr>}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-600">
                <span>{shown.length ? `${page * PAGE + 1}–${Math.min(shown.length, page * PAGE + PAGE)} of ${shown.length}` : "0 lines"}{shown.length !== lines.length && ` (of ${lines.length})`}</span>
                <span className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= shown.length} onClick={() => setPage(p => p + 1)}>Next</Button>
                </span>
            </div>
        </div>
    );
}

export function POSMHistory() {
    const { toast } = useToast();
    const { user, hasPermission } = useAuth();
    /* Head office sees everything; a plant login sees only the plant's lines. */
    const su = Boolean((user as any)?.isSuperAdmin);
    const can = (k: string, a: "read" | "write") => su || hasPermission(k, a);
    const headOffice = can("posm", "read") || can("posm_noida", "read");
    const canPlantEdit = can("posm", "write") || can("posm_plant", "write");
    const canNoidaEdit = can("posm", "write") || can("posm_noida", "write");
    const [d, setD] = useState<{ stores: HistoryStoreRow[]; totals: HistoryTotals } | null>(null);
    const [view, setView] = useState<"noida" | "plant" | "stores" | "lines" | "unlinked">(headOffice ? "noida" : "plant");
    const [q, setQ] = useState("");
    const [filter, setFilter] = useState<Filter>("all");
    const [open, setOpen] = useState<string | null>(null);
    const load = useCallback(() => api.get("/posm/admin/history/stores").then(r => setD(r.data))
        .catch(e => toast({ title: "Could not load the POSM history", description: getErrorMessage(e, "Try again"), variant: "destructive" })), [toast]);
    useEffect(() => { if (headOffice) load(); }, [load, headOffice]);

    const rows = useMemo(() => {
        const term = q.trim().toLowerCase();
        return (d?.stores ?? [])
            .filter(s => !term || [s.store_name, s.store_code, s.city, s.state, s.distributor, s.asm].some(v => String(v ?? "").toLowerCase().includes(term)))
            .filter(s => filter === "all" ? true : filter === "unlinked" ? !s.linked : !s.linked ? false
                : filter === "needs" ? s.summary.needs_approval : filter === "pending_over" ? (s.summary.frp.state === "pending_over" || s.summary.jacket.state === "pending_over")
                : filter === "flagged" ? s.flagged > 0 : s.summary.approval === filter)
            .sort((a, b) => Number(b.linked) - Number(a.linked) || a.store_name.localeCompare(b.store_name));
    }, [d, q, filter]);

    if (!headOffice) return <PlantTab canEdit={canPlantEdit} canOrder={false} />;
    if (!d) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    const t = d.totals;
    const typeText = (s: HistoryStoreRow) => s.settings.store_type === "new" ? "New" : s.settings.type_assumed ? "Old (assumed)" : "Old";
    const exportRows = () => downloadCSV(rows.map(s => ({
        "Store Code": s.store_code ?? "", "Store Name": s.store_name, "Linked": s.linked ? "Yes" : "No", "City": s.city ?? "", "State": s.state ?? "",
        "Distributor": s.distributor ?? "", "ASM": s.asm ?? "",
        ...Object.fromEntries(POSM_ITEMS.map(i => [i, s.summary.sent[i] ?? 0])),
        "FRP Pending at Plant": s.summary.frp.pending, "Sample Jacket Pending at Plant": s.summary.jacket.pending, "Store Type (Old/New)": typeText(s),
        "FRP Limit": s.summary.frp.limit ?? "", "Sample Jacket Limit": s.summary.jacket.limit ?? "",
        "FRP Left Before Approval": s.summary.frp.left ?? "", "Sample Jacket Left Before Approval": s.summary.jacket.left ?? "",
        "Position": APPROVAL_SHORT[s.summary.approval], "Approval Needed for More?": s.summary.needs_approval ? "Yes" : "No",
        "Courier": s.courier ?? "", "Last Dispatch": s.summary.last_dispatch ?? "", "Delivery Status": statusLine(s.by_status), "Sent From": s.sent_from.join(", "), "Lines to check": s.flagged,
    })), "posm_stores.csv");

    const tile = (label: string, n: number, go: () => void, on: boolean, tone = "") => (
        <button type="button" onClick={go} className={cn("rounded-xl bg-white px-4 py-3 text-left ring-1 ring-slate-200 hover:ring-orange-300", on && "ring-2 ring-orange-400")}>
            <p className="text-xs text-slate-500">{label}</p><p className={cn("text-2xl font-bold tabular-nums", tone)}>{n}</p>
        </button>
    );
    const show = (f: Filter) => () => { setView("stores"); setFilter(f); };
    const th = "whitespace-nowrap px-2.5 py-2 font-semibold";
    const td = "px-2.5 py-1.5";

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {tile("Stores", t.stores + t.unlinked_stores, show("all"), view === "stores" && filter === "all")}
                {tile("Within limit", t.within, show("within"), view === "stores" && filter === "within", "text-emerald-700")}
                {tile("Limit reached", t.reached, show("reached"), view === "stores" && filter === "reached", "text-amber-700")}
                {tile("Over limit", t.over, show("over"), view === "stores" && filter === "over", "text-rose-600")}
                {tile("New: one-time used", t.new_used, show("new_used"), view === "stores" && filter === "new_used", "text-violet-700")}
                {tile("All dispatch lines", t.lines, () => setView("lines"), view === "lines")}
                {tile("Unlinked lines", t.unlinked, () => setView("unlinked"), view === "unlinked", t.unlinked ? "text-rose-600" : "")}
            </div>

            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm font-semibold">
                {([["noida", "Noida office"], ["plant", "Plant"], ["stores", `Stores (${t.stores + t.unlinked_stores})`], ["lines", `All dispatches (${t.lines})`], ["unlinked", `Unlinked (${t.unlinked})`]] as const).map(([v, label]) => (
                    <button key={v} type="button" onClick={() => setView(v)} className={cn("rounded-lg px-3 py-1.5", view === v ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800")}>{label}</button>
                ))}
            </div>

            {view === "noida" && <NoidaTab canEdit={canNoidaEdit} />}
            {view === "plant" && <PlantTab canEdit={canPlantEdit} canOrder={canNoidaEdit} />}
            {view === "unlinked" && <Unlinked onChanged={load} />}
            {view === "lines" && <AllDispatches onOpenStore={setOpen} />}
            {view === "stores" && <>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store, code, city, state, distributor or ASM" className="h-9 pl-8" aria-label="Search stores" /></div>
                    <select value={filter} onChange={e => setFilter(e.target.value as Filter)} aria-label="Show" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
                        {FILTERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                    <Button variant="outline" size="sm" className="h-9" onClick={exportRows} disabled={!rows.length}><Download className="mr-1.5 h-4 w-4" /> Export {rows.length}</Button>
                </div>
                <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-max min-w-full text-xs">
                        <thead className="sticky top-0 z-20 bg-slate-50 text-left text-slate-500 shadow-[0_1px_0_#e2e8f0]">
                            <tr>
                                <th className={cn(th, "sticky left-0 z-30 bg-slate-50")}>Store</th>
                                <th className={th}>Type</th><th className={th}>Distributor</th><th className={th}>ASM</th>
                                <th className={th}>FRP sent / limit</th><th className={th}>Jackets sent / limit</th>
                                {POSM_ITEMS.slice(2).map(i => <th key={i} className={cn(th, "text-right")}>{i}</th>)}
                                <th className={th}>Position</th><th className={th}>Last sent</th><th className={th}>Delivery status</th><th className={th}>Courier</th><th className={th}>Sent from</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.map(s => (
                                <tr key={s.key} onClick={() => s.store_id ? setOpen(s.store_id) : setView("unlinked")} className={cn("group cursor-pointer", s.linked ? "hover:bg-orange-50/40" : "bg-rose-50/40 hover:bg-rose-50")}>
                                    <td className={cn(td, "sticky left-0 z-10 min-w-[220px] max-w-[260px]", s.linked ? "bg-white group-hover:bg-orange-50" : "bg-rose-50")}>
                                        <p className="font-semibold text-slate-900">{s.store_name}</p>
                                        <p className="text-slate-500">{[s.store_code, s.city, s.state].filter(Boolean).join(" · ")}</p>
                                        <span className="flex flex-wrap gap-1">
                                            {!s.linked && <span className="rounded bg-rose-100 px-1 text-[10px] font-semibold text-rose-700">Not linked: link it</span>}
                                            {s.sent_to_asm && <span className="rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-800">Sent to ASM</span>}
                                            {s.flagged > 0 && <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">{s.flagged} to check</span>}
                                        </span>
                                    </td>
                                    <td className={cn(td, "whitespace-nowrap")}>{typeText(s)}</td>
                                    <td className={cn(td, "min-w-[130px]")}>{s.distributor}</td><td className={cn(td, "min-w-[110px]")}>{s.asm}</td>
                                    <td className={cn(td, "whitespace-nowrap")}><Limit v={s.summary.frp} label="FRP" /></td>
                                    <td className={cn(td, "whitespace-nowrap")}><Limit v={s.summary.jacket} label="Sample Jackets" /></td>
                                    {POSM_ITEMS.slice(2).map(i => <td key={i} className={cn(td, "text-right tabular-nums", !s.summary.sent[i] && "text-slate-300")}>{s.summary.sent[i] ?? 0}</td>)}
                                    <td className={td}><Badge a={s.summary.approval} /></td>
                                    <td className={cn(td, "whitespace-nowrap")}>{shortDate(s.summary.last_dispatch) || "—"}</td>
                                    <td className={cn(td, "min-w-[180px] text-slate-600")}>{statusLine(s.by_status)}</td>
                                    <td className={td}>{s.courier}</td>
                                    <td className={cn(td, "min-w-[150px] text-slate-600")}>{s.sent_from.join(", ")}</td>
                                </tr>
                            ))}
                            {!rows.length && <tr><td colSpan={25} className="px-4 py-10 text-center text-sm text-slate-500">{d.stores.length ? "No store matches." : "No POSM history yet."}</td></tr>}
                        </tbody>
                    </table>
                </div>
            </>}
            {open && <StoreDetail storeId={open} onClose={() => setOpen(null)} onChanged={load} />}
        </div>
    );
}
