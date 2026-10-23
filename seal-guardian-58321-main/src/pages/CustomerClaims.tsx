import { useEffect, useState } from "react";
import { ChevronLeft, Loader2, Plus, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { decisionText, day, rupees, REJECT_REASONS, type Claim, type ClaimWarranty } from "@/lib/claims";
import { ClaimStatusPill, ClaimTimeline, ClaimTracker, FilePicker, MediaGrid, ProblemPicker, claimForm } from "@/components/claims/ClaimParts";

interface Store { vendor_details_id: string; store_name: string; city?: string }

/** The customer's claims: raise one on a warranty, and follow it to the end. */
const CustomerClaims = () => {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [warranties, setWarranties] = useState<ClaimWarranty[]>([]);
    const [claims, setClaims] = useState<Claim[]>([]);
    const [view, setView] = useState<'list' | 'raise' | number>('list');

    const load = async () => {
        try {
            const r = await api.get('/claims/mine');
            setWarranties(r.data.warranties ?? []);
            setClaims(r.data.claims ?? []);
        } catch (e) {
            toast({ variant: "destructive", title: "Could not load your claims", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-orange-600" /></div>;

    if (view === 'raise') {
        return <RaiseClaim warranties={warranties} onBack={() => setView('list')}
            onDone={c => { setClaims(prev => [c, ...prev]); setView(c.id); }} />;
    }
    if (typeof view === 'number') {
        const c = claims.find(x => x.id === view);
        if (c) return <ClaimDetail claim={c} onBack={() => setView('list')} onChange={n => setClaims(prev => prev.map(x => x.id === n.id ? n : x))} />;
    }

    return (
        <div className="mx-auto max-w-2xl space-y-4 pb-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-gray-900">My claims</h1>
                    <p className="text-sm text-gray-500">Warranty claim / alteration</p>
                </div>
                <Button onClick={() => setView('raise')} className="h-11 rounded-xl bg-orange-700 hover:bg-orange-800 font-bold">
                    <Plus className="h-4 w-4 mr-1" />Raise claim / alteration
                </Button>
            </div>
            {!claims.length && (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
                    <ShieldCheck className="mx-auto h-8 w-8 text-orange-600" />
                    <p className="mt-2 font-semibold text-gray-900">No claims yet</p>
                    <p className="text-sm text-gray-500">If a product under warranty has a problem, raise a claim and the store will check it.</p>
                </div>
            )}
            {claims.map(c => (
                <button key={c.id} onClick={() => setView(c.id)} className="w-full text-left rounded-2xl border border-gray-200 bg-white p-4 hover:border-orange-300">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-500">{c.claim_no}{c.kind === 'alteration' ? ' · Alteration' : ''}</p>
                            <p className="font-bold text-gray-900">{c.snapshot?.product_name} · {c.problem_text}</p>
                            <p className="text-sm text-gray-500">{c.snapshot?.registration_number} · {day(c.created_at)}</p>
                            {decisionText(c) && <p className="mt-1 text-xs text-gray-600">{decisionText(c)}</p>}
                        </div>
                        <ClaimStatusPill status={c.status} who="customer" />
                    </div>
                </button>
            ))}
        </div>
    );
};

/* ─── Raise ──────────────────────────────────────────────────────────────── */

const RaiseClaim = ({ warranties, onBack, onDone }: { warranties: ClaimWarranty[]; onBack: () => void; onDone: (c: Claim) => void }) => {
    const { toast } = useToast();
    const [uid, setUid] = useState(warranties.find(w => w.claimable)?.uid ?? '');
    const [problem, setProblem] = useState('');
    const [description, setDescription] = useState('');
    const [photos, setPhotos] = useState<File[]>([]);
    const [video, setVideo] = useState<File[]>([]);
    const [stores, setStores] = useState<Store[]>([]);
    const [storeId, setStoreId] = useState('');
    const [changing, setChanging] = useState(false);
    const [sending, setSending] = useState(false);

    const w = warranties.find(x => x.uid === uid);
    const options = w ? w.problems : [];
    useEffect(() => { setProblem(options.length === 1 ? options[0] : ''); }, [uid]);
    useEffect(() => { setStoreId(w?.store_id ?? ''); setChanging(!w?.store_id); }, [uid]);
    useEffect(() => {
        if (!changing || stores.length) return;
        api.get('/public/stores').then(r => setStores(r.data.stores ?? [])).catch(() => {});
    }, [changing]);

    const send = async () => {
        if (!w) return toast({ variant: "destructive", title: "Choose the product" });
        if (!problem) return toast({ variant: "destructive", title: "Choose the problem" });
        if (!photos.length) return toast({ variant: "destructive", title: "Add at least one photo" });
        if (!storeId) return toast({ variant: "destructive", title: "Choose the store for the inspection" });
        setSending(true);
        try {
            const fd = await claimForm({ warranty_uid: w.uid, problem, description, store_id: storeId }, { media: [...photos, ...video] });
            const r = await api.post('/claims', fd);
            toast({ title: `Claim ${r.data.claim.claim_no} raised`, description: 'The store will call you to check the car.' });
            onDone(r.data.claim);
        } catch (e) {
            toast({ variant: "destructive", title: "Claim not raised", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setSending(false);
        }
    };
    const store = stores.find(s => s.vendor_details_id === storeId);

    return (
        <div className="mx-auto max-w-2xl space-y-6 pb-10">
            <div className="flex items-center gap-2">
                <button onClick={onBack} aria-label="Back" className="h-11 w-11 rounded-xl flex items-center justify-center hover:bg-gray-100"><ChevronLeft className="h-5 w-5" /></button>
                <h1 className="text-xl font-extrabold text-gray-900">Warranty claim / alteration</h1>
            </div>

            <section className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">1 · Which product</p>
                {!warranties.length && <p className="text-sm text-gray-500">No warranties on your account yet.</p>}
                {warranties.map(x => {
                    const ok = x.claimable;
                    return (
                        <label key={x.uid} className={cn("flex gap-3 rounded-2xl border bg-white p-4", ok ? "cursor-pointer" : "opacity-60",
                            uid === x.uid ? "border-2 border-orange-600" : "border-gray-200")}>
                            <input type="radio" name="w" disabled={!ok} checked={uid === x.uid} onChange={() => setUid(x.uid)} className="mt-1 h-4 w-4 accent-orange-600" />
                            <span className="min-w-0 flex-1 space-y-0.5">
                                <span className="flex justify-between gap-2">
                                    <span className="font-bold text-gray-900">{x.product_name}</span>
                                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", x.covered ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600")}>{x.covered ? 'Covered' : x.claimable ? 'Alteration only' : 'Not covered'}</span>
                                </span>
                                <span className="block text-sm text-gray-600">{[x.car, x.registration_number].filter(Boolean).join(' · ')}</span>
                                <span className="block text-xs text-gray-500">UID {x.uid} · {x.warranty_type}</span>
                                <span className={cn("block text-xs font-semibold", x.covered ? "text-emerald-700" : "text-gray-500")}>
                                    {x.covered ? `Covered till ${day(x.cover_end)}` : x.why}
                                </span>
                            </span>
                        </label>
                    );
                })}
            </section>

            {w && (
                <>
                    <section className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-500">2 · What is the problem</p>
                        <ProblemPicker options={options} value={problem} onChange={setProblem} />
                        {problem === 'alteration' && <p className="text-xs text-gray-500">Alterations are usually chargeable. Head office will tell you the amount before anything is done.</p>}
                        <label className="block space-y-1.5 text-sm font-semibold text-gray-800">
                            Tell us more {['product_defect', 'alteration'].includes(problem) ? '' : '(optional)'}
                            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={2000} className="font-normal" />
                        </label>
                    </section>

                    <section className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-500">3 · Photos and video</p>
                        <FilePicker files={photos} onChange={setPhotos} max={5} hint="1 to 5 photos: a close-up of the problem and one of the whole seat or part." />
                        <FilePicker files={video} onChange={setVideo} max={1} accept="video/*" label="Add video" hint="A short video is optional (up to 60 MB)." />
                    </section>

                    <section className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-500">4 · Store for the inspection</p>
                        {!changing ? (
                            <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
                                <div>
                                    <p className="font-bold text-gray-900">{w.fitted_store || 'The store that fitted it'}</p>
                                    <p className="text-xs text-gray-500">Where it was fitted</p>
                                </div>
                                <Button variant="outline" className="h-11 rounded-xl" onClick={() => setChanging(true)}>Change</Button>
                            </div>
                        ) : (
                            <select value={storeId} onChange={e => setStoreId(e.target.value)} aria-label="Store for the inspection"
                                className="h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm">
                                <option value="">Choose a store</option>
                                {w.store_id && <option value={w.store_id}>{w.fitted_store || 'Where it was fitted'}</option>}
                                {stores.filter(s => s.vendor_details_id !== w.store_id).map(s => (
                                    <option key={s.vendor_details_id} value={s.vendor_details_id}>{s.store_name}{s.city ? ` · ${s.city}` : ''}</option>
                                ))}
                            </select>
                        )}
                        {store && <p className="text-xs text-gray-500">{store.store_name} will call you to check the car.</p>}
                    </section>

                    <Button onClick={send} disabled={sending} className="h-12 w-full rounded-xl bg-orange-700 hover:bg-orange-800 text-base font-bold">
                        {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Raise claim'}
                    </Button>
                </>
            )}
        </div>
    );
};

/* ─── One claim ──────────────────────────────────────────────────────────── */

const ClaimDetail = ({ claim, onBack, onChange }: { claim: Claim; onBack: () => void; onChange: (c: Claim) => void }) => {
    const { toast } = useToast();
    const [c, setC] = useState(claim);
    const [closing, setClosing] = useState(false);
    useEffect(() => {
        api.get(`/claims/${claim.id}`).then(r => { setC(r.data.claim); onChange(r.data.claim); }).catch(() => {});
    }, [claim.id]);

    const close = async () => {
        setClosing(true);
        try {
            const r = await api.post(`/claims/${c.id}/action`, { action: 'close' });
            setC(r.data.claim); onChange(r.data.claim);
            toast({ title: 'Thank you', description: 'The claim is closed.' });
        } catch (e) {
            toast({ variant: "destructive", title: "Could not close", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setClosing(false);
        }
    };
    const d = c.decision;

    return (
        <div className="mx-auto max-w-2xl space-y-4 pb-10">
            <div className="flex items-center gap-2">
                <button onClick={onBack} aria-label="Back" className="h-11 w-11 rounded-xl flex items-center justify-center hover:bg-gray-100"><ChevronLeft className="h-5 w-5" /></button>
                <h1 className="text-xl font-extrabold text-gray-900">Claim {c.claim_no}</h1>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-lg font-extrabold text-gray-900">{c.snapshot?.product_name}</p>
                        <p className="text-sm text-gray-600">{c.problem_text} · {c.snapshot?.registration_number}</p>
                        {c.store_name && <p className="text-sm text-gray-500">Store: {c.store_name}{c.store_city ? `, ${c.store_city}` : ''}</p>}
                    </div>
                    <ClaimStatusPill status={c.status} who="customer" />
                </div>

                <ClaimTracker c={c} />

                {c.status === 'rejected' && d && (
                    <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900">
                        <p className="font-bold">Not approved as per T&amp;C: {REJECT_REASONS[d.reason ?? ''] ?? 'see note'}</p>
                        {d.note && <p className="mt-1">{d.note}</p>}
                    </div>
                )}
                {d && d.outcome !== 'reject' && (
                    <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-800 space-y-1">
                        <p className="font-bold">{decisionText(c)}</p>
                        {d.note && <p>{d.note}</p>}
                        {c.status === 'payment' && <p className="text-purple-800 font-semibold">Please pay {rupees(d.amount)} to Autoform by UPI or bank transfer. The store will share the details. Work starts once it is received.</p>}
                    </div>
                )}
                {c.dispatch?.courier && (
                    <p className="flex items-center gap-2 text-sm text-gray-700"><Truck className="h-4 w-4 text-orange-600" />{[c.dispatch.courier, c.dispatch.tracking].filter(Boolean).join(' · ')}{c.dispatch.date ? ` · sent ${day(c.dispatch.date)}` : ''}</p>
                )}
                {c.kind === 'warranty' && c.snapshot?.cover_end && c.status !== 'rejected' && (
                    <p className="rounded-xl bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">Your warranty stays the same: covered till {day(c.snapshot.cover_end)}. A replacement does not start a new period.</p>
                )}
                {c.actions.includes('close') && (
                    <Button onClick={close} disabled={closing} variant="outline" className="h-12 w-full rounded-xl font-bold">
                        {closing ? <Loader2 className="h-5 w-5 animate-spin" /> : 'It is fixed, close the claim'}
                    </Button>
                )}
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
                <p className="text-sm font-bold text-gray-900">Your photos</p>
                <MediaGrid urls={c.media} />
                {c.description && <p className="text-sm text-gray-600">"{c.description}"</p>}
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
                <p className="text-sm font-bold text-gray-900">Timeline</p>
                <ClaimTimeline history={c.history} who="customer" />
            </div>
        </div>
    );
};

export default CustomerClaims;
