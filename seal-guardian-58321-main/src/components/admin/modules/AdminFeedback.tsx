import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Bell, CalendarClock, Download, Eye, Loader2, MessageSquareHeart, Plus, Power, RefreshCw, Search, Star, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { FeedbackHeader, QuestionCard, isEmpty } from "@/components/fms/FeedbackModule";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { cn, formatToIST } from "@/lib/utils";
import {
    QUESTION_TYPE_LABEL, answerText, monthName, formState, dateText, scheduleText, inAudience,
    type AudienceStore, type FeedbackAnswer, type FeedbackQuestion, type FeedbackSettings, type QuestionType,
} from "@/lib/feedback";

interface StoreRow { id: string; store_name: string; store_code?: string | null; city?: string | null; state?: string | null; contact_name?: string | null; contact_phone?: string | null }
interface ResponseRow extends StoreRow { store_id: string; month: string; answers: FeedbackAnswer[]; submitted_at: string }
interface Summary {
    qid: string; label: string; type: QuestionType; answered: number; average?: number;
    counts?: Record<string, number>; nps?: number; texts?: { store: string; text: string }[];
}
interface Trend { qid: string; label: string; type: QuestionType; max?: number; points: { month: string; value: number | null; answered: number }[] }
interface Data { month: string; responses: ResponseRow[]; pending: StoreRow[]; summary: Summary[]; trend: Trend[] }

const thisMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
const pct = (n: number, d: number) => (d ? Math.round(n / d * 100) : 0);

/* One horizontal bar per value, the longest the widest. */
function Bars({ counts, labelOf = (k: string) => k, tone = "bg-orange-500" }: { counts: Record<string, number>; labelOf?: (k: string) => string; tone?: string }) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const max = Math.max(1, ...Object.values(counts));
    return (
        <div className="space-y-1.5">
            {Object.entries(counts).map(([k, n]) => (
                <div key={k} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
                    <span className="truncate text-slate-600">{labelOf(k)}</span>
                    <span className="h-2.5 rounded-full bg-slate-100 overflow-hidden"><span className={cn("block h-full rounded-full", tone)} style={{ width: `${(n / max) * 100}%` }} /></span>
                    <span className="text-right tabular-nums text-slate-500">{n} · {pct(n, total)}%</span>
                </div>
            ))}
        </div>
    );
}

/* Six months as small bars, the open month darker. */
function TrendBars({ t, month }: { t: Trend; month: string }) {
    const max = t.type === "rating" ? 5 : t.type === "nps" ? 10 : t.type === "scale" ? (t.max ?? 10) : 100;
    return (
        <div className="flex items-end gap-1.5 h-16" aria-label={`${t.label} by month`}>
            {t.points.map(p => (
                <div key={p.month} className="flex flex-col items-center gap-1 flex-1 min-w-0" title={`${monthName(p.month)}: ${p.value ?? "—"}${t.type === "yesno" ? "% yes" : ""} (${p.answered})`}>
                    <span className="text-[10px] tabular-nums text-slate-500">{p.value ?? "—"}{p.value != null && t.type === "yesno" ? "%" : ""}</span>
                    <span className={cn("w-full rounded-t-md", p.month === month ? "bg-orange-500" : "bg-orange-200")} style={{ height: `${Math.max(4, ((p.value ?? 0) / max) * 40)}px` }} />
                    <span className="text-[9px] text-slate-400">{monthName(p.month).slice(0, 3)}</span>
                </div>
            ))}
        </div>
    );
}

function SummaryCard({ s, total, trend, month }: { s: Summary; total: number; trend?: Trend; month: string }) {
    return (
        <div className="rounded-2xl border border-slate-100 bg-white p-4 space-y-3 min-w-0">
            <div className="flex items-start justify-between gap-3">
                <p className="font-bold text-slate-800 leading-snug">{s.label}</p>
                <span className="text-[11px] text-slate-400 whitespace-nowrap">{s.answered} of {total} answered</span>
            </div>
            {s.type === "rating" && s.average != null && (
                <p className="flex items-center gap-1.5 text-2xl font-black text-slate-800 tabular-nums">
                    {s.average}<Star className="h-5 w-5 fill-amber-400 text-amber-400" /><span className="text-xs font-semibold text-slate-400">average</span>
                </p>
            )}
            {s.type === "nps" && s.nps != null && (
                <p className="text-2xl font-black tabular-nums text-slate-800">{s.nps > 0 ? "+" : ""}{s.nps}<span className="ml-2 text-xs font-semibold text-slate-400">score (promoters − detractors) · average {s.average}</span></p>
            )}
            {s.type === "scale" && s.average != null && <p className="text-2xl font-black tabular-nums text-slate-800">{s.average}<span className="ml-2 text-xs font-semibold text-slate-400">average</span></p>}
            {s.type === "number" && s.average != null && <p className="text-2xl font-black tabular-nums text-slate-800">{s.average}<span className="ml-2 text-xs font-semibold text-slate-400">average</span></p>}
            {s.type === "yesno" && s.counts && (
                <p className="text-2xl font-black tabular-nums text-emerald-700">{pct(s.counts.yes, s.counts.yes + s.counts.no)}%<span className="ml-2 text-xs font-semibold text-slate-400">said yes</span></p>
            )}
            {s.counts && s.type !== "nps" && <Bars counts={s.counts} labelOf={k => s.type === "rating" ? `${k} star${k === "1" ? "" : "s"}` : s.type === "yesno" ? (k === "yes" ? "Yes" : "No") : k} tone={s.type === "yesno" ? "bg-emerald-500" : "bg-orange-500"} />}
            {s.type === "nps" && s.counts && <Bars counts={s.counts} />}
            {s.texts && (
                s.texts.length ? (
                    <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                        {s.texts.map((t, i) => (
                            <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                                <p className="text-slate-700 whitespace-pre-line break-words">{t.text}</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">{t.store}</p>
                            </div>
                        ))}
                    </div>
                ) : <p className="text-xs text-slate-400">No written answers yet.</p>
            )}
            {s.type === "photo" && <p className="text-xs text-slate-500">Photos are in each store's answers.</p>}
            {trend && trend.points.length > 1 && <TrendBars t={trend} month={month} />}
        </div>
    );
}

/* ---------------- questions & reminder ---------------- */

const move = <T,>(l: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= l.length) return l; const o = [...l]; [o[i], o[j]] = [o[j], o[i]]; return o; };

/** The form as a store sees it, to try out; nothing is sent. */
function PreviewDialog({ f, open, onOpenChange }: { f: FeedbackSettings; open: boolean; onOpenChange: (o: boolean) => void }) {
    const [vals, setVals] = useState<Record<string, any>>({});
    const [files, setFiles] = useState<Record<string, File[]>>({});
    const qs = f.questions.filter(q => q.active);
    return (
        <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) { setVals({}); setFiles({}); } }}>
            <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto bg-slate-50 p-4 sm:p-6">
                <DialogHeader className="sr-only">
                    <DialogTitle>Preview as store</DialogTitle>
                    <DialogDescription>What stores see. Nothing is sent from here.</DialogDescription>
                </DialogHeader>
                <p className="text-center text-[11px] font-bold uppercase tracking-widest text-slate-400">Preview — nothing is sent</p>
                <div className="space-y-3">
                    <FeedbackHeader month={thisMonth()} title={f.title || "—"} intro={f.intro} count={qs.length} />
                    {qs.length === 0 ? <p className="rounded-2xl bg-white text-sm text-slate-500 py-8 text-center">No questions are ticked to use in the form.</p> : (
                        <>
                            {qs.map((q, i) => (
                                <QuestionCard key={q.id} q={q} n={i + 1} value={vals[q.id]} files={files[q.id] ?? []}
                                    onChange={v => setVals(p => ({ ...p, [q.id]: v }))} onFiles={x => setFiles(p => ({ ...p, [q.id]: x }))} />
                            ))}
                            <div className="sticky bottom-0 rounded-2xl bg-gray-900 text-white px-4 py-3 flex items-center gap-3">
                                <p className="flex-1 text-sm font-bold tabular-nums">{qs.filter(q => !isEmpty(q, vals[q.id], files[q.id] ?? [])).length} of {qs.length} answered</p>
                                <span className="rounded-xl bg-white/15 px-4 py-2 text-sm font-bold">Send</span>
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromISO = (s: string | null) => { if (!s) return undefined; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const BRANDS = [["AF", "Autoform"], ["AC", "Autocruze"]] as const;

/** Tick stores by hand: search, a state to narrow to, tick all shown. */
function StorePicker({ stores, picked, onChange, open, onOpenChange }: {
    stores: AudienceStore[]; picked: string[]; onChange: (ids: string[]) => void; open: boolean; onOpenChange: (o: boolean) => void;
}) {
    const [q, setQ] = useState("");
    const [st, setSt] = useState("all");
    const states = useMemo(() => [...new Set(stores.map(s => (s.state ?? "").trim()).filter(Boolean))].sort(), [stores]);
    const shown = stores.filter(s => (st === "all" || (s.state ?? "").trim() === st)
        && (!q || `${s.store_name} ${s.store_code ?? ""} ${s.city ?? ""}`.toLowerCase().includes(q.toLowerCase())));
    const set = new Set(picked);
    const toggle = (ids: string[], on: boolean) => { const n = new Set(set); ids.forEach(id => on ? n.add(id) : n.delete(id)); onChange([...n]); };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Pick the stores</DialogTitle>
                    <DialogDescription>{picked.length} of {stores.length} franchises picked. Only these see the form and the reminder.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap gap-2">
                    <div className="relative flex-1 min-w-[180px]"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Store, code or city" className="pl-8 h-9" /></div>
                    <Select value={st} onValueChange={setSt}>
                        <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="all">All states</SelectItem>{states.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
                <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{shown.length} shown</span>
                    <span className="flex gap-3">
                        <button type="button" className="font-semibold text-orange-600 hover:underline" onClick={() => toggle(shown.map(s => s.id), true)}>Tick all shown</button>
                        <button type="button" className="font-semibold text-slate-500 hover:underline" onClick={() => toggle(shown.map(s => s.id), false)}>Untick all shown</button>
                    </span>
                </div>
                <div className="max-h-[50vh] overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-100">
                    {shown.map(s => (
                        <label key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                            <Checkbox checked={set.has(s.id)} onCheckedChange={v => toggle([s.id], v === true)} />
                            <span className="min-w-0 flex-1">
                                <span className="block font-semibold text-slate-800 truncate">{s.store_name}</span>
                                <span className="block text-[11px] text-slate-400">{[s.store_code, s.city, s.state].filter(Boolean).join(" · ")}</span>
                            </span>
                            <span className="text-[10px] font-bold text-slate-400">{(s.allowed_brands || "AF") === "AFAC" ? "AF + AC" : s.allowed_brands || "AF"}</span>
                        </label>
                    ))}
                    {shown.length === 0 && <p className="p-6 text-center text-sm text-slate-400">No store matches.</p>}
                </div>
                <div className="flex justify-end"><Button onClick={() => onOpenChange(false)}>Done</Button></div>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Live or not, and when: the status stores are in today, the Go live /
 * Take offline button (with a portal notification to stores that haven't
 * sent it) and the monthly window that opens and closes the form by itself.
 */
function LiveCard({ f, setF, savedF, dirty, onPublished }: {
    f: FeedbackSettings; setF: (f: FeedbackSettings) => void; savedF: FeedbackSettings; dirty: boolean; onPublished: (enabled: boolean) => void;
}) {
    const { toast } = useToast();
    const [confirm, setConfirm] = useState<"live" | "offline" | null>(null);
    const [notify, setNotify] = useState(true);
    const [busy, setBusy] = useState(false);
    const [counts, setCounts] = useState<{ sent: number; total: number } | null>(null);
    const [stores, setStores] = useState<AudienceStore[]>([]);
    const [picking, setPicking] = useState(false);
    const month = thisMonth();

    useEffect(() => { api.get("/feedback/admin/stores").then(r => setStores(r.data.data)).catch(() => setStores([])); }, []);

    useEffect(() => {
        api.get("/feedback/admin/responses", { params: { month } })
            .then(r => { const d = r.data.data; setCounts({ sent: d.responses.length, total: d.responses.length + d.pending.length }); })
            .catch(() => setCounts(null));
    }, [month, savedF.enabled]);

    const st = formState(savedF);
    const used = savedF.questions.filter(q => q.active).length;
    const sc = f.schedule;
    const setS = (p: Partial<FeedbackSettings["schedule"]>) => setF({ ...f, schedule: { ...sc, ...p } });
    const au = f.audience;
    const setA = (p: Partial<FeedbackSettings["audience"]>) => setF({ ...f, audience: { ...au, ...p } });
    const openToday = formState({ ...savedF, enabled: true }).open;
    const reach = stores.filter(s => inAudience(au, s)).length;
    const savedReach = stores.filter(s => inAudience(savedF.audience, s)).length;
    const states = useMemo(() => [...new Set(stores.map(s => (s.state ?? "").trim()).filter(Boolean))].sort(), [stores]);
    const range: DateRange | undefined = sc.start ? { from: fromISO(sc.start), to: fromISO(sc.end) } : undefined;
    const sameMonth = !sc.start || !sc.end || sc.start.slice(0, 7) === sc.end.slice(0, 7);

    const status = !savedF.enabled
        ? { dot: "bg-slate-300", tone: "text-slate-700", text: "Not live", sub: "Stores can't see the form and get no reminder." }
        : st.open
            ? { dot: "bg-emerald-500 animate-pulse", tone: "text-emerald-700", text: "Live — open now", sub: st.closes_on ? `Closes by itself after ${dateText(st.closes_on)}.` : "Open all month; each store sends it once." }
            : st.why === "no_questions"
                ? { dot: "bg-amber-500", tone: "text-amber-700", text: "Live, but no questions", sub: "Tick at least one question to use in the form." }
                : st.why === "ended"
                    ? { dot: "bg-slate-400", tone: "text-slate-700", text: "Live — dates are over", sub: "Pick new dates, or take it offline." }
                    : { dot: "bg-blue-500", tone: "text-blue-700", text: st.why === "not_yet" ? "Live — opens soon" : "Live — closed for this month", sub: `Opens by itself on ${dateText(st.opens_on!)}.` };

    const publish = async (live: boolean) => {
        setBusy(true);
        try {
            const r = await api.post("/feedback/admin/publish", { live, notify: live && notify });
            const n = r.data.data.notified as number;
            toast({ title: live ? "The form is live" : "The form is offline", description: live ? (n ? `${n} franchise${n === 1 ? "" : "s"} told in their portal notifications.` : "Stores see it in their Review & Feedback tab.") : "Stores can't fill it until it's live again." });
            onPublished(live);
            setConfirm(null);
        } catch (e) {
            toast({ variant: "destructive", title: "Not changed", description: getErrorMessage(e, "Try again.") });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-2xl border border-orange-50 bg-white p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                    <span className={cn("mt-1.5 h-3 w-3 rounded-full shrink-0", status.dot)} />
                    <div className="min-w-0">
                        <p className={cn("font-black text-lg leading-tight", status.tone)}>{status.text}</p>
                        <p className="text-xs text-slate-500">{status.sub}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {used} of {savedF.questions.length} question{savedF.questions.length === 1 ? "" : "s"} in the form
                            {stores.length > 0 && <> · for <b className="text-slate-700">{savedReach} of {stores.length}</b> franchises</>}
                            {counts && <> · <b className="text-slate-700">{counts.sent} of {counts.total}</b> stores sent {monthName(month)}'s</>}
                        </p>
                    </div>
                </div>
                {savedF.enabled ? (
                    <Button variant="outline" onClick={() => setConfirm("offline")} className="border-red-200 text-red-600 hover:bg-red-50"><Power className="h-4 w-4 mr-1.5" /> Take offline</Button>
                ) : (
                    <Button onClick={() => { setNotify(true); setConfirm("live"); }} disabled={dirty || used === 0} title={dirty ? "Save your changes first" : used === 0 ? "Tick at least one question to use" : undefined} className="bg-emerald-600 hover:bg-emerald-700"><Power className="h-4 w-4 mr-1.5" /> Go live</Button>
                )}
            </div>
            {!savedF.enabled && dirty && <p className="text-[11px] text-amber-600 -mt-2">Save your changes first, then go live.</p>}

            <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3 space-y-2">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><CalendarClock className="h-3.5 w-3.5" /> When stores can fill it</p>
                    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                        {([[false, "Whole month"], [true, "Set dates"]] as const).map(([k, l]) => (
                            <button key={String(k)} type="button" onClick={() => setS({ auto: k })} className={cn("px-3 py-1.5 rounded-lg text-xs font-bold", sc.auto === k ? "bg-slate-900 text-white" : "text-slate-500")}>{l}</button>
                        ))}
                    </div>
                    {sc.auto && (
                        <div className="space-y-2">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full justify-start bg-white font-normal">
                                        <CalendarClock className="h-4 w-4 mr-2 text-slate-400" />
                                        {sc.start && sc.end ? `${dateText(sc.start)} → ${dateText(sc.end)}` : sc.start ? `${dateText(sc.start)} → pick the last date` : "Pick the first and last date"}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar mode="range" numberOfMonths={2} selected={range} defaultMonth={range?.from ?? new Date()}
                                        disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
                                        onSelect={r => setS({ start: r?.from ? toISO(r.from) : null, end: r?.to ? toISO(r.to) : r?.from ? toISO(r.from) : null })} />
                                </PopoverContent>
                            </Popover>
                            <label className="flex items-start gap-2 text-xs text-slate-600">
                                <Checkbox checked={sc.repeat} onCheckedChange={v => setS({ repeat: v === true })} className="mt-0.5" />
                                <span>Repeat these days every month<span className="block text-[11px] text-slate-400">Off: open only between these two dates, then it stays closed.</span></span>
                            </label>
                        </div>
                    )}
                    <p className={cn("text-[11px]", sc.auto && sc.repeat && !sameMonth ? "text-red-600" : "text-slate-400")}>
                        {sc.auto && sc.repeat && !sameMonth
                            ? "To repeat every month, pick both dates in the same month."
                            : `${scheduleText(sc)}. It opens and closes by itself; the reminder shows only while it's open. Save to apply.`}
                    </p>
                </div>

                <div className="rounded-xl bg-slate-50 p-3 space-y-2">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><MessageSquareHeart className="h-3.5 w-3.5" /> Which franchises get it</p>
                    <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1">
                        {([["all", "All"], ["filter", "By brand / state"], ["stores", "Pick stores"]] as const).map(([k, l]) => (
                            <button key={k} type="button" onClick={() => setA({ mode: k })} className={cn("px-3 py-1.5 rounded-lg text-xs font-bold", au.mode === k ? "bg-slate-900 text-white" : "text-slate-500")}>{l}</button>
                        ))}
                    </div>
                    {au.mode === "filter" && (
                        <div className="space-y-2">
                            <div className="flex flex-wrap gap-1.5">
                                {BRANDS.map(([b, l]) => {
                                    const on = au.brands.includes(b);
                                    return <button key={b} type="button" onClick={() => setA({ brands: on ? au.brands.filter(x => x !== b) : [...au.brands, b] })} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", on ? "border-orange-300 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-500")}>{l}</button>;
                                })}
                                <span className="text-[11px] text-slate-400 self-center">{au.brands.length ? "" : "any brand"}</span>
                            </div>
                            <Select value="" onValueChange={v => !au.states.includes(v) && setA({ states: [...au.states, v] })}>
                                <SelectTrigger className="h-8 bg-white text-xs"><SelectValue placeholder={au.states.length ? "+ Add a state" : "Any state — add one to narrow"} /></SelectTrigger>
                                <SelectContent>{states.filter(s => !au.states.includes(s)).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                            </Select>
                            {au.states.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {au.states.map(s => (
                                        <span key={s} className="inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 pl-2.5 pr-1 py-0.5 text-xs text-slate-700">{s}
                                            <button type="button" aria-label={`Remove ${s}`} onClick={() => setA({ states: au.states.filter(x => x !== s) })} className="rounded-full p-0.5 text-slate-400 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    {au.mode === "stores" && (
                        <Button variant="outline" size="sm" className="bg-white" onClick={() => setPicking(true)}>{au.store_ids.length ? `${au.store_ids.length} picked — change` : "Pick the stores"}</Button>
                    )}
                    <p className="text-[11px] text-slate-400">
                        {stores.length ? <>For <b className="text-slate-700">{reach} of {stores.length}</b> active franchises. </> : null}
                        {au.mode === "stores" ? "New franchises aren't added by themselves." : au.mode === "filter" ? "New franchises that match are included by themselves." : ""} Save to apply.
                    </p>
                </div>
            </div>
            <StorePicker stores={stores} picked={au.store_ids} onChange={ids => setA({ store_ids: ids })} open={picking} onOpenChange={setPicking} />

            <Dialog open={confirm !== null} onOpenChange={o => !o && !busy && setConfirm(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{confirm === "live" ? "Put the feedback form live?" : "Take the feedback form offline?"}</DialogTitle>
                        <DialogDescription>
                            {confirm === "live"
                                ? `${used} question${used === 1 ? "" : "s"} · ${scheduleText(savedF.schedule)} · for ${savedReach} of ${stores.length} franchises.`
                                : "Stores can't fill it or see the reminder until you put it live again. Answers already sent stay."}
                        </DialogDescription>
                    </DialogHeader>
                    {confirm === "live" && (
                        <label className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-sm", openToday ? "border-slate-200" : "border-slate-100 opacity-60")}>
                            <Checkbox checked={notify && openToday} disabled={!openToday} onCheckedChange={v => setNotify(v === true)} className="mt-0.5" />
                            <span>
                                <span className="flex items-center gap-1.5 font-semibold text-slate-800"><Bell className="h-3.5 w-3.5" /> Tell the franchises now</span>
                                <span className="block text-xs text-slate-500">
                                    {openToday ? "A portal notification to each of these franchises that hasn't sent this month's (not WhatsApp or SMS)." : "The form isn't open today by its dates, so there's nothing to tell yet. The reminder pop-up shows once it opens."}
                                </span>
                            </span>
                        </label>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
                        <Button onClick={() => publish(confirm === "live")} disabled={busy} className={confirm === "live" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}>
                            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}{confirm === "live" ? "Go live" : "Take offline"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function QuestionsEditor({ onSaved }: { onSaved: () => void }) {
    const { toast } = useToast();
    const [f, setF] = useState<FeedbackSettings | null>(null);
    const [saved, setSaved] = useState("");
    const [saving, setSaving] = useState(false);
    const [preview, setPreview] = useState(false);

    useEffect(() => {
        api.get("/feedback/admin/settings").then(r => { setF(r.data.data); setSaved(JSON.stringify(r.data.data)); })
            .catch(e => toast({ variant: "destructive", title: "Could not load the form", description: getErrorMessage(e, "") }));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (!f) return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    const dirty = JSON.stringify(f) !== saved;
    const setQ = (i: number, p: Partial<FeedbackQuestion>) => setF({ ...f, questions: f.questions.map((q, j) => j === i ? { ...q, ...p } : q) });
    const setR = (p: Partial<FeedbackSettings["reminder"]>) => setF({ ...f, reminder: { ...f.reminder, ...p } });

    const save = async () => {
        setSaving(true);
        try {
            const r = await api.put("/feedback/admin/settings", { settings: f });
            setF(r.data.data); setSaved(JSON.stringify(r.data.data));
            toast({ title: "Saved", description: r.data.data.enabled ? "Stores see the changes now." : "The form is still not live: use Go live when ready." });
            onSaved();
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again.") });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <LiveCard f={f} setF={setF} savedF={JSON.parse(saved)} dirty={dirty}
                onPublished={enabled => { const n = { ...JSON.parse(saved), enabled }; setSaved(JSON.stringify(n)); setF({ ...f, enabled }); onSaved(); }} />
            <PreviewDialog f={f} open={preview} onOpenChange={setPreview} />

            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-50 bg-white/95 backdrop-blur p-3">
                <p className="text-xs text-slate-500">Each franchise sends it once a month. It's final once sent.</p>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => setPreview(true)}><Eye className="h-4 w-4 mr-1.5" /> Preview as store</Button>
                    {dirty && <span className="text-xs font-semibold text-amber-600">Unsaved changes</span>}
                    {dirty && <Button variant="outline" onClick={() => setF(JSON.parse(saved))} disabled={saving}>Discard</Button>}
                    <Button onClick={save} disabled={!dirty || saving} className="bg-orange-600 hover:bg-orange-700">{saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Save</Button>
                </div>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] gap-4 items-start">
                <div className="space-y-4 min-w-0">
                    <div className="rounded-2xl border border-orange-50 bg-white p-4 space-y-3">
                        <div className="space-y-1"><label htmlFor="fb-title" className="text-xs font-semibold text-slate-500">Title stores see</label><Input id="fb-title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
                        <div className="space-y-1"><label htmlFor="fb-intro" className="text-xs font-semibold text-slate-500">Introduction</label><Textarea id="fb-intro" rows={2} value={f.intro} onChange={e => setF({ ...f, intro: e.target.value })} /></div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="font-black text-slate-800">Questions <span className="text-slate-400 font-semibold">({f.questions.filter(q => q.active).length} of {f.questions.length} in the form)</span></p>
                            <Select value="" onValueChange={t => setF({ ...f, questions: [...f.questions, { id: `new_${Date.now()}`, label: "", type: t as QuestionType, required: true, active: true, ...(t === "single" || t === "multi" ? { options: ["", ""] } : {}), ...(t === "photo" ? { max_files: 1 } : {}), ...(t === "scale" ? { scale_min: 1, scale_max: 10, low_label: "Poor", high_label: "Excellent" } : {}) }] })}>
                                <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="+ Add a question" /></SelectTrigger>
                                <SelectContent>{(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map(t => <SelectItem key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        {f.questions.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">No questions yet. Add the first one with "+ Add a question".</div>}
                        {f.questions.map((q, i) => (
                            <div key={q.id} className={cn("rounded-2xl border p-3 space-y-2", q.active ? "border-slate-100 bg-white" : "border-dashed border-slate-200 bg-slate-50/60")}>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-black text-slate-400 tabular-nums w-5">{i + 1}.</span>
                                    <div className="flex">
                                        <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => setF({ ...f, questions: move(f.questions, i, -1) })} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                                        <button type="button" aria-label="Move down" disabled={i === f.questions.length - 1} onClick={() => setF({ ...f, questions: move(f.questions, i, 1) })} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                                    </div>
                                    <Select value={q.type} onValueChange={t => setQ(i, { type: t as QuestionType, ...(t === "single" || t === "multi" ? { options: q.options?.length ? q.options : ["", ""] } : {}), ...(t === "photo" ? { max_files: q.max_files ?? 1 } : {}), ...(t === "scale" ? { scale_min: q.scale_min ?? 1, scale_max: q.scale_max ?? 10, low_label: q.low_label ?? "Poor", high_label: q.high_label ?? "Excellent" } : {}) })}>
                                        <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>{(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map(t => <SelectItem key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                                    </Select>
                                    <label className="flex items-center gap-1.5 text-xs text-slate-600"><Switch checked={q.required} onCheckedChange={v => setQ(i, { required: v })} aria-label="Required" /> Required</label>
                                    <label className={cn("flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold", q.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500")}>
                                        <Checkbox checked={q.active} onCheckedChange={v => setQ(i, { active: v === true })} aria-label="Use in form" /> {q.active ? "Use in form" : "Not used"}
                                    </label>
                                    <button type="button" aria-label="Delete question" onClick={() => setF({ ...f, questions: f.questions.filter((_, j) => j !== i) })} className="ml-auto p-1 text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                                </div>
                                <Input value={q.label} onChange={e => setQ(i, { label: e.target.value })} placeholder="The question" aria-label="Question" />
                                <Input value={q.help ?? ""} onChange={e => setQ(i, { help: e.target.value })} placeholder="Help under the question (optional)" className="h-8 text-xs" aria-label="Help text" />
                                {(q.type === "single" || q.type === "multi") && (
                                    <div className="space-y-1.5 pl-1">
                                        {(q.options ?? []).map((o, k) => (
                                            <div key={k} className="flex gap-2">
                                                <Input value={o} onChange={e => setQ(i, { options: (q.options ?? []).map((x, m) => m === k ? e.target.value : x) })} placeholder={`Choice ${k + 1}`} className="h-8 text-sm" aria-label={`Choice ${k + 1}`} />
                                                <button type="button" aria-label="Remove choice" onClick={() => setQ(i, { options: (q.options ?? []).filter((_, m) => m !== k) })} className="text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                                            </div>
                                        ))}
                                        <Button type="button" variant="ghost" size="sm" onClick={() => setQ(i, { options: [...(q.options ?? []), ""] })}><Plus className="h-3.5 w-3.5 mr-1" /> Add a choice</Button>
                                    </div>
                                )}
                                {q.type === "scale" && (
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                        From
                                        <select value={q.scale_min ?? 1} onChange={e => setQ(i, { scale_min: Number(e.target.value) })} className="h-8 rounded-md border border-slate-200 bg-white px-1.5" aria-label="Scale starts at">
                                            {[0, 1].map(n => <option key={n} value={n}>{n}</option>)}
                                        </select>
                                        to
                                        <select value={q.scale_max ?? 10} onChange={e => setQ(i, { scale_max: Number(e.target.value) })} className="h-8 rounded-md border border-slate-200 bg-white px-1.5" aria-label="Scale ends at">
                                            {[3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
                                        </select>
                                        <Input value={q.low_label ?? "Poor"} onChange={e => setQ(i, { low_label: e.target.value })} className="h-8 w-28 text-xs" aria-label="Word at the low end" />
                                        <span>…</span>
                                        <Input value={q.high_label ?? "Excellent"} onChange={e => setQ(i, { high_label: e.target.value })} className="h-8 w-28 text-xs" aria-label="Word at the high end" />
                                    </div>
                                )}
                                {q.type === "photo" && (
                                    <label className="flex items-center gap-2 text-xs text-slate-600">Up to
                                        <Input type="number" min={1} max={5} value={q.max_files ?? 1} onChange={e => setQ(i, { max_files: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })} className="h-8 w-16" aria-label="Most photos" /> photos
                                    </label>
                                )}
                            </div>
                        ))}
                        <p className="text-[11px] text-slate-400">Answers already sent keep the question as it was asked, so editing or deleting one does not change earlier months.</p>
                    </div>
                </div>

                <div className="rounded-2xl border border-orange-50 bg-white p-4 space-y-3 lg:sticky lg:top-4">
                    <label className="flex items-center justify-between gap-3">
                        <span><span className="block font-black text-slate-800">Reminder pop-up</span><span className="block text-xs text-slate-500">Only for stores that haven't sent this month's feedback.</span></span>
                        <Switch checked={f.reminder.enabled} onCheckedChange={v => setR({ enabled: v })} aria-label="Reminder on" />
                    </label>
                    <div className={cn("space-y-3", !f.reminder.enabled && "opacity-50 pointer-events-none")}>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1"><label htmlFor="fb-from" className="text-xs font-semibold text-slate-500">From day</label><Input id="fb-from" type="number" min={1} max={31} value={f.reminder.from_day} onChange={e => setR({ from_day: Number(e.target.value) })} /></div>
                            <div className="space-y-1"><label htmlFor="fb-to" className="text-xs font-semibold text-slate-500">To day</label><Input id="fb-to" type="number" min={1} max={31} value={f.reminder.to_day} onChange={e => setR({ to_day: Number(e.target.value) })} /></div>
                        </div>
                        <p className="text-[11px] text-slate-400 -mt-1.5">Of each month, both included. 31 means the last day of any month.</p>
                        <div className="space-y-1">
                            <p className="text-xs font-semibold text-slate-500">How often</p>
                            <div className="inline-flex rounded-xl border border-slate-200 p-1">
                                {([["day", "Once a day"], ["login", "Every login"]] as const).map(([k, l]) => (
                                    <button key={k} type="button" onClick={() => setR({ every: k })} className={cn("px-3 py-1.5 rounded-lg text-xs font-bold", f.reminder.every === k ? "bg-slate-900 text-white" : "text-slate-500")}>{l}</button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-1"><label htmlFor="fb-rt" className="text-xs font-semibold text-slate-500">Pop-up title</label><Input id="fb-rt" value={f.reminder.title} onChange={e => setR({ title: e.target.value })} /></div>
                        <div className="space-y-1"><label htmlFor="fb-rm" className="text-xs font-semibold text-slate-500">Message</label><Textarea id="fb-rm" rows={3} value={f.reminder.message} onChange={e => setR({ message: e.target.value })} /></div>
                        <div className="space-y-1"><label htmlFor="fb-rb" className="text-xs font-semibold text-slate-500">Button</label><Input id="fb-rb" value={f.reminder.button} onChange={e => setR({ button: e.target.value })} /></div>
                        <div className="rounded-2xl overflow-hidden border border-slate-100">
                            <div className="bg-gradient-to-br from-orange-50 to-amber-50 px-4 py-4 text-center">
                                <MessageSquareHeart className="mx-auto h-6 w-6 text-orange-500 mb-1.5" />
                                <p className="font-bold text-slate-800 text-sm">{f.reminder.title || "—"}</p>
                                <p className="text-xs text-slate-600 mt-1 whitespace-pre-line">{f.reminder.message}</p>
                            </div>
                            <div className="flex gap-2 p-2.5"><span className="flex-1 text-center text-xs text-slate-400 py-1.5">Later</span><span className="flex-1 text-center text-xs font-bold text-white bg-orange-500 rounded-lg py-1.5">{f.reminder.button || "—"}</span></div>
                        </div>
                        <p className="text-[11px] text-slate-400 text-center">Preview of what stores see</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---------------- the module ---------------- */

export const AdminFeedback = () => {
    const { toast } = useToast();
    const [tab, setTab] = useState<"responses" | "questions">("responses");
    const [month, setMonth] = useState(thisMonth());
    const [data, setData] = useState<Data | null>(null);
    const [loading, setLoading] = useState(true);
    const [list, setList] = useState<"answered" | "pending">("answered");
    const [q, setQ] = useState("");
    const [stateF, setStateF] = useState("all");
    const [view, setView] = useState<ResponseRow | null>(null);

    const load = () => {
        setLoading(true);
        api.get("/feedback/admin/responses", { params: { month } }).then(r => setData(r.data.data))
            .catch(e => toast({ variant: "destructive", title: "Could not load the feedback", description: getErrorMessage(e, "") }))
            .finally(() => setLoading(false));
    };
    useEffect(load, [month]); // eslint-disable-line react-hooks/exhaustive-deps

    const states = useMemo(() => [...new Set([...(data?.responses ?? []), ...(data?.pending ?? [])].map(s => (s.state || "").trim()).filter(Boolean))].sort(), [data]);
    const match = (s: StoreRow) => (!q.trim() || [s.store_name, s.store_code, s.city, s.contact_name].some(v => (v || "").toLowerCase().includes(q.trim().toLowerCase())))
        && (stateF === "all" || (s.state || "").trim() === stateF);
    const answered = (data?.responses ?? []).filter(match);
    const pending = (data?.pending ?? []).filter(match);
    const total = (data?.responses.length ?? 0) + (data?.pending.length ?? 0);

    const exportCsv = () => {
        if (!data) return;
        const qs = data.summary;
        const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/[\r\n]+/g, " ").trim()}"`;
        const head = ["Month", "Store", "Store code", "City", "State", "Contact", "Phone", "Sent at", ...qs.map(s => s.label)];
        const rows = data.responses.map(r => [monthName(r.month), r.store_name, r.store_code, r.city, r.state, r.contact_name, r.contact_phone, formatToIST(r.submitted_at),
            ...qs.map(s => { const a = r.answers.find(x => x.qid === s.qid); return a ? (a.type === "photo" ? (a.files ?? []).join(" ") : answerText(a)) : ""; })]);
        const pend = data.pending.map(p => [monthName(data.month), p.store_name, p.store_code, p.city, p.state, p.contact_name, p.contact_phone, "NOT SENT", ...qs.map(() => "")]);
        const csv = "﻿" + [head, ...rows, ...pend].map(r => r.map(cell).join(",")).join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
        a.download = `feedback_${data.month}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-2xl border border-orange-100 bg-white p-1 shadow-sm">
                    {([["responses", "Responses"], ["questions", "Questions & reminder"]] as const).map(([k, l]) => (
                        <button key={k} type="button" onClick={() => setTab(k)} className={cn("px-4 py-2 rounded-xl text-sm font-bold", tab === k ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800")}>{l}</button>
                    ))}
                </div>
                {tab === "responses" && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Input type="month" value={month} max={thisMonth()} onChange={e => e.target.value && setMonth(e.target.value)} className="h-10 w-[170px] bg-white" aria-label="Month" />
                        <Button variant="outline" onClick={exportCsv} disabled={!data} className="rounded-xl gap-1.5"><Download className="h-4 w-4" /> Export</Button>
                        <Button variant="outline" size="icon" onClick={load} aria-label="Refresh" className="rounded-xl"><RefreshCw className="h-4 w-4" /></Button>
                    </div>
                )}
            </div>

            {tab === "questions" ? <QuestionsEditor onSaved={load} /> : loading && !data ? (
                <div className="flex justify-center p-12"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>
            ) : data && (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {[
                            ["Sent", data.responses.length, "text-emerald-700"],
                            ["Not sent yet", data.pending.length, data.pending.length ? "text-amber-600" : "text-slate-400"],
                            ["Response rate", `${pct(data.responses.length, total)}%`, "text-slate-800"],
                            ["Franchises", total, "text-slate-800"],
                        ].map(([l, v, c]) => (
                            <div key={String(l)} className="rounded-2xl border border-slate-100 bg-white p-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{l}</p>
                                <p className={cn("text-2xl font-black tabular-nums", String(c))}>{v}</p>
                            </div>
                        ))}
                    </div>

                    {data.summary.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                            No questions yet. Add them under <b>Questions & reminder</b>, then turn the form on.
                        </div>
                    ) : (
                        <div className="grid md:grid-cols-2 gap-3">
                            {data.summary.map(s => <SummaryCard key={s.qid} s={s} total={data.responses.length} month={data.month} trend={data.trend.find(t => t.qid === s.qid)} />)}
                        </div>
                    )}

                    <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
                        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-100">
                            <div className="inline-flex rounded-xl border border-slate-200 p-1">
                                {([["answered", `Sent (${data.responses.length})`], ["pending", `Not sent (${data.pending.length})`]] as const).map(([k, l]) => (
                                    <button key={k} type="button" onClick={() => setList(k)} className={cn("px-3 py-1.5 rounded-lg text-xs font-bold", list === k ? "bg-slate-900 text-white" : "text-slate-500")}>{l}</button>
                                ))}
                            </div>
                            <div className="relative flex-1 min-w-[200px]">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store, code, city, contact" className="pl-9 h-9" />
                            </div>
                            <Select value={stateF} onValueChange={setStateF}>
                                <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="all">All states</SelectItem>{states.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="overflow-x-auto max-h-[60vh]">
                            <table className="w-full text-sm min-w-[640px]">
                                <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                                    <tr><th className="text-left p-3">Store</th><th className="text-left p-3">City / state</th><th className="text-left p-3">Contact</th><th className="text-left p-3">{list === "answered" ? "Sent" : ""}</th><th className="p-3" /></tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {(list === "answered" ? answered : pending).map(s => (
                                        <tr key={s.id} className="hover:bg-orange-50/30">
                                            <td className="p-3"><p className="font-semibold text-slate-800">{s.store_name}</p>{s.store_code && <p className="text-[11px] text-slate-400 font-mono">{s.store_code}</p>}</td>
                                            <td className="p-3 text-slate-600">{[s.city, s.state].filter(Boolean).join(", ") || "—"}</td>
                                            <td className="p-3 text-slate-600">{s.contact_name || "—"}{s.contact_phone && <p className="text-[11px] text-slate-400 tabular-nums">{s.contact_phone}</p>}</td>
                                            <td className="p-3 text-xs text-slate-500">{"submitted_at" in s ? formatToIST((s as ResponseRow).submitted_at) : ""}</td>
                                            <td className="p-3 text-right">{list === "answered" && <Button size="sm" variant="ghost" onClick={() => setView(s as ResponseRow)}><Eye className="h-4 w-4 mr-1" /> Answers</Button>}</td>
                                        </tr>
                                    ))}
                                    {(list === "answered" ? answered : pending).length === 0 && (
                                        <tr><td colSpan={5} className="p-8 text-center text-sm text-slate-400">{list === "answered" ? "No store has sent this month's feedback yet." : "Every franchise has sent it."}</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            <Dialog open={!!view} onOpenChange={v => { if (!v) setView(null); }}>
                <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{view?.store_name}</DialogTitle>
                        <DialogDescription>{view && `${monthName(view.month)} · sent ${formatToIST(view.submitted_at)}`}</DialogDescription>
                    </DialogHeader>
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                        {view?.answers.map(a => (
                            <div key={a.qid} className="p-3">
                                <p className="text-xs font-semibold text-slate-500">{a.label}</p>
                                <p className="text-sm text-slate-800 whitespace-pre-line">{answerText(a)}</p>
                                {a.files?.length ? (
                                    <div className="flex flex-wrap gap-2 mt-1.5">
                                        {a.files.map((u, i) => <a key={i} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded-lg object-cover border border-slate-100" /></a>)}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};
