import { useMemo, useState } from "react";
import { Check, Loader2, Search, ShoppingBag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { limitText, remaining, type Brand, type PosmItem, type Usage } from "@/lib/posm";
import { PosmArt } from "./posmClipart";
import { POSMItemForm, Stepper, type DraftLine } from "./POSMItemForm";

/* A simple item has no fields to fill: its quantity is set on the card. */
const isSimple = (it: PosmItem) => it.qty_mode === "number" && it.fields.length === 0;

/**
 * Ordering POSM: item cards, each item's form, a cart bar and the review
 * before sending. The store uses it for itself; the admin uses it to raise a
 * request for a store, with that store's brands and limits (or none).
 *
 * `onSend` gets the lines and the note and resolves true once sent, when the
 * cart is emptied.
 */
export function POSMShop({ items, brands, usage, ignoreLimits, onSend, sendLabel = "Send request", forStore }: {
    items: PosmItem[];
    brands: Brand[];
    usage: Usage;
    ignoreLimits?: boolean;
    onSend: (lines: DraftLine[], note: string) => Promise<boolean>;
    sendLabel?: string;
    /** The store's name, when the admin orders for it. */
    forStore?: string;
}) {
    const [search, setSearch] = useState("");
    const [cart, setCart] = useState<DraftLine[]>([]);
    const [formItem, setFormItem] = useState<PosmItem | null>(null);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [note, setNote] = useState("");
    const [sending, setSending] = useState(false);

    const inCart = (id: string) => cart.filter(l => l.item_id === id).reduce((n, l) => n + l.qty, 0);
    const leftFor = (it: PosmItem) => {
        if (ignoreLimits) return null;
        const r = remaining(it, usage[it.id]);
        return r == null ? null : Math.max(0, r - inCart(it.id));
    };
    const setSimpleQty = (it: PosmItem, n: number) => setCart(c => {
        const rest = c.filter(l => l.item_id !== it.id);
        return n > 0 ? [...rest, { item_id: it.id, item_name: it.name, qty: n, values: {}, display: [], files: {} }] : rest;
    });
    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        return items.filter(it => !q || it.name.toLowerCase().includes(q) || (it.description || "").toLowerCase().includes(q));
    }, [items, search]);
    const cartCount = cart.reduce((n, l) => n + l.qty, 0);

    const send = async () => {
        setSending(true);
        try {
            if (await onSend(cart, note.trim())) { setCart([]); setNote(""); setReviewOpen(false); }
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="relative w-full sm:w-72 sm:ml-auto">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items" className="pl-9 rounded-xl bg-white" aria-label="Search items" />
            </div>

            {shown.length === 0 ? (
                <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500">
                    {items.length ? "No item matches that search." : "No POSM items are available right now."}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {shown.map(it => {
                        const n = inCart(it.id);
                        const lines = cart.filter(l => l.item_id === it.id).length;
                        const left = leftFor(it);
                        const lim = limitText(it.limits);
                        const out = left === 0 && n === 0;
                        return (
                            <article key={it.id} className={cn("flex flex-col rounded-2xl border bg-white overflow-hidden transition-shadow",
                                n ? "border-orange-200 shadow-md shadow-orange-50" : "border-gray-100 hover:shadow-sm")}>
                                <div className="aspect-[3/2] w-full max-w-full relative overflow-hidden bg-gradient-to-br from-orange-50 to-amber-50/40 grid place-items-center">
                                    <PosmArt clipart={it.clipart} image={it.image} fill className="h-[72%] w-[72%]" />
                                    {n > 0 && (
                                        <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white text-[11px] font-bold px-2 py-0.5">
                                            <Check className="h-3 w-3" /> {isSimple(it) ? n : lines}
                                        </span>
                                    )}
                                </div>
                                <div className="p-3 flex-1 space-y-0.5">
                                    <h3 className="font-bold text-gray-800 leading-tight">{it.name}</h3>
                                    {it.description && <p className="text-xs text-gray-500 line-clamp-2">{it.description}</p>}
                                    {lim && <p className={cn("text-[11px]", ignoreLimits ? "text-gray-300 line-through" : "text-gray-400")}>{lim}</p>}
                                    {left != null && left <= 3 && (
                                        <p className={cn("text-[11px] font-semibold", left ? "text-amber-600" : "text-red-500")}>
                                            {left ? `${left} left${forStore ? "" : " for you"}` : "None left for now"}
                                        </p>
                                    )}
                                </div>
                                <div className="p-3 pt-0">
                                    {isSimple(it) ? (
                                        <div className="flex justify-end">
                                            <Stepper label={it.name} value={n} max={left == null ? null : left + n} onChange={v => setSimpleQty(it, v)} />
                                        </div>
                                    ) : (
                                        <Button type="button" disabled={out} onClick={() => setFormItem(it)} variant={lines ? "outline" : "default"}
                                            className={cn("w-full rounded-xl", !lines && "bg-brand-orange hover:bg-brand-orange/90 text-white")}>
                                            {lines ? "Add another" : "Choose"}
                                        </Button>
                                    )}
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            {cart.length > 0 && (
                <div className="sticky bottom-3 z-10">
                    <div className="rounded-2xl bg-gray-900 text-white shadow-xl px-4 py-3 flex items-center gap-3">
                        <ShoppingBag className="h-5 w-5 text-orange-300 shrink-0" />
                        <div className="min-w-0 flex-1">
                            <p className="font-bold text-sm">{cart.length} item{cart.length === 1 ? "" : "s"} · {cartCount} piece{cartCount === 1 ? "" : "s"}{forStore ? ` · for ${forStore}` : ""}</p>
                            <p className="text-xs text-gray-300 truncate">{cart.map(l => `${l.item_name} ×${l.qty}`).join(" · ")}</p>
                        </div>
                        <Button onClick={() => setReviewOpen(true)} className="bg-brand-orange hover:bg-brand-orange/90 text-white rounded-xl shrink-0">Review request</Button>
                    </div>
                </div>
            )}

            {formItem && (
                <POSMItemForm item={formItem} brands={formItem.brands?.length ? brands.filter(b => formItem.brands!.includes(b)) : brands} left={leftFor(formItem)}
                    onClose={() => setFormItem(null)}
                    onAdd={lines => { setCart(c => [...c, ...lines]); setFormItem(null); }} />
            )}

            <Dialog open={reviewOpen} onOpenChange={v => { if (!sending) setReviewOpen(v); }}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl">
                    <DialogTitle className="text-lg font-bold text-gray-800">{forStore ? `Request for ${forStore}` : "Review your request"}</DialogTitle>
                    <DialogDescription className="text-xs">
                        {forStore ? "Check the items, then raise it. The store sees it under My requests." : "Check the items, then send. The team approves and dispatches them."}
                    </DialogDescription>
                    <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
                        {cart.map((l, i) => {
                            const it = items.find(x => x.id === l.item_id);
                            return (
                                <div key={i} className="flex items-start gap-3 p-3">
                                    <PosmArt clipart={it?.clipart} image={it?.image} className="h-10 w-12 shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold text-gray-800">{l.item_name} <span className="text-gray-400 font-semibold">×{l.qty}</span></p>
                                        {l.display.length > 0 && <p className="text-xs text-gray-500 break-words">{l.display.map(d => `${d.label}: ${d.value}`).join(" · ")}</p>}
                                    </div>
                                    <button type="button" aria-label={`Remove ${l.item_name}`}
                                        onClick={() => setCart(c => { const next = c.filter((_, j) => j !== i); if (!next.length) setReviewOpen(false); return next; })}
                                        className="text-gray-300 hover:text-red-500 shrink-0"><Trash2 className="h-4 w-4" /></button>
                                </div>
                            );
                        })}
                    </div>
                    <div className="space-y-1">
                        <label htmlFor="posm-note" className="text-xs font-semibold text-gray-600">{forStore ? "Note (shows in the chat)" : "Note for the team (optional)"}</label>
                        <Textarea id="posm-note" rows={3} value={note} onChange={e => setNote(e.target.value)}
                            placeholder={forStore ? "e.g. Asked for on the phone, 14 Oct" : "e.g. Needed before our anniversary on 2 Nov"} />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setReviewOpen(false)} disabled={sending}>Add more</Button>
                        <Button onClick={send} disabled={!cart.length || sending} className="bg-brand-orange hover:bg-brand-orange/90 text-white rounded-xl px-6">
                            {sending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} {sendLabel}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/** The form data for a request, as POST /posm/items and /posm/admin/on-behalf/items take it. */
export function requestForm(lines: DraftLine[], note: string, extra: Record<string, string> = {}) {
    const fd = new FormData();
    fd.append("items", JSON.stringify(lines.map(({ files, display, ...l }) => l)));
    fd.append("note", note);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    lines.forEach((l, i) => Object.entries(l.files).forEach(([field, fl]) => fl.forEach(f => fd.append(`line_${i}_${field}`, f))));
    return fd;
}
