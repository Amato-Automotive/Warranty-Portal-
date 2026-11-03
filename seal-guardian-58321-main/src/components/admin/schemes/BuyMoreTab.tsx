import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, Search } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, downloadCSV } from "@/lib/utils";
import { SET_KINDS, type Sets } from "@/lib/buyMoreReader";
import { buildActivity, OFFER_LABEL, readyAfter, setsLine, shortDay, stampDay, type AdminBuyMore, type AdminBuyMoreInvoice, type AdminBuyMoreStore, type AdminFreeSet } from "@/lib/sellMore";

/**
 * Option 2, Buy More Get More, for the admin: invoices reviewed one at a time,
 * oldest first, beside what the reader found and what the store said; each
 * store's balance and what it is ready for; and its redeem requests. Approving
 * a request uses the sets, which the admin can change; the rest carry forward.
 */

const label = (k: (typeof SET_KINDS)[number]) => (k === "other" ? "Other" : k[0].toUpperCase() + k.slice(1));
const total = (s: Sets) => SET_KINDS.reduce((n, k) => n + (s[k] || 0), 0);
const clampSet = (v: string) => Math.max(0, Math.min(500, Math.floor(Number(v) || 0)));

/** One file of an invoice: a photo or the PDF itself, with a way to open it full size. */
function Preview({ files }: { files: AdminBuyMoreInvoice["files"] }) {
    const [i, setI] = useState(0);
    const f = files[Math.min(i, files.length - 1)];
    if (!f) return <div className="grid h-96 place-items-center rounded-lg bg-slate-100 text-sm text-slate-500">No file</div>;
    const pdf = /\.pdf($|\?)/i.test(f.url) || /\.pdf$/i.test(f.name);
    return (
        <div className="space-y-2">
            <div className="h-[28rem] overflow-auto rounded-lg border border-slate-200 bg-slate-100">
                {pdf ? <iframe key={f.url} src={`${f.url}#view=FitH`} title={f.name} className="h-full w-full bg-white" />
                    : <img src={f.url} alt={f.name} className="mx-auto w-full object-contain" />}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span className="min-w-0 truncate">{f.name}{files.length > 1 ? ` · ${i + 1} of ${files.length}` : ""}</span>
                <span className="flex items-center gap-2">
                    {files.length > 1 && <>
                        <button type="button" className="rounded p-1 hover:text-orange-600 disabled:opacity-30" disabled={i === 0} aria-label="Previous file" onClick={() => setI(n => n - 1)}><ChevronLeft className="h-4 w-4" /></button>
                        <button type="button" className="rounded p-1 hover:text-orange-600 disabled:opacity-30" disabled={i >= files.length - 1} aria-label="Next file" onClick={() => setI(n => n + 1)}><ChevronRight className="h-4 w-4" /></button>
                    </>}
                    <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-orange-700 hover:underline">Open <ExternalLink className="h-3 w-3" /></a>
                </span>
            </div>
        </div>
    );
}

type Review = (inv: AdminBuyMoreInvoice, status: "approved" | "rejected" | "pending", sets: Sets, note: string) => Promise<boolean>;

/** The invoice being reviewed: the file on one side, the sets and the decision on the other. */
function ReviewPanel({ inv, store, onReview }: { inv: AdminBuyMoreInvoice; store: AdminBuyMoreStore | undefined; onReview: Review }) {
    const [sets, setSets] = useState<Sets>(inv.sets);
    const [note, setNote] = useState("");
    const [rejecting, setRejecting] = useState(false);
    const [busy, setBusy] = useState(false);
    const go = async (status: "approved" | "rejected") => {
        setBusy(true);
        try { await onReview(inv, status, sets, note); } finally { setBusy(false); }
    };
    const changed = inv.read_sets && SET_KINDS.filter(k => inv.read_sets![k] !== inv.sets[k]);
    const after = store ? readyAfter(store.available, sets) : null;
    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Preview files={inv.files} />
            <div className="space-y-3">
                <div>
                    <p className="font-semibold text-slate-900">{inv.store_name}{inv.city ? ` · ${inv.city}` : ""}</p>
                    <p className="text-xs text-slate-500">Invoice {inv.invoice_no} · dated {shortDay(inv.invoice_date)} · sent {stampDay(inv.created_at)}</p>
                </div>
                {inv.read_sets === null && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">The store filled these in by hand. The reader didn't read this invoice.</p>}
                {changed && changed.length > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">The store changed what the reader found: {changed.map(k => `${label(k)} ${inv.read_sets![k]} to ${inv.sets[k]}`).join(", ")}.</p>}
                <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                        <tr><th className="py-1.5 font-semibold">Kind</th><th className="py-1.5 text-right font-semibold">Reader found</th><th className="py-1.5 text-right font-semibold">Store says</th><th className="py-1.5 text-right font-semibold">Approve</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {SET_KINDS.map(k => (
                            <tr key={k}>
                                <td className="py-1.5 font-medium text-slate-800">{label(k)}</td>
                                <td className="py-1.5 text-right tabular-nums text-slate-500">{inv.read_sets ? inv.read_sets[k] : "—"}</td>
                                <td className="py-1.5 text-right tabular-nums">{inv.sets[k]}</td>
                                <td className="py-1.5 text-right">
                                    <Input type="number" min={0} max={500} value={sets[k] || ""} placeholder="0" className="ml-auto h-8 w-20 text-right" aria-label={`${label(k)} sets to approve`}
                                        onChange={e => setSets(s => ({ ...s, [k]: clampSet(e.target.value) }))} />
                                </td>
                            </tr>
                        ))}
                        <tr><td className="py-1.5 font-bold">Total</td><td /><td className="py-1.5 text-right font-semibold tabular-nums">{total(inv.sets)}</td><td className="py-1.5 text-right font-bold tabular-nums">{total(sets)}</td></tr>
                    </tbody>
                </table>
                {after && <p className="text-sm text-slate-600">After approval this store has <b className="tabular-nums">{after.total}</b> available{after.offer1 || after.offer2 ? ` and can redeem ${[after.offer1 && "Offer 1", after.offer2 && "Offer 2"].filter(Boolean).join(" or ")}` : ""}.</p>}
                {rejecting ? (
                    <div className="space-y-2">
                        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Why it is rejected. The store sees this." className="h-10" aria-label="Rejection reason" />
                        <div className="flex gap-2">
                            <Button variant="destructive" disabled={busy || !note.trim()} onClick={() => go("rejected")}>Reject and next</Button>
                            <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        <Button className="bg-emerald-600 font-bold hover:bg-emerald-700" disabled={busy || total(sets) <= 0} onClick={() => go("approved")}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Approve and next</Button>
                        <Button variant="outline" className="text-rose-600" disabled={busy} onClick={() => setRejecting(true)}>Reject with reason</Button>
                    </div>
                )}
            </div>
        </div>
    );
}

function RedeemRow({ c, onSet }: { c: AdminFreeSet; onSet: (c: AdminFreeSet, status: "approved" | "rejected" | "requested", used: Sets, note: string) => Promise<unknown> }) {
    const [used, setUsed] = useState<Sets>(c.used);
    const [note, setNote] = useState("");
    const [rejecting, setRejecting] = useState(false);
    const [busy, setBusy] = useState(false);
    const go = async (status: "approved" | "rejected" | "requested") => { setBusy(true); try { await onSet(c, status, used, note); } finally { setBusy(false); } };
    const left = Object.fromEntries(SET_KINDS.map(k => [k, Math.max(0, c.available[k] - (used[k] || 0))])) as Sets;
    return (
        <li className="space-y-3 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 text-sm">
                    <p className="font-semibold text-slate-900">{c.store_name}{c.city ? ` · ${c.city}` : ""}</p>
                    <p className="text-xs text-slate-500">{OFFER_LABEL[c.offer]} · asked {stampDay(c.requested_at)}{c.sent_at ? ` · approved ${stampDay(c.sent_at)}` : ""}</p>
                </div>
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", c.status === "approved" ? "bg-emerald-100 text-emerald-800" : c.status === "rejected" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800")}>
                    {c.status === "approved" ? "Approved" : c.status === "rejected" ? "Rejected" : "Waiting"}
                </span>
            </div>
            {c.status === "requested" ? (
                <>
                    <p className="text-xs text-slate-500">Available: {setsLine(c.available, "Other") || "none"}</p>
                    <div className="flex flex-wrap items-end gap-2">
                        {SET_KINDS.map(k => (
                            <label key={k} className="space-y-1"><span className="block text-xs text-slate-500">Use {label(k)}</span>
                                <Input type="number" min={0} max={500} value={used[k] || ""} placeholder="0" className="h-9 w-20 text-right" aria-label={`${label(k)} sets to use for ${c.store_name}`}
                                    onChange={e => setUsed(s => ({ ...s, [k]: clampSet(e.target.value) }))} /></label>
                        ))}
                        <p className="pb-2 text-sm font-bold tabular-nums">Total {total(used)}</p>
                    </div>
                    <p className="text-sm font-semibold text-slate-800">After approval: {setsLine(left, "Other") || "nothing left"}</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Input value={note} onChange={e => setNote(e.target.value)} placeholder={rejecting ? "Why it is rejected. The store sees this." : "What was sent"} className="h-9" aria-label={rejecting ? "Rejection reason" : "What was sent"} />
                        {rejecting ? (
                            <>
                                <Button size="sm" variant="destructive" className="h-9" disabled={busy || !note.trim()} onClick={() => go("rejected")}>Reject</Button>
                                <Button size="sm" variant="ghost" className="h-9" onClick={() => setRejecting(false)}>Cancel</Button>
                            </>
                        ) : (
                            <>
                                <Button size="sm" className="h-9 shrink-0 bg-emerald-600 hover:bg-emerald-700" disabled={busy || total(used) <= 0} onClick={() => go("approved")}>Approve</Button>
                                <Button size="sm" variant="outline" className="h-9 shrink-0 text-rose-600" disabled={busy} onClick={() => setRejecting(true)}>Reject</Button>
                            </>
                        )}
                    </div>
                </>
            ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-slate-700">{c.status === "approved" ? `Used: ${setsLine(c.used, "Other")}` : ""}{c.note ? `${c.status === "approved" ? " · " : ""}${c.note}` : ""}</span>
                    <button type="button" className="text-xs text-slate-400 hover:text-orange-600" disabled={busy} onClick={() => go("requested")}>Undo</button>
                </div>
            )}
        </li>
    );
}

/** What a store still needs for its closest offer, for the table. */
function readyText(s: AdminBuyMoreStore) {
    const e = s.eligibility;
    const ready = [e.offer1.ready && "Offer 1", e.offer2_ready && "Offer 2"].filter(Boolean).join(", ");
    if (ready) return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">{ready}</span>;
    return <span className="text-xs text-slate-500">{e.offer1.more} sets to Offer 1</span>;
}

export function BuyMoreTab({ schemeId, refreshKey }: { schemeId: string; refreshKey: number }) {
    const { toast } = useToast();
    const [d, setD] = useState<AdminBuyMore | null>(null);
    const [q, setQ] = useState("");
    const [view, setView] = useState<"review" | "redeem" | "stores" | "history">("review");
    const [at, setAt] = useState(0);
    const [open, setOpen] = useState<string | null>(null);

    const load = useCallback(() => api.get(`/schemes/admin/${schemeId}/buy-more`).then(r => setD(r.data))
        .catch(e => toast({ title: "Could not load the invoices", description: getErrorMessage(e, "Try again"), variant: "destructive" })), [schemeId, toast]);
    useEffect(() => { load(); }, [load, refreshKey]);

    const stores = useMemo(() => {
        const term = q.trim().toLowerCase();
        return (d?.stores ?? []).filter(s => !term || [s.store_name, s.store_code, s.city, s.state].some(v => String(v ?? "").toLowerCase().includes(term)))
            .sort((a, b) => b.requests - a.requests || b.eligibility.total - a.eligibility.total || a.store_name.localeCompare(b.store_name));
    }, [d, q]);

    if (!d) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;

    /* Oldest first, so nothing waits longest by accident. */
    const queue = d.invoices.filter(i => i.status === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at));
    const current = queue[Math.min(at, queue.length - 1)];
    const requests = d.free_sets.filter(c => c.status === "requested");
    const given = d.free_sets.filter(c => c.status === "approved").length;

    const review: Review = async (inv, status, sets, note) => {
        try {
            await api.put(`/schemes/admin/${schemeId}/buy-more/invoices/${inv.id}`, { status, sets, note });
            await load();
            toast({ title: status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Moved back to waiting" });
            return true;
        } catch (e) {
            toast({ title: "Could not update the invoice", description: getErrorMessage(e, "Try again"), variant: "destructive" });
            return false;
        }
    };
    const setRedeem = async (c: AdminFreeSet, status: "approved" | "rejected" | "requested", used: Sets, note: string) => {
        try {
            await api.put(`/schemes/admin/${schemeId}/buy-more/free-sets/${c.id}`, { status, used, note });
            await load();
            toast({ title: status === "approved" ? "Approved. The sets are used." : status === "rejected" ? "Rejected" : "Undone" });
        } catch (e) {
            toast({ title: "Could not update the request", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        }
    };

    const exportRows = () => downloadCSV(stores.map(s => ({
        "Store": s.store_name, "Code": s.store_code ?? "", "City": s.city ?? "", "State": s.state ?? "", "Brand": s.brand, "Opted on": stampDay(s.opted_at),
        ...Object.fromEntries(SET_KINDS.map(k => [`${label(k)} available`, s.available[k]])),
        "Approved sets": total(s.approved), "Used sets": total(s.used), "Available sets": s.eligibility.total, "Waiting sets": s.waiting_sets,
        "Offer 1 ready": s.eligibility.offer1.ready ? "Yes" : "No", "Offer 2 ready": s.eligibility.offer2_ready ? "Yes" : "No", "Free sets given": s.rewards,
    })), "buy_more_get_more.csv");

    const tabs = [["review", `Invoices to review (${queue.length})`], ["redeem", `Redeem requests (${requests.length})`], ["stores", `Stores (${d.stores.length})`], ["history", "All invoices"]] as const;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-4 [&>div]:bg-white [&>div]:px-4 [&>div]:py-3">
                <div><p className="text-xs text-slate-500">Opted Option 2</p><p className="text-2xl font-bold tabular-nums">{d.stores.length}</p></div>
                <div><p className="text-xs text-slate-500">Invoices waiting</p><p className={cn("text-2xl font-bold tabular-nums", queue.length && "text-amber-700")}>{queue.length}</p></div>
                <div><p className="text-xs text-slate-500">Redeem requests waiting</p><p className={cn("text-2xl font-bold tabular-nums", requests.length && "text-amber-700")}>{requests.length}</p></div>
                <div><p className="text-xs text-slate-500">Free sets given</p><p className="text-2xl font-bold tabular-nums">{given}</p></div>
            </div>

            <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm font-semibold">
                {tabs.map(([v, text]) => (
                    <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                        className={cn("rounded-md px-3 py-1.5", view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{text}</button>
                ))}
            </div>

            {view === "review" && (
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                    {current ? (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2 text-sm">
                                <p className="font-semibold text-slate-700">{Math.min(at, queue.length - 1) + 1} of {queue.length}, oldest first</p>
                                <span className="flex gap-1">
                                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={at <= 0} aria-label="Previous invoice" onClick={() => setAt(n => n - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={at >= queue.length - 1} aria-label="Next invoice" onClick={() => setAt(n => n + 1)}><ChevronRight className="h-4 w-4" /></Button>
                                </span>
                            </div>
                            <ReviewPanel key={current.id} inv={current} store={d.stores.find(s => s.store_id === current.store_id)} onReview={review} />
                        </div>
                    ) : <p className="py-10 text-center text-sm text-slate-500">No invoices waiting.</p>}
                </section>
            )}

            {view === "redeem" && (
                <section className="rounded-xl border border-slate-200 bg-white">
                    {d.free_sets.length
                        ? <ul className="divide-y divide-slate-100">{d.free_sets.map(c => <RedeemRow key={`${c.id}-${c.status}`} c={c} onSet={setRedeem} />)}</ul>
                        : <p className="px-4 py-10 text-center text-sm text-slate-500">No redeem requests yet.</p>}
                </section>
            )}

            {view === "history" && (
                <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2.5 font-semibold">Sent</th><th className="px-3 py-2.5 font-semibold">Store</th><th className="px-3 py-2.5 font-semibold">Invoice</th><th className="px-3 py-2.5 font-semibold">Sets</th><th className="px-3 py-2.5 font-semibold">Status</th><th className="px-3 py-2.5" /></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                            {d.invoices.map(inv => (
                                <tr key={inv.id}>
                                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{stampDay(inv.created_at)}</td>
                                    <td className="px-3 py-2 font-medium text-slate-900">{inv.store_name}</td>
                                    <td className="px-3 py-2">{inv.invoice_no}<span className="block text-xs text-slate-500">{shortDay(inv.invoice_date)} · {inv.files.map(f => <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="mr-2 text-orange-700 underline">{f.name}</a>)}</span></td>
                                    <td className="px-3 py-2 text-slate-700">{setsLine(inv.sets, "Other")}</td>
                                    <td className="whitespace-nowrap px-3 py-2"><span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", inv.status === "approved" ? "bg-emerald-100 text-emerald-800" : inv.status === "rejected" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800")}>{inv.status === "approved" ? "Approved" : inv.status === "rejected" ? "Rejected" : "Waiting"}</span>{inv.review_note && <span className="block text-xs text-slate-500">{inv.review_note}</span>}</td>
                                    <td className="px-3 py-2 text-right">{inv.status !== "pending" && <button type="button" className="text-xs text-slate-400 hover:text-orange-600" onClick={() => review(inv, "pending", inv.sets, "")}>Undo</button>}</td>
                                </tr>
                            ))}
                            {!d.invoices.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">No invoices yet.</td></tr>}
                        </tbody>
                    </table>
                </section>
            )}

            {view === "stores" && (
                <>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store, code, city or state" className="h-9 pl-8" aria-label="Search stores" />
                        </div>
                        <Button variant="outline" size="sm" className="h-9" onClick={exportRows} disabled={!stores.length}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                        <table className="w-full min-w-[920px] text-sm">
                            <thead className="bg-slate-50 text-left text-xs text-slate-500">
                                <tr>
                                    <th className="w-8 px-2 py-2.5" />
                                    <th className="px-3 py-2.5 font-semibold">Store</th>
                                    {SET_KINDS.map(k => <th key={k} className="px-3 py-2.5 text-right font-semibold">{label(k)}</th>)}
                                    <th className="px-3 py-2.5 text-right font-semibold">Available</th>
                                    <th className="px-3 py-2.5 text-right font-semibold">Approved</th>
                                    <th className="px-3 py-2.5 text-right font-semibold">Used</th>
                                    <th className="px-3 py-2.5 text-right font-semibold">Waiting</th>
                                    <th className="px-3 py-2.5 font-semibold">Ready for</th>
                                    <th className="px-3 py-2.5 text-right font-semibold">Free given</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {stores.map(s => {
                                    const mine = d.invoices.filter(i => i.store_id === s.store_id);
                                    const claims = d.free_sets.filter(c => c.store_id === s.store_id);
                                    return (
                                        <Fragment key={s.store_id}>
                                            <tr className="hover:bg-orange-50/40">
                                                <td className="px-2 py-2">
                                                    <button type="button" onClick={() => setOpen(o => (o === s.store_id ? null : s.store_id))} className="rounded p-1 text-slate-400 hover:text-orange-600" aria-label={`Activity for ${s.store_name}`} aria-expanded={open === s.store_id}>
                                                        {open === s.store_id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                    </button>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <p className="font-semibold text-slate-900">{s.store_name}</p>
                                                    <p className="text-xs text-slate-500">{[s.store_code, s.city, s.state, s.brand === "AFAC" ? "AF+AC" : s.brand].filter(Boolean).join(" · ")}</p>
                                                </td>
                                                {SET_KINDS.map(k => <td key={k} className="px-3 py-2 text-right tabular-nums">{s.available[k]}</td>)}
                                                <td className="px-3 py-2 text-right font-bold tabular-nums">{s.eligibility.total}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{total(s.approved)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{total(s.used)}</td>
                                                <td className={cn("px-3 py-2 text-right tabular-nums", s.waiting_sets ? "font-semibold text-amber-700" : "text-slate-300")}>{s.waiting_sets}</td>
                                                <td className="whitespace-nowrap px-3 py-2">{readyText(s)}</td>
                                                <td className="px-3 py-2 text-right font-bold tabular-nums">{s.rewards}</td>
                                            </tr>
                                            {open === s.store_id && (
                                                <tr className="bg-slate-50">
                                                    <td colSpan={SET_KINDS.length + 8} className="px-4 py-3">
                                                        {mine.length || claims.length ? (
                                                            <table className="w-full rounded-lg bg-white text-xs">
                                                                <thead className="text-left text-slate-400"><tr><th className="px-3 py-1.5 font-semibold">Date</th><th className="px-3 py-1.5 font-semibold">What</th><th className="px-3 py-1.5 font-semibold">Sets</th><th className="px-3 py-1.5 text-right font-semibold">Balance</th><th className="px-3 py-1.5 font-semibold">Status</th></tr></thead>
                                                                <tbody className="divide-y divide-slate-50">
                                                                    {buildActivity(mine, claims.map(c => ({ ...c, used: c.status === "approved" ? c.used : null }))).map(a => (
                                                                        <tr key={a.id}>
                                                                            <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{stampDay(a.at)}</td>
                                                                            <td className="px-3 py-1.5 text-slate-800">{a.kind === "invoice" ? `Invoice ${a.title}` : OFFER_LABEL[a.title as keyof typeof OFFER_LABEL]}</td>
                                                                            <td className="px-3 py-1.5 text-slate-700">{a.sets ? `${a.kind === "invoice" ? "+" : "−"} ${setsLine(a.sets, "Other")}` : "—"}</td>
                                                                            <td className="px-3 py-1.5 text-right font-bold tabular-nums">{a.balance ?? "—"}</td>
                                                                            <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{a.status}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        ) : <p className="text-sm text-slate-500">No activity yet.</p>}
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                                {!stores.length && <tr><td colSpan={SET_KINDS.length + 8} className="px-4 py-10 text-center text-sm text-slate-500">{d.stores.length ? "No store matches." : "No store has opted yet."}</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
