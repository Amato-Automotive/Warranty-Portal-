import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, Loader2, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { decisionText, day, NEEDS_DESCRIPTION, type Claim, type ClaimWarranty } from "@/lib/claims";
import { CompareTable, StageDates, StatusHero } from "@/components/claims/ClaimView";
import { ChangeRequestBox, ClaimChange } from "@/components/claims/ClaimChange";
import {
    ClaimStatusPill, ClaimTimeline, ConsentBox, EMPTY_VEHICLE, FilePicker, FormStep, VehiclePhoto, MobileActionBar, ProblemPicker,
    StepJump, VehicleFields, claimForm, missingForRequest, type VehicleValue,
} from "@/components/claims/ClaimParts";

interface Store { vendor_details_id: string; store_name: string; city?: string }

/** The customer's claims: raise one on a warranty, and follow it to the end. */
const CustomerClaims = () => {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [warranties, setWarranties] = useState<ClaimWarranty[]>([]);
    const [claims, setClaims] = useState<Claim[]>([]);
    const [params, setParams] = useSearchParams();
    const askedUid = params.get('uid');
    const [view, setView] = useState<'list' | 'raise' | number>(askedUid ? 'raise' : 'list');

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
        const back = () => { if (askedUid) setParams({}, { replace: true }); setView('list'); };
        return <RaiseClaim warranties={warranties} initialUid={askedUid} onBack={back}
            onDone={c => { if (askedUid) setParams({}, { replace: true }); setClaims(prev => [c, ...prev]); setView(c.id); }} />;
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
                <Button onClick={() => setView('raise')} className="h-12 sm:h-11 w-full sm:w-auto rounded-xl bg-orange-700 hover:bg-orange-800 font-bold">
                    <Plus className="h-4 w-4 mr-1" />Request claim / alteration
                </Button>
            </div>
            {!claims.length && (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
                    <ShieldCheck className="mx-auto h-8 w-8 text-orange-600" />
                    <p className="mt-2 font-semibold text-gray-900">No claims yet</p>
                    <p className="text-sm text-gray-500">If a product under warranty has a problem, request a claim and the store will check it.</p>
                </div>
            )}
            {claims.map(c => (
                <button key={c.id} onClick={() => setView(c.id)} className="w-full text-left rounded-2xl border border-gray-200 bg-white p-4 hover:border-orange-300">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-500">{c.claim_no}{c.kind === 'alteration' ? ' · Alteration' : ''}</p>
                            <p className="font-bold text-gray-900">{c.snapshot?.product_name} · {c.problem_text}</p>
                            <p className="text-sm text-gray-500">{c.snapshot?.registration_number} · {day(c.created_at)}</p>
                            {c.plan?.edd && ['production', 'ready'].includes(c.status) && <p className="mt-1 text-xs font-semibold text-indigo-700">Expected by {day(c.plan.edd)}</p>}
                            {c.status === 'consent' && <p className="mt-1 text-xs font-semibold text-purple-700">Your agreement is needed</p>}
                            {c.change_request && <p className="mt-1 text-xs font-semibold text-amber-700">Change asked · waiting for the plant</p>}
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

const RaiseClaim = ({ warranties, initialUid, onBack, onDone }: { warranties: ClaimWarranty[]; initialUid?: string | null; onBack: () => void; onDone: (c: Claim) => void }) => {
    const { toast } = useToast();
    const [uid, setUid] = useState(warranties.find(w => w.claimable && w.uid === initialUid)?.uid ?? warranties.find(w => w.claimable)?.uid ?? '');
    const [problem, setProblem] = useState('');
    const [vehicle, setVehicle] = useState<VehicleValue>(EMPTY_VEHICLE);
    const [description, setDescription] = useState('');
    const [photos, setPhotos] = useState<File[]>([]);
    const [vehiclePhoto, setVehiclePhoto] = useState<File[]>([]);
    const [stores, setStores] = useState<Store[]>([]);
    const [storeId, setStoreId] = useState('');
    const [changing, setChanging] = useState(false);
    const [sending, setSending] = useState(false);
    // The product list folds to the chosen one; Change opens it again.
    const [picking, setPicking] = useState(!uid);

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
        const missing = missingForRequest({ problem, description, vehicle, airbags: w.asks_airbags, photos: photos.length, needYear: true });
        if (missing) return toast({ variant: "destructive", title: missing });
        if (!vehiclePhoto.length) return toast({ variant: "destructive", title: "Add a photo of the vehicle" });
        if (!storeId) return toast({ variant: "destructive", title: "Choose the store to check it" });
        setSending(true);
        try {
            const fd = await claimForm({ warranty_uid: w.uid, problem, description, store_id: storeId, ...vehicle }, { media: photos, vehicle_photo: vehiclePhoto });
            const r = await api.post('/claims', fd);
            toast({ title: `Claim ${r.data.claim.claim_no} requested`, description: 'The store will check it and call you.' });
            onDone(r.data.claim);
        } catch (e) {
            toast({ variant: "destructive", title: "Claim not requested", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setSending(false);
        }
    };
    const store = stores.find(s => s.vendor_details_id === storeId);

    const sendButton = (
        <Button onClick={send} disabled={sending} className="h-12 w-full sm:w-auto rounded-xl bg-orange-700 hover:bg-orange-800 text-base font-bold sm:px-8">
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Request claim'}
        </Button>
    );
    const row = (x: ClaimWarranty) => (
        <label key={x.uid} className={cn("flex gap-3 rounded-2xl border bg-white p-4", x.claimable ? "cursor-pointer" : "opacity-60",
            uid === x.uid ? "border-2 border-orange-600" : "border-gray-200")}>
            <input type="radio" name="w" disabled={!x.claimable} checked={uid === x.uid} onChange={() => { setUid(x.uid); setPicking(false); }} className="mt-1 h-4 w-4 accent-orange-600" />
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

    return (
        <div className="mx-auto w-full max-w-3xl space-y-4 pb-10">
            <div className="flex items-center gap-2">
                <button onClick={onBack} aria-label="Back" className="h-11 w-11 rounded-xl flex items-center justify-center hover:bg-gray-100"><ChevronLeft className="h-5 w-5" /></button>
                <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900">Warranty claim / alteration</h1>
            </div>

            <FormStep n={1} title="Which product" done={!!w}
                action={w && !picking && warranties.filter(x => x.claimable).length > 1 && (
                    <button type="button" onClick={() => setPicking(true)} className="h-10 rounded-lg px-3 text-sm font-semibold text-orange-700 hover:bg-orange-50">Change</button>
                )}>
                {!warranties.length && <p className="text-sm text-gray-500">No warranties on your account yet.</p>}
                {w && !picking ? row(w) : warranties.map(row)}
            </FormStep>

            {w && (
                <>
                    <FormStep n={2} title="Your vehicle" done={!!(vehicle.vehicle_make && vehicle.vehicle_model && vehicle.vehicle_year && (!w.asks_airbags || (vehicle.airbags && vehicle.major_colour)))}>
                        <VehicleFields value={vehicle} onChange={setVehicle} airbags={w.asks_airbags} registered={w.car} />
                    </FormStep>

                    <FormStep n={3} title="What is the issue" done={!!problem}>
                        <ProblemPicker options={options} value={problem} onChange={setProblem} />
                        {problem === 'alteration' && <p className="text-xs text-gray-500">Alterations are usually chargeable. You will be asked to agree before anything is done.</p>}
                        <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={2000} className="rounded-xl"
                            placeholder={NEEDS_DESCRIPTION.includes(problem) ? 'Tell us more (needed)' : 'Tell us more (optional)'} aria-label="Tell us more" />
                    </FormStep>

                    <FormStep n={4} title="Photos" note="1 to 5 photos of the problem, and one of the vehicle" done={photos.length > 0 && vehiclePhoto.length > 0}>
                        <FilePicker files={photos} onChange={setPhotos} max={5} hint="A close-up of the problem and one of the whole seat or part." />
                        <VehiclePhoto files={vehiclePhoto} onChange={setVehiclePhoto} required />
                    </FormStep>

                    <FormStep n={5} title="Store to check it" done={!!storeId}>
                        {!changing ? (
                            <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-4">
                                <div>
                                    <p className="font-bold text-gray-900">{w.fitted_store || 'The store that fitted it'}</p>
                                    <p className="text-xs text-gray-500">Where it was fitted</p>
                                </div>
                                <Button variant="outline" className="h-11 rounded-xl" onClick={() => setChanging(true)}>Change</Button>
                            </div>
                        ) : (
                            <select value={storeId} onChange={e => setStoreId(e.target.value)} aria-label="Store to check it"
                                className="h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm">
                                <option value="">Choose a store</option>
                                {w.store_id && <option value={w.store_id}>{w.fitted_store || 'Where it was fitted'}</option>}
                                {stores.filter(s => s.vendor_details_id !== w.store_id).map(s => (
                                    <option key={s.vendor_details_id} value={s.vendor_details_id}>{s.store_name}{s.city ? ` · ${s.city}` : ''}</option>
                                ))}
                            </select>
                        )}
                        {store && <p className="text-xs text-gray-500">{store.store_name} will check it and call you.</p>}
                    </FormStep>

                    <div className="hidden sm:flex justify-end">{sendButton}</div>
                    <MobileActionBar>{sendButton}</MobileActionBar>
                </>
            )}
        </div>
    );
};

/* ─── One claim ──────────────────────────────────────────────────────────── */

const ClaimDetail = ({ claim, onBack, onChange }: { claim: Claim; onBack: () => void; onChange: (c: Claim) => void }) => {
    const { toast } = useToast();
    const [c, setC] = useState(claim);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        api.get(`/claims/${claim.id}`).then(r => { setC(r.data.claim); onChange(r.data.claim); }).catch(() => {});
    }, [claim.id]);

    const act = async (action: 'consent' | 'decline', note: string) => {
        setBusy(true);
        try {
            const r = await api.post(`/claims/${c.id}/action`, { action, agree: action === 'consent', note });
            setC(r.data.claim); onChange(r.data.claim);
            toast({ title: action === 'consent' ? 'Thank you' : 'Noted', description: action === 'consent' ? 'The plant will go ahead now.' : 'Nothing will be done on this claim.' });
        } catch (e) {
            toast({ variant: "destructive", title: "Could not save", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="mx-auto max-w-3xl space-y-4 pb-10">
            <button onClick={onBack} className="inline-flex h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"><ChevronLeft className="h-5 w-5" />My claims</button>

            <StatusHero c={c} who="customer" />

            {c.actions.includes('consent') && (
                <ConsentBox who="customer" busy={busy} onAgree={n => act('consent', n)} onDecline={n => act('decline', n)} />
            )}

            <StageDates c={c} />

            {c.store_name && (
                <section className="rounded-2xl border border-gray-200 bg-white p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Your store</p>
                    <p className="text-base font-extrabold text-gray-900">{c.store_name}</p>
                    {c.store_city && <p className="text-sm text-gray-600">{c.store_city}</p>}
                </section>
            )}

            <CompareTable c={c} who="customer" />

            <ChangeRequestBox c={c} />
            <ClaimChange c={c} who="customer" onSaved={n => { setC(n); onChange(n); }} />

            {c.kind === 'warranty' && c.snapshot?.cover_end && !['rejected', 'declined'].includes(c.status) && (
                <p className="rounded-xl bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">Your warranty stays the same: covered till {day(c.snapshot.cover_end)}. A replacement does not start a new period.</p>
            )}

            <details className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
                <summary className="cursor-pointer text-sm font-bold text-gray-900">Full history</summary>
                <div className="mt-3"><ClaimTimeline history={c.history} who="customer" /></div>
            </details>
            <StepJump label={c.actions.includes('consent') ? 'Your agreement is needed' : null} />
        </div>
    );
};

export default CustomerClaims;
