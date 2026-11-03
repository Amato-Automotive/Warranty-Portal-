import { useEffect, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Upload, X } from "lucide-react";
import { formatDay, type PointsRule, type Scheme } from "@/lib/schemes";
import { PointsRuleEditor, useWarrantyProducts } from "./PointsRuleEditor";
import { StoreTargetsEditor, type TargetEdits } from "./StoreTargetsEditor";

/**
 * The edit form for the Sell More Earn More program. The way it runs is
 * hardcoded, so only its words and its points are edited here: what each series
 * earns, which products are in it, and what each store type earns series by
 * series, and each store's Option 1 target. Stores see only the first type's
 * points. A store is put in a type on the scheme's page.
 */
/** One banner: pick an image and it uploads, with a preview and a way to remove it. */
function BannerBox({ label, url, onChange, onBusy }: { label: string; url: string; onChange: (u: string) => void; onBusy: (on: boolean) => void }) {
    const { toast } = useToast();
    const [uploading, setUploading] = useState(false);
    const upload = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true); onBusy(true);
        try {
            const form = new FormData();
            form.append("banner", file);
            const r = await api.post("/schemes/admin/banner", form, { headers: { "Content-Type": "multipart/form-data" } });
            onChange(r.data.url);
        } catch (e) {
            toast({ title: "Could not upload the image", description: getErrorMessage(e, "Try another image"), variant: "destructive" });
        } finally { setUploading(false); onBusy(false); }
    };
    return (
        <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-bold text-slate-900">{label}</p>
            {url ? (
                <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <img src={url} alt={label} className="h-36 w-full object-contain" />
                    <button type="button" onClick={() => onChange("")} aria-label={`Remove the ${label.toLowerCase()}`}
                        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-sm hover:text-rose-600">
                        <X className="h-4 w-4" />
                    </button>
                </div>
            ) : (
                <label className="flex h-36 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 px-2 text-center text-sm font-medium text-slate-600 hover:border-orange-400 hover:bg-orange-50/40">
                    {uploading ? <Loader2 className="h-5 w-5 animate-spin text-orange-500" /> : <Upload className="h-5 w-5 text-slate-400" />}
                    {uploading ? "Uploading…" : "Add image"}
                    <input type="file" accept="image/*" className="sr-only" disabled={uploading} aria-label={label}
                        onChange={e => { upload(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
            )}
        </div>
    );
}

export function SellMoreEditor({ open, scheme, onClose, onSaved }: {
    open: boolean; scheme: Scheme | null; onClose: () => void; onSaved: (s: Scheme) => void;
}) {
    const { toast } = useToast();
    const [summary, setSummary] = useState("");
    const [terms, setTerms] = useState("");
    const [banner, setBanner] = useState("");
    const [option1, setOption1] = useState("");
    const [option2, setOption2] = useState("");
    /* How many banners are still uploading. */
    const [uploading, setUploading] = useState(0);
    const busy = (on: boolean) => setUploading(n => n + (on ? 1 : -1));
    const [rule, setRule] = useState<PointsRule>({ series: [], tiers: [] });
    const [saving, setSaving] = useState(false);
    const [targets, setTargets] = useState<TargetEdits>({});
    const products = useWarrantyProducts();

    useEffect(() => {
        if (!open || !scheme) return;
        setSummary(scheme.summary ?? "");
        setTerms(scheme.terms ?? "");
        setBanner(scheme.banner_url ?? "");
        setTargets({});
        setOption1(scheme.settings.option_banners?.option1 ?? "");
        setOption2(scheme.settings.option_banners?.option2 ?? "");
        setRule(scheme.settings.points);
    }, [open, scheme]);

    if (!scheme) return null;

    /* What a store type earns for a series: what was set here, else the series' points × its multiplier. */
    const rateOf = (t: PointsRule["tiers"][number], s: PointsRule["series"][number]) => {
        const set = (t as { rates?: Record<string, number> }).rates?.[s.id];
        return set !== undefined ? set : Math.round(s.points * t.times * 100) / 100;
    };
    const setRate = (tierId: string, seriesId: string, value: string) => setRule(r => ({
        ...r,
        tiers: r.tiers.map(t => (t.id === tierId
            ? { ...t, rates: { ...(t as { rates?: Record<string, number> }).rates, [seriesId]: value === "" ? NaN : Number(value) } }
            : t)),
    }));

    const save = async () => {
        const bad = rule.tiers.slice(1).flatMap(t => rule.series.filter(s => !(rateOf(t, s) > 0)).map(s => `${s.name || "A series"} for ${t.name}`));
        if (bad.length) return toast({ title: "Give every series its points", description: bad[0], variant: "destructive" });
        const badTarget = Object.values(targets).flatMap(m => Object.values(m)).some(v => v.trim() !== "" && !(Number(v) > 0));
        if (badTarget) return toast({ title: "A target should be a number above 0", variant: "destructive" });
        setSaving(true);
        try {
            if (Object.values(targets).some(m => Object.keys(m).length)) await api.put(`/schemes/admin/${scheme.id}/sell-more/targets`, { targets });
            const r = await api.put(`/schemes/admin/${scheme.id}`, { ...scheme, summary, terms, banner_url: banner, settings: { ...scheme.settings, points: rule, option_banners: { option1, option2 } } });
            toast({ title: "Saved" });
            onSaved(r.data.scheme);
        } catch (e: any) {
            toast({ title: "Not saved", description: e?.response?.data?.problems?.[0] ?? getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setSaving(false); }
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!o && !saving) onClose(); }}>
            <DialogContent className="max-h-[94vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl">{scheme.title}</DialogTitle>
                    <DialogDescription>{formatDay(scheme.starts_on)} to {formatDay(scheme.ends_on)}. Points come from every warranty registered, unless it is rejected.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <BannerBox label="Program banner" url={banner} onChange={setBanner} onBusy={busy} />
                        <BannerBox label="Option 1 banner" url={option1} onChange={setOption1} onBusy={busy} />
                        <BannerBox label="Option 2 banner" url={option2} onChange={setOption2} onBusy={busy} />
                    </div>
                    <label className="block space-y-1.5"><span className="text-sm font-bold text-slate-900">Description</span>
                        <Input value={summary} onChange={e => setSummary(e.target.value)} maxLength={500} className="h-11" /></label>
                    <label className="block space-y-1.5"><span className="text-sm font-bold text-slate-900">More terms</span>
                        <Textarea value={terms} onChange={e => setTerms(e.target.value)} rows={3} />
                        <span className="block text-xs text-slate-500">Shown below the poster's terms when a store chooses its option.</span></label>
                </div>

                <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                    {products === null
                        ? <p className="text-sm text-slate-500"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Loading products…</p>
                        : <PointsRuleEditor rule={rule} onChange={setRule} products={products} hideTiers />}
                </section>

                <section className="space-y-3 rounded-2xl border border-slate-200 p-4">
                    <div>
                        <h3 className="text-sm font-bold text-slate-900">Points by store type</h3>
                        <p className="text-xs text-slate-500">These make the admin's calculated score. Stores see only {rule.tiers[0]?.name ?? "the first type"} points.</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[360px] text-sm">
                            <thead className="text-left text-xs text-slate-500">
                                <tr>
                                    <th className="py-2 pr-3 font-semibold">Series</th>
                                    {rule.tiers.map(t => <th key={t.id} className="px-3 py-2 text-right font-semibold">{t.name}</th>)}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {rule.series.map(s => (
                                    <tr key={s.id}>
                                        <td className="py-2 pr-3 font-medium text-slate-800">{s.name}</td>
                                        {rule.tiers.map((t, i) => (
                                            <td key={t.id} className="px-3 py-2 text-right tabular-nums">
                                                {i === 0 ? (Number.isFinite(s.points) ? s.points : "") : (
                                                    <Input
                                                        type="number" min={0} step="0.01" inputMode="decimal"
                                                        value={Number.isFinite(rateOf(t, s)) ? rateOf(t, s) : ""}
                                                        onChange={e => setRate(t.id, s.id, e.target.value)}
                                                        className="ml-auto h-9 w-24 text-right" aria-label={`${s.name} points for ${t.name}`}
                                                    />
                                                )}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                <StoreTargetsEditor schemeId={scheme.id} open={open} edits={targets} onEdits={setTargets} />

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button className="bg-orange-500 font-bold hover:bg-orange-600" onClick={save} disabled={saving || uploading > 0}>
                        {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
