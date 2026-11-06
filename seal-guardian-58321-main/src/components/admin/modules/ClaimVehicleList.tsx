import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { parseComponentGroups } from "@/lib/claims";

type Vehicles = Record<string, string[]>;
const byName = (a: string, b: string) => a.localeCompare(b);

/**
 * A list of names under headings (makes and their vehicles, portions and their
 * components) that the admin keeps. `load` gives the list to start from; every
 * change is saved at once under `settingKey`.
 */
export const ClaimGroupedList = ({ settingKey, load, group, item, sorted = false, note }: {
    settingKey: string; load: () => Promise<Vehicles>; group: string; item: string; sorted?: boolean; note?: string;
}) => {
    const order = (names: string[]) => sorted ? [...names].sort(byName) : names;
    const { toast } = useToast();
    const [list, setList] = useState<Vehicles | null>(null);
    const [make, setMake] = useState("");
    const [newMake, setNewMake] = useState("");
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        load()
            .then(v => {
                setList(v);
                setMake(order(Object.keys(v))[0] ?? "");
            })
            .catch(e => toast({ variant: "destructive", title: "Could not load the list", description: getErrorMessage(e, "Try again in a moment.") }));
    }, []);

    const makes = useMemo(() => order(Object.keys(list ?? {})), [list]);
    const models = useMemo(() => order(list?.[make] ?? []), [list, make]);

    const save = async (next: Vehicles, then?: () => void) => {
        setSaving(true);
        try {
            await api.put(`/settings/admin/${settingKey}`, { value: JSON.stringify(next) });
            setList(next);
            then?.();
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Only someone with claims edit access can change this.") });
        } finally {
            setSaving(false);
        }
    };

    const addMake = () => {
        const v = newMake.trim();
        if (!v || !list) return;
        if (makes.some(m => m.toLowerCase() === v.toLowerCase())) return toast({ variant: "destructive", title: `${v} is already in the list` });
        save({ ...list, [v]: [] }, () => { setNewMake(""); setMake(v); });
    };
    const removeMake = () => {
        if (!list || !make || !window.confirm(`Remove ${make} and everything under it from the list?`)) return;
        const rest = { ...list };
        delete rest[make];
        save(rest, () => setMake(order(Object.keys(rest))[0] ?? ""));
    };
    const addModel = () => {
        const v = name.trim();
        if (!v || !list || !make) return;
        if (models.some(m => m.toLowerCase() === v.toLowerCase())) return toast({ variant: "destructive", title: `${v} is already in the list` });
        save({ ...list, [make]: [...(list[make] ?? []), v] }, () => setName(""));
    };

    if (list === null) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-orange-600" /></div>;

    return (
        <div className="max-w-xl space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
            <form onSubmit={e => { e.preventDefault(); addMake(); }} className="flex gap-2">
                <Input value={newMake} onChange={e => setNewMake(e.target.value)} maxLength={60} placeholder={`New ${group.toLowerCase()}`} aria-label={`New ${group.toLowerCase()}`} className="h-11 flex-1 rounded-xl" />
                <Button type="submit" disabled={saving || !newMake.trim()} className="h-11 rounded-xl bg-orange-700 font-bold hover:bg-orange-800"><Plus className="mr-1 h-4 w-4" />Add {group.toLowerCase()}</Button>
            </form>

            <div className="flex gap-2">
                <select value={make} onChange={e => setMake(e.target.value)} aria-label={group}
                    className="h-11 min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold">
                    {makes.map(m => <option key={m} value={m}>{m} ({list[m]?.length ?? 0})</option>)}
                </select>
                <Button type="button" variant="outline" disabled={saving || !make} onClick={removeMake} className="h-11 rounded-xl text-red-700">Remove {group.toLowerCase()}</Button>
            </div>

            {make && (
                <>
                    <form onSubmit={e => { e.preventDefault(); addModel(); }} className="flex gap-2">
                        <Input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder={`${item} under ${make}`} aria-label={`${item} name`} className="h-11 flex-1 rounded-xl" />
                        <Button type="submit" disabled={saving || !name.trim()} className="h-11 rounded-xl bg-orange-700 font-bold hover:bg-orange-800"><Plus className="mr-1 h-4 w-4" />Add</Button>
                    </form>
                    {!models.length ? (
                        <p className="py-4 text-center text-sm text-gray-500">Nothing under this {group.toLowerCase()} yet.</p>
                    ) : (
                        <ul className="max-h-[50vh] divide-y divide-gray-100 overflow-y-auto">
                            {models.map(m => (
                                <li key={m} className="flex items-center justify-between gap-3 py-2">
                                    <span className="min-w-0 break-words text-sm font-semibold text-gray-900">{m}</span>
                                    <Button type="button" variant="ghost" size="icon" disabled={saving} aria-label={`Remove ${m}`} className="h-10 w-10 shrink-0 rounded-lg text-gray-500 hover:text-red-700"
                                        onClick={() => save({ ...list, [make]: (list[make] ?? []).filter(x => x !== m) })}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
            {note && <p className="text-xs text-gray-500">{note}</p>}
        </div>
    );
};

/** The makes and vehicle names claims pick from. Starts from the plant's list. */
export const ClaimVehicleList = () => (
    <ClaimGroupedList settingKey="claim_vehicles" group="Make" item="Vehicle" sorted
        load={() => api.get("/claims/meta").then(r => r.data.plant_vehicles ?? {})}
        note="Customers see this list too, except Maruti Suzuki models: they type those." />
);

/** The components a seat cover claim is raised for, under their portions (front, rear...). */
export const ClaimComponentList = () => (
    <ClaimGroupedList settingKey="claim_components" group="Portion" item="Component"
        load={() => api.get("/settings/public/claim_components")
            .then(r => Object.fromEntries(parseComponentGroups(r.data?.value).map(g => [g.name || "Components", g.items])) as Vehicles)
            .catch(e => { if (e?.response?.status === 404) return {} as Vehicles; throw e; })} />
);
