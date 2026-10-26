import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The plant team: who sees claims and which steps each person takes.
 *
 * These are the same admin permissions as Admin Access (the claims rows), set
 * here so the super admin can run the team from the claims screen: give a
 * role in one tap, or switch single steps on and off. Saving writes the
 * person's whole permission set with only the claims rows changed.
 */

type Perms = Record<string, { read: boolean; write: boolean }>;
interface Admin { id: string; name: string; email: string; phone_number: string | null; is_super_admin: boolean; permissions: Perms }

/** The switches, in the order the work flows. "view" is Read on claims; the rest are Write on their step. */
const SWITCHES = [
    { key: 'view', label: 'View all claims', perm: 'claims' },
    { key: 'decide', label: 'Decide', perm: 'claims_decide' },
    { key: 'plan', label: 'EDD, alt. no. & ready', perm: 'claims_plan' },
    { key: 'dispatch', label: 'Dispatch', perm: 'claims_dispatch' },
    { key: 'edit', label: 'Edit & undo', perm: 'claims_edit' },
] as const;
type Key = typeof SWITCHES[number]['key'];
type Rights = Record<Key, boolean>;

const ROLES: { name: string; who: string; rights: Rights }[] = [
    { name: 'Plant team, all steps', who: "Anuka ma'am's team", rights: { view: true, decide: true, plan: true, dispatch: true, edit: true } },
    { name: 'Decide only', who: 'Approves, rejects, holds', rights: { view: true, decide: true, plan: false, dispatch: false, edit: false } },
    { name: 'Production & dispatch', who: 'EDD, ready, docket', rights: { view: true, decide: false, plan: true, dispatch: true, edit: false } },
    { name: 'View only', who: 'Anurag sir, Himanshu sir, depots', rights: { view: true, decide: false, plan: false, dispatch: false, edit: false } },
];
const NONE: Rights = { view: false, decide: false, plan: false, dispatch: false, edit: false };

const rightsOf = (p: Perms): Rights => ({
    view: !!(p.claims?.read || p.claims?.write),
    decide: !!p.claims_decide?.write, plan: !!p.claims_plan?.write, dispatch: !!p.claims_dispatch?.write, edit: !!p.claims_edit?.write,
});

/** The person's permissions with the claims rows set from these rights; a step needs the view too. */
function withRights(p: Perms, r: Rights): Perms {
    const anyStep = r.decide || r.plan || r.dispatch || r.edit;
    const view = r.view || anyStep;
    const out: Perms = { ...p, claims: { read: view, write: false } };
    for (const s of SWITCHES) if (s.key !== 'view') out[s.perm] = { read: r[s.key], write: r[s.key] };
    return out;
}

const roleName = (r: Rights) => ROLES.find(x => SWITCHES.every(s => x.rights[s.key] === r[s.key]))?.name ?? (r.view ? 'Custom' : 'No access');
const same = (a: Rights, b: Rights) => SWITCHES.every(s => a[s.key] === b[s.key]);

export const PlantTeam = () => {
    const { toast } = useToast();
    const [admins, setAdmins] = useState<Admin[]>([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState<Record<string, Rights>>({});
    const [saving, setSaving] = useState<string | null>(null);
    const [adding, setAdding] = useState<'existing' | 'new' | null>(null);
    const [pick, setPick] = useState('');
    const [role, setRole] = useState(0);
    const [person, setPerson] = useState({ name: '', email: '', phone: '' });

    const load = async () => {
        setLoading(true);
        try {
            const r = await api.get('/admin/admins');
            setAdmins(r.data.admins ?? []);
            setDraft({});
        } catch (e) {
            toast({ variant: "destructive", title: "Could not load the team", description: getErrorMessage(e, "Only a super admin can manage the plant team.") });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const team = useMemo(() => admins.filter(a => !a.is_super_admin && rightsOf(a.permissions).view), [admins]);
    const others = useMemo(() => admins.filter(a => !a.is_super_admin && !rightsOf(a.permissions).view), [admins]);
    const supers = useMemo(() => admins.filter(a => a.is_super_admin), [admins]);

    const save = async (a: Admin, r: Rights, done: string) => {
        setSaving(a.id);
        try {
            await api.patch(`/admin/admins/${a.id}/permissions`, { permissions: withRights(a.permissions, r) });
            toast({ title: done });
            await load();
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setSaving(null);
        }
    };

    const invite = async () => {
        if (!person.name.trim() || !person.email.trim() || !person.phone.trim()) return toast({ variant: "destructive", title: "Enter the name, email and phone" });
        setSaving('new');
        try {
            await api.post('/admin/admins', { name: person.name.trim(), email: person.email.trim(), phone: person.phone.trim(), permissions: withRights({}, ROLES[role].rights) });
            toast({ title: `${person.name} added to the plant team`, description: 'They get an email to set up their login.' });
            setPerson({ name: '', email: '', phone: '' }); setAdding(null);
            await load();
        } catch (e) {
            toast({ variant: "destructive", title: "Could not add them", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setSaving(null);
        }
    };

    if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-600" /></div>;

    // Each person's rights as shown (saved, or changed and not yet saved), for the table and the phone cards alike.
    const rows = team.map(a => {
        const saved = rightsOf(a.permissions);
        const r = draft[a.id] ?? saved;
        const set = (k: Key, v: boolean) => {
            const next = { ...r, [k]: v };
            // A step needs the view; switching the view off takes the steps with it.
            if (k === 'view' && !v) Object.assign(next, NONE);
            if (k !== 'view' && v) next.view = true;
            setDraft(d => ({ ...d, [a.id]: next }));
        };
        const roleSelect = (className: string) => (
            <select value={ROLES.findIndex(x => same(x.rights, r))} onChange={e => { const i = Number(e.target.value); if (i >= 0) setDraft(d => ({ ...d, [a.id]: { ...ROLES[i].rights } })); }}
                aria-label={`Role for ${a.name}`} className={cn("rounded-lg border border-gray-300 bg-white px-2", className)}>
                {ROLES.findIndex(x => same(x.rights, r)) < 0 && <option value={-1}>{roleName(r)}</option>}
                {ROLES.map((x, i) => <option key={x.name} value={i}>{x.name}</option>)}
            </select>
        );
        return { a, r, dirty: !same(r, saved), set, roleSelect };
    });
    const rowActions = ({ a, r, dirty }: typeof rows[number], className = '') => dirty ? (
        <div className={cn("flex justify-end gap-1", className)}>
            <Button size="sm" disabled={saving !== null} className="h-9 rounded-lg bg-orange-700 hover:bg-orange-800" onClick={() => save(a, r, `${a.name}: ${roleName(r)}`)}>
                {saving === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" />Save</>}
            </Button>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => setDraft(d => { const n = { ...d }; delete n[a.id]; return n; })}>Cancel</Button>
        </div>
    ) : (
        <Button size="sm" variant="ghost" disabled={saving !== null} className={cn("h-9 text-red-700 hover:text-red-800", className)} onClick={() => save(a, NONE, `${a.name} removed from the plant team`)}>Remove</Button>
    );

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-2xl text-sm text-gray-600">
                    Who sees warranty claims and which steps each person takes. Pick a role, or switch single steps on and off and save.
                    Everyone here sees every claim; the steps decide which buttons they get.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="h-10 rounded-xl" onClick={() => setAdding(adding === 'existing' ? null : 'existing')}><Plus className="h-4 w-4 mr-1" />Add an existing admin</Button>
                    <Button className="h-10 rounded-xl bg-orange-700 hover:bg-orange-800 font-bold" onClick={() => setAdding(adding === 'new' ? null : 'new')}><UserPlus className="h-4 w-4 mr-1" />Invite a new person</Button>
                </div>
            </div>

            {adding && (
                <div className="rounded-2xl border border-orange-200 bg-orange-50/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="font-bold text-gray-900">{adding === 'new' ? 'Invite a new person to the plant team' : 'Add an existing admin to the plant team'}</p>
                        <button onClick={() => setAdding(null)} aria-label="Close" className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-white"><X className="h-4 w-4" /></button>
                    </div>
                    {adding === 'existing' ? (
                        <select value={pick} onChange={e => setPick(e.target.value)} aria-label="Admin" className="h-11 w-full max-w-md rounded-xl border border-gray-300 bg-white px-3 text-sm">
                            <option value="">Choose an admin</option>
                            {others.map(a => <option key={a.id} value={a.id}>{a.name} · {a.email}</option>)}
                        </select>
                    ) : (
                        <div className="grid gap-2 sm:grid-cols-3">
                            <Input value={person.name} onChange={e => setPerson({ ...person, name: e.target.value })} placeholder="Name" className="h-11 bg-white" aria-label="Name" />
                            <Input value={person.email} onChange={e => setPerson({ ...person, email: e.target.value })} placeholder="Email" type="email" className="h-11 bg-white" aria-label="Email" />
                            <Input value={person.phone} onChange={e => setPerson({ ...person, phone: e.target.value })} placeholder="Phone" inputMode="tel" className="h-11 bg-white" aria-label="Phone" />
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        {ROLES.map((r, i) => (
                            <button key={r.name} onClick={() => setRole(i)} className={cn("rounded-xl border bg-white px-3 py-2 text-left text-sm",
                                role === i ? "border-2 border-orange-600" : "border-gray-300")}>
                                <span className="block font-semibold text-gray-900">{r.name}</span>
                                <span className="block text-xs text-gray-500">{r.who}</span>
                            </button>
                        ))}
                    </div>
                    {adding === 'existing' ? (
                        <Button disabled={!pick || saving !== null} className="h-11 rounded-xl bg-gray-900 font-bold"
                            onClick={() => { const a = admins.find(x => x.id === pick); if (a) save(a, ROLES[role].rights, `${a.name} added as ${ROLES[role].name}`).then(() => { setPick(''); setAdding(null); }); }}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add to the team'}
                        </Button>
                    ) : (
                        <div className="flex flex-wrap items-center gap-3">
                            <Button disabled={saving !== null} className="h-11 rounded-xl bg-gray-900 font-bold" onClick={invite}>
                                {saving === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Invite'}
                            </Button>
                            <p className="text-xs text-gray-500">They get an email to set up their login, and see only Warranty Claims.</p>
                        </div>
                    )}
                </div>
            )}

            {/* On a phone, a card per person with the switches stacked. */}
            <div className="space-y-3 md:hidden">
                {!rows.length && <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">Nobody on the plant team yet. Add an admin or invite someone.</p>}
                {rows.map(row => (
                    <div key={row.a.id} className={cn("rounded-2xl border bg-white p-4 space-y-3", row.dirty ? "border-orange-300 bg-orange-50/40" : "border-gray-200")}>
                        <div className="min-w-0">
                            <p className="font-semibold text-gray-900">{row.a.name}</p>
                            <p className="truncate text-xs text-gray-500">{row.a.email}</p>
                        </div>
                        {row.roleSelect("h-11 w-full text-sm")}
                        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
                            {SWITCHES.map(s => (
                                <label key={s.key} className="flex min-h-[48px] items-center justify-between gap-3 px-3 text-sm font-medium text-gray-800">
                                    {s.label}
                                    <Switch checked={row.r[s.key]} onCheckedChange={v => row.set(s.key, v)} aria-label={`${s.label} for ${row.a.name}`} />
                                </label>
                            ))}
                        </div>
                        {rowActions(row)}
                    </div>
                ))}
            </div>

            <div className="hidden md:block rounded-2xl border border-gray-200 bg-white overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-bold uppercase text-gray-500">
                        <tr>
                            <th className="px-4 py-3">Person</th><th className="px-4 py-3">Role</th>
                            {SWITCHES.map(s => <th key={s.key} className="px-3 py-3 text-center whitespace-nowrap">{s.label}</th>)}
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {!team.length && <tr><td colSpan={SWITCHES.length + 3} className="px-4 py-8 text-center text-gray-500">Nobody on the plant team yet. Add an admin or invite someone.</td></tr>}
                        {rows.map(row => (
                            <tr key={row.a.id} className={cn("border-t border-gray-100", row.dirty && "bg-orange-50/40")}>
                                <td className="px-4 py-3"><p className="font-semibold text-gray-900">{row.a.name}</p><p className="text-xs text-gray-500">{row.a.email}</p></td>
                                <td className="px-4 py-3">{row.roleSelect("h-9 text-xs")}</td>
                                {SWITCHES.map(s => (
                                    <td key={s.key} className="px-3 py-3 text-center">
                                        <Switch checked={row.r[s.key]} onCheckedChange={v => row.set(s.key, v)} aria-label={`${s.label} for ${row.a.name}`} />
                                    </td>
                                ))}
                                <td className="px-4 py-3 whitespace-nowrap text-right">{rowActions(row)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {supers.length > 0 && (
                <p className="text-xs text-gray-500">Super admins always have every step: {supers.map(s => s.name).join(', ')}.</p>
            )}
        </div>
    );
};

export default PlantTeam;
