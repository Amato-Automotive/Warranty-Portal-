import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A store's rating where it is seen. The customer's chip, on the QR page, is the
 * average alone: a star and the number, shown once the store has enough ratings.
 * The franchise's, beside its profile icon, opens a panel with a period to look
 * at; before the average is ready it shows the count.
 */

type Split = Record<"1" | "2" | "3" | "4" | "5", number>;

function Bars({ split }: { split: Split }) {
    const total = (["1", "2", "3", "4", "5"] as const).reduce((n, k) => n + split[k], 0);
    return (
        <ul className="space-y-1.5">
            {(["5", "4", "3", "2", "1"] as const).map(k => (
                <li key={k} className="flex items-center gap-2 text-sm">
                    <span className="w-8 shrink-0 font-semibold text-slate-700">{k} ★</span>
                    <span className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-orange-500" style={{ width: `${total ? (split[k] / total) * 100 : 0}%` }} /></span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-slate-600">{split[k]}</span>
                </li>
            ))}
        </ul>
    );
}

const plural = (n: number) => `${n.toLocaleString("en-IN")} ${n === 1 ? "rating" : "ratings"}`;

/** What the chip says: "★ 4.6 (128)", "3 ratings", or "No ratings yet". */
function Face({ average, count }: { average: number | null; count: number }) {
    if (!count) return <span className="text-xs font-medium text-slate-500">No ratings yet</span>;
    if (average === null) return <span className="text-xs font-semibold text-slate-700">{plural(count)}</span>;
    return (
        <span className="flex items-center gap-1 text-sm font-bold text-slate-900">
            <Star className="h-4 w-4 fill-orange-500 text-orange-500" aria-hidden />{average.toFixed(1)}
            <span className="text-xs font-medium text-slate-500">({count.toLocaleString("en-IN")})</span>
        </span>
    );
}

const chipClass = "inline-flex h-9 items-center rounded-full border border-orange-200 bg-white px-3 shadow-sm";

/** On the customer's QR page: the store's average, a star and the number, nothing more. Hidden until the store has enough ratings. */
export function CustomerStoreRating({ storeId }: { storeId: string | number | null | undefined }) {
    const [average, setAverage] = useState<number | null>(null);
    useEffect(() => {
        if (!storeId) { setAverage(null); return; }
        let on = true;
        api.get(`/public/stores/${storeId}/rating`).then(r => { if (on) setAverage(r.data?.show ? r.data.average : null); }).catch(() => { if (on) setAverage(null); });
        return () => { on = false; };
    }, [storeId]);
    if (average === null) return null;
    return (
        <span className={chipClass} aria-label={`Store rating ${average.toFixed(1)} out of 5`}>
            <span className="flex items-center gap-1 text-sm font-bold text-slate-900">
                <Star className="h-4 w-4 fill-orange-500 text-orange-500" aria-hidden />{average.toFixed(1)}
            </span>
        </span>
    );
}

type PeriodKey = "today" | "7" | "15" | "30" | "overall" | "custom";
const PERIODS: [PeriodKey, string][] = [["today", "Today"], ["7", "Last 7 days"], ["15", "Last 15 days"], ["30", "Last 30 days"], ["overall", "Overall"], ["custom", "Custom range"]];
const dayText = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "");

/** Beside the franchise's profile icon: its own store's rating, by period. */
export function FranchiseRating() {
    const [period, setPeriod] = useState<PeriodKey>("overall");
    const [from, setFrom] = useState(""); const [to, setTo] = useState("");
    const [d, setD] = useState<{
        show: boolean;
        overall: { count: number; average: number | null; since: string | null };
        period: { label: string; from: string | null; to: string; count: number; average: number | null };
        split: Split;
    } | null>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (period === "custom" && !(from && to)) return;
        let on = true;
        const q = new URLSearchParams({ period });
        if (period === "custom") { q.set("from", from); q.set("to", to); }
        api.get(`/vendor/rating?${q}`).then(r => { if (on) setD(r.data); }).catch(() => { if (on) setD(null); });
        return () => { on = false; };
    }, [period, from, to]);

    if (!d?.show) return null;
    const o = d.overall;
    return (
        <>
            {o.count > 0
                ? <button type="button" onClick={() => setOpen(true)} className={cn(chipClass, "hover:bg-orange-50")} aria-label="Your store rating"><Face average={o.average} count={o.count} /></button>
                : <span className={chipClass}><Face average={null} count={0} /></span>}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black">Your store rating</DialogTitle>
                        <DialogDescription>What customers rated your store</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="space-y-1 text-xs font-semibold text-slate-600">Period
                            <select value={period} onChange={e => setPeriod(e.target.value as PeriodKey)} className="block h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal text-slate-900">
                                {PERIODS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                            </select>
                        </label>
                        {period === "custom" && <>
                            <label className="space-y-1 text-xs font-semibold text-slate-600">From<Input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className="h-9 w-36" /></label>
                            <label className="space-y-1 text-xs font-semibold text-slate-600">To<Input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className="h-9 w-36" /></label>
                        </>}
                    </div>
                    <div className="flex items-end gap-3">
                        <p className="text-5xl font-black leading-none tabular-nums text-slate-900">{d.period.average !== null ? d.period.average.toFixed(1) : "–"}</p>
                        <p className="pb-1 text-sm text-slate-600">{plural(d.period.count)}{d.period.from ? ` from ${dayText(d.period.from)} to ${dayText(d.period.to)}` : ""}</p>
                    </div>
                    {period !== "overall" && <p className="text-sm text-slate-600">Overall {o.average !== null ? `${o.average.toFixed(1)} · ` : ""}{plural(o.count)}</p>}
                    <Bars split={d.split} />
                </DialogContent>
            </Dialog>
        </>
    );
}
