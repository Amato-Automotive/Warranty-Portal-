import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Loader2, Phone, Plus, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { decisionText, day, rupees, REJECT_REASONS, type Claim, type ClaimStatus, type ClaimWarranty } from "@/lib/claims";
import { ClaimStatusPill, ClaimSummary, ClaimTimeline, FilePicker, MediaGrid, ProblemPicker, ChoiceRow, claimForm } from "@/components/claims/ClaimParts";
import { RegistrationPanel } from "@/components/claims/RegistrationPanel";
import ClaimProcess from "@/pages/ClaimProcess";

const TABS: { key: string; label: string; statuses: ClaimStatus[] }[] = [
    { key: 'check', label: 'To check', statuses: ['inspect'] },
    { key: 'ho', label: 'With head office', statuses: ['decide', 'payment', 'send'] },
    { key: 'act', label: 'To repair / fit', statuses: ['repair', 'dispatched'] },
    { key: 'done', label: 'Done', statuses: ['fixed', 'closed', 'rejected'] },
];

/** The store's claims: check the car, send to head office, repair or fit, and raise for a customer. */
export const FranchiseClaims = () => {
    const { toast } = useToast();
    const [claims, setClaims] = useState<Claim[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('check');
    const [view, setView] = useState<'list' | 'raise' | 'how' | number>('list');

    const load = async () => {
        try {
            const r = await api.get('/claims/store');
            setClaims(r.data.claims ?? []);
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
        const c = claims.find(x => x.id === view);
        if (c) return <StoreClaim claim={c} onBack={() => setView('list')} onChange={put} />;
    }

    const shown = claims.filter(c => TABS.find(t => t.key === tab)!.statuses.includes(c.status));
    return (
        <div className="space-y-4 mb-6 mt-8 md:mt-14">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-gray-900">Warranty claim / alteration</h1>
                    <p className="text-sm text-gray-500">Check the car, send it to head office, then repair or fit.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="h-11 rounded-xl" onClick={() => setView('how')}>How it works</Button>
                    <Button className="h-11 rounded-xl bg-orange-700 hover:bg-orange-800 font-bold" onClick={() => setView('raise')}><Plus className="h-4 w-4 mr-1" />Raise for a customer</Button>
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                {TABS.map(t => {
                    const n = claims.filter(c => t.statuses.includes(c.status)).length;
                    return (
                        <button key={t.key} onClick={() => setTab(t.key)} className={cn("h-10 rounded-full px-4 text-sm font-semibold",
                            tab === t.key ? "bg-gray-900 text-white" : "border border-gray-300 bg-white text-gray-800")}>
                            {t.label}{n ? ` · ${n}` : ''}
                        </button>
                    );
                })}
            </div>
            {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-600" /></div>
                : !shown.length ? <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Nothing here.</p>
                    : (
                        <div className="grid gap-3 md:grid-cols-2">
                            {shown.map(c => (
                                <button key={c.id} onClick={() => setView(c.id)} className="text-left rounded-2xl border border-gray-200 bg-white p-4 hover:border-orange-300">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="text-xs font-bold text-gray-500">{c.claim_no}{c.kind === 'alteration' ? ' · Alteration' : ''}</span>
                                        <ClaimStatusPill status={c.status} who="store" />
                                    </div>
                                    <p className="mt-1 font-bold text-gray-900">{c.snapshot?.customer_name} · {c.snapshot?.product_name}</p>
                                    <p className="text-sm text-gray-500">{c.problem_text} · {c.raised_by_role === 'customer' ? 'raised by customer' : 'raised by you'} · {day(c.created_at)}</p>
                                </button>
                            ))}
                        </div>
                    )}
        </div>
    );
};

/* ─── One claim ──────────────────────────────────────────────────────────── */

const StoreClaim = ({ claim, onBack, onChange }: { claim: Claim; onBack: () => void; onChange: (c: Claim) => void }) => {
    const { toast } = useToast();
    const [c, setC] = useState(claim);
    const [busy, setBusy] = useState(false);
    const [photos, setPhotos] = useState<File[]>([]);
    const [covered, setCovered] = useState<'yes' | 'no' | ''>('');
    const [reason, setReason] = useState('');
    const [suggest, setSuggest] = useState<'repair_store' | 'send_material' | ''>('');
    const [note, setNote] = useState('');
    const [courier, setCourier] = useState('');
    const [tracking, setTracking] = useState('');

    useEffect(() => {
        api.get(`/claims/${claim.id}`).then(r => { setC(r.data.claim); onChange(r.data.claim); }).catch(() => {});
    }, [claim.id]);

    const done = (n: Claim, title: string) => { setC({ ...c, ...n }); onChange({ ...c, ...n }); setPhotos([]); setNote(''); toast({ title }); };
    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        try { await fn(); } catch (e) { toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again in a moment.") }); } finally { setBusy(false); }
    };
    const inspect = () => run(async () => {
        if (!covered) throw new Error('Say whether it is covered');
        const fd = await claimForm({ action: 'inspect', covered: covered === 'yes', reason, suggest: suggest || 'send_material', note }, { photos });
        const r = await api.post(`/claims/${c.id}/action`, fd);
        done(r.data.claim, 'Sent to head office');
    });
    const fixed = () => run(async () => {
        const fd = await claimForm({ action: 'fixed', note }, { photos });
        const r = await api.post(`/claims/${c.id}/action`, fd);
        done(r.data.claim, 'Marked fixed: the customer will be asked to confirm');
    });
    const oldPart = () => run(async () => {
        const fd = await claimForm({ courier, tracking, note }, { photos });
        const r = await api.post(`/claims/${c.id}/old-part`, fd);
        done(r.data.claim, c.decision?.old_part === 'return' ? 'Old part marked sent' : 'Old part marked scrapped');
    });

    const d = c.decision;
    const ask = useMemo(() => [...(c.history ?? [])].reverse().find(h => h.action === 'ask_more' && !h.undone && c.status === 'inspect'), [c]);
    const needsOldPart = d?.old_part && !c.old_part && ['repair', 'send', 'dispatched', 'fixed', 'closed', 'payment'].includes(c.status);

    return (
        <div className="space-y-4 mb-6 mt-8 md:mt-14">
            <button onClick={onBack} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold hover:bg-gray-100"><ChevronLeft className="h-4 w-4" />All claims</button>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                        <h2 className="text-xl font-extrabold text-gray-900">{c.claim_no} · {c.problem_text}{c.kind === 'alteration' ? ' (alteration)' : ''}</h2>
                        <ClaimSummary c={c} />
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        <ClaimStatusPill status={c.status} who="store" />
                        {c.counts && (
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
                                {c.counts.on_warranty > 1 ? `Claim ${c.counts.on_warranty} on this warranty` : '1st claim on this warranty'} · {c.counts.approved_before} approved before
                            </span>
                        )}
                        {c.snapshot?.customer_phone && (
                            <a href={`tel:${c.snapshot.customer_phone}`} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-900 no-underline hover:bg-gray-50">
                                <Phone className="h-4 w-4" />Call customer
                            </a>
                        )}
                    </div>
                </div>

                <RegistrationPanel c={c} who="store" />

                <section className="space-y-2">
                    <p className="text-sm font-bold text-gray-900">Now: {c.raised_by_role === 'customer' ? "customer's photos" : 'photos of the problem'}</p>
                    {c.description && <p className="text-sm text-gray-700">"{c.description}"</p>}
                    <MediaGrid urls={c.media} />
                    {!c.media?.length && <p className="text-sm text-gray-500">None sent.</p>}
                </section>

                {c.inspection && c.status !== 'inspect' && (
                    <section className="space-y-2">
                        <p className="text-sm font-bold text-gray-900">Your inspection</p>
                        <p className={cn("rounded-xl px-4 py-2.5 text-sm", c.inspection.covered ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900")}>
                            <b>{c.inspection.covered ? 'Covered' : `Not covered: ${REJECT_REASONS[c.inspection.reason ?? ''] ?? ''}`} · {c.inspection.suggest === 'repair_store' ? 'you suggested repair' : 'you suggested sending material'}.</b> {c.inspection.note}
                        </p>
                        <MediaGrid urls={c.inspection.photos} />
                    </section>
                )}

                {d && (
                    <section className={cn("rounded-xl px-4 py-3 text-sm space-y-1", d.outcome === 'reject' ? "bg-red-50 text-red-900" : "bg-gray-50 text-gray-800")}>
                        <p className="font-bold">Head office: {decisionText(c)}</p>
                        {d.note && <p>{d.note}</p>}
                        {c.status === 'payment' && <p className="font-semibold text-purple-800">Collect {rupees(d.amount)} from the customer for Autoform (UPI or bank transfer). Head office starts once it is received.</p>}
                        {c.dispatch?.courier && <p className="flex items-center gap-1.5"><Truck className="h-4 w-4 text-orange-600" />{[c.dispatch.courier, c.dispatch.tracking].filter(Boolean).join(' · ')}{c.dispatch.date ? ` · sent ${day(c.dispatch.date)}` : ''}</p>}
                        {d.old_part && <p>Old part: {d.old_part === 'return' ? 'send it back to the plant' : 'scrap it at the store (photo needed)'}{c.old_part ? ` · done ${day(c.old_part.at)}` : ''}</p>}
                    </section>
                )}

                {c.actions.includes('inspect') && (
                    <section className="border-t border-gray-200 pt-5 space-y-4">
                        <p className="text-base font-extrabold text-gray-900">Your inspection</p>
                        {ask?.note && <p className="rounded-xl bg-orange-50 px-4 py-2.5 text-sm text-orange-900"><b>Head office asks:</b> {ask.note}</p>}
                        <div className="space-y-1.5">
                            <p className="text-sm font-semibold">Your photos {c.inspection?.photos?.length ? '(add more)' : '(needed)'}</p>
                            <FilePicker files={photos} onChange={setPhotos} max={5} />
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-sm font-semibold">What you found</p>
                            <ChoiceRow<'yes' | 'no'> name="covered" value={covered} onChange={setCovered} options={[{ value: 'yes', label: 'Defect is real, covered' }, { value: 'no', label: 'Not covered as per T&C' }]} />
                            {covered === 'no' && (
                                <select value={reason} onChange={e => setReason(e.target.value)} aria-label="Why it is not covered" className="h-11 w-full max-w-md rounded-xl border border-gray-300 bg-white px-3 text-sm">
                                    <option value="">Why is it not covered?</option>
                                    {Object.entries(REJECT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                            )}
                        </div>
                        {covered === 'yes' && (
                            <div className="space-y-1.5">
                                <p className="text-sm font-semibold">You suggest</p>
                                <ChoiceRow<'repair_store' | 'send_material'> name="suggest" value={suggest} onChange={setSuggest}
                                    options={[{ value: 'repair_store', label: 'Repair at my store' }, { value: 'send_material', label: c.kind === 'alteration' ? 'Send alteration material' : 'Replace / send material' }]} />
                            </div>
                        )}
                        <label className="block space-y-1.5 text-sm font-semibold">Note for head office
                            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="font-normal" placeholder="What you saw, size of the problem, what is needed" />
                        </label>
                        <Button onClick={inspect} disabled={busy} className="h-12 rounded-xl bg-orange-700 hover:bg-orange-800 font-bold px-6">
                            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send to head office'}
                        </Button>
                    </section>
                )}

                {c.actions.includes('fixed') && (
                    <section className="border-t border-gray-200 pt-5 space-y-3">
                        <p className="text-base font-extrabold text-gray-900">{d?.outcome === 'repair_store' ? 'Repaired?' : 'Fitted?'}</p>
                        <FilePicker files={photos} onChange={setPhotos} max={5} hint="A photo after the work (optional)." />
                        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className="h-11 max-w-md" />
                        <Button onClick={fixed} disabled={busy} className="h-12 rounded-xl bg-orange-700 hover:bg-orange-800 font-bold px-6">
                            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : d?.outcome === 'repair_store' ? 'Mark repaired' : 'Mark fitted'}
                        </Button>
                    </section>
                )}

                {needsOldPart && (
                    <section className="border-t border-gray-200 pt-5 space-y-3">
                        <p className="text-base font-extrabold text-gray-900">Old part: {d!.old_part === 'return' ? 'send it back to the plant' : 'scrap it here'}</p>
                        {d!.old_part === 'return' ? (
                            <div className="flex flex-wrap gap-3">
                                <Input value={courier} onChange={e => setCourier(e.target.value)} placeholder="Sent by (courier, transport…)" className="h-11 max-w-xs" aria-label="Sent by" />
                                <Input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Tracking no." className="h-11 max-w-xs" aria-label="Tracking number" />
                            </div>
                        ) : <FilePicker files={photos} onChange={setPhotos} max={3} hint="A photo of the scrapped part." />}
                        <Button onClick={oldPart} disabled={busy} variant="outline" className="h-11 rounded-xl font-bold">
                            {d!.old_part === 'return' ? 'Mark old part sent' : 'Mark old part scrapped'}
                        </Button>
                    </section>
                )}
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
                <p className="text-sm font-bold text-gray-900">Timeline</p>
                <ClaimTimeline history={c.history} who="store" />
            </div>
        </div>
    );
};

/* ─── Raise for a customer ───────────────────────────────────────────────── */

const StoreRaise = ({ onBack, onDone }: { onBack: () => void; onDone: (c: Claim) => void }) => {
    const { toast } = useToast();
    const [q, setQ] = useState('');
    const [searching, setSearching] = useState(false);
    const [found, setFound] = useState<ClaimWarranty[] | null>(null);
    const [w, setW] = useState<ClaimWarranty | null>(null);
    const [problem, setProblem] = useState('');
    const [description, setDescription] = useState('');
    const [media, setMedia] = useState<File[]>([]);
    const [photos, setPhotos] = useState<File[]>([]);
    const [covered, setCovered] = useState<'yes' | 'no' | ''>('');
    const [reason, setReason] = useState('');
    const [suggest, setSuggest] = useState<'repair_store' | 'send_material' | ''>('');
    const [note, setNote] = useState('');
    const [sending, setSending] = useState(false);

    const options = w ? w.problems : [];
    useEffect(() => { setProblem(options.length === 1 ? options[0] : ''); }, [w]);

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
        if (!w || !problem) return toast({ variant: "destructive", title: "Choose the problem" });
        if (!photos.length) return toast({ variant: "destructive", title: "Add your inspection photos" });
        if (!covered) return toast({ variant: "destructive", title: "Say whether it is covered" });
        setSending(true);
        try {
            const fd = await claimForm({ warranty_uid: w.uid, problem, description, covered: covered === 'yes', reason, suggest: suggest || 'send_material', note }, { media, photos });
            const r = await api.post('/claims/store', fd);
            toast({ title: `Claim ${r.data.claim.claim_no} sent to head office`, description: 'The customer is told too.' });
            onDone(r.data.claim);
        } catch (e) {
            toast({ variant: "destructive", title: "Claim not raised", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="space-y-4 mb-6 mt-8 md:mt-14 max-w-3xl">
            <button onClick={onBack} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold hover:bg-gray-100"><ChevronLeft className="h-4 w-4" />All claims</button>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 space-y-5">
                <h2 className="text-xl font-extrabold text-gray-900">Raise for a customer</h2>
                <form onSubmit={e => { e.preventDefault(); search(); }} className="flex flex-wrap gap-2">
                    <label className="flex-1 min-w-[240px] space-y-1.5 text-sm font-semibold">Customer phone, UID or car number
                        <Input value={q} onChange={e => setQ(e.target.value)} className="h-11 font-normal" placeholder="98250 12345 · GJ06RH5445" />
                    </label>
                    <Button type="submit" disabled={searching || q.trim().length < 4} className="h-11 self-end rounded-xl bg-gray-900 font-bold">
                        {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="h-4 w-4 mr-1" />Find</>}
                    </Button>
                </form>

                {found && !found.length && <p className="text-sm text-gray-500">No warranty found. Check the number and try again.</p>}
                {found?.map(x => (
                    <label key={x.uid} className={cn("flex gap-3 rounded-2xl border bg-white p-4", x.claimable ? "cursor-pointer" : "opacity-60",
                        w?.uid === x.uid ? "border-2 border-orange-600" : "border-gray-200")}>
                        <input type="radio" name="sw" disabled={!x.claimable} checked={w?.uid === x.uid} onChange={() => setW(x)} className="mt-1 h-4 w-4 accent-orange-600" />
                        <span className="min-w-0 flex-1 text-sm">
                            <span className="block font-bold text-gray-900">{x.customer_name} · {x.product_name}</span>
                            <span className="block text-gray-600">{[x.car, x.registration_number, `UID ${x.uid}`].filter(Boolean).join(' · ')}</span>
                            <span className={cn("block text-xs font-semibold", x.covered ? "text-emerald-700" : "text-gray-500")}>{x.covered ? `Covered till ${day(x.cover_end)}` : x.claimable ? `${x.why} · alteration only` : x.why}{x.fitted_store ? ` · fitted by ${x.fitted_store}` : ''}</span>
                        </span>
                    </label>
                ))}

                {w && (
                    <>
                        <section className="space-y-2">
                            <p className="text-sm font-bold">The problem</p>
                            <ProblemPicker options={options} value={problem} onChange={setProblem} />
                            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="What the customer says" />
                        </section>
                        <section className="space-y-2">
                            <p className="text-sm font-bold">Your inspection photos (needed)</p>
                            <FilePicker files={photos} onChange={setPhotos} max={5} />
                            <p className="text-sm font-bold pt-2">Video or more photos (optional)</p>
                            <FilePicker files={media} onChange={setMedia} max={4} accept="image/*,video/*" label="Add file" />
                        </section>
                        <section className="space-y-2">
                            <p className="text-sm font-bold">What you found</p>
                            <ChoiceRow<'yes' | 'no'> name="scovered" value={covered} onChange={setCovered} options={[{ value: 'yes', label: 'Defect is real, covered' }, { value: 'no', label: 'Not covered as per T&C' }]} />
                            {covered === 'no' && (
                                <select value={reason} onChange={e => setReason(e.target.value)} aria-label="Why it is not covered" className="h-11 w-full max-w-md rounded-xl border border-gray-300 bg-white px-3 text-sm">
                                    <option value="">Why is it not covered?</option>
                                    {Object.entries(REJECT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                            )}
                            {covered === 'yes' && (
                                <ChoiceRow<'repair_store' | 'send_material'> name="ssuggest" value={suggest} onChange={setSuggest}
                                    options={[{ value: 'repair_store', label: 'Repair at my store' }, { value: 'send_material', label: 'Replace / send material' }]} />
                            )}
                            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Note for head office: what you saw and what is needed" />
                        </section>
                        <Button onClick={send} disabled={sending} className="h-12 rounded-xl bg-orange-700 hover:bg-orange-800 font-bold px-6">
                            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send to head office'}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
};

export default FranchiseClaims;
