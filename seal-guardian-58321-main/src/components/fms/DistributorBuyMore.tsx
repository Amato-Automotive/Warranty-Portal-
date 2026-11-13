import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Clock, Download, Loader2, Plus, XCircle } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn, downloadCSV } from "@/lib/utils";
import { SET_KINDS, type Sets } from "@/lib/buyMoreReader";
import { SET_LABEL, setsLine, shortDay, stampDay, type DistributorBuyMore as Data } from "@/lib/sellMore";
import { InvoiceForm } from "./BuyMoreView";
import { Banner, terms } from "./SellMoreView";

/**
 * Buy More Get More for a distributor: only its own stores that are in the
 * scheme, each with its sets, and a way to add an invoice for a store. The
 * admin approves the invoice like any other. A distributor cannot redeem; the
 * store does that.
 */

const total = (s: Sets) => SET_KINDS.reduce((n, k) => n + (s[k] || 0), 0);
type SchemeRow = { id: string; title: string; stores: number };

/** `children` (the other schemes) show between the stores and the terms, so the terms stay last on the page. */
export function DistributorBuyMore({ children }: { children?: ReactNode }) {
    const { toast } = useToast();
    const { tr, locale } = useLanguage();
    const [schemes, setSchemes] = useState<SchemeRow[] | null>(null);
    const [schemeId, setSchemeId] = useState<string | null>(null);
    const [d, setD] = useState<Data | null>(null);
    const [adding, setAdding] = useState<string | null>(null);
    const [pick, setPick] = useState("");
    const [open, setOpen] = useState<string | null>(null);

    useEffect(() => {
        api.get("/schemes/distributor").then(r => {
            const list: SchemeRow[] = r.data?.schemes ?? [];
            setSchemes(list);
            setSchemeId(list[0]?.id ?? null);
        }).catch(() => setSchemes([]));
    }, []);

    const load = useCallback(async () => {
        if (!schemeId) return;
        try { setD((await api.get(`/schemes/distributor/${schemeId}`)).data); }
        catch (e) { toast({ title: tr("Could not load your stores", "आपके स्टोर लोड नहीं हो सके"), description: getErrorMessage(e, tr("Try again", "फिर कोशिश करें")), variant: "destructive" }); }
    }, [schemeId, toast, tr]);
    useEffect(() => { setD(null); load(); }, [load]);

    const sums = useMemo(() => {
        const stores = d?.stores ?? [];
        return {
            available: stores.reduce((n, s) => n + s.eligibility.total, 0),
            approved: stores.reduce((n, s) => n + total(s.approved), 0),
            waiting: stores.reduce((n, s) => n + s.invoices.filter(i => i.status === "pending").length, 0),
            free: stores.reduce((n, s) => n + s.rewards, 0),
        };
    }, [d]);

    if (schemes === null || (schemeId && !d)) return <><div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>{children}</>;
    if (!schemes.length || !d) return <>{children}</>;
    const adder = d.stores.find(s => s.store_id === adding);

    const readyFor = (s: Data["stores"][number]) => {
        const r = [s.eligibility.offer1.ready && tr("Offer 1", "ऑफ़र 1"), s.eligibility.offer2_ready && tr("Offer 2", "ऑफ़र 2")].filter(Boolean).join(", ");
        return r ? <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">{r}</span> : <span className="text-xs text-slate-500">{tr("Not yet", "अभी नहीं")}</span>;
    };
    const exportRows = () => downloadCSV(d.stores.map(s => ({
        "Store": s.store_name, "Code": s.store_code ?? "", "City": s.city ?? "", "State": s.state ?? "",
        ...Object.fromEntries(SET_KINDS.map(k => [SET_LABEL[k], s.available[k]])),
        "Available sets": s.eligibility.total, "Waiting invoices": s.invoices.filter(i => i.status === "pending").length, "Free sets given": s.rewards,
    })), "buy_more_my_stores.csv");

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-orange-700">{tr("1 Nov 2026 to 31 Mar 2027", "1 नवंबर 2026 से 31 मार्च 2027")}</p>
                    <h1 className="mt-1 text-2xl font-black text-slate-900 sm:text-3xl">{d.scheme.title}</h1>
                    <p className="mt-1 text-sm text-slate-600">Buy More Get More · {tr("Your stores that are in this scheme", "आपके स्टोर जो इस स्कीम में हैं")}</p>
                </div>
                {schemes.length > 1 && (
                    <select value={schemeId ?? ""} onChange={e => setSchemeId(e.target.value)} aria-label={tr("Scheme", "स्कीम")} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm">
                        {schemes.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </select>
                )}
            </div>

            {d.scheme.banner_url && <Banner url={d.scheme.banner_url} title={d.scheme.title} />}

            <section className="flex flex-col gap-5 rounded-3xl bg-slate-900 p-6 text-white lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p className="text-sm font-semibold text-slate-300">{tr("Sets available across your stores", "आपके सभी स्टोर में उपलब्ध सेट")}</p>
                    <p className="mt-1 text-6xl font-black leading-none tabular-nums text-orange-300">{sums.available}</p>
                </div>
                <div className="flex flex-wrap gap-7">
                    <div><p className="text-xs text-slate-300">{tr("Approved so far", "अब तक मंज़ूर")}</p><p className="text-2xl font-extrabold tabular-nums">{sums.approved}</p></div>
                    <div><p className="text-xs text-slate-300">{tr("Waiting for approval", "मंज़ूरी बाकी")}</p><p className="text-2xl font-extrabold tabular-nums">{sums.waiting} {tr("invoices", "इनवॉइस")}</p></div>
                    <div><p className="text-xs text-slate-300">{tr("Free sets given", "मुफ़्त सेट दिए")}</p><p className="text-2xl font-extrabold tabular-nums">{sums.free}</p></div>
                </div>
                {d.can_add && (
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">{tr("Add an invoice for", "इनवॉइस जोड़ें")}
                            <select value={pick} onChange={e => setPick(e.target.value)} className="h-12 min-w-56 rounded-xl border-0 bg-white px-3 text-[15px] font-normal text-slate-900">
                                <option value="">{tr("Choose a store", "स्टोर चुनें")}</option>
                                {d.stores.map(s => <option key={s.store_id} value={s.store_id}>{s.store_name}{s.city ? ` · ${s.city}` : ""}</option>)}
                            </select>
                        </label>
                        <Button className="h-12 bg-orange-600 px-5 text-base font-bold hover:bg-orange-700" disabled={!pick} onClick={() => setAdding(pick)}><Plus className="mr-1.5 h-5 w-5" />{tr("Add invoice", "इनवॉइस जोड़ें")}</Button>
                    </div>
                )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
                    <h2 className="text-base font-bold text-slate-900">{tr("Your stores in the scheme", "स्कीम में आपके स्टोर")} · {d.stores.length}</h2>
                    <Button variant="outline" size="sm" onClick={exportRows} disabled={!d.stores.length}><Download className="mr-1.5 h-4 w-4" />{tr("Export CSV", "CSV निकालें")}</Button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[960px] text-sm">
                        <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-700">
                            <tr>
                                <th className="w-8 px-2 py-3" />
                                <th scope="col" className="px-3 py-3 font-bold">{tr("Store", "स्टोर")}</th>
                                <th scope="col" className="px-3 py-3 font-bold">{tr("Where", "कहाँ")}</th>
                                {SET_KINDS.map(k => <th key={k} scope="col" className="px-3 py-3 text-right font-bold">{SET_LABEL[k]}</th>)}
                                <th scope="col" className="px-3 py-3 text-right font-bold">{tr("Available", "उपलब्ध")}</th>
                                <th scope="col" className="px-3 py-3 text-right font-bold">{tr("Waiting", "बाकी")}</th>
                                <th scope="col" className="px-3 py-3 font-bold">{tr("Ready for", "तैयार")}</th>
                                <th scope="col" className="px-3 py-3 text-right font-bold">{tr("Free given", "मुफ़्त दिए")}</th>
                                <th className="px-3 py-3" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {d.stores.map(s => (
                                <Fragment key={s.store_id}>
                                    <tr className="hover:bg-orange-50/40">
                                        <td className="px-2 py-3">
                                            <button type="button" className="rounded p-1 text-slate-400 hover:text-orange-600" aria-expanded={open === s.store_id} aria-label={`${s.store_name}`} onClick={() => setOpen(o => (o === s.store_id ? null : s.store_id))}>
                                                {open === s.store_id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                            </button>
                                        </td>
                                        <th scope="row" className="px-3 py-3 text-left font-bold text-slate-900">{s.store_name}</th>
                                        <td className="px-3 py-3 text-slate-700">{[s.city, s.state].filter(Boolean).join(", ")}</td>
                                        {SET_KINDS.map(k => <td key={k} className="px-3 py-3 text-right tabular-nums">{s.available[k]}</td>)}
                                        <td className="px-3 py-3 text-right font-extrabold tabular-nums">{s.eligibility.total}</td>
                                        <td className={cn("px-3 py-3 text-right tabular-nums", s.waiting_sets ? "font-semibold text-amber-700" : "text-slate-300")}>{s.invoices.filter(i => i.status === "pending").length}</td>
                                        <td className="px-3 py-3">{readyFor(s)}</td>
                                        <td className="px-3 py-3 text-right tabular-nums">{s.rewards}</td>
                                        <td className="whitespace-nowrap px-3 py-3 text-right">
                                            {d.can_add && <Button size="sm" className="h-9 bg-orange-600 font-bold hover:bg-orange-700" onClick={() => setAdding(s.store_id)}>{tr("Add invoice", "इनवॉइस जोड़ें")}</Button>}
                                        </td>
                                    </tr>
                                    {open === s.store_id && (
                                        <tr className="bg-slate-50">
                                            <td colSpan={SET_KINDS.length + 8} className="px-5 py-4">
                                                {s.invoices.length ? (
                                                    <ul className="divide-y divide-slate-200 rounded-xl bg-white">
                                                        {s.invoices.map(i => (
                                                            <li key={i.id} className="space-y-1 px-4 py-3 text-sm">
                                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                                    <span className="font-semibold text-slate-900">{stampDay(i.created_at, locale)} · {tr("Invoice", "इनवॉइस")} {i.invoice_no} · {shortDay(i.invoice_date)}</span>
                                                                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold", i.status === "approved" ? "bg-emerald-100 text-emerald-800" : i.status === "rejected" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800")}>
                                                                        {i.status === "approved" ? <CheckCircle2 className="h-3.5 w-3.5" /> : i.status === "rejected" ? <XCircle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                                                                        {i.status === "approved" ? tr("Approved", "मंज़ूर") : i.status === "rejected" ? tr("Rejected", "अस्वीकृत") : tr("Waiting for approval", "मंज़ूरी बाकी")}
                                                                    </span>
                                                                </div>
                                                                <p className="text-slate-600">{setsLine(i.sets, tr("Other", "अन्य"))}</p>
                                                                {i.review_note && <p className="text-rose-700">{i.review_note}</p>}
                                                                <p className="flex flex-wrap gap-3 text-xs">{i.files.map(f => <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="font-medium text-orange-700 underline">{f.name}</a>)}</p>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : <p className="text-sm text-slate-500">{tr("No invoices for this store yet.", "इस स्टोर का अभी कोई इनवॉइस नहीं।")}</p>}
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {children && <div className="pt-3">{children}</div>}

            <section className="rounded-3xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-700">
                <h2 className="mb-2 text-base font-extrabold text-slate-900">{tr("Terms and conditions", "नियम और शर्तें")}</h2>
                <ol className="list-decimal space-y-1.5 pl-5">
                    {/* The franchise rules that also apply here: period, the two offers, no points, eligibility, claims. */}
                    {terms(tr, "buy_more").filter((_, i) => [0, 2, 3].includes(i)).map(line => <li key={line}>{line}</li>)}
                    <li>{tr("Add invoices for your stores in the scheme on this page. Only sets on invoices approved by head office count.", "स्कीम में अपने स्टोर के इनवॉइस इसी पेज पर जोड़ें। हेड ऑफिस से मंज़ूर इनवॉइस के सेट ही गिने जाएँगे।")}</li>
                    <li>{tr("Each store redeems its own free set. A distributor can't redeem.", "हर स्टोर अपना मुफ़्त सेट खुद रिडीम करता है। डिस्ट्रीब्यूटर रिडीम नहीं कर सकता।")}</li>
                    {terms(tr, "buy_more").filter((_, i) => [6, 7, 8].includes(i)).map(line => <li key={line}>{line}</li>)}
                </ol>
                {d.scheme.terms && <p className="mt-3 whitespace-pre-line">{d.scheme.terms}</p>}
            </section>

            {adder && (
                <InvoiceForm open schemeId={d.scheme.id} products={d.products} again={null} forStore={{ id: adder.store_id, name: adder.store_name }}
                    onClose={() => setAdding(null)} onDone={async () => { setAdding(null); setPick(""); await load(); }} />
            )}
        </div>
    );
}
