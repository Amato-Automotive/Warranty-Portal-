import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, FileText, Gift, Loader2, Plus, Upload, X, XCircle } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { readInvoiceFiles } from "@/lib/invoiceOcr";
import { noSets, readSets, SET_KINDS, type SetKind, type Sets } from "@/lib/buyMoreReader";
import { buildActivity, OFFER_LABEL, shortDay, stampDay, SET_LABEL, type ActivityRow, type Offer, type StoreBuyMore } from "@/lib/sellMore";

/**
 * Option 2, Buy More Get More, for a franchise: its sets available, where it
 * stands on each offer and exactly what it still needs, its invoices by month
 * and day, and its redeem requests. It uploads an invoice, the reader fills in
 * the sets, the store checks them and sends it; only what the admin approves
 * counts. When the admin approves a redeem request those sets are used, and the
 * rest stay and carry forward.
 */

const MAX_FILES = 10;
const MAX_MB = 10;
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export function InvoiceForm({ open, schemeId, products, again, onClose, onDone, forStore }: { open: boolean; schemeId: string; products: string[]; forStore?: { id: string; name: string }; again: { invoice_no: string; invoice_date: string } | null; onClose: () => void; onDone: () => Promise<unknown> }) {
    const { toast } = useToast();
    const { t, tr } = useLanguage();
    const [files, setFiles] = useState<File[]>([]);
    const [invoiceNo, setInvoiceNo] = useState("");
    const [invoiceDate, setInvoiceDate] = useState("");
    const [sets, setSets] = useState<Sets>(noSets());
    const [check, setCheck] = useState<SetKind[]>([]);
    const [read, setRead] = useState<Sets | null>(null);
    const [reading, setReading] = useState<string | null>(null);
    const [note, setNote] = useState<"none" | "error" | "found" | null>(null);
    const [readError, setReadError] = useState<string | null>(null);
    const [missed, setMissed] = useState(0);
    const [sending, setSending] = useState(false);

    /* Sending a rejected invoice again: its number and date are already known. */
    useEffect(() => {
        if (open && again) { setInvoiceNo(again.invoice_no); setInvoiceDate(again.invoice_date); }
    }, [open, again]);

    const reset = () => { setFiles([]); setInvoiceNo(""); setInvoiceDate(""); setSets(noSets()); setCheck([]); setRead(null); setReading(null); setNote(null); setReadError(null); setMissed(0); };

    const readThem = async (list: File[]) => {
        if (!list.length) { setSets(noSets()); setCheck([]); setRead(null); setNote(null); return; }
        setReading(tr("Reading the invoice…", "इनवॉइस पढ़ा जा रहा है…"));
        setNote(null); setReadError(null); setMissed(0);
        try {
            const r = readSets(await readInvoiceFiles(list), products);
            const total = SET_KINDS.reduce((n, k) => n + r.sets[k], 0);
            setSets(r.sets); setCheck(r.check); setRead(r.sets); setMissed(r.missed.length);
            setNote(total ? "found" : "none");
        } catch (e) {
            console.error("[Buy More] invoice reading failed:", e);
            setReadError(e instanceof Error ? e.message : String(e));
            setNote("error");
        } finally { setReading(null); }
    };

    const add = (picked: FileList | null) => {
        const good = Array.from(picked ?? []).filter(f => {
            if (f.size <= MAX_MB * 1024 * 1024) return true;
            toast({ title: tr(`${f.name} is over ${MAX_MB} MB`, `${f.name} ${MAX_MB} MB से बड़ी है`), variant: "destructive" });
            return false;
        });
        const next = [...files, ...good].slice(0, MAX_FILES);
        setFiles(next);
        readThem(next);
    };
    const remove = (i: number) => { const next = files.filter((_, j) => j !== i); setFiles(next); readThem(next); };

    const total = SET_KINDS.reduce((n, k) => n + (sets[k] || 0), 0);
    const ready = files.length > 0 && invoiceNo.trim() && invoiceDate && total > 0 && !reading;

    const send = async () => {
        setSending(true);
        try {
            const form = new FormData();
            files.forEach(f => form.append("invoice", f));
            form.append("invoice_no", invoiceNo.trim());
            form.append("invoice_date", invoiceDate);
            form.append("sets", JSON.stringify(sets));
            if (read) form.append("read_sets", JSON.stringify(read));
            if (forStore) form.append("store_id", forStore.id);
            await api.post(forStore ? `/schemes/distributor/${schemeId}/invoices` : `/schemes/${schemeId}/invoices`, form, { headers: { "Content-Type": "multipart/form-data" } });
            toast({ title: tr("Invoice sent for approval", "इनवॉइस मंज़ूरी के लिए भेज दिया गया") });
            reset();
            onClose();
            await onDone();
        } catch (e) {
            toast({ title: tr("Could not send the invoice", "इनवॉइस नहीं भेजा जा सका"), description: getErrorMessage(e, t("Try again")), variant: "destructive" });
        } finally { setSending(false); }
    };

    return (
        <Dialog open={open} onOpenChange={v => { if (!v && !sending) onClose(); }}>
            <DialogContent className="max-h-[90dvh] max-w-[calc(100%-1.5rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto overflow-x-hidden rounded-2xl sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="break-words pr-8 text-lg font-black leading-snug sm:text-xl">{forStore ? `${tr("Add an invoice for", "इनवॉइस जोड़ें:")} ${forStore.name}` : tr("Add an invoice", "इनवॉइस जोड़ें")}</DialogTitle>
                    <DialogDescription>{tr("Upload it and check the sets we read before you send it.", "अपलोड करें और भेजने से पहले पढ़े गए सेट जाँच लें।")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 p-3 text-center text-sm font-medium text-slate-600 hover:border-orange-400 hover:bg-orange-50/40">
                            <Upload className="h-5 w-5 text-slate-400" />
                            {tr("Add the invoice: photo or PDF", "इनवॉइस जोड़ें: फ़ोटो या PDF")}
                            <span className="text-xs font-normal text-slate-500">{tr(`Up to ${MAX_FILES} files, ${MAX_MB} MB each`, `${MAX_FILES} फ़ाइल तक, हर एक ${MAX_MB} MB तक`)}</span>
                            <input type="file" multiple accept="image/*,application/pdf" className="sr-only" aria-label={tr("Invoice files", "इनवॉइस फ़ाइलें")}
                                onChange={e => { add(e.target.files); e.target.value = ""; }} />
                        </label>
                        {files.map((f, i) => (
                            <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                <span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-slate-400" /><span className="truncate">{f.name}</span></span>
                                <button type="button" className="text-slate-400 hover:text-rose-600" aria-label={`${t("Remove")} ${f.name}`} onClick={() => remove(i)}><X className="h-4 w-4" /></button>
                            </div>
                        ))}
                        {reading && <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin text-orange-500" />{reading}</p>}
                        {note === "found" && <p className="text-sm text-emerald-700">{tr("Read. Please check the sets below.", "पढ़ लिया गया। नीचे दिए सेट जाँच लें।")}</p>}
                        {(note === "found" || note === "none") && missed > 0 && <p className="text-sm text-amber-700">{tr(`${missed} line(s) on the invoice were not counted (not a warranty seat cover, or hard to read). Please compare the sets below with your invoice.`, `इनवॉइस की ${missed} लाइन गिनी नहीं गईं (वारंटी सीट कवर नहीं, या पढ़ने में मुश्किल)। कृपया नीचे के सेट अपने इनवॉइस से मिला लें।`)}</p>}
                        {note === "none" && <p className="text-sm text-amber-700">{tr("We couldn't find any sets on it. Please fill them in below.", "इसमें कोई सेट नहीं मिला। कृपया नीचे भरें।")}</p>}
                        {note === "error" && <p className="text-sm text-amber-700">{tr("We couldn't read this file. Please fill in the sets below.", "यह फ़ाइल पढ़ी नहीं जा सकी। कृपया नीचे सेट भरें।")}</p>}
                        {note === "error" && readError && <p className="break-words text-xs text-amber-800/80">Reader error: {readError}</p>}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="min-w-0 space-y-1"><span className="block text-sm font-semibold text-slate-800">{tr("Invoice number", "इनवॉइस नंबर")}</span>
                            <Input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} maxLength={60} className="h-11 w-full min-w-0" /></label>
                        <label className="min-w-0 space-y-1"><span className="block text-sm font-semibold text-slate-800">{tr("Invoice date", "इनवॉइस की तारीख")}</span>
                            <Input type="date" value={invoiceDate} min="2026-11-01" max={istToday()} onChange={e => setInvoiceDate(e.target.value)} className="h-11 w-full min-w-0 appearance-none" /></label>
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm font-semibold text-slate-800">{tr("Sets on this invoice", "इस इनवॉइस में सेट")}</p>
                        {SET_KINDS.map(k => (
                            <label key={k} className="flex items-center justify-between gap-3">
                                <span className="min-w-0 flex-1 text-sm text-slate-700">{k === "other" ? tr("Any other seat cover", "कोई अन्य सीट कवर") : SET_LABEL[k]}
                                    {check.includes(k) && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">{tr("Please check", "जाँच लें")}</span>}</span>
                                <Input type="number" inputMode="numeric" min={0} max={500} value={sets[k] || ""} placeholder="0"
                                    onChange={e => setSets(s => ({ ...s, [k]: Math.max(0, Math.min(500, Math.floor(Number(e.target.value) || 0))) }))}
                                    className="h-10 w-20 shrink-0 text-right sm:w-24" aria-label={SET_LABEL[k]} />
                            </label>
                        ))}
                        <p className="text-right text-sm font-bold text-slate-900">{tr("Total", "कुल")}: {total}</p>
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" className="w-full sm:w-auto" disabled={sending} onClick={onClose}>{t("Cancel")}</Button>
                    <Button className="w-full bg-orange-500 font-bold hover:bg-orange-600 sm:w-auto" disabled={!ready || sending} onClick={send}>
                        {sending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{tr("Send for approval", "मंज़ूरी के लिए भेजें")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Progress({ have, need }: { have: number; need: number }) {
    return (
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className={cn("h-full rounded-full transition-all", have >= need ? "bg-emerald-500" : "bg-orange-500")} style={{ width: `${Math.min(100, (have / need) * 100)}%` }} />
        </div>
    );
}

const setsText = (s: Sets, other: string) => SET_KINDS.filter(k => s[k]).map(k => `${k === "other" ? other : SET_LABEL[k]} × ${s[k]}`).join(", ");

export function BuyMoreView({ schemeId, data, reload }: { schemeId: string; data: StoreBuyMore; reload: () => Promise<unknown> }) {
    const { toast } = useToast();
    const { t, tr, locale } = useLanguage();
    const [adding, setAdding] = useState(false);
    const [redeeming, setRedeeming] = useState<Offer | null>(null);
    const [sending, setSending] = useState(false);
    const [show, setShow] = useState<"all" | "invoice" | "reward">("all");
    const [month, setMonth] = useState("all");
    const [again, setAgain] = useState<{ invoice_no: string; invoice_date: string } | null>(null);
    const e = data.eligibility;
    const open = data.claims.some(c => c.status === "requested");
    const usedTotal = SET_KINDS.reduce((n, k) => n + data.used[k], 0);
    const approvedTotal = SET_KINDS.reduce((n, k) => n + data.approved[k], 0);

    const activity = useMemo(() => buildActivity(data.invoices, data.claims), [data.invoices, data.claims]);
    const monthOf = (at: string) => new Date(new Date(at).getTime() + 5.5 * 3600_000).toISOString().slice(0, 7);
    const monthName = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
    const monthsSeen = useMemo(() => [...new Set(activity.map(a => monthOf(a.at)))], [activity]);
    const shown = activity.filter(a => (show === "all" || a.kind === show) && (month === "all" || monthOf(a.at) === month));
    const groups = useMemo(() => {
        const out = new Map<string, ActivityRow[]>();
        for (const a of shown) out.set(monthOf(a.at), [...(out.get(monthOf(a.at)) ?? []), a]);
        return [...out.entries()];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activity, show, month]);

    /* The closest reward: whichever offer needs fewer sets. */
    const need2 = e.offer2.reduce((n, r) => n + r.more, 0);
    const closest = e.offer1.ready || e.offer2_ready ? null : e.offer1.more <= need2
        ? tr(`Closest reward: ${e.offer1.more} more sets of any kind gets you a free 2-row Amaze.`, `सबसे नज़दीकी रिवॉर्ड: किसी भी तरह के ${e.offer1.more} सेट और, तो 2-रो Amaze मुफ़्त।`)
        : tr(`Closest reward: ${e.offer2.filter(r => r.more).map(r => `${r.more} ${SET_LABEL[r.kind]}`).join(", ")} gets you a free 2-row Amaze.`, `सबसे नज़दीकी रिवॉर्ड: ${e.offer2.filter(r => r.more).map(r => `${r.more} ${SET_LABEL[r.kind]}`).join(", ")} और, तो 2-रो Amaze मुफ़्त।`);

    const redeem = async () => {
        setSending(true);
        try {
            await api.post(`/schemes/${schemeId}/claims`, { offer: redeeming });
            setRedeeming(null);
            toast({ title: tr("Request sent", "रिक्वेस्ट भेज दी गई") });
            await reload();
        } catch (err) {
            toast({ title: tr("Could not send your request", "रिक्वेस्ट नहीं भेजी जा सकी"), description: getErrorMessage(err, t("Try again")), variant: "destructive" });
        } finally { setSending(false); }
    };

    const redeemButton = (offer: Offer, ready: boolean) => ready && (
        open
            ? <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700"><Clock className="h-4 w-4" />{tr("Your request is with head office", "आपकी रिक्वेस्ट हेड ऑफिस के पास है")}</p>
            : <Button className="h-11 w-full bg-orange-500 font-bold hover:bg-orange-600" onClick={() => setRedeeming(offer)}><Gift className="mr-2 h-4 w-4" />{tr("Redeem my free set", "मुफ़्त सेट रिडीम करें")}</Button>
    );

    return (
        <>
            <section className="flex flex-col gap-5 rounded-3xl bg-slate-900 p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
                <div>
                    <p className="text-sm font-semibold text-slate-300">{tr("Sets available", "उपलब्ध सेट")}</p>
                    <p className="mt-1 text-6xl font-black leading-none tabular-nums text-orange-300">{e.total}</p>
                    <p className="mt-2 text-sm text-slate-300">
                        {data.rewards} {data.rewards === 1 ? tr("free set", "मुफ़्त सेट") : tr("free sets", "मुफ़्त सेट")}{data.waiting_sets ? ` · ${data.waiting_sets} ${tr("sets waiting for approval", "सेट मंज़ूरी बाकी")}` : ""}
                    </p>
                </div>
                <Button className="h-12 bg-orange-500 px-6 text-base font-bold hover:bg-orange-600" onClick={() => { setAgain(null); setAdding(true); }}><Plus className="mr-2 h-5 w-5" />{tr("Add an invoice", "इनवॉइस जोड़ें")}</Button>
            </section>

            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 [&>div]:bg-white [&>div]:p-3 sm:[&>div]:p-4">
                <div><p className="text-xs text-slate-500">{tr("Approved so far", "अब तक मंज़ूर")}</p><p className="text-2xl font-black tabular-nums text-slate-900">{approvedTotal}</p></div>
                <div><p className="text-xs text-slate-500">{tr("Used for rewards", "रिवॉर्ड में इस्तेमाल")}</p><p className="text-2xl font-black tabular-nums text-slate-900">{usedTotal}</p></div>
                <div><p className="text-xs text-slate-500">{tr("Available, carried forward", "उपलब्ध, आगे जुड़े")}</p><p className="text-2xl font-black tabular-nums text-orange-700">{e.total}</p></div>
            </div>

            {closest && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{closest}</p>}

            <div className="grid gap-4 md:grid-cols-2">
                <section className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5">
                    <div>
                        <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-blue-700">{tr("Offer 1", "ऑफ़र 1")}</p>
                        <h2 className="text-lg font-black text-slate-900">{tr("Any 12 + 1 free", "कोई भी 12 + 1 मुफ़्त")}</h2>
                        <p className="text-sm text-slate-600">{tr("Buy any 12 seat cover sets, get 1 set of 2-row Amaze free.", "कोई भी 12 सीट कवर सेट खरीदें, 1 सेट 2-रो Amaze मुफ़्त।")}</p>
                    </div>
                    <p className="text-sm font-semibold text-slate-900">{e.offer1.have} / 12 {tr("sets", "सेट")}</p>
                    <Progress have={e.offer1.have} need={12} />
                    {e.offer1.ready
                        ? <p className="text-sm font-bold text-emerald-700">{tr("You have enough sets for this offer", "इस ऑफ़र के लिए आपके पास पूरे सेट हैं")}</p>
                        : <p className="text-sm font-bold text-orange-700">{tr(`${e.offer1.more} more sets needed`, `${e.offer1.more} सेट और चाहिए`)}</p>}
                    <div className="mt-auto">{redeemButton("offer1", e.offer1.ready)}</div>
                </section>

                <section className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5">
                    <div>
                        <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-blue-700">{tr("Offer 2", "ऑफ़र 2")}</p>
                        <h2 className="text-lg font-black text-slate-900">{tr("Premium mix 7 + 1 free", "प्रीमियम मिक्स 7 + 1 मुफ़्त")}</h2>
                        <p className="text-sm text-slate-600">{tr("Buy this mix of 7 sets, get 1 set of 2-row Amaze free.", "7 सेट का यह मिक्स खरीदें, 1 सेट 2-रो Amaze मुफ़्त।")}</p>
                    </div>
                    <ul className="space-y-2">
                        {e.offer2.map(row => (
                            <li key={row.kind} className="space-y-1">
                                <p className="flex items-center justify-between text-sm">
                                    <span className="font-semibold text-slate-800">{SET_LABEL[row.kind]}</span>
                                    <span className={cn("font-bold tabular-nums", row.more ? "text-slate-700" : "text-emerald-700")}>{row.have} / {row.need}{!row.more && " ✓"}</span>
                                </p>
                                <Progress have={row.have} need={row.need} />
                            </li>
                        ))}
                    </ul>
                    {e.offer2_ready
                        ? <p className="text-sm font-bold text-emerald-700">{tr("You have enough sets for this offer", "इस ऑफ़र के लिए आपके पास पूरे सेट हैं")}</p>
                        : <p className="text-sm font-bold text-orange-700">{tr("Still needed: ", "अभी चाहिए: ")}{e.offer2.filter(r => r.more).map(r => `${r.more} ${SET_LABEL[r.kind]}`).join(", ")}</p>}
                    <div className="mt-auto">{redeemButton("offer2", e.offer2_ready)}</div>
                </section>
            </div>

            <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-extrabold text-slate-900">{tr("Activity", "गतिविधि")}</h2>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                        <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                            {([["all", tr("All", "सभी")], ["invoice", tr("Invoices", "इनवॉइस")], ["reward", tr("Rewards", "रिवॉर्ड")]] as const).map(([v, text]) => (
                                <button key={v} type="button" onClick={() => setShow(v)} aria-pressed={show === v} className={cn("rounded-md px-2.5 py-1", show === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{text}</button>
                            ))}
                        </div>
                        <select value={month} onChange={ev => setMonth(ev.target.value)} aria-label={tr("Month", "महीना")} className="h-8 rounded-lg border border-slate-200 bg-white px-2">
                            <option value="all">{tr("All months", "सभी महीने")}</option>
                            {monthsSeen.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
                        </select>
                    </div>
                </div>
                {groups.length ? groups.map(([key, rows]) => (
                    <div key={key} className="space-y-1">
                        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">{monthName(key)}</p>
                        <ul className="divide-y divide-slate-100">
                            {rows.map(a => (
                                <li key={a.id} className="space-y-1 py-3 text-sm">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-semibold text-slate-900">{stampDay(a.at, locale)} · {a.kind === "invoice" ? `${tr("Invoice", "इनवॉइस")} ${a.title}` : OFFER_LABEL[a.title as Offer]}</span>
                                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold", a.state === "good" ? "bg-emerald-100 text-emerald-800" : a.state === "bad" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800")}>
                                            {a.state === "good" ? <CheckCircle2 className="h-3.5 w-3.5" /> : a.state === "bad" ? <XCircle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                                            {a.status === "Approved" ? tr("Approved", "मंज़ूर") : a.status === "Rejected" ? tr("Rejected", "अस्वीकृत") : a.status === "Waiting" ? tr("Waiting for approval", "मंज़ूरी बाकी") : a.status === "Requested" ? tr("Requested", "रिक्वेस्ट की गई") : tr("Reward approved", "रिवॉर्ड मंज़ूर")}
                                        </span>
                                    </div>
                                    {a.sets && <p className="text-slate-600">{a.kind === "invoice" ? "+ " : "− "}{setsText(a.sets, tr("Other", "अन्य"))}{a.balance !== null ? ` · ${tr("balance", "बैलेंस")} ${a.balance}` : ""}</p>}
                                    {a.note && <p className={a.state === "bad" ? "text-rose-700" : "text-slate-600"}>{a.note}</p>}
                                    {a.invoice && (
                                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                            {a.invoice.files.map(f => <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="font-medium text-orange-700 underline">{f.name}</a>)}
                                            {a.invoice.status === "rejected" && (
                                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setAgain({ invoice_no: a.invoice!.invoice_no, invoice_date: a.invoice!.invoice_date }); setAdding(true); }}>{tr("Send again", "फिर से भेजें")}</Button>
                                            )}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )) : <p className="text-sm text-slate-500">{activity.length ? tr("Nothing matches this filter.", "इस फ़िल्टर में कुछ नहीं।") : tr("No invoices yet. Add your first one above.", "अभी कोई इनवॉइस नहीं। ऊपर से पहला जोड़ें।")}</p>}
            </section>

            <InvoiceForm open={adding} schemeId={schemeId} products={data.products} again={again} onClose={() => setAdding(false)} onDone={reload} />

            <Dialog open={redeeming !== null} onOpenChange={v => { if (!v && !sending) setRedeeming(null); }}>
                <DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black">{tr("Redeem your free set?", "मुफ़्त सेट रिडीम करें?")}</DialogTitle>
                        <DialogDescription>{redeeming ? OFFER_LABEL[redeeming] : ""}. {tr("When head office approves, these sets are used and the rest carry forward.", "हेड ऑफिस की मंज़ूरी पर ये सेट इस्तेमाल हो जाएँगे और बाकी आगे जुड़ेंगे।")}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" disabled={sending} onClick={() => setRedeeming(null)}>{t("Cancel")}</Button>
                        <Button className="bg-orange-500 font-bold hover:bg-orange-600" disabled={sending} onClick={redeem}>
                            {sending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{tr("Send request", "रिक्वेस्ट भेजें")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
