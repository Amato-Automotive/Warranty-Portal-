import { useEffect, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Upload, Paperclip } from "lucide-react";
import type { Scheme } from "@/lib/schemes";

/**
 * An entry the admin adds for a store — an invoice sent by mail or phone, or
 * a past month. Approved as it is added, dated on the day given, outside the
 * windows; the store is joined to the scheme if it was not.
 */

export function AddEntryDialog({ open, scheme, onClose, onDone }: {
    open: boolean; scheme: Scheme; onClose: () => void; onDone: () => void;
}) {
    const { toast } = useToast();
    const [stores, setStores] = useState<{ value: string; label: string }[]>([]);
    const [storeId, setStoreId] = useState("");
    const [date, setDate] = useState("");
    const [invoice, setInvoice] = useState("");
    const [lines, setLines] = useState<{ product_id: string; qty: string }[]>([]);
    const [score, setScore] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [saving, setSaving] = useState(false);
    const products = scheme.score_rule.mode === "products" ? scheme.score_rule.products : [];
    const fileField = scheme.fields.find(f => f.type === "file");

    useEffect(() => {
        if (!open) return;
        setStoreId(""); setDate(""); setInvoice(""); setScore(""); setFiles([]);
        setLines(products.length ? [{ product_id: products[0].id, qty: "" }] : []);
        if (!stores.length) {
            api.get("/schemes/admin/stores").then(r => setStores((r.data.stores || []).map((s: any) => ({
                value: s.id, label: [s.store_name, s.city].filter(Boolean).join(" · "),
            })))).catch(() => setStores([]));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const total = lines.reduce((n, l) => n + (Number(l.qty) || 0) * (products.find(p => p.id === l.product_id)?.points ?? 0), 0);
    const ready = storeId && (products.length ? lines.some(l => Number(l.qty) > 0) : score !== "");

    const save = async () => {
        setSaving(true);
        try {
            const form = new FormData();
            form.append("store_id", storeId);
            if (date) form.append("date", date);
            if (invoice.trim()) form.append("invoice_no", invoice.trim());
            if (products.length) form.append("lines", JSON.stringify(lines.filter(l => Number(l.qty) > 0).map(l => ({ product_id: l.product_id, qty: Number(l.qty) }))));
            else form.append("score", score);
            if (fileField) for (const f of files) form.append(fileField.id, f);
            await api.post(`/schemes/admin/${scheme.id}/entries`, form, { headers: { "Content-Type": "multipart/form-data" } });
            toast({ title: "Entry added", description: "Approved and counted in the leaderboard." });
            onDone();
        } catch (e) {
            toast({ title: "Could not add the entry", description: getErrorMessage(e, "Check the details"), variant: "destructive" });
        } finally { setSaving(false); }
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!o && !saving) onClose(); }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Add an entry for a store</DialogTitle>
                    <DialogDescription>For an invoice sent outside the app, or a past month. It's approved as you add it.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <p className="text-xs font-semibold text-slate-700">Store</p>
                        <Combobox options={stores} value={storeId} onChange={setStoreId} placeholder="Pick a store"
                            searchPlaceholder="Type a store or city…" emptyMessage="No store matches." className="font-normal" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                            <span className="block text-xs font-semibold text-slate-700">Invoice date</span>
                            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                        </label>
                        <label className="space-y-1">
                            <span className="block text-xs font-semibold text-slate-700">Invoice number</span>
                            <Input value={invoice} onChange={e => setInvoice(e.target.value)} placeholder="Optional" maxLength={80} />
                        </label>
                    </div>
                    {products.length ? (
                        <div className="space-y-1.5">
                            <p className="text-xs font-semibold text-slate-700">Products on the invoice</p>
                            {lines.map((l, i) => (
                                <div key={i} className="flex items-center gap-1.5">
                                    <Select value={l.product_id} onValueChange={v => setLines(ls => ls.map((x, j) => j === i ? { ...x, product_id: v } : x))}>
                                        <SelectTrigger className="h-9 flex-1" aria-label="Product"><SelectValue /></SelectTrigger>
                                        <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.points} pts)</SelectItem>)}</SelectContent>
                                    </Select>
                                    <Input type="number" min={1} value={l.qty} placeholder="Qty" aria-label="Quantity" className="h-9 w-20"
                                        onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-rose-500" disabled={lines.length === 1}
                                        onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            ))}
                            <button type="button" className="text-xs text-sky-700 flex items-center gap-1"
                                onClick={() => setLines(ls => [...ls, { product_id: products[0].id, qty: "" }])}><Plus className="h-3 w-3" /> Another product</button>
                            <p className="text-sm text-slate-700">Points: <b className="tabular-nums">{total}</b></p>
                        </div>
                    ) : (
                        <label className="space-y-1 block">
                            <span className="block text-xs font-semibold text-slate-700">Score</span>
                            <Input type="number" min={0} step="any" value={score} onChange={e => setScore(e.target.value)} className="w-32" />
                        </label>
                    )}
                    {fileField && (
                        <div className="space-y-1">
                            <p className="text-xs font-semibold text-slate-700">{fileField.label} <span className="font-normal text-slate-400">(optional)</span></p>
                            <label className="flex items-center gap-2 w-fit cursor-pointer rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:border-orange-300">
                                <Upload className="h-4 w-4" /> Choose files
                                <input type="file" multiple className="hidden" onChange={e => { setFiles(f => [...f, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
                            </label>
                            {files.map((f, i) => (
                                <div key={i} className="flex items-center justify-between text-xs text-slate-700 rounded border border-slate-200 px-2 py-1">
                                    <span className="truncate flex items-center gap-1"><Paperclip className="h-3 w-3" />{f.name}</span>
                                    <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))}>Remove</button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button className="bg-orange-500 hover:bg-orange-600" onClick={save} disabled={!ready || saving}>
                        {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Add & approve
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
