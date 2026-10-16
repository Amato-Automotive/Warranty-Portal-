import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    BRAND_LABEL, FIELD_TYPE_LABEL, QTY_MODE_LABEL, limitText,
    type Brand, type FieldType, type PosmCatalog, type PosmField, type PosmItem, type QtyMode,
} from "@/lib/posm";
import { CLIPART_KEYS, PosmArt, clipartLabel } from "@/components/posm/posmClipart";

const move = <T,>(list: T[], i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const out = [...list];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
};
const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
const blankField = (type: FieldType): PosmField => ({
    id: newId("f"), label: FIELD_TYPE_LABEL[type], type, required: false,
    ...(type === "select" || type === "chips" ? { options: ["Option 1"] } : {}),
    ...(type === "sizes" ? { options: ["S", "M", "L", "XL", "XXL"] } : {}),
    ...(type === "files" ? { max_files: 3 } : {}),
    ...(type === "table" ? { columns: ["Design", "Colour"], rows: [], brand_split: false } : {}),
    ...(type === "textarea" ? { label: "Remarks for the team" } : {}),
});
const blankItem = (): PosmItem => ({
    id: newId("item"), name: "New item", description: "", clipart: "box", image: null,
    enabled: false, qty_mode: "number", limits: { min: 1 }, fields: [],
});

/* A comma or new-line list, edited as text. */
const ListInput = ({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) => {
    const [text, setText] = useState(value.join(", "));
    useEffect(() => setText(value.join(", ")), [value.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
    return <Input value={text} placeholder={placeholder} onChange={e => setText(e.target.value)}
        onBlur={() => onChange(text.split(/[,\n]/).map(s => s.trim()).filter(Boolean))} className="h-9 text-sm" />;
};

const numOrNull = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v)) || 0));

/**
 * The admin's POSM item builder: add, edit, reorder, switch off and delete
 * items; set their picture, how the quantity is asked, limits per request,
 * month and year, and the fields the store fills. Saved as one catalog.
 */
export function POSMItemBuilder() {
    const { toast } = useToast();
    const [items, setItems] = useState<PosmItem[] | null>(null);
    const [savedJson, setSavedJson] = useState("");
    const [cur, setCur] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [tableBrand, setTableBrand] = useState<Brand>("AF");
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        api.get("/posm/catalog").then(r => {
            const c: PosmCatalog = r.data.data.catalog;
            setItems(c.items); setSavedJson(JSON.stringify(c.items)); setCur(c.items[0]?.id ?? null);
        }).catch(e => toast({ variant: "destructive", title: "Could not load the POSM items", description: getErrorMessage(e, "") }));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const dirty = items != null && JSON.stringify(items) !== savedJson;
    const item = items?.find(i => i.id === cur) ?? null;
    const idx = items?.findIndex(i => i.id === cur) ?? -1;
    const patch = (p: Partial<PosmItem>) => setItems(list => list!.map(i => i.id === cur ? { ...i, ...p } : i));
    const patchField = (fi: number, p: Partial<PosmField>) => item && patch({ fields: item.fields.map((f, j) => j === fi ? { ...f, ...p } : f) });
    const hasBrandField = useMemo(() => !!item?.fields.some(f => f.type === "brand"), [item]);

    useEffect(() => setConfirmDelete(false), [cur]);

    const save = async () => {
        if (!items) return;
        setSaving(true);
        try {
            const r = await api.put("/posm/admin/catalog", { catalog: { items } });
            const saved: PosmItem[] = r.data.data.catalog.items;
            setItems(saved); setSavedJson(JSON.stringify(saved));
            if (!saved.some(i => i.id === cur)) setCur(saved[idx]?.id ?? saved[0]?.id ?? null);
            toast({ title: "POSM items saved", description: "Stores see the change on their next visit. Requests already sent stay as they are." });
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again.") });
        } finally {
            setSaving(false);
        }
    };

    const uploadImage = async (file: File) => {
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("image", file);
            const r = await api.post("/posm/admin/catalog/image", fd, { headers: { "Content-Type": "multipart/form-data" } });
            patch({ image: r.data.data.url });
        } catch (e) {
            toast({ variant: "destructive", title: "Picture not uploaded", description: getErrorMessage(e, "Try a JPG or PNG.") });
        } finally {
            setUploading(false);
        }
    };

    if (!items) return <div className="flex justify-center p-12"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-50 bg-white p-4">
                <div>
                    <p className="font-black text-slate-800">POSM items</p>
                    <p className="text-xs text-slate-500">What stores can order, its fields and limits. Changes apply when you save.</p>
                </div>
                <div className="flex items-center gap-2">
                    {dirty && <span className="text-xs font-semibold text-amber-600">Unsaved changes</span>}
                    {dirty && <Button variant="outline" onClick={() => { const s: PosmItem[] = JSON.parse(savedJson); setItems(s); if (!s.some(i => i.id === cur)) setCur(s[0]?.id ?? null); }} disabled={saving}>Discard</Button>}
                    <Button onClick={save} disabled={!dirty || saving} className="bg-orange-600 hover:bg-orange-700">
                        {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Save changes
                    </Button>
                </div>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] gap-4 items-start">
                {/* The items */}
                <div className="rounded-2xl border border-orange-50 bg-white overflow-hidden">
                    <div className="p-3 flex items-center justify-between border-b border-slate-100">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{items.length} items · order stores see</p>
                        <Button size="sm" variant="outline" onClick={() => { const n = blankItem(); setItems([...items, n]); setCur(n.id); }}>
                            <Plus className="h-3.5 w-3.5 mr-1" /> New item
                        </Button>
                    </div>
                    <div className="divide-y divide-slate-50">
                        {items.map((it, i) => (
                            <div key={it.id} className={cn("flex items-center gap-2 p-2.5 pr-3", it.id === cur ? "bg-orange-50/70" : "hover:bg-slate-50")}>
                                <div className="flex flex-col">
                                    <button type="button" aria-label={`Move ${it.name} up`} disabled={i === 0} onClick={() => setItems(move(items, i, -1))} className="text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                                    <button type="button" aria-label={`Move ${it.name} down`} disabled={i === items.length - 1} onClick={() => setItems(move(items, i, 1))} className="text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                                </div>
                                <button type="button" onClick={() => setCur(it.id)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
                                    <PosmArt clipart={it.clipart} image={it.image} className="h-9 w-12 shrink-0" />
                                    <span className="min-w-0">
                                        <span className={cn("block text-sm font-bold truncate", it.enabled ? "text-slate-800" : "text-slate-400")}>{it.name}</span>
                                        <span className="block text-[11px] text-slate-400 truncate">
                                            {it.enabled ? "" : "Hidden · "}{it.fields.length} field{it.fields.length === 1 ? "" : "s"}{limitText(it.limits) ? ` · ${limitText(it.limits)}` : ""}
                                        </span>
                                    </span>
                                </button>
                                <Switch checked={it.enabled} aria-label={`Show ${it.name} to stores`}
                                    onCheckedChange={v => setItems(items.map(x => x.id === it.id ? { ...x, enabled: v } : x))} />
                            </div>
                        ))}
                    </div>
                </div>

                {/* One item */}
                {item ? (
                    <div className="rounded-2xl border border-orange-50 bg-white p-5 space-y-6 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-lg font-black text-slate-800">{item.name}</p>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => {
                                    const copy = { ...structuredClone(item), id: newId("item"), name: `${item.name} (copy)`, enabled: false };
                                    const list = [...items]; list.splice(idx + 1, 0, copy); setItems(list); setCur(copy.id);
                                }}><Copy className="h-3.5 w-3.5 mr-1" /> Duplicate</Button>
                                {confirmDelete ? (
                                    <>
                                        <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>Keep it</Button>
                                        <Button size="sm" className="bg-red-600 hover:bg-red-700" onClick={() => {
                                            const list = items.filter(i => i.id !== item.id); setItems(list); setCur(list[Math.max(0, idx - 1)]?.id ?? null);
                                        }}>Delete {item.name}</Button>
                                    </>
                                ) : (
                                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setConfirmDelete(true)}>
                                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                                    </Button>
                                )}
                            </div>
                        </div>
                        {confirmDelete && <p className="text-xs text-red-600 -mt-4">Stores can no longer order it once you save. Requests already sent keep it. To stop it for a while, switch it off instead.</p>}

                        {/* Basics and picture */}
                        <section className="grid md:grid-cols-[minmax(0,1fr)_220px] gap-5">
                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <label htmlFor="pb-name" className="text-xs font-semibold text-slate-500">Name</label>
                                    <Input id="pb-name" value={item.name} onChange={e => patch({ name: e.target.value })} />
                                </div>
                                <div className="space-y-1">
                                    <label htmlFor="pb-desc" className="text-xs font-semibold text-slate-500">Short description on the card</label>
                                    <Textarea id="pb-desc" rows={2} value={item.description ?? ""} onChange={e => patch({ description: e.target.value })} />
                                </div>
                                <div className="flex items-center gap-3">
                                    <Switch id="pb-on" checked={item.enabled} onCheckedChange={v => patch({ enabled: v })} />
                                    <label htmlFor="pb-on" className="text-sm text-slate-600">{item.enabled ? "Shown to stores" : "Hidden from stores"}</label>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-500">Picture</p>
                                <div className="aspect-[3/2] rounded-xl bg-gradient-to-br from-orange-50 to-amber-50/40 grid place-items-center relative">
                                    <PosmArt clipart={item.clipart} image={item.image} className="h-[75%] w-[75%]" />
                                    {item.image && (
                                        <button type="button" aria-label="Remove the picture" onClick={() => patch({ image: null })}
                                            className="absolute top-1.5 right-1.5 rounded-full bg-white/90 p-1 text-slate-500 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                                    )}
                                </div>
                                <div className="grid grid-cols-6 gap-1">
                                    {CLIPART_KEYS.map(k => (
                                        <button key={k} type="button" title={clipartLabel(k)} aria-label={`Clip art: ${clipartLabel(k)}`}
                                            onClick={() => patch({ clipart: k, image: null })}
                                            className={cn("rounded-lg p-0.5 border", !item.image && item.clipart === k ? "border-orange-400 bg-orange-50" : "border-transparent hover:bg-slate-50")}>
                                            <PosmArt clipart={k} className="h-6 w-full" />
                                        </button>
                                    ))}
                                </div>
                                <input id="pb-image" type="file" accept="image/*" className="hidden"
                                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }} />
                                <label htmlFor="pb-image" className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 py-1.5 text-xs text-slate-500 cursor-pointer hover:border-orange-200">
                                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Upload a photo instead
                                </label>
                            </div>
                        </section>

                        {/* Quantity and limits */}
                        <section className="space-y-2">
                            <p className="text-sm font-black text-slate-800">Quantity & limits</p>
                            <p className="text-xs text-slate-500">Counted per store. Leave a limit empty for none. Waiting and approved requests count; rejected ones don't.</p>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                <div className="space-y-1 col-span-2 md:col-span-1">
                                    <label className="text-xs font-semibold text-slate-500">Quantity asked as</label>
                                    <Select value={item.qty_mode} onValueChange={v => patch({ qty_mode: v as QtyMode })}>
                                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                        <SelectContent>{(Object.keys(QTY_MODE_LABEL) as QtyMode[]).map(m => <SelectItem key={m} value={m}>{QTY_MODE_LABEL[m]}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                                {([["min", "Min per request"], ["max_request", "Max per request"], ["max_month", "Max per month"], ["max_year", "Max per year"]] as const).map(([k, l]) => (
                                    <div key={k} className="space-y-1">
                                        <label htmlFor={`pb-${k}`} className="text-xs font-semibold text-slate-500">{l}</label>
                                        <Input id={`pb-${k}`} type="number" min={0} placeholder="No limit" value={item.limits[k] ?? ""} className="h-9"
                                            onChange={e => patch({ limits: { ...item.limits, [k]: numOrNull(e.target.value) } })} />
                                    </div>
                                ))}
                            </div>
                            {item.qty_mode === "sizes" && !item.fields.some(f => f.type === "sizes") && (
                                <p className="text-xs font-semibold text-amber-600">"Sum of sizes" needs a Sizes field below.</p>
                            )}
                        </section>

                        {/* Fields */}
                        <section className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-black text-slate-800">Fields the store fills</p>
                                <Select value="" onValueChange={v => patch({ fields: [...item.fields, blankField(v as FieldType)] })}>
                                    <SelectTrigger className="h-9 w-[220px]"><SelectValue placeholder="+ Add a field" /></SelectTrigger>
                                    <SelectContent>{(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map(t => <SelectItem key={t} value={t}>{FIELD_TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            {item.fields.length === 0 && <p className="text-xs text-slate-400">No fields: the store only picks a quantity on the card.</p>}
                            {item.fields.map((f, fi) => (
                                <div key={f.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="flex">
                                            <button type="button" aria-label="Move field up" disabled={fi === 0} onClick={() => patch({ fields: move(item.fields, fi, -1) })} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                                            <button type="button" aria-label="Move field down" disabled={fi === item.fields.length - 1} onClick={() => patch({ fields: move(item.fields, fi, 1) })} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                                        </div>
                                        <span className="text-[10px] font-black uppercase tracking-wide text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">{FIELD_TYPE_LABEL[f.type]}</span>
                                        <Input value={f.label} onChange={e => patchField(fi, { label: e.target.value })} className="h-8 text-sm flex-1 min-w-[160px]" aria-label="Field label" />
                                        <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                            <Switch checked={f.required} onCheckedChange={v => patchField(fi, { required: v })} aria-label="Required" /> Required
                                        </label>
                                        <button type="button" aria-label={`Remove ${f.label}`} onClick={() => patch({ fields: item.fields.filter((_, j) => j !== fi) })} className="p-1 text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                                    </div>
                                    <Input value={f.help ?? ""} onChange={e => patchField(fi, { help: e.target.value })} placeholder="Help text under the field (optional)" className="h-8 text-xs" />
                                    {(f.type === "select" || f.type === "chips" || f.type === "sizes") && (
                                        <div className="space-y-1">
                                            <p className="text-[11px] font-semibold text-slate-500">{f.type === "sizes" ? "Sizes" : "Choices"} (comma-separated)</p>
                                            <ListInput value={f.options ?? []} onChange={v => patchField(fi, { options: v })} />
                                        </div>
                                    )}
                                    {(f.type === "chips" || f.type === "brand") && (
                                        <label className="flex items-center gap-2 text-xs text-slate-600">
                                            <Switch checked={!!f.multiple} onCheckedChange={v => patchField(fi, { multiple: v })} />
                                            {f.type === "brand" ? "Store may pick both brands (AF + AC stores)" : "Store may pick several"}
                                        </label>
                                    )}
                                    {f.type === "brand" && <p className="text-[11px] text-slate-400">Stores see only the brands they sell.</p>}
                                    {f.type === "files" && (
                                        <div className="flex items-center gap-2 text-xs text-slate-600">
                                            Up to <Input type="number" min={1} max={10} value={f.max_files ?? 3} onChange={e => patchField(fi, { max_files: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} className="h-8 w-16" aria-label="Most files" /> files
                                        </div>
                                    )}
                                    {f.type === "table" && (
                                        <div className="space-y-2">
                                            <div className="space-y-1">
                                                <p className="text-[11px] font-semibold text-slate-500">Columns (comma-separated). The store picks from the first; the rest fill in.</p>
                                                <ListInput value={f.columns ?? []} onChange={v => patchField(fi, { columns: v, rows: (f.rows ?? []).map(r => ({ ...r, cells: v.map((_, k) => r.cells[k] ?? "") })) })} />
                                            </div>
                                            <label className="flex items-center gap-2 text-xs text-slate-600">
                                                <Switch checked={!!f.brand_split} onCheckedChange={v => patchField(fi, { brand_split: v, rows: (f.rows ?? []).map(r => ({ ...r, brand: r.brand ?? (v ? "AF" : null) })) })} />
                                                Separate rows per brand (the store sees the rows of the brand it picks)
                                            </label>
                                            {f.brand_split && !hasBrandField && <p className="text-[11px] font-semibold text-amber-600">Add a Brand field to this item for this to work.</p>}
                                            {f.brand_split && (
                                                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs font-semibold bg-white">
                                                    {(["AF", "AC"] as Brand[]).map(b => (
                                                        <button key={b} type="button" onClick={() => setTableBrand(b)}
                                                            className={cn("px-3 py-1 rounded-md", tableBrand === b ? "bg-slate-800 text-white" : "text-slate-500")}>
                                                            {BRAND_LABEL[b]} ({(f.rows ?? []).filter(r => r.brand === b).length})
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="overflow-x-auto rounded-lg border border-slate-100 bg-white">
                                                <table className="w-full text-xs min-w-[480px]">
                                                    <thead>
                                                        <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                                                            {(f.columns ?? []).map(c => <th key={c} className="text-left p-2">{c}</th>)}
                                                            {f.brand_split && <th className="text-left p-2">Brand</th>}
                                                            <th className="w-8" />
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(f.rows ?? []).map((r, ri) => (!f.brand_split || (r.brand ?? "AF") === tableBrand) && (
                                                            <tr key={ri} className="border-b border-slate-50">
                                                                {(f.columns ?? []).map((_, ci) => (
                                                                    <td key={ci} className="p-1">
                                                                        <Input value={r.cells[ci] ?? ""} className="h-8 text-xs" aria-label={`Row ${ri + 1} ${f.columns?.[ci]}`}
                                                                            onChange={e => patchField(fi, { rows: (f.rows ?? []).map((x, k) => k === ri ? { ...x, cells: x.cells.map((c, m) => m === ci ? e.target.value : c) } : x) })} />
                                                                    </td>
                                                                ))}
                                                                {f.brand_split && (
                                                                    <td className="p-1">
                                                                        <select aria-label={`Brand of ${r.cells[0] || "row " + (ri + 1)}`} value={r.brand ?? "AF"}
                                                                            onChange={e => patchField(fi, { rows: (f.rows ?? []).map((x, k) => k === ri ? { ...x, brand: e.target.value as Brand } : x) })}
                                                                            className="h-8 rounded-md border border-slate-200 bg-white px-1.5 text-xs">
                                                                            {(["AF", "AC"] as Brand[]).map(b => <option key={b} value={b}>{BRAND_LABEL[b]}</option>)}
                                                                        </select>
                                                                    </td>
                                                                )}
                                                                <td className="p-1 text-center">
                                                                    <button type="button" aria-label="Remove row" onClick={() => patchField(fi, { rows: (f.rows ?? []).filter((_, k) => k !== ri) })} className="text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <Button type="button" variant="outline" size="sm"
                                                onClick={() => patchField(fi, { rows: [...(f.rows ?? []), { ...(f.brand_split ? { brand: tableBrand } : {}), cells: (f.columns ?? []).map(() => "") }] })}>
                                                <Plus className="h-3.5 w-3.5 mr-1" /> Add a row{f.brand_split ? ` (${BRAND_LABEL[tableBrand]})` : ""}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </section>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">Add an item to start.</div>
                )}
            </div>
        </div>
    );
}
