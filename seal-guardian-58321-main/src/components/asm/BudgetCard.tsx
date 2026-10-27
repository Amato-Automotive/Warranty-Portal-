import { useState } from "react";
import { cn } from "@/lib/utils";
import { rupees, type BudgetPool, type BudgetSummary } from "@/lib/asmExpenses";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, MapPin, Plane, Wallet } from "lucide-react";

/**
 * An ASM's budget for a quarter: what's left, split into the tour pool and
 * local conveyance by month. The same card on the ASM's Expenses and Home and
 * on HR's Budgets tab, so both read one set of numbers.
 *
 * Only approved amounts are "used"; claims awaiting approval show as a lighter
 * band. Local is a monthly cap, and what a month leaves unspent lapses.
 *
 * Laid out for a phone first: one line per pool with what's left, the months
 * as three small cells, and the explanation folded away.
 */

const pct = (n: number, of: number) => (of > 0 ? Math.min(100, (n / of) * 100) : 0);

/** ₹6.2K, ₹1.5L — for the month cells, where a full amount doesn't fit. */
const short = (n: number) => {
    const trim = (v: number) => String(Math.round(v * 10) / 10).replace(/\.0$/, "");
    if (n >= 100000) return `₹${trim(n / 100000)}L`;
    if (n >= 1000) return `₹${trim(n / 1000)}K`;
    return `₹${Math.round(n)}`;
};

/** Used, then awaiting approval, on one track. */
const Bar = ({ pool, tone, className }: { pool: BudgetPool; tone: string; className?: string }) => {
    const used = pct(pool.used, pool.allocated);
    const pending = Math.min(100 - used, pct(pool.pending, pool.allocated));
    return (
        <div className={cn("h-2 rounded-full bg-slate-100 overflow-hidden flex", className)}>
            <div className={cn("h-full transition-all duration-700", pool.over > 0 ? "bg-rose-500" : tone)} style={{ width: `${used}%` }} />
            <div className={cn("h-full opacity-35 transition-all duration-700", tone)} style={{ width: `${pending}%` }} />
        </div>
    );
};

/** One pool: name on the left, what's left on the right, the bar beneath. */
const PoolRow = ({ icon: Icon, iconTone, name, right, children }: {
    icon: typeof Plane; iconTone: string; name: string; right: React.ReactNode; children: React.ReactNode;
}) => (
    <div className="py-3.5 first:pt-0 last:pb-0">
        <div className="flex items-center gap-2 mb-2">
            <Icon className={cn("h-4 w-4 shrink-0", iconTone)} />
            <span className="text-sm font-bold text-slate-700 truncate">{name}</span>
            <span className="ml-auto shrink-0 text-sm tabular-nums">{right}</span>
        </div>
        {children}
    </div>
);

interface Props {
    budget: BudgetSummary | null;
    loading?: boolean;
    /** A smaller card: the headline and one bar per pool. */
    compact?: boolean;
    onPrevious?: () => void;
    onNext?: () => void;
    onOpen?: () => void;
}

export const BudgetCard = ({ budget, loading, compact, onPrevious, onNext, onOpen }: Props) => {
    const [explain, setExplain] = useState(false);

    if (loading && !budget) {
        return <div className="h-40 rounded-[24px] border border-orange-100 bg-white animate-pulse" />;
    }
    if (!budget) return null;

    const q = budget.quarter;
    const current = budget.months.find(m => m.state === "current");
    const ended = budget.months.every(m => m.state === "past");

    const wrap = (children: React.ReactNode) => onOpen ? (
        <button onClick={onOpen} className="w-full text-left rounded-[24px] border border-orange-100 bg-white p-4 sm:p-5 shadow-sm transition-all hover:shadow-md hover:border-orange-200 active:scale-[0.99]">
            {children}
        </button>
    ) : (
        <div className="rounded-[24px] border border-orange-100 bg-white p-4 sm:p-5 shadow-sm">{children}</div>
    );

    const header = (
        <div className="flex items-center gap-3">
            <span className="h-9 w-9 shrink-0 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Wallet className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-800 truncate">{q.label} budget</p>
                <p className="text-xs text-slate-400 truncate">{q.span}{ended ? " · ended" : ""}</p>
            </div>
            {(onPrevious || onNext) && (
                <div className="flex gap-1 shrink-0">
                    <button onClick={onPrevious} disabled={!onPrevious} aria-label="Previous quarter"
                        className="h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:border-orange-300 hover:text-orange-600 disabled:opacity-30 disabled:pointer-events-none">
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button onClick={onNext} disabled={!onNext} aria-label="Next quarter"
                        className="h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:border-orange-300 hover:text-orange-600 disabled:opacity-30 disabled:pointer-events-none">
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            )}
        </div>
    );

    if (!budget.set) {
        return wrap(<>
            {header}
            <p className="mt-3 text-sm text-slate-500">No budget set for {q.label} yet. Head office sets it each quarter.</p>
        </>);
    }

    const headline = (
        <div className="mt-4 flex items-end justify-between gap-3">
            <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{ended ? "Quarter over" : "Left to spend"}</p>
                <p className="text-3xl font-black text-slate-900 tabular-nums leading-tight">{rupees(budget.remaining)}</p>
            </div>
            <p className="text-xs text-slate-400 tabular-nums pb-1 shrink-0">of {rupees(budget.total)}</p>
        </div>
    );

    const left = (n: number) => <><span className="font-black text-slate-900">{rupees(n)}</span><span className="text-xs text-slate-400"> left</span></>;
    const overLine = (n: number) => n > 0 && (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-bold text-rose-600">
            <AlertTriangle className="h-3.5 w-3.5" /> {rupees(n)} over budget
        </p>
    );

    if (compact) {
        return wrap(<>
            {header}
            {headline}
            <div className="mt-4 divide-y divide-slate-100">
                <PoolRow icon={Plane} iconTone="text-purple-500" name="Tours" right={left(budget.tour.left)}>
                    <Bar pool={budget.tour} tone="bg-purple-500" />
                </PoolRow>
                {current && (
                    <PoolRow icon={MapPin} iconTone="text-orange-500" name={`Local · ${current.label}`} right={left(current.left)}>
                        <Bar pool={current} tone="bg-orange-500" />
                    </PoolRow>
                )}
            </div>
        </>);
    }

    return wrap(<>
        {header}
        {headline}

        <div className="mt-4 divide-y divide-slate-100 md:divide-y-0 md:grid md:grid-cols-2 md:gap-6">
            <PoolRow icon={Plane} iconTone="text-purple-500" name="Outstation tours" right={left(budget.tour.left)}>
                <Bar pool={budget.tour} tone="bg-purple-500" />
                <p className="mt-1.5 text-xs text-slate-400 tabular-nums">{rupees(budget.tour.used)} used of {rupees(budget.tour.allocated)}</p>
                {overLine(budget.tour.over)}
            </PoolRow>

            <PoolRow icon={MapPin} iconTone="text-orange-500" name="Local conveyance"
                right={<span className="text-xs text-slate-400"><span className="font-black text-sm text-slate-900">{rupees(budget.local_monthly)}</span> a month</span>}>
                <div className="grid grid-cols-3 gap-2">
                    {budget.months.map(m => (
                        <div key={m.key} className={cn("rounded-xl px-2.5 py-2",
                            m.state === "current" ? "bg-orange-50 ring-1 ring-orange-200" : "bg-slate-50",
                            m.state === "future" && "opacity-60")}>
                            <p className={cn("text-[11px] font-black", m.state === "current" ? "text-orange-600" : "text-slate-500")}>{m.label}</p>
                            <Bar pool={m} tone="bg-orange-500" className="h-1.5 my-1.5" />
                            <p className="text-xs font-bold tabular-nums truncate">
                                {m.state === "future" ? <span className="text-slate-400">Upcoming</span>
                                    : m.over > 0 ? <span className="text-rose-600">{short(m.over)} over</span>
                                    : m.state === "past" ? <span className="text-slate-400">{m.lapsed > 0 ? `${short(m.lapsed)} lapsed` : "Used"}</span>
                                    : <span className="text-slate-800">{short(m.left)} left</span>}
                            </p>
                        </div>
                    ))}
                </div>
            </PoolRow>
        </div>

        {budget.pending > 0 && (
            <p className="mt-3 text-xs text-slate-500 tabular-nums">
                <span className="font-bold text-slate-700">{rupees(budget.pending)}</span> awaiting approval — counted once approved.
            </p>
        )}

        <button type="button" onClick={() => setExplain(e => !e)}
            className="mt-3 flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-orange-600">
            How this works <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", explain && "rotate-180")} />
        </button>
        {explain && (
            <p className="mt-1.5 text-xs text-slate-500 leading-relaxed animate-in fade-in duration-200">
                {rupees(budget.local_monthly)} a month is fixed for local conveyance ({rupees(budget.local_quarter)} for the quarter);
                the other {rupees(budget.tour.allocated)} is for outstation tours. Local you don't use in a month lapses when the month ends.
                A claim counts once head office approves it, in the month you travelled.
            </p>
        )}
    </>);
};
