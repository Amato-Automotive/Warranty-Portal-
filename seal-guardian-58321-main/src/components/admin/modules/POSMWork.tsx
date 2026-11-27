import { storeMatches } from "@/lib/storeSearch";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, Trash2, X } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { POSM_ITEMS, POSM_STATUSES, STATUS_TONE, shortDate, type HistoryLine } from "@/lib/posmHistory";
import { tableRows, type PosmField, type TableRow } from "@/lib/posm";

/**
 * Working in the portal instead of the two sheets:
 *  - Plant: the depots' FRP / Sample Jacket lines. The plant updates status,
 *    expected and dispatch dates, docket, courier, reason and remarks; the
 *    Noida office places new orders.
 *  - Noida office: one row per dispatch with a quantity per item, like its sheet.
 */

const PAGE = 100;
const DEPOT_LABEL: Record<string, string> = { "Plant - Ludhiana depot": "Ludhiana", "Plant - Jaipur depot": "Jaipur" };
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";
const th = "whitespace-nowrap px-2.5 py-2 font-semibold";
const td = "px-2.5 py-1.5 align-top";

type Store = { id: string; store_name: string; store_code?: string | null; city?: string | null };

/** Search and pick a portal store. */
function StorePicker({ value, onPick }: { value: Store | null; onPick: (s: Store | null) => void }) {
    const { toast } = useToast();
    const [stores, setStores] = useState<Store[]>([]);
    const [find, setFind] = useState("");
    useEffect(() => {
        api.get("/admin/vendors").then(r => setStores((r.data.vendors || r.data.data || []).map((v: any) => ({ id: v.vendor_details_id ?? v.id, store_name: v.store_name, store_code: v.store_code, city: v.city })).filter((v: Store) => v.id && v.store_name)))
            .catch(e => toast({ title: "Could not load stores", description: getErrorMessage(e, "Try again"), variant: "destructive" }));
    }, [toast]);
    const matches = useMemo(() => {
        const q = find.trim().toLowerCase();
        return stores.filter(s => storeMatches(q, [s.store_name, s.store_code, s.city])).slice(0, 8);
    }, [stores, find]);
    if (value) return (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span className="min-w-0 text-sm"><b className="block text-slate-900">{value.store_name}</b><span className="text-xs text-slate-500">{[value.store_code, value.city].filter(Boolean).join(" · ")}</span></span>
            <button type="button" className="text-xs font-semibold text-orange-700 hover:underline" onClick={() => onPick(null)}>Change</button>
        </div>
    );
    return (
        <div className="space-y-1">
            <div className="relative"><Search className="absolute left-2.5 top-3 h-4 w-4 text-slate-400" />
                <Input value={find} onChange={e => setFind(e.target.value)} placeholder="Search store, code or city" className="h-10 pl-8" aria-label="Search the store" /></div>
            <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {!stores.length && <li className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></li>}
                {matches.map(s => (
                    <li key={s.id}><button type="button" onClick={() => onPick(s)} className="w-full px-3 py-2 text-left text-sm hover:bg-orange-50">
                        <span className="block font-semibold text-slate-900">{s.store_name}</span><span className="block text-xs text-slate-500">{[s.store_code, s.city].filter(Boolean).join(" · ")}</span>
                    </button></li>
                ))}
            </ul>
        </div>
    );
}

const Field = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
    <label className={cn("block space-y-1", className)}><span className="block text-xs font-semibold text-slate-600">{label}</span>{children}</label>
);

/* ---------------- Plant ---------------- */

/** urgent: its request was marked urgent by the ASM or head office (the list puts these first). */
type PlantLine = HistoryLine & { portal_store_name: string | null; updated_by_name: string | null; needs_reason: boolean; address: string | null; urgent?: boolean; urgent_by?: string | null };
const isUrgentOpen = (l: PlantLine) => Boolean(l.urgent) && !['Dispatched', 'In Transit', 'Delivered', 'Return'].includes(l.status);

/** The plant's part of a line: status, dates, docket, courier, reason, remarks. */
function PlantEdit({ l, onClose, onSaved }: { l: PlantLine; onClose: () => void; onSaved: () => void }) {
    const { toast } = useToast();
    const [f, setF] = useState({
        status: l.status, expected_dispatch: l.expected_dispatch ?? "", dispatch_date: l.dispatch_date ?? "", docket_no: l.docket_no ?? "", courier: l.courier ?? "", reason: l.reason ?? "", remarks: l.remarks ?? "",
    });
    const [saving, setSaving] = useState(false);
    const needsReason = (f.status === "On hold" || f.status === "Out of stock") && !f.reason.trim();
    const save = async () => {
        setSaving(true);
        try { await api.put(`/posm/admin/history/plant/lines/${l.id}`, f); toast({ title: "Saved" }); onSaved(); onClose(); }
        catch (e) { toast({ title: "Could not save", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }
        finally { setSaving(false); }
    };
    const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
    return (
        <Dialog open onOpenChange={v => { if (!v && !saving) onClose(); }}>
            <DialogContent className="max-h-[92vh] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="pr-8 text-lg font-black">{l.item} × {l.qty}{l.design ? ` · ${l.design}` : ""}</DialogTitle>
                    <DialogDescription>{[l.portal_store_name || l.sheet_store_name, DEPOT_LABEL[l.source] ?? l.source, l.request_date ? `asked ${shortDate(l.request_date)}` : null, [l.major_colour, l.minor_colour].filter(Boolean).join(" / ")].filter(Boolean).join(" · ")}</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Status" className="sm:col-span-2"><select value={f.status} onChange={set("status")} className={cn(sel, "w-full")}>{POSM_STATUSES.map(s => <option key={s}>{s}</option>)}</select></Field>
                    <Field label="Expected dispatch"><Input type="date" value={f.expected_dispatch} onChange={set("expected_dispatch")} className="h-9" /></Field>
                    <Field label="Dispatch date"><Input type="date" value={f.dispatch_date} max={istToday()} onChange={set("dispatch_date")} className="h-9" /></Field>
                    <Field label="Docket number"><Input value={f.docket_no} onChange={set("docket_no")} className="h-9" /></Field>
                    <Field label="Mode / courier"><Input value={f.courier} onChange={set("courier")} className="h-9" list="posm-couriers" /></Field>
                    <Field label={needsReason ? "Reason (hold / delay / status change): needed" : "Reason (hold / delay / status change)"} className="sm:col-span-2">
                        <textarea value={f.reason} onChange={set("reason")} rows={2} className={cn("w-full rounded-md border px-3 py-2 text-sm", needsReason ? "border-rose-400 bg-rose-50" : "border-slate-300")} /></Field>
                    <Field label="Remarks" className="sm:col-span-2"><textarea value={f.remarks} onChange={set("remarks")} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></Field>
                    {l.address && <p className="text-xs text-slate-500 sm:col-span-2"><b>Send to:</b> {l.address}</p>}
                    {(l.dispatch_to || l.ticket_id) && <p className="text-xs text-slate-500 sm:col-span-2">{[l.dispatch_to, l.ticket_id ? `From POSM request ${l.ticket_id}: what you save here shows on the request too` : null].filter(Boolean).join(" · ")}</p>}
                </div>
                <datalist id="posm-couriers"><option>Trackon</option><option>DTDC</option><option>Delhivery</option><option>Blue Dart</option><option>By hand</option><option>Transport</option></datalist>
                <DialogFooter className="gap-2">
                    <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
                    <Button className="bg-orange-500 font-bold hover:bg-orange-600" disabled={saving || needsReason} onClick={save}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** typed: the design was typed in ("Other") rather than picked from the catalog. */
type OrderLine = { item: "FRP" | "Sample Jacket"; design: string; major_colour: string; minor_colour: string; qty: string; typed?: boolean };
const blankLine = (): OrderLine => ({ item: "FRP", design: "", major_colour: "", minor_colour: "", qty: "1" });

/** The Noida office places an FRP / Sample Jacket order with a depot. */
function PlantOrder({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const { toast } = useToast();
    const [depot, setDepot] = useState("");
    const [store, setStore] = useState<Store | null>(null);
    const [brand, setBrand] = useState("AUTOFORM");
    const [address, setAddress] = useState("");
    const [remarks, setRemarks] = useState("");
    const [lines, setLines] = useState<OrderLine[]>([blankLine()]);
    const [approval, setApproval] = useState<string | null>(null);
    const [needs, setNeeds] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const setLine = (i: number, k: keyof OrderLine, v: string) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
    /* FRP designs as the store picks them: the catalog's design table for the brand, which brings its colours. */
    const [frpField, setFrpField] = useState<PosmField | null>(null);
    useEffect(() => {
        api.get("/posm/catalog").then(r => {
            const frp = (r.data.data?.catalog?.items ?? []).find((it: any) => it.id === "frp");
            setFrpField((frp?.fields ?? []).find((f: PosmField) => f.type === "table") ?? null);
        }).catch(() => setFrpField(null));
    }, []);
    const designs: TableRow[] = useMemo(() => (frpField ? tableRows(frpField, brand === "AUTOCRUZE" ? "AC" : "AF") : []), [frpField, brand]);
    const OTHER = "__other__";
    const pickDesign = (i: number, v: string) => setLines(ls => ls.map((l, j) => {
        if (j !== i) return l;
        if (v === OTHER) return { ...l, design: "", major_colour: "", minor_colour: "", typed: true };
        const row = designs.find(d => d.cells[0] === v);
        return { ...l, design: v, major_colour: row?.cells[1] ?? "", minor_colour: row?.cells[2] ?? "", typed: false };
    }));
    /* A Sample Jacket is just a quantity; a brand change clears FRP designs that brand does not have. */
    const setItem = (i: number, item: OrderLine["item"]) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, item, design: "", major_colour: "", minor_colour: "", typed: false } : l)));
    useEffect(() => {
        setLines(ls => ls.map(l => (l.item === "FRP" && !l.typed && l.design && !designs.some(d => d.cells[0] === l.design) ? { ...l, design: "", major_colour: "", minor_colour: "" } : l)));
    }, [designs]);
    const ready = depot && store && lines.length && lines.every(l => Number(l.qty) >= 1 && (l.item !== "FRP" || l.design.trim())) && (!needs || approval?.trim());
    const save = async () => {
        setSaving(true);
        try {
            const r = await api.post("/posm/admin/history/plant/orders", { depot, store_id: store!.id, brand, address, remarks, approval_note: approval ?? undefined, lines: lines.map(({ typed: _typed, ...l }) => ({ ...l, qty: Number(l.qty) })) });
            toast({ title: `${r.data.added} line${r.data.added === 1 ? "" : "s"} sent to the ${depot === "ludhiana" ? "Ludhiana" : "Jaipur"} depot` });
            onSaved(); onClose();
        } catch (e: any) {
            if (e?.response?.status === 409 && e.response.data?.needs_approval) { setNeeds(e.response.data.error); setApproval(""); }
            else toast({ title: "Could not place the order", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setSaving(false); }
    };
    return (
        <Dialog open onOpenChange={v => { if (!v && !saving) onClose(); }}>
            <DialogContent className="max-h-[92vh] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="text-lg font-black">New FRP / Sample Jacket order</DialogTitle>
                    <DialogDescription>It goes to the depot's list for the plant to make and dispatch.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Depot"><select value={depot} onChange={e => setDepot(e.target.value)} className={cn(sel, "w-full")}><option value="">Pick the depot</option><option value="ludhiana">United Ludhiana depot</option><option value="jaipur">Janak Jaipur depot</option></select></Field>
                        <Field label="Branding"><select value={brand} onChange={e => setBrand(e.target.value)} className={cn(sel, "w-full")}><option>AUTOFORM</option><option>AUTOCRUZE</option></select></Field>
                    </div>
                    <Field label="Store"><StorePicker value={store} onPick={s => { setStore(s); setNeeds(null); setApproval(null); }} /></Field>
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-600">Lines</p>
                        {lines.map((l, i) => (
                            <div key={i} className={cn("grid items-end gap-2 rounded-lg border border-slate-200 p-2", l.item === "FRP" ? "grid-cols-2 sm:grid-cols-[130px_1fr_100px_100px_70px_32px]" : "grid-cols-[130px_1fr_70px_32px]")}>
                                <select value={l.item} onChange={e => setItem(i, e.target.value as OrderLine["item"])} className={sel} aria-label="Item"><option>FRP</option><option>Sample Jacket</option></select>
                                {l.item === "FRP" ? (
                                    <>
                                        {l.typed || !designs.length ? (
                                            <Input value={l.design} onChange={e => setLine(i, "design", e.target.value)} placeholder="Design, e.g. U FOCUS" className="h-9" aria-label="Design" />
                                        ) : (
                                            <select value={l.design} onChange={e => pickDesign(i, e.target.value)} className={sel} aria-label="Design">
                                                <option value="">Pick the design</option>
                                                {designs.map(d => <option key={d.cells[0]} value={d.cells[0]}>{d.cells[0]}{d.cells[3] ? ` · ${d.cells[3]}` : ""}</option>)}
                                                <option value={OTHER}>Other (type it)</option>
                                            </select>
                                        )}
                                        <Input value={l.major_colour} onChange={e => setLine(i, "major_colour", e.target.value)} readOnly={!l.typed && designs.length > 0} placeholder="Major colour" className={cn("h-9", !l.typed && designs.length > 0 && "bg-slate-50")} aria-label="Major colour" />
                                        <Input value={l.minor_colour} onChange={e => setLine(i, "minor_colour", e.target.value)} readOnly={!l.typed && designs.length > 0} placeholder="Minor colour" className={cn("h-9", !l.typed && designs.length > 0 && "bg-slate-50")} aria-label="Minor colour" />
                                    </>
                                ) : <span className="self-center text-xs text-slate-500">How many jackets</span>}
                                <Input value={l.qty} onChange={e => setLine(i, "qty", e.target.value.replace(/\D/g, ""))} className="h-9 text-right" aria-label="Quantity" />
                                <button type="button" disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="flex h-9 items-center justify-center text-slate-400 hover:text-rose-600 disabled:opacity-30" aria-label="Remove line"><X className="h-4 w-4" /></button>
                            </div>
                        ))}
                        <Button variant="outline" size="sm" onClick={() => setLines(ls => [...ls, blankLine()])}><Plus className="mr-1 h-3.5 w-3.5" />Add a line</Button>
                    </div>
                    <Field label="Send to (address and contact)"><textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></Field>
                    <Field label="Remarks"><Input value={remarks} onChange={e => setRemarks(e.target.value)} className="h-9" /></Field>
                    {needs && (
                        <div className="space-y-2 rounded-lg bg-amber-50 p-3">
                            <p className="text-sm font-semibold text-amber-800">{needs}</p>
                            <Input value={approval ?? ""} onChange={e => setApproval(e.target.value)} placeholder="Approved by (name and date)" className="h-9 bg-white" aria-label="Approved by" />
                        </div>
                    )}
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
                    <Button className="bg-orange-500 font-bold hover:bg-orange-600" disabled={saving || !ready} onClick={save}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Send to the depot</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function PlantTab({ canEdit, canOrder }: { canEdit: boolean; canOrder: boolean }) {
    const { toast } = useToast();
    const [lines, setLines] = useState<PlantLine[] | null>(null);
    const [depot, setDepot] = useState("all");
    const [status, setStatus] = useState("open");
    const [q, setQ] = useState("");
    const [page, setPage] = useState(0);
    const [editing, setEditing] = useState<PlantLine | null>(null);
    const [ordering, setOrdering] = useState(false);
    const load = useCallback(() => api.get("/posm/admin/history/plant").then(r => setLines(r.data.lines))
        .catch(e => toast({ title: "Could not load the plant lines", description: getErrorMessage(e, "Try again"), variant: "destructive" })), [toast]);
    useEffect(() => { load(); }, [load]);
    const shown = useMemo(() => {
        const term = q.trim().toLowerCase();
        return (lines ?? []).filter(l =>
            (depot === "all" || l.source === depot)
            && (status === "all" ? true : status === "open" ? !["Dispatched", "In Transit", "Delivered", "Return"].includes(l.status) : status === "reason" ? l.needs_reason : status === "urgent" ? isUrgentOpen(l) : l.status === status)
            && (!term || [l.portal_store_name, l.sheet_store_name, l.store_code, l.distributor, l.design, l.docket_no].some(v => String(v ?? "").toLowerCase().includes(term))));
    }, [lines, depot, status, q]);
    useEffect(() => { setPage(0); }, [depot, status, q]);
    if (!lines) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    const count = (f: (l: PlantLine) => boolean) => lines.filter(f).length;
    const rows = shown.slice(page * PAGE, page * PAGE + PAGE);
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                {([["open", `Open (${count(l => !["Dispatched", "In Transit", "Delivered", "Return"].includes(l.status))})`], ["urgent", `Urgent (${count(isUrgentOpen)})`], ["reason", `Reason needed (${count(l => l.needs_reason)})`], ["all", `All (${lines.length})`]] as const).map(([v, label]) => (
                    <button key={v} type="button" onClick={() => setStatus(v)} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold ring-1", status === v ? "bg-slate-900 text-white ring-slate-900" : (v === "reason" && count(l => l.needs_reason)) || (v === "urgent" && count(isUrgentOpen)) ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-white text-slate-600 ring-slate-200")}>{label}</button>
                ))}
                <select value={["open", "urgent", "reason", "all"].includes(status) ? "" : status} onChange={e => setStatus(e.target.value || "all")} className={sel} aria-label="Status"><option value="">Any status</option>{POSM_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
                <select value={depot} onChange={e => setDepot(e.target.value)} className={sel} aria-label="Depot"><option value="all">Both depots</option><option value="Plant - Ludhiana depot">Ludhiana</option><option value="Plant - Jaipur depot">Jaipur</option></select>
                <div className="relative min-w-[200px] flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Store, distributor, design, docket" className="h-9 pl-8" aria-label="Search" /></div>
                {canOrder && <Button className="h-9 bg-orange-500 font-bold hover:bg-orange-600" onClick={() => setOrdering(true)}><Plus className="mr-1.5 h-4 w-4" />New FRP / jacket order</Button>}
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-max min-w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-500 shadow-[0_1px_0_#e2e8f0]">
                        <tr>{["Date", "Depot", "Distributor", "Store", "Old/New", "Item", "Design", "Minor", "Major", "Qty", "Branding", "Dispatch to", "Status", "Expected", "Dispatch", "Docket", "Mode", "Reason", "Remarks", "Last changed by"].map(h => <th key={h} className={th}>{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map(l => (
                            <tr key={l.id} onClick={() => canEdit && setEditing(l)} className={cn(canEdit && "cursor-pointer hover:bg-orange-50/40", isUrgentOpen(l) && "bg-red-50/50")}>
                                <td className={cn(td, "whitespace-nowrap")}>{shortDate(l.request_date)}</td>
                                <td className={td}>{DEPOT_LABEL[l.source] ?? l.source}</td>
                                <td className={cn(td, "min-w-[120px]")}>{l.distributor}</td>
                                <td className={cn(td, "min-w-[160px] font-semibold text-slate-900")}>{isUrgentOpen(l) && <span className="mb-0.5 block w-fit rounded bg-red-600 px-1 text-[10px] font-black uppercase text-white" title={l.urgent_by ? `Marked by ${l.urgent_by}` : undefined}>Urgent</span>}{l.portal_store_name || l.sheet_store_name}{!l.store_id && <span className="block text-[10px] font-semibold text-rose-600">Not linked</span>}{l.ticket_id && <span className="mt-0.5 block w-fit rounded bg-blue-50 px-1 text-[10px] font-semibold text-blue-700">Request {l.ticket_id}</span>}</td>
                                <td className={td}>{l.store_kind}</td>
                                <td className={cn(td, "whitespace-nowrap font-semibold")}>{l.item}</td>
                                <td className={cn(td, "min-w-[110px]")}>{l.design}</td><td className={td}>{l.minor_colour}</td><td className={td}>{l.major_colour}</td>
                                <td className={cn(td, "text-right font-bold tabular-nums")}>{l.qty}</td>
                                <td className={td}>{l.brand}</td>
                                <td className={cn(td, "min-w-[120px]")}>{l.dispatch_to ? l.dispatch_to.replace(/^Direct dispatch to /, "") : ""}</td>
                                <td className={td}><span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 font-semibold", STATUS_TONE(l.status))}>{l.status}</span></td>
                                <td className={cn(td, "whitespace-nowrap", l.expected_dispatch && l.expected_dispatch < istToday() && !["Dispatched", "In Transit", "Delivered"].includes(l.status) && "font-semibold text-rose-600")}>{shortDate(l.expected_dispatch)}</td>
                                <td className={cn(td, "whitespace-nowrap")}>{shortDate(l.dispatch_date)}</td>
                                <td className={cn(td, "font-mono")}>{l.docket_no}</td><td className={td}>{l.courier}</td>
                                <td className={cn(td, "min-w-[160px]", l.needs_reason && "bg-rose-100 font-semibold text-rose-700")}>{l.reason || (l.needs_reason ? "Reason needed" : "")}</td>
                                <td className={cn(td, "min-w-[180px]")}>{l.remarks}</td>
                                <td className={cn(td, "whitespace-nowrap text-slate-500")}>{l.updated_by_name ? `${l.updated_by_name}${l.status_changed_on ? `, ${shortDate(l.status_changed_on)}` : ""}` : ""}</td>
                            </tr>
                        ))}
                        {!rows.length && <tr><td colSpan={20} className="px-4 py-10 text-center text-sm text-slate-500">No line matches.</td></tr>}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-600">
                <span>{shown.length ? `${page * PAGE + 1}–${Math.min(shown.length, page * PAGE + PAGE)} of ${shown.length}` : "0 lines"}</span>
                <span className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= shown.length} onClick={() => setPage(p => p + 1)}>Next</Button>
                </span>
            </div>
            {editing && <PlantEdit l={editing} onClose={() => setEditing(null)} onSaved={load} />}
            {ordering && <PlantOrder onClose={() => setOrdering(false)} onSaved={load} />}
        </div>
    );
}

/* ---------------- Noida office ---------------- */

const NOIDA_ITEMS = POSM_ITEMS.filter(i => i !== "FRP" && i !== "Sample Jacket");

interface Dispatch {
    key: string; line_ids: string[]; store_id: string | null; store_code: string | null; store_name: string | null; distributor: string | null; asm: string | null; state: string | null;
    dispatch_date: string | null; dispatched_by: string | null; courier: string | null; docket_no: string | null; delivery_date: string | null; status: string; remarks: string | null;
    items: Record<string, number>; flags: string[]; tickets?: string[];
}

/** One Noida office dispatch: its details and a quantity per item. New when `d` is null. */
function NoidaEdit({ d, onClose, onSaved }: { d: Dispatch | null; onClose: () => void; onSaved: () => void }) {
    const { toast } = useToast();
    const [store, setStore] = useState<Store | null>(null);
    const [f, setF] = useState({
        dispatch_date: d?.dispatch_date ?? istToday(), dispatched_by: d?.dispatched_by ?? "", courier: d?.courier ?? "", docket_no: d?.docket_no ?? "",
        delivery_date: d?.delivery_date ?? "", status: d?.status ?? "Dispatched", remarks: d?.remarks ?? "",
    });
    const [items, setItems] = useState<Record<string, string>>(Object.fromEntries(NOIDA_ITEMS.map(i => [i, d?.items[i] ? String(d.items[i]) : ""])));
    const [saving, setSaving] = useState(false);
    const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
    const total = Object.values(items).reduce((n, v) => n + (Number(v) || 0), 0);
    const save = async () => {
        setSaving(true);
        try {
            await api.post("/posm/admin/history/noida", { ...f, line_ids: d?.line_ids ?? [], store_id: store?.id, items: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, Number(v) || 0])) });
            toast({ title: d ? "Dispatch saved" : "Dispatch added" }); onSaved(); onClose();
        } catch (e) { toast({ title: "Could not save", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }
        finally { setSaving(false); }
    };
    const remove = async () => {
        if (!d) return;
        setSaving(true);
        try { for (const id of d.line_ids) await api.delete(`/posm/admin/history/lines/${id}`); toast({ title: "Dispatch removed" }); onSaved(); onClose(); }
        catch (e) { toast({ title: "Could not remove", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }
        finally { setSaving(false); }
    };
    return (
        <Dialog open onOpenChange={v => { if (!v && !saving) onClose(); }}>
            <DialogContent className="max-h-[92vh] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="pr-8 text-lg font-black">{d ? d.store_name : "New dispatch"}</DialogTitle>
                    <DialogDescription>{d ? [d.store_code, d.distributor, d.state].filter(Boolean).join(" · ") : "Material sent from the Noida office to a store."}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    {!d && <Field label="Store"><StorePicker value={store} onPick={setStore} /></Field>}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Field label="Dispatch date"><Input type="date" value={f.dispatch_date} max={istToday()} onChange={set("dispatch_date")} className="h-9" /></Field>
                        <Field label="Dispatched by"><Input value={f.dispatched_by} onChange={set("dispatched_by")} className="h-9" /></Field>
                        <Field label="Status"><select value={f.status} onChange={set("status")} className={cn(sel, "w-full")}>{POSM_STATUSES.map(s => <option key={s}>{s}</option>)}</select></Field>
                        <Field label="Courier / transport"><Input value={f.courier} onChange={set("courier")} className="h-9" list="posm-couriers-noida" /></Field>
                        <Field label="Docket no."><Input value={f.docket_no} onChange={set("docket_no")} className="h-9" /></Field>
                        <Field label="Delivery date"><Input type="date" value={f.delivery_date} onChange={set("delivery_date")} className="h-9" /></Field>
                    </div>
                    <datalist id="posm-couriers-noida"><option>Trackon</option><option>DTDC</option><option>Delhivery</option><option>Blue Dart</option><option>By hand</option></datalist>
                    <div>
                        <p className="mb-1 text-xs font-semibold text-slate-600">Items sent <span className="font-normal text-slate-400">· total {total}</span></p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {NOIDA_ITEMS.map(i => (
                                <label key={i} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
                                    <span className="min-w-0 text-xs text-slate-700">{i}</span>
                                    <Input value={items[i]} onChange={e => setItems({ ...items, [i]: e.target.value.replace(/\D/g, "") })} placeholder="0" className="h-8 w-16 text-right" aria-label={i} />
                                </label>
                            ))}
                        </div>
                    </div>
                    <Field label="Remarks"><Input value={f.remarks} onChange={set("remarks")} className="h-9" /></Field>
                </div>
                <DialogFooter className="gap-2 sm:justify-between">
                    {d ? <Button variant="ghost" className="text-rose-600" disabled={saving} onClick={remove}><Trash2 className="mr-1.5 h-4 w-4" />Remove dispatch</Button> : <span />}
                    <span className="flex gap-2">
                        <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
                        <Button className="bg-orange-500 font-bold hover:bg-orange-600" disabled={saving || !total || (!d && !store)} onClick={save}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save</Button>
                    </span>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function NoidaTab({ canEdit }: { canEdit: boolean }) {
    const { toast } = useToast();
    const [rows, setRows] = useState<Dispatch[] | null>(null);
    const [q, setQ] = useState("");
    const [status, setStatus] = useState("all");
    const [page, setPage] = useState(0);
    const [editing, setEditing] = useState<Dispatch | null | "new">(null);
    const load = useCallback(() => api.get("/posm/admin/history/noida").then(r => setRows(r.data.dispatches))
        .catch(e => toast({ title: "Could not load the dispatches", description: getErrorMessage(e, "Try again"), variant: "destructive" })), [toast]);
    useEffect(() => { load(); }, [load]);
    const shown = useMemo(() => {
        const term = q.trim().toLowerCase();
        return (rows ?? []).filter(d => (status === "all" || d.status === status)
            && (!term || [d.store_name, d.store_code, d.distributor, d.asm, d.state, d.docket_no, d.dispatched_by].some(v => String(v ?? "").toLowerCase().includes(term))));
    }, [rows, q, status]);
    useEffect(() => { setPage(0); }, [q, status]);
    if (!rows) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    const page_ = shown.slice(page * PAGE, page * PAGE + PAGE);
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Store, code, distributor, ASM, state, docket" className="h-9 pl-8" aria-label="Search" /></div>
                <select value={status} onChange={e => setStatus(e.target.value)} className={sel} aria-label="Status"><option value="all">All statuses</option>{POSM_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
                {canEdit && <Button className="h-9 bg-orange-500 font-bold hover:bg-orange-600" onClick={() => setEditing("new")}><Plus className="mr-1.5 h-4 w-4" />New dispatch</Button>}
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-max min-w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-500 shadow-[0_1px_0_#e2e8f0]">
                        <tr>
                            {["Dispatch date", "Store", "Code", "Distributor", "ASM", "State", "Dispatched by", "Courier", "Docket no.", "Delivery date", "Status"].map(h => <th key={h} className={th}>{h}</th>)}
                            {NOIDA_ITEMS.map(i => <th key={i} className={cn(th, "text-right")}>{i}</th>)}
                            <th className={th}>Remarks</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {page_.map(d => (
                            <tr key={d.key} onClick={() => canEdit && setEditing(d)} className={cn(canEdit && "cursor-pointer hover:bg-orange-50/40", !d.store_id && "bg-rose-50/40")}>
                                <td className={cn(td, "whitespace-nowrap")}>{shortDate(d.dispatch_date)}</td>
                                <td className={cn(td, "min-w-[160px] font-semibold text-slate-900")}>{d.store_name}{!d.store_id && <span className="block text-[10px] font-semibold text-rose-600">Not linked</span>}{d.tickets?.map(t => <span key={t} className="mt-0.5 block w-fit rounded bg-blue-50 px-1 text-[10px] font-semibold text-blue-700">Request {t}</span>)}</td>
                                <td className={cn(td, "font-mono")}>{d.store_code}</td>
                                <td className={cn(td, "min-w-[120px]")}>{d.distributor}</td><td className={cn(td, "min-w-[100px]")}>{d.asm}</td><td className={td}>{d.state}</td>
                                <td className={td}>{d.dispatched_by}</td><td className={td}>{d.courier}</td><td className={cn(td, "font-mono")}>{d.docket_no}</td>
                                <td className={cn(td, "whitespace-nowrap")}>{shortDate(d.delivery_date)}</td>
                                <td className={td}><span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 font-semibold", STATUS_TONE(d.status))}>{d.status}</span></td>
                                {NOIDA_ITEMS.map(i => <td key={i} className={cn(td, "text-right tabular-nums", !d.items[i] && "text-slate-300")}>{d.items[i] ?? ""}</td>)}
                                <td className={cn(td, "min-w-[180px]")}>{d.remarks}</td>
                            </tr>
                        ))}
                        {!page_.length && <tr><td colSpan={12 + NOIDA_ITEMS.length} className="px-4 py-10 text-center text-sm text-slate-500">No dispatch matches.</td></tr>}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-600">
                <span>{shown.length ? `${page * PAGE + 1}–${Math.min(shown.length, page * PAGE + PAGE)} of ${shown.length} dispatches` : "0 dispatches"}</span>
                <span className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= shown.length} onClick={() => setPage(p => p + 1)}>Next</Button>
                </span>
            </div>
            {editing && <NoidaEdit d={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
        </div>
    );
}

/* ---------------- The plant and Noida sheets ---------------- */

const ago = (iso: string | null) => {
    if (!iso) return "";
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** When POSM dispatch last synced with the plant's and Noida office's Google Sheets, and a way to sync now. */
export function SheetSyncBar({ onSynced }: { onSynced?: () => void }) {
    const { toast } = useToast();
    const [runs, setRuns] = useState<any[] | null>(null);
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => api.get("/posm/admin/history/sheet-sync").then(r => setRuns(r.data.runs)).catch(() => setRuns([])), []);
    useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
    const now = async () => {
        setBusy(true);
        try {
            const r = await api.post("/posm/admin/history/sheet-sync");
            const t = r.data.report.tabs as any[];
            toast({ title: "Synced with the sheets", description: t.map(x => `${x.tab}: ${x.toPortal} to portal, ${x.toSheet} to sheet, ${x.addedToSheet} rows added`).join(" · ") });
            await load(); onSynced?.();
        } catch (e) { toast({ title: "Could not sync", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }
        finally { setBusy(false); }
    };
    if (!runs) return null;
    const last = runs.find(r => r.finished_at);
    const lastOk = runs.find(r => r.ok);
    return (
        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-xs ring-1", last && !last.ok ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-white text-slate-600 ring-slate-200")}>
            <span className="font-semibold">Plant & Noida sheets</span>
            {last && !last.ok
                ? <span>Last sync failed {ago(last.finished_at)}: {String(last.error ?? "").slice(0, 160)}{lastOk ? ` · last good ${ago(lastOk.finished_at)}` : ""}</span>
                : lastOk ? <span>Synced {ago(lastOk.finished_at)}, both ways, every 5 minutes</span> : <span>Not synced yet</span>}
            <Button size="sm" variant="outline" className="ml-auto h-7 px-2.5 text-xs" disabled={busy} onClick={now}>{busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Sync now</Button>
        </div>
    );
}
