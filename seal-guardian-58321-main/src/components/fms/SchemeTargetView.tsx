import { useState } from "react";
import { ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { stepBenefit, type BenefitKind, type Scheme, type TargetStep, type TargetVisibility } from "@/lib/schemes";

/**
 * A scheme run by targets, as the franchise sees it: its target, what it has
 * achieved, the steps and the benefit it earned, period by period. Only what
 * the head office switched on for this scheme comes from the server.
 */

export interface StorePeriod {
    key: string; label: string; target: number | null; achieved: number | null; pct: number | null;
    step_no: number | null; benefit: string | null; to_next: number | null; paid: boolean; updated_at: string | null;
    /* Counted from warranties: registered but not yet approved. */
    pending?: number | null;
}
export interface StoreTargets { unit: string; benefit: BenefitKind; show: TargetVisibility; steps: TargetStep[]; periods: StorePeriod[]; now: StorePeriod | null }

const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-IN"));
const day = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function SchemeTargetView({ scheme, targets, onBack, onRefresh }: {
    scheme: Omit<Scheme, "eligibility">; targets: StoreTargets; onBack: () => void; onRefresh: () => Promise<unknown>;
}) {
    const { t } = useLanguage();
    const [pick, setPick] = useState(targets.now?.key ?? targets.periods[0]?.key);
    const [refreshing, setRefreshing] = useState(false);
    const p = targets.periods.find(x => x.key === pick) ?? null;
    const { show, unit } = targets;
    const earlier = targets.periods.filter(x => x.key !== pick && (x.achieved !== null || x.target !== null || x.benefit));

    return (
        <div className="mx-auto max-w-2xl space-y-4 pb-6">
            <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={onBack} className="flex h-10 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-orange-600"><ArrowLeft className="h-4 w-4" /> {t("All schemes")}</button>
                <Button variant="outline" size="sm" disabled={refreshing} onClick={() => { setRefreshing(true); onRefresh().finally(() => setRefreshing(false)); }}>
                    <RefreshCw className={cn("h-4 w-4 mr-1.5", refreshing && "animate-spin")} /> {t("Refresh")}
                </Button>
            </div>

            <div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900">{scheme.title}</h2>
                {scheme.summary && <p className="mt-1 text-sm text-slate-600">{scheme.summary}</p>}
            </div>
            {scheme.banner_url && <img src={scheme.banner_url} alt="" className="w-full max-h-64 rounded-xl object-cover object-top border border-slate-200" />}

            {targets.periods.length > 1 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 [&>*]:shrink-0">
                    {targets.periods.map(x => (
                        <button key={x.key} type="button" onClick={() => setPick(x.key)}
                            className={cn("h-10 rounded-full px-4 text-sm font-semibold whitespace-nowrap", pick === x.key ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-800")}>
                            {x.label}
                        </button>
                    ))}
                </div>
            )}

            {p && (show.target || show.achieved || show.percent) && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                        {show.target && <div><p className="text-xs font-semibold text-slate-500">{t("Target")}</p><p className="text-2xl font-extrabold tabular-nums">{num(p.target)}</p><p className="text-xs text-slate-500">{unit}</p></div>}
                        {show.achieved && <div><p className="text-xs font-semibold text-slate-500">{t("Achieved")}</p><p className="text-2xl font-extrabold tabular-nums">{num(p.achieved)}</p><p className="text-xs text-slate-500">{unit}</p></div>}
                        {show.percent && <div><p className="text-xs font-semibold text-slate-500">{t("Done")}</p><p className="text-2xl font-extrabold tabular-nums text-orange-700">{p.pct === null ? "—" : `${p.pct}%`}</p><p className="text-xs text-slate-500">{t("of target")}</p></div>}
                    </div>
                    {show.percent && p.pct !== null && (
                        <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={`${p.pct}% of target`}>
                            <div className="h-full rounded-full bg-orange-600" style={{ width: `${Math.min(p.pct, 100)}%` }} />
                        </div>
                    )}
                    {p.pending ? <p className="text-sm text-amber-800">{p.pending.toLocaleString("en-IN")} {t("more registered, waiting for approval")}</p> : null}
                    {p.to_next !== null && p.to_next > 0 && <p className="text-sm font-semibold text-slate-700">{p.to_next.toLocaleString("en-IN")} {unit} more for the next step</p>}
                    {p.updated_at && <p className="text-xs text-slate-500">{t("Updated by Autoform on")} {day(p.updated_at)}</p>}
                    {p.target === null && p.achieved === null && <p className="text-sm text-slate-500">{t("Your figures for this period aren't in yet.")}</p>}
                </section>
            )}

            {show.steps && targets.steps.length > 1 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-2">
                    <h3 className="text-sm font-bold text-slate-900">{t("Your steps")}</h3>
                    {targets.steps.map((st, i) => {
                        const reached = p?.step_no === i + 1;
                        return (
                            <div key={i} className={cn("flex min-h-[52px] items-center justify-between gap-3 rounded-xl px-3 text-sm", reached ? "border-2 border-orange-600 bg-orange-50" : "bg-slate-50")}>
                                <span className="flex flex-col">
                                    <span>{[
                                        show.percent ? `${st.pct}%` : null,
                                        show.target && p?.target ? `${Math.ceil((st.pct / 100) * p.target - 1e-9).toLocaleString("en-IN")} ${unit}` : null,
                                    ].filter(Boolean).join(" · ") || `Step ${i + 1}`}</span>
                                    {reached && <span className="flex items-center gap-1 text-xs font-bold text-orange-800"><CheckCircle2 className="h-3.5 w-3.5" />{t("Reached")}</span>}
                                </span>
                                <span className={cn(reached && "font-bold")}>{stepBenefit(st, targets.benefit, unit)}</span>
                            </div>
                        );
                    })}
                </section>
            )}

            {p && (
                <section className={cn("rounded-2xl p-4 sm:p-5", p.benefit ? "bg-slate-900 text-white" : "border border-slate-200 bg-white")}>
                    <p className={cn("text-sm font-semibold", p.benefit ? "text-slate-300" : "text-slate-500")}>{t("Your benefit")} · {p.label}</p>
                    <p className="mt-1 text-2xl font-extrabold">{p.benefit ?? (targets.steps.length === 1 ? targets.steps[0].reward ?? t("No step reached yet") : t("No step reached yet"))}</p>
                    {!p.benefit && targets.steps.length === 1 && p.target !== null && show.target && (
                        <p className="mt-1 text-sm text-slate-600">{t("Reach")} {p.target.toLocaleString("en-IN")} {unit} {t("to earn it")}</p>
                    )}
                    {p.benefit && <p className="mt-1 text-sm text-slate-300">{p.paid ? t("Paid") : t("To be paid")}</p>}
                </section>
            )}

            {earlier.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <h3 className="mb-1 text-sm font-bold text-slate-900">{t("Other periods")}</h3>
                    {earlier.map(x => (
                        <button key={x.key} type="button" onClick={() => setPick(x.key)} className="flex min-h-[52px] w-full items-center justify-between gap-2 border-b border-slate-100 text-left text-sm last:border-0">
                            <span className="flex flex-col">
                                <b>{x.label}</b>
                                <span className="text-xs text-slate-500">{[show.achieved && x.achieved !== null ? `${num(x.achieved)}${show.target && x.target !== null ? ` of ${num(x.target)}` : ""} ${unit}` : null, x.step_no ? `Step ${x.step_no}` : null].filter(Boolean).join(" · ") || "—"}</span>
                            </span>
                            {x.benefit ? <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", x.paid ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800")}>{x.paid ? t("Paid") : t("To be paid")}</span>
                                : <span className="text-xs text-slate-500">{t("No step reached")}</span>}
                        </button>
                    ))}
                </section>
            )}

            {(scheme.instructions || scheme.terms) && (
                <details className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <summary className="cursor-pointer text-sm font-bold text-slate-900">{t("How it works and terms")}</summary>
                    {scheme.instructions && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{scheme.instructions}</p>}
                    {scheme.terms && <p className="mt-3 whitespace-pre-line text-xs text-slate-500">{scheme.terms}</p>}
                </details>
            )}
            {scheme.contact && (
                <p className="text-sm text-slate-600">{t("Questions?")} {scheme.contact.name}{scheme.contact.phone && <> · <a href={`tel:${scheme.contact.phone}`} className="font-semibold text-orange-700">{scheme.contact.phone}</a></>}</p>
            )}
        </div>
    );
}
