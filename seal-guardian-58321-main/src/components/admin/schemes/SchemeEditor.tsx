import { useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, ArrowUp, ArrowDown, ImagePlus, X, Search, Repeat, CalendarPlus } from "lucide-react";
import {
    CATEGORY_LABEL, FIELD_TYPE_LABEL, FORMAT_LABEL, nextMonthWindow,
    type Scheme, type SchemeWindow, type ProductPoints, type Club, type SchemeContact, type SchemeField, type FieldType, type FileFormat, type RewardRule, type ScoreRule, type Eligibility, type SchemeCategory,
} from "@/lib/schemes";
import { ProductPointsPicker } from "./ProductPointsPicker";
import { ClubsEditor } from "./ClubsEditor";

/**
 * Create or edit a scheme: basics, dates, who it is for, what stores submit
 * (a small form builder), how it scores, what it pays, and what the store
 * reads. The server checks it all again before saving.
 */

const INDIAN_STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
    "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

const newId = () => `f_${Math.random().toString(36).slice(2, 8)}`;

type Draft = {
    title: string; category: SchemeCategory; summary: string; banner_url: string;
    windows: SchemeWindow[];
    eligibility: Eligibility; fields: SchemeField[]; entries_per_store: "one" | "many";
    score_rule: ScoreRule; rewards: RewardRule; instructions: string; terms: string;
    leaderboard: { show: boolean; names: boolean };
    clubs: Club[];
    contact: SchemeContact;
};

const blank = (): Draft => ({
    title: "", category: "sales", summary: "", banner_url: "",
    windows: [{ start: "", end: "" }],
    eligibility: { mode: "all", states: [], store_ids: [], brand: null },
    fields: [
        { id: newId(), label: "Quantity sold", type: "number", required: true },
        { id: newId(), label: "Invoice photo", type: "file", required: true, formats: ["image", "pdf"], max_files: 3, max_mb: 10 },
    ],
    entries_per_store: "many",
    score_rule: { mode: "none" },
    rewards: { mode: "none" },
    instructions: "", terms: "",
    leaderboard: { show: true, names: false },
    clubs: [],
    contact: { name: "", role: "", phone: "", email: "" },
});

const fromScheme = (s: Scheme): Draft => ({
    title: s.title, category: s.category, summary: s.summary ?? "", banner_url: s.banner_url ?? "",
    windows: s.windows?.length ? s.windows : [{ start: "", end: "" }],
    eligibility: { states: [], store_ids: [], brand: null, ...s.eligibility },
    fields: s.fields, entries_per_store: s.entries_per_store,
    score_rule: s.score_rule, rewards: s.rewards,
    instructions: s.instructions ?? "", terms: s.terms ?? "", leaderboard: s.leaderboard, clubs: s.clubs ?? [],
    contact: s.contact ?? { name: "", role: "", phone: "", email: "" },
});

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
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

export function SchemeEditor({ open, scheme, onClose, onSaved }: {
    open: boolean; scheme: Scheme | null; onClose: () => void; onSaved: (s: Scheme) => void;
}) {
    const { toast } = useToast();
    const [d, setD] = useState<Draft>(blank);
    const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
    const [problems, setProblems] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);
    const [stores, setStores] = useState<{ id: string; store_name: string; city: string | null; state: string | null }[]>([]);
    const [storeSearch, setStoreSearch] = useState("");
    /* "Add dates": a list of days, each a window at the same times. */
    const [datesOpen, setDatesOpen] = useState(false);
    const [dateDraft, setDateDraft] = useState("");
    const [dateList, setDateList] = useState<string[]>([]);
    const [dateTimes, setDateTimes] = useState({ open: "00:00", close: "23:59" });

    useEffect(() => {
        if (!open) return;
        setD(scheme ? fromScheme(scheme) : blank());
        setProblems([]);
        setStoreSearch("");
    }, [open, scheme]);

    useEffect(() => {
        if (!open || d.eligibility.mode !== "stores" || stores.length) return;
        api.get("/schemes/admin/stores").then(r => setStores(r.data.stores || [])).catch(() => setStores([]));
    }, [open, d.eligibility.mode, stores.length]);

    const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }));
    const setField = (i: number, patch: Partial<SchemeField>) =>
        set("fields", d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    const moveField = (i: number, by: number) => {
        const next = [...d.fields]; const [f] = next.splice(i, 1); next.splice(i + by, 0, f); set("fields", next);
    };
    const numberFields = d.fields.filter(f => f.type === "number");
    const isPublished = scheme && scheme.status !== "draft";
    const hasScore = d.score_rule.mode !== "none";

    const shownStores = useMemo(() => {
        const q = storeSearch.trim().toLowerCase();
        return stores.filter(s => !q || [s.store_name, s.city, s.state].some(v => String(v ?? "").toLowerCase().includes(q))).slice(0, 200);
    }, [stores, storeSearch]);

    const uploadBanner = async (file: File) => {
        setUploading(true);
        try {
            const form = new FormData();
            form.append("banner", file);
            const r = await api.post("/schemes/admin/banner", form, { headers: { "Content-Type": "multipart/form-data" } });
            set("banner_url", r.data.url);
        } catch (e) {
            toast({ title: "Could not upload the banner", description: getErrorMessage(e, "Try another image"), variant: "destructive" });
        } finally { setUploading(false); }
    };

    const save = async (publish: boolean) => {
        setSaving(publish ? "publish" : "draft");
        setProblems([]);
        try {
            const body = { ...d, windows: d.windows.filter(w => w.start || w.end), clubs: hasScore ? d.clubs : [], publish };
            const r = scheme
                ? await api.put(`/schemes/admin/${scheme.id}`, body)
                : await api.post("/schemes/admin", body);
            toast({
                title: publish ? "Scheme published" : "Scheme saved",
                description: publish
                    ? (r.data.notified ? `${r.data.notified} stores were notified.` : "Stores will see it in Offers & Schemes.")
                    : "Saved as it is. Stores see it once it's published.",
            });
            onSaved(r.data.scheme);
        } catch (e: any) {
            const list = e?.response?.data?.problems;
            setProblems(Array.isArray(list) && list.length ? list : [getErrorMessage(e, "Could not save")]);
        } finally { setSaving(null); }
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!o && !saving) onClose(); }}>
            <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{scheme ? "Edit scheme" : "New scheme"}</DialogTitle>
                    <DialogDescription>
                        {isPublished ? "This scheme is live for stores. Changes apply straight away." : "Save as a draft until it's ready, then publish."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <Section title="Basics">
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
                            <div className="space-y-1">
                                <Label htmlFor="s-title" className="text-xs font-semibold text-slate-700">Title</Label>
                                <Input id="s-title" value={d.title} onChange={e => set("title", e.target.value)} placeholder="Diwali Sales Target" maxLength={160} />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs font-semibold text-slate-700">Category</Label>
                                <Select value={d.category} onValueChange={v => set("category", v as SchemeCategory)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(CATEGORY_LABEL) as SchemeCategory[]).map(c => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="s-summary" className="text-xs font-semibold text-slate-700">Short description</Label>
                            <Input id="s-summary" value={d.summary} onChange={e => set("summary", e.target.value)} placeholder="Sell more this festive season and earn up to ₹5,000" maxLength={500} />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs font-semibold text-slate-700">Banner image</Label>
                            {d.banner_url ? (
                                <div className="relative rounded-lg overflow-hidden border border-slate-200 max-w-md">
                                    <img src={d.banner_url} alt="" className="w-full h-32 object-cover" />
                                    <button type="button" onClick={() => set("banner_url", "")} aria-label="Remove banner"
                                        className="absolute top-2 right-2 h-7 w-7 rounded-full bg-white/90 flex items-center justify-center text-slate-700 hover:text-rose-600">
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            ) : (
                                <label className="flex items-center gap-2 w-fit cursor-pointer rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:border-orange-300">
                                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                                    {uploading ? "Uploading…" : "Upload an image"}
                                    <input type="file" accept="image/*" className="hidden" disabled={uploading}
                                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadBanner(f); e.target.value = ""; }} />
                                </label>
                            )}
                        </div>
                    </Section>

                    <Section title="When it's open" note="Stores can submit only while a window is open. Add one window per period, e.g. 5 Oct 10:00 am to 7 Oct 6:00 pm, then the same in November.">
                        <div className="space-y-2">
                            {d.windows.map((w, i) => (
                                <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                    <span className="w-16 font-semibold text-slate-700">Window {i + 1}</span>
                                    <Input type="datetime-local" value={w.start} aria-label={`Window ${i + 1} opens`} className="h-9 w-[210px]"
                                        onChange={e => set("windows", d.windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                                    to
                                    <Input type="datetime-local" value={w.end} min={w.start || undefined} aria-label={`Window ${i + 1} closes`} className="h-9 w-[210px]"
                                        onChange={e => set("windows", d.windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-500" disabled={d.windows.length === 1}
                                        onClick={() => set("windows", d.windows.filter((_, j) => j !== i))} aria-label={`Remove window ${i + 1}`}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => set("windows", [...d.windows, { start: "", end: "" }])}>
                                    <Plus className="h-4 w-4 mr-1" /> Add a window
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => setDatesOpen(o => !o)}>
                                    <CalendarPlus className="h-4 w-4 mr-1" /> Add dates
                                </Button>
                                {(() => {
                                    const last = d.windows[d.windows.length - 1];
                                    const ready = last && last.start && last.end;
                                    return (
                                        <Button type="button" variant="outline" size="sm" disabled={!ready}
                                            title={ready ? "Adds the same days and times next month" : "Fill in the last window first"}
                                            onClick={() => set("windows", [...d.windows, nextMonthWindow(last)])}>
                                            <Repeat className="h-4 w-4 mr-1" /> Repeat next month
                                        </Button>
                                    );
                                })()}
                            </div>
                        </div>
                    </Section>

                    {datesOpen && (
                        <Section title="Add dates" note="One window per date — e.g. the purchase calendar: 15 Jul, 12 Aug, 16 Sep… Each date opens and closes at the times below.">
                            <div className="flex flex-wrap items-end gap-2 text-xs text-slate-600">
                                <label className="space-y-1">
                                    <span className="block font-semibold text-slate-700">Date</span>
                                    <Input type="date" value={dateDraft} onChange={e => setDateDraft(e.target.value)} className="h-9 w-[160px]" />
                                </label>
                                <Button type="button" variant="outline" size="sm" disabled={!dateDraft || dateList.includes(dateDraft)}
                                    onClick={() => { setDateList(l => [...l, dateDraft].sort()); setDateDraft(""); }}>
                                    <Plus className="h-4 w-4 mr-1" /> Add
                                </Button>
                                <label className="space-y-1">
                                    <span className="block font-semibold text-slate-700">Opens</span>
                                    <Input type="time" value={dateTimes.open} onChange={e => setDateTimes(t => ({ ...t, open: e.target.value }))} className="h-9 w-[120px]" />
                                </label>
                                <label className="space-y-1">
                                    <span className="block font-semibold text-slate-700">Closes</span>
                                    <Input type="time" value={dateTimes.close} onChange={e => setDateTimes(t => ({ ...t, close: e.target.value }))} className="h-9 w-[120px]" />
                                </label>
                            </div>
                            {dateList.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {dateList.map(dt => (
                                        <span key={dt} className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs">
                                            {new Date(dt + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
                                            <button type="button" aria-label={`Remove ${dt}`} className="text-slate-400 hover:text-rose-600"
                                                onClick={() => setDateList(l => l.filter(x => x !== dt))}><X className="h-3 w-3" /></button>
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div className="flex gap-2">
                                <Button type="button" size="sm" className="bg-orange-500 hover:bg-orange-600"
                                    disabled={!dateList.length || !dateTimes.open || !dateTimes.close || dateTimes.close <= dateTimes.open}
                                    onClick={() => {
                                        const added = dateList.map(dt => ({ start: `${dt}T${dateTimes.open}`, end: `${dt}T${dateTimes.close}` }));
                                        const kept = d.windows.filter(w => w.start || w.end);
                                        set("windows", [...kept, ...added].sort((a, b) => a.start.localeCompare(b.start)));
                                        setDateList([]); setDatesOpen(false);
                                    }}>
                                    Add {dateList.length || ""} window{dateList.length === 1 ? "" : "s"}
                                </Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => { setDatesOpen(false); setDateList([]); }}>Cancel</Button>
                            </div>
                        </Section>
                    )}

                    <Section title="Who it's for">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs font-semibold text-slate-700">Stores</Label>
                                <Select value={d.eligibility.mode} onValueChange={v => set("eligibility", { ...d.eligibility, mode: v as Eligibility["mode"] })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All franchises</SelectItem>
                                        <SelectItem value="states">Franchises in some states</SelectItem>
                                        <SelectItem value="stores">Selected stores</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs font-semibold text-slate-700">Brand</Label>
                                <Select value={d.eligibility.brand ?? "both"} onValueChange={v => set("eligibility", { ...d.eligibility, brand: v === "both" ? null : v as "AF" | "AC" })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="both">Both brands</SelectItem>
                                        <SelectItem value="AF">Autoform (AF)</SelectItem>
                                        <SelectItem value="AC">Autocruze (AC)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        {d.eligibility.mode === "states" && (
                            <div className="flex flex-wrap gap-1.5">
                                {INDIAN_STATES.map(st => {
                                    const on = (d.eligibility.states ?? []).includes(st);
                                    return (
                                        <button key={st} type="button"
                                            onClick={() => set("eligibility", { ...d.eligibility, states: on ? d.eligibility.states!.filter(x => x !== st) : [...(d.eligibility.states ?? []), st] })}
                                            className={`text-xs rounded-full border px-2.5 py-1 ${on ? "border-orange-300 bg-orange-50 text-orange-700 font-semibold" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                                            {st}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {d.eligibility.mode === "stores" && (
                            <div className="space-y-2">
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <Input value={storeSearch} onChange={e => setStoreSearch(e.target.value)} placeholder="Search store, city or state" className="pl-8" />
                                </div>
                                <p className="text-xs text-slate-500">{(d.eligibility.store_ids ?? []).length} selected</p>
                                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                                    {shownStores.map(s => {
                                        const on = (d.eligibility.store_ids ?? []).includes(s.id);
                                        return (
                                            <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                                                <Checkbox checked={on} onCheckedChange={() => set("eligibility", {
                                                    ...d.eligibility,
                                                    store_ids: on ? d.eligibility.store_ids!.filter(x => x !== s.id) : [...(d.eligibility.store_ids ?? []), s.id],
                                                })} />
                                                <span className="truncate text-slate-800">{s.store_name}</span>
                                                <span className="text-xs text-slate-400 truncate">{[s.city, s.state].filter(Boolean).join(", ")}</span>
                                            </label>
                                        );
                                    })}
                                    {!shownStores.length && <p className="px-3 py-3 text-xs text-slate-400">No stores match.</p>}
                                </div>
                            </div>
                        )}
                    </Section>

                    <Section title="What stores submit" note="The form a store fills for each entry. Leave it empty for an offer that needs nothing back.">
                        <div className="space-y-2">
                            {d.fields.map((f, i) => (
                                <div key={f.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_auto] gap-2 items-center">
                                        <Input value={f.label} onChange={e => setField(i, { label: e.target.value })} placeholder="Field label, e.g. Invoice number" aria-label="Field label" />
                                        <Select value={f.type} onValueChange={v => setField(i, {
                                            type: v as FieldType,
                                            ...(v === "select" ? { options: f.options ?? [] } : {}),
                                            ...(v === "file" ? { formats: f.formats ?? ["image"], max_files: f.max_files ?? 3, max_mb: f.max_mb ?? 10 } : {}),
                                        })}>
                                            <SelectTrigger aria-label="Field type"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map(t => <SelectItem key={t} value={t}>{FIELD_TYPE_LABEL[t]}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <div className="flex items-center gap-1">
                                            <label className="flex items-center gap-1.5 text-xs text-slate-600 mr-1">
                                                <Checkbox checked={f.required} onCheckedChange={c => setField(i, { required: Boolean(c) })} /> Required
                                            </label>
                                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0} onClick={() => moveField(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={i === d.fields.length - 1} onClick={() => moveField(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => set("fields", d.fields.filter((_, j) => j !== i))} aria-label="Remove field"><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    </div>
                                    {f.type === "select" && (
                                        <Input value={(f.options ?? []).join(", ")} onChange={e => setField(i, { options: e.target.value.split(",").map(o => o.trim()) })}
                                            placeholder="Options, separated by commas: D5, U-Sports, U-Focus" aria-label="Options" />
                                    )}
                                    {f.type === "file" && (
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
                                            {(Object.keys(FORMAT_LABEL) as FileFormat[]).map(fmt => {
                                                const on = (f.formats ?? []).includes(fmt);
                                                return (
                                                    <label key={fmt} className="flex items-center gap-1.5">
                                                        <Checkbox checked={on} onCheckedChange={() => setField(i, { formats: on ? f.formats!.filter(x => x !== fmt) : [...(f.formats ?? []), fmt] })} />
                                                        {FORMAT_LABEL[fmt]}
                                                    </label>
                                                );
                                            })}
                                            <label className="flex items-center gap-1.5">Max files
                                                <Input type="number" min={1} max={10} value={f.max_files ?? 3} onChange={e => setField(i, { max_files: Number(e.target.value) })} className="h-8 w-16" />
                                            </label>
                                            <label className="flex items-center gap-1.5">Max MB each
                                                <Input type="number" min={1} max={50} value={f.max_mb ?? 10} onChange={e => setField(i, { max_mb: Number(e.target.value) })} className="h-8 w-16" />
                                            </label>
                                        </div>
                                    )}
                                </div>
                            ))}
                            <Button type="button" variant="outline" size="sm" onClick={() => set("fields", [...d.fields, { id: newId(), label: "", type: "text", required: false }])}>
                                <Plus className="h-4 w-4 mr-1" /> Add a field
                            </Button>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                            <span className="text-xs font-semibold text-slate-700">Entries per store</span>
                            {(["many", "one"] as const).map(v => (
                                <label key={v} className="flex items-center gap-1.5 text-xs text-slate-700">
                                    <input type="radio" name="entries" checked={d.entries_per_store === v} onChange={() => set("entries_per_store", v)} />
                                    {v === "many" ? "As many as they like" : "Only one"}
                                </label>
                            ))}
                        </div>
                    </Section>

                    <Section title="Products & points" note="Pick the products this scheme is on and the points one unit of each earns. When you approve an invoice, you choose its products and quantities, and it scores quantity × points.">
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                            <Checkbox checked={d.score_rule.mode === "products"}
                                onCheckedChange={c => set("score_rule", c ? { mode: "products", products: d.score_rule.mode === "products" ? d.score_rule.products : [] } : { mode: "none" })} />
                            Score this scheme by products
                        </label>
                        {d.score_rule.mode === "products" && (
                            <ProductPointsPicker
                                products={d.score_rule.products}
                                brand={d.eligibility.brand ?? null}
                                onChange={products => set("score_rule", { mode: "products", products })}
                            />
                        )}
                    </Section>

                    {d.score_rule.mode !== "products" && (
                        <Section title="Score" note="Only approved entries count. You can still correct an entry's score when approving it.">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Select value={d.score_rule.mode} onValueChange={v => set("score_rule",
                                    v === "sum" ? { mode: "sum", field_id: numberFields[0]?.id ?? "" } : { mode: v as "count" | "points" | "none" })}>
                                    <SelectTrigger aria-label="How the score is counted"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="sum">Add up a number field</SelectItem>
                                        <SelectItem value="count">1 point per approved entry</SelectItem>
                                        <SelectItem value="points">I give points to each entry</SelectItem>
                                        <SelectItem value="none">No score</SelectItem>
                                    </SelectContent>
                                </Select>
                                {d.score_rule.mode === "sum" && (
                                    <Select value={d.score_rule.field_id} onValueChange={v => set("score_rule", { mode: "sum", field_id: v })}>
                                        <SelectTrigger aria-label="Field to add up"><SelectValue placeholder="Pick a number field" /></SelectTrigger>
                                        <SelectContent>
                                            {numberFields.map(f => <SelectItem key={f.id} value={f.id}>{f.label || "(unnamed field)"}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        </Section>
                    )}

                    <Section title="Rewards">
                        <Select value={d.rewards.mode} onValueChange={v => set("rewards",
                            v === "slabs" ? { mode: "slabs", slabs: [{ min: 1, max: null, reward: "" }] }
                                : v === "per_unit" ? { mode: "per_unit", amount: 0, unit_label: "unit" }
                                    : v === "rank" ? { mode: "rank", prizes: [{ from: 1, to: 1, reward: "" }] }
                                        : v === "per_entry" ? { mode: "per_entry", reward: "" }
                                            : v === "clubs" ? { mode: "clubs" } : { mode: "none" })}>
                            <SelectTrigger aria-label="Reward type" className="sm:max-w-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="slabs" disabled={!hasScore}>Slabs on the score</SelectItem>
                                <SelectItem value="per_unit" disabled={!hasScore}>₹ per unit of score</SelectItem>
                                <SelectItem value="rank" disabled={!hasScore}>Prizes by rank</SelectItem>
                                <SelectItem value="clubs" disabled={!hasScore}>Each club's reward (set in Clubs)</SelectItem>
                                <SelectItem value="per_entry">A reward for every approved entry</SelectItem>
                                <SelectItem value="none">No reward (information only)</SelectItem>
                            </SelectContent>
                        </Select>
                        {d.rewards.mode === "slabs" && (() => {
                            const r = d.rewards;
                            return (
                                <div className="space-y-2">
                                    {r.slabs.map((sl, i) => (
                                        <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                            From <Input type="number" min={0} value={sl.min} onChange={e => set("rewards", { ...r, slabs: r.slabs.map((x, j) => j === i ? { ...x, min: Number(e.target.value) } : x) })} className="h-8 w-20" aria-label="From" />
                                            to <Input type="number" min={0} value={sl.max ?? ""} placeholder="and above" onChange={e => set("rewards", { ...r, slabs: r.slabs.map((x, j) => j === i ? { ...x, max: e.target.value === "" ? null : Number(e.target.value) } : x) })} className="h-8 w-24" aria-label="To" />
                                            → <Input value={sl.reward} onChange={e => set("rewards", { ...r, slabs: r.slabs.map((x, j) => j === i ? { ...x, reward: e.target.value } : x) })} placeholder="₹2,000 or a gift" className="h-8 w-48" aria-label="Reward" />
                                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => set("rewards", { ...r, slabs: r.slabs.filter((_, j) => j !== i) })} aria-label="Remove slab"><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    ))}
                                    <Button type="button" variant="outline" size="sm" onClick={() => {
                                        const last = r.slabs[r.slabs.length - 1];
                                        const min = last ? (last.max ?? last.min) + 1 : 1;
                                        set("rewards", { ...r, slabs: [...r.slabs.map((x, j) => j === r.slabs.length - 1 && x.max === null ? { ...x, max: min - 1 } : x), { min, max: null, reward: "" }] });
                                    }}><Plus className="h-4 w-4 mr-1" /> Add a slab</Button>
                                </div>
                            );
                        })()}
                        {d.rewards.mode === "per_unit" && (() => {
                            const r = d.rewards;
                            return (
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                    ₹ <Input type="number" min={0} value={r.amount} onChange={e => set("rewards", { ...r, amount: Number(e.target.value) })} className="h-8 w-24" aria-label="Amount" />
                                    per <Input value={r.unit_label ?? ""} onChange={e => set("rewards", { ...r, unit_label: e.target.value })} placeholder="unit" className="h-8 w-32" aria-label="Unit name" />
                                </div>
                            );
                        })()}
                        {d.rewards.mode === "rank" && (() => {
                            const r = d.rewards;
                            return (
                                <div className="space-y-2">
                                    {r.prizes.map((p, i) => (
                                        <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                            Rank <Input type="number" min={1} value={p.from} onChange={e => set("rewards", { ...r, prizes: r.prizes.map((x, j) => j === i ? { ...x, from: Number(e.target.value) } : x) })} className="h-8 w-16" aria-label="From rank" />
                                            to <Input type="number" min={1} value={p.to} onChange={e => set("rewards", { ...r, prizes: r.prizes.map((x, j) => j === i ? { ...x, to: Number(e.target.value) } : x) })} className="h-8 w-16" aria-label="To rank" />
                                            → <Input value={p.reward} onChange={e => set("rewards", { ...r, prizes: r.prizes.map((x, j) => j === i ? { ...x, reward: e.target.value } : x) })} placeholder="Smart TV" className="h-8 w-48" aria-label="Prize" />
                                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => set("rewards", { ...r, prizes: r.prizes.filter((_, j) => j !== i) })} aria-label="Remove prize"><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    ))}
                                    <Button type="button" variant="outline" size="sm" onClick={() => {
                                        const last = r.prizes[r.prizes.length - 1];
                                        const from = last ? last.to + 1 : 1;
                                        set("rewards", { ...r, prizes: [...r.prizes, { from, to: from, reward: "" }] });
                                    }}><Plus className="h-4 w-4 mr-1" /> Add a prize</Button>
                                </div>
                            );
                        })()}
                        {d.rewards.mode === "per_entry" && (() => {
                            const r = d.rewards;
                            return <Input value={r.reward} onChange={e => set("rewards", { ...r, reward: e.target.value })} placeholder="₹500 or a gift voucher" className="sm:max-w-xs" aria-label="Reward per entry" />;
                        })()}
                    </Section>

                    <Section title="What the store reads">
                        <div className="space-y-1">
                            <Label htmlFor="s-ins" className="text-xs font-semibold text-slate-700">Instructions</Label>
                            <Textarea id="s-ins" value={d.instructions} onChange={e => set("instructions", e.target.value)} rows={5}
                                placeholder={"1. Join the scheme.\n2. After each sale, submit the quantity and a photo of the invoice.\n3. We review entries within 2 working days."} />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="s-terms" className="text-xs font-semibold text-slate-700">Terms & conditions</Label>
                            <Textarea id="s-terms" value={d.terms} onChange={e => set("terms", e.target.value)} rows={4} placeholder="Stores accept these when they join." />
                        </div>
                    </Section>

                    <Section title="Scheme contact" note="Shown to stores with tap-to-call and email. Optional.">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {([["name", "Name", "Ashish Rai"], ["role", "Role", "Franchisee Growth Manager"], ["phone", "Phone", "+91 85275 31666"], ["email", "Email", "ashish@autoformindia.com"]] as const).map(([k, l, ph]) => (
                                <label key={k} className="space-y-1">
                                    <span className="block text-xs font-semibold text-slate-700">{l}</span>
                                    <Input value={d.contact[k]} placeholder={ph} type={k === "email" ? "email" : k === "phone" ? "tel" : "text"}
                                        onChange={e => set("contact", { ...d.contact, [k]: e.target.value })} />
                                </label>
                            ))}
                        </div>
                    </Section>

                    {hasScore && (
                        <Section title="Clubs" note="Optional. A store joins the highest club its score reaches — e.g. Silver from 180 points. Stores see their club, not how far the next one is.">
                            <ClubsEditor clubs={d.clubs} onChange={clubs => set("clubs", clubs)} />
                        </Section>
                    )}

                    {hasScore && (
                        <Section title="Leaderboard" note="Stores always see their own score and rank.">
                            <label className="flex items-center gap-2 text-sm text-slate-700">
                                <Checkbox checked={d.leaderboard.show} onCheckedChange={c => set("leaderboard", { ...d.leaderboard, show: Boolean(c) })} />
                                Show stores the top 10
                            </label>
                            {d.leaderboard.show && (
                                <label className="flex items-center gap-2 text-sm text-slate-700">
                                    <Checkbox checked={d.leaderboard.names} onCheckedChange={c => set("leaderboard", { ...d.leaderboard, names: Boolean(c) })} />
                                    Show other stores' names (otherwise "Store #1, #2…")
                                </label>
                            )}
                        </Section>
                    )}

                    {problems.length > 0 && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                            <p className="font-semibold mb-1">Fix these to save:</p>
                            <ul className="list-disc pl-5 space-y-0.5">{problems.map(p => <li key={p}>{p}</li>)}</ul>
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onClose} disabled={Boolean(saving)}>Cancel</Button>
                    <Button variant="outline" onClick={() => save(false)} disabled={Boolean(saving)}>
                        {saving === "draft" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                        {isPublished ? "Save changes" : "Save draft"}
                    </Button>
                    {!isPublished && (
                        <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => save(true)} disabled={Boolean(saving)}>
                            {saving === "publish" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            Save & publish
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
