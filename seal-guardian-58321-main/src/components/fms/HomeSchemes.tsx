import { ArrowRight, CalendarDays, CheckCircle2, Gift, Target, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClubBadge } from "@/components/schemes/ClubBadge";
import type { Club } from "@/lib/schemes";
import { daysLeft, type StorePeriod } from "./SchemeTargetView";

/**
 * "Your schemes" on the franchise's home: every scheme running for the store
 * and every one coming up, as a card each in the home's own light style — the
 * scheme's poster on top, one big number, a progress bar, and one button. A
 * target scheme shows how many more and the reward; a points scheme its
 * points, club and rank; one coming up, when it starts.
 */

export interface HomeScheme {
    id: string; title: string; summary?: string | null; state: string; starts_on?: string; banner_url?: string | null;
    joined: boolean; has_score: boolean;
    open_window: { start: string; end: string } | null;
    next_window: { start: string; end: string } | null;
    achieved: { score: number; rank: number; of: number; club?: Club | null } | null;
    run?: "targets"; target_now?: StorePeriod | null;
}

const W = {
    en: {
        title: "Your schemes", seeAll: "See all schemes",
        count: (live: number, soon: number) => [live ? `${live} running` : "", soon ? `${soon} coming up` : ""].filter(Boolean).join(" · "),
        live: "Live", soon: "Coming up", target: "Target scheme", points: "Points scheme",
        daysLeft: (n: number) => (n === 1 ? "Last day" : `${n} days left`),
        of: (t: string) => `of ${t}`, more: (n: string) => `${n} more to go`, toWin: "to win",
        reached: "Target reached!", notSet: "Your target shows here once it's set.",
        viewTarget: "View my target", submitTill: (d: string) => `Submit till ${d}`, opens: (d: string) => `Opens ${d}`,
        pts: "points", rank: (r: number, of: number) => `Rank ${r} of ${of}`, noPoints: "Your points show once an invoice is approved.",
        submit: "Submit invoice", join: "Join the scheme", open: "Open the scheme", starts: (d: string) => `Starts ${d}`, see: "See what's in it",
    },
    hi: {
        title: "आपकी स्कीम", seeAll: "सभी स्कीम देखें",
        count: (live: number, soon: number) => [live ? `${live} चालू` : "", soon ? `${soon} आने वाली` : ""].filter(Boolean).join(" · "),
        live: "चालू", soon: "जल्द आ रही", target: "टारगेट स्कीम", points: "पॉइंट स्कीम",
        daysLeft: (n: number) => (n === 1 ? "आख़िरी दिन" : `${n} दिन बाकी`),
        of: (t: string) => `/ ${t}`, more: (n: string) => `${n} और चाहिए`, toWin: "जीतने के लिए",
        reached: "टारगेट पूरा!", notSet: "टारगेट तय होते ही यहाँ दिखेगा।",
        viewTarget: "मेरा टारगेट देखें", submitTill: (d: string) => `${d} तक जमा करें`, opens: (d: string) => `${d} से खुलेगा`,
        pts: "पॉइंट", rank: (r: number, of: number) => `${of} में रैंक ${r}`, noPoints: "इनवॉइस मंज़ूर होते ही पॉइंट दिखेंगे।",
        submit: "इनवॉइस जमा करें", join: "स्कीम से जुड़ें", open: "स्कीम खोलें", starts: (d: string) => `${d} से शुरू`, see: "देखें इसमें क्या है",
    },
};

const day = (stamp: string | undefined | null, locale: string) =>
    stamp ? new Date(stamp.slice(0, 10) + "T00:00:00Z").toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" }) : "";
const num = (n: number) => n.toLocaleString("en-IN");

/** The card's top: the scheme's poster, or a soft panel with its kind; the live/coming-up badge and the date on it. */
function Top({ s, kind, badge, chip }: { s: HomeScheme; kind: "target" | "points"; badge: { text: string; live: boolean }; chip?: string | null }) {
    const Icon = kind === "target" ? Target : Trophy;
    return (
        <div className="relative h-28 overflow-hidden rounded-t-2xl bg-orange-50">
            {s.banner_url
                ? <img src={s.banner_url} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
                : <div className="flex h-full items-center justify-center"><Icon className="h-10 w-10 text-orange-300" aria-hidden /></div>}
            <span className={cn("absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold shadow-sm",
                badge.live ? "bg-white text-emerald-700" : "bg-white text-sky-700")}>
                {badge.live ? <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> : <CalendarDays className="h-3.5 w-3.5" />}{badge.text}
            </span>
            {chip && <span className="absolute right-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm">{chip}</span>}
        </div>
    );
}

export function HomeSchemes({ schemes, lang, onOpen }: { schemes: HomeScheme[] | undefined; lang: "en" | "hi"; onOpen: (id: string) => void }) {
    const w = W[lang];
    const locale = lang === "hi" ? "hi-IN" : "en-IN";
    if (schemes === undefined) {
        return <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="h-72 animate-pulse rounded-2xl bg-slate-100" />)}</div>;
    }
    const live = schemes.filter(s => s.state === "live");
    const soon = schemes.filter(s => s.state === "upcoming");
    if (!live.length && !soon.length) return null;

    const card = "group flex w-[82vw] max-w-[340px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md sm:w-auto sm:max-w-none";
    const button = (text: string, primary = true) => (
        <span className={cn("mt-auto flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition-colors",
            primary ? "bg-orange-500 text-white group-hover:bg-orange-600" : "border border-slate-300 text-slate-800 group-hover:border-slate-400")}>
            {text} <ArrowRight className="h-4 w-4" />
        </span>
    );

    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-slate-900">{w.title}</h2>
                    <p className="text-sm text-slate-500">{w.count(live.length, soon.length)}</p>
                </div>
                <button type="button" onClick={() => onOpen("")} className="flex h-10 items-center gap-1 text-sm font-semibold text-orange-700 hover:underline">
                    {w.seeAll} <ArrowRight className="h-4 w-4" />
                </button>
            </div>
            <div className="-mx-1 flex snap-x gap-4 overflow-x-auto no-scrollbar px-1 pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
                {live.map(s => {
                    if (s.run === "targets") {
                        const p = s.target_now;
                        const target = p?.target ?? null;
                        const done = p?.achieved ?? 0;
                        const reached = target !== null && done >= target;
                        const left = p ? daysLeft(p) : null;
                        const reward = p?.benefit ?? p?.reward ?? null;
                        const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
                        return (
                            <button key={s.id} type="button" onClick={() => onOpen(s.id)} className={card}>
                                <Top s={s} kind="target" badge={{ text: w.live, live: true }} chip={left ? w.daysLeft(left) : null} />
                                <div className="flex flex-1 flex-col gap-3 p-4">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-orange-600">{w.target}{p ? ` · ${p.label}` : ""}</p>
                                        <p className="mt-0.5 text-base font-bold leading-snug text-slate-900">{s.title}</p>
                                    </div>
                                    {target !== null ? (
                                        <>
                                            <div>
                                                <p className="flex items-baseline gap-1.5">
                                                    <span className={cn("text-4xl font-extrabold leading-none tabular-nums", reached ? "text-emerald-600" : "text-slate-900")}>{num(done)}</span>
                                                    <span className="text-sm font-medium text-slate-500">{w.of(num(target))}</span>
                                                </p>
                                                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                                                    <div className={cn("h-full rounded-full transition-all duration-700", reached ? "bg-emerald-500" : "bg-orange-500")} style={{ width: `${Math.max(pct, 3)}%` }} />
                                                </div>
                                            </div>
                                            {reached ? (
                                                <p className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800"><CheckCircle2 className="h-4 w-4" />{w.reached}{reward ? ` · ${reward}` : ""}</p>
                                            ) : (
                                                <p className="flex items-center gap-2 rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-950">
                                                    <Gift className="h-4 w-4 shrink-0 text-orange-600" />
                                                    <span><b>{w.more(num(target - done))}</b>{reward ? <> {w.toWin} <b>{reward}</b></> : null}</span>
                                                </p>
                                            )}
                                        </>
                                    ) : <p className="text-sm text-slate-500">{w.notSet}</p>}
                                    {button(w.viewTarget)}
                                </div>
                            </button>
                        );
                    }
                    const a = s.joined ? s.achieved : null;
                    const chip = s.open_window ? w.submitTill(day(s.open_window.end, locale)) : s.next_window ? w.opens(day(s.next_window.start, locale)) : null;
                    return (
                        <button key={s.id} type="button" onClick={() => onOpen(s.id)} className={card}>
                            <Top s={s} kind="points" badge={{ text: w.live, live: true }} chip={chip} />
                            <div className="flex flex-1 flex-col gap-3 p-4">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-orange-600">{w.points}</p>
                                    <p className="mt-0.5 text-base font-bold leading-snug text-slate-900">{s.title}</p>
                                </div>
                                {a ? (
                                    <div className="flex items-end justify-between gap-3">
                                        {s.has_score && (
                                            <p className="flex items-baseline gap-1.5">
                                                <span className="text-4xl font-extrabold leading-none tabular-nums text-slate-900">{num(a.score)}</span>
                                                <span className="text-sm font-medium text-slate-500">{w.pts}</span>
                                            </p>
                                        )}
                                        <div className="flex flex-col items-end gap-1.5">
                                            {a.club && <ClubBadge club={a.club} />}
                                            {s.has_score && <span className="text-xs font-semibold text-slate-600">{w.rank(a.rank, a.of)}</span>}
                                        </div>
                                    </div>
                                ) : <p className="text-sm text-slate-500">{s.joined ? w.noPoints : s.summary || ""}</p>}
                                {button(!s.joined ? w.join : s.open_window ? w.submit : w.open, !s.joined || Boolean(s.open_window))}
                            </div>
                        </button>
                    );
                })}
                {soon.map(s => (
                    <button key={s.id} type="button" onClick={() => onOpen(s.id)} className={card}>
                        <Top s={s} kind={s.run === "targets" ? "target" : "points"} badge={{ text: w.soon, live: false }}
                            chip={w.starts(day(s.target_now?.from ?? s.next_window?.start ?? s.starts_on, locale))} />
                        <div className="flex flex-1 flex-col gap-3 p-4">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{s.run === "targets" ? w.target : w.points}</p>
                                <p className="mt-0.5 text-base font-bold leading-snug text-slate-900">{s.title}</p>
                            </div>
                            {s.summary && <p className="line-clamp-2 text-sm text-slate-600">{s.summary}</p>}
                            {s.run === "targets" && s.target_now?.target != null && (
                                <p className="text-sm text-slate-700"><b className="text-2xl font-extrabold text-slate-900">{num(s.target_now.target)}</b> · {w.target.toLowerCase()}{s.target_now.reward ? ` · ${s.target_now.reward}` : ""}</p>
                            )}
                            {button(w.see, false)}
                        </div>
                    </button>
                ))}
            </div>
        </section>
    );
}
