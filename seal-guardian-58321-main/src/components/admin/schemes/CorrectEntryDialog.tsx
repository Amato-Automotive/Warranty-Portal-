import { useEffect, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Paperclip, Plus, Trash2, Undo2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { FORMAT_ACCEPT, type Scheme } from "@/lib/schemes";
import type { AdminEntry } from "./adminTypes";

type Line = { product_id: string; qty: string };
type Inv = { invoice_no: string; files: string[]; lines: Line[] };

/** Product lines as the admin edits them, from the lines saved on an entry. */
const toLines = (ls: { product_id: string; qty: number }[] | null | undefined): Line[] => (ls ?? []).map(l => ({ product_id: l.product_id, qty: String(l.qty) }));

/**
 * Head office correcting an entry a store sent: the same fields the store
 * filled in, the files on it, the store it is under and, once approved, its
 * points (products × quantity, invoice by invoice when it was approved that
 * way). The review stays as it is. Deleting a wrong entry needs a reason.
 */
export function CorrectEntryDialog({ entry, scheme, onClose, onDone }: {
    entry: AdminEntry | null; scheme: Scheme; onClose: () => void; onDone: () => void;
}) {
    const { toast } = useToast();
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [remove, setRemove] = useState<Set<string>>(new Set());
    const [added, setAdded] = useState<Record<string, File[]>>({});
    const [storeId, setStoreId] = useState("");
    const [stores, setStores] = useState<{ value: string; label: string }[]>([]);
    const [distributors, setDistributors] = useState<string[]>([]);
    const [note, setNote] = useState("");
    const [problems, setProblems] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [lines, setLines] = useState<Line[]>([]);
    const [invs, setInvs] = useState<Inv[]>([]);
    const [score, setScore] = useState("");
    const [pointsTouched, setPointsTouched] = useState(false);
    const products = scheme.score_rule.mode === "products" ? scheme.score_rule.products : [];
    const pointsOf = (ls: Line[]) => ls.reduce((n, l) => n + (Number(l.qty) || 0) * (products.find(p => p.id === l.product_id)?.points ?? 0), 0);

    useEffect(() => {
        if (!entry) return;
        setAnswers({ ...entry.answers }); setRemove(new Set()); setAdded({}); setStoreId(entry.store_id);
        setNote(""); setProblems([]); setDeleting(null); setPointsTouched(false);
        setScore(String(entry.score));
        setInvs((entry.invoices ?? []).map(i => ({ invoice_no: i.invoice_no, files: i.files, lines: toLines(i.lines) })));
        setLines(toLines(entry.lines ?? entry.claimed_lines).length ? toLines(entry.lines ?? entry.claimed_lines) : products.length ? [{ product_id: products[0].id, qty: "" }] : []);
        if (!stores.length) {
            api.get("/schemes/admin/stores").then(r => setStores((r.data.stores || []).map((s: any) => ({
                value: s.id, label: [s.store_name, s.city].filter(Boolean).join(" · "),
            })))).catch(() => setStores([]));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entry?.id]);
    useEffect(() => {
        if (!entry || !storeId || !scheme.fields.some(f => f.type === "distributor")) return;
        api.get("/schemes/admin/distributors", { params: { store_id: storeId } })
            .then(r => setDistributors((r.data.distributors || []).map((d: any) => d.name))).catch(() => setDistributors([]));
    }, [entry?.id, storeId]);

    if (!entry) return null;
    const moved = storeId !== entry.store_id;
    const byInvoice = invs.length > 0;
    const canPoints = entry.status === "approved" && scheme.score_rule.mode !== "none";
    const newPoints = products.length ? (byInvoice ? invs.reduce((n, i) => n + pointsOf(i.lines), 0) : pointsOf(lines)) : Number(score) || 0;
    const changed = moved || pointsTouched || remove.size > 0 || Object.values(added).some(l => l.length)
        || scheme.fields.some(f => f.type !== "file" && (answers[f.id] ?? "") !== (entry.answers[f.id] ?? ""));

    const save = async () => {
        setSaving(true); setProblems([]);
        try {
            const form = new FormData();
            form.append("answers", JSON.stringify(answers));
            form.append("remove", JSON.stringify([...remove]));
            form.append("store_id", storeId);
            if (note.trim()) form.append("note", note.trim());
            if (canPoints && pointsTouched) {
                const clean = (ls: Line[]) => ls.filter(l => Number(l.qty) > 0).map(l => ({ product_id: l.product_id, qty: Number(l.qty) }));
                form.append("points", JSON.stringify(!products.length ? { score }
                    : byInvoice ? { invoices: invs.map(i => ({ invoice_no: i.invoice_no, files: i.files, lines: clean(i.lines) })) }
                        : { lines: clean(lines) }));
            }
            for (const [fid, list] of Object.entries(added)) for (const f of list) form.append(fid, f);
            const r = await api.post(`/schemes/admin/entries/${entry.id}/correct`, form, { headers: { "Content-Type": "multipart/form-data" } });
            toast({ title: "Entry corrected", description: (r.data.changes ?? []).join(" · ").slice(0, 200) });
            onDone();
        } catch (e: any) {
            const list = e?.response?.data?.problems;
            setProblems(Array.isArray(list) && list.length ? list : [getErrorMessage(e, "Could not save")]);
        } finally { setSaving(false); }
    };
    const del = async () => {
        setSaving(true);
        try {
            await api.delete(`/schemes/admin/entries/${entry.id}`, { data: { reason: deleting } });
            toast({ title: "Entry deleted", description: "The reason and the entry are kept in the activity log." });
            onDone();
        } catch (e) {
            setProblems([getErrorMessage(e, "Could not delete")]);
        } finally { setSaving(false); }
    };
    /* One product line editor: product, quantity, remove. */
    const lineEditor = (ls: Line[], set: (next: Line[]) => void) => (
        <div className="space-y-1.5">
            {ls.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5">
                    <Select value={l.product_id} onValueChange={v => { set(ls.map((x, j) => j === i ? { ...x, product_id: v } : x)); setPointsTouched(true); }}>
                        <SelectTrigger className="h-9 flex-1" aria-label="Product"><SelectValue /></SelectTrigger>
                        <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.points} pts)</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" min={0} value={l.qty} placeholder="Qty" aria-label="Quantity" className="h-9 w-20"
                        onChange={e => { set(ls.map((x, j) => j === i ? { ...x, qty: e.target.value } : x)); setPointsTouched(true); }} />
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-rose-500" aria-label="Remove line"
                        onClick={() => { set(ls.filter((_, j) => j !== i)); setPointsTouched(true); }}><Trash2 className="h-4 w-4" /></Button>
                </div>
            ))}
            <button type="button" className="text-xs text-sky-700 flex items-center gap-1"
                onClick={() => { set([...ls, { product_id: products[0].id, qty: "" }]); setPointsTouched(true); }}><Plus className="h-3 w-3" /> Another product</button>
        </div>
    );

    return (
        <Dialog open={!!entry} onOpenChange={o => { if (!o && !saving) onClose(); }}>
            <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Correct this entry</DialogTitle>
                    <DialogDescription>{entry.store_name} · sent {new Date(entry.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. Its review and points stay as they are.</DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-800">Store</p>
                        <Combobox options={stores} value={storeId} onChange={v => setStoreId(v || entry.store_id)} placeholder="Pick a store"
                            searchPlaceholder="Type a store or city…" emptyMessage="No store matches." className="font-normal" />
                        {moved && <p className="text-xs text-amber-700">The entry and its points move to this store. Say why below.</p>}
                    </div>

                    {scheme.score_rule.mode !== "none" && (
                        <div className="rounded-lg border border-orange-200 bg-orange-50/40 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-800">Points</p>
                                <p className="text-sm tabular-nums">
                                    {pointsTouched && newPoints !== entry.score
                                        ? <><span className="text-slate-400 line-through">{entry.score}</span> → <b className="text-orange-700">{newPoints}</b></>
                                        : <b>{entry.score}</b>}
                                </p>
                            </div>
                            {!canPoints ? (
                                <p className="text-xs text-slate-500">Points are set when the entry is approved. Approve it from the review first.</p>
                            ) : !products.length ? (
                                <Input type="number" min={0} step="any" value={score} className="h-9 w-32" aria-label="Points"
                                    onChange={e => { setScore(e.target.value); setPointsTouched(true); }} />
                            ) : byInvoice ? (
                                invs.map((inv, k) => (
                                    <div key={k} className="rounded-md bg-white border border-slate-200 p-2 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-slate-500 shrink-0">Invoice</span>
                                            <Input value={inv.invoice_no} className="h-8 text-sm" aria-label={`Invoice ${k + 1} number`}
                                                onChange={e => { setInvs(v => v.map((x, j) => j === k ? { ...x, invoice_no: e.target.value } : x)); setPointsTouched(true); }} />
                                            <span className="text-xs tabular-nums text-slate-600 shrink-0">{pointsOf(inv.lines)} pts</span>
                                        </div>
                                        {lineEditor(inv.lines, next => setInvs(v => v.map((x, j) => j === k ? { ...x, lines: next } : x)))}
                                    </div>
                                ))
                            ) : lineEditor(lines, setLines)}
                            {canPoints && <p className="text-xs text-slate-500">The entry stays approved; the leaderboard updates with the new points.</p>}
                        </div>
                    )}

                    {scheme.fields.filter(f => f.type === "file").map(f => {
                        const list = entry.files[f.id] ?? [];
                        const extra = added[f.id] ?? [];
                        const kept = list.filter(x => !remove.has(x.url)).length + extra.length;
                        return (
                            <div key={f.id} className="space-y-1.5">
                                <p className="text-sm font-medium text-slate-800">{f.label}{f.required && <span className="text-rose-500"> *</span>} <span className="text-xs font-normal text-slate-400">· {kept} of {f.max_files ?? 1}</span></p>
                                {list.map(x => {
                                    const gone = remove.has(x.url);
                                    return (
                                        <div key={x.url} className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm", gone ? "border-rose-200 bg-rose-50" : "border-slate-200")}>
                                            <a href={x.url} target="_blank" rel="noreferrer" className={cn("truncate flex items-center gap-1.5 text-sky-700", gone && "line-through text-slate-400")}><Paperclip className="h-3.5 w-3.5 shrink-0" />{x.name}</a>
                                            <button type="button" className="shrink-0 text-xs font-semibold text-slate-500 hover:text-rose-600 flex items-center gap-1"
                                                onClick={() => setRemove(s => { const n = new Set(s); if (n.has(x.url)) n.delete(x.url); else n.add(x.url); return n; })}>
                                                {gone ? <><Undo2 className="h-3.5 w-3.5" />Keep</> : <><Trash2 className="h-3.5 w-3.5" />Remove</>}
                                            </button>
                                        </div>
                                    );
                                })}
                                {extra.map((file, i) => (
                                    <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                                        <span className="truncate">New: {file.name}</span>
                                        <button type="button" className="text-xs font-semibold text-slate-500 hover:text-rose-600"
                                            onClick={() => setAdded(m => ({ ...m, [f.id]: m[f.id].filter((_, j) => j !== i) }))}>Remove</button>
                                    </div>
                                ))}
                                {kept < (f.max_files ?? 1) && (
                                    <label className="flex items-center gap-2 w-fit cursor-pointer rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:border-orange-300">
                                        <Upload className="h-4 w-4" /> Add a file
                                        <input type="file" multiple className="hidden" accept={(f.formats ?? []).map(x => FORMAT_ACCEPT[x]).join(",")}
                                            onChange={e => { const picked = Array.from(e.target.files ?? []); e.target.value = ""; setAdded(m => ({ ...m, [f.id]: [...(m[f.id] ?? []), ...picked] })); }} />
                                    </label>
                                )}
                            </div>
                        );
                    })}

                    {scheme.fields.filter(f => f.type !== "file").map(f => {
                        const was = entry.answers[f.id] ?? "";
                        const now = answers[f.id] ?? "";
                        const options = f.type === "distributor" ? [...new Set([...distributors, ...(was ? [was] : [])])] : f.type === "select" ? (f.options ?? []).filter(Boolean) : [];
                        return (
                            <div key={f.id} className="space-y-1.5">
                                <label htmlFor={`c-${f.id}`} className="text-sm font-medium text-slate-800">{f.label}{f.required && <span className="text-rose-500"> *</span>}</label>
                                {options.length ? (
                                    <Select value={now} onValueChange={v => setAnswers(a => ({ ...a, [f.id]: v }))}>
                                        <SelectTrigger id={`c-${f.id}`}><SelectValue placeholder="Choose" /></SelectTrigger>
                                        <SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                                    </Select>
                                ) : (
                                    <Input id={`c-${f.id}`} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                                        value={now} onChange={e => setAnswers(a => ({ ...a, [f.id]: e.target.value }))} />
                                )}
                                {now !== was && <p className="text-xs text-slate-500">Store sent: {was || "(empty)"}</p>}
                            </div>
                        );
                    })}

                    <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-slate-800">Why the correction{moved && <span className="text-rose-500"> *</span>}</span>
                        <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. Store sent the wrong invoice; replaced with the right one" />
                    </label>

                    {!!entry.edits?.length && (
                        <div className="space-y-1.5">
                            <p className="text-sm font-medium text-slate-800">Earlier corrections</p>
                            {entry.edits.map((ed, i) => (
                                <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                    <p className="font-semibold">{new Date(ed.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {ed.by_name || "Admin"}</p>
                                    <ul className="list-disc pl-4">{ed.changes.map((c, j) => <li key={j}>{c}</li>)}</ul>
                                    {ed.note && <p className="mt-0.5 text-slate-500">{ed.note}</p>}
                                </div>
                            ))}
                        </div>
                    )}

                    {problems.length > 0 && (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                            <ul className="list-disc pl-5 space-y-0.5">{problems.map(p => <li key={p}>{p}</li>)}</ul>
                        </div>
                    )}

                    <div className="rounded-lg border border-rose-100 p-3 space-y-2">
                        {deleting === null ? (
                            <button type="button" className="text-sm font-semibold text-rose-600 hover:text-rose-700 flex items-center gap-1.5" onClick={() => setDeleting("")}>
                                <Trash2 className="h-4 w-4" /> Delete this entry
                            </button>
                        ) : (
                            <>
                                <p className="text-sm font-semibold text-rose-700">Delete this entry? {entry.status === "approved" ? `Its ${entry.score} points come off ${entry.store_name}.` : ""}</p>
                                <Input autoFocus value={deleting} onChange={e => setDeleting(e.target.value)} placeholder="Why? e.g. duplicate of the 14 Oct entry" aria-label="Reason for deleting" />
                                <div className="flex gap-2">
                                    <Button size="sm" variant="destructive" disabled={saving || deleting.trim().length < 3} onClick={del}>Yes, delete</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button className="bg-orange-500 hover:bg-orange-600" onClick={save} disabled={!changed || saving || (moved && !note.trim())}>
                        {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save correction
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
