import { useEffect, useState } from "react";
import { ChevronLeft, Loader2, Phone, Search, Truck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { decisionText, day, rupees, REJECT_REASONS, type Claim, type ClaimStatus } from "@/lib/claims";
import { ClaimStatusPill, ClaimSummary, ClaimTimeline, MediaGrid, ChoiceRow } from "@/components/claims/ClaimParts";
import { RegistrationPanel } from "@/components/claims/RegistrationPanel";

const CARDS: { status: ClaimStatus | ''; label: string }[] = [
    { status: 'decide', label: 'To decide' },
    { status: 'inspect', label: 'With store' },
    { status: 'payment', label: 'Awaiting payment' },
    { status: 'send', label: 'To send' },
    { status: 'dispatched', label: 'On the way' },
    { status: 'repair', label: 'Store to repair' },
    { status: 'fixed', label: 'Fixed' },
    { status: '', label: 'All' },
];

/** Head office: every claim, the decision, payment, dispatch, and undo. */
export const AdminClaims = () => {
    const { toast } = useToast();
    const [claims, setClaims] = useState<(Claim & { store_name?: string })[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [status, setStatus] = useState<ClaimStatus | ''>('decide');
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState<number | null>(null);

    const load = async (s = status, query = q) => {
        setLoading(true);
        try {
            const r = await api.get('/claims/admin/all', { params: { status: s || undefined, q: query || undefined } });
            setClaims(r.data.claims ?? []);
            setCounts(r.data.counts ?? {});
        } catch (e) {
            toast({ variant: "destructive", title: "Could not load claims", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, [status]);

    if (open !== null) return <AdminClaim id={open} onBack={() => { setOpen(null); load(); }} />;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-gray-900">Warranty Claim / Alteration</h1>
                    <p className="text-sm text-gray-500">Warranty claims and alteration requests from customers and stores</p>
                </div>
                <form onSubmit={e => { e.preventDefault(); load(status, q); }} className="flex gap-2">
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Claim no., UID, phone, car no., name" className="h-11 w-72 max-w-full" aria-label="Search claims" />
                    <Button type="submit" variant="outline" className="h-11" aria-label="Search"><Search className="h-4 w-4" /></Button>
                </form>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {CARDS.map(c => (
                    <button key={c.label} onClick={() => setStatus(c.status)} className={cn("rounded-xl border bg-white p-3 text-left",
                        status === c.status ? "border-2 border-orange-600" : "border-gray-200")}>
                        <p className="text-xs font-semibold text-gray-500">{c.label}</p>
                        <p className="text-xl font-extrabold text-gray-900">{c.status ? counts[c.status] ?? 0 : total}</p>
                    </button>
                ))}
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
                {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-600" /></div>
                    : !claims.length ? <p className="p-10 text-center text-sm text-gray-500">No claims here.</p>
                        : (
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-left text-xs font-bold uppercase text-gray-500">
                                    <tr><th className="px-4 py-3">Claim</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Store</th><th className="px-4 py-3">Raised</th><th className="px-4 py-3">Status</th></tr>
                                </thead>
                                <tbody>
                                    {claims.map(c => (
                                        <tr key={c.id} onClick={() => setOpen(c.id)} className="border-t border-gray-100 cursor-pointer hover:bg-orange-50/40">
                                            <td className="px-4 py-3"><button className="font-bold text-gray-900 hover:underline" onClick={() => setOpen(c.id)}>{c.claim_no}</button><div className="text-xs text-gray-500">{c.problem_text}{c.kind === 'alteration' ? ' · alteration' : ''}</div></td>
                                            <td className="px-4 py-3">{c.snapshot?.customer_name}<div className="text-xs text-gray-500">{c.snapshot?.registration_number}</div></td>
                                            <td className="px-4 py-3">{c.snapshot?.product_name}</td>
                                            <td className="px-4 py-3">{c.store_name ?? '—'}</td>
                                            <td className="px-4 py-3 whitespace-nowrap">{day(c.created_at)}<div className="text-xs text-gray-500">{c.raised_by_role === 'customer' ? 'by customer' : c.raised_by_role === 'vendor' ? 'by store' : 'by HO'}</div></td>
                                            <td className="px-4 py-3"><ClaimStatusPill status={c.status} who="admin" /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
            </div>
        </div>
    );
};

/* ─── One claim ──────────────────────────────────────────────────────────── */

type Outcome = 'repair_store' | 'send_material' | 'reject';

const AdminClaim = ({ id, onBack }: { id: number; onBack: () => void }) => {
    const { toast } = useToast();
    const { hasPermission } = useAuth() as any;
    const canWrite = hasPermission ? hasPermission('claims', 'write') : true;
    const [c, setC] = useState<Claim | null>(null);
    const [busy, setBusy] = useState(false);
    const [f, setF] = useState<Record<string, string>>({});
    const set = (k: string) => (v: string) => setF(p => ({ ...p, [k]: v }));

    const load = () => api.get(`/claims/${id}`).then(r => setC(r.data.claim)).catch(e => toast({ variant: "destructive", title: "Could not load", description: getErrorMessage(e, "") }));
    useEffect(() => { load(); }, [id]);
    useEffect(() => {
        if (!c) return;
        const d = c.decision;
        setF({
            outcome: c.inspection?.covered === false ? 'reject' : (c.inspection?.suggest ?? ''),
            charge: c.kind === 'alteration' ? 'chargeable' : 'foc', material: c.kind === 'alteration' ? 'alteration' : 'replacement',
            source: 'plant', old_part: '', reason: c.inspection?.reason ?? '', item: c.snapshot?.product_name ?? '',
            edit_note: d?.note ?? '', edit_amount: d?.amount ? String(d.amount) : '', edit_item: d?.item ?? '',
            courier: c.dispatch?.courier ?? '', tracking: c.dispatch?.tracking ?? '', date: c.dispatch?.date ?? new Date().toISOString().slice(0, 10),
        });
    }, [c?.id, c?.status]);

    const act = async (action: string, body: Record<string, unknown>, title: string) => {
        setBusy(true);
        try {
            const r = await api.post(`/claims/${id}/action`, { action, ...body });
            setC(prev => ({ ...prev!, ...r.data.claim }));
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
    const has = (a: string) => canWrite && c.actions.includes(a as any);
    const decide = () => {
        if (f.outcome === 'reject') return act('reject', { reason: f.reason, note: f.note }, 'Rejected: the store and customer are told');
        return act('approve', {
            outcome: f.outcome, charge: f.charge, amount: f.amount, material: f.material, item: f.item,
            source: f.source, distributor: f.distributor, old_part: f.old_part || null, note: f.note,
        }, 'Approved: the store and customer are told');
    };

    return (
        <div className="space-y-4">
            <button onClick={onBack} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold hover:bg-gray-100"><ChevronLeft className="h-4 w-4" />All claims</button>
            <div className="flex flex-wrap gap-5 items-start">
                <div className="flex-[999_1_560px] min-w-0 rounded-2xl border border-gray-200 bg-white p-5 md:p-6 space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                            <h2 className="text-xl font-extrabold text-gray-900">{c.claim_no} · {c.problem_text}{c.kind === 'alteration' ? ' (alteration)' : ''}</h2>
                            <ClaimSummary c={c} />
                            <p className="text-sm text-gray-500">Store: {c.store_name ?? '—'}{c.store_city ? `, ${c.store_city}` : ''} · raised {c.raised_by_role === 'customer' ? 'by the customer' : c.raised_by_role === 'vendor' ? 'by the store' : 'by head office'} on {day(c.created_at)}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <ClaimStatusPill status={c.status} who="admin" />
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

                    <RegistrationPanel c={c} who="admin" />

                    <p className="text-base font-extrabold text-gray-900">Now: the claim</p>
                    <div className="grid gap-4 md:grid-cols-2">
                        <section className="space-y-2">
                            <p className="text-sm font-bold">{c.raised_by_role === 'customer' ? 'Customer sent' : 'Problem photos'}</p>
                            {c.description && <p className="text-sm text-gray-700">"{c.description}"</p>}
                            <MediaGrid urls={c.media} className="sm:grid-cols-3" />
                            {!c.media?.length && <p className="text-sm text-gray-500">None.</p>}
                        </section>
                        <section className="space-y-2">
                            <p className="text-sm font-bold">Store inspection{c.inspection ? ` · ${day(c.inspection.at)}` : ''}</p>
                            {c.inspection ? (
                                <>
                                    <MediaGrid urls={c.inspection.photos} className="sm:grid-cols-3" />
                                    <p className={cn("rounded-xl px-3 py-2.5 text-sm", c.inspection.covered ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900")}>
                                        <b>{c.inspection.covered ? `Covered · suggests ${c.inspection.suggest === 'repair_store' ? 'repair at store' : 'sending material'}.` : `Not covered: ${REJECT_REASONS[c.inspection.reason ?? ''] ?? ''}.`}</b> {c.inspection.note}
                                    </p>
                                </>
                            ) : <p className="text-sm text-gray-500">Waiting for the store to check the car.</p>}
                        </section>
                    </div>

                    {d && (
                        <section className={cn("rounded-xl px-4 py-3 text-sm space-y-1", d.outcome === 'reject' ? "bg-red-50 text-red-900" : "bg-gray-50 text-gray-800")}>
                            <p className="font-bold">{decisionText(c)}</p>
                            {d.note && <p>{d.note}</p>}
                            {c.payment && <p>Paid by {c.payment.mode.toUpperCase()}{c.payment.ref ? ` · ${c.payment.ref}` : ''} · {day(c.payment.at)}</p>}
                            {c.dispatch?.courier && <p className="flex items-center gap-1.5"><Truck className="h-4 w-4 text-orange-600" />{[c.dispatch.courier, c.dispatch.tracking].filter(Boolean).join(' · ')}{c.dispatch.date ? ` · ${day(c.dispatch.date)}` : ''}</p>}
                            {d.old_part && <p>Old part: {d.old_part === 'return' ? 'return to plant' : 'scrap at store'} · {c.old_part ? `${c.old_part.done} ${day(c.old_part.at)}${c.old_part.courier ? ` · ${[c.old_part.courier, c.old_part.tracking].filter(Boolean).join(' · ')}` : ''}` : 'store has not done it yet'}</p>}
                            {c.old_part?.photos?.length ? <MediaGrid urls={c.old_part.photos} className="pt-1" /> : null}
                            {c.fixed && <p>{d.outcome === 'repair_store' ? 'Repaired' : 'Fitted'} {day(c.fixed.at)}{c.fixed.note ? ` · ${c.fixed.note}` : ''}</p>}
                            {c.fixed?.photos?.length ? <MediaGrid urls={c.fixed.photos} className="pt-1" /> : null}
                        </section>
                    )}

                    {has('approve') && (
                        <section className="border-t border-gray-200 pt-5 space-y-4">
                            <p className="text-base font-extrabold text-gray-900">Your decision</p>
                            <ChoiceRow<Outcome> name="outcome" value={f.outcome as Outcome} onChange={set('outcome')}
                                options={[{ value: 'repair_store', label: 'Approve: repair at store' }, { value: 'send_material', label: 'Approve: send material' }, { value: 'reject', label: 'Reject' }]} />
                            {f.outcome && f.outcome !== 'reject' && (
                                <>
                                    <ChoiceRow<'foc' | 'chargeable'> name="charge" value={f.charge as any} onChange={set('charge')} options={[{ value: 'foc', label: 'FOC (free)' }, { value: 'chargeable', label: 'Chargeable' }]} />
                                    {f.charge === 'chargeable' && (
                                        <label className="block max-w-xs space-y-1.5 text-sm font-semibold">Amount the customer pays (₹)
                                            <Input inputMode="decimal" value={f.amount ?? ''} onChange={e => set('amount')(e.target.value)} className="h-11 font-normal" />
                                        </label>
                                    )}
                                    {f.outcome === 'send_material' && (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <label className="space-y-1.5 text-sm font-semibold">What is sent
                                                <select value={f.material} onChange={e => set('material')(e.target.value)} className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-normal">
                                                    <option value="replacement">Replacement (same SKU)</option><option value="repaired">Repaired product</option><option value="alteration">Alteration material</option>
                                                </select>
                                            </label>
                                            <label className="space-y-1.5 text-sm font-semibold">Item
                                                <Input value={f.item ?? ''} onChange={e => set('item')(e.target.value)} className="h-11 font-normal" placeholder="e.g. U-CREST driver seat set, black" />
                                            </label>
                                            <label className="space-y-1.5 text-sm font-semibold">From
                                                <select value={f.source} onChange={e => set('source')(e.target.value)} className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-normal">
                                                    <option value="plant">Plant</option><option value="distributor">Distributor</option>
                                                </select>
                                            </label>
                                            {f.source === 'distributor' && (
                                                <label className="space-y-1.5 text-sm font-semibold">Which distributor
                                                    <Input value={f.distributor ?? ''} onChange={e => set('distributor')(e.target.value)} className="h-11 font-normal" />
                                                </label>
                                            )}
                                        </div>
                                    )}
                                    <div className="space-y-1.5">
                                        <p className="text-sm font-semibold">Old part</p>
                                        <ChoiceRow<'' | 'return' | 'scrap'> name="old" value={f.old_part as any} onChange={set('old_part')}
                                            options={[{ value: '', label: 'Not needed' }, { value: 'return', label: 'Return to plant' }, { value: 'scrap', label: 'Scrap at store' }]} />
                                    </div>
                                </>
                            )}
                            {f.outcome === 'reject' && (
                                <label className="block max-w-md space-y-1.5 text-sm font-semibold">Reason from the T&amp;C (the customer sees it)
                                    <select value={f.reason} onChange={e => set('reason')(e.target.value)} className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-normal">
                                        <option value="">Choose the reason</option>
                                        {Object.entries(REJECT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                    </select>
                                </label>
                            )}
                            <label className="block space-y-1.5 text-sm font-semibold">Note to the customer and store
                                <Textarea value={f.note ?? ''} onChange={e => set('note')(e.target.value)} rows={2} className="font-normal" />
                            </label>
                            <div className="flex flex-wrap gap-2">
                                <Button onClick={decide} disabled={busy || !f.outcome} className="h-12 rounded-xl bg-orange-700 hover:bg-orange-800 font-bold px-6">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Save decision'}</Button>
                                {has('ask_more') && <Button variant="outline" disabled={busy} className="h-12 rounded-xl" onClick={() => act('ask_more', { note: f.note }, 'Sent back to the store')}>Ask store for more</Button>}
                            </div>
                            <p className="text-xs text-gray-500">"Ask store for more" sends the note above to the store and returns the claim to them.</p>
                        </section>
                    )}

                    {has('reject') && !has('approve') && (
                        <section className="border-t border-gray-200 pt-5 space-y-3">
                            <p className="text-sm text-gray-600">The store has not checked the car yet. You can still reject it now, if it is clearly not covered.</p>
                            <div className="flex flex-wrap gap-2">
                                <select value={f.reason} onChange={e => set('reason')(e.target.value)} aria-label="Reason" className="h-11 rounded-xl border border-gray-300 bg-white px-3 text-sm">
                                    <option value="">Reason from the T&amp;C</option>
                                    {Object.entries(REJECT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                                <Input value={f.note ?? ''} onChange={e => set('note')(e.target.value)} placeholder="Note" className="h-11 max-w-xs" aria-label="Note" />
                                <Button variant="outline" disabled={busy || !f.reason} className="h-11 rounded-xl" onClick={() => act('reject', { reason: f.reason, note: f.note }, 'Rejected')}>Reject</Button>
                            </div>
                        </section>
                    )}

                    {has('paid') && (
                        <section className="border-t border-gray-200 pt-5 space-y-3">
                            <p className="text-base font-extrabold text-gray-900">Payment of {rupees(d?.amount)}</p>
                            <div className="flex flex-wrap gap-2 items-end">
                                <select value={f.mode ?? ''} onChange={e => set('mode')(e.target.value)} aria-label="Paid by" className="h-11 rounded-xl border border-gray-300 bg-white px-3 text-sm">
                                    <option value="">Paid by</option><option value="upi">UPI</option><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="other">Other</option>
                                </select>
                                <Input value={f.ref ?? ''} onChange={e => set('ref')(e.target.value)} placeholder="UTR / reference" className="h-11 max-w-xs" aria-label="Reference" />
                                <Button disabled={busy || !f.mode} onClick={() => act('paid', { mode: f.mode, ref: f.ref }, 'Marked paid')} className="h-11 rounded-xl bg-gray-900 font-bold">Mark paid</Button>
                            </div>
                        </section>
                    )}

                    {has('dispatch') && (
                        <section className="border-t border-gray-200 pt-5 space-y-3">
                            <p className="text-base font-extrabold text-gray-900">Dispatch {d?.item ? `· ${d.item}` : ''}</p>
                            <div className="flex flex-wrap gap-2 items-end">
                                <Input value={f.courier ?? ''} onChange={e => set('courier')(e.target.value)} placeholder="Sent by (courier…)" className="h-11 max-w-[200px]" aria-label="Sent by" />
                                <Input value={f.tracking ?? ''} onChange={e => set('tracking')(e.target.value)} placeholder="Tracking no." className="h-11 max-w-[200px]" aria-label="Tracking number" />
                                <Input type="date" value={f.date ?? ''} onChange={e => set('date')(e.target.value)} className="h-11 max-w-[170px]" aria-label="Date sent" />
                                <Button disabled={busy} onClick={() => act('dispatch', { courier: f.courier, tracking: f.tracking, date: f.date }, 'Marked dispatched')} className="h-11 rounded-xl bg-gray-900 font-bold">Mark dispatched</Button>
                            </div>
                        </section>
                    )}

                    {(has('fixed') || has('close')) && (
                        <section className="border-t border-gray-200 pt-5 flex flex-wrap items-center gap-2">
                            {has('fixed') && <Button variant="outline" disabled={busy} className="h-11 rounded-xl" onClick={() => act('fixed', { note: 'Marked by head office' }, 'Marked fixed')}>Mark {d?.outcome === 'repair_store' ? 'repaired' : 'fitted'} for the store</Button>}
                            {has('close') && <Button disabled={busy} className="h-11 rounded-xl bg-gray-900 font-bold" onClick={() => act('close', {}, 'Claim closed')}>Close the claim</Button>}
                            {has('close') && <p className="text-xs text-gray-500">The customer can also close it from their dashboard.</p>}
                        </section>
                    )}

                    {has('edit') && (
                        <details className="border-t border-gray-200 pt-4">
                            <summary className="cursor-pointer text-sm font-bold text-gray-800">Edit the decision</summary>
                            <div className="mt-3 space-y-3">
                                <Textarea value={f.edit_note ?? ''} onChange={e => set('edit_note')(e.target.value)} rows={2} placeholder="Note to the customer and store" aria-label="Note" />
                                <div className="flex flex-wrap gap-2">
                                    {d?.outcome === 'send_material' && <Input value={f.edit_item ?? ''} onChange={e => set('edit_item')(e.target.value)} placeholder="Item" className="h-11 max-w-xs" aria-label="Item" />}
                                    {c.status === 'payment' && <Input value={f.edit_amount ?? ''} onChange={e => set('edit_amount')(e.target.value)} placeholder="Amount ₹" className="h-11 max-w-[140px]" aria-label="Amount" />}
                                    {c.dispatch && <>
                                        <Input value={f.courier ?? ''} onChange={e => set('courier')(e.target.value)} placeholder="Courier" className="h-11 max-w-[180px]" aria-label="Courier" />
                                        <Input value={f.tracking ?? ''} onChange={e => set('tracking')(e.target.value)} placeholder="Tracking" className="h-11 max-w-[180px]" aria-label="Tracking" />
                                    </>}
                                    <Button variant="outline" disabled={busy} className="h-11 rounded-xl" onClick={() => act('edit', {
                                        note: f.edit_note, ...(d?.outcome === 'send_material' ? { item: f.edit_item } : {}),
                                        ...(c.status === 'payment' ? { amount: f.edit_amount } : {}),
                                        ...(c.dispatch ? { courier: f.courier, tracking: f.tracking, date: c.dispatch.date } : {}),
                                    }, 'Saved')}>Save changes</Button>
                                </div>
                            </div>
                        </details>
                    )}
                </div>

                <div className="flex-[1_1_280px] min-w-0 rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-extrabold text-gray-900">Timeline</p>
                        {has('undo') && (
                            <Button variant="outline" size="sm" disabled={busy} className="h-9 rounded-lg" onClick={() => act('undo', {}, 'Last step undone')}>
                                <Undo2 className="h-4 w-4 mr-1" />Undo last step
                            </Button>
                        )}
                    </div>
                    <ClaimTimeline history={c.history} who="admin" />
                </div>
            </div>
        </div>
    );
};

export default AdminClaims;
