import { useEffect, useState } from "react";
import { ChevronLeft, Eye, Loader2, Pencil, Phone, RefreshCw, Search, Settings, Truck, Undo2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import api, { getErrorMessage } from "@/lib/api";
import { cn, formatToIST } from "@/lib/utils";
import { decisionText, day, HOLD_REASONS, PROBLEMS, REJECT_REASONS, type Claim, type ClaimStatus, type PlantRight } from "@/lib/claims";
import { ChangeRequestBox } from "@/components/claims/ClaimChange";
import { CompareTable, StageDates } from "@/components/claims/ClaimView";
import { ClaimStatusPill, ClaimSummary, ClaimTimeline, MediaGrid, ChoiceRow, ProblemPicker, VehicleFields, EMPTY_VEHICLE, vehicleValueOf, type VehicleValue } from "@/components/claims/ClaimParts";
import { PlantTeam } from "@/components/admin/claims/PlantTeam";

/** The plant's queues, in the order the work flows; "change" is the claims with a change asked for. */
const CARDS: { key: string; statuses: ClaimStatus[]; label: string; right?: PlantRight }[] = [
    { key: 'review', statuses: ['review'], label: 'To decide', right: 'decide' },
    { key: 'on_hold', statuses: ['on_hold'], label: 'On hold', right: 'decide' },
    { key: 'change', statuses: [], label: 'Change asked', right: 'decide' },
    { key: 'plan', statuses: ['plan'], label: 'To set alteration no.', right: 'plan' },
    { key: 'production', statuses: ['production'], label: 'WIP', right: 'plan' },
    { key: 'ready', statuses: ['ready'], label: 'Ready to dispatch', right: 'dispatch' },
    { key: 'dispatched', statuses: ['dispatched'], label: 'Dispatched' },
    { key: 'verify', statuses: ['verify'], label: 'With store' },
    { key: 'consent', statuses: ['consent'], label: 'Customer to agree' },
    { key: 'repair', statuses: ['repair'], label: 'Store to repair' },
    { key: 'closed', statuses: ['closed'], label: 'Closed' },
    { key: 'rejected', statuses: ['rejected', 'declined'], label: 'Rejected / declined' },
    { key: 'all', statuses: [], label: 'All' },
];

/**
 * The store filter: the list of stores with a search box on top that narrows
 * it as you type. "All stores" clears it.
 */
const StorePicker = ({ stores, value, onChange }: { stores: { value: string; name: string; n: number }[]; value: string; onChange: (v: string) => void }) => {
    const [open, setOpen] = useState(false);
    const [find, setFind] = useState('');
    const chosen = stores.find(x => x.value === value);
    const needle = find.trim().toLowerCase();
    const hits = needle ? stores.filter(x => x.name.toLowerCase().includes(needle)) : stores;
    const pick = (v: string) => { onChange(v); setOpen(false); setFind(''); };
    return (
        <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setFind(''); }}>
            <PopoverTrigger asChild>
                <button type="button" aria-label="Store" className={cn(FILTER, "flex items-center justify-between gap-2 text-left md:w-64", value && "border-orange-400")}>
                    <span className="truncate">{chosen ? `${chosen.name} (${chosen.n})` : 'All stores'}</span>
                    <Search className="h-4 w-4 shrink-0 text-gray-400" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-2">
                <Input autoFocus value={find} onChange={e => setFind(e.target.value)} placeholder="Search store" className="h-10" aria-label="Find a store" />
                <div className="mt-2 max-h-72 overflow-y-auto">
                    <button type="button" onClick={() => pick('')} className={cn("flex w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100", !value && "font-bold text-orange-700")}>All stores</button>
                    {hits.map(x => (
                        <button key={x.value} type="button" onClick={() => pick(x.value)}
                            className={cn("flex w-full justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100", x.value === value && "font-bold text-orange-700")}>
                            <span className="truncate">{x.name}</span><span className="shrink-0 text-gray-500">{x.n}</span>
                        </button>
                    ))}
                    {needle && !hits.length && <p className="px-3 py-2 text-sm text-gray-500">No store found.</p>}
                </div>
            </PopoverContent>
        </Popover>
    );
};

/* The date ranges offered, worked out on the day (dates are the claim's date). */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const RANGES: { key: string; label: string; range?: () => [string, string] }[] = [
    { key: 'all', label: 'All dates' },
    { key: 'today', label: 'Today', range: () => [ymd(new Date()), ymd(new Date())] },
    { key: '7d', label: 'Last 7 days', range: () => { const d = new Date(); d.setDate(d.getDate() - 6); return [ymd(d), ymd(new Date())]; } },
    { key: '30d', label: 'Last 30 days', range: () => { const d = new Date(); d.setDate(d.getDate() - 29); return [ymd(d), ymd(new Date())]; } },
    { key: 'month', label: 'This month', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(d)]; } },
    { key: 'last_month', label: 'Last month', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))]; } },
    { key: 'custom', label: 'Custom dates' },
];

const RIGHT_TEXT: Record<PlantRight, string> = { decide: 'Decide', plan: 'Alteration no. & ready', dispatch: 'Dispatch', edit: 'Edit & undo' };

/* The sheet's columns the plant fills in, and when each one is waiting to be filled. */
const NEEDS: Record<'decision' | 'alteration' | 'dispatch', ClaimStatus[]> = {
    decision: ['review', 'on_hold'], alteration: ['plan'], dispatch: ['production', 'ready'],
};
const Add = () => <span className="font-bold text-amber-800">Add</span>;

/** A decision can change what is sent and who pays until the alteration no. is given. */
const EARLY: ClaimStatus[] = ['consent', 'repair', 'plan'];

/** The decision's own fields, as they can be changed now. */
const DecisionFields = ({ c, v, set }: { c: Claim; v: Record<string, string>; set: (k: string, x: string) => void }) => {
    const d = c.decision;
    if (!d) return null;
    const pill = (on: boolean) => cn("h-10 rounded-lg border px-3 text-sm font-bold disabled:opacity-50", on ? "border-orange-600 bg-orange-50 text-orange-800" : "border-gray-300 bg-white text-gray-800");
    if (d.outcome === 'reject') return (
        <div className="space-y-2">
            <select value={v.d_reason} onChange={e => set('d_reason', e.target.value)} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm" aria-label="Reason">
                {Object.entries(REJECT_REASONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <Input value={v.d_remarks} onChange={e => set('d_remarks', e.target.value)} placeholder="Plant remarks" className="h-10 text-sm" />
        </div>
    );
    const early = EARLY.includes(c.status);
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!early} className={pill(v.d_charge === 'foc')} onClick={() => set('d_charge', 'foc')}>Free of cost</button>
                <button type="button" disabled={!early} className={pill(v.d_charge === 'chargeable')} onClick={() => set('d_charge', 'chargeable')}>Chargeable</button>
            </div>
            {!early && <p className="text-xs text-gray-500">The alteration no. is given: only the material and remarks can change now.</p>}
            {v.d_outcome === 'send_material' && <Input value={v.d_item} onChange={e => set('d_item', e.target.value)} placeholder="Material" className="h-10 text-sm" />}
            <Input value={v.d_remarks} onChange={e => set('d_remarks', e.target.value)} placeholder="Plant remarks" className="h-10 text-sm" />
        </div>
    );
};
const decisionStart = (c: Claim) => ({
    d_outcome: c.decision?.outcome ?? '', d_charge: c.decision?.charge ?? '', d_item: c.decision?.item ?? '',
    d_remarks: c.decision?.remarks ?? '', d_reason: c.decision?.reason ?? '',
});
/** What an edit of the decision sends: only what may change now. */
const decisionBody = (c: Claim, v: Record<string, string>) => {
    const d = c.decision;
    if (!d) return {};
    if (d.outcome === 'reject') return { reason: v.d_reason, remarks: v.d_remarks };
    return {
        remarks: v.d_remarks, ...(v.d_outcome === 'send_material' ? { item: v.d_item } : {}),
        ...(EARLY.includes(c.status) ? { outcome: v.d_outcome, charge: v.d_charge } : {}),
    };
};

/** Approve, hold, reject or ask the store, with each one's fields; for a new decision or one taken again. */
const DecideFields = ({ c, v, set, actions }: { c: Claim; v: Record<string, string>; set: (k: string, x: string) => void; actions: string[] }) => {
    const choices = ([['approve', 'Approve'], ['hold', 'Put on hold'], ['reject', 'Reject'], ['ask_more', 'Ask store for more']] as const).filter(([k]) => actions.includes(k));
    const pill = (on: boolean) => cn("h-10 rounded-lg border px-3 text-sm font-bold", on ? "border-orange-600 bg-orange-50 text-orange-800" : "border-gray-300 bg-white text-gray-800");
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
                {choices.map(([k, l]) => <button key={k} type="button" className={pill(v.choice === k)} onClick={() => set('choice', k)}>{l}</button>)}
            </div>
            {v.choice === 'approve' && (
                <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={pill(v.charge === 'foc')} onClick={() => set('charge', 'foc')}>Free of cost</button>
                        <button type="button" className={pill(v.charge === 'chargeable')} onClick={() => set('charge', 'chargeable')}>Chargeable</button>
                    </div>
                    {<Input value={v.item} onChange={e => set('item', e.target.value)} placeholder="Material (optional)" className="h-10 bg-white text-sm" />}
                    <Input value={v.remarks} onChange={e => set('remarks', e.target.value)} placeholder="Remarks (the store and customer see them)" className="h-10 bg-white text-sm" />
                </div>
            )}
            {(v.choice === 'hold' || v.choice === 'reject') && (
                <select value={v.reason} onChange={e => set('reason', e.target.value)} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm" aria-label="Reason">
                    <option value="">{v.choice === 'hold' ? 'Why on hold' : 'Reason from the T&C (the customer sees it)'}</option>
                    {Object.entries(v.choice === 'hold' ? HOLD_REASONS : REJECT_REASONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
            )}
            {v.choice && v.choice !== 'approve' && (
                <Input value={v.note} onChange={e => set('note', e.target.value)} placeholder={v.choice === 'ask_more' ? 'What the store should send or check' : 'Note'} className="h-10 bg-white text-sm" />
            )}
        </div>
    );
};
/** The form a decision starts from: blank, or the decision as it stands. */
const decideStart = (c: Claim, current = false): Record<string, string> => {
    const d = current ? c.decision : null;
    return {
        choice: !current ? '' : d?.outcome === 'reject' ? 'reject' : d ? 'approve' : '',
        outcome: d && d.outcome !== 'reject' ? d.outcome : 'send_material',
        charge: d?.charge ?? (c.kind === 'alteration' ? 'chargeable' : 'foc'),
        item: d?.item ?? '', remarks: d && d.outcome !== 'reject' ? d.remarks ?? '' : '',
        reason: d?.outcome === 'reject' ? d.reason ?? '' : '', note: d?.outcome === 'reject' ? d.remarks ?? '' : '', change_reason: '',
    };
};
const decideBody = (v: Record<string, string>) => v.choice === 'approve' ? { outcome: 'send_material', charge: v.charge, item: v.item, remarks: v.remarks }
    : v.choice === 'hold' || v.choice === 'reject' ? { reason: v.reason, note: v.note } : { note: v.note };

/**
 * A decision from the sheet: a new one, or one already made taken again with
 * a reason. After the alteration no. only its material and remarks change.
 */
const QuickDecide = ({ c, label, onSave }: {
    c: Claim; label: React.ReactNode; onSave: (action: string, body: Record<string, unknown>) => Promise<boolean>;
}) => {
    const again = Boolean(c.decision);
    const redecide = c.actions.includes('redecide');
    const [open, setOpen] = useState(false);
    const [v, setV] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const set = (k: string, x: string) => setV(p => ({ ...p, [k]: x }));
    const start = () => setV(again && !redecide ? { ...decisionStart(c), note: '' } : decideStart(c, again));
    const why = again ? (redecide ? v.change_reason : v.note) ?? '' : '';
    const ready = again ? why.trim().length >= 3 && (!redecide || !!v.choice) : !!v.choice;
    const save = () => !again ? onSave(v.choice, decideBody(v))
        : redecide ? onSave('redecide', { choice: v.choice, ...decideBody(v), change_reason: v.change_reason })
            : onSave('edit', { ...decisionBody(c, v), note: v.note });
    return (
        <Popover open={open} onOpenChange={o => { setOpen(o); if (o) start(); }}>
            <PopoverTrigger asChild>
                <button type="button" onClick={e => e.stopPropagation()} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-1 text-left hover:bg-amber-100">
                    {label}<Pencil className="h-3.5 w-3.5 shrink-0 text-orange-700" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[400px] space-y-3" onClick={e => e.stopPropagation()}>
                <p className="text-sm font-extrabold text-gray-900">{again ? 'Change decision' : 'Decision'} · {c.claim_no}</p>
                {again && !redecide ? <DecisionFields c={c} v={v} set={set} />
                    : <DecideFields c={c} v={v} set={set} actions={redecide ? ['approve', 'hold', 'reject', 'ask_more'] : c.actions} />}
                {again && (
                    <Input value={why} onChange={e => set(redecide ? 'change_reason' : 'note', e.target.value)} placeholder="Reason for the change (needed)" className="h-10 text-sm" />
                )}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" className="h-10 rounded-lg" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button disabled={busy || !ready} className="h-10 rounded-lg bg-orange-700 hover:bg-orange-800 font-bold"
                        onClick={async () => { setBusy(true); if (await save()) setOpen(false); setBusy(false); }}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
};

/**
 * A sheet cell the plant fills in where it is, like a spreadsheet: the pencil
 * opens a small box with the fields, and Save takes the step.
 */
const QuickFill = ({ label, title, fields, onSave }: {
    label: React.ReactNode; title: string;
    fields: { key: string; label: string; type?: string; value: string; need?: boolean; options?: [string, string][] }[];
    onSave: (v: Record<string, string>) => Promise<boolean>;
}) => {
    const [open, setOpen] = useState(false);
    const [v, setV] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const start = (o: boolean) => { setOpen(o); if (o) setV(Object.fromEntries(fields.map(f => [f.key, f.value]))); };
    const ready = fields.every(f => !f.need || (v[f.key] ?? '').trim());
    return (
        <Popover open={open} onOpenChange={start}>
            <PopoverTrigger asChild>
                <button type="button" onClick={e => e.stopPropagation()} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-1 text-left hover:bg-amber-100">
                    {label}<Pencil className="h-3.5 w-3.5 shrink-0 text-orange-700" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 space-y-3" onClick={e => e.stopPropagation()}>
                <p className="text-sm font-extrabold text-gray-900">{title}</p>
                {fields.map((f, i) => (
                    <label key={f.key} className="block space-y-1 text-xs font-semibold text-gray-700">{f.label}
                        {f.options ? (
                            <select value={v[f.key] ?? ''} onChange={e => setV(p => ({ ...p, [f.key]: e.target.value }))} className="h-11 w-full rounded-md border border-input bg-white px-2 text-sm font-normal">
                                {f.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </select>
                        ) : (
                            <Input type={f.type ?? 'text'} value={v[f.key] ?? ''} autoFocus={i === 0} onChange={e => setV(p => ({ ...p, [f.key]: e.target.value }))} className="h-11 text-sm font-normal" />
                        )}
                    </label>
                ))}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" className="h-10 rounded-lg" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button disabled={busy || !ready} className="h-10 rounded-lg bg-orange-700 hover:bg-orange-800 font-bold"
                        onClick={async () => { setBusy(true); if (await onSave(v)) setOpen(false); setBusy(false); }}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
};
const Empty = () => <span className="text-gray-400">—</span>;

/**
 * The plant (MFU): every claim as a sheet, and a pencil on each row that
 * opens the claim on the right with the step each person's rights allow.
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
    const [card, setCard] = useState<number>(CARDS.length - 1);
    const [q, setQ] = useState('');
    // The search runs a moment after typing stops.
    const [query, setQuery] = useState('');
    useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(t); }, [q]);
    const [store, setStore] = useState('');
    const [stores, setStores] = useState<{ value: string; name: string; n: number }[]>([]);
    const [charge, setCharge] = useState('');
    const [range, setRange] = useState('all');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [total, setTotal] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState<number | null>(null);

    const load = async () => {
        setRefreshing(true);
        try {
            const k = CARDS[card];
            const status = k.key === 'change' ? 'change' : k.statuses.join(',');
            const r = await api.get('/claims/admin/all', {
                params: { status: status || undefined, q: query || undefined, store: store || undefined, charge: charge || undefined, from: from || undefined, to: to || undefined },
            });
            setClaims(r.data.claims ?? []);
            setCounts(r.data.counts ?? {});
            setTotal(r.data.total ?? 0);
            setStores(r.data.stores ?? []);
            if (rights === null) setRights(r.data.rights ?? []);
        } catch (e) {
            toast({ variant: "destructive", title: "Could not load claims", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };
    useEffect(() => { load(); }, [card, query, store, charge, from, to]);
    const pickRange = (key: string) => {
        setRange(key);
        const r = RANGES.find(x => x.key === key)?.range?.();
        if (r) { setFrom(r[0]); setTo(r[1]); } else if (key === 'all') { setFrom(''); setTo(''); }
    };
    const filtered = Boolean(query || store || charge || from || to);
    const clearAll = () => { setQ(''); setQuery(''); setStore(''); setCharge(''); pickRange('all'); };

    /** A step taken from a sheet cell; the list reloads after it. */
    const quick = async (c: Claim, action: string, body: Record<string, unknown>, title: string) => {
        try {
            await api.post(`/claims/${c.id}/action`, { action, ...body });
            toast({ title });
            load();
            return true;
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again in a moment.") });
            return false;
        }
    };

    if (tab === 'team') return (
        <div className="space-y-5">
            <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-11 w-11 rounded-xl" aria-label="Back to claims" onClick={() => setTab('claims')}><ChevronLeft className="h-5 w-5" /></Button>
                <div>
                    <h1 className="text-2xl font-extrabold text-gray-900">Plant team</h1>
                    <p className="text-sm text-gray-500">Who sees claims and which steps they take</p>
                </div>
            </div>
            <PlantTeam />
        </div>
    );
    const countOf = (k: typeof CARDS[number]) => k.key === 'change' ? counts.change ?? 0
        : k.statuses.length ? k.statuses.reduce((n, x) => n + (counts[x] ?? 0), 0)
            : Object.entries(counts).reduce((a, [s, n]) => s === 'change' ? a : a + n, 0);
    const needs = (c: Claim, col: keyof typeof NEEDS) => NEEDS[col].includes(c.status);
    const can = (c: Claim, a: string) => c.actions.includes(a as any);
    const alterationCell = (c: Claim) => {
        if (can(c, 'plan')) return <QuickFill label={<Add />} title={`Alteration no. · ${c.claim_no}`}
            fields={[{ key: 'alteration_no', label: 'Alteration no.', value: '', need: true }]}
            onSave={v => quick(c, 'plan', v, 'Alteration no. saved: now WIP')} />;
        if (c.plan?.alteration_no && can(c, 'edit')) return <QuickFill label={c.plan.alteration_no} title={`Correct alteration no. · ${c.claim_no}`}
            fields={[{ key: 'alteration_no', label: 'Alteration no.', value: c.plan.alteration_no, need: true }, { key: 'note', label: 'Reason for the change (needed)', value: '', need: true }]}
            onSave={v => quick(c, 'edit', v, 'Alteration no. changed')} />;
        return c.plan?.alteration_no ?? (needs(c, 'alteration') ? <Add /> : <Empty />);
    };
    /*
     * Each dispatch column is its own cell, filled in on its own like a sheet:
     * an empty one just fills, a filled one changes with a reason. With a date
     * and a docket the claim is dispatched.
     */
    const DISPATCH_FIELD = {
        dispatch_date: { label: 'Dispatch date', type: 'date', get: (c: Claim) => c.dispatch?.date ?? '' },
        docket: { label: 'Docket no.', type: 'text', get: (c: Claim) => c.dispatch?.docket ?? '' },
        courier: { label: 'Courier / Transporter name', type: 'text', get: (c: Claim) => c.dispatch?.courier ?? '' },
    } as const;
    const dispatchCell = (c: Claim, key: keyof typeof DISPATCH_FIELD) => {
        const f = DISPATCH_FIELD[key];
        const now = f.get(c);
        const shown = now ? (key === 'dispatch_date' ? day(now) : now) : null;
        if (!can(c, 'dispatch_info')) return shown ?? (needs(c, 'dispatch') ? <Add /> : <Empty />);
        return <QuickFill label={shown ?? <Add />} title={`${f.label} · ${c.claim_no}`}
            fields={[
                { key, label: f.label, type: f.type, value: now || (key === 'dispatch_date' ? today() : ''), need: true },
                ...(now ? [{ key: 'note', label: 'Reason for the change (needed)', value: '', need: true }] : []),
            ]}
            onSave={v => quick(c, 'dispatch_info', v, `${f.label} saved`)} />;
    };
    const REASON = { key: 'note', label: 'Reason for the change (needed)', value: '', need: true };
    const detailCell = (c: Claim, shown: React.ReactNode, title: string, fields: { key: string; label: string; value: string; need?: boolean; options?: [string, string][] }[], seatOnly = false) =>
        can(c, 'edit') && (!seatOnly || c.snapshot?.product_type === 'seat-cover')
            ? <QuickFill label={shown} title={`${title} · ${c.claim_no}`} fields={[...fields, REASON]} onSave={v => quick(c, 'edit', v, `${title} changed`)} />
            : shown;
    const PROBLEM_OPTIONS = Object.entries(PROBLEMS).map(([k, x]) => [k, x.label] as [string, string]);
    const cell = "px-3 py-2.5 border border-gray-200 whitespace-nowrap";

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-2xl font-extrabold text-gray-900">Warranty Claim / Alteration</h1>
                    <p className="text-sm text-gray-500">
                        {rights === null ? 'Loading…' : rights.length ? `Your part: ${rights.map(r => RIGHT_TEXT[r]).join(' · ')}` : 'View only: you see every claim and its activity'}
                    </p>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="icon" onClick={() => load()} disabled={refreshing} title="Refresh" aria-label="Refresh" className="h-11 w-11 rounded-xl">
                        <RefreshCw className={cn("h-5 w-5", refreshing && "animate-spin")} />
                    </Button>
                    {user?.isSuperAdmin && (
                        <Button variant="outline" size="icon" title="Plant team" aria-label="Plant team" onClick={() => setTab('team')} className="h-11 w-11 rounded-xl">
                            <Settings className="h-5 w-5" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Search, then the filters; refresh at the end. */}
            <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-2">
                <div className="flex gap-2">
                    <form onSubmit={e => { e.preventDefault(); setQuery(q.trim()); }} className="relative flex min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <Input value={q} onChange={e => setQ(e.target.value)} aria-label="Search claims"
                            placeholder="Search claim no., alteration no., docket, store, depot, customer, phone, car, colour, design, issue"
                            className="h-11 w-full rounded-xl border-gray-200 bg-gray-50 pl-9 pr-9" />
                        {q && (
                            <button type="button" aria-label="Clear search" onClick={() => { setQ(''); setQuery(''); }}
                                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200"><X className="h-4 w-4" /></button>
                        )}
                    </form>
                </div>
                <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
                    <select value={card} onChange={e => setCard(Number(e.target.value))} aria-label="Queue" className={cn(FILTER, "font-bold md:w-60")}>
                        {CARDS.map((k, i) => <option key={k.key} value={i}>{k.label} ({countOf(k)})</option>)}
                    </select>
                    <StorePicker stores={stores} value={store} onChange={setStore} />
                    <select value={charge} onChange={e => setCharge(e.target.value)} aria-label="Charge" className={cn(FILTER, "md:w-44", charge && "border-orange-400")}>
                        <option value="">FOC and chargeable</option>
                        <option value="foc">Free of cost</option>
                        <option value="chargeable">Chargeable</option>
                    </select>
                    <select value={range} onChange={e => pickRange(e.target.value)} aria-label="Dates" className={cn(FILTER, "md:w-44", range !== 'all' && "border-orange-400")}>
                        {RANGES.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                    {range !== 'all' && (
                        <div className="col-span-2 flex items-center gap-2">
                            <Input type="date" value={from} max={to || undefined} onChange={e => { setRange('custom'); setFrom(e.target.value); }} aria-label="From" className="h-11 rounded-xl md:w-40" />
                            <span className="text-sm text-gray-500">to</span>
                            <Input type="date" value={to} min={from || undefined} onChange={e => { setRange('custom'); setTo(e.target.value); }} aria-label="To" className="h-11 rounded-xl md:w-40" />
                        </div>
                    )}
                    {filtered && <Button variant="ghost" onClick={clearAll} className="h-11 rounded-xl font-bold text-orange-700">Clear filters</Button>}
                </div>
            </div>
            <p className="px-1 text-sm text-gray-500">{loading ? '' : `${claims.length}${claims.length >= 1000 ? '+' : ''} claim${claims.length === 1 ? '' : 's'}${filtered || CARDS[card].key !== 'all' ? ` of ${total}` : ''}`}</p>

            <div className="rounded-xl border border-gray-300 bg-white">
                {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-600" /></div>
                    : !claims.length ? <p className="p-10 text-center text-sm text-gray-500">No claims here.</p>
                        : <>
                            {/* On a phone each claim is a card; the sheet needs a wide screen. */}
                            <ul className="divide-y divide-gray-100 md:hidden">
                                {claims.map(c => (
                                    <li key={c.id}>
                                        <button onClick={() => setOpen(c.id)} className="flex w-full gap-3 p-4 text-left active:bg-orange-50/40">
                                            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700"><Eye className="h-4 w-4" /></span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-start justify-between gap-2">
                                                    <span className="text-xs font-bold text-gray-500">{c.claim_no} · {day(c.created_at)}</span>
                                                    <ClaimStatusPill status={c.status} who="admin" />
                                                </span>
                                                <span className="mt-1 block font-bold text-gray-900">{c.snapshot?.customer_name} · {c.snapshot?.product_name}</span>
                                                <span className="block text-sm text-gray-600">{c.problem_text}{c.kind === 'alteration' ? ' · alteration' : ''}</span>
                                                <span className="block text-xs text-gray-500">{[c.store_name ?? c.snapshot?.fitted_store, [c.vehicle?.make, c.vehicle?.model].filter(Boolean).join(' ') || c.snapshot?.registration_number].filter(Boolean).join(' · ')}</span>
                                                {c.plan?.alteration_no && <span className="mt-1 block text-xs font-semibold text-indigo-700">Alt. no. {c.plan.alteration_no}</span>}
                                                {c.dispatch && <span className="mt-1 block text-xs font-semibold text-sky-700">Docket {c.dispatch.docket}</span>}
                                                {c.change_request && <span className="mt-1 block text-xs font-semibold text-amber-700">Change asked</span>}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <div className="hidden md:block max-h-[70vh] overflow-auto rounded-xl">
                                <table className="w-full border-collapse text-sm">
                                    <thead className="sticky top-0 z-10 bg-gray-100 text-left text-xs font-bold text-gray-700">
                                        <tr>
                                            {['S.No.', 'Status', 'Claim no.', 'Date', 'Store', 'Customer', 'Car', 'Product', 'Major colour', 'Minor colour', 'Issue', 'Decision', 'Alteration no.', 'Dispatch date', 'Docket no.', 'Courier / Transporter'].map(h => (
                                                <th key={h} className="px-3 py-2.5 border border-gray-300 whitespace-nowrap">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {claims.map((c, i) => (
                                            // A click on the row opens the claim; the cells filled in here stop it.
                                            <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer even:bg-gray-50/70 hover:bg-orange-50/60">
                                                <td className={cn(cell, "text-right tabular-nums text-gray-500")}>{i + 1}</td>
                                                <td className={cell}>
                                                    <ClaimStatusPill status={c.status} who="admin" />
                                                    {c.change_request && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">Change asked</span>}
                                                </td>
                                                <td className={cell}>
                                                    <button onClick={e => { e.stopPropagation(); setOpen(c.id); }} className="font-bold text-gray-900 underline-offset-2 hover:text-orange-700 hover:underline">{c.claim_no}</button>
                                                </td>
                                                <td className={cell}>{day(c.created_at)}</td>
                                                <td className={cell}>{c.store_name ?? c.snapshot?.fitted_store ?? <Empty />}</td>
                                                <td className={cell}>{c.snapshot?.customer_name}</td>
                                                <td className={cell}>{detailCell(c, [c.vehicle?.make, c.vehicle?.model].filter(Boolean).join(' ') || c.snapshot?.registration_number || <Empty />, 'Car',
                                                    [{ key: 'vehicle_make', label: 'Make', value: c.vehicle?.make ?? '', need: true }, { key: 'vehicle_model', label: 'Model', value: c.vehicle?.model ?? '', need: true }])}</td>
                                                <td className={cell}>{c.snapshot?.product_name}</td>
                                                <td className={cell}>{detailCell(c, c.vehicle?.major_colour || <Empty />, 'Major colour', [{ key: 'major_colour', label: 'Major colour', value: c.vehicle?.major_colour ?? '', need: true }], true)}</td>
                                                <td className={cell}>{detailCell(c, c.vehicle?.minor_colour || <Empty />, 'Minor colour', [{ key: 'minor_colour', label: 'Minor colour', value: c.vehicle?.minor_colour ?? '' }], true)}</td>
                                                <td className={cell}>{detailCell(c, <>{c.problem_text}{c.kind === 'alteration' ? ' · alteration' : ''}</>, 'Issue', [{ key: 'problem', label: 'Issue', value: c.problem, need: true, options: PROBLEM_OPTIONS }])}</td>
                                                <td className={cn(cell, needs(c, 'decision') && "bg-amber-50")}>
                                                    {c.decision ? (can(c, 'redecide') || can(c, 'edit') ? <QuickDecide c={c} label={decisionText(c)} onSave={(a, body) => quick(c, a, body, 'Decision changed: the store and customer are told')} /> : decisionText(c)) : needs(c, 'decision')
                                                        ? (['approve', 'hold', 'reject', 'ask_more'].some(a => can(c, a))
                                                            ? <QuickDecide c={c} label={<Add />} onSave={(a, body) => quick(c, a, body, a === 'approve' ? 'Approved: the store and customer are told' : a === 'reject' ? 'Rejected: the store and customer are told' : a === 'hold' ? 'Put on hold' : 'Sent back to the store')} />
                                                            : <Add />)
                                                        : <Empty />}
                                                </td>
                                                <td className={cn(cell, needs(c, 'alteration') && "bg-amber-50")}>{alterationCell(c)}</td>
                                                <td className={cn(cell, needs(c, 'dispatch') && "bg-amber-50")}>{dispatchCell(c, 'dispatch_date')}</td>
                                                <td className={cn(cell, needs(c, 'dispatch') && "bg-amber-50")}>{dispatchCell(c, 'docket')}</td>
                                                <td className={cn(cell, needs(c, 'dispatch') && "bg-amber-50")}>{dispatchCell(c, 'courier')}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>}
            </div>

            {open !== null && <AdminClaim id={open} onClose={() => { setOpen(null); load(); }} />}
        </div>
    );
};

/* ─── One claim, on the right ────────────────────────────────────────────── */

type Choice = 'approve' | 'hold' | 'reject' | 'ask_more';
const today = () => new Date().toISOString().slice(0, 10);
const Field = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
    <label className={cn("block space-y-1.5 text-sm font-semibold", className)}>{label}{children}</label>
);
const SELECT = "h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-normal";
const FILTER = "h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900";

const AdminClaim = ({ id, onClose }: { id: number; onClose: () => void }) => {
    const { toast } = useToast();
    const [c, setC] = useState<Claim | null>(null);
    const [busy, setBusy] = useState(false);
    const [f, setF] = useState<Record<string, string>>({});
    const set = (k: string) => (v: string) => setF(p => ({ ...p, [k]: v }));
    const [vehicle, setVehicle] = useState<VehicleValue>(EMPTY_VEHICLE);
    // A decision taken again, starting from the one that stands.
    const [rd, setRd] = useState<Record<string, string>>({});

    const load = () => api.get(`/claims/${id}`).then(r => setC(r.data.claim)).catch(e => toast({ variant: "destructive", title: "Could not load", description: getErrorMessage(e, "") }));
    useEffect(() => { load(); }, [id]);
    useEffect(() => {
        if (!c) return;
        // Each form starts from what the claim holds now.
        setF({
            choice: '', outcome: '', charge: c.kind === 'alteration' ? 'chargeable' : 'foc', item: '', remarks: '',
            reason: '', hold_reason: '', note: '',
            alteration_no: c.plan?.alteration_no ?? '',
            dispatch_date: c.dispatch?.date ?? today(), docket: c.dispatch?.docket ?? '', courier: c.dispatch?.courier ?? '',
            e_problem: c.problem, e_description: c.description ?? '', ...decisionStart(c),
            e_alteration_no: c.plan?.alteration_no ?? '',
            e_dispatch_date: c.dispatch?.date ?? '', e_docket: c.dispatch?.docket ?? '', e_courier: c.dispatch?.courier ?? '',
            e_reason: '', undo_reason: '',
        });
        setVehicle(vehicleValueOf(c.vehicle));
        setRd(decideStart(c, true));
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

    const d = c?.decision;
    const has = (a: string) => Boolean(c?.actions.includes(a as any));
    const deciding = has('approve') || has('hold') || has('reject') || has('ask_more');
    const decide = () => {
        switch (f.choice as Choice) {
            case 'approve': return act('approve', { outcome: 'send_material', charge: f.charge, item: f.item, remarks: f.remarks }, 'Approved: the store and customer are told');
            case 'hold': return act('hold', { reason: f.hold_reason, note: f.note }, 'Put on hold');
            case 'reject': return act('reject', { reason: f.reason, note: f.note }, 'Rejected: the store and customer are told');
            case 'ask_more': return act('ask_more', { note: f.note }, 'Sent back to the store');
        }
    };
    const choices: { value: Choice; label: string }[] = ([
        { value: 'approve', label: 'Approve' }, { value: 'hold', label: 'Put on hold' }, { value: 'reject', label: 'Reject' }, { value: 'ask_more', label: 'Ask store for more' },
    ] as { value: Choice; label: string }[]).filter(x => has(x.value));
    // The buttons for this person's step, kept at the bottom of the panel.
    const buttons: { label: string; run: () => void; off?: boolean }[] = [
        ...(deciding ? [{ label: 'Save', run: decide, off: !f.choice }] : []),
        ...(has('plan') ? [{ label: 'Save: start WIP', run: () => act('plan', { alteration_no: f.alteration_no }, 'Alteration no. saved: now WIP') }] : []),
        ...(has('ready') ? [{ label: 'Mark ready to dispatch', run: () => act('ready', {}, 'Marked ready to dispatch') }] : []),
        ...(has('dispatch') ? [{ label: 'Mark dispatched', run: () => act('dispatch', { dispatch_date: f.dispatch_date, docket: f.docket, courier: f.courier }, 'Dispatched: the store and customer are told') }] : []),
    ];
    const r = c?.registration;
    const stepTitle = deciding ? 'Your decision' : has('plan') ? 'Alteration number' : has('dispatch') ? `Dispatch${d?.item ? ` · ${d.item}` : ''}`
        : has('ready') ? `WIP${c?.plan?.alteration_no ? ` · alteration no. ${c.plan.alteration_no}` : ''}` : null;

    return (
        <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
            <DialogContent className="flex h-[94vh] w-[96vw] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
                {!c ? <div className="flex flex-1 items-center justify-center"><DialogTitle className="sr-only">Claim</DialogTitle><Loader2 className="h-6 w-6 animate-spin text-orange-600" /></div> : <>
                    <header className="border-b border-gray-200 bg-gray-50/70 px-4 py-4 pr-14 sm:px-6 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-md bg-gray-900 px-2 py-0.5 text-xs font-bold tracking-wide text-white">{c.claim_no}</span>
                                    <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{c.kind === 'alteration' ? 'Alteration' : 'Warranty claim'}</span>
                                    <ClaimStatusPill status={c.status} who="admin" />
                                </div>
                                <DialogTitle className="text-xl sm:text-2xl font-black leading-tight text-gray-900">{c.problem_text}</DialogTitle>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {([['Customer', c.snapshot?.customer_phone], ['Franchise', c.store_phone]] as [string, string | null | undefined][]).filter(([, n]) => n).map(([tag, n]) => (
                                    <a key={tag} href={`tel:${n}`} className="flex flex-col items-start rounded-xl border border-gray-300 bg-white px-3 py-1.5 no-underline hover:bg-gray-50">
                                        <span className="flex items-center gap-1.5 text-sm font-bold text-gray-900"><Phone className="h-4 w-4" />{n}</span>
                                        <span className={cn("mt-0.5 rounded-full px-2 py-px text-[10px] font-bold uppercase tracking-wider", tag === 'Customer' ? "bg-sky-100 text-sky-800" : "bg-orange-100 text-orange-800")}>{tag}</span>
                                    </a>
                                ))}
                            </div>
                        </div>
                        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 sm:grid-cols-3 lg:grid-cols-6">
                            {([
                                ['Customer', [c.snapshot?.customer_name, c.snapshot?.registration_number].filter(Boolean).join(' · ')],
                                ['Product', [c.snapshot?.product_name, `UID ${c.warranty_uid}`].filter(Boolean).join(' · ')],
                                ['Warranty', [c.snapshot?.warranty_type, c.snapshot?.cover_end ? `covered till ${day(c.snapshot.cover_end)}` : null].filter(Boolean).join(' · ')],
                                ['Store', [c.store_name ?? c.snapshot?.fitted_store, c.store_city].filter(Boolean).join(', ')],
                                ...(c.snapshot?.depot ? [['Depot', c.snapshot.depot] as [string, string]] : []),
                                ['Requested', `${c.raised_by_role === 'customer' ? 'By the customer' : c.raised_by_role === 'vendor' ? 'By the store' : 'By the plant'} · ${day(c.created_at)}`],
                                ['Waiting for', c.waiting_on],
                            ] as [string, string | null | undefined][]).map(([k, v]) => (
                                <div key={k} className="min-w-0 bg-white px-3 py-2">
                                    <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{k}</dt>
                                    <dd className={cn("text-sm font-semibold break-words", k === 'Waiting for' ? "text-orange-800" : "text-gray-900")}>{v || '—'}</dd>
                                </div>
                            ))}
                        </dl>
                    </header>

                    <div className="flex-1 overflow-y-auto">
                        <div className="px-4 pt-4 sm:px-6"><StageDates c={c} who="admin" /></div>
                        <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
                            <div className="min-w-0 space-y-4">
                        {!c.actions.length && <p className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2.5 text-sm text-blue-900"><Eye className="h-4 w-4" />{c.waiting_on ? `Waiting for: ${c.waiting_on}.` : 'Nothing to do on this claim.'} Your access here is to view.</p>}
                        <ChangeRequestBox c={c} busy={busy} onApprove={() => act('change_ok', {}, 'Change approved: the store and customer are told')}
                            onRefuse={n => act('change_no', { note: n }, 'Change refused: the store and customer are told')} />

                        <CompareTable c={c} who="admin" />
                        <div className="grid gap-3 md:grid-cols-2">
                            <section className="rounded-2xl border border-gray-200 p-4 space-y-2">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Store verification{c.verification ? ` · ${day(c.verification.at)}` : ''}</p>
                                {c.verification ? (
                                    <>
                                        {c.verification.remarks && <p className="text-sm text-gray-800">{c.verification.remarks}</p>}
                                        {c.verification.corrections.length > 0 && (
                                            <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                                                <p className="font-bold">The store corrected:</p>
                                                <ul className="list-disc pl-5">{c.verification.corrections.map((x, i) => <li key={i}>{x}</li>)}</ul>
                                            </div>
                                        )}
                                        <MediaGrid urls={c.verification.photos} claimId={c.id} className="sm:grid-cols-3" />
                                    </>
                                ) : <p className="text-sm text-gray-500">Waiting for the store to verify.</p>}
                            </section>
                            <section className="rounded-2xl border border-gray-200 p-4 space-y-2">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Remarks on this warranty</p>
                                {r?.remarks?.length ? r.remarks.map((m, i) => (
                                    <p key={i} className="text-xs text-gray-700"><b>{m.admin_name}</b> · {formatToIST(m.created_at)}: {m.remark}</p>
                                )) : <p className="text-sm text-gray-500">None.</p>}
                            </section>
                        </div>

                            </div>
                            <div className="min-w-0 space-y-4">
                        {/* The one step this person takes now. */}
                        {stepTitle && (
                            <section className="rounded-2xl border-2 border-orange-400 bg-orange-50 p-4 space-y-4">
                                <p className="text-[11px] font-extrabold uppercase tracking-wider text-orange-700">{stepTitle}</p>
                                {deciding && (
                                    <>
                                        <ChoiceRow<Choice> name="choice" value={f.choice as Choice} onChange={set('choice')} options={choices} />
                                        {f.choice === 'approve' && (
                                            <div className="space-y-3">
                                                <ChoiceRow<'foc' | 'chargeable'> name="charge" value={f.charge as any} onChange={set('charge')} options={[{ value: 'foc', label: 'Free of cost' }, { value: 'chargeable', label: 'Chargeable' }]} />
                                                {f.charge === 'chargeable' && <p className="text-xs text-purple-800">The customer (or the store for them) must agree to the charge before anything goes ahead. Payment is taken at the store.</p>}
                                                <Field label="Material (optional)"><Input value={f.item} onChange={e => set('item')(e.target.value)} className="h-11 bg-white font-normal" placeholder="e.g. driver seat set, black" /></Field>
                                                <Field label="Remarks (the store and customer see them)"><Textarea value={f.remarks} onChange={e => set('remarks')(e.target.value)} rows={2} className="bg-white font-normal" /></Field>
                                            </div>
                                        )}
                                        {f.choice === 'hold' && (
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <Field label="Why on hold">
                                                    <select value={f.hold_reason} onChange={e => set('hold_reason')(e.target.value)} className={SELECT}>
                                                        <option value="">Choose</option>{Object.entries(HOLD_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                                    </select>
                                                </Field>
                                                <Field label="Note"><Input value={f.note} onChange={e => set('note')(e.target.value)} className="h-11 bg-white font-normal" /></Field>
                                            </div>
                                        )}
                                        {f.choice === 'reject' && (
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <Field label="Reason from the T&C (the customer sees it)">
                                                    <select value={f.reason} onChange={e => set('reason')(e.target.value)} className={SELECT}>
                                                        <option value="">Choose the reason</option>{Object.entries(REJECT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                                    </select>
                                                </Field>
                                                <Field label="Note"><Input value={f.note} onChange={e => set('note')(e.target.value)} className="h-11 bg-white font-normal" /></Field>
                                            </div>
                                        )}
                                        {f.choice === 'ask_more' && (
                                            <Field label="What the store should send or check"><Textarea value={f.note} onChange={e => set('note')(e.target.value)} rows={2} className="bg-white font-normal" /></Field>
                                        )}
                                    </>
                                )}
                                {has('plan') && (
                                    <Field label="Alteration no."><Input value={f.alteration_no} onChange={e => set('alteration_no')(e.target.value)} className="h-12 bg-white text-base font-semibold" /></Field>
                                )}
                                {has('dispatch') && (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <Field label="Dispatch date"><Input type="date" value={f.dispatch_date} onChange={e => set('dispatch_date')(e.target.value)} className="h-12 bg-white text-base font-semibold" /></Field>
                                        <Field label="Docket no."><Input value={f.docket} onChange={e => set('docket')(e.target.value)} className="h-12 bg-white text-base font-semibold" /></Field>
                                        <Field label="Courier / Transporter name (optional)" className="sm:col-span-2"><Input value={f.courier} onChange={e => set('courier')(e.target.value)} className="h-12 bg-white text-base font-semibold" /></Field>
                                    </div>
                                )}
                                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                                    {buttons.map((b, i) => (
                                        <Button key={b.label} disabled={busy || b.off} onClick={b.run}
                                            className={cn("h-12 rounded-xl px-6 text-base font-bold", i === buttons.length - 1 ? "bg-orange-700 hover:bg-orange-800" : "bg-gray-900")}>
                                            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : b.label}
                                        </Button>
                                    ))}
                                </div>
                            </section>
                        )}

                        {has('fitted') && (
                            <section className="flex flex-wrap items-center gap-2">
                                <Button variant="outline" disabled={busy} className="h-12 sm:h-11 w-full sm:w-auto rounded-xl" onClick={() => act('fitted', { note: 'Marked by the plant for the store' }, 'Marked done')}>
                                    Mark {d?.outcome === 'repair_store' ? 'repaired' : 'fitted'} for the store
                                </Button>
                                <p className="text-xs text-gray-500">Normally the store confirms this.</p>
                            </section>
                        )}

                        {c.status === 'on_hold' && c.hold && (
                            <p className="rounded-xl bg-yellow-50 px-4 py-3 text-sm text-yellow-900"><b>On hold: {HOLD_REASONS[c.hold.reason] ?? 'see note'}.</b> {c.hold.note} · since {day(c.hold.at)}</p>
                        )}
                        {d && (
                            <section className={cn("rounded-2xl border overflow-hidden", d.outcome === 'reject' ? "border-red-200" : "border-gray-200")}>
                                <p className={cn("px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider", d.outcome === 'reject' ? "bg-red-50 text-red-800" : "bg-gray-50 text-gray-500")}>Plant decision · {day(d.at)}</p>
                                <dl className="divide-y divide-gray-100 text-sm">
                                    {([
                                        ['Decision', d.outcome === 'reject' ? 'Not approved' : d.outcome === 'repair_store' ? 'Repair at the store' : 'Material from the plant'],
                                        ...(d.outcome === 'reject' ? [['Reason', REJECT_REASONS[d.reason ?? ''] ?? 'see note']] : [['Charge', d.charge === 'chargeable' ? 'Chargeable' : 'Free of cost']]),
                                        ...(d.item ? [['Material', d.item]] : []),
                                        ...(d.remarks ? [['Remarks', d.remarks]] : []),
                                        ...(c.consent ? [['Customer', `Charge ${c.consent.agreed ? 'agreed' : 'declined'} by the ${c.consent.by === 'customer' ? 'customer' : "store on the customer's behalf"} · ${day(c.consent.at)}${c.consent.note ? ` · ${c.consent.note}` : ''}`]] : []),
                                        ...(c.plan ? [['Alteration no.', `${c.plan.alteration_no ?? '—'}${c.plan.edd ? ` · EDD ${day(c.plan.edd)}` : ''}`]] : []),
                                        ...(c.dispatch ? [['Dispatch date', c.dispatch.date ? day(c.dispatch.date) : '—'], ['Docket no.', c.dispatch.docket || '—'], ['Courier / Transporter', c.dispatch.courier || '—']] : []),
                                        ...(c.fitted ? [[d.outcome === 'repair_store' ? 'Repaired' : 'Fitted', `${day(c.fitted.at)}${c.fitted.note ? ` · ${c.fitted.note}` : ''}`]] : []),
                                    ] as [string, string][]).map(([k, v]) => (
                                        <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-2.5">
                                            <dt className="font-semibold text-gray-500">{k}</dt>
                                            <dd className={cn("font-semibold break-words", k === 'Charge' && v === 'Chargeable' ? "text-purple-800" : d.outcome === 'reject' && k !== 'Remarks' ? "text-red-900" : "text-gray-900")}>
                                                {k === 'Dispatch date' && <Truck className="mr-1 inline h-4 w-4 text-orange-600" />}{v}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                                {c.fitted?.photos?.length ? <MediaGrid urls={c.fitted.photos} claimId={c.id} className="px-4 pb-3" /> : null}
                            </section>
                        )}

                        {c.counts && (
                            <section className="rounded-2xl border border-gray-200 overflow-hidden">
                                <p className="bg-gray-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">Earlier claims</p>
                                <div className="grid grid-cols-2 divide-x divide-y divide-gray-100 sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-2 lg:divide-y">
                                    {([['Claims on this warranty', c.counts.on_warranty], ['Approved before', c.counts.approved_before], ['Rejected before', c.counts.rejected_before], ['This customer, all products', c.counts.customer_total]] as [string, number][]).map(([l, n]) => (
                                        <div key={l} className="px-4 py-3">
                                            <p className="text-2xl font-black tabular-nums text-gray-900">{n}</p>
                                            <p className="text-xs font-semibold text-gray-500">{l}</p>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        <details className="rounded-2xl border border-gray-200 p-4">
                            <summary className="cursor-pointer text-sm font-bold text-gray-900">Timeline{c.history?.length ? ` (${c.history.length})` : ''}</summary>
                            <div className="mt-3 space-y-4">
                                {has('undo') && (
                                    <div className="flex gap-2">
                                        <Input value={f.undo_reason ?? ''} onChange={e => set('undo_reason')(e.target.value)} placeholder="Why undo the last step?" className="h-10" aria-label="Reason to undo" />
                                        <Button variant="outline" disabled={busy || (f.undo_reason ?? '').trim().length < 3} className="h-10 rounded-lg shrink-0"
                                            onClick={() => act('undo', { note: f.undo_reason }, 'Last step undone')}>
                                            <Undo2 className="h-4 w-4 mr-1" />Undo
                                        </Button>
                                    </div>
                                )}
                                <ClaimTimeline history={c.history} who="admin" />
                            </div>
                        </details>

                        {has('redecide') && (
                            <details className="rounded-2xl border border-gray-200 p-4">
                                <summary className="cursor-pointer text-sm font-bold text-gray-900">Change decision (with a reason)</summary>
                                <div className="mt-3 space-y-3">
                                    <DecideFields c={c} v={rd} set={(k, x) => setRd(p => ({ ...p, [k]: x }))} actions={['approve', 'hold', 'reject', 'ask_more']} />
                                    <Field label="Reason for the change (needed)"><Input value={rd.change_reason ?? ''} onChange={e => setRd(p => ({ ...p, change_reason: e.target.value }))} className="h-11 font-normal" /></Field>
                                    <Button variant="outline" disabled={busy || !rd.choice || (rd.change_reason ?? '').trim().length < 3} className="h-11 rounded-xl font-bold"
                                        onClick={() => act('redecide', { choice: rd.choice, ...decideBody(rd), change_reason: rd.change_reason }, 'Decision changed: the store and customer are told')}>
                                        Save new decision
                                    </Button>
                                </div>
                            </details>
                        )}

                        {has('edit') && (
                            <details className="rounded-2xl border border-gray-200 p-4">
                                <summary className="cursor-pointer text-sm font-bold text-gray-900">Edit details (with a reason)</summary>
                                <div className="mt-3 space-y-3">
                                    <VehicleFields value={vehicle} onChange={setVehicle} airbags={c.snapshot?.product_type === 'seat-cover'} plant />
                                    <ProblemPicker options={Object.keys(PROBLEMS)} value={f.e_problem} onChange={set('e_problem')} />
                                    <Textarea value={f.e_description} onChange={e => set('e_description')(e.target.value)} rows={2} placeholder="Description" aria-label="Description" />
                                    {d && !has('redecide') && (
                                        <div className="space-y-2 rounded-xl border border-gray-200 p-3">
                                            <p className="text-sm font-bold text-gray-900">Plant decision</p>
                                            <DecisionFields c={c} v={f} set={(k, x) => set(k)(x)} />
                                        </div>
                                    )}
                                    {c.plan && (
                                        <Field label="Alteration no."><Input value={f.e_alteration_no} onChange={e => set('e_alteration_no')(e.target.value)} className="h-11 font-normal" /></Field>
                                    )}
                                    {c.dispatch && (
                                        <div className="grid gap-3 sm:grid-cols-3">
                                            <Field label="Dispatch date"><Input type="date" value={f.e_dispatch_date} onChange={e => set('e_dispatch_date')(e.target.value)} className="h-11 font-normal" /></Field>
                                            <Field label="Docket no."><Input value={f.e_docket} onChange={e => set('e_docket')(e.target.value)} className="h-11 font-normal" /></Field>
                                            <Field label="Courier / Transporter"><Input value={f.e_courier} onChange={e => set('e_courier')(e.target.value)} className="h-11 font-normal" /></Field>
                                        </div>
                                    )}
                                    <Field label="Reason for the change (needed)"><Input value={f.e_reason} onChange={e => set('e_reason')(e.target.value)} className="h-11 font-normal" /></Field>
                                    <Button variant="outline" disabled={busy} className="h-11 rounded-xl font-bold" onClick={() => act('edit', {
                                        note: f.e_reason, ...vehicle, problem: f.e_problem, description: f.e_description,
                                        ...(has('redecide') ? {} : decisionBody(c, f)),
                                        ...(c.plan ? { alteration_no: f.e_alteration_no } : {}),
                                        ...(c.dispatch ? { dispatch_date: f.e_dispatch_date, docket: f.e_docket, courier: f.e_courier } : {}),
                                    }, 'Changes saved')}>Save changes</Button>
                                </div>
                            </details>
                        )}
                            </div>
                        </div>
                    </div>
                </>}
            </DialogContent>
        </Dialog>
    );
};

export default AdminClaims;
