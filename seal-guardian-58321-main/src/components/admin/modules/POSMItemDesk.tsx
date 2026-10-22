import { useEffect, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { cn, formatToIST } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Paperclip, Pencil, Truck, Undo2 } from "lucide-react";
import { LINE_STAGE, lineStage, lineActionsFor, type LineAction, type LineStage, type PosmItem, type PosmLimits, type PosmLine } from "@/lib/posm";
import { PosmArt } from "@/components/posm/posmClipart";

type Limit = PosmLimits & { used_month?: number; used_year?: number };
type Form = { kind: "approve" | "reject" | "hold" | "dispatch" | "edit"; indexes: number[] };
type Ship = { courier: string; tracking: string; date: string };

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const NOTE_LABEL: Partial<Record<LineStage, string>> = { rejected: "Reason", on_hold: "Why on hold" };
const STAGE_ORDER: LineStage[] = ["pending", "approved", "in_production", "on_hold", "dispatched", "delivered", "rejected"];

function usageNote(l?: Limit): string | null {
    if (!l) return null;
    const parts: string[] = [];
    if (l.max_month != null) parts.push(`this month ${l.used_month ?? 0} of ${l.max_month}`);
    if (l.max_year != null) parts.push(`this year ${l.used_year ?? 0} of ${l.max_year}`);
    if (l.max_request != null) parts.push(`max ${l.max_request} per request`);
    return parts.length ? `Already: ${parts.join(" · ")}` : null;
}

/**
 * The items of a request for the admin: each one approved, held, rejected,
 * produced, dispatched and delivered on its own, with a note to the store,
 * Undo and Edit; ticked items take a step together.
 */
export function POSMItemDesk({ requestId, lines, items, limits, onSaved }: {
    requestId: number;
    lines: PosmLine[];
    items?: PosmItem[];
    limits?: Record<string, Limit>;
    onSaved: (fresh: any) => void;
}) {
    const { toast } = useToast();
    const [ticked, setTicked] = useState<number[]>([]);
    const [qty, setQty] = useState<Record<number, string>>({});
    const [notes, setNotes] = useState<Record<number, string>>({});
    const [form, setForm] = useState<Form | null>(null);
    const [fNote, setFNote] = useState("");
    const [fQty, setFQty] = useState("");
    const [fShip, setFShip] = useState<Ship>({ courier: "", tracking: "", date: today() });
    const [busy, setBusy] = useState(false);

    useEffect(() => { setTicked([]); setQty({}); setNotes({}); setForm(null); }, [requestId]);

    const post = async (action: LineAction, specs: { index: number; qty?: number }[], extra: Record<string, unknown> = {}) => {
        setBusy(true);
        try {
            const r = await api.post(`/posm/${requestId}/lines`, { action, items: specs, ...extra });
            toast({ title: r.data.message || "Saved", description: "The store is told in their notifications." });
            onSaved(r.data.data);
            setTicked(t => t.filter(i => !specs.some(s => s.index === i)));
            setForm(null);
        } catch (e) {
            toast({ title: "Not done", description: getErrorMessage(e, "Try again."), variant: "destructive" });
        } finally {
            setBusy(false);
        }
    };

    const fits = (a: LineAction, idx: number[]) => idx.filter(i => lines[i] && lineActionsFor(lines[i]).includes(a));
    const qtyOf = (i: number) => { const v = qty[i]; return v != null && v !== "" ? Math.floor(Number(v)) : undefined; };

    const open = (kind: Form["kind"], indexes: number[]) => {
        const one = indexes.length === 1 ? lines[indexes[0]] : null;
        setFNote(kind === "edit" ? one?.note ?? "" : "");
        setFQty(one ? String(one.approved_qty && one.approved_qty > 0 ? one.approved_qty : one.qty) : "");
        const d = [...indexes].map(i => lines[i]?.dispatch).find(Boolean);
        setFShip(kind === "edit" && d ? { courier: d.courier, tracking: d.tracking, date: d.date ?? "" } : { courier: "", tracking: "", date: today() });
        setForm({ kind, indexes });
    };

    /* One item's Approve: the quantity and note typed on its card. */
    const approveOne = (i: number) => post("approve", [{ index: i, qty: qtyOf(i) }], notes[i]?.trim() ? { note: notes[i].trim() } : {});

    const submitForm = () => {
        if (!form) return;
        const specs = form.indexes.map(index => ({ index }));
        const one = form.indexes.length === 1 ? lines[form.indexes[0]] : null;
        switch (form.kind) {
            case "approve": return post("approve", form.indexes.map(index => ({ index, qty: one ? Math.floor(Number(fQty)) : qtyOf(index) })), fNote.trim() ? { note: fNote.trim() } : {});
            case "reject": return post("reject", specs, { note: fNote.trim() });
            case "hold": return post("hold", specs, fNote.trim() ? { note: fNote.trim() } : {});
            case "dispatch": return post("dispatch", specs, { dispatch: fShip });
            case "edit": {
                const s = one ? lineStage(one) : "pending";
                const extra: Record<string, unknown> = { note: fNote };
                if (s === "dispatched" || s === "delivered") extra.dispatch = fShip;
                const changedQty = one && s !== "rejected" && fQty && Number(fQty) !== (one.approved_qty ?? one.qty);
                return post("edit", changedQty ? [{ index: form.indexes[0], qty: Math.floor(Number(fQty)) }] : specs, extra);
            }
        }
    };

    const counts = STAGE_ORDER.map(s => ({ s, n: lines.filter(l => lineStage(l) === s).length })).filter(x => x.n);
    const allTicked = ticked.length === lines.length && lines.length > 0;

    /* What the ticked items can do together: each button takes the ticked items it fits. */
    const bulk: { a: LineAction; label: string; tone?: string; run: (idx: number[]) => void }[] = [
        { a: "approve", label: "Approve", tone: "bg-emerald-600 hover:bg-emerald-700 text-white", run: idx => post("approve", idx.map(index => ({ index, qty: qtyOf(index) }))) },
        { a: "start", label: "Start production", run: idx => post("start", idx.map(index => ({ index }))) },
        { a: "dispatch", label: "Dispatch…", tone: "bg-orange-600 hover:bg-orange-700 text-white", run: idx => open("dispatch", idx) },
        { a: "deliver", label: "Mark delivered", run: idx => post("deliver", idx.map(index => ({ index }))) },
        { a: "resume", label: "Resume", run: idx => post("resume", idx.map(index => ({ index }))) },
        { a: "hold", label: "Hold…", run: idx => open("hold", idx) },
        { a: "reject", label: "Reject…", tone: "text-red-600", run: idx => open("reject", idx) },
    ];

    const formLines = form ? form.indexes.map(i => lines[i]) : [];
    const formOne = formLines.length === 1 ? formLines[0] : null;
    const formStage = formOne ? lineStage(formOne) : null;
    const formOk = !form ? false
        : form.kind === "reject" ? fNote.trim().length >= 3
        : form.kind === "dispatch" ? !!fShip.courier.trim()
        : form.kind === "approve" && formOne ? Number(fQty) >= 1
        : form.kind === "edit" && formStage === "rejected" ? fNote.trim().length >= 3
        : form.kind === "edit" && (formStage === "dispatched" || formStage === "delivered") ? !!fShip.courier.trim()
        : true;

    return (
        <div className="space-y-3">
            {/* Where the items stand */}
            <div className="flex flex-wrap gap-1.5">
                {counts.map(({ s, n }) => (
                    <span key={s} className={cn("rounded-lg px-2.5 py-1 text-xs font-bold tabular-nums", LINE_STAGE[s].tone)}>{n} {LINE_STAGE[s].label.toLowerCase()}</span>
                ))}
            </div>

            {/* Ticked items together */}
            <div className={cn("rounded-xl px-3 py-2 flex flex-wrap items-center gap-2", ticked.length ? "bg-slate-900" : "bg-slate-50")}>
                <label className={cn("flex items-center gap-2 text-sm font-semibold mr-auto", ticked.length ? "text-white" : "text-slate-600")}>
                    <Checkbox checked={allTicked} onCheckedChange={v => setTicked(v ? lines.map((_, i) => i) : [])} aria-label="Tick every item"
                        className={cn(ticked.length && "border-white data-[state=checked]:bg-white data-[state=checked]:text-slate-900")} />
                    {ticked.length ? `${ticked.length} ticked` : "Tick items to act on several at once"}
                </label>
                {ticked.length > 0 && bulk.map(b => {
                    const idx = fits(b.a, ticked);
                    if (!idx.length) return null;
                    return (
                        <Button key={b.a} size="sm" variant="outline" disabled={busy} onClick={() => b.run(idx)}
                            className={cn("rounded-lg h-8 bg-white", b.tone)}>
                            {b.label}{idx.length !== ticked.length ? ` (${idx.length})` : ""}
                        </Button>
                    );
                })}
            </div>

            {/* The items */}
            <div className="grid gap-2.5">
                {lines.map((l, i) => {
                    const s = lineStage(l);
                    const it = items?.find(x => x.id === l.item_id);
                    const acts = lineActionsFor(l);
                    const sent = l.approved_qty;
                    const usage = s === "pending" ? usageNote(limits?.[l.item_id]) : null;
                    return (
                        <div key={i} className={cn("rounded-2xl border p-3 sm:p-4 space-y-3",
                            s === "pending" ? "border-orange-200 bg-white" : s === "rejected" ? "border-red-100 bg-red-50/30" : "border-slate-100 bg-white")}>
                            <div className="grid grid-cols-[auto_52px_minmax(0,1fr)] sm:grid-cols-[auto_52px_minmax(0,1fr)_auto] gap-3 items-center">
                                <Checkbox checked={ticked.includes(i)} aria-label={`Tick ${l.item_name}`}
                                    onCheckedChange={v => setTicked(t => v ? [...t, i] : t.filter(x => x !== i))} />
                                <div className="h-11 w-[52px] rounded-xl bg-orange-50/60 grid place-items-center overflow-hidden">
                                    <PosmArt clipart={it?.clipart} image={it?.image} className="h-9 w-11" />
                                </div>
                                <div className="min-w-0">
                                    <p className={cn("font-bold", s === "rejected" ? "text-slate-500 line-through" : "text-slate-800")}>
                                        {l.item_name}
                                        <span className={cn("font-semibold", sent != null && sent > 0 && sent < l.qty ? "text-amber-600" : "text-slate-500")}>
                                            {" · "}{s === "rejected" ? `${l.qty} asked` : sent != null && sent !== l.qty ? `${sent} of ${l.qty}` : l.qty}
                                        </span>
                                    </p>
                                    {l.display?.length ? (
                                        <p className="text-xs text-slate-500 break-words">
                                            {l.display.map((d, k) => <span key={k}>{k ? " · " : ""}<span className="text-slate-400">{d.label}:</span> {d.value}</span>)}
                                        </p>
                                    ) : null}
                                    {l.files?.length ? (
                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                            {l.files.map((u, j) => (
                                                <a key={j} href={u} target="_blank" rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 bg-orange-50 rounded-md px-2 py-0.5 hover:bg-orange-100">
                                                    <Paperclip className="h-3 w-3" /> File {j + 1}
                                                </a>
                                            ))}
                                        </div>
                                    ) : null}
                                    {usage && <p className="text-[11px] font-semibold text-amber-600 mt-0.5">{usage}</p>}
                                </div>
                                <span className={cn("col-start-3 sm:col-start-auto justify-self-start sm:justify-self-end rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap", LINE_STAGE[s].tone)}>
                                    {LINE_STAGE[s].label}
                                </span>
                            </div>

                            {/* To approve: the quantity and a note, typed here */}
                            {s === "pending" && (
                                <div className="grid sm:grid-cols-[auto_minmax(0,1fr)] gap-2 items-center sm:pl-[88px]">
                                    <label className="flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap">
                                        {l.qty} asked → send
                                        <Input type="number" min={1} max={1000} value={qty[i] ?? String(l.approved_qty && l.approved_qty > 0 ? l.approved_qty : l.qty)}
                                            onChange={e => setQty(q => ({ ...q, [i]: e.target.value }))} aria-label={`Quantity to send of ${l.item_name}`}
                                            className="h-9 w-20 text-right tabular-nums" />
                                    </label>
                                    <Input value={notes[i] ?? ""} onChange={e => setNotes(n => ({ ...n, [i]: e.target.value }))}
                                        placeholder="Note to the store (optional), e.g. why fewer" aria-label={`Note to the store about ${l.item_name}`} className="h-9" />
                                </div>
                            )}

                            {/* The note the store sees */}
                            {l.note && (
                                <div className={cn("sm:ml-[88px] rounded-xl px-3 py-2 flex items-start gap-2 text-sm",
                                    s === "rejected" ? "bg-red-50" : s === "on_hold" ? "bg-yellow-50" : "bg-slate-50")}>
                                    <span className={cn("text-[10px] font-black uppercase tracking-wider pt-0.5 whitespace-nowrap",
                                        s === "rejected" ? "text-red-700" : s === "on_hold" ? "text-yellow-800" : "text-slate-500")}>{NOTE_LABEL[s] ?? "Note to store"}</span>
                                    <span className="flex-1 min-w-0 break-words text-slate-700">{l.note}</span>
                                </div>
                            )}

                            {/* Its shipment */}
                            {l.dispatch?.courier && (
                                <div className="sm:ml-[88px] rounded-xl bg-slate-50 px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
                                    <Truck className="h-4 w-4 text-orange-500 shrink-0" />
                                    <span className="font-semibold text-slate-700 break-words">{[l.dispatch.courier, l.dispatch.tracking].filter(Boolean).join(" · ")}</span>
                                    {l.dispatch.date && <span className="text-xs text-slate-500">sent {l.dispatch.date.split("-").reverse().join("/")}</span>}
                                    {s === "delivered" && l.delivered_at && (
                                        <span className="text-xs font-semibold text-emerald-700 ml-auto">Delivered {formatToIST(l.delivered_at)}{l.delivered_by === "franchise" ? " · confirmed by the store" : ""}</span>
                                    )}
                                </div>
                            )}

                            {/* Its steps */}
                            <div className="flex flex-wrap justify-end gap-1.5">
                                {acts.includes("undo") && (
                                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => post("undo", [{ index: i }])} className="h-8 rounded-lg text-slate-500">
                                        <Undo2 className="h-3.5 w-3.5 mr-1" /> Undo
                                    </Button>
                                )}
                                <Button size="sm" variant="ghost" disabled={busy} onClick={() => open("edit", [i])} className="h-8 rounded-lg text-slate-500">
                                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                                </Button>
                                {acts.includes("approve") && (s === "pending"
                                    ? <Button size="sm" disabled={busy} onClick={() => approveOne(i)} className="h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700">Approve</Button>
                                    : <Button size="sm" disabled={busy} onClick={() => open("approve", [i])} className="h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700">Approve instead</Button>)}
                                {acts.includes("resume") && <Button size="sm" disabled={busy} onClick={() => post("resume", [{ index: i }])} className="h-8 rounded-lg bg-slate-900">Resume</Button>}
                                {acts.includes("start") && <Button size="sm" variant="outline" disabled={busy} onClick={() => post("start", [{ index: i }])} className="h-8 rounded-lg">Start production</Button>}
                                {acts.includes("dispatch") && <Button size="sm" disabled={busy} onClick={() => open("dispatch", [i])} className="h-8 rounded-lg bg-orange-600 hover:bg-orange-700">Dispatch…</Button>}
                                {acts.includes("deliver") && <Button size="sm" disabled={busy} onClick={() => post("deliver", [{ index: i }])} className="h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700">Mark delivered</Button>}
                                {acts.includes("hold") && <Button size="sm" variant="outline" disabled={busy} onClick={() => open("hold", [i])} className="h-8 rounded-lg">Hold…</Button>}
                                {acts.includes("reject") && <Button size="sm" variant="outline" disabled={busy} onClick={() => open("reject", [i])} className="h-8 rounded-lg text-red-600 hover:text-red-700">Reject…</Button>}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* The small form a step needs */}
            <Dialog open={!!form} onOpenChange={v => { if (!v && !busy) setForm(null); }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {form?.kind === "approve" ? "Approve" : form?.kind === "reject" ? "Reject" : form?.kind === "hold" ? "Put on hold"
                                : form?.kind === "dispatch" ? "Dispatch" : "Edit"}{" "}
                            {formOne ? formOne.item_name : `${formLines.length} items`}
                        </DialogTitle>
                        <DialogDescription>
                            {formOne ? null : formLines.map(l => l.item_name).join(", ")}
                            {form?.kind === "edit" ? " The store sees the change." : " The store sees this on the item."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        {formOne && (form?.kind === "approve" || (form?.kind === "edit" && formStage !== "rejected")) && (
                            <label className="flex items-center gap-2 text-sm text-slate-600">
                                {formOne.qty} asked → send
                                <Input type="number" min={1} max={1000} value={fQty} onChange={e => setFQty(e.target.value)} className="h-9 w-24 text-right tabular-nums" aria-label="Quantity to send" />
                            </label>
                        )}
                        {(form?.kind === "dispatch" || (form?.kind === "edit" && (formStage === "dispatched" || formStage === "delivered"))) && (
                            <div className="grid gap-2">
                                <Input value={fShip.courier} onChange={e => setFShip(d => ({ ...d, courier: e.target.value }))} placeholder="Courier, by hand, distributor…" aria-label="How it is sent" />
                                <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2">
                                    <Input value={fShip.tracking} onChange={e => setFShip(d => ({ ...d, tracking: e.target.value }))} placeholder="Tracking / docket no." aria-label="Tracking number" />
                                    <Input type="date" value={fShip.date} onChange={e => setFShip(d => ({ ...d, date: e.target.value }))} aria-label="Dispatch date" />
                                </div>
                            </div>
                        )}
                        {form?.kind !== "dispatch" && (
                            <div className="space-y-1">
                                <label htmlFor="posm-item-note" className="text-xs font-semibold text-slate-600">
                                    {form?.kind === "reject" || formStage === "rejected" ? "Reason (required)" : form?.kind === "hold" || formStage === "on_hold" ? "Why on hold (optional)" : "Note to the store (optional)"}
                                </label>
                                <Textarea id="posm-item-note" rows={2} value={fNote} onChange={e => setFNote(e.target.value)}
                                    placeholder={form?.kind === "reject" ? "e.g. The FRP limit for this month is reached" : form?.kind === "hold" ? "e.g. New stock arrives next week" : "e.g. Only 10 in stock this month"} />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
                        <Button onClick={submitForm} disabled={busy || !formOk}
                            className={cn(form?.kind === "reject" ? "bg-red-600 hover:bg-red-700" : form?.kind === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-orange-600 hover:bg-orange-700")}>
                            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                            {form?.kind === "approve" ? "Approve" : form?.kind === "reject" ? "Reject" : form?.kind === "hold" ? "Put on hold" : form?.kind === "dispatch" ? "Mark dispatched" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
