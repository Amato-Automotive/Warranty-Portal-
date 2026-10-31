import { useMemo, useState } from "react";
import { Minus, Paperclip, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BRAND_LABEL, limitText, tableRows, type Brand, type PosmField, type PosmItem } from "@/lib/posm";
import { PosmArt } from "./posmClipart";

/** What the store adds to its request: the server's line, plus the files picked per field. */
export interface DraftLine {
    item_id: string;
    item_name: string;
    qty: number;
    values: Record<string, any>;
    display: { label: string; value: string }[];
    files: Record<string, File[]>;
}

export function Stepper({ value, onChange, min = 0, max, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number | null; label: string }) {
    const atMax = max != null && value >= max;
    return (
        <div className="inline-flex items-center rounded-xl border border-gray-200 overflow-hidden bg-white" role="group" aria-label={label}>
            <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}
                className="h-9 w-9 grid place-items-center bg-gray-50 hover:bg-gray-100 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
            <span className="min-w-[2.5rem] text-center font-bold tabular-nums">{value}</span>
            <button type="button" aria-label={`More ${label}`} disabled={atMax} onClick={() => onChange(value + 1)}
                className="h-9 w-9 grid place-items-center bg-gray-50 hover:bg-gray-100 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
        </div>
    );
}

const brandOf = (item: PosmItem, values: Record<string, any>): Brand | null => {
    const f = item.fields.find(x => x.type === "brand");
    if (!f) return null;
    const v = values[f.id];
    return (Array.isArray(v) ? (v.length === 1 ? v[0] : null) : v) ?? null;
};

/** The same words the server will store, for the cart. */
function displayOf(item: PosmItem, values: Record<string, any>, files: Record<string, File[]>) {
    const out: { label: string; value: string }[] = [];
    for (const f of item.fields) {
        const v = values[f.id];
        if (f.type === "files") { if (files[f.id]?.length) out.push({ label: f.label, value: `${files[f.id].length} file(s)` }); continue; }
        if (f.type === "sizes") {
            const s = Object.entries(v || {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k} ×${n}`).join(", ");
            if (s) out.push({ label: f.label, value: s });
            continue;
        }
        if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
        if (f.type === "brand") out.push({ label: f.label, value: [].concat(v).map((b: Brand) => BRAND_LABEL[b]).join(" + ") });
        else if (f.type === "table") {
            const row = tableRows(f, brandOf(item, values)).find(r => r.cells[0] === v);
            (f.columns ?? []).forEach((c, k) => row && out.push({ label: k === 0 ? f.label : c, value: row.cells[k] }));
        } else out.push({ label: f.label, value: Array.isArray(v) ? v.join(", ") : String(v) });
    }
    return out;
}

/** What is missing, in words; null when the line can go in the request. */
function problem(item: PosmItem, qty: number, values: Record<string, any>, files: Record<string, File[]>, left: number | null): string | null {
    for (const f of item.fields) {
        const v = values[f.id];
        if (f.type === "files") { if (f.required && !files[f.id]?.length) return `Attach ${f.label.toLowerCase()}`; continue; }
        if (f.type === "sizes") { if (f.required && !Object.values(v || {}).some(n => Number(n) > 0)) return "Choose at least one size"; continue; }
        if (f.required && (v == null || String(v).trim() === "" || (Array.isArray(v) && !v.length))) return `Fill in ${f.label.toLowerCase()}`;
        if (f.type === "table" && v && f.brand_split && !brandOf(item, values)) return "Choose the brand first";
    }
    if (qty < 1) return "Choose a quantity";
    if (left != null && qty > left) return left ? `You can ask for ${left} more` : "None left for now";
    return null;
}

const initialValues = (item: PosmItem, brands: Brand[]) => {
    const v: Record<string, any> = {};
    for (const f of item.fields) {
        if (f.type === "brand") v[f.id] = f.multiple ? [...brands] : brands[0];
        if (f.type === "sizes") v[f.id] = {};
        if (f.type === "select" && f.required && f.options?.length) v[f.id] = f.options[0];
    }
    const t = item.fields.find(f => f.type === "table");
    if (t) v[t.id] = tableRows(t, brandOf(item, v))[0]?.cells[0] ?? "";
    return v;
};

/**
 * The form for one item, in a sheet: its fields as the admin built them, and
 * a quantity unless the item is "always 1" or counted by sizes.
 */
export function POSMItemForm({ item, brands, left, onAdd, onClose }: {
    item: PosmItem; brands: Brand[]; left: number | null;
    onAdd: (lines: DraftLine[]) => void; onClose: () => void;
}) {
    const [values, setValues] = useState<Record<string, any>>(() => initialValues(item, brands));
    const [files, setFiles] = useState<Record<string, File[]>>({});
    const [qty, setQty] = useState(Math.max(1, item.limits.min ?? 1));
    const set = (id: string, v: any) => setValues(p => ({ ...p, [id]: v }));
    /* The choices offered: those for the brand picked on this line (or the store's), and those for both. */
    const lineBrandField = item.fields.find(f => f.type === "brand");
    const linePicked = lineBrandField ? ([] as string[]).concat(values[lineBrandField.id] ?? []).filter(b => (brands as string[]).includes(b)) : [];
    const forBrands = linePicked.length ? linePicked : brands;
    const offered = (f: PosmField) => (f.options ?? []).filter(o => !f.option_brands?.[o] || forBrands.includes(f.option_brands[o]));

    /* A design table split by brand (FRP): the store sees the designs of every
       brand it sells, each with its own quantity, and each design picked
       becomes its own line. The brand comes with the design. */
    const brandField = item.fields.find(f => f.type === "brand");
    const pickTable = item.qty_mode === "number" && brandField
        ? item.fields.find(f => f.type === "table" && f.brand_split) : undefined;
    const [picks, setPicks] = useState<Record<string, number>>({});
    const pickKey = (b: Brand, design: string) => `${b}|${design}`;
    const pickTotal = Object.values(picks).reduce((a, n) => a + n, 0);

    const sizesTotal = useMemo<number>(() => {
        const f = item.fields.find(x => x.type === "sizes");
        return f ? Object.values(values[f.id] || {}).reduce<number>((a, n) => a + (Number(n) || 0), 0) : 0;
    }, [item, values]);
    const effQty = pickTable ? pickTotal : item.qty_mode === "one" ? 1 : item.qty_mode === "sizes" ? sizesTotal : qty;
    const others = pickTable ? { ...item, fields: item.fields.filter(f => f !== pickTable && f !== brandField) } : item;
    const issue = pickTable && !pickTotal ? `Choose at least one ${pickTable.label.toLowerCase()}` : problem(others, effQty, values, files, left);

    const changeBrand = (f: PosmField, b: Brand) => {
        const next = { ...values, [f.id]: b };
        const t = item.fields.find(x => x.type === "table" && x.brand_split);
        if (t) next[t.id] = tableRows(t, b)[0]?.cells[0] ?? "";
        setValues(next);
    };

    const add = () => {
        if (issue) return;
        const clean = { ...values };
        for (const f of item.fields) if (f.type === "sizes") clean[f.id] = Object.fromEntries(Object.entries(clean[f.id] || {}).filter(([k, n]) => Number(n) > 0 && offered(f).includes(k)).map(([k, n]) => [k, Number(n)]));
        if (pickTable && brandField) {
            // One line per design picked; the other fields (remarks, photos) go with each.
            onAdd(Object.entries(picks).filter(([, n]) => n > 0).map(([key, n], i) => {
                const [b, design] = key.split(/\|(.*)/s) as [Brand, string];
                const v = { ...clean, [brandField.id]: brandField.multiple ? [b] : b, [pickTable.id]: design };
                const f = i === 0 ? files : {};
                return { item_id: item.id, item_name: item.name, qty: n, values: v, display: displayOf(item, v, f), files: f };
            }));
            return;
        }
        onAdd([{ item_id: item.id, item_name: item.name, qty: effQty, values: clean, display: displayOf(item, clean, files), files }]);
    };

    return (
        <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
            <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl p-0 gap-0">
                <div className="flex items-center gap-4 p-5 border-b border-gray-100 bg-orange-50/40">
                    <PosmArt clipart={item.clipart} image={item.image} className="h-16 w-24 shrink-0" />
                    <div className="min-w-0">
                        <DialogTitle className="text-lg font-bold text-gray-800">{item.name}</DialogTitle>
                        <DialogDescription className="text-xs text-gray-500">
                            {[item.description, limitText(item.limits)].filter(Boolean).join(" · ") || "Fill in the details"}
                        </DialogDescription>
                    </div>
                </div>

                <div className="p-5 space-y-4">
                    {pickTable && (
                        <div className="space-y-3">
                            <p className="text-xs font-semibold text-gray-600">{pickTable.label}s — set how many of each</p>
                            {brands.map(b => {
                                const rows = tableRows(pickTable, b);
                                if (!rows.length) return null;
                                return (
                                    <div key={b} className="space-y-1.5">
                                        {brands.length > 1 && <p className="text-[11px] font-black uppercase tracking-wider text-orange-600">{BRAND_LABEL[b]}</p>}
                                        <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
                                            {rows.map(r => {
                                                const k = pickKey(b, r.cells[0]);
                                                const n = picks[k] ?? 0;
                                                return (
                                                    <div key={k} className={cn("flex items-center justify-between gap-3 px-3 py-2", n > 0 && "bg-orange-50/50")}>
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-bold text-gray-800">{r.cells[0]}</p>
                                                            {r.cells.length > 1 && <p className="text-[11px] text-gray-500 truncate">{r.cells.slice(1).filter(Boolean).join(" · ")}</p>}
                                                        </div>
                                                        <Stepper label={r.cells[0]} value={n}
                                                            max={left == null ? null : left - pickTotal + n}
                                                            onChange={v => setPicks(p => ({ ...p, [k]: v }))} />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                            <p className="text-xs text-gray-500">Total: <b className="tabular-nums">{pickTotal}</b>{left != null ? ` · you can ask for ${left} more` : ""}</p>
                        </div>
                    )}

                    {item.fields.filter(f => !pickTable || (f !== pickTable && f !== brandField)).map(f => {
                        const label = <label className="text-xs font-semibold text-gray-600">{f.label}{f.required && <span className="text-red-500"> *</span>}</label>;
                        const help = f.help ? <p className="text-[11px] text-gray-400">{f.help}</p> : null;
                        const v = values[f.id];
                        switch (f.type) {
                            case "text": return <div key={f.id} className="space-y-1">{label}<Input value={v ?? ""} onChange={e => set(f.id, e.target.value)} />{help}</div>;
                            case "textarea": return <div key={f.id} className="space-y-1">{label}<Textarea rows={3} value={v ?? ""} onChange={e => set(f.id, e.target.value)} />{help}</div>;
                            case "number": return <div key={f.id} className="space-y-1 max-w-[200px]">{label}<Input type="number" min={0} value={v ?? ""} onChange={e => set(f.id, e.target.value)} />{help}</div>;
                            case "select": return (
                                <div key={f.id} className="space-y-1">{label}
                                    <Select value={offered(f).includes(v) ? v : ""} onValueChange={x => set(f.id, x)}>
                                        <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                                        <SelectContent>{offered(f).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                                    </Select>{help}
                                </div>
                            );
                            case "chips": case "brand": {
                                const opts = f.type === "brand" ? brands : offered(f);
                                // An AF or AC store orders its own brand: no choice to show (it is filled in). Only AFAC stores pick.
                                if (f.type === "brand" && opts.length === 1) return null;
                                const picked: string[] = [].concat(v ?? []);
                                return (
                                    <div key={f.id} className="space-y-1.5">{label}
                                        <div className="flex flex-wrap gap-2">
                                            {opts.map(o => {
                                                const on = picked.includes(o);
                                                return (
                                                    <button key={o} type="button" aria-pressed={on}
                                                        disabled={f.type === "brand" && opts.length === 1}
                                                        onClick={() => {
                                                            if (!f.multiple) return f.type === "brand" ? changeBrand(f, o as Brand) : set(f.id, o);
                                                            set(f.id, on ? picked.filter(x => x !== o) : [...picked, o]);
                                                        }}
                                                        className={cn("rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors",
                                                            on ? "bg-brand-orange border-brand-orange text-white" : "bg-white border-gray-200 text-gray-700 hover:border-orange-200")}>
                                                        {f.type === "brand" ? BRAND_LABEL[o as Brand] : o}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {f.multiple && opts.length > 1 && <p className="text-[11px] text-gray-400">Pick one or more{item.qty_mode === "number" ? " — the quantity is for each" : ""}</p>}
                                        {help}
                                    </div>
                                );
                            }
                            case "sizes": return (
                                <div key={f.id} className="space-y-1.5">{label}
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {offered(f).map(s => (
                                            <div key={s} className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2">
                                                <span className="font-bold text-gray-700">{s}</span>
                                                <Stepper label={`size ${s}`} value={Number(v?.[s] ?? 0)} onChange={n => set(f.id, { ...v, [s]: n })} />
                                            </div>
                                        ))}
                                    </div>{help}
                                </div>
                            );
                            case "table": {
                                const rows = tableRows(f, brandOf(item, values));
                                const row = rows.find(r => r.cells[0] === v);
                                return (
                                    <div key={f.id} className="space-y-2">{label}
                                        <Select value={v ?? ""} onValueChange={x => set(f.id, x)}>
                                            <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                                            <SelectContent>{rows.map(r => <SelectItem key={r.cells[0]} value={r.cells[0]}>{r.cells[0]}</SelectItem>)}</SelectContent>
                                        </Select>
                                        {row && (f.columns?.length ?? 0) > 1 && (
                                            <div className="grid grid-cols-3 gap-2">
                                                {(f.columns ?? []).slice(1).map((c, k) => (
                                                    <div key={c} className="rounded-xl bg-gray-50 px-3 py-2 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 truncate">{c}</p>
                                                        <p className="text-sm font-bold text-gray-800 truncate">{row.cells[k + 1] || "—"}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {help}
                                    </div>
                                );
                            }
                            case "files": {
                                const list = files[f.id] ?? [];
                                const max = f.max_files ?? 3;
                                const inputId = `posm-file-${f.id}`;
                                return (
                                    <div key={f.id} className="space-y-1.5">{label}
                                        <input id={inputId} type="file" multiple accept="image/*,application/pdf" className="hidden"
                                            onChange={e => { const fl = e.target.files; if (fl) setFiles(p => ({ ...p, [f.id]: [...list, ...Array.from(fl)].slice(0, max) })); e.target.value = ""; }} />
                                        <label htmlFor={inputId} className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 p-3 text-xs text-gray-500 cursor-pointer hover:border-orange-200">
                                            <Paperclip className="h-4 w-4" /> Add photos or PDF (up to {max})
                                        </label>
                                        {list.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {list.map((file, i) => (
                                                    <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-orange-50 text-orange-700 text-[11px] px-2 py-1 max-w-[200px]">
                                                        <span className="truncate">{file.name}</span>
                                                        <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(p => ({ ...p, [f.id]: list.filter((_, j) => j !== i) }))}><X className="h-3 w-3" /></button>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {help}
                                    </div>
                                );
                            }
                        }
                    })}

                    {item.qty_mode === "number" && !pickTable && (
                        <div className="flex items-center justify-between gap-3 pt-1">
                            <div>
                                <p className="text-xs font-semibold text-gray-600">Quantity</p>
                                {left != null && <p className="text-[11px] text-gray-400">You can ask for {left} more</p>}
                            </div>
                            <Stepper label="quantity" value={qty} min={1} max={left} onChange={setQty} />
                        </div>
                    )}
                    {item.qty_mode === "sizes" && <p className="text-xs text-gray-500">Total: <b className="tabular-nums">{sizesTotal}</b>{left != null ? ` · you can ask for ${left} more` : ""}</p>}
                </div>

                <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 flex items-center gap-3">
                    {issue && <span className="text-xs text-gray-400 mr-auto">{issue}</span>}
                    <Button type="button" variant="ghost" onClick={onClose} className={cn(!issue && "mr-auto")}>Cancel</Button>
                    <Button type="button" onClick={add} disabled={!!issue} className="bg-brand-orange hover:bg-brand-orange/90 text-white rounded-xl px-6">
                        Add to request
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
