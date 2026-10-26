import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    Loader2, Gift, ArrowLeft, Trophy, Plus, Paperclip, CalendarDays, Upload, RefreshCw, Phone, Mail, Maximize2, Download,
    CheckCircle2, Clock, ChevronRight, FileText, Medal, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { ClubBadge, ClubIcon, CLUB_COLORS } from "@/components/schemes/ClubBadge";
import {
    CATEGORY_LABEL, STATE_META, ENTRY_META, FORMAT_LABEL, FORMAT_ACCEPT, formatDay, rewardSummary, formatWindow, formatStamp, formatMonth,
    type Scheme, type SchemeCategory, type SchemeState, type EntryFile, type EntryLine, type SchemeWindow, type Club,
} from "@/lib/schemes";
import { SchemeTargetView, type StorePeriod, type StoreTargets } from "./SchemeTargetView";

/**
 * Offers & Schemes for a franchise: the schemes it can take part in, joining
 * one, submitting entries, and what it has achieved — its score, the slab it
 * reached, the reward earned and its rank. Never how far it is from the next
 * slab: that is the brand's call, and stores see results, not targets.
 */

interface Achieved { score: number; approved: number; rank: number; of: number; reward: string | null; club?: Club | null }
interface Listed {
    id: string; title: string; category: SchemeCategory; summary: string | null; banner_url: string | null;
    starts_on: string; ends_on: string; state: SchemeState;
    windows: SchemeWindow[]; open_window: SchemeWindow | null; next_window: SchemeWindow | null;
    has_score: boolean; joined: boolean; achieved: Achieved | null;
    /* A scheme run by targets: this period's figures, as far as the scheme shows them. */
    run?: "targets"; target_now?: StorePeriod | null;
}
interface MyEntry {
    id: string; answers: Record<string, string>; files: Record<string, EntryFile[]>;
    score: number; lines: EntryLine[] | null; claimed_lines: EntryLine[] | null; status: "pending" | "approved" | "rejected"; review_note: string | null; created_at: string;
    /** Once approved: what each invoice gave. */
    invoices?: { invoice_no: string; points: number; lines: EntryLine[] }[] | null;
}
interface Detail {
    scheme: Omit<Scheme, "eligibility">; joined: boolean; can_submit: boolean; achieved: Achieved | null;
    months: { month: string; points: number }[];
    distributors: { id: string; name: string; city: string | null }[];
    entries: MyEntry[]; leaderboard: { rank: number; name: string; score: number; me: boolean; club?: Club | null }[] | null;
    /* Only on a scheme run by targets, which has no entries. */
    targets?: StoreTargets;
}

const when = (d: string) => new Date(d).toLocaleString("en-IN", { hour: "numeric", minute: "2-digit" });
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const daysLeft = (end: string) => Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(istToday() + "T00:00:00Z")) / 86_400_000);
const shortDate = (d: string) => new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** A store's entries by the IST day they were sent, newest day first. */
function entriesByDay(entries: MyEntry[]) {
    const groups = new Map<string, MyEntry[]>();
    for (const e of entries) {
        const day = new Date(new Date(e.created_at).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
        groups.set(day, [...(groups.get(day) ?? []), e]);
    }
    return [...groups].sort((a, b) => b[0].localeCompare(a[0])).map(([day, items]) => ({
        day, items,
        approved: items.filter(e => e.status === "approved").length,
        pending: items.filter(e => e.status === "pending").length,
    }));
}

/** Whether entries are open right now, and until when — or when they open next. */
function OpenNote({ open, next, closed }: { open: SchemeWindow | null; next: SchemeWindow | null; closed?: boolean }) {
    const { t, tr } = useLanguage();
    if (open) return <span className="font-medium text-emerald-700">{tr(`Open now · until ${formatStamp(open.end)}`, `अभी खुला · ${formatStamp(open.end)} तक`)}</span>;
    if (next) return <span className="font-medium text-sky-700">{tr(`Opens ${formatStamp(next.start)}`, `${formatStamp(next.start)} से खुलेगा`)}</span>;
    return <span className="text-slate-400">{closed ? t("Closed") : t("No more windows")}</span>;
}

/** The scheme's state as a pill; a running scheme says how many days are left. */
function StatePill({ state, end }: { state: SchemeState; end: string }) {
    const { t, tr } = useLanguage();
    const left = daysLeft(end.slice(0, 10));
    const label = state === "live" && left >= 0 ? (left === 0 ? t("Ends today") : tr(`${left} day${left === 1 ? "" : "s"} left`, `${left} दिन बाकी`)) : t(STATE_META[state].label);
    return (
        <span className={cn("inline-flex items-center gap-1.5 shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold", STATE_META[state].tone)}>
            {state === "live" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
            {label}
        </span>
    );
}

/** The poster as a thumbnail, or a plain panel when there is none. */
function Poster({ url, className }: { url: string | null; className?: string }) {
    return url
        ? <img src={url} alt="" className={cn("w-full h-full object-cover object-top", className)} />
        : <div className={cn("w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50", className)}><Gift className="h-10 w-10 text-orange-300" /></div>;
}

/** One number with its label. */
function Stat({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
    const { t } = useLanguage();
    return (
        <div className={cn("rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3 min-w-0", className)}>
            <p className="text-xs font-medium text-slate-500">{t(label)}</p>
            <div className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 tabular-nums leading-tight">{children}</div>
            {hint && <p className="mt-0.5 text-xs text-slate-500 truncate">{hint}</p>}
        </div>
    );
}

export const FranchiseSchemes = () => {
    const { toast } = useToast();
    const { t, tr } = useLanguage();
    const [list, setList] = useState<Listed[] | null>(null);
    const [tab, setTab] = useState<"now" | "upcoming" | "past">("now");
    const [openId, setOpenId] = useState<string | null>(null);
    /* Opening a scheme from its card's "Submit invoice" opens the form too. */
    const [startSubmit, setStartSubmit] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(() => {
        return api.get("/schemes")
            .then(r => setList(r.data.schemes || []))
            .catch(e => { setList([]); toast({ title: t("Could not load schemes"), description: getErrorMessage(e, t("Try again")), variant: "destructive" }); });
    }, [toast, t]);
    useEffect(() => { load(); }, [load]);

    const groups = useMemo(() => ({
        now: (list ?? []).filter(s => s.state === "live"),
        upcoming: (list ?? []).filter(s => s.state === "upcoming"),
        past: (list ?? []).filter(s => s.state === "closed"),
    }), [list]);

    if (openId) return <SchemeView id={openId} startSubmit={startSubmit} onBack={() => { setOpenId(null); setStartSubmit(false); load(); }} />;

    if (list === null) {
        return <div className="flex items-center justify-center min-h-[400px] gap-3 text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /><span className="text-sm font-medium">{t("Loading schemes…")}</span></div>;
    }

    const shown = groups[tab];
    const open = (id: string, submit = false) => { setStartSubmit(submit); setOpenId(id); };
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
                <div>
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">{t("Offers & Schemes")}</h2>
                    <p className="text-sm text-slate-500 mt-1">{t("Join a scheme, submit your invoices and see what you've earned.")}</p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="flex flex-1 sm:flex-none rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm font-medium">
                        {([["now", "Running"], ["upcoming", "Coming up"], ["past", "Past"]] as const).map(([k, l]) => (
                            <button key={k} type="button" onClick={() => setTab(k)}
                                className={cn("flex-1 sm:flex-none px-2 sm:px-3 py-1.5 rounded-md transition-colors whitespace-nowrap", tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
                                {t(l)} <span className="tabular-nums text-slate-400">{groups[k].length}</span>
                            </button>
                        ))}
                    </div>
                    <Button variant="outline" size="icon" disabled={refreshing} aria-label={t("Refresh")} title={t("Refresh")}
                        onClick={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }}>
                        <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                    </Button>
                </div>
            </div>

            {!shown.length ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
                    <div className="h-14 w-14 bg-orange-50 rounded-xl flex items-center justify-center mx-auto mb-4">
                        <Gift className="h-7 w-7 text-orange-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-800 mb-1">
                        {tab === "now" ? t("No schemes running") : tab === "upcoming" ? t("Nothing coming up") : t("No past schemes")}
                    </h3>
                    <p className="text-sm text-slate-500 max-w-md mx-auto">{t("New schemes appear here, and you'll get a notification when one starts.")}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {shown.map(s => {
                        const a = s.achieved;
                        return (
                            <div key={s.id} className="group rounded-xl border border-slate-200 bg-white overflow-hidden hover:border-orange-300 hover:shadow-md transition-all flex flex-col sm:flex-row">
                                <button type="button" onClick={() => open(s.id)} className="sm:w-48 h-32 sm:h-auto shrink-0 bg-slate-100 overflow-hidden" aria-label={s.title}>
                                    <Poster url={s.banner_url} className="group-hover:scale-[1.02] transition-transform duration-500" />
                                </button>
                                <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">{t(CATEGORY_LABEL[s.category])}</p>
                                            <button type="button" onClick={() => open(s.id)} className="text-left text-lg font-bold text-slate-900 hover:text-orange-700 leading-snug">{s.title}</button>
                                            {s.summary && <p className="text-sm text-slate-600 mt-1 line-clamp-2">{s.summary}</p>}
                                        </div>
                                        <StatePill state={s.state} end={s.open_window?.end ?? s.ends_on} />
                                    </div>
                                    <p className="text-sm flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-500">
                                        <CalendarDays className="h-4 w-4 text-slate-400" />
                                        <OpenNote open={s.open_window} next={s.next_window} closed={s.state === "closed"} />
                                        {s.windows.length > 1 && <span className="text-slate-400">· {tr(`${s.windows.length} windows`, `${s.windows.length} बार`)}</span>}
                                    </p>

                                    {s.run === "targets" && (() => {
                                        const n = s.target_now;
                                        const cells = n ? [
                                            n.target !== null ? [t("Target"), n.target.toLocaleString("en-IN")] : null,
                                            n.achieved !== null ? [t("Achieved"), n.achieved.toLocaleString("en-IN")] : null,
                                            n.pct !== null ? ["%", `${n.pct}%`] : null,
                                            [t("Benefit"), n.benefit ?? "—"],
                                        ].filter(Boolean) as [string, string][] : [];
                                        return cells.length ? (
                                            <div className="space-y-1">
                                                <p className="text-xs font-semibold text-slate-500">{n!.label}</p>
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg border border-slate-100 bg-slate-200 overflow-hidden text-sm [&>div]:bg-slate-50">
                                                    {cells.map(([l, v]) => <div key={l} className="px-3 py-2 min-w-0"><p className="text-xs text-slate-500">{l}</p><p className="font-bold text-slate-900 tabular-nums truncate">{v}</p></div>)}
                                                </div>
                                            </div>
                                        ) : <p className="text-sm text-slate-500">{t("Your target shows here once it's set.")}</p>;
                                    })()}
                                    {s.run !== "targets" && s.joined && a && (
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg border border-slate-100 bg-slate-200 overflow-hidden text-sm [&>div]:bg-slate-50">
                                            {s.has_score && <div className="px-3 py-2"><p className="text-xs text-slate-500">{t("Points")}</p><p className="font-bold text-slate-900 tabular-nums">{a.score}</p></div>}
                                            {a.club !== undefined && <div className="px-3 py-2 min-w-0"><p className="text-xs text-slate-500">{t("Club")}</p>{a.club ? <ClubBadge club={a.club} className="mt-0.5" /> : <p className="text-slate-400">—</p>}</div>}
                                            {s.has_score && <div className="px-3 py-2"><p className="text-xs text-slate-500">{t("Rank")}</p><p className="font-bold text-slate-900 tabular-nums">#{a.rank}</p></div>}
                                            <div className="px-3 py-2"><p className="text-xs text-slate-500">{t("Approved")}</p><p className="font-bold text-slate-900 tabular-nums">{a.approved}</p></div>
                                        </div>
                                    )}
                                    {s.run !== "targets" && s.joined && !a && <p className="text-sm text-slate-500">{t("You've joined. Your points show here once an entry is approved.")}</p>}

                                    <div className="mt-auto flex flex-col-reverse sm:flex-row sm:flex-wrap sm:items-center sm:justify-end gap-2 pt-1 [&>button]:w-full sm:[&>button]:w-auto">
                                        <Button variant="ghost" size="sm" className="text-slate-600" onClick={() => open(s.id)}>
                                            {t("View details")} <ChevronRight className="h-4 w-4 ml-0.5" />
                                        </Button>
                                        {s.joined ? (
                                            s.open_window && (
                                                <Button size="sm" className="h-10 sm:h-9 bg-orange-500 hover:bg-orange-600" onClick={() => open(s.id, true)}>
                                                    <Plus className="h-4 w-4 mr-1" /> {t("Submit invoice")}
                                                </Button>
                                            )
                                        ) : s.state !== "closed" && (
                                            <Button size="sm" className="h-10 sm:h-9 bg-orange-500 hover:bg-orange-600" onClick={() => open(s.id)}>{t("Join scheme")}</Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

type ViewTab = "entries" | "rewards" | "how" | "leaderboard" | "terms";

function SchemeView({ id, startSubmit, onBack }: { id: string; startSubmit: boolean; onBack: () => void }) {
    const { toast } = useToast();
    const { t, tr } = useLanguage();
    const [d, setD] = useState<Detail | null>(null);
    const [tab, setTab] = useState<ViewTab | null>(null);
    const [accept, setAccept] = useState(false);
    const [joining, setJoining] = useState(false);
    const [submitOpen, setSubmitOpen] = useState(false);
    const [posterOpen, setPosterOpen] = useState(false);
    /* Which day's entries to show: all, one day, or a range. */
    const [dayPick, setDayPick] = useState("all");
    const [range, setRange] = useState({ from: "", to: "" });
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(() => {
        return api.get(`/schemes/${id}`).then(r => setD(r.data))
            .catch(e => toast({ title: t("Could not open the scheme"), description: getErrorMessage(e, t("Try again")), variant: "destructive" }));
    }, [id, toast, t]);
    useEffect(() => { load(); }, [load]);
    /* Came from a card's "Submit invoice": open the form once the scheme is in. */
    useEffect(() => {
        if (startSubmit && d?.can_submit) setSubmitOpen(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startSubmit, Boolean(d)]);

    if (!d) return <div className="flex items-center justify-center min-h-[400px] gap-3 text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>;
    if (d.targets) return <SchemeTargetView scheme={d.scheme} targets={d.targets} onBack={onBack} onRefresh={load} />;
    const s = d.scheme;
    const a = d.achieved;
    const hasScore = s.score_rule.mode !== "none";
    const products = s.score_rule.mode === "products" ? s.score_rule.products : [];
    const inReview = d.entries.filter(e => e.status === "pending").length;
    const days = entriesByDay(d.entries);
    const shownDays = days.filter(g =>
        dayPick === "all" ? true
            : dayPick === "range" ? (!range.from || g.day >= range.from) && (!range.to || g.day <= range.to)
                : g.day === dayPick);
    /* Joined stores land on their entries; others on how it works. */
    const current: ViewTab = tab ?? (d.joined ? "entries" : "how");
    const tabs: [ViewTab, string][] = [
        ...(d.joined ? [["entries", `${t("My entries")}${d.entries.length ? ` (${d.entries.length})` : ""}`] as [ViewTab, string]] : []),
        ["rewards", s.clubs?.length ? t("Rewards & clubs") : t("Rewards")],
        ["how", t("How it works")],
        ...(d.leaderboard ? [["leaderboard", t("Leaderboard")] as [ViewTab, string]] : []),
        ["terms", t("Terms")],
    ];
    const canSubmit = d.can_submit && s.fields.length > 0;
    const maxMonth = Math.max(1, ...d.months.map(m => m.points));

    const join = async () => {
        setJoining(true);
        try { await api.post(`/schemes/${s.id}/join`, { accept_terms: accept }); toast({ title: t("You've joined"), description: s.fields.length ? t("Submit your invoices from here.") : undefined }); setTab("entries"); load(); }
        catch (e) { toast({ title: t("Could not join"), description: getErrorMessage(e, t("Try again")), variant: "destructive" }); }
        finally { setJoining(false); }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={onBack} className="text-sm font-medium text-slate-500 hover:text-orange-600 flex items-center gap-1.5"><ArrowLeft className="h-4 w-4" /> {t("All schemes")}</button>
                <Button variant="outline" size="sm" disabled={refreshing} title={t("See the latest approvals and your rank")}
                    onClick={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }}>
                    <RefreshCw className={cn("h-4 w-4 mr-1.5", refreshing && "animate-spin")} /> {t("Refresh")}
                </Button>
            </div>

            {/* The scheme: poster, dates, and what to do next. */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col md:flex-row">
                <button type="button" onClick={() => s.banner_url && setPosterOpen(true)} disabled={!s.banner_url}
                    className="relative md:w-64 h-40 sm:h-56 md:h-auto shrink-0 bg-slate-100 group overflow-hidden" aria-label={t("See full poster")}>
                    <Poster url={s.banner_url} />
                    {s.banner_url && (
                        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1 text-xs font-medium text-white whitespace-nowrap group-hover:bg-black/80">
                            <Maximize2 className="h-3.5 w-3.5" /> {t("See full poster")}
                        </span>
                    )}
                </button>
                <div className="flex-1 min-w-0 p-4 sm:p-5 md:p-6 flex flex-col gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">{t(CATEGORY_LABEL[s.category])}</p>
                            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight mt-0.5">{s.title}</h2>
                            {s.summary && <p className="text-sm text-slate-600 mt-1.5 max-w-2xl">{s.summary}</p>}
                        </div>
                        <StatePill state={s.state} end={s.open_window?.end ?? s.ends_on} />
                    </div>

                    <div className="space-y-1.5 text-sm">
                        <p className="flex items-center gap-2 text-slate-600">
                            <CalendarDays className="h-4 w-4 text-slate-400" /> {shortDate(s.starts_on)} – {shortDate(s.ends_on)}
                        </p>
                        <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-slate-400" /><OpenNote open={s.open_window} next={s.next_window} closed={s.state === "closed"} /></p>
                        {s.windows.length > 1 && (
                            <details className="pl-6 text-slate-500">
                                <summary className="cursor-pointer text-xs font-medium hover:text-slate-700">{tr(`All ${s.windows.length} entry windows`, `सभी ${s.windows.length} एंट्री समय`)}</summary>
                                <ul className="mt-1 space-y-0.5 text-xs">
                                    {s.windows.map((w, i) => {
                                        const isOpen = s.open_window && s.open_window.start === w.start;
                                        return <li key={i} className={isOpen ? "text-emerald-700 font-semibold" : ""}>{formatWindow(w)}{isOpen ? ` · ${t("open now")}` : ""}</li>;
                                    })}
                                </ul>
                            </details>
                        )}
                    </div>

                    {d.joined ? (
                        <div className="flex flex-wrap items-center gap-3">
                            {canSubmit && (
                                <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setSubmitOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> {t("Submit invoice")}</Button>
                            )}
                            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 font-medium"><CheckCircle2 className="h-4 w-4" /> {t("You've joined")}</span>
                            {!d.can_submit && s.state !== "closed" && s.state !== "upcoming" && s.entries_per_store === "one" && d.entries.some(e => e.status !== "rejected") && (
                                <span className="text-sm text-slate-500">{t("This scheme takes one entry per store, and yours is in.")}</span>
                            )}
                            {!d.can_submit && !s.open_window && s.next_window && <span className="text-sm text-slate-500">{t("You can submit when the next window opens:")} {formatStamp(s.next_window.start)}.</span>}
                        </div>
                    ) : s.state !== "closed" ? (
                        <div className="rounded-lg bg-orange-50 border border-orange-100 p-4 flex flex-wrap items-center justify-between gap-3">
                            {s.terms ? (
                                <label className="flex items-start gap-2 text-sm text-slate-700">
                                    <Checkbox checked={accept} onCheckedChange={c => setAccept(Boolean(c))} className="mt-0.5" />
                                    <span>{tr("I've read and accept the ", "मैंने ")}<button type="button" className="underline text-orange-700" onClick={() => setTab("terms")}>{t("terms & conditions")}</button>{tr(".", " पढ़ लिए हैं और मुझे मंज़ूर हैं।")}</span>
                                </label>
                            ) : <span className="text-sm text-slate-700">{t("Join to start submitting your invoices.")}</span>}
                            <Button className="bg-orange-500 hover:bg-orange-600" disabled={joining || (Boolean(s.terms) && !accept)} onClick={join}>
                                {joining && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} {t("Join this scheme")}
                            </Button>
                        </div>
                    ) : <p className="text-sm text-slate-500">{t("This scheme has closed.")}</p>}

                    {s.contact && (
                        <div className="mt-auto pt-4 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                            <span className="text-slate-500">{t("Questions?")} <span className="font-semibold text-slate-800">{s.contact.name}</span>{s.contact.role && <span className="text-slate-500"> · {s.contact.role}</span>}</span>
                            {s.contact.phone && (
                                <a href={`tel:${s.contact.phone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1.5 text-slate-700 hover:text-orange-700">
                                    <Phone className="h-4 w-4 text-slate-400" /> {s.contact.phone}
                                </a>
                            )}
                            {s.contact.email && (
                                <a href={`mailto:${s.contact.email}`} className="inline-flex items-center gap-1.5 text-slate-700 hover:text-orange-700">
                                    <Mail className="h-4 w-4 text-slate-400" /> {s.contact.email}
                                </a>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* What the store has achieved: results only, never the gap to the next level. */}
            {d.joined && (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        {hasScore && <Stat label="Your points">{a?.score ?? 0}</Stat>}
                        {s.clubs?.length > 0 && (
                            <Stat label="Club" hint={a?.club?.reward ? `${t("Reward")}: ${a.club.reward}` : undefined}>
                                {a?.club ? <ClubBadge club={a.club} size="lg" /> : <span className="text-base font-medium text-slate-400">{t("Not in a club yet")}</span>}
                            </Stat>
                        )}
                        {hasScore && <Stat label="Rank">{a ? <>#{a.rank}</> : <span className="text-slate-400">—</span>}</Stat>}
                        <Stat label="Approved entries">{a?.approved ?? 0}</Stat>
                        <Stat label="Under review" hint={inReview ? t("Counts once approved") : undefined}>{inReview}</Stat>
                        {a?.reward && !a.club && <Stat label="Reward earned" className="col-span-2 lg:col-span-1"><span className="text-lg text-emerald-700">{a.reward}</span></Stat>}
                    </div>
                    {hasScore && d.months.length > 0 && (
                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="text-sm font-semibold text-slate-800 mb-3">{t("Points by month")}</p>
                            <div className="flex items-end gap-3 h-28 overflow-x-auto">
                                {d.months.map(m => (
                                    <div key={m.month} className="flex flex-col items-center justify-end gap-1 h-full min-w-[44px]">
                                        <span className="text-xs font-semibold tabular-nums text-slate-700">{m.points}</span>
                                        <div className="w-7 rounded-t bg-orange-400" style={{ height: `${Math.max(4, (m.points / maxMonth) * 72)}px` }} />
                                        <span className="text-[11px] text-slate-500 whitespace-nowrap">{formatMonth(m.month)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Tabs */}
            <div className="rounded-xl border border-slate-200 bg-white">
                <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2">
                    {tabs.map(([k, l]) => (
                        <button key={k} type="button" onClick={() => setTab(k)}
                            className={cn("px-3 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                                current === k ? "border-orange-500 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800")}>{l}</button>
                    ))}
                </div>

                <div className="p-4 sm:p-5 text-sm text-slate-700">
                    {current === "how" && (s.instructions ? <p className="whitespace-pre-wrap leading-relaxed max-w-3xl">{s.instructions}</p> : <p className="text-slate-400">{t("No instructions.")}</p>)}
                    {current === "terms" && (s.terms ? <p className="whitespace-pre-wrap leading-relaxed max-w-3xl">{s.terms}</p> : <p className="text-slate-400">{t("No terms for this scheme.")}</p>)}

                    {current === "rewards" && (
                        s.rewards.mode === "none" && !s.clubs?.length && !products.length ? <p className="text-slate-400">{t("This is an offer for information — there's no reward to earn.")}</p> : (
                            <div className="space-y-6">
                                {s.clubs?.length > 0 && (
                                    <section>
                                        <h3 className="text-sm font-semibold text-slate-900 mb-3">{t("Clubs")}</h3>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                                            {[...s.clubs].sort((x, y) => x.min - y.min).map(c => {
                                                const mine = a?.club?.id === c.id;
                                                const color = (CLUB_COLORS[c.color] ?? CLUB_COLORS.slate).swatch;
                                                return (
                                                    <div key={c.id} className={cn("relative rounded-xl border p-4 text-center", mine ? "border-orange-400 bg-orange-50 ring-2 ring-orange-200" : "border-slate-200 bg-white")}>
                                                        {mine && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white whitespace-nowrap">{t("YOU'RE HERE")}</span>}
                                                        <div className="mx-auto h-11 w-11 rounded-full flex items-center justify-center" style={{ backgroundColor: `${color}1a`, color }}>
                                                            <ClubIcon icon={c.icon} className="h-6 w-6" />
                                                        </div>
                                                        <p className="mt-2 font-bold text-slate-900">{c.name}</p>
                                                        <p className="text-xs text-slate-500 tabular-nums">{c.min}+ {t("points")}</p>
                                                        {c.reward && <p className="mt-2 text-xs font-medium text-slate-800 leading-snug">{c.reward}</p>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </section>
                                )}
                                {(s.rewards.mode === "slabs" || s.rewards.mode === "rank") && (
                                    <section>
                                        <h3 className="text-sm font-semibold text-slate-900 mb-3">{s.rewards.mode === "slabs" ? t("Rewards by score") : t("Prizes by rank")}</h3>
                                        <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-w-xl">
                                            {s.rewards.mode === "slabs" && s.rewards.slabs.map((sl, i) => (
                                                <div key={i} className="flex justify-between gap-4 px-4 py-2.5"><span className="text-slate-500">{t("Score")} {sl.min}{sl.max === null ? ` ${t("and above")}` : ` – ${sl.max}`}</span><span className="font-semibold text-slate-900">{sl.reward}</span></div>
                                            ))}
                                            {s.rewards.mode === "rank" && s.rewards.prizes.map((p, i) => (
                                                <div key={i} className="flex justify-between gap-4 px-4 py-2.5"><span className="text-slate-500">{p.from === p.to ? `${t("Rank")} ${p.from}` : `${t("Ranks")} ${p.from} – ${p.to}`}</span><span className="font-semibold text-slate-900">{p.reward}</span></div>
                                            ))}
                                        </div>
                                    </section>
                                )}
                                {(s.rewards.mode === "per_unit" || s.rewards.mode === "per_entry") && <p className="font-semibold text-slate-900">{rewardSummary(s.rewards)}</p>}
                                {products.length > 0 && (
                                    <section>
                                        <h3 className="text-sm font-semibold text-slate-900 mb-3">{t("Points per set")}</h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                                            {products.map(p => (
                                                <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                                                    <span className="text-slate-700 truncate">{p.name}</span>
                                                    <span className="shrink-0 rounded-md bg-orange-50 px-2 py-0.5 text-sm font-bold text-orange-700 tabular-nums">{p.points} {t("pts")}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                )}
                                <p className="text-xs text-slate-400">{t("Only approved entries count.")}</p>
                            </div>
                        )
                    )}

                    {current === "leaderboard" && d.leaderboard && (
                        !d.leaderboard.length ? <p className="text-slate-400">{t("No approved entries yet.")}</p> : <Leaderboard rows={d.leaderboard} />
                    )}

                    {current === "entries" && d.joined && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-slate-500">{d.entries.length ? tr(`${d.entries.length} entr${d.entries.length === 1 ? "y" : "ies"} sent`, `${d.entries.length} एंट्री भेजी गईं`) : ""}</p>
                                {d.entries.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                                        <Select value={dayPick} onValueChange={setDayPick}>
                                            <SelectTrigger className="h-9 w-full sm:w-[220px]" aria-label={t("Show entries from")}><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">{t("All dates")} ({d.entries.length})</SelectItem>
                                                {days.map(g => (
                                                    <SelectItem key={g.day} value={g.day}>{formatDay(g.day)} ({g.items.length})</SelectItem>
                                                ))}
                                                <SelectItem value="range">{t("Custom range…")}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {dayPick === "range" && (
                                            <span className="flex w-full sm:w-auto items-center gap-1.5 text-xs text-slate-500">
                                                <Input type="date" value={range.from} max={range.to || undefined} aria-label={t("From")}
                                                    onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="h-9 flex-1 min-w-0 sm:w-[150px] sm:flex-none" />
                                                {t("to")}
                                                <Input type="date" value={range.to} min={range.from || undefined} aria-label={t("To")}
                                                    onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="h-9 flex-1 min-w-0 sm:w-[150px] sm:flex-none" />
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            {!d.entries.length ? (
                                <div className="rounded-lg border border-dashed border-slate-300 py-10 text-center">
                                    <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                                    <p className="font-medium text-slate-700">{t("No entries yet")}</p>
                                    <p className="text-slate-500 mt-0.5">{t("Submit an invoice to start earning points.")}</p>
                                    {canSubmit && <Button className="mt-4 bg-orange-500 hover:bg-orange-600" onClick={() => setSubmitOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> {t("Submit invoice")}</Button>}
                                </div>
                            ) : !shownDays.length ? (
                                <p className="text-slate-400">{dayPick === "range" ? t("No entries on these dates.") : t("No entries on this date.")}</p>
                            ) : (
                                <div className="space-y-5">
                                    {shownDays.map(group => (
                                        <div key={group.day}>
                                            <p className="text-sm font-semibold text-slate-800 mb-2">
                                                {formatDay(group.day)}
                                                <span className="ml-2 font-normal text-slate-500">
                                                    {tr(`${group.items.length} entr${group.items.length === 1 ? "y" : "ies"}`, `${group.items.length} एंट्री`)}
                                                    {group.approved ? ` · ${tr(`${group.approved} approved`, `${group.approved} मंज़ूर`)}` : ""}
                                                    {group.pending ? ` · ${tr(`${group.pending} under review`, `${group.pending} जाँच में`)}` : ""}
                                                </span>
                                            </p>
                                            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                                                {group.items.map(e => <EntryRow key={e.id} e={e} scheme={s} hasScore={hasScore} />)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {canSubmit && !submitOpen && (
                <>
                    <div className="h-16 sm:hidden" aria-hidden />
                    <div className="sm:hidden fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                        <Button className="w-full h-11 text-base bg-orange-500 hover:bg-orange-600" onClick={() => setSubmitOpen(true)}>
                            <Plus className="h-5 w-5 mr-1.5" /> {t("Submit invoice")}
                        </Button>
                    </div>
                </>
            )}
            <EntryForm open={submitOpen} scheme={s} distributors={d.distributors} onClose={() => setSubmitOpen(false)} onDone={() => { setSubmitOpen(false); setTab("entries"); load(); }} />
            {s.banner_url && (
                <Dialog open={posterOpen} onOpenChange={setPosterOpen}>
                    <DialogContent className="max-w-3xl max-h-[94vh] overflow-y-auto p-3">
                        <DialogHeader className="px-1">
                            <DialogTitle>{s.title}</DialogTitle>
                            <DialogDescription>
                                <a href={s.banner_url} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1 text-orange-700 hover:underline">
                                    <Download className="h-3.5 w-3.5" /> {t("Download the poster")}
                                </a>
                            </DialogDescription>
                        </DialogHeader>
                        <img src={s.banner_url} alt={s.title} className="w-full h-auto rounded-lg" />
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}

/** One entry: what was on it, its points, its state and its files. */
function EntryRow({ e, scheme, hasScore }: { e: MyEntry; scheme: Omit<Scheme, "eligibility">; hasScore: boolean }) {
    const { t } = useLanguage();
    /* Approved: what the team counted. Otherwise: what the store said. */
    const lines = e.status === "approved" && (e.lines ?? []).length ? e.lines ?? [] : e.claimed_lines ?? [];
    const points = e.status === "approved" ? e.score : lines.reduce((n, l) => n + (Number(l.subtotal) || 0), 0);
    const answers = scheme.fields.filter(f => f.type !== "file" && e.answers[f.id]);
    const files = Object.values(e.files).flat();
    return (
        <div className="px-3 sm:px-4 py-3">
            <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                <div className="flex-1 min-w-0 space-y-1">
                    {lines.length > 0 ? (
                        <p className="font-medium text-slate-900">{lines.map(l => `${l.name} × ${l.qty}`).join(", ")}</p>
                    ) : !answers.length && <p className="text-slate-500">{files.length ? t("Invoice") : t("Entry")}</p>}
                    {(e.invoices ?? []).length > 1 && (
                        <ul className="text-xs text-slate-500 space-y-0.5">
                            {(e.invoices ?? []).map((inv, i) => (
                                <li key={i}><span className="text-slate-400">{t("Invoice")} {inv.invoice_no}:</span> {inv.lines.length ? inv.lines.map(l => `${l.name} × ${l.qty}`).join(", ") : t("nothing that counts")} · <b className="tabular-nums text-slate-700">{inv.points} {t("pts")}</b></li>
                            ))}
                        </ul>
                    )}
                    {answers.length > 0 && (
                        <p className="text-xs text-slate-500">{answers.map(f => <span key={f.id} className="mr-3"><span className="text-slate-400">{f.label}:</span> {e.answers[f.id]}</span>)}</p>
                    )}
                    {files.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {files.map(f => <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs rounded-md border border-slate-200 px-2 py-1 sm:px-1.5 sm:py-0.5 text-sky-700 hover:border-sky-300 max-w-full sm:max-w-[220px]"><Paperclip className="h-3 w-3 shrink-0" /><span className="truncate">{f.name}</span></a>)}
                        </div>
                    )}
                </div>
                <div className="flex items-center justify-between gap-3 sm:contents">
                {hasScore && (e.status === "pending" && !lines.length ? (
                    <p className="sm:text-right sm:w-24 shrink-0 text-xs text-slate-400">{t("Points after review")}</p>
                ) : (
                    <div className="sm:text-right sm:w-24 shrink-0 flex items-baseline gap-1.5 sm:block">
                        <p className={cn("font-bold tabular-nums", e.status === "approved" ? "text-slate-900" : e.status === "rejected" ? "text-slate-300 line-through" : "text-slate-500")}>{points} {t("pts")}</p>
                        {e.status === "pending" && points > 0 && <p className="text-[11px] text-slate-400">{t("if approved")}</p>}
                    </div>
                ))}
                <div className="sm:w-28 shrink-0 text-right flex items-center gap-2 sm:block">
                    <p className="text-[11px] text-slate-400 sm:hidden">{when(e.created_at)}</p>
                    <span className={cn("inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium", ENTRY_META[e.status].tone)}>{t(ENTRY_META[e.status].label)}</span>
                    <p className="text-[11px] text-slate-400 mt-1 hidden sm:block">{when(e.created_at)}</p>
                </div>
                </div>
            </div>
            {e.status === "rejected" && e.review_note && <p className="mt-2 text-xs text-rose-700 bg-rose-50 rounded-md px-3 py-2">{t("Reason")}: {e.review_note}</p>}
        </div>
    );
}

/** The top three on a podium, then everyone else; the store's own row stands out. */
function Leaderboard({ rows }: { rows: NonNullable<Detail["leaderboard"]> }) {
    const { t } = useLanguage();
    const top = rows.filter(r => r.rank <= 3).slice(0, 3);
    const rest = rows.filter(r => !top.includes(r));
    const medal = ["text-amber-500", "text-slate-400", "text-orange-700"];
    const clubIcon = (c?: Club | null) => c && <span title={c.name} style={{ color: (CLUB_COLORS[c.color] ?? CLUB_COLORS.slate).swatch }}><ClubIcon icon={c.icon} className="h-4 w-4" /></span>;
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {top.map(r => (
                    <div key={`${r.rank}-${r.name}`} className={cn("rounded-xl border p-4 flex items-center gap-3", r.me ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-white")}>
                        <div className="h-10 w-10 rounded-full bg-slate-50 flex items-center justify-center shrink-0">
                            {r.rank === 1 ? <Trophy className={cn("h-5 w-5", medal[0])} /> : <Medal className={cn("h-5 w-5", medal[r.rank - 1] ?? "text-slate-400")} />}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-xs text-slate-500">#{r.rank}{r.me && <span className="ml-1.5 font-bold text-orange-700">{t("You")}</span>}</p>
                            <p className="font-semibold text-slate-900 truncate">{r.name}</p>
                        </div>
                        <div className="text-right shrink-0">
                            <p className="font-bold tabular-nums text-slate-900">{r.score}</p>
                            {clubIcon(r.club)}
                        </div>
                    </div>
                ))}
            </div>
            {rest.length > 0 && (
                <ol className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                    {rest.map(r => (
                        <li key={`${r.rank}-${r.name}`} className={cn("flex items-center justify-between gap-3 px-4 py-2.5", r.me && "bg-orange-50")}>
                            <span className="flex items-center gap-3 min-w-0">
                                <span className="w-10 tabular-nums text-slate-500">#{r.rank}</span>
                                <span className={cn("truncate", r.me ? "font-bold text-slate-900" : "text-slate-800")}>{r.name}</span>
                                {r.me && <span className="rounded bg-orange-500 px-1.5 text-[10px] font-bold text-white">{t("YOU")}</span>}
                            </span>
                            <span className="flex items-center gap-2">{clubIcon(r.club)}<span className="tabular-nums font-semibold text-slate-800">{r.score}</span></span>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}

/**
 * The form the admin built, filled in by the store; files are picked per
 * field. On a scheme scored by products the store only sends its invoice:
 * our team reads it and adds the products and points when approving.
 */
function EntryForm({ open, scheme, distributors, onClose, onDone }: {
    open: boolean; scheme: Omit<Scheme, "eligibility">; distributors: { id: string; name: string; city: string | null }[];
    onClose: () => void; onDone: () => void;
}) {
    const byProducts = scheme.score_rule.mode === "products";
    const [confirming, setConfirming] = useState(false);
    const invoiceField = scheme.fields.find(f => f.type === "file");
    const [other, setOther] = useState<Record<string, string>>({});
    const { toast } = useToast();
    const { t, tr } = useLanguage();
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [files, setFiles] = useState<Record<string, File[]>>({});
    const [sending, setSending] = useState(false);
    const [problems, setProblems] = useState<string[]>([]);
    const [dragOver, setDragOver] = useState<string | null>(null);

    useEffect(() => {
        if (open) { setAnswers({}); setFiles({}); setProblems([]); setOther({}); setConfirming(false); }
    }, [open]);
    /** Files picked or dropped on a file field, up to the field's limit. */
    const addFiles = (f: Scheme["fields"][number], picked: File[]) => {
        if (!picked.length) return;
        setFiles(m => ({ ...m, [f.id]: [...(m[f.id] ?? []), ...picked].slice(0, f.max_files ?? 1) }));
    };

    const send = async () => {
        setSending(true); setProblems([]);
        try {
            const form = new FormData();
            /* A distributor typed under "Other" stands in for the choice. */
            const sent = { ...answers };
            for (const [k, v] of Object.entries(other)) if (sent[k] === "__other") sent[k] = v.trim();
            form.append("answers", JSON.stringify(sent));
            for (const [fid, list] of Object.entries(files)) for (const f of list) form.append(fid, f);
            await api.post(`/schemes/${scheme.id}/entries`, form, { headers: { "Content-Type": "multipart/form-data" } });
            toast({ title: t("Invoice sent"), description: t("Our team will check it and add your points.") });
            onDone();
        } catch (e: any) {
            const list = e?.response?.data?.problems;
            setProblems(Array.isArray(list) && list.length ? list : [getErrorMessage(e, t("Could not submit"))]);
        } finally { setSending(false); }
    };

    /* What is missing, said before the "are you sure" step rather than after sending. */
    const review = () => {
        const missing: string[] = [];
        for (const fl of scheme.fields) {
            if (!fl.required) continue;
            const empty = fl.type === "file" ? !(files[fl.id] ?? []).length
                : !String(answers[fl.id] === "__other" ? other[fl.id] ?? "" : answers[fl.id] ?? "").trim();
            if (empty) missing.push(fl.type === "file" ? tr(`Add the ${fl.label}`, `${fl.label} जोड़ें`) : tr(`Fill in ${fl.label}`, `${fl.label} भरें`));
        }
        if (byProducts && !Object.values(files).some(l => l.length) && !missing.length) missing.push(t("Add your invoice"));
        setProblems(missing);
        if (!missing.length) setConfirming(true);
    };

    /* File fields first (the invoice is what the entry is about), then the rest. */
    const fileFields = scheme.fields.filter(f => f.type === "file");
    const otherFields = scheme.fields.filter(f => f.type !== "file");
    const label = (f: Scheme["fields"][number]) => (
        <label htmlFor={`e-${f.id}`} className="text-sm font-medium text-slate-800">
            {f.label}{f.required && <span className="text-rose-500"> *</span>}
        </label>
    );

    return (
        <Dialog open={open} onOpenChange={o => { if (!o && !sending) onClose(); }}>
            <DialogContent className="flex flex-col gap-0 p-0 max-w-none h-[100dvh] max-h-[100dvh] rounded-none sm:max-w-xl sm:h-auto sm:max-h-[92vh] sm:rounded-xl overflow-hidden">
                <DialogHeader className="px-4 pt-4 pb-3 pr-12 border-b border-slate-100 text-left">
                    <DialogTitle>{t("Submit invoice")}</DialogTitle>
                    <DialogDescription>{scheme.title}</DialogDescription>
                </DialogHeader>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
                    {fileFields.map(f => {
                        const picked = files[f.id] ?? [];
                        const full = picked.length >= (f.max_files ?? 1);
                        return (
                            <div key={f.id} className="space-y-2">
                                {label(f)}
                                {!full && (f.formats ?? []).includes("image") && (
                                    <label className="sm:hidden flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3.5 text-base font-semibold text-white active:bg-orange-600">
                                        <Upload className="h-5 w-5" /> {t("Take a photo of the invoice")}
                                        <input type="file" accept="image/*" capture="environment" className="hidden"
                                            onChange={e => { addFiles(f, Array.from(e.target.files ?? [])); e.target.value = ""; }} />
                                    </label>
                                )}
                                {!full && (
                                    <label
                                        onDragOver={e => { e.preventDefault(); setDragOver(f.id); }}
                                        onDragLeave={() => setDragOver(null)}
                                        onDrop={e => { e.preventDefault(); setDragOver(null); addFiles(f, Array.from(e.dataTransfer.files ?? [])); }}
                                        className={cn("flex flex-col items-center justify-center gap-1.5 cursor-pointer rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors",
                                            dragOver === f.id ? "border-orange-400 bg-orange-50" : "border-slate-300 bg-slate-50 hover:border-orange-300 hover:bg-orange-50/40")}>
                                        <div className="h-10 w-10 rounded-full bg-white border border-slate-200 flex items-center justify-center"><Upload className="h-5 w-5 text-orange-500" /></div>
                                        <p className="text-sm font-medium text-slate-800">{f.id === invoiceField?.id ? t("Drop the invoice here, or") : t("Drop the file here, or")} <span className="text-orange-600">{t("tap to choose")}</span></p>
                                        <p className="text-xs text-slate-500">
                                            {(f.formats ?? []).map(x => FORMAT_LABEL[x]).join(", ")} · {tr(`up to ${f.max_files ?? 1} file${(f.max_files ?? 1) === 1 ? "" : "s"}, ${f.max_mb ?? 10} MB each`, `ज़्यादा से ज़्यादा ${f.max_files ?? 1} फ़ाइल, हर एक ${f.max_mb ?? 10} MB तक`)}
                                        </p>
                                        <input id={`e-${f.id}`} type="file" className="hidden" multiple={(f.max_files ?? 1) > 1}
                                            accept={(f.formats ?? []).map(x => FORMAT_ACCEPT[x]).join(",")}
                                            onChange={e => { addFiles(f, Array.from(e.target.files ?? [])); e.target.value = ""; }} />
                                    </label>
                                )}
                                {picked.length > 0 && <p className="text-xs text-slate-500">{tr(`${picked.length} of ${f.max_files ?? 1} added`, `${picked.length} / ${f.max_files ?? 1} जोड़ी गईं`)}</p>}
                                {picked.map((file, i) => (
                                    <div key={i} className="flex items-center justify-between gap-2 text-sm text-slate-700 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                                        <span className="truncate flex items-center gap-2"><span className="shrink-0 h-6 w-6 rounded bg-slate-100 text-xs font-bold text-slate-500 flex items-center justify-center tabular-nums">{i + 1}</span><span className="truncate">{file.name}</span><span className="shrink-0 text-xs text-slate-400">{(file.size / 1048576).toFixed(1)} MB</span></span>
                                        <button type="button" className="text-slate-400 hover:text-rose-600" aria-label={t("Remove file")}
                                            onClick={() => setFiles(m => ({ ...m, [f.id]: m[f.id].filter((_, j) => j !== i) }))}><X className="h-4 w-4" /></button>
                                    </div>
                                ))}
                            </div>
                        );
                    })}

                    {byProducts && (
                        <p className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2.5 text-sm text-sky-900 flex items-start gap-2">
                            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-sky-600" />
                            <span>{t("Just send the invoice — our team reads it and adds the series and your points. You'll see them here once it's approved.")}</span>
                        </p>
                    )}

                    {otherFields.map(f => (
                        <div key={f.id} className="space-y-1.5">
                            {label(f)}
                            {f.type === "distributor" ? (
                                <div className="space-y-1.5">
                                    <Select value={answers[f.id] ?? ""} onValueChange={v => setAnswers(a => ({ ...a, [f.id]: v }))}>
                                        <SelectTrigger id={`e-${f.id}`}><SelectValue placeholder={t("The distributor you bought from")} /></SelectTrigger>
                                        <SelectContent>
                                            {distributors.map(dd => <SelectItem key={dd.id} value={dd.name}>{dd.name}{dd.city ? ` · ${dd.city}` : ""}</SelectItem>)}
                                            <SelectItem value="__other">{t("Other…")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    {answers[f.id] === "__other" && (
                                        <Input value={other[f.id] ?? ""} onChange={e => setOther(o => ({ ...o, [f.id]: e.target.value }))} placeholder={t("Distributor name")} />
                                    )}
                                </div>
                            ) : f.type === "select" ? (
                                <Select value={answers[f.id] ?? ""} onValueChange={v => setAnswers(a => ({ ...a, [f.id]: v }))}>
                                    <SelectTrigger id={`e-${f.id}`}><SelectValue placeholder={t("Choose")} /></SelectTrigger>
                                    <SelectContent>{(f.options ?? []).filter(Boolean).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                                </Select>
                            ) : (
                                <Input id={`e-${f.id}`} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} min={f.type === "number" ? 0 : undefined}
                                    value={answers[f.id] ?? ""} onChange={e => setAnswers(a => ({ ...a, [f.id]: e.target.value }))} />
                            )}
                        </div>
                    ))}

                    {problems.length > 0 && (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                            <ul className="list-disc pl-5 space-y-0.5">{problems.map(p => <li key={p}>{p}</li>)}</ul>
                        </div>
                    )}
                </div>
                <DialogFooter className="flex-row gap-2 border-t border-slate-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose} disabled={sending}>{t("Cancel")}</Button>
                    <Button className="flex-1 sm:flex-none bg-orange-500 hover:bg-orange-600" onClick={review} disabled={sending}>
                        {t("Review & submit")} <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                </DialogFooter>
            </DialogContent>

            {/* Are you sure: what is about to be sent. */}
            <Dialog open={confirming} onOpenChange={o => { if (!o && !sending) setConfirming(false); }}>
                <DialogContent className="w-[calc(100%-1.5rem)] max-w-md rounded-xl max-h-[85dvh] overflow-y-auto">
                    <DialogHeader className="text-left">
                        <DialogTitle>{t("Submit this entry?")}</DialogTitle>
                        <DialogDescription>{t("Check it once more — you can't change an entry after sending it.")}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 text-sm">
                        {scheme.fields.filter(f => f.type === "file" && (files[f.id] ?? []).length).map(f => (
                            <div key={f.id}>
                                <p className="text-slate-400 mb-1">{f.label}</p>
                                <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                                    {(files[f.id] ?? []).map((file, i) => (
                                        <li key={i} className="flex items-center gap-2 px-3 py-2 text-slate-800"><FileText className="h-4 w-4 text-slate-400 shrink-0" /><span className="truncate">{file.name}</span></li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                        {scheme.fields.filter(f => f.type !== "file" && answers[f.id]).map(f => (
                            <p key={f.id} className="text-slate-600"><span className="text-slate-400">{f.label}:</span> {answers[f.id] === "__other" ? (other[f.id] || "—") : answers[f.id]}</p>
                        ))}
                        {byProducts && <p className="text-xs text-slate-500">{t("Points are added after our team checks the invoice.")}</p>}
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setConfirming(false)} disabled={sending}>{t("Go back and edit")}</Button>
                        <Button className="bg-orange-500 hover:bg-orange-600" disabled={sending}
                            onClick={async () => { await send(); setConfirming(false); }}>
                            {sending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} {t("Yes, submit")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Dialog>
    );
}
