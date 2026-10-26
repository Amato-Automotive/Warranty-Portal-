import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    BENEFIT_LABEL, PERIOD_LABEL,
    type BenefitKind, type SchemeSettings, type SchemeWindow, type TargetPeriod, type TargetStep, type TargetVisibility,
} from "@/lib/schemes";

/**
 * The scheme form's part for a scheme run by targets: when it runs, what the
 * target counts and per what period, the reward steps every franchise starts
 * with (each can get its own on the Targets tab), and what the store sees.
 */

export function EditorSection({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
    return (
        <section className="rounded-xl border border-slate-200 p-4 space-y-3 min-w-0">
            <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-800">{title}</p>
                {note && <p className="text-xs text-slate-500 mt-0.5">{note}</p>}
            </div>
            {children}
        </section>
    );
}

/** The steps a scheme or one franchise uses: share of target → benefit. */
export function StepsEditor({ steps, benefit, unit, onChange }: { steps: TargetStep[]; benefit: BenefitKind; unit: string; onChange: (s: TargetStep[]) => void }) {
    const setStep = (i: number, patch: Partial<TargetStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    const num = (v: string) => (v === "" ? undefined : Number(v));
    return (
        <div className="space-y-2">
            {steps.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-14 text-xs font-bold text-slate-700">Step {i + 1}</span>
                    <div className="relative">
                        <Input type="number" inputMode="decimal" min={1} value={Number.isFinite(s.pct) ? s.pct : ""} aria-label={`Step ${i + 1}: share of target`}
                            onChange={e => setStep(i, { pct: Number(e.target.value) })} className="h-10 w-24 pr-7" />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">%</span>
                    </div>
                    <span className="text-slate-500">→</span>
                    {benefit === "fixed" ? (
                        <Input value={s.reward ?? ""} onChange={e => setStep(i, { reward: e.target.value })} placeholder="e.g. 2 sets free" maxLength={160}
                            aria-label={`Step ${i + 1}: reward`} className="h-10 flex-1 min-w-[160px]" />
                    ) : (
                        <div className="flex items-center gap-1.5">
                            {benefit === "per_unit" && <span className="text-slate-500">₹</span>}
                            <Input type="number" inputMode="decimal" min={0} value={s.amount ?? ""} onChange={e => setStep(i, { amount: num(e.target.value) })}
                                aria-label={`Step ${i + 1}: ${benefit === "percent" ? "% off" : "₹ off per unit"}`} className="h-10 w-24" />
                            <span className="text-xs text-slate-500">{benefit === "percent" ? "% off" : `off / ${unit.replace(/s$/, "")}`}</span>
                        </div>
                    )}
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-rose-500" onClick={() => onChange(steps.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ))}
            <Button type="button" variant="outline" size="sm"
                onClick={() => onChange([...steps, { pct: steps.length ? Math.max(...steps.map(s => s.pct || 0)) + 20 : 100 }])}>
                <Plus className="h-4 w-4 mr-1" /> Add a step
            </Button>
        </div>
    );
}

const SHOW: { key: keyof TargetVisibility; label: string; note?: string }[] = [
    { key: "target", label: "Its target" },
    { key: "achieved", label: "What it achieved" },
    { key: "percent", label: "% of target" },
    { key: "steps", label: "The steps and their benefit" },
    { key: "to_next", label: "How many more reach the next step", note: "Off by default" },
];

export function TargetSettingsEditor({ settings, windows, onSettings, onWindows }: {
    settings: SchemeSettings; windows: SchemeWindow[];
    onSettings: (s: SchemeSettings) => void; onWindows: (w: SchemeWindow[]) => void;
}) {
    const set = <K extends keyof SchemeSettings>(k: K, v: SchemeSettings[K]) => onSettings({ ...settings, [k]: v });
    /* A target scheme runs whole days, from its first to its last: one window. */
    const from = windows[0]?.start?.slice(0, 10) ?? "";
    const to = windows[windows.length - 1]?.end?.slice(0, 10) ?? "";
    const setDates = (f: string, t: string) => onWindows([{ start: f ? `${f}T00:00` : "", end: t ? `${t}T23:59` : "" }]);
    const unit = settings.unit || "sets";

    return (
        <>
            <EditorSection title="When it runs" note="Targets are kept for each period between these days.">
                <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                    <label className="space-y-1"><span className="block text-xs font-semibold text-slate-700">Starts</span>
                        <Input type="date" value={from} onChange={e => setDates(e.target.value, to)} /></label>
                    <label className="space-y-1"><span className="block text-xs font-semibold text-slate-700">Ends</span>
                        <Input type="date" value={to} min={from || undefined} onChange={e => setDates(from, e.target.value)} /></label>
                </div>
            </EditorSection>

            <EditorSection title="What is counted" note="How each franchise's achievement is found.">
                <div className="grid gap-2 sm:grid-cols-2">
                    {([
                        ["warranties", "Its approved warranties", "Counted for you each period. You set each store's growth % over its average and its reward."],
                        ["manual", "Figures you type", "You type each store's target and what it achieved, or import them."],
                    ] as const).map(([src, label, note]) => (
                        <label key={src} className={cn("flex gap-3 rounded-xl p-3 cursor-pointer", settings.source === src ? "border-2 border-orange-500 bg-orange-50/60" : "border border-slate-200")}>
                            <input type="radio" name="source" checked={settings.source === src} className="mt-1 h-4 w-4 accent-orange-600"
                                onChange={() => onSettings(src === "warranties"
                                    ? { ...settings, source: src, unit: "warranties", show: { ...settings.show, percent: false } }
                                    : { ...settings, source: src, unit: settings.unit === "warranties" ? "sets" : settings.unit })} />
                            <span className="space-y-0.5">
                                <span className="block text-sm font-bold text-slate-900">{label}</span>
                                <span className="block text-xs text-slate-600">{note}</span>
                            </span>
                        </label>
                    ))}
                </div>
                {settings.source === "warranties" && (
                    <div className="space-y-1">
                        <Label className="text-xs font-semibold text-slate-700">Average taken over the months before it starts</Label>
                        <div className="flex flex-wrap gap-2">
                            {[1, 3, 6, 12].map(n => (
                                <button key={n} type="button" onClick={() => set("baseline_months", n)}
                                    className={cn("h-10 rounded-full px-4 text-sm font-semibold", settings.baseline_months === n ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-800")}>
                                    {n === 1 ? "Last month" : `Last ${n} months`}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-slate-500">Approved warranties only. Target = average × (1 + growth %), for each month of the period.</p>
                    </div>
                )}
            </EditorSection>

            <EditorSection title="Target" note="Whether the target is for the whole scheme or each month or quarter.">
                <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
                    <label className="space-y-1"><span className="block text-xs font-semibold text-slate-700">Counted in</span>
                        <Input value={settings.unit} disabled={settings.source === "warranties"} onChange={e => set("unit", e.target.value)} placeholder="sets" maxLength={20} /></label>
                    <div className="space-y-1">
                        <Label className="text-xs font-semibold text-slate-700">Target for</Label>
                        <div className="flex flex-wrap gap-2">
                            {(Object.keys(PERIOD_LABEL) as TargetPeriod[]).map(p => (
                                <button key={p} type="button" onClick={() => set("period", p)}
                                    className={cn("h-10 rounded-full px-4 text-sm font-semibold", settings.period === p ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-800")}>
                                    {PERIOD_LABEL[p]}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </EditorSection>

            {settings.source === "warranties" ? (
                <EditorSection title="Rewards" note="Each franchise gets its own growth % and reward on the Targets tab, after you see its warranties. It sees only the number to reach and the reward — never the %.">
                    <p className="text-xs text-slate-500">Nothing to set here.</p>
                </EditorSection>
            ) : (
            <EditorSection title="Reward steps: the more they sell, the less it costs"
                note="Every franchise starts with these; give one its own on the Targets tab. Only the highest step reached counts.">
                <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Benefit is given as</Label>
                    <div className="flex flex-wrap gap-2">
                        {(Object.keys(BENEFIT_LABEL) as BenefitKind[]).map(b => (
                            <button key={b} type="button" onClick={() => set("benefit", b)}
                                className={cn("min-h-[40px] rounded-xl px-3 text-sm font-semibold text-left", settings.benefit === b ? "border-2 border-orange-500 bg-orange-50" : "border border-slate-300 bg-white")}>
                                {BENEFIT_LABEL[b]}
                            </button>
                        ))}
                    </div>
                </div>
                <StepsEditor steps={settings.steps} benefit={settings.benefit} unit={unit} onChange={s => set("steps", s)} />
                {settings.benefit === "per_unit" && (
                    <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-900">
                        Example: target 100 {unit}, achieved 105 → the 100% step → 105 × its ₹ off.
                    </p>
                )}
            </EditorSection>
            )}

            <EditorSection title="What the franchise sees" note="Its own figures only; never other franchises'.">
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {SHOW.filter(s => settings.source !== "warranties" || s.key !== "steps").map(s => (
                        <label key={s.key} className="flex min-h-[46px] items-center justify-between gap-3 px-3 text-sm text-slate-800">
                            <span>{s.label}{s.note && <span className="ml-1.5 text-xs text-slate-500">· {s.note}</span>}</span>
                            <Switch checked={settings.show[s.key]} onCheckedChange={v => set("show", { ...settings.show, [s.key]: v })} aria-label={s.label} />
                        </label>
                    ))}
                </div>
            </EditorSection>
        </>
    );
}
