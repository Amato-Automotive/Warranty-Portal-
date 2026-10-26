import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Eye, Loader2, Phone, Plus, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { decisionText, day, HOLD_REASONS, NEEDS_DESCRIPTION, PROBLEMS, type Claim, type ClaimStatus, type ClaimWarranty } from "@/lib/claims";
import {
    ChipRow, ClaimDetails, ClaimStatusPill, ClaimSummary, ClaimTimeline, ClaimTracker, ConsentBox, EMPTY_VEHICLE, FilePicker, MediaGrid,
    MobileActionBar, ProblemPicker, STEP_ID, StepJump, VehicleFields, claimForm, missingForRequest, type VehicleValue,
} from "@/components/claims/ClaimParts";
import { RegistrationPanel } from "@/components/claims/RegistrationPanel";
import ClaimProcess from "@/pages/ClaimProcess";

const TABS: { key: string; label: string; statuses: ClaimStatus[] }[] = [
    { key: 'verify', label: 'To verify', statuses: ['verify'] },
    { key: 'consent', label: 'Customer to agree', statuses: ['consent'] },
    { key: 'plant', label: 'With the plant', statuses: ['review', 'on_hold', 'plan', 'production', 'ready'] },
    { key: 'fit', label: 'To fit / repair', statuses: ['repair', 'dispatched'] },
    { key: 'done', label: 'Done', statuses: ['closed', 'rejected', 'declined'] },
];

/**
 * The store's claims: verify what customers request, get their agreement to a
 * charge, confirm fitting, and raise one for a customer at the counter. A
 * distributor also sees its stores' claims here, to follow, not to act on.
 */
export const FranchiseClaims = () => {
    const { toast } = useToast();
    const [claims, setClaims] = useState<Claim[]>([]);
    const [watched, setWatched] = useState<Claim[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('verify');
    const [view, setView] = useState<'list' | 'raise' | 'how' | number>('list');

    const load = async () => {
        try {
            const r = await api.get('/claims/store');
            setClaims(r.data.claims ?? []);
            setWatched(r.data.distributor_claims ?? []);
            if (!(r.data.claims ?? []).length && (r.data.distributor_claims ?? []).length) setTab('stores');
        } catch (e) {
            toast({ variant: "destructive", title: "Could not load claims", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);
    const put = (c: Claim) => setClaims(prev => prev.some(x => x.id === c.id) ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev]);

    if (view === 'how') return (
        <div className="space-y-2">
            <button onClick={() => setView('list')} className="mt-10 md:mt-16 ml-4 inline-flex h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold hover:bg-gray-100"><ChevronLeft className="h-4 w-4" />Back to claims</button>
            <ClaimProcess />
        </div>
    );
    if (view === 'raise') return <StoreRaise onBack={() => setView('list')} onDone={c => { put(c); setView(c.id); }} />;
    if (typeof view === 'number') {
        const c = claims.find(x => x.id === view) ?? watched.find(x => x.id === view);
        if (c) return <StoreClaim claim={c} onBack={() => setView('list')} onChange={put} />;
    }

    const tabs = watched.length ? [...TABS, { key: 'stores', label: "My stores' claims", statuses: [] as ClaimStatus[] }] : TABS;
    const shown = tab === 'stores' ? watched : claims.filter(c => TABS.find(t => t.key === tab)?.statuses.includes(c.status));
    return (
        <div className="space-y-4 mb-6 mt-8 md:mt-14">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-gray-900">Warranty claim / alteration</h1>
                    <p className="text-sm text-gray-500">Verify the request, the plant decides, then fit or repair.</p>
                </div>
                <div className="grid w-full grid-cols-[1fr_auto] gap-2 sm:flex sm:w-auto sm:flex-wrap">
                    <Button className="h-12 sm:h-11 rounded-xl bg-orange-700 hover:bg-orange-800 font-bold sm:order-2" onClick={() => setView('raise')}><Plus className="h-4 w-4 mr-1" />Request for a customer</Button>
                    <Button variant="outline" className="h-12 sm:h-11 rounded-xl sm:order-1" onClick={() => setView('how')}>How it works</Button>
                </div>
            </div>
            <ChipRow>
                {tabs.map(t => {
                    const n = t.key === 'stores' ? watched.length : claims.filter(c => t.statuses.includes(c.status)).length;
                    return (
                        <button key={t.key} onClick={() => setTab(t.key)} className={cn("h-10 whitespace-nowrap rounded-full px-4 text-sm font-semibold",
                            tab === t.key ? "bg-gray-900 text-white" : "border border-gray-300 bg-white text-gray-800")}>
                            {t.label}{n ? ` · ${n}` : ''}
                        </button>
                    );
                })}
            </ChipRow>
            {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-600" /></div>
                : !shown.length ? <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Nothing here.</p>
                    : (
                        <div className="grid gap-3 md:grid-cols-2">
                            {shown.map(c => (
                                <button key={c.id} onClick={() => setView(c.id)} className="text-left rounded-2xl border border-gray-200 bg-white p-4 hover:border-orange-300 active:bg-orange-50/40">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="text-xs font-bold text-gray-500">{c.claim_no}{c.kind === 'alteration' ? ' · Alteration' : ''}</span>
                                        <ClaimStatusPill status={c.status} who="store" />
                                    </div>
                                    <p className="mt-1 font-bold text-gray-900">{c.snapshot?.customer_name} · {c.snapshot?.product_name}</p>
                                    <p className="text-sm text-gray-500">
                                        {c.problem_text} · {c.watching ? (c.store_name ?? 'store') : c.raised_by_role === 'customer' ? 'requested by customer' : 'requested by you'} · {day(c.created_at)}
                                    </p>
                                    {c.plan && ['production', 'ready'].includes(c.status) && <p className="mt-1 text-xs font-semibold text-indigo-700">Expected by {day(c.plan.edd)}</p>}
                                    {c.dispatch && c.status === 'dispatched' && <p className="mt-1 text-xs font-semibold text-sky-700">Docket {c.dispatch.docket} · sent {day(c.dispatch.date)}</p>}
                                </button>
                            ))}
                        </div>
                    )}
        </div>
    );
};

/* ─── One claim ──────────────────────────────────────────────────────────── */

const vehicleOf = (c: Claim): VehicleValue => ({
    vehicle_make: c.vehicle?.make ?? '', vehicle_model: c.vehicle?.model ?? '', airbags: c.vehicle?.airbags ?? '',
});

const StoreClaim = ({ claim, onBack, onChange }: { claim: Claim; onBack: () => void; onChange: (c: Claim) => void }) => {
    const { toast } = useToast();
    const [c, setC] = useState(claim);
    const [busy, setBusy] = useState(false);
    const [photos, setPhotos] = useState<File[]>([]);
    const [note, setNote] = useState('');
    // The store's corrections, starting from what the customer sent.
    const [vehicle, setVehicle] = useState<VehicleValue>(vehicleOf(claim));
    const [problem, setProblem] = useState(claim.problem);
    const [description, setDescription] = useState(claim.description ?? '');

    useEffect(() => {
        api.get(`/claims/${claim.id}`).then(r => {
            setC(r.data.claim); onChange(r.data.claim);
            setVehicle(vehicleOf(r.data.claim)); setProblem(r.data.claim.problem); setDescription(r.data.claim.description ?? '');
        }).catch(() => {});
    }, [claim.id]);

    const step = async (fields: Record<string, unknown>, title: string, files: File[] = []) => {
        setBusy(true);
        try {
            const fd = await claimForm(fields, { photos: files });
            const r = await api.post(`/claims/${c.id}/action`, fd);
            const n = { ...c, ...r.data.claim };
            setC(n); onChange(n); setPhotos([]); setNote('');
            toast({ title });
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setBusy(false);
        }
    };

    const d = c.decision;
    const ask = useMemo(() => [...(c.history ?? [])].reverse().find(h => h.action === 'ask_more' && !h.undone && c.status === 'verify'), [c]);
    const airbags = c.snapshot?.product_type === 'seat-cover';

    return (
        <div className="space-y-4 mb-6 mt-8 md:mt-14">
            <button onClick={onBack} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold hover:bg-gray-100"><ChevronLeft className="h-4 w-4" />All claims</button>
            {c.watching && (
                <p className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2.5 text-sm text-blue-900"><Eye className="h-4 w-4" />A claim at {c.store_name ?? 'one of your stores'}. You can follow it here; the store and the plant act on it.</p>
            )}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 md:p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                        <h2 className="text-lg sm:text-xl font-extrabold text-gray-900">{c.claim_no} · {c.problem_text}{c.kind === 'alteration' ? ' (alteration)' : ''}</h2>
                        <ClaimSummary c={c} />
                    </div>
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-col sm:items-end">
                        <ClaimStatusPill status={c.status} who="store" />
                        {c.counts && (
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
                                {c.counts.on_warranty > 1 ? `Claim ${c.counts.on_warranty} on this warranty` : '1st claim on this warranty'} · {c.counts.approved_before} approved before
                            </span>
                        )}
                        {c.snapshot?.customer_phone && !c.watching && (
                            <a href={`tel:${c.snapshot.customer_phone}`} className="inline-flex h-11 sm:h-10 w-full sm:w-auto justify-center items-center gap-1.5 rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-900 no-underline hover:bg-gray-50">
                                <Phone className="h-4 w-4" />Call customer
                            </a>
                        )}
                    </div>
                </div>

                <ClaimTracker c={c} />

                <RegistrationPanel c={c} who="store" />

                <section className="space-y-2">
                    <p className="text-sm font-bold text-gray-900">{c.raised_by_role === 'customer' ? 'What the customer sent' : 'The request'}</p>
                    <ClaimDetails c={c} />
                    <MediaGrid urls={c.media} />
                </section>

                {c.verification && c.status !== 'verify' && (
                    <section className="space-y-1.5 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-800">
                        <p className="font-bold">Store verification</p>
                        {c.verification.remarks && <p>{c.verification.remarks}</p>}
                        {c.verification.corrections.length > 0 && <ul className="list-disc pl-5 text-xs text-gray-600">{c.verification.corrections.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                        <MediaGrid urls={c.verification.photos} />
                    </section>
                )}

                {c.status === 'on_hold' && c.hold && (
                    <p className="rounded-xl bg-yellow-50 px-4 py-3 text-sm text-yellow-900"><b>On hold at the plant: {HOLD_REASONS[c.hold.reason] ?? 'see note'}.</b> {c.hold.note}</p>
                )}
                {d && (
                    <section className={cn("rounded-xl px-4 py-3 text-sm space-y-1", d.outcome === 'reject' ? "bg-red-50 text-red-900" : "bg-gray-50 text-gray-800")}>
                        <p className="font-bold">Plant: {decisionText(c)}</p>
                        {d.remarks && <p>{d.remarks}</p>}
                        {c.consent && <p>{c.consent.agreed ? 'Charge agreed' : 'Charge declined'} by the {c.consent.by === 'customer' ? 'customer' : 'store for the customer'} · {day(c.consent.at)}</p>}
                        {c.plan && <p>Expected by <b>{day(c.plan.edd)}</b>{c.plan.alteration_no ? ` · alteration no. ${c.plan.alteration_no}` : ''}</p>}
                        {c.dispatch && <p className="flex items-center gap-1.5"><Truck className="h-4 w-4 text-orange-600" />Sent {day(c.dispatch.date)} · docket <b>{c.dispatch.docket}</b>{c.dispatch.courier ? ` · ${c.dispatch.courier}` : ''}</p>}
                    </section>
                )}

                {c.actions.includes('verify') && (
                    <section id={STEP_ID} className="scroll-mt-20 border-t border-gray-200 pt-5 space-y-4">
                        <p className="text-base font-extrabold text-gray-900">Verify and send to the plant</p>
                        {ask?.note && <p className="rounded-xl bg-orange-50 px-4 py-2.5 text-sm text-orange-900"><b>The plant asks:</b> {ask.note}</p>}
                        <div className="space-y-1.5">
                            <p className="text-sm font-semibold">Vehicle (correct it if needed)</p>
                            <VehicleFields value={vehicle} onChange={setVehicle} airbags={airbags} registered={c.snapshot?.car} />
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-sm font-semibold">Issue (correct it if needed)</p>
                            <ProblemPicker options={Object.keys(PROBLEMS)} value={problem} onChange={setProblem} />
                            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder={NEEDS_DESCRIPTION.includes(problem) ? 'Describe the problem (needed)' : 'Description'} />
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-sm font-semibold">Your photos (optional)</p>
                            <FilePicker files={photos} onChange={setPhotos} max={5} />
                        </div>
                        <label className="block space-y-1.5 text-sm font-semibold">Remarks for the plant
                            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="font-normal" placeholder="What you saw, how big the problem is, what is needed" />
                        </label>
                        <Button disabled={busy} className="h-12 w-full sm:w-auto rounded-xl bg-orange-700 hover:bg-orange-800 font-bold px-6"
                            onClick={() => step({ action: 'verify', note, problem, description, ...vehicle }, 'Verified and sent to the plant', photos)}>
                            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Verified, send to the plant'}
                        </Button>
                    </section>
                )}

                {c.actions.includes('consent') && (
                    <ConsentBox who="store" busy={busy}
                        onAgree={n => step({ action: 'consent', agree: true, note: n }, 'Agreement recorded: the plant goes ahead')}
                        onDecline={n => step({ action: 'decline', note: n }, 'Recorded that the customer declined')} />
                )}

                {c.actions.includes('fitted') && (
                    <section id={STEP_ID} className="scroll-mt-20 border-t border-gray-200 pt-5 space-y-3">
                        <p className="text-base font-extrabold text-gray-900">{d?.outcome === 'repair_store' ? 'Repaired?' : 'Reached and fitted?'}</p>
                        <FilePicker files={photos} onChange={setPhotos} max={5} hint="A photo after the work (optional)." />
                        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className="h-11 max-w-md" />
                        <Button disabled={busy} className="h-12 w-full sm:w-auto rounded-xl bg-orange-700 hover:bg-orange-800 font-bold px-6"
                            onClick={() => step({ action: 'fitted', note }, d?.outcome === 'repair_store' ? 'Marked repaired: claim closed' : 'Marked fitted: claim closed', photos)}>
                            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : d?.outcome === 'repair_store' ? 'Mark repaired' : 'It reached us and is fitted'}
                        </Button>
                    </section>
                )}
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 space-y-3">
                <p className="text-sm font-bold text-gray-900">Timeline</p>
                <ClaimTimeline history={c.history} who="store" />
            </div>
            <StepJump label={c.actions.includes('verify') ? 'Verify and send to the plant'
                : c.actions.includes('consent') ? "Record the customer's answer"
                    : c.actions.includes('fitted') ? (d?.outcome === 'repair_store' ? 'Mark repaired' : 'Mark reached and fitted') : null} />
        </div>
    );
};

/* ─── Request for a customer ─────────────────────────────────────────────── */

const StoreRaise = ({ onBack, onDone }: { onBack: () => void; onDone: (c: Claim) => void }) => {
    const { toast } = useToast();
    const [q, setQ] = useState('');
    const [searching, setSearching] = useState(false);
    // The store's own approved warranties, listed straight away; typing filters them.
    const [own, setOwn] = useState<ClaimWarranty[] | null>(null);
    // Results of a search across all stores, for a car fitted somewhere else.
    const [found, setFound] = useState<ClaimWarranty[] | null>(null);
    const [w, setW] = useState<ClaimWarranty | null>(null);
    const [vehicle, setVehicle] = useState<VehicleValue>(EMPTY_VEHICLE);
    const [problem, setProblem] = useState('');
    const [description, setDescription] = useState('');
    const [media, setMedia] = useState<File[]>([]);
    const [remarks, setRemarks] = useState('');
    const [sending, setSending] = useState(false);

    const options = w ? w.problems : [];
    useEffect(() => { setProblem(options.length === 1 ? options[0] : ''); setVehicle(EMPTY_VEHICLE); }, [w]);

    useEffect(() => {
        api.get('/claims/store/warranties').then(r => setOwn(r.data.warranties ?? [])).catch(() => setOwn([]));
    }, []);
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    const shownOwn = (own ?? []).filter(x => !needle
        || [x.customer_name, x.registration_number, x.uid, x.product_name].some(f => String(f ?? '').toLowerCase().includes(needle))
        || (digits.length >= 4 && String(x.customer_phone ?? '').replace(/\D/g, '').includes(digits)));
    const pickRow = (x: ClaimWarranty) => (
        <label key={x.uid} className={cn("flex gap-3 rounded-2xl border bg-white p-4", x.claimable ? "cursor-pointer" : "opacity-60",
            w?.uid === x.uid ? "border-2 border-orange-600" : "border-gray-200")}>
            <input type="radio" name="sw" disabled={!x.claimable} checked={w?.uid === x.uid} onChange={() => setW(x)} className="mt-1 h-4 w-4 accent-orange-600" />
            <span className="min-w-0 flex-1 text-sm">
                <span className="block font-bold text-gray-900">{x.customer_name} · {x.product_name}</span>
                <span className="block text-gray-600">{[x.registration_number, x.customer_phone, `UID ${x.uid}`].filter(Boolean).join(' · ')}</span>
                <span className={cn("block text-xs font-semibold", x.covered ? "text-emerald-700" : "text-gray-500")}>{x.covered ? `Covered till ${day(x.cover_end)}` : x.claimable ? `${x.why} · alteration only` : x.why}{x.fitted_store ? ` · fitted by ${x.fitted_store}` : ''}</span>
            </span>
        </label>
    );

    const search = async () => {
        setSearching(true);
        try {
            const r = await api.get('/claims/store/search', { params: { q } });
            setFound(r.data.warranties ?? []);
            setW(null);
        } catch (e) {
            toast({ variant: "destructive", title: "Search failed", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setSearching(false);
        }
    };
    const send = async () => {
        if (!w) return;
        const missing = missingForRequest({ problem, description, vehicle, airbags: w.asks_airbags, photos: media.filter(f => f.type.startsWith('image/')).length });
        if (missing) return toast({ variant: "destructive", title: missing });
        setSending(true);
        try {
            const fd = await claimForm({ warranty_uid: w.uid, problem, description, remarks, ...vehicle }, { media });
            const r = await api.post('/claims/store', fd);
            toast({ title: `Claim ${r.data.claim.claim_no} sent to the plant`, description: 'The customer is told too.' });
            onDone(r.data.claim);
        } catch (e) {
            toast({ variant: "destructive", title: "Claim not sent", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="space-y-4 mb-6 mt-8 md:mt-14 max-w-3xl">
            <button onClick={onBack} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold hover:bg-gray-100"><ChevronLeft className="h-4 w-4" />All claims</button>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 md:p-6 space-y-5">
                <h2 className="text-xl font-extrabold text-gray-900">Request for a customer</h2>
                {/* Once a warranty is chosen the list folds away, so the form is right below it on a phone. */}
                {w ? (
                    <section className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-bold text-gray-900">Warranty</p>
                            <button type="button" onClick={() => setW(null)} className="h-10 rounded-lg px-3 text-sm font-semibold text-orange-700 hover:bg-orange-50">Change</button>
                        </div>
                        {pickRow(w)}
                    </section>
                ) : <>
                <form onSubmit={e => { e.preventDefault(); if (q.trim().length >= 4) search(); }} className="flex flex-wrap gap-2">
                    <label className="flex-1 min-w-[240px] space-y-1.5 text-sm font-semibold">Customer name, phone, UID or car number
                        <Input value={q} onChange={e => { setQ(e.target.value); setFound(null); }} className="h-11 font-normal" placeholder="Type to filter your list · 98250 12345 · GJ06RH5445" />
                    </label>
                    <Button type="submit" variant="outline" disabled={searching || q.trim().length < 4} className="h-11 self-end rounded-xl font-bold">
                        {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="h-4 w-4 mr-1" />Search all stores</>}
                    </Button>
                </form>

                {found ? (
                    <section className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-bold text-gray-900">Search results, all stores</p>
                            <button type="button" onClick={() => setFound(null)} className="text-sm font-semibold text-orange-700 hover:underline">Back to your list</button>
                        </div>
                        {!found.length && <p className="text-sm text-gray-500">No warranty found. Check the number and try again.</p>}
                        {found.map(pickRow)}
                    </section>
                ) : (
                    <section className="space-y-2">
                        <p className="text-sm font-bold text-gray-900">
                            Your store's approved warranties{own ? ` · ${needle ? `${shownOwn.length} of ${own.length}` : own.length}` : ''}
                        </p>
                        {own === null ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-orange-600" /></div>
                            : !shownOwn.length ? (
                                <p className="text-sm text-gray-500">
                                    {own.length ? 'None of your warranties match.' : 'No approved warranties at your store yet.'} Fitted somewhere else? Type the phone, UID or car number and press Search all stores.
                                </p>
                            ) : (
                                <div className="space-y-2 sm:max-h-[420px] sm:overflow-y-auto sm:pr-1">{shownOwn.slice(0, 100).map(pickRow)}</div>
                            )}
                        {shownOwn.length > 100 && <p className="text-xs text-gray-500">Showing the newest 100. Type to narrow the list.</p>}
                    </section>
                )}
                </>}

                {w && (
                    <>
                        <section className="space-y-2">
                            <p className="text-sm font-bold">Vehicle</p>
                            <VehicleFields value={vehicle} onChange={setVehicle} airbags={w.asks_airbags} registered={w.car} />
                        </section>
                        <section className="space-y-2">
                            <p className="text-sm font-bold">Issue</p>
                            <ProblemPicker options={options} value={problem} onChange={setProblem} />
                            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder={NEEDS_DESCRIPTION.includes(problem) ? 'Describe the problem (needed)' : 'What the customer says (optional)'} />
                        </section>
                        <section className="space-y-2">
                            <p className="text-sm font-bold">Photos and video (at least one photo)</p>
                            <FilePicker files={media} onChange={setMedia} max={6} accept="image/*,video/*" label="Add file" />
                        </section>
                        <section className="space-y-2">
                            <p className="text-sm font-bold">Your remarks for the plant</p>
                            <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={3} placeholder="What you checked and what is needed" />
                        </section>
                        <Button onClick={send} disabled={sending} className="hidden sm:flex h-12 rounded-xl bg-orange-700 hover:bg-orange-800 font-bold px-6">
                            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send to the plant'}
                        </Button>
                        <MobileActionBar>
                            <Button onClick={send} disabled={sending} className="h-12 w-full rounded-xl bg-orange-700 hover:bg-orange-800 text-base font-bold">
                                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send to the plant'}
                            </Button>
                        </MobileActionBar>
                    </>
                )}
            </div>
        </div>
    );
};

export default FranchiseClaims;
