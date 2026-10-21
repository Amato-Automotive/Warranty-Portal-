import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TONES, TONE_BADGE, TONE_HEX, STORE_GROUP_LABEL, setLeadOptions, type LeadOptions, type StoreGroup, type Tone } from "@/lib/leadOptions";

const move = <T,>(list: T[], i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const out = [...list];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
};

/* A colour chooser: the swatches, the picked one ringed. */
function TonePicker({ value, onChange, label }: { value: Tone; onChange: (t: Tone) => void; label: string }) {
    return (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Colour of ${label}`}>
            {TONES.map(t => (
                <button key={t} type="button" role="radio" aria-checked={value === t} aria-label={t} title={t} onClick={() => onChange(t)}
                    className={cn("h-5 w-5 rounded-full border-2", value === t ? "border-slate-800" : "border-transparent")}
                    style={{ background: TONE_HEX[t] }} />
            ))}
        </div>
    );
}

/**
 * The admin's Lead settings: the review outcomes and the channels — add,
 * rename, recolour, reorder, hide, and delete what no lead uses. The server
 * refuses deleting a value in use and says so; hiding is offered instead.
 */
export function LeadSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const { toast } = useToast();
    const [tab, setTab] = useState<"outcomes" | "channels">("outcomes");
    const [opts, setOpts] = useState<LeadOptions | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setOpts(null);
        api.get("/asm/leads/options").then(r => setOpts(r.data.options))
            .catch(e => toast({ variant: "destructive", title: "Could not load the lead settings", description: getErrorMessage(e, "") }));
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const save = async () => {
        if (!opts) return;
        setSaving(true);
        try {
            const r = await api.put("/asm/leads/options", { options: opts });
            setLeadOptions(r.data.options);
            toast({ title: "Lead settings saved", description: "The list, filters, Add Lead and charts use them now." });
            onOpenChange(false);
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again.") });
        } finally {
            setSaving(false);
        }
    };

    const setOutcome = (i: number, p: Partial<LeadOptions["outcomes"][number]>) =>
        opts && setOpts({ ...opts, outcomes: opts.outcomes.map((o, j) => j === i ? { ...o, ...p } : o) });
    const setChannel = (i: number, p: Partial<LeadOptions["channels"][number]>) =>
        opts && setOpts({ ...opts, channels: opts.channels.map((c, j) => j === i ? { ...c, ...p } : c) });
    /* A new entry has no value yet: the server makes one from its label. */
    const isNew = (v: string) => v.startsWith("new_");

    return (
        <Dialog open={open} onOpenChange={v => { if (!saving) onOpenChange(v); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0 flex flex-col">
                <DialogHeader className="px-6 pt-6 pb-3 border-b border-slate-100 shrink-0">
                    <DialogTitle className="text-base">Lead settings</DialogTitle>
                    <DialogDescription className="text-xs">
                        The review outcomes and the channels Lead Management works from. Hide one to stop it being picked; old leads keep it.
                    </DialogDescription>
                    <div className="inline-flex rounded-xl border border-slate-200 p-1 bg-white mt-2 w-fit">
                        {([["outcomes", "Review outcomes"], ["channels", "Channels"]] as const).map(([k, l]) => (
                            <button key={k} type="button" onClick={() => setTab(k)}
                                className={cn("px-3 py-1.5 rounded-lg text-xs font-bold", tab === k ? "bg-slate-900 text-white" : "text-slate-500")}>{l}</button>
                        ))}
                    </div>
                </DialogHeader>

                {!opts ? (
                    <div className="p-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
                ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-2">
                        {tab === "outcomes" ? (
                            <>
                                <p className="text-[11px] text-slate-500">What calling the customer back found. The ASM's outcome uses the same list. Stores see each lead in one of their groups (Won, Follow up, Lost, No answer): choose which one each outcome counts as.</p>
                                {opts.outcomes.map((o, i) => (
                                    <div key={o.value} className={cn("rounded-xl border p-3 space-y-2", o.active ? "border-slate-100 bg-white" : "border-dashed border-slate-200 bg-slate-50/60")}>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="flex">
                                                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => setOpts({ ...opts, outcomes: move(opts.outcomes, i, -1) })} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                                                <button type="button" aria-label="Move down" disabled={i === opts.outcomes.length - 1} onClick={() => setOpts({ ...opts, outcomes: move(opts.outcomes, i, 1) })} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                                            </div>
                                            <Input value={o.label} onChange={e => setOutcome(i, { label: e.target.value })} className="h-8 text-sm flex-1 min-w-[160px]" aria-label="Outcome name" />
                                            <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-black uppercase", TONE_BADGE[o.tone])}>{o.label || "—"}</span>
                                            <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                                <Switch checked={o.active} onCheckedChange={v => setOutcome(i, { active: v })} aria-label="Shown" /> {o.active ? "Shown" : "Hidden"}
                                            </label>
                                            <button type="button" aria-label={`Delete ${o.label}`} onClick={() => setOpts({ ...opts, outcomes: opts.outcomes.filter((_, j) => j !== i) })}
                                                className="p-1 text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <TonePicker value={o.tone} onChange={t => setOutcome(i, { tone: t })} label={o.label} />
                                            <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                                Counts for stores as
                                                <select value={o.store_group} onChange={e => setOutcome(i, { store_group: e.target.value as StoreGroup })}
                                                    className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs" aria-label={`Store group of ${o.label}`}>
                                                    {(Object.keys(STORE_GROUP_LABEL) as StoreGroup[]).map(g => <option key={g} value={g}>{STORE_GROUP_LABEL[g]}</option>)}
                                                </select>
                                            </label>
                                        </div>
                                    </div>
                                ))}
                                <Button type="button" variant="outline" size="sm"
                                    onClick={() => setOpts({ ...opts, outcomes: [...opts.outcomes, { value: `new_${Date.now()}`, label: "", tone: "slate", active: true, store_group: "noanswer" }] })}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Add an outcome
                                </Button>
                            </>
                        ) : (
                            <>
                                <p className="text-[11px] text-slate-500">Where a lead came from. WhatsApp, Instagram and IVR come in by themselves and can only be renamed or recoloured. A channel you add is picked in Add Lead and forwarded by hand.</p>
                                {opts.channels.map((c, i) => (
                                    <div key={c.value} className={cn("rounded-xl border p-3 space-y-2", c.active ? "border-slate-100 bg-white" : "border-dashed border-slate-200 bg-slate-50/60")}>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="flex">
                                                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => setOpts({ ...opts, channels: move(opts.channels, i, -1) })} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                                                <button type="button" aria-label="Move down" disabled={i === opts.channels.length - 1} onClick={() => setOpts({ ...opts, channels: move(opts.channels, i, 1) })} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                                            </div>
                                            <Input value={c.label} onChange={e => setChannel(i, { label: e.target.value })} className="h-8 text-sm flex-1 min-w-[160px]" aria-label="Channel name" />
                                            {c.system ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400"><Lock className="h-3 w-3" /> Comes in by itself</span>
                                            ) : (
                                                <>
                                                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                                        <Switch checked={c.active} onCheckedChange={v => setChannel(i, { active: v })} aria-label="Shown" /> {c.active ? "Shown" : "Hidden"}
                                                    </label>
                                                    <button type="button" aria-label={`Delete ${c.label}`} onClick={() => setOpts({ ...opts, channels: opts.channels.filter((_, j) => j !== i) })}
                                                        className="p-1 text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                                                </>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <TonePicker value={c.tone} onChange={t => setChannel(i, { tone: t })} label={c.label} />
                                            {(!c.system || c.value === "ivr") && (
                                                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                                    <Switch checked={c.add_lead} onCheckedChange={v => setChannel(i, { add_lead: v })} aria-label="Offered in Add Lead" /> In Add Lead
                                                </label>
                                            )}
                                        </div>
                                        {isNew(c.value) && <p className="text-[10px] text-slate-400">New: its key is made from the name when you save, and stays the same after.</p>}
                                    </div>
                                ))}
                                <Button type="button" variant="outline" size="sm"
                                    onClick={() => setOpts({ ...opts, channels: [...opts.channels, { value: `new_${Date.now()}`, label: "", tone: "slate", active: true, add_lead: true }] })}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Add a channel
                                </Button>
                            </>
                        )}
                    </div>
                )}

                <DialogFooter className="px-6 py-4 border-t border-slate-100 shrink-0">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
                    <Button onClick={save} disabled={!opts || saving || [...(opts?.outcomes ?? []), ...(opts?.channels ?? [])].some(x => !x.label.trim())} className="bg-orange-600 hover:bg-orange-700">
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />} Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
