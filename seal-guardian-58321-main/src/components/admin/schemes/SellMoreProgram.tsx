import { useEffect, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { stampDay, type ProgramOverview } from "@/lib/sellMore";
import { SellMoreTab } from "./SellMoreTab";
import { BuyMoreTab } from "./BuyMoreTab";

/** The Sell More Earn More program on the admin's scheme page: what needs doing, and its two options. */

type Tab = "overview" | "option1" | "option2";

function Overview({ schemeId, refreshKey, go }: { schemeId: string; refreshKey: number; go: (t: Tab) => void }) {
    const { toast } = useToast();
    const [d, setD] = useState<ProgramOverview | null>(null);
    const [showMissing, setShowMissing] = useState(false);
    useEffect(() => {
        api.get(`/schemes/admin/${schemeId}/program`).then(r => setD(r.data))
            .catch(e => toast({ title: "Could not load the program", description: getErrorMessage(e, "Try again"), variant: "destructive" }));
    }, [schemeId, refreshKey, toast]);
    if (!d) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;

    const todo: { n: number; label: string; hint?: string; tab: Tab }[] = [
        { n: d.invoices_waiting, label: "Invoices to review", hint: d.oldest_invoice ? `Oldest from ${stampDay(d.oldest_invoice)}` : undefined, tab: "option2" },
        { n: d.redeem_waiting, label: "Option 2 redeem requests", tab: "option2" },
        { n: d.reward_waiting, label: "Option 1 reward requests", tab: "option1" },
        { n: d.no_target, label: `Option 1 stores with no target`, hint: d.month_label, tab: "option1" },
    ];
    const split: { label: string; n: number; tab?: Tab }[] = [
        { label: "Option 1: Sell More Earn More", n: d.option1, tab: "option1" },
        { label: "Option 2: Buy More Get More", n: d.option2, tab: "option2" },
        { label: "Not chosen yet", n: d.not_chosen.length },
    ];
    const totals: [string, number | string][] = [
        [`Option 1 calculated points, ${d.month_label}`, d.month_points.toLocaleString("en-IN")],
        ["Option 1 rewards sent", d.rewards_sent],
        ["Option 2 sets approved", d.sets_approved.toLocaleString("en-IN")],
        ["Option 2 free sets given", d.free_given],
        [`Option 1 warranties in no series, ${d.month_label}`, d.no_series],
    ];

    return (
        <div className="space-y-4">
            <section>
                <h3 className="mb-2 text-sm font-bold text-slate-900">To do now</h3>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {todo.map(t => (
                        <button key={t.label} type="button" onClick={() => go(t.tab)}
                            className={cn("rounded-xl border p-4 text-left transition-colors hover:border-orange-400", t.n ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white")}>
                            <b className={cn("block text-3xl tabular-nums", t.n ? "text-amber-800" : "text-slate-400")}>{t.n}</b>
                            <span className="block text-sm font-semibold text-slate-800">{t.label}</span>
                            {t.hint && <span className="block text-xs text-slate-500">{t.hint}</span>}
                        </button>
                    ))}
                </div>
            </section>
            <div className="grid gap-4 lg:grid-cols-2">
                <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="text-sm font-bold text-slate-900">Who chose what, of {d.franchises} franchises</h3>
                    {split.map(s => {
                        const body = (
                            <>
                                <span className="flex justify-between text-sm"><span className="font-medium text-slate-800">{s.label}</span><b className="tabular-nums">{s.n}</b></span>
                                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-orange-500" style={{ width: `${d.franchises ? (s.n / d.franchises) * 100 : 0}%` }} /></span>
                            </>
                        );
                        return <button key={s.label} type="button" className="block w-full text-left" onClick={() => (s.tab ? go(s.tab) : setShowMissing(v => !v))} aria-expanded={s.tab ? undefined : showMissing}>{body}</button>;
                    })}
                    {showMissing && (
                        <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100 text-sm">
                            {d.not_chosen.map(s => <li key={s.id} className="px-3 py-2"><span className="font-medium text-slate-800">{s.name}</span> <span className="text-xs text-slate-500">{[s.code, s.city, s.state].filter(Boolean).join(" · ")}</span></li>)}
                        </ul>
                    )}
                </section>
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="mb-2 text-sm font-bold text-slate-900">Program so far</h3>
                    <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
                        {totals.map(([l, v]) => <tr key={l}><td className="py-2 text-slate-700">{l}</td><td className="py-2 text-right font-bold tabular-nums">{v}</td></tr>)}
                    </tbody></table>
                </section>
            </div>
        </div>
    );
}

/** Whether real stores can see the program, and the button to change it. */
function LiveBar({ schemeId, refreshKey }: { schemeId: string; refreshKey: number }) {
    const { toast } = useToast();
    const [d, setD] = useState<ProgramOverview | null>(null);
    const [asking, setAsking] = useState(false);
    const [busy, setBusy] = useState(false);
    const load = () => api.get(`/schemes/admin/${schemeId}/program`).then(r => setD(r.data)).catch(() => undefined);
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [schemeId, refreshKey]);
    if (!d) return null;

    const change = async (live: boolean) => {
        setBusy(true);
        try {
            await api.put(`/schemes/admin/${schemeId}/program/live`, { live });
            await load();
            setAsking(false);
            toast({ title: live ? "The program is live for all franchises" : "The program is paused" });
        } catch (e) {
            toast({ title: "Could not change it", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setBusy(false); }
    };

    return (
        <>
            <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4", d.live ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50")}>
                <div className="min-w-0">
                    <p className={cn("flex items-center gap-2 text-sm font-bold", d.live ? "text-emerald-800" : "text-amber-900")}>
                        <span className={cn("h-2.5 w-2.5 rounded-full", d.live ? "bg-emerald-500" : "bg-amber-500")} />
                        {d.live ? "Live: all franchises can see this program" : "Paused: real stores can't see this program"}
                    </p>
                    {!d.live && <p className="mt-0.5 text-xs text-amber-900">Can still see it: {d.preview_stores.join(", ") || "no store"}</p>}
                </div>
                {d.live
                    ? <Button variant="outline" className="bg-white" disabled={busy} onClick={() => change(false)}><Pause className="mr-1.5 h-4 w-4" /> Pause</Button>
                    : <Button className="bg-emerald-600 font-bold hover:bg-emerald-700" disabled={busy} onClick={() => setAsking(true)}><Play className="mr-1.5 h-4 w-4" /> Make live</Button>}
            </div>
            <Dialog open={asking} onOpenChange={v => !busy && setAsking(v)}>
                <DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black">Make the program live?</DialogTitle>
                        <DialogDescription>All {d.franchises} franchises will see it. Each one's choice of option is permanent, even if you pause the program later.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" disabled={busy} onClick={() => setAsking(false)}>Cancel</Button>
                        <Button className="bg-emerald-600 font-bold hover:bg-emerald-700" disabled={busy} onClick={() => change(true)}>Yes, make it live</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export function SellMoreProgram({ schemeId, refreshKey }: { schemeId: string; refreshKey: number }) {
    const [tab, setTab] = useState<Tab>("overview");
    return (
        <div className="space-y-5">
            <LiveBar schemeId={schemeId} refreshKey={refreshKey} />
            <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
                {([["overview", "Overview"], ["option1", "Option 1: Sell More Earn More"], ["option2", "Option 2: Buy More Get More"]] as const).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
                        className={cn("whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold", tab === k ? "border-orange-500 text-orange-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
                        {label}
                    </button>
                ))}
            </div>
            {tab === "overview" && <Overview schemeId={schemeId} refreshKey={refreshKey} go={setTab} />}
            {tab === "option1" && <SellMoreTab schemeId={schemeId} refreshKey={refreshKey} />}
            {tab === "option2" && <BuyMoreTab schemeId={schemeId} refreshKey={refreshKey} />}
        </div>
    );
}
