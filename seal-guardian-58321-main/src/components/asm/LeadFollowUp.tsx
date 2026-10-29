import { useEffect, useState } from "react";
import { Loader2, MessageCircle, Phone, Footprints } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
    FOLLOW_UP_CHANNELS, FOLLOW_UP_OUTCOMES, ago, channelLabel, outcomeOf,
    type AsmLead, type FollowUp, type FollowUpChannel,
} from "@/lib/asmLeads";

const CHANNEL_ICON: Record<string, typeof Phone> = { call: Phone, whatsapp: MessageCircle, visit: Footprints };

const when = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** A lead's follow-up state in a few words: "Not contacted" or "WhatsApp · No answer · 2h ago". */
export function FollowUpBadge({ lead, className }: { lead: Pick<AsmLead, "followup">; className?: string }) {
    const f = lead.followup;
    if (!f) {
        return <span className={cn("inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 whitespace-nowrap", className)}>Not contacted</span>;
    }
    const o = outcomeOf(f.last.outcome);
    return (
        <span title={`${f.count} contact${f.count === 1 ? "" : "s"}, last ${when(f.last.created_at)}`}
            className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", o.tone, className)}>
            {o.label} · {ago(f.last.created_at)}{f.count > 1 && <span className="opacity-70">· ×{f.count}</span>}
        </span>
    );
}

/** Every contact on a lead, newest first. `showAsm` names who made it (head office's view). */
export function FollowUpLog({ followups, showAsm }: { followups: FollowUp[]; showAsm?: boolean }) {
    if (!followups.length) return <p className="text-sm text-slate-400">Nobody has contacted this customer yet.</p>;
    return (
        <ol className="space-y-2">
            {followups.map(f => {
                const Icon = CHANNEL_ICON[f.channel] ?? Phone;
                const o = outcomeOf(f.outcome);
                return (
                    <li key={f.id} className="flex gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5">
                        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", o.tone)}>{o.label}</span>
                                <span className="text-xs text-slate-500">
                                    {channelLabel(f.channel)} · {when(f.created_at)}{showAsm && f.asm_name ? ` · ${f.asm_name}` : ""}
                                </span>
                            </div>
                            {f.note && <p className="mt-1 text-sm text-slate-700 break-words">{f.note}</p>}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

/**
 * "How did it go?" — the ASM records one contact with a lead's customer.
 * Opened after they come back from the Call or WhatsApp button (with that
 * channel already picked), or from "Log a contact" on the lead.
 */
export function FollowUpDialog({ lead, channel, onClose, onSaved }: {
    lead: AsmLead | null;
    channel?: FollowUpChannel;
    onClose: () => void;
    onSaved: (leadId: string, followups: FollowUp[], followup: AsmLead["followup"]) => void;
}) {
    const { toast } = useToast();
    const [pickedChannel, setPickedChannel] = useState<FollowUpChannel | null>(null);
    const [outcome, setOutcome] = useState<string | null>(null);
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (lead) { setPickedChannel(channel ?? null); setOutcome(null); setNote(""); }
    }, [lead, channel]);

    const save = async () => {
        if (!lead || !pickedChannel || !outcome) return;
        setSaving(true);
        try {
            const r = await api.post(`/asm-portal/leads/${lead.id}/followups`, { channel: pickedChannel, outcome, note });
            onSaved(lead.id, r.data.followups, r.data.followup);
            toast({ title: "Saved", description: "Head office can see it on the lead." });
            onClose();
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setSaving(false);
        }
    };

    const name = lead?.customer_name?.trim() || "the customer";
    return (
        <Dialog open={!!lead} onOpenChange={o => { if (!o) onClose(); }}>
            <DialogContent className="max-w-md rounded-3xl">
                <DialogHeader>
                    <DialogTitle className="text-lg font-black">How did it go with {name}?</DialogTitle>
                    <DialogDescription>Saved on the lead for you and head office.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">How</p>
                        <div className="grid grid-cols-3 gap-2">
                            {FOLLOW_UP_CHANNELS.map(c => {
                                const Icon = CHANNEL_ICON[c.id];
                                const on = pickedChannel === c.id;
                                return (
                                    <button key={c.id} type="button" aria-pressed={on} onClick={() => setPickedChannel(c.id)}
                                        className={cn("h-11 rounded-xl border text-sm font-semibold flex items-center justify-center gap-1.5 transition",
                                            on ? "border-orange-500 bg-orange-500 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-orange-200")}>
                                        <Icon className="h-4 w-4" /> {c.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">What happened</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {FOLLOW_UP_OUTCOMES.map(o => {
                                const on = outcome === o.id;
                                return (
                                    <button key={o.id} type="button" aria-pressed={on} onClick={() => setOutcome(o.id)}
                                        className={cn("min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition",
                                            on ? "border-orange-500 bg-orange-50 text-orange-800 ring-1 ring-orange-500" : "border-slate-200 bg-white text-slate-700 hover:border-orange-200")}>
                                        {o.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Note <span className="normal-case font-normal text-slate-400">(optional)</span></p>
                        <Textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={3}
                            placeholder="e.g. Wants SUV seat covers, will visit the store on Saturday" className="rounded-xl" />
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>Not now</Button>
                    <Button onClick={save} disabled={!pickedChannel || !outcome || saving} className="bg-orange-500 hover:bg-orange-600">
                        {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
