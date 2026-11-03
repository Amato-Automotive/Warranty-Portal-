import { useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Gift, Loader2, Maximize2, RefreshCw, ShoppingCart, Trophy } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { points, shortDay, stampDay, type StoreSellMore } from "@/lib/sellMore";
import { BuyMoreView } from "./BuyMoreView";

/**
 * Sell More Earn More for a franchise. First it chooses an option, once, with
 * no way back. On Option 1 it then sees what it has earned month by month and
 * day by day, and can ask for its reward. No targets and no store type here.
 */

type T = (en: string, hi: string) => string;

/** The poster's rules, plus the choice being final. */
const terms = (tr: T, option: "sell_more" | "buy_more") => option === "buy_more" ? [
    tr("Program period: 1 Nov 2026 to 31 Mar 2027.", "प्रोग्राम अवधि: 1 नवंबर 2026 से 31 मार्च 2027।"),
    tr("A franchise can choose only one option: Sell More or Buy More. Once chosen, it can't be changed.", "फ्रैंचाइज़ी केवल एक विकल्प चुन सकती है: Sell More या Buy More। एक बार चुनने के बाद इसे बदला नहीं जा सकता।"),
    tr("Offer 1: buy any 12 seat cover sets and get 1 set of 2-row Amaze free.", "ऑफ़र 1: कोई भी 12 सीट कवर सेट खरीदें और 1 सेट 2-रो Amaze मुफ़्त पाएँ।"),
    tr("Offer 2: buy 4 Velora, 1 Doble, 1 Signature and 1 Emporio, 7 sets in total, and get 1 set of 2-row Amaze free.", "ऑफ़र 2: 4 Velora, 1 Doble, 1 Signature और 1 Emporio, कुल 7 सेट खरीदें और 1 सेट 2-रो Amaze मुफ़्त पाएँ।"),
    tr("Add your invoices on this page. Only sets on invoices approved by head office count.", "अपने इनवॉइस इसी पेज पर जोड़ें। हेड ऑफिस से मंज़ूर इनवॉइस के सेट ही गिने जाएँगे।"),
    tr("Redeem from this page when you have enough sets. When head office approves, those sets are used and the rest carry forward.", "पूरे सेट होने पर इसी पेज से रिडीम करें। हेड ऑफिस की मंज़ूरी पर वे सेट इस्तेमाल हो जाएँगे और बाकी आगे जुड़ेंगे।"),
    tr("No point system and no slabs.", "कोई पॉइंट सिस्टम और स्लैब नहीं।"),
    tr("Rewards and free sets as per eligibility.", "रिवॉर्ड और मुफ़्त सेट पात्रता के अनुसार।"),
    tr("Claim through the franchise portal, as applicable.", "क्लेम फ्रैंचाइज़ी पोर्टल से, जहाँ लागू हो।"),
] : [
    tr("Program period: 1 Nov 2026 to 31 Mar 2027.", "प्रोग्राम अवधि: 1 नवंबर 2026 से 31 मार्च 2027।"),
    tr("A franchise can choose only one option: Sell More or Buy More. Once chosen, it can't be changed.", "फ्रैंचाइज़ी केवल एक विकल्प चुन सकती है: Sell More या Buy More। एक बार चुनने के बाद इसे बदला नहीं जा सकता।"),
    tr("Option 1 earns points on every customer warranty registration.", "विकल्प 1 में हर ग्राहक वारंटी रजिस्ट्रेशन पर पॉइंट मिलते हैं।"),
    tr("Head office sets your target each month. You can see your progress on this page.", "हेड ऑफिस हर महीने आपका टारगेट तय करता है। आप अपनी प्रगति इसी पेज पर देख सकते हैं।"),
    tr("Your points are counted every month. You can see them day by day, month by month and in total.", "आपके पॉइंट हर महीने गिने जाते हैं। आप इन्हें दिन, महीने और कुल के हिसाब से देख सकते हैं।"),
    tr("Option 1 points can be redeemed for free 2-row Velora seat covers. The request button opens on this page once you reach your target, once for each month.", "विकल्प 1 के पॉइंट मुफ़्त 2-रो Velora सीट कवर के लिए रिडीम किए जा सकते हैं। टारगेट पूरा होने पर इसी पेज पर रिक्वेस्ट बटन खुलेगा, हर महीने एक बार।"),
    tr("Head office works out your reward and sends it to you.", "हेड ऑफिस आपका रिवॉर्ड तय करके आपको भेजेगा।"),
    tr("Points don't carry forward to the next month (Option 1 only).", "पॉइंट अगले महीने में नहीं जुड़ेंगे (केवल विकल्प 1)।"),
    tr("Rewards and free sets as per eligibility.", "रिवॉर्ड और मुफ़्त सेट पात्रता के अनुसार।"),
    tr("Claim through the franchise portal, as applicable.", "क्लेम फ्रैंचाइज़ी पोर्टल से, जहाँ लागू हो।"),
];

/** A banner that opens the full poster. */
function Banner({ url, title, small }: { url: string; title: string; small?: boolean }) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} aria-label={t("See full poster")}
                className={cn("group relative block w-full overflow-hidden bg-slate-100", small ? "h-36 rounded-2xl" : "h-44 rounded-3xl sm:h-64")}>
                <img src={url} alt="" className="h-full w-full object-cover object-top" />
                <span className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-black/65 px-3 py-1 text-xs font-medium text-white group-hover:bg-black/80">
                    <Maximize2 className="h-3.5 w-3.5" /> {t("See full poster")}
                </span>
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[94vh] max-w-[calc(100%-2rem)] overflow-y-auto p-3 sm:max-w-3xl">
                    <DialogHeader className="px-1">
                        <DialogTitle>{title}</DialogTitle>
                        <DialogDescription className="sr-only">{t("See full poster")}</DialogDescription>
                    </DialogHeader>
                    <img src={url} alt={title} className="w-full rounded-lg" />
                </DialogContent>
            </Dialog>
        </>
    );
}

type SellMoreScheme = { id: string; title: string; terms?: string | null; state: string; banner_url?: string | null; settings?: { option_banners?: { option1?: string; option2?: string } } };

function ChooseOption({ scheme, reload }: { scheme: SellMoreScheme; reload: () => Promise<unknown> }) {
    const { toast } = useToast();
    const { t, tr } = useLanguage();
    const [choosing, setChoosing] = useState<"sell_more" | "buy_more" | null>(null);
    const [accept, setAccept] = useState(false);
    const [saving, setSaving] = useState(false);
    const open = choosing !== null;
    const setOpen = (v: boolean) => { if (!v) setChoosing(null); };
    const pick = (o: "sell_more" | "buy_more") => { setAccept(false); setChoosing(o); };

    const confirm = async () => {
        setSaving(true);
        try {
            await api.post(`/schemes/${scheme.id}/opt`, { option: choosing, accept_terms: true });
            setOpen(false);
            toast({ title: tr("Your choice is saved", "आपका चुनाव सेव हो गया") });
            await reload();
        } catch (e) {
            toast({ title: tr("Could not save your choice", "चुनाव सेव नहीं हुआ"), description: getErrorMessage(e, t("Try again")), variant: "destructive" });
            await reload();
        } finally { setSaving(false); }
    };

    return (
        <>
            <div className="grid gap-4 md:grid-cols-2">
                <section className="flex flex-col gap-4 rounded-3xl border-2 border-orange-300 bg-white p-5 sm:p-6">
                    {scheme.settings?.option_banners?.option1 && <Banner small url={scheme.settings.option_banners.option1} title="Sell More Earn More" />}
                    <div className="flex items-center gap-3">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-700"><Trophy className="h-6 w-6" /></span>
                        <div>
                            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-orange-700">{tr("Option 1", "विकल्प 1")}</p>
                            <h2 className="text-xl font-black text-slate-900">Sell More Earn More</h2>
                        </div>
                    </div>
                    <ul className="space-y-2 text-sm text-slate-700">
                        <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{tr("Points on every customer warranty registration", "हर ग्राहक वारंटी रजिस्ट्रेशन पर पॉइंट")}</li>
                        <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{tr("No bulk purchase requirements", "बल्क खरीद की ज़रूरत नहीं")}</li>
                        <li className="flex gap-2"><Gift className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />{tr("Redeem points for free 2-row Velora seat covers", "पॉइंट से मुफ़्त 2-रो Velora सीट कवर")}</li>
                    </ul>
                    <Button className="mt-auto h-11 bg-orange-500 font-bold hover:bg-orange-600" disabled={scheme.state === "closed"} onClick={() => pick("sell_more")}>
                        {tr("Choose Option 1", "विकल्प 1 चुनें")}
                    </Button>
                </section>

                <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
                    {scheme.settings?.option_banners?.option2 && <Banner small url={scheme.settings.option_banners.option2} title="Buy More Get More" />}
                    <div className="flex items-center gap-3">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-700"><ShoppingCart className="h-6 w-6" /></span>
                        <div>
                            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-blue-700">{tr("Option 2", "विकल्प 2")}</p>
                            <h2 className="text-xl font-black text-slate-900">Buy More Get More</h2>
                        </div>
                    </div>
                    <ul className="space-y-2 text-sm text-slate-700">
                        <li className="flex gap-2"><Gift className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />{tr("Buy any 12 seat cover sets, get 1 set of 2-row Amaze free", "कोई भी 12 सीट कवर सेट खरीदें, 1 सेट 2-रो Amaze मुफ़्त")}</li>
                        <li className="flex gap-2"><Gift className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />{tr("Premium mix: 4 Velora, 1 Doble, 1 Signature, 1 Emporio, get 1 set of 2-row Amaze free", "प्रीमियम मिक्स: 4 Velora, 1 Doble, 1 Signature, 1 Emporio, 1 सेट 2-रो Amaze मुफ़्त")}</li>
                    </ul>
                    <Button className="mt-auto h-11 bg-blue-600 font-bold hover:bg-blue-700" disabled={scheme.state === "closed"} onClick={() => pick("buy_more")}>
                        {tr("Choose Option 2", "विकल्प 2 चुनें")}
                    </Button>
                </section>
            </div>

            <Dialog open={open} onOpenChange={v => !saving && setOpen(v)}>
                <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black">{choosing === "buy_more" ? tr("Choose Option 2: Buy More Get More?", "विकल्प 2 चुनें: Buy More Get More?") : tr("Choose Option 1: Sell More Earn More?", "विकल्प 1 चुनें: Sell More Earn More?")}</DialogTitle>
                        <DialogDescription className="sr-only">{tr("Terms and conditions", "नियम और शर्तें")}</DialogDescription>
                    </DialogHeader>
                    <p className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {tr("You can choose only one option. Once you confirm, you can't change it.", "आप केवल एक विकल्प चुन सकते हैं। पुष्टि के बाद इसे बदला नहीं जा सकता।")}
                    </p>
                    <div>
                        <h3 className="mb-2 text-sm font-extrabold text-slate-900">{tr("Terms and conditions", "नियम और शर्तें")}</h3>
                        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                            {terms(tr, choosing ?? "sell_more").map(line => <li key={line}>{line}</li>)}
                        </ul>
                        {scheme.terms && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{scheme.terms}</p>}
                    </div>
                    <label className="flex cursor-pointer items-start gap-2 text-sm font-medium text-slate-800">
                        <input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-600" />
                        {tr("I've read and accept the terms and conditions", "मैंने नियम और शर्तें पढ़ ली हैं और स्वीकार करता/करती हूँ")}
                    </label>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>{t("Cancel")}</Button>
                        <Button className="bg-orange-500 font-bold hover:bg-orange-600" disabled={!accept || saving} onClick={confirm}>
                            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{tr("Confirm my choice", "मेरा चुनाव पक्का करें")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

/** What's left of a month, in IST, while it is running: days to go, and when points start again. */
function monthNote(key: string) {
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    if (today.slice(0, 7) !== key) return null;
    const [y, m] = key.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { daysLeft: last - Number(today.slice(8)) + 1, isLastMonth: key === "2027-03" };
}

function Earned({ schemeId, data, reload }: { schemeId: string; data: StoreSellMore; reload: () => Promise<unknown> }) {
    const { toast } = useToast();
    const { t, tr, locale } = useLanguage();
    const started = data.months.filter(m => !m.future);
    const [pick, setPick] = useState(started[started.length - 1]?.key);
    const [asking, setAsking] = useState(false);
    const [sending, setSending] = useState(false);
    const month = started.find(m => m.key === pick) ?? started[started.length - 1];
    const note = month ? monthNote(month.key) : null;

    const redeem = async () => {
        setSending(true);
        try {
            await api.post(`/schemes/${schemeId}/redeem`, { month: month?.key });
            setAsking(false);
            toast({ title: tr("Request sent", "रिक्वेस्ट भेज दी गई") });
            await reload();
        } catch (e) {
            toast({ title: tr("Could not send your request", "रिक्वेस्ट नहीं भेजी जा सकी"), description: getErrorMessage(e, t("Try again")), variant: "destructive" });
        } finally { setSending(false); }
    };

    return (
        <>
            {month && (
                <section className="flex flex-col gap-5 rounded-3xl bg-slate-900 p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
                    <div>
                        <p className="text-sm font-semibold text-slate-300">{tr("Points earned", "मिले पॉइंट")} · {month.label}</p>
                        <p className="mt-1 text-6xl font-black leading-none tabular-nums text-orange-300">{points(month.points)}</p>
                        <p className="mt-2 text-sm text-slate-300">
                            {month.warranties.toLocaleString("en-IN")} {tr("warranties", "वारंटी")}
                            {note && ` · ${note.daysLeft} ${note.daysLeft === 1 ? t("day left") : t("days left")}`}
                            {note && !note.isLastMonth && ` · ${tr("points start again next month", "अगले महीने पॉइंट फिर से शुरू होंगे")}`}
                        </p>
                        {month.target !== null && month.pct !== null && (
                            <div className="mt-4 w-full max-w-md space-y-1.5">
                                <p className="flex justify-between gap-3 text-sm font-semibold">
                                    <span>{tr("Target", "टारगेट")}: {points(month.target)}</span>
                                    <span className="tabular-nums">{month.pct}%</span>
                                </p>
                                <div className="h-2.5 overflow-hidden rounded-full bg-slate-700">
                                    <div className={cn("h-full rounded-full transition-all", month.pct >= 100 ? "bg-emerald-400" : "bg-orange-400")} style={{ width: `${Math.min(100, month.pct)}%` }} />
                                </div>
                                <p className={cn("text-sm font-semibold", month.pct >= 100 ? "text-emerald-300" : "text-orange-200")}>
                                    {month.pct >= 100 ? tr("Target reached", "टारगेट पूरा") : tr(`${points(Math.max(0, month.target - month.points))} more points to reach your target`, `टारगेट के लिए ${points(Math.max(0, month.target - month.points))} पॉइंट और`)}
                                </p>
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col gap-2 sm:items-end">
                        {month.reward?.status === "sent" ? (
                            <p className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-emerald-300">
                                <CheckCircle2 className="h-4 w-4 shrink-0" />{tr("Reward sent", "रिवॉर्ड भेज दिया गया")}{month.reward.sent_at ? ` · ${stampDay(month.reward.sent_at, locale)}` : ""}{month.reward.note ? ` · ${month.reward.note}` : ""}
                            </p>
                        ) : month.reward?.status === "requested" ? (
                            <p className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-amber-300"><Clock className="h-4 w-4 shrink-0" />{tr("Your request is with head office", "आपकी रिक्वेस्ट हेड ऑफिस के पास है")}</p>
                        ) : month.can_request ? (
                            <Button className="h-12 bg-orange-500 px-6 text-base font-bold hover:bg-orange-600" onClick={() => setAsking(true)}>
                                <Gift className="mr-2 h-5 w-5" />{tr(`Request reward for ${month.label}`, `${month.label} के रिवॉर्ड की रिक्वेस्ट करें`)}
                            </Button>
                        ) : null}
                    </div>
                </section>
            )}

            <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-base font-extrabold text-slate-900">{t("Month by month")}</h2>
                    <p className="text-sm text-slate-600">{tr("All months", "सभी महीने")}: <b className="tabular-nums text-slate-900">{points(data.total)}</b> {tr("points", "पॉइंट")}</p>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
                    {data.months.map(m => (
                        <button key={m.key} type="button" disabled={m.future} onClick={() => setPick(m.key)} aria-pressed={m.key === month?.key}
                            className={cn("w-36 shrink-0 rounded-2xl p-4 text-left", m.future ? "border border-dashed border-slate-200 opacity-60" : m.key === month?.key ? "border-2 border-orange-500 bg-orange-50" : "border border-slate-200 hover:border-slate-400")}>
                            <span className="block text-xs font-bold text-slate-500">{m.label}</span>
                            <b className="mt-1 block text-2xl tabular-nums text-slate-900">{m.future ? "—" : points(m.points)}</b>
                            {m.target !== null && <span className="block text-xs font-semibold text-slate-600">{tr("Target", "टारगेट")} {points(m.target)}</span>}
                            <span className={cn("block text-xs", m.reward?.status === "sent" ? "font-semibold text-emerald-700" : m.reward ? "font-semibold text-amber-700" : "text-slate-500")}>
                                {m.future ? tr("Not started", "शुरू नहीं हुआ") : m.reward?.status === "sent" ? tr("Reward sent", "रिवॉर्ड भेजा गया") : m.reward ? tr("Requested", "रिक्वेस्ट की गई") : `${m.warranties.toLocaleString("en-IN")} ${tr("warranties", "वारंटी")}`}
                            </span>
                        </button>
                    ))}
                </div>
            </section>

            {month && (
                <div className="grid items-start gap-4 md:grid-cols-2">
                    <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5">
                        <h2 className="text-base font-extrabold text-slate-900">{tr("What earned it", "किससे मिले")} · {month.label}</h2>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                                    <th className="py-2 font-bold">{t("Series")}</th>
                                    <th className="py-2 text-right font-bold">{t("Warranties")}</th>
                                    <th className="py-2 text-right font-bold">{t("Points")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {month.series.map(s => (
                                    <tr key={s.name}>
                                        <td className="py-2.5 font-semibold text-slate-900">{s.name}</td>
                                        <td className="py-2.5 text-right tabular-nums text-slate-700">{s.warranties}</td>
                                        <td className="py-2.5 text-right font-bold tabular-nums text-slate-900">{points(s.points)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                    <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5">
                        <h2 className="text-base font-extrabold text-slate-900">{tr("Day by day", "दिन के हिसाब से")} · {month.label}</h2>
                        {month.days.length ? (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                                        <th className="py-2 font-bold">{tr("Date", "तारीख")}</th>
                                        <th className="py-2 text-right font-bold">{t("Warranties")}</th>
                                        <th className="py-2 text-right font-bold">{t("Points")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {month.days.map(d => (
                                        <tr key={d.date}>
                                            <td className="py-2.5 font-semibold text-slate-900">{shortDay(d.date, locale)}</td>
                                            <td className="py-2.5 text-right tabular-nums text-slate-700">{d.warranties}</td>
                                            <td className="py-2.5 text-right font-bold tabular-nums text-slate-900">{points(d.points)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : <p className="text-sm text-slate-500">{tr("No points in this month.", "इस महीने कोई पॉइंट नहीं।")}</p>}
                    </section>
                </div>
            )}

            <Dialog open={asking} onOpenChange={v => !sending && setAsking(v)}>
                <DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black">{tr(`Request reward for ${month?.label ?? ""}?`, `${month?.label ?? ""} के रिवॉर्ड की रिक्वेस्ट करें?`)}</DialogTitle>
                        <DialogDescription>{tr("Head office will work out your reward and send it to you. You can ask once for each month.", "हेड ऑफिस आपका रिवॉर्ड तय करके आपको भेजेगा। हर महीने के लिए एक बार रिक्वेस्ट कर सकते हैं।")}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" disabled={sending} onClick={() => setAsking(false)}>{t("Cancel")}</Button>
                        <Button className="bg-orange-500 font-bold hover:bg-orange-600" disabled={sending} onClick={redeem}>
                            {sending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{tr("Send request", "रिक्वेस्ट भेजें")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export function SellMoreView({ scheme, data, onBack, onRefresh }: {
    scheme: SellMoreScheme;
    data: StoreSellMore; onBack: () => void; onRefresh: () => Promise<unknown>;
}) {
    const { t, tr, locale } = useLanguage();
    const [refreshing, setRefreshing] = useState(false);
    const optionBanner = data.option === "buy_more" ? scheme.settings?.option_banners?.option2 : scheme.settings?.option_banners?.option1;
    return (
        <div className="mx-auto max-w-4xl space-y-5 pb-8">
            <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={onBack} className="flex h-10 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-orange-600"><ArrowLeft className="h-4 w-4" /> {t("All schemes")}</button>
                <Button variant="outline" size="icon" disabled={refreshing} aria-label={t("Refresh")} onClick={() => { setRefreshing(true); onRefresh().finally(() => setRefreshing(false)); }}>
                    <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                </Button>
            </div>
            <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-orange-700">{tr("1 Nov 2026 to 31 Mar 2027", "1 नवंबर 2026 से 31 मार्च 2027")}</p>
                <h1 className="mt-1 text-2xl font-black text-slate-900 sm:text-4xl">{scheme.title}</h1>
                <p className="mt-1 text-sm text-slate-600">
                    {data.option
                        ? `${tr("Your option", "आपका विकल्प")}: ${data.option === "buy_more" ? "Buy More Get More" : "Sell More Earn More"}${data.opted_at ? ` · ${tr("chosen on", "चुना")} ${stampDay(data.opted_at, locale)}` : ""}`
                        : tr("Two options. Choose one.", "दो विकल्प। एक चुनें।")}
                </p>
            </div>
            {data.option
                ? (optionBanner || scheme.banner_url) && <Banner url={(optionBanner || scheme.banner_url)!} title={scheme.title} />
                : scheme.banner_url && <Banner url={scheme.banner_url} title={scheme.title} />}
            {data.option === "buy_more" && data.buy_more
                ? <BuyMoreView schemeId={scheme.id} data={data.buy_more} reload={onRefresh} />
                : data.option
                ? <Earned schemeId={scheme.id} data={data} reload={onRefresh} />
                : <ChooseOption scheme={scheme} reload={onRefresh} />}
        </div>
    );
}
