import { useState } from "react";
import { ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import type { BenefitKind, Scheme, TargetStep, TargetVisibility } from "@/lib/schemes";

/**
 * A target scheme as the franchise sees it: its target for the period, how
 * many it has done and how many more it needs (a day, for the days left), the
 * reward it is working towards, and the other periods. Only what the head
 * office switched on comes from the server; the growth % never does.
 */

export interface StorePeriod {
    key: string; label: string; from?: string | null; to?: string | null;
    target: number | null; achieved: number | null; pct: number | null;
    step_no: number | null; benefit: string | null; to_next: number | null; paid: boolean; updated_at: string | null;
    /* The reward it is working towards; counted from warranties, those not yet approved. */
    reward?: string | null; pending?: number | null;
}
/** Counted in points: what each series is worth to this store, and per period what each earned. */
export interface StorePoints {
    tier: string | null; times: number;
    series: { name: string; points: number }[];
    breakdown: Record<string, { name: string; count: number; points: number }[]>;
}
export interface StoreTargets { points?: StorePoints | null; unit: string; benefit: BenefitKind; show: TargetVisibility; steps: TargetStep[]; periods: StorePeriod[]; now: StorePeriod | null }

const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-IN"));
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Days left in a period (counting today), or null when it has not started or has ended. */
export function daysLeft(p: { from?: string | null; to?: string | null }, today = istToday()) {
    if (!p.from || !p.to || today < p.from || today > p.to) return null;
    return dayDiff(today, p.to) + 1;
}

/** A progress ring: how far through the target, with the count in the middle. */
export function Ring({ done, target, size = 220, stroke = 18, children }: { done: number; target: number; size?: number; stroke?: number; children?: React.ReactNode }) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const part = target > 0 ? Math.min(done / target, 1) : 0;
    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#374151" strokeWidth={stroke} />
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={part >= 1 ? "#22C55E" : "#F97316"} strokeWidth={stroke} strokeLinecap="round"
                    strokeDasharray={`${part * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dasharray 0.8s ease" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
        </div>
    );
}

export function SchemeTargetView({ scheme, targets, onBack, onRefresh }: {
    scheme: Omit<Scheme, "eligibility">; targets: StoreTargets; onBack: () => void; onRefresh: () => Promise<unknown>;
}) {
    const { t } = useLanguage();
    const [pick, setPick] = useState(targets.now?.key ?? targets.periods[0]?.key);
    const [refreshing, setRefreshing] = useState(false);
    const p = targets.periods.find(x => x.key === pick) ?? null;
    const today = istToday();
    const unit = targets.unit || "warranties";
    const done = p?.achieved ?? 0;
    const target = p?.target ?? null;
    const reached = target !== null && done >= target;
    const togo = target !== null ? Math.max(target - done, 0) : null;
    const left = p ? daysLeft(p, today) : null;
    const perDay = togo && left ? Math.ceil(togo / left) : null;
    const upcoming = Boolean(p?.from && today < p.from);
    const ended = Boolean(p?.to && today > p.to);
    const reward = p?.benefit ?? p?.reward ?? null;
    const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;

    return (
        <div className="mx-auto max-w-4xl space-y-5 pb-8">
            <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={onBack} className="flex h-10 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-orange-600"><ArrowLeft className="h-4 w-4" /> {t("All schemes")}</button>
                <div className="flex items-center gap-2">
                    {p && (
                        <span className={cn("rounded-full px-3 py-1 text-xs font-bold", upcoming ? "bg-sky-100 text-sky-800" : ended ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-800")}>
                            {upcoming ? t("Starts soon") : ended ? t("Ended") : `● ${t("Running")}${left ? ` · ${left} ${left === 1 ? t("day left") : t("days left")}` : ""}`}
                        </span>
                    )}
                    <Button variant="outline" size="icon" disabled={refreshing} aria-label={t("Refresh")} onClick={() => { setRefreshing(true); onRefresh().finally(() => setRefreshing(false)); }}>
                        <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                    </Button>
                </div>
            </div>

            <div>
                {p && <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-orange-700">{p.label}</p>}
                <h1 className="mt-1 text-2xl font-black text-slate-900 sm:text-4xl">{scheme.title}</h1>
                {scheme.summary && <p className="mt-1 text-sm text-slate-600">{scheme.summary}</p>}
            </div>

            {p && target !== null ? (
                <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                    <section className="flex flex-col items-center gap-6 rounded-3xl bg-slate-900 p-6 text-white sm:flex-row sm:p-8">
                        <Ring done={done} target={target} size={190}>
                            <span className="text-5xl font-black tabular-nums leading-none">{num(done)}</span>
                            <span className="mt-1 text-sm font-semibold text-slate-400">{t("of")} {num(target)} {unit}</span>
                        </Ring>
                        <div className="space-y-3 text-center sm:text-left">
                            {reached ? (
                                <>
                                    <p className="flex items-center justify-center gap-2 text-4xl font-black text-emerald-400 sm:justify-start sm:text-5xl"><CheckCircle2 className="h-10 w-10" />{t("Target reached!")}</p>
                                    <p className="text-base text-slate-200">{t("Well done. Every warranty from here is extra.")}</p>
                                </>
                            ) : upcoming ? (
                                <>
                                    <p className="text-sm text-slate-300">{t("Your target")}</p>
                                    <p className="text-5xl font-black leading-none text-orange-300">{num(target)}</p>
                                    <p className="text-base text-slate-200">{t("Starts")} {p.from?.slice(8)} {p.label.split(" ")[1]}.</p>
                                </>
                            ) : (
                                <>
                                    <p className="text-sm text-slate-300">{ended ? t("It ended") : t("You need")}</p>
                                    <p className="text-5xl font-black leading-none text-orange-300">{num(togo)} {t("more")}</p>
                                    {perDay && <p className="text-base text-slate-200">{t("That's about")} <b className="text-white">{perDay} {t("a day")}</b> {t("for the next")} {left} {left === 1 ? t("day") : t("days")}.</p>}
                                </>
                            )}
                            {p.pending ? <p className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-amber-300">+{num(p.pending)} {t("registered, waiting for approval")}</p> : null}
                        </div>
                    </section>

                    {reward && (
                        <section className={cn("flex flex-col justify-center gap-2 rounded-3xl border-2 border-dashed p-6", reached ? "border-emerald-400 bg-emerald-50" : "border-orange-400 bg-orange-50")}>
                            <p className={cn("text-xs font-extrabold uppercase tracking-[0.12em]", reached ? "text-emerald-800" : "text-orange-800")}>{reached ? t("You've earned") : t("Your reward")}</p>
                            <p className="text-4xl font-black leading-tight text-slate-900">{reward}</p>
                            {reached
                                ? <p className="text-sm font-semibold text-emerald-800">{p.paid ? t("Paid") : t("Autoform will give it to you")}</p>
                                : <>
                                    <p className="text-sm text-orange-950">{t("Unlocks at")} <b>{num(target)}</b> {unit}.</p>
                                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-orange-200"><div className="h-full rounded-full bg-orange-600" style={{ width: `${pct}%` }} /></div>
                                    <p className="text-xs text-orange-900">{pct}% {t("of the way there")}</p>
                                </>}
                        </section>
                    )}
                </div>
            ) : (
                <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">{t("Your target for this period isn't set yet. It shows here as soon as Autoform sets it.")}</p>
            )}

            {targets.points && p && (
                <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 className="text-base font-extrabold text-slate-900">{t("Points")} · {p.label}</h2>
                        {targets.points.tier && <span className="text-xs font-semibold text-slate-500">{targets.points.tier}{targets.points.times !== 1 ? ` ×${targets.points.times}` : ""}</span>}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[320px] text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                                    <th className="py-2 font-bold">{t("Series")}</th>
                                    <th className="py-2 text-right font-bold">{t("Points each")}</th>
                                    <th className="py-2 text-right font-bold">{t("Warranties")}</th>
                                    <th className="py-2 text-right font-bold">{t("Points")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {targets.points.series.map((x, i) => {
                                    const got = targets.points!.breakdown[p.key]?.[i];
                                    return (
                                        <tr key={x.name}>
                                            <td className="py-2.5 font-semibold text-slate-900">{x.name}</td>
                                            <td className="py-2.5 text-right tabular-nums text-slate-700">{num(x.points)}</td>
                                            <td className="py-2.5 text-right tabular-nums text-slate-700">{num(got?.count ?? 0)}</td>
                                            <td className="py-2.5 text-right font-bold tabular-nums text-slate-900">{num(got?.points ?? 0)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {targets.periods.length > 1 && (
                <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5">
                    <h2 className="text-base font-extrabold text-slate-900">{t("Month by month")}</h2>
                    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 sm:grid sm:grid-cols-3 [&>*]:shrink-0">
                        {targets.periods.map(x => {
                            const now = x.key === targets.now?.key;
                            const got = x.target !== null && (x.achieved ?? 0) >= x.target;
                            const future = Boolean(x.from && today < x.from);
                            return (
                                <button key={x.key} type="button" onClick={() => setPick(x.key)}
                                    className={cn("w-44 rounded-2xl p-4 text-left sm:w-auto", x.key === pick ? "border-2 border-orange-500" : "border border-slate-200 hover:border-slate-400")}>
                                    <span className={cn("block text-xs font-bold", now ? "text-orange-700" : "text-slate-500")}>{now ? `${t("NOW")} · ` : ""}{x.label}</span>
                                    <b className="mt-1 block text-xl tabular-nums text-slate-900">{future ? `${t("Target")} ${num(x.target)}` : `${num(x.achieved ?? 0)} / ${num(x.target)}`}</b>
                                    <span className={cn("block text-xs", got ? "font-bold text-emerald-700" : "text-slate-500")}>
                                        {got ? `✓ ${t("Reached")}${x.paid ? ` · ${t("Paid")}` : ""}` : future ? `${t("Starts")} ${x.from?.slice(8)}` : x.to && today > x.to ? t("Not reached") : x.reward ? `${t("Reward")} ${x.reward}` : ""}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}

            {(scheme.instructions || scheme.terms) && (
                <details className="rounded-2xl border border-slate-200 bg-white p-5">
                    <summary className="cursor-pointer text-sm font-bold text-slate-900">{t("How it works and terms")}</summary>
                    {scheme.instructions && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{scheme.instructions}</p>}
                    {scheme.terms && <p className="mt-3 whitespace-pre-line text-xs text-slate-500">{scheme.terms}</p>}
                </details>
            )}
            <p className="text-xs text-slate-500">
                {scheme.settings?.count === "registered" ? t("Counts every warranty you register, unless it is rejected") : t("Counts warranties approved by Autoform")}, {scheme.settings?.date_by === "purchase" ? t("by purchase date") : t("by registration date")}.
                {scheme.contact?.phone && <> {t("Questions?")} <a href={`tel:${scheme.contact.phone}`} className="font-semibold text-orange-700">{scheme.contact.name || scheme.contact.phone}</a></>}
            </p>
        </div>
    );
}
