import { useEffect, useMemo, useRef, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Car, ChevronLeft, ImagePlus, Loader2, Minus, Package, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A distributor's own details for one product it sells: the cars it fits
 * (make, model, years) and its own photos. Autoform's details are the
 * default; the distributor can keep them as they are and only update stock,
 * or add to them here. Franchises buying from this distributor see it.
 */

export interface Fitment { make: string; model: string; from: number | null; to: number | null }

/** "Hyundai Creta 2020–2024", "Tata (all models)", for a franchise to read. */
export function fitmentText(f: Fitment) {
    const years = f.from && f.to ? (f.from === f.to ? `${f.from}` : `${f.from}–${f.to}`) : f.from ? `${f.from} on` : f.to ? `up to ${f.to}` : "";
    return [f.make, f.model || "(all models)", years].filter(Boolean).join(" ");
}

/**
 * A product as a WhatsApp message: name, category, options, the cars it fits
 * and its photo (WhatsApp previews the link). Never a price; and no Maruti
 * Suzuki names, as in all text that may reach a customer.
 */
export function shareProductOnWhatsApp(p: { name: string; category?: string | null; options?: string[]; fitment?: Fitment[]; photo?: string | null }) {
    const options = (p.options ?? []).map(o => String(o ?? "").trim()).filter(o => o && o.toLowerCase() !== "default");
    const fits = (p.fitment ?? []).filter(f => !/maruti/i.test(f.make)).map(fitmentText);
    const text = [
        `*${p.name}*`,
        p.category || null,
        options.length ? `Options: ${[...new Set(options)].join(", ")}` : null,
        fits.length ? `Fits: ${fits.join(", ")}` : null,
        p.photo || null,
    ].filter(Boolean).join("\n");
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

/** Whether a product fits a car picked as "make::model" ("make::" = any model of it). */
export function fitsCar(fitment: Fitment[] | null | undefined, car: string) {
    const [make, model] = car.split("::");
    return (fitment ?? []).some(f => f.make === make && (!model || !f.model || f.model === model));
}

/** A car a franchise shops for: a make, and optionally a model and a year. */
export interface ShopCar { make: string; model: string; year: number | null }

/** Whether a product's cars include this one ("All models" and open years match too). */
export function fitsVehicle(fitment: Fitment[] | null | undefined, car: ShopCar) {
    return (fitment ?? []).some(f => f.make === car.make
        && (!car.model || !f.model || f.model === car.model)
        && (!car.year || ((f.from == null || f.from <= car.year) && (f.to == null || car.year <= f.to))));
}
export const carLabel = (c: ShopCar) => [c.make, c.model, c.year].filter(Boolean).join(" ");

let modelsOnce: Promise<Record<string, string[]>> | null = null;
const vehicleList = () => (modelsOnce ??= api.get("/orders/vehicles").then(r => r.data.models ?? {}).catch(() => { modelsOnce = null; return {}; }));

const OTHER = "__other";
const YEARS = Array.from({ length: new Date().getFullYear() + 2 - 1995 + 1 }, (_, i) => new Date().getFullYear() + 1 - i);

/** A list to pick from, with "Other" to type one that is not in it. */
function PickOrType({ label, options, value, onChange, all }: { label: string; options: string[]; value: string; onChange: (v: string) => void; all?: string }) {
    const [typing, setTyping] = useState(false);
    const listed = options.includes(value);
    if (typing || (value && !listed) || (!options.length && !all)) return (
        <div className="flex gap-1">
            <Input value={value} onChange={e => onChange(e.target.value)} placeholder={label} maxLength={60} aria-label={label} className="h-11" />
            {options.length > 0 && <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Pick from the list" onClick={() => { setTyping(false); onChange(""); }}><X className="h-4 w-4" /></Button>}
        </div>
    );
    return (
        <select value={listed ? value : ""} aria-label={label} onChange={e => { if (e.target.value === OTHER) { setTyping(true); onChange(""); } else onChange(e.target.value); }}
            className="h-11 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
            <option value="">{all ?? label}</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
            <option value={OTHER}>Other (type it)</option>
        </select>
    );
}

/** One option of the product for one car, held as its own stock, with up to 6 photos. */
interface CarRow {
    id?: string; key: string; variation_id: string | null; make: string; model: string; from: number | null; to: number | null;
    stock: string; keep: string[]; added: { file: File; url: string }[];
}
const rowKey = () => Math.random().toString(36).slice(2);
const yearsText = (from: number | null, to: number | null) =>
    from && to ? (from === to ? `${from}` : `${from}–${to}`) : from ? `${from} onwards` : to ? `Up to ${to}` : "Any year";

type CarDraft = { make: string; model: string; from: number | null; to: number | null; stock: string };
const EMPTY_DRAFT: CarDraft = { make: "", model: "", from: null, to: null, stock: "0" };

/** Make, model and years (and the stock, per car), as one small form. */
function CarForm({ value, onChange, makes, models, withStock, submitLabel, onSubmit, onCancel }: {
    value: CarDraft; onChange: (v: CarDraft) => void; makes: string[]; models: Record<string, string[]>; withStock: boolean;
    submitLabel: string; onSubmit: () => void; onCancel: () => void;
}) {
    return (
        <div className="space-y-3 rounded-2xl border-2 border-orange-200 bg-orange-50/40 p-3">
            <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1"><span className="text-xs font-semibold text-slate-600">Make</span>
                    <PickOrType label="Make" options={makes} value={value.make} onChange={v => onChange({ ...value, make: v, model: v === value.make ? value.model : "" })} /></label>
                <label className="space-y-1"><span className="text-xs font-semibold text-slate-600">Model</span>
                    <PickOrType key={value.make} label="Model" all="All models" options={models[value.make] ?? []} value={value.model} onChange={v => onChange({ ...value, model: v })} /></label>
                <label className="space-y-1"><span className="text-xs font-semibold text-slate-600">From year</span>
                    <select value={value.from ?? ""} onChange={e => onChange({ ...value, from: e.target.value ? Number(e.target.value) : null })} className="h-11 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                        <option value="">Any</option>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select></label>
                <label className="space-y-1"><span className="text-xs font-semibold text-slate-600">To year</span>
                    <select value={value.to ?? ""} onChange={e => onChange({ ...value, to: e.target.value ? Number(e.target.value) : null })} className="h-11 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                        <option value="">Any</option>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select></label>
                {withStock && (
                    <label className="col-span-2 space-y-1 sm:col-span-1"><span className="text-xs font-semibold text-slate-600">Stock</span>
                        <Input type="number" inputMode="numeric" min={0} value={value.stock} onChange={e => onChange({ ...value, stock: e.target.value })} className="h-11 bg-white" /></label>
                )}
            </div>
            <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-11 flex-1 bg-white" onClick={onCancel}>Cancel</Button>
                <Button type="button" className="h-11 flex-1 bg-orange-500 font-bold text-white hover:bg-orange-600" disabled={!value.make.trim()} onClick={onSubmit}>{submitLabel}</Button>
            </div>
        </div>
    );
}

/** − n +, big enough for a thumb. */
function StockStepper({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
    const n = Number(value) || 0;
    return (
        <div className="flex shrink-0 items-center rounded-xl border border-slate-200 bg-white">
            <button type="button" aria-label={`Less ${label}`} onClick={() => onChange(String(Math.max(0, n - 1)))} className="flex h-11 w-10 items-center justify-center text-slate-600 hover:text-orange-600"><Minus className="h-4 w-4" /></button>
            <input type="number" inputMode="numeric" min={0} value={value} onChange={e => onChange(e.target.value)} aria-label={label}
                className="h-11 w-14 border-x border-slate-200 text-center text-base font-bold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
            <button type="button" aria-label={`More ${label}`} onClick={() => onChange(String(n + 1))} className="flex h-11 w-10 items-center justify-center text-slate-600 hover:text-orange-600"><Plus className="h-4 w-4" /></button>
        </div>
    );
}

export function DistributorProductDialog({ productId, onClose, onSaved }: { productId: string | null; onClose: () => void; onSaved: () => void }) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [product, setProduct] = useState<{ name: string; brand?: string; autoform_images: string[] } | null>(null);
    const [models, setModels] = useState<Record<string, string[]>>({});
    const [fitment, setFitment] = useState<Fitment[]>([]);
    const [own, setOwn] = useState(false);
    const [kept, setKept] = useState<string[]>([]);
    const [added, setAdded] = useState<{ file: File; url: string }[]>([]);
    const fileRef = useRef<HTMLInputElement>(null);
    /* Stock the same for every car (set in the inventory), or per car (set here). */
    const [stockMode, setStockMode] = useState<"product" | "car">("product");
    const [variations, setVariations] = useState<{ id: string | null; name: string }[]>([]);
    const [cars, setCars] = useState<CarRow[]>([]);
    const [tab, setTab] = useState<string>("");
    /* The car form open: "new", a car row's key, or "fit:<n>" / "fit:new" for the cars it fits. */
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState<CarDraft>(EMPTY_DRAFT);
    const [photosOpen, setPhotosOpen] = useState<string | null>(null);
    const carFileRef = useRef<HTMLInputElement>(null);
    const [photoFor, setPhotoFor] = useState<string | null>(null);

    useEffect(() => {
        if (!productId) return;
        setLoading(true); setProduct(null); setAdded([]); setEditing(null); setPhotosOpen(null);
        vehicleList().then(setModels);
        api.get(`/orders/distributor/products/${productId}`).then(r => {
            setProduct(r.data.product); setFitment(r.data.fitment ?? []); setOwn(Boolean(r.data.own_images)); setKept(r.data.images ?? []);
            setStockMode(r.data.stock_mode === "car" ? "car" : "product");
            const vs = r.data.variations ?? [{ id: null, name: "Default" }];
            setVariations(vs);
            setTab(String(vs[0]?.id ?? ""));
            setCars((r.data.cars ?? []).map((c: any) => ({
                id: c.id, key: rowKey(), variation_id: c.variation_id ?? null, make: c.make, model: c.model ?? "", from: c.from ?? null, to: c.to ?? null,
                stock: String(c.stock ?? 0), keep: c.images ?? [], added: [],
            })));
        }).catch(e => { toast({ variant: "destructive", title: "Could not load", description: getErrorMessage(e, "") }); onClose(); })
            .finally(() => setLoading(false));
    }, [productId]);

    const makes = useMemo(() => Object.keys(models).sort((a, b) => a.localeCompare(b)), [models]);
    const mine = kept.length + added.length;
    const optionNamed = variations.length > 1 || (variations[0] && variations[0].name.toLowerCase() !== "default");
    const activeVariation = variations.find(v => String(v.id ?? "") === tab) ?? variations[0];
    const rowsOf = (variationId: string | null) => cars.filter(c => (c.variation_id ?? null) === (variationId ?? null));
    const activeRows = activeVariation ? rowsOf(activeVariation.id ?? null) : [];
    const setCar = (key: string, patch: Partial<CarRow>) => setCars(cs => cs.map(c => (c.key === key ? { ...c, ...patch } : c)));
    const sameCar = (a: { make: string; model: string; from: number | null; to: number | null }, b: typeof a) =>
        a.make === b.make && a.model === b.model && a.from === b.from && a.to === b.to;

    const addFiles = (files: FileList | null) => {
        const list = Array.from(files ?? []).filter(f => /^image\/(jpeg|png|webp)$/.test(f.type));
        const room = 8 - mine;
        if (list.length > room) toast({ title: `Up to 8 photos: ${room} more can be added` });
        setAdded(a => [...a, ...list.slice(0, Math.max(0, room)).map(file => ({ file, url: URL.createObjectURL(file) }))]);
        if (list.length && !mine) setOwn(true);
    };
    const addCarPhotos = (files: FileList | null) => {
        const row = cars.find(c => c.key === photoFor);
        if (!row) return;
        const list = Array.from(files ?? []).filter(f => /^image\/(jpeg|png|webp)$/.test(f.type));
        const room = 6 - row.keep.length - row.added.length;
        if (list.length > room) toast({ title: `Up to 6 photos a car: ${room} more can be added` });
        setCar(row.key, { added: [...row.added, ...list.slice(0, Math.max(0, room)).map(file => ({ file, url: URL.createObjectURL(file) }))] });
    };

    /* The car form: open it, and what its button does. */
    const openForm = (what: string, from?: Partial<CarDraft>) => { setEditing(what); setDraft({ ...EMPTY_DRAFT, ...from }); };
    const submitForm = () => {
        const car = { make: draft.make.trim(), model: draft.model.trim(), from: draft.from, to: draft.to };
        if (car.from && car.to && car.from > car.to) return toast({ variant: "destructive", title: "The \"from\" year is after the \"to\" year" });
        if (editing === "new") {
            if (activeRows.some(r => sameCar(r, car))) return toast({ variant: "destructive", title: "This car is already on the list" });
            setCars(cs => [...cs, { key: rowKey(), variation_id: activeVariation?.id ?? null, ...car, stock: String(Number(draft.stock) || 0), keep: [], added: [] }]);
        } else if (editing === "fit:new") {
            if (fitment.some(f => sameCar(f, car))) return toast({ variant: "destructive", title: "This car is already on the list" });
            setFitment(fs => [...fs, car]);
        } else if (editing?.startsWith("fit:")) {
            const i = Number(editing.slice(4));
            setFitment(fs => fs.map((f, j) => (j === i ? car : f)));
        } else if (editing) {
            setCar(editing, { ...car, stock: String(Number(draft.stock) || 0) });
        }
        setEditing(null);
    };
    /* The active option's cars onto every other option that lacks them, at stock 0. */
    const copyToOtherOptions = () => {
        let n = 0;
        const more: CarRow[] = [];
        for (const v of variations) {
            if ((v.id ?? null) === (activeVariation?.id ?? null)) continue;
            for (const r of activeRows) {
                if (rowsOf(v.id ?? null).some(x => sameCar(x, r))) continue;
                more.push({ key: rowKey(), variation_id: v.id ?? null, make: r.make, model: r.model, from: r.from, to: r.to, stock: "0", keep: [], added: [] });
                n++;
            }
        }
        setCars(cs => [...cs, ...more]);
        toast({ title: n ? `Added ${n} car${n === 1 ? "" : "s"} to the other options` : "The other options already have these cars", description: n ? "Their stock starts at 0." : undefined });
    };

    const save = async () => {
        if (stockMode === "car") {
            if (!cars.length) return toast({ variant: "destructive", title: "Add at least one car, or keep the same stock for every car" });
            if (cars.some(c => !/^\d+$/.test(c.stock.trim()))) return toast({ variant: "destructive", title: "Every car needs its stock, a whole number" });
        }
        setSaving(true);
        try {
            const form = new FormData();
            form.append("fitment", JSON.stringify(fitment));
            // Photos are optional: with none of its own, Autoform's are shown.
            form.append("own_images", own && mine > 0 ? "true" : "false");
            form.append("keep", JSON.stringify(kept));
            added.forEach(a => form.append("photos", a.file));
            form.append("stock_mode", stockMode);
            if (stockMode === "car") {
                form.append("cars", JSON.stringify(cars.map(c => ({ id: c.id, variation_id: c.variation_id, make: c.make, model: c.model, from: c.from, to: c.to, stock: Number(c.stock), keep: c.keep }))));
                cars.forEach((c, i) => c.added.forEach(a => form.append(`car_${i}`, a.file)));
            }
            await api.put(`/orders/distributor/products/${productId}`, form, { headers: { "Content-Type": "multipart/form-data" } });
            toast({ title: "Saved", description: "Franchises buying from you see this now." });
            onSaved(); onClose();
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again") });
        } finally { setSaving(false); }
    };

    const Thumb = ({ src, onRemove, onFirst, small }: { src: string; onRemove?: () => void; onFirst?: () => void; small?: boolean }) => (
        <div className={cn("relative shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white", small ? "h-16 w-16" : "h-24 w-24")}>
            <img src={src} alt="" className="h-full w-full object-contain p-1" />
            {onFirst && <button type="button" onClick={onFirst} aria-label="Move earlier" className="absolute bottom-1 left-1 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 shadow"><ChevronLeft className="h-4 w-4" /></button>}
            {onRemove && <button type="button" onClick={onRemove} aria-label="Remove photo" className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-rose-600 shadow"><X className="h-4 w-4" /></button>}
        </div>
    );
    const cover = (own && kept[0]) || added[0]?.url || product?.autoform_images[0];
    const sectionTitle = "text-xs font-black uppercase tracking-wider text-slate-500";

    return (
        <Dialog open={!!productId} onOpenChange={o => { if (!o && !saving) onClose(); }}>
            <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[92vh] sm:rounded-2xl">
                <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b border-slate-100 px-5 py-4 pr-12 text-left">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
                        {cover ? <img src={cover} alt="" className="h-full w-full object-contain p-1" /> : <Package className="h-6 w-6 text-slate-300" />}
                    </span>
                    <div className="min-w-0">
                        <DialogTitle className="truncate text-lg font-black">{product?.name ?? "Product"}</DialogTitle>
                        <DialogDescription className="text-xs">Your stock, the cars it fits and your photos. Franchises buying from you see them.</DialogDescription>
                    </div>
                </DialogHeader>

                <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5">
                    {loading || !product ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div> : <>
                        <section className="space-y-2">
                            <h3 className={sectionTitle}>How do you stock it?</h3>
                            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
                                {([["product", "Same for every car"], ["car", "Different for each car"]] as const).map(([v, label]) => (
                                    <button key={v} type="button" onClick={() => { setStockMode(v); setEditing(null); }} aria-pressed={stockMode === v}
                                        className={cn("min-h-[48px] rounded-xl px-2 text-sm font-bold", stockMode === v ? "bg-white text-slate-900 shadow" : "text-slate-600")}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-slate-500">{stockMode === "car" ? "Each car gets its own stock and photos. Franchises pick their car when ordering." : "You set the stock in your inventory, as now."}</p>
                        </section>

                        {stockMode === "car" ? (
                            <section className="space-y-3">
                                <input ref={carFileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => { addCarPhotos(e.target.files); e.target.value = ""; }} />
                                {optionNamed && variations.length > 1 && (
                                    <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1" role="tablist" aria-label="Options">
                                        {variations.map(v => {
                                            const on = String(v.id ?? "") === tab;
                                            const n = rowsOf(v.id ?? null).length;
                                            return (
                                                <button key={v.id ?? "default"} type="button" role="tab" aria-selected={on} onClick={() => { setTab(String(v.id ?? "")); setEditing(null); }}
                                                    className={cn("min-h-[40px] shrink-0 rounded-full border px-4 text-sm font-bold", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700")}>
                                                    {v.name}<span className={cn("ml-1.5 text-xs", on ? "text-white/70" : "text-slate-400")}>{n}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                <div className="flex items-baseline justify-between gap-2">
                                    <h3 className={sectionTitle}>Cars{optionNamed ? ` · ${activeVariation?.name}` : ""}</h3>
                                    <span className="text-xs font-semibold text-slate-500">{activeRows.reduce((n, r) => n + (Number(r.stock) || 0), 0)} in stock</span>
                                </div>

                                {!activeRows.length && editing !== "new" && (
                                    <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No cars yet{optionNamed ? ` for ${activeVariation?.name}` : ""}.</p>
                                )}
                                {activeRows.map(r => editing === r.key ? (
                                    <CarForm key={r.key} value={draft} onChange={setDraft} makes={makes} models={models} withStock submitLabel="Done" onSubmit={submitForm} onCancel={() => setEditing(null)} />
                                ) : (
                                    <div key={r.key} className="rounded-2xl border border-slate-200 bg-white">
                                        <div className="flex items-center gap-3 p-3">
                                            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-50">
                                                {(r.added[0]?.url ?? r.keep[0]) ? <img src={r.added[0]?.url ?? r.keep[0]} alt="" className="h-full w-full object-contain p-0.5" /> : <Car className="h-5 w-5 text-slate-300" />}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate font-bold text-slate-900">{r.make} {r.model || "· All models"}</p>
                                                <p className="text-xs text-slate-500">{yearsText(r.from, r.to)}</p>
                                            </div>
                                            <StockStepper value={r.stock} onChange={v => setCar(r.key, { stock: v })} label={`stock for ${r.make} ${r.model}`} />
                                        </div>
                                        <div className="flex items-center gap-1 border-t border-slate-100 px-2 py-1">
                                            <Button type="button" variant="ghost" className="h-10 text-xs font-bold text-slate-600" onClick={() => setPhotosOpen(photosOpen === r.key ? null : r.key)}>
                                                <ImagePlus className="mr-1.5 h-4 w-4" />Photos ({r.keep.length + r.added.length})
                                            </Button>
                                            <Button type="button" variant="ghost" className="h-10 text-xs font-bold text-slate-600" onClick={() => openForm(r.key, { ...r })}>
                                                <Pencil className="mr-1.5 h-4 w-4" />Edit car
                                            </Button>
                                            <Button type="button" variant="ghost" size="icon" className="ml-auto h-10 w-10 text-rose-600" aria-label={`Remove ${r.make} ${r.model}`}
                                                onClick={() => setCars(cs => cs.filter(x => x.key !== r.key))}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                        {photosOpen === r.key && (
                                            <div className="flex flex-wrap gap-2 border-t border-slate-100 p-3">
                                                {r.keep.map(u => <Thumb small key={u} src={u} onRemove={() => setCar(r.key, { keep: r.keep.filter(x => x !== u) })} />)}
                                                {r.added.map(a => <Thumb small key={a.url} src={a.url} onRemove={() => { URL.revokeObjectURL(a.url); setCar(r.key, { added: r.added.filter(x => x !== a) }); }} />)}
                                                {r.keep.length + r.added.length < 6 && (
                                                    <button type="button" onClick={() => { setPhotoFor(r.key); carFileRef.current?.click(); }}
                                                        className="flex h-16 w-16 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-[11px] font-semibold text-slate-600 hover:border-orange-400">
                                                        <ImagePlus className="h-5 w-5" />Add
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {editing === "new" ? (
                                    <CarForm value={draft} onChange={setDraft} makes={makes} models={models} withStock submitLabel="Add car" onSubmit={submitForm} onCancel={() => setEditing(null)} />
                                ) : (
                                    <Button type="button" variant="outline" className="h-12 w-full rounded-xl border-dashed text-sm font-bold" onClick={() => openForm("new")}>
                                        <Plus className="mr-1.5 h-4 w-4" />Add a car{optionNamed ? ` for ${activeVariation?.name}` : ""}
                                    </Button>
                                )}
                                {variations.length > 1 && activeRows.length > 0 && (
                                    <button type="button" onClick={copyToOtherOptions} className="w-full py-1 text-center text-sm font-bold text-orange-700 hover:underline">
                                        Copy these cars to the other options
                                    </button>
                                )}
                            </section>
                        ) : (
                            <section className="space-y-3">
                                <h3 className={sectionTitle}>Cars it fits <span className="normal-case tracking-normal text-slate-400">(optional)</span></h3>
                                {fitment.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {fitment.map((f, i) => editing === `fit:${i}` ? null : (
                                            <span key={i} className="flex items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-800">
                                                <button type="button" onClick={() => openForm(`fit:${i}`, f)} className="min-h-[40px] pl-3 pr-1">{fitmentText(f)}</button>
                                                <button type="button" aria-label={`Remove ${fitmentText(f)}`} onClick={() => setFitment(fs => fs.filter((_, j) => j !== i))}
                                                    className="mr-1 flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-200"><X className="h-4 w-4" /></button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {editing?.startsWith("fit:") ? (
                                    <CarForm value={draft} onChange={setDraft} makes={makes} models={models} withStock={false} submitLabel={editing === "fit:new" ? "Add car" : "Done"} onSubmit={submitForm} onCancel={() => setEditing(null)} />
                                ) : (
                                    <Button type="button" variant="outline" className="h-12 w-full rounded-xl border-dashed text-sm font-bold" onClick={() => openForm("fit:new")}>
                                        <Plus className="mr-1.5 h-4 w-4" />Add a car it fits
                                    </Button>
                                )}
                            </section>
                        )}

                        <section className="space-y-3">
                            <h3 className={sectionTitle}>{stockMode === "car" ? "Product photos (for cars with none)" : "Photos"}</h3>
                            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
                                {([[false, `Autoform's (${product.autoform_images.length})`], [true, `Mine (${mine})`]] as const).map(([v, label]) => (
                                    <button key={label} type="button" onClick={() => setOwn(v)} aria-pressed={own === v}
                                        className={cn("min-h-[44px] rounded-xl text-sm font-bold", own === v ? "bg-white text-slate-900 shadow" : "text-slate-600")}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                            {!own ? (
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {product.autoform_images.length ? product.autoform_images.map(u => <Thumb key={u} src={u} />) : <p className="text-sm text-slate-500">Autoform has no photo of this product.</p>}
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {kept.map((u, i) => <Thumb key={u} src={u} onRemove={() => setKept(k => k.filter(x => x !== u))}
                                        onFirst={i > 0 ? () => setKept(k => { const n = [...k]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; }) : undefined} />)}
                                    {added.map(a => <Thumb key={a.url} src={a.url} onRemove={() => { URL.revokeObjectURL(a.url); setAdded(x => x.filter(y => y !== a)); }} />)}
                                    {mine < 8 && (
                                        <button type="button" onClick={() => fileRef.current?.click()}
                                            className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-xs font-semibold text-slate-600 hover:border-orange-400">
                                            <ImagePlus className="h-6 w-6" />Add
                                        </button>
                                    )}
                                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
                                </div>
                            )}
                            {own && <p className="text-xs text-slate-500">Optional, up to 8. The first is shown on the product card.</p>}
                        </section>
                    </>}
                </div>

                <DialogFooter className="flex-row gap-2 border-t border-slate-100 bg-white px-5 py-3">
                    <Button variant="outline" className="h-12 flex-1 sm:flex-none" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button className="h-12 flex-1 bg-orange-500 font-bold text-white hover:bg-orange-600 sm:flex-none sm:px-8" onClick={save} disabled={saving || loading || !product || editing !== null}>
                        {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
