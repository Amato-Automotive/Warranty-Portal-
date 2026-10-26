import { useEffect, useState } from "react";
import { ChevronLeft, Eye, Loader2, Phone, Search, Truck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { decisionText, day, HOLD_REASONS, PROBLEMS, REJECT_REASONS, type Claim, type ClaimStatus, type PlantRight } from "@/lib/claims";
import { ClaimDetails, ClaimStatusPill, ClaimSummary, ClaimTimeline, ClaimTracker, MediaGrid, ChoiceRow, ProblemPicker, STEP_ID, StepJump, VehicleFields, type VehicleValue } from "@/components/claims/ClaimParts";
import { RegistrationPanel } from "@/components/claims/RegistrationPanel";
import { PlantTeam } from "@/components/admin/claims/PlantTeam";

/** The plant's queues, in the order the work flows. */
const CARDS: { statuses: ClaimStatus[]; label: string; right?: PlantRight }[] = [
    { statuses: ['review'], label: 'To decide', right: 'decide' },
    { statuses: ['on_hold'], label: 'On hold', right: 'decide' },
    { statuses: ['plan'], label: 'To set EDD', right: 'plan' },
    { statuses: ['production'], label: 'Being prepared', right: 'plan' },
    { statuses: ['ready'], label: 'Ready to dispatch', right: 'dispatch' },
    { statuses: ['dispatched'], label: 'Dispatched' },
    { statuses: ['verify'], label: 'With store' },
    { statuses: ['consent'], label: 'Customer to agree' },
    { statuses: ['repair'], label: 'Store to repair' },
    { statuses: ['closed'], label: 'Closed' },
    { statuses: ['rejected', 'declined'], label: 'Rejected / declined' },
    { statuses: [], label: 'All' },
];

const RIGHT_TEXT: Record<PlantRight, string> = { decide: 'Decide', plan: 'EDD, alteration no. & ready', dispatch: 'Dispatch', edit: 'Edit & undo' };

/**
 * The plant (MFU): every claim, and the steps each person's rights allow —
 * deciding, the EDD and alteration number, dispatch, and edits with a reason.
 * Anyone with only Warranty Claims read (and the depots) sees it all, read-only.
 */
export const AdminClaims = () => {
    const { toast } = useToast();
    const { user } = useAuth() as any;
    // The team is run by super admins, who alone can change admin access.
    const [tab, setTab] = useState<'claims' | 'team'>('claims');
    const [claims, setClaims] = useState<(Claim & { store_name?: string })[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [rights, setRights] = useState<PlantRight[] | null>(null);
    const [card, setCard] = useState<number | null>(null);
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState<number | null>(null);

    const load = async (i = card, query = q) => {
        setLoading(true);
        try {
            const statuses = i === null ? [] : CARDS[i].statuses;
            const r = await api.get('/claims/admin/all', { params: { status: statuses.join(',') || undefined, q: query || undefined } });
            setClaims(r.data.claims ?? []);
            setCounts(r.data.counts ?? {});
            if (rights === null) {
                const rs: PlantRight[] = r.data.rights ?? [];
                setRights(rs);
                // Open on the first queue this person works, once.
                if (i === null) {
                    const first = CARDS.findIndex(c => c.right && rs.includes(c.right));
                    if (first >= 0) { setCard(first); return; }
                    setCard(CARDS.length - 1);
                }
            }
        } catch (e) {
            toast({ variant: "destructive", title: "Could not load claims", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, [card]);

    if (open !== null) return <AdminClaim id={open} onBack={() => { setOpen(null); load(); }} />;
    const tabs = user?.isSuperAdmin && (
        <div className="flex gap-2" role="tablist">
            {([['claims', 'Claims'], ['team', 'Plant team']] as const).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-10 rounded-full px-4 text-sm font-semibold",
                    tab === k ? "bg-gray-900 text-white" : "border border-gray-300 bg-white text-gray-800")}>{label}</button>
            ))}
        </div>
    );
    if (tab === 'team') return (
        <div className="space-y-5">
            <div>
                <h1 className="text-2xl font-extrabold text-gray-900">Warranty Claim / Alteration</h1>
                <p className="text-sm text-gray-500">Plant team: who sees claims and which steps they take</p>
            </div>
            {tabs}
            <PlantTeam />
        </div>
    );
    const countOf = (s: ClaimStatus[]) => s.length ? s.reduce((n, x) => n + (counts[x] ?? 0), 0) : Object.values(counts).reduce((a, b) => a + b, 0);

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-gray-900">Warranty Claim / Alteration</h1>
                    <p className="text-sm text-gray-500">
                        {rights === null ? 'Loading…' : rights.length ? `Your part: ${rights.map(r => RIGHT_TEXT[r]).join(' · ')}` : 'View only: you see every claim and its activity'}
                    </p>
                </div>
                <form onSubmit={e => { e.preventDefault(); load(card, q); }} className="flex w-full gap-2 sm:w-auto">
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Claim no., UID, phone, car no., name, store, docket" className="h-11 min-w-0 flex-1 sm:w-80 sm:flex-none" aria-label="Search claims" />
                    <Button type="submit" variant="outline" className="h-11 shrink-0" aria-label="Search"><Search className="h-4 w-4" /></Button>
                </form>
            </div>
            {tabs}
            {/* A sideways strip on a phone; a grid of counts on wider screens. */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 sm:grid sm:grid-cols-4 sm:overflow-visible lg:grid-cols-6 xl:grid-cols-12">
                {CARDS.map((c, i) => (
                    <button key={c.label} onClick={() => setCard(i)} className={cn("w-[112px] shrink-0 sm:w-auto rounded-xl border bg-white p-3 text-left",
                        card === i ? "border-2 border-orange-600" : "border-gray-200", c.right && rights?.includes(c.right) && "bg-orange-50/40")}>
                        <p className="text-xs font-semibold text-gray-500 leading-tight">{c.label}</p>
                        <p className="text-xl font-extrabold text-gray-900">{countOf(c.statuses)}</p>
                    </button>
                ))}
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
                {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-600" /></div>
                    : !claims.length ? <p className="p-10 text-center text-sm text-gray-500">No claims here.</p>
                        : <>
                            {/* On a phone each claim is a card; the table needs a wide screen. */}
                            <ul className="divide-y divide-gray-100 md:hidden">
                                {claims.map(c => (
                                    <li key={c.id}>
                                        <button onClick={() => setOpen(c.id)} className="w-full p-4 text-left active:bg-orange-50/40">
                                            <div className="flex items-start justify-between gap-2">
                                                <span className="text-xs font-bold text-gray-500">{c.claim_no} · {day(c.created_at)}</span>
                                                <ClaimStatusPill status={c.status} who="admin" />
                                            </div>
                                            <p className="mt-1 font-bold text-gray-900">{c.snapshot?.customer_name} · {c.snapshot?.product_name}</p>
                                            <p className="text-sm text-gray-600">{c.problem_text}{c.kind === 'alteration' ? ' · alteration' : ''}</p>
                                            <p className="text-xs text-gray-500">{[c.store_name, [c.vehicle?.make, c.vehicle?.model].filter(Boolean).join(' ') || c.snapshot?.registration_number].filter(Boolean).join(' · ')}</p>
                                            {c.plan && ['production', 'ready'].includes(c.status) && <p className="mt-1 text-xs font-semibold text-indigo-700">EDD {day(c.plan.edd)}</p>}
                                            {c.dispatch && c.status === 'dispatched' && <p className="mt-1 text-xs font-semibold text-sky-700">Docket {c.dispatch.docket}</p>}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <table className="hidden md:table w-full text-sm">
                                <thead className="bg-gray-50 text-left text-xs font-bold uppercase text-gray-500">
                                    <tr><th className="px-4 py-3">Claim</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Store</th><th className="px-4 py-3">Requested</th><th className="px-4 py-3">Status</th></tr>
                                </thead>
                                <tbody>
                                    {claims.map(c => (
                                        <tr key={c.id} onClick={() => setOpen(c.id)} className="border-t border-gray-100 cursor-pointer hover:bg-orange-50/40">
                                            <td className="px-4 py-3"><button className="font-bold text-gray-900 hover:underline" onClick={() => setOpen(c.id)}>{c.claim_no}</button><div className="text-xs text-gray-500">{c.problem_text}{c.kind === 'alteration' ? ' · alteration' : ''}</div></td>
                                            <td className="px-4 py-3">{c.snapshot?.customer_name}<div className="text-xs text-gray-500">{[c.vehicle?.make, c.vehicle?.model].filter(Boolean).join(' ') || c.snapshot?.registration_number}</div></td>
                                            <td className="px-4 py-3">{c.snapshot?.product_name}</td>
                                            <td className="px-4 py-3">{c.store_name ?? '—'}</td>
                                            <td className="px-4 py-3 whitespace-nowrap">{day(c.created_at)}<div className="text-xs text-gray-500">{c.raised_by_role === 'customer' ? 'by customer' : c.raised_by_role === 'vendor' ? 'by store' : 'by plant'}</div></td>
                                            <td className="px-4 py-3">
                                                <ClaimStatusPill status={c.status} who="admin" />
                                                {c.plan && ['production', 'ready'].includes(c.status) && <div className="mt-1 text-xs text-gray-500">EDD {day(c.plan.edd)}</div>}
                                                {c.dispatch && c.status === 'dispatched' && <div className="mt-1 text-xs text-gray-500">Docket {c.dispatch.docket}</div>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </>}
            </div>
        </div>
    );
};

/* ─── One claim ──────────────────────────────────────────────────────────── */

type Choice = 'approve' | 'hold' | 'reject' | 'ask_more';
const today = () => new Date().toISOString().slice(0, 10);
const Field = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
    <label className={cn("block space-y-1.5 text-sm font-semibold", className)}>{label}{children}</label>
);
const SELECT = "h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-normal";

const AdminClaim = ({ id, onBack }: { id: number; onBack: () => void }) => {
    const { toast } = useToast();
    const [c, setC] = useState<Claim | null>(null);
    const [busy, setBusy] = useState(false);
    const [f, setF] = useState<Record<string, string>>({});
    const set = (k: string) => (v: string) => setF(p => ({ ...p, [k]: v }));
    const [vehicle, setVehicle] = useState<VehicleValue>({ vehicle_make: '', vehicle_model: '', airbags: '' });

    const load = () => api.get(`/claims/${id}`).then(r => setC(r.data.claim)).catch(e => toast({ variant: "destructive", title: "Could not load", description: getErrorMessage(e, "") }));
    useEffect(() => { load(); }, [id]);
    useEffect(() => {
        if (!c) return;
        // Each form starts from what the claim holds now.
        setF({
            choice: '', outcome: '', charge: c.kind === 'alteration' ? 'chargeable' : 'foc', source: 'plant', item: '', remarks: '',
            reason: '', hold_reason: '', note: '',
            edd: c.plan?.edd ?? '', alteration_no: c.plan?.alteration_no ?? '',
            dispatch_date: c.dispatch?.date ?? today(), docket: c.dispatch?.docket ?? '', courier: c.dispatch?.courier ?? '',
            e_problem: c.problem, e_description: c.description ?? '', e_remarks: c.decision?.remarks ?? '', e_item: c.decision?.item ?? '',
            e_edd: c.plan?.edd ?? '', e_alteration_no: c.plan?.alteration_no ?? '',
            e_dispatch_date: c.dispatch?.date ?? '', e_docket: c.dispatch?.docket ?? '', e_courier: c.dispatch?.courier ?? '',
            e_reason: '', undo_reason: '',
        });
        setVehicle({ vehicle_make: c.vehicle?.make ?? '', vehicle_model: c.vehicle?.model ?? '', airbags: c.vehicle?.airbags ?? '' });
    }, [c?.id, c?.status, c?.history?.length]);

    const act = async (action: string, body: Record<string, unknown>, title: string) => {
        setBusy(true);
        try {
            await api.post(`/claims/${id}/action`, { action, ...body });
            await load();
            toast({ title });
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setBusy(false);
        }
    };

    if (!c) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-orange-600" /></div>;
    const d = c.decision;
    const has = (a: string) => c.actions.includes(a as any);
    const deciding = has('approve') || has('hold') || has('reject') || has('ask_more');
    const viewOnly = !c.actions.length;
    // The first step this person can take; a phone gets a button that jumps to it.
    const step = deciding ? 'decide' : has('plan') ? 'plan' : has('ready') ? 'ready' : has('dispatch') ? 'dispatch' : null;
    const stepId = (k: string) => step === k ? STEP_ID : undefined;
    const STEP_LABEL: Record<string, string> = { decide: 'Your decision', plan: 'Set EDD and alteration no.', ready: 'Mark ready to dispatch', dispatch: 'Dispatch' };

    const decide = () => {
        switch (f.choice as Choice) {
            case 'approve': return act('approve', { outcome: f.outcome, charge: f.charge, item: f.item, source: f.source, remarks: f.remarks }, 'Approved: the store and customer are told');
            case 'hold': return act('hold', { reason: f.hold_reason, note: f.note }, 'Put on hold');
            case 'reject': return act('reject', { reason: f.reason, note: f.note }, 'Rejected: the store and customer are told');
            case 'ask_more': return act('ask_more', { note: f.note }, 'Sent back to the store');
        }
    };
    const choices: { value: Choice; label: string }[] = ([
        { value: 'approve', label: 'Approve' }, { value: 'hold', label: 'Put on hold' }, { value: 'reject', label: 'Reject' }, { value: 'ask_more', label: 'Ask store for more' },
    ] as { value: Choice; label: string }[]).filter(x => has(x.value));

    return (
        <div className="space-y-4">
            <button onClick={onBack} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold hover:bg-gray-100"><ChevronLeft className="h-4 w-4" />All claims</button>
            {viewOnly && <p className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2.5 text-sm text-blue-900"><Eye className="h-4 w-4" />{c.waiting_on ? `Waiting for: ${c.waiting_on}.` : 'Nothing to do on this claim.'} Your access here is to view.</p>}
            <div className="flex flex-wrap gap-5 items-start">
                <div className="flex-[999_1_560px] min-w-0 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 md:p-6 space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                            <h2 className="text-lg sm:text-xl font-extrabold text-gray-900">{c.claim_no} · {c.problem_text}{c.kind === 'alteration' ? ' (alteration)' : ''}</h2>
                            <ClaimSummary c={c} />
                            <p className="text-sm text-gray-500">Store: {c.store_name ?? '—'}{c.store_city ? `, ${c.store_city}` : ''} · requested {c.raised_by_role === 'customer' ? 'by the customer' : c.raised_by_role === 'vendor' ? 'by the store' : 'by the plant'} on {day(c.created_at)}</p>
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto sm:flex-col sm:items-end">
                            <ClaimStatusPill status={c.status} who="admin" />
                            {c.waiting_on && <span className="text-xs font-semibold text-gray-500">Waiting for: {c.waiting_on}</span>}
                            {c.snapshot?.customer_phone && <a href={`tel:${c.snapshot.customer_phone}`} className="inline-flex items-center gap-1 text-sm font-semibold text-gray-700"><Phone className="h-4 w-4" />{c.snapshot.customer_phone}</a>}
                        </div>
                    </div>

                    {c.counts && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {[['Claims on this warranty', c.counts.on_warranty], ['Approved before', c.counts.approved_before], ['Rejected before', c.counts.rejected_before], ['This customer, all products', c.counts.customer_total]].map(([l, n]) => (
                                <div key={l as string} className="rounded-xl bg-gray-50 p-3"><p className="text-xs font-semibold text-gray-500">{l}</p><p className="text-lg font-extrabold text-gray-900">{n}</p></div>
                            ))}
                        </div>
                    )}

                    <ClaimTracker c={c} />

                    <RegistrationPanel c={c} who="admin" />

                    <p className="text-base font-extrabold text-gray-900">Now: the claim</p>
                    <div className="grid gap-4 md:grid-cols-2">
                        <section className="space-y-2">
                            <p className="text-sm font-bold">{c.raised_by_role === 'customer' ? 'Customer sent' : 'The request'}</p>
                            <ClaimDetails c={c} />
                            <MediaGrid urls={c.media} className="sm:grid-cols-3" />
                            {!c.media?.length && <p className="text-sm text-gray-500">No photos.</p>}
                        </section>
                        <section className="space-y-2">
                            <p className="text-sm font-bold">Store verification{c.verification ? ` · ${day(c.verification.at)}` : ''}</p>
                            {c.verification ? (
                                <>
                                    {c.verification.remarks && <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-800">{c.verification.remarks}</p>}
                                    {c.verification.corrections.length > 0 && (
                                        <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                                            <p className="font-bold">The store corrected:</p>
                                            <ul className="list-disc pl-5">{c.verification.corrections.map((x, i) => <li key={i}>{x}</li>)}</ul>
                                        </div>
                                    )}
                                    <MediaGrid urls={c.verification.photos} className="sm:grid-cols-3" />
                                </>
                            ) : <p className="text-sm text-gray-500">Waiting for the store to verify.</p>}
                        </section>
                    </div>

                    {c.status === 'on_hold' && c.hold && (
                        <p className="rounded-xl bg-yellow-50 px-4 py-3 text-sm text-yellow-900"><b>On hold: {HOLD_REASONS[c.hold.reason] ?? 'see note'}.</b> {c.hold.note} · since {day(c.hold.at)}</p>
                    )}
                    {d && (
                        <section className={cn("rounded-xl px-4 py-3 text-sm space-y-1", d.outcome === 'reject' ? "bg-red-50 text-red-900" : "bg-gray-50 text-gray-800")}>
                            <p className="font-bold">{decisionText(c)}</p>
                            {d.remarks && <p>{d.remarks}</p>}
                            {c.consent && <p>Charge {c.consent.agreed ? 'agreed' : 'declined'} by the {c.consent.by === 'customer' ? 'customer' : 'store on the customer\'s behalf'} · {day(c.consent.at)}{c.consent.note ? ` · ${c.consent.note}` : ''}</p>}
                            {c.plan && <p>EDD <b>{day(c.plan.edd)}</b>{c.plan.alteration_no ? ` · alteration no. ${c.plan.alteration_no}` : ''}</p>}
                            {c.dispatch && <p className="flex items-center gap-1.5"><Truck className="h-4 w-4 text-orange-600" />Dispatched {day(c.dispatch.date)} · docket <b>{c.dispatch.docket}</b>{c.dispatch.courier ? ` · ${c.dispatch.courier}` : ''}</p>}
                            {c.fitted && <p>{d.outcome === 'repair_store' ? 'Repaired' : 'Fitted'} {day(c.fitted.at)}{c.fitted.note ? ` · ${c.fitted.note}` : ''}</p>}
                            {c.fitted?.photos?.length ? <MediaGrid urls={c.fitted.photos} className="pt-1" /> : null}
                        </section>
                    )}

                    {deciding && (
                        <section id={stepId('decide')} className="scroll-mt-20 border-t border-gray-200 pt-5 space-y-4">
                            <p className="text-base font-extrabold text-gray-900">Your decision</p>
                            <ChoiceRow<Choice> name="choice" value={f.choice as Choice} onChange={set('choice')} options={choices} />
                            {f.choice === 'approve' && (
                                <div className="space-y-3">
                                    <ChoiceRow<'repair_store' | 'send_material'> name="outcome" value={f.outcome as any} onChange={set('outcome')}
                                        options={[{ value: 'send_material', label: 'Send material from the plant' }, { value: 'repair_store', label: 'Store repairs it' }]} />
                                    <ChoiceRow<'foc' | 'chargeable'> name="charge" value={f.charge as any} onChange={set('charge')} options={[{ value: 'foc', label: 'Free of cost' }, { value: 'chargeable', label: 'Chargeable' }]} />
                                    {f.charge === 'chargeable' && <p className="text-xs text-purple-800">The customer (or the store for them) must agree to the charge before anything goes ahead. Payment is taken at the store.</p>}
                                    {f.outcome === 'send_material' && (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <Field label="Material (optional)"><Input value={f.item} onChange={e => set('item')(e.target.value)} className="h-11 font-normal" placeholder="e.g. driver seat set, black" /></Field>
                                            <Field label="From">
                                                <select value={f.source} onChange={e => set('source')(e.target.value)} className={SELECT}><option value="plant">Plant</option><option value="distributor">Distributor</option></select>
                                            </Field>
                                        </div>
                                    )}
                                    <Field label="Remarks (the store and customer see them)"><Textarea value={f.remarks} onChange={e => set('remarks')(e.target.value)} rows={2} className="font-normal" /></Field>
                                </div>
                            )}
                            {f.choice === 'hold' && (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Why on hold">
                                        <select value={f.hold_reason} onChange={e => set('hold_reason')(e.target.value)} className={SELECT}>
                                            <option value="">Choose</option>{Object.entries(HOLD_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Note"><Input value={f.note} onChange={e => set('note')(e.target.value)} className="h-11 font-normal" /></Field>
                                </div>
                            )}
                            {f.choice === 'reject' && (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Reason from the T&C (the customer sees it)">
                                        <select value={f.reason} onChange={e => set('reason')(e.target.value)} className={SELECT}>
                                            <option value="">Choose the reason</option>{Object.entries(REJECT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Note"><Input value={f.note} onChange={e => set('note')(e.target.value)} className="h-11 font-normal" /></Field>
                                </div>
                            )}
                            {f.choice === 'ask_more' && (
                                <Field label="What the store should send or check"><Textarea value={f.note} onChange={e => set('note')(e.target.value)} rows={2} className="font-normal" /></Field>
                            )}
                            {f.choice && (
                                <Button onClick={decide} disabled={busy} className="h-12 w-full sm:w-auto rounded-xl bg-orange-700 hover:bg-orange-800 font-bold px-6">
                                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Save'}
                                </Button>
                            )}
                        </section>
                    )}

                    {has('plan') && (
                        <section id={stepId('plan')} className="scroll-mt-20 border-t border-gray-200 pt-5 space-y-3">
                            <p className="text-base font-extrabold text-gray-900">EDD and alteration number</p>
                            <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
                                <Field label="Expected delivery date"><Input type="date" value={f.edd} onChange={e => set('edd')(e.target.value)} className="h-11 font-normal" /></Field>
                                <Field label="Alteration no."><Input value={f.alteration_no} onChange={e => set('alteration_no')(e.target.value)} className="h-11 font-normal" /></Field>
                                <Button disabled={busy} onClick={() => act('plan', { edd: f.edd, alteration_no: f.alteration_no }, 'EDD saved: the store and customer are told')} className="h-12 sm:h-11 w-full sm:w-auto rounded-xl bg-gray-900 font-bold">Save</Button>
                            </div>
                        </section>
                    )}

                    {has('ready') && (
                        <section id={stepId('ready')} className="scroll-mt-20 border-t border-gray-200 pt-5 flex flex-wrap items-center gap-3">
                            <p className="text-base font-extrabold text-gray-900">Being prepared{c.plan ? ` · EDD ${day(c.plan.edd)}` : ''}</p>
                            <Button disabled={busy} onClick={() => act('ready', {}, 'Marked ready to dispatch')} className="h-12 sm:h-11 w-full sm:w-auto rounded-xl bg-gray-900 font-bold">Mark ready to dispatch</Button>
                        </section>
                    )}

                    {has('dispatch') && (
                        <section id={stepId('dispatch')} className="scroll-mt-20 border-t border-gray-200 pt-5 space-y-3">
                            <p className="text-base font-extrabold text-gray-900">Dispatch{d?.item ? ` · ${d.item}` : ''}</p>
                            <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
                                <Field label="Dispatch date"><Input type="date" value={f.dispatch_date} onChange={e => set('dispatch_date')(e.target.value)} className="h-11 font-normal" /></Field>
                                <Field label="Docket no."><Input value={f.docket} onChange={e => set('docket')(e.target.value)} className="h-11 font-normal" /></Field>
                                <Field label="Courier (optional)"><Input value={f.courier} onChange={e => set('courier')(e.target.value)} className="h-11 font-normal" /></Field>
                                <Button disabled={busy} onClick={() => act('dispatch', { dispatch_date: f.dispatch_date, docket: f.docket, courier: f.courier }, 'Dispatched: the store and customer are told')} className="h-12 sm:h-11 w-full sm:w-auto rounded-xl bg-gray-900 font-bold">Mark dispatched</Button>
                            </div>
                        </section>
                    )}

                    {has('fitted') && (
                        <section className="border-t border-gray-200 pt-5 flex flex-wrap items-center gap-2">
                            <Button variant="outline" disabled={busy} className="h-12 sm:h-11 w-full sm:w-auto rounded-xl" onClick={() => act('fitted', { note: 'Marked by the plant for the store' }, 'Marked done')}>
                                Mark {d?.outcome === 'repair_store' ? 'repaired' : 'fitted'} for the store
                            </Button>
                            <p className="text-xs text-gray-500">Normally the store confirms this.</p>
                        </section>
                    )}

                    {has('edit') && (
                        <details className="border-t border-gray-200 pt-4">
                            <summary className="cursor-pointer text-sm font-bold text-gray-800">Edit details (with a reason)</summary>
                            <div className="mt-3 space-y-3">
                                <VehicleFields value={vehicle} onChange={setVehicle} airbags={c.snapshot?.product_type === 'seat-cover'} />
                                <ProblemPicker options={Object.keys(PROBLEMS)} value={f.e_problem} onChange={set('e_problem')} />
                                <Textarea value={f.e_description} onChange={e => set('e_description')(e.target.value)} rows={2} placeholder="Description" aria-label="Description" />
                                {d && d.outcome !== 'reject' && (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <Field label="Plant remarks"><Input value={f.e_remarks} onChange={e => set('e_remarks')(e.target.value)} className="h-11 font-normal" /></Field>
                                        {d.outcome === 'send_material' && <Field label="Material"><Input value={f.e_item} onChange={e => set('e_item')(e.target.value)} className="h-11 font-normal" /></Field>}
                                    </div>
                                )}
                                {c.plan && (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <Field label="EDD"><Input type="date" value={f.e_edd} onChange={e => set('e_edd')(e.target.value)} className="h-11 font-normal" /></Field>
                                        <Field label="Alteration no."><Input value={f.e_alteration_no} onChange={e => set('e_alteration_no')(e.target.value)} className="h-11 font-normal" /></Field>
                                    </div>
                                )}
                                {c.dispatch && (
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <Field label="Dispatch date"><Input type="date" value={f.e_dispatch_date} onChange={e => set('e_dispatch_date')(e.target.value)} className="h-11 font-normal" /></Field>
                                        <Field label="Docket no."><Input value={f.e_docket} onChange={e => set('e_docket')(e.target.value)} className="h-11 font-normal" /></Field>
                                        <Field label="Courier"><Input value={f.e_courier} onChange={e => set('e_courier')(e.target.value)} className="h-11 font-normal" /></Field>
                                    </div>
                                )}
                                <Field label="Reason for the change (needed)"><Input value={f.e_reason} onChange={e => set('e_reason')(e.target.value)} className="h-11 font-normal" /></Field>
                                <Button variant="outline" disabled={busy} className="h-11 rounded-xl font-bold" onClick={() => act('edit', {
                                    note: f.e_reason, ...vehicle, problem: f.e_problem, description: f.e_description,
                                    ...(d && d.outcome !== 'reject' ? { remarks: f.e_remarks, ...(d.outcome === 'send_material' ? { item: f.e_item } : {}) } : {}),
                                    ...(c.plan ? { edd: f.e_edd, alteration_no: f.e_alteration_no } : {}),
                                    ...(c.dispatch ? { dispatch_date: f.e_dispatch_date, docket: f.e_docket, courier: f.e_courier } : {}),
                                }, 'Changes saved')}>Save changes</Button>
                            </div>
                        </details>
                    )}
                </div>

                <div className="flex-[1_1_280px] min-w-0 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 space-y-4">
                    <p className="text-sm font-extrabold text-gray-900">Timeline</p>
                    {has('undo') && (
                        <div className="flex gap-2">
                            <Input value={f.undo_reason ?? ''} onChange={e => set('undo_reason')(e.target.value)} placeholder="Why undo the last step?" className="h-9" aria-label="Reason to undo" />
                            <Button variant="outline" size="sm" disabled={busy || (f.undo_reason ?? '').trim().length < 3} className="h-9 rounded-lg shrink-0"
                                onClick={() => act('undo', { note: f.undo_reason }, 'Last step undone')}>
                                <Undo2 className="h-4 w-4 mr-1" />Undo
                            </Button>
                        </div>
                    )}
                    <ClaimTimeline history={c.history} who="admin" />
                </div>
            </div>
            <StepJump label={step ? STEP_LABEL[step] : null} />
        </div>
    );
};

export default AdminClaims;
