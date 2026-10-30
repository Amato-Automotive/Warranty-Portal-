import { useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_SETTINGS, type Measure, type PointsRule, type Scheme, type SchemeSettings, type WarrantyCount, type WarrantyDate } from "@/lib/schemes";
import { Stepper } from "./TargetsTab";
import { PointsRuleEditor, startingPoints, useWarrantyProducts } from "./PointsRuleEditor";

/**
 * Step 1 of a target scheme ("More You Sell, Less It Costs"): its name, the
 * months it runs (each month gets its own target; odd dates are possible), and
 * which warranties count, in plain words. Franchises, growth and rewards come
 * next, on the scheme's page.
 */

/* How every target scheme runs: a target per window, from warranties, one reward per store, the store never sees the %. */
const TARGET_SETTINGS: Partial<SchemeSettings> = {
    run: "targets", source: "warranties", unit: "warranties", period: "window", benefit: "fixed", steps: [],
    show: { target: true, achieved: true, percent: false, steps: true, to_next: false },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
/** Twelve months from this one, as "YYYY-MM". */
function monthsAhead(from: string, n = 12) {
    let [y, m] = from.split("-").map(Number);
    return Array.from({ length: n }, () => { const k = `${y}-${String(m).padStart(2, "0")}`; m++; if (m > 12) { m = 1; y++; } return k; });
}
type Win = { from: string; to: string };
/** A window that is exactly one calendar month, as that month; else null. */
const asMonth = (w: Win) => (w.from.endsWith("-01") && w.to === lastDay(w.from.slice(0, 7)) ? w.from.slice(0, 7) : null);

function Option({ on, title, note, onPick }: { on: boolean; title: string; note: string; onPick: () => void }) {
    return (
        <button type="button" onClick={onPick} aria-pressed={on}
            className={cn("flex w-full gap-3 rounded-xl p-3.5 text-left", on ? "border-2 border-orange-600 bg-orange-50" : "border border-slate-300 bg-white hover:border-slate-400")}>
            <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-orange-600 bg-orange-600 text-white" : "border-slate-300")}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>
            <span><span className="block text-sm font-bold text-slate-900">{title}</span><span className="block text-xs text-slate-600">{note}</span></span>
        </button>
    );
}

export function TargetSchemeEditor({ open, scheme, onClose, onSaved }: {
    open: boolean; scheme: Scheme | null; onClose: () => void; onSaved: (s: Scheme) => void;
}) {
    const { toast } = useToast();
    const [title, setTitle] = useState("");
    const [summary, setSummary] = useState("");
    const [picked, setPicked] = useState<string[]>([]);
    const [own, setOwn] = useState(false);
    const [windows, setWindows] = useState<Win[]>([{ from: "", to: "" }]);
    const [count, setCount] = useState<WarrantyCount>("approved");
    const [dateBy, setDateBy] = useState<WarrantyDate>("registered");
    const [terms, setTerms] = useState("");
    const [saving, setSaving] = useState(false);
    /* Counted in warranties (1 each), or in points by series. */
    const [measure, setMeasure] = useState<Measure>("warranties");
    const [rule, setRule] = useState<PointsRule>({ series: [], tiers: [] });
    const products = useWarrantyProducts();
    const pickMeasure = (m: Measure) => {
        setMeasure(m);
        if (m === "points" && !rule.series.length && products) setRule(startingPoints(products.map(p => p.name)));
    };

    useEffect(() => {
        if (!open) return;
        const s = scheme;
        const ws: Win[] = (s?.windows ?? []).map(w => ({ from: w.start.slice(0, 10), to: w.end.slice(0, 10) }));
        const asMonths = ws.map(asMonth);
        const allMonths = ws.length > 0 && asMonths.every(Boolean);
        setTitle(s?.title ?? "More You Sell, Less It Costs");
        setSummary(s?.summary ?? "");
        setPicked(allMonths ? (asMonths as string[]) : []);
        setOwn(ws.length > 0 && !allMonths);
        setWindows(ws.length && !allMonths ? ws : [{ from: "", to: "" }]);
        setCount(s?.settings?.count ?? "approved");
        setDateBy(s?.settings?.date_by ?? "registered");
        setTerms(s?.terms ?? "");
        setMeasure(s?.settings?.measure ?? "warranties");
        setRule(s?.settings?.points ?? { series: [], tiers: [] });
    }, [open, scheme]);

    const months = useMemo(() => {
        const start = scheme?.windows[0]?.start.slice(0, 7);
        const now = istToday().slice(0, 7);
        return monthsAhead(start && start < now ? start : now);
    }, [scheme, open]);
    const toggle = (m: string) => setPicked(p => (p.includes(m) ? p.filter(x => x !== m) : [...p, m].sort()));

    const save = async () => {
        if (!title.trim()) return toast({ title: "Give the scheme a name", variant: "destructive" });
        const ws: Win[] = own ? windows : picked.map(m => ({ from: `${m}-01`, to: lastDay(m) }));
        if (!ws.length) return toast({ title: "Pick the months it runs", variant: "destructive" });
        if (ws.some(w => !w.from || !w.to || w.to < w.from)) return toast({ title: "Every period needs a from and a to date", variant: "destructive" });
        setSaving(true);
        try {
            const body = {
                ...(scheme ?? {}),
                title, summary, terms, category: scheme?.category ?? "sales",
                windows: ws.map(w => ({ start: `${w.from}T00:00`, end: `${w.to}T23:59` })),
                settings: {
                    ...DEFAULT_SETTINGS, ...(scheme?.settings ?? {}), ...TARGET_SETTINGS, count, date_by: dateBy,
                    measure, points: rule, unit: measure === "points" ? "points" : "warranties",
                },
            };
            const r = scheme ? await api.put(`/schemes/admin/${scheme.id}`, body) : await api.post("/schemes/admin", body);
            toast({ title: scheme ? "Saved" : "Scheme created", description: scheme ? undefined : "Now choose the franchises." });
            onSaved(r.data.scheme);
        } catch (e: any) {
            toast({ title: "Not saved", description: e?.response?.data?.problems?.[0] ?? getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setSaving(false); }
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!o && !saving) onClose(); }}>
            <DialogContent className={cn("max-h-[94vh] overflow-y-auto", measure === "points" ? "max-w-5xl" : "max-w-3xl")}>
                <DialogHeader className="space-y-3">
                    <Stepper at={1} />
                    <DialogTitle className="text-2xl">{scheme ? "Scheme details" : "New target scheme"}</DialogTitle>
                    <DialogDescription>Each franchise gets a target based on its past warranties, and a reward when it reaches it.</DialogDescription>
                </DialogHeader>

                <div className="grid gap-5 md:grid-cols-2">
                    <section className="space-y-5">
                        <label className="block space-y-1.5"><span className="text-sm font-bold text-slate-900">Scheme name</span>
                            <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} className="h-12 text-base" /></label>

                        <div className="space-y-2">
                            <p className="text-sm font-bold text-slate-900">Which months does it run?</p>
                            {!own ? (
                                <>
                                    <p className="text-xs text-slate-500">Tap the months. Each month gets its own target.</p>
                                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                                        {months.map(m => {
                                            const on = picked.includes(m);
                                            return (
                                                <button key={m} type="button" onClick={() => toggle(m)} aria-pressed={on}
                                                    className={cn("h-12 rounded-xl text-sm font-semibold", on ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-800 hover:border-slate-500")}>
                                                    {on && "✓ "}{monthLabel(m)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <button type="button" className="text-sm font-semibold text-orange-700 hover:underline" onClick={() => setOwn(true)}>Not whole months? Set your own dates</button>
                                </>
                            ) : (
                                <>
                                    <p className="text-xs text-slate-500">Each period gets its own target. Whole days, no time limit.</p>
                                    {windows.map((w, i) => (
                                        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                                            <label className="space-y-1"><span className="block text-xs text-slate-500">From</span>
                                                <Input type="date" value={w.from} onChange={e => setWindows(ws => ws.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} className="h-11" /></label>
                                            <label className="space-y-1"><span className="block text-xs text-slate-500">To</span>
                                                <Input type="date" value={w.to} min={w.from || undefined} onChange={e => setWindows(ws => ws.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} className="h-11" /></label>
                                            <Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-rose-500" disabled={windows.length === 1}
                                                onClick={() => setWindows(ws => ws.filter((_, j) => j !== i))} aria-label={`Remove period ${i + 1}`}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    ))}
                                    <div className="flex flex-wrap gap-3">
                                        <Button type="button" variant="outline" size="sm" onClick={() => setWindows(ws => [...ws, { from: "", to: "" }])}><Plus className="h-4 w-4 mr-1" />Add a period</Button>
                                        <button type="button" className="text-sm font-semibold text-orange-700 hover:underline" onClick={() => setOwn(false)}>Use whole months instead</button>
                                    </div>
                                </>
                            )}
                        </div>
                    </section>

                    <section className="space-y-5">
                        <div className="space-y-2">
                            <p className="text-sm font-bold text-slate-900">Count in</p>
                            <Option on={measure === "warranties"} onPick={() => pickMeasure("warranties")} title="Warranties" note="Every warranty counts as 1." />
                            <Option on={measure === "points"} onPick={() => pickMeasure("points")} title="Points" note="Each warranty earns its series' points, times the store type." />
                        </div>
                        <div className="space-y-2">
                            <p className="text-sm font-bold text-slate-900">Which warranties count?</p>
                            <Option on={count === "approved"} onPick={() => setCount("approved")} title="Approved only" note="Safer. A warranty counts once Autoform approves it." />
                            <Option on={count === "registered"} onPick={() => setCount("registered")} title="Every registered one" note="Counts straight away, unless it is rejected." />
                        </div>
                        <div className="space-y-2">
                            <p className="text-sm font-bold text-slate-900">Count it in the month of…</p>
                            <Option on={dateBy === "registered"} onPick={() => setDateBy("registered")} title="Its registration" note="The day the store or customer registered it on the portal." />
                            <Option on={dateBy === "purchase"} onPick={() => setDateBy("purchase")} title="Its purchase" note="The purchase date written on the warranty." />
                        </div>
                        <details className="rounded-xl border border-slate-200 px-3 py-2">
                            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Description and terms (optional)</summary>
                            <div className="mt-3 space-y-3">
                                <Input value={summary} onChange={e => setSummary(e.target.value)} placeholder="One line the franchise sees" maxLength={500} />
                                <Textarea value={terms} onChange={e => setTerms(e.target.value)} rows={4} placeholder="Terms the franchise can read" />
                            </div>
                        </details>
                    </section>
                </div>

                {measure === "points" && (
                    <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                        {products === null ? <p className="text-sm text-slate-500"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Loading products…</p>
                            : <PointsRuleEditor rule={rule} onChange={setRule} products={products} />}
                    </section>
                )}

                <DialogFooter className="gap-2">
                    <Button variant="outline" className="h-12" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button className="h-12 bg-orange-600 hover:bg-orange-700 px-6 text-base font-bold" onClick={save} disabled={saving}>
                        {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{scheme ? "Save" : "Next: choose franchises →"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
