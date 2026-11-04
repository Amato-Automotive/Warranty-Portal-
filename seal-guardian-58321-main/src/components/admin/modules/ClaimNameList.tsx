import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { parseNames } from "@/lib/claims";

/** A list of names the admin keeps for claims, such as materials or couriers. `start` is the list until one is saved. */
export const ClaimNameList = ({ settingKey, what, start = [] }: { settingKey: string; what: string; start?: readonly string[] }) => {
    const { toast } = useToast();
    const [list, setList] = useState<string[] | null>(null);
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.get(`/settings/public/${settingKey}`)
            .then(r => setList(parseNames(r.data?.value)))
            .catch(e => {
                if (e?.response?.status === 404) return setList([...start]);
                toast({ variant: "destructive", title: "Could not load the list", description: getErrorMessage(e, "Try again in a moment.") });
            });
    }, [settingKey]);

    const save = async (next: string[], then?: () => void) => {
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

    const add = () => {
        const v = name.trim();
        if (!v || !list) return;
        if (list.some(x => x.toLowerCase() === v.toLowerCase())) return toast({ variant: "destructive", title: `${v} is already in the list` });
        save([...list, v], () => setName(""));
    };

    return (
        <div className="max-w-xl space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
            <form onSubmit={e => { e.preventDefault(); add(); }} className="flex gap-2">
                <Input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder={`${what} name`} aria-label={`${what} name`} className="h-11 flex-1 rounded-xl" />
                <Button type="submit" disabled={saving || !name.trim() || !list} className="h-11 rounded-xl bg-orange-700 font-bold hover:bg-orange-800">
                    <Plus className="mr-1 h-4 w-4" />Add
                </Button>
            </form>
            {list === null ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-orange-600" /></div>
            ) : !list.length ? (
                <p className="py-4 text-center text-sm text-gray-500">Nothing in the list yet.</p>
            ) : (
                <ul className="divide-y divide-gray-100">
                    {list.map(m => (
                        <li key={m} className="flex items-center justify-between gap-3 py-2">
                            <span className="min-w-0 break-words text-sm font-semibold text-gray-900">{m}</span>
                            <Button type="button" variant="ghost" size="icon" disabled={saving} aria-label={`Remove ${m}`} className="h-10 w-10 shrink-0 rounded-lg text-gray-500 hover:text-red-700"
                                onClick={() => save(list.filter(x => x !== m))}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
