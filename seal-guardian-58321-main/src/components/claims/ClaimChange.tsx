import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { day, NEEDS_DESCRIPTION, PROBLEMS, type Claim } from "@/lib/claims";
import { FilePicker, MediaGrid, ProblemPicker, VehicleFields, claimForm, vehicleValueOf, type VehicleValue } from "@/components/claims/ClaimParts";

type Who = 'store' | 'customer';

/** What each kind of change is called, and what its note asks for. */
const MODES = {
    change: { open: 'Edit request', title: 'Edit request', note: 'Note (optional)', save: 'Save changes', done: 'Changes saved' },
    resend: { open: 'Edit and send again', title: 'Edit and send again', note: 'What you changed', save: 'Send again', done: 'Sent again' },
    ask_change: { open: 'Ask for a change', title: 'Ask the plant for a change', note: 'Why the change is needed', save: 'Send change request', done: 'Change request sent to the plant' },
} as const;
type Mode = keyof typeof MODES;

/**
 * The store's or the customer's change to a claim: an edit before the plant
 * decides, a change request once approved, or an edit and resend after a
 * rejection. Which one is offered comes from the server.
 */
export const ClaimChange = ({ c, who, onSaved }: { c: Claim; who: Who; onSaved: (c: Claim) => void }) => {
    const { toast } = useToast();
    const mode = (['resend', 'change', 'ask_change'] as Mode[]).find(m => c.actions.includes(m));
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [vehicle, setVehicle] = useState<VehicleValue>(vehicleValueOf(c.vehicle));
    const [problem, setProblem] = useState(c.problem);
    const [description, setDescription] = useState(c.description ?? '');
    const [photos, setPhotos] = useState<File[]>([]);
    const [note, setNote] = useState('');
    if (!mode || c.watching) return null;
    const m = MODES[mode];
    const airbags = c.snapshot?.product_type === 'seat-cover';

    const send = async () => {
        setBusy(true);
        try {
            const fd = await claimForm({ action: mode, ...vehicle, problem, description, note }, { photos });
            const r = await api.post(`/claims/${c.id}/action`, fd);
            onSaved({ ...c, ...r.data.claim });
            setOpen(false); setPhotos([]); setNote('');
            toast({ title: m.done });
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again in a moment.") });
        } finally {
            setBusy(false);
        }
    };

    if (!open) return (
        <Button variant="outline" onClick={() => setOpen(true)} className="h-12 sm:h-11 w-full sm:w-auto rounded-xl font-bold">
            <Pencil className="h-4 w-4 mr-1.5" />{m.open}
        </Button>
    );
    return (
        <section className="rounded-2xl border-2 border-orange-300 bg-white p-4 sm:p-5 space-y-4">
            <p className="text-base font-extrabold text-gray-900">{m.title}</p>
            <div className="space-y-1.5">
                <p className="text-sm font-semibold">Vehicle</p>
                <VehicleFields value={vehicle} onChange={setVehicle} airbags={airbags} registered={who === 'store' ? c.snapshot?.car : null} />
            </div>
            <div className="space-y-1.5">
                <p className="text-sm font-semibold">Issue</p>
                <ProblemPicker options={Object.keys(PROBLEMS)} value={problem} onChange={setProblem} />
                <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} maxLength={2000}
                    placeholder={NEEDS_DESCRIPTION.includes(problem) ? 'Describe the problem (needed)' : 'Description'} />
            </div>
            <div className="space-y-1.5">
                <p className="text-sm font-semibold">Add photos</p>
                <FilePicker files={photos} onChange={setPhotos} max={6} />
            </div>
            <label className="block space-y-1.5 text-sm font-semibold">{m.note}
                <Input value={note} onChange={e => setNote(e.target.value)} maxLength={1000} className="h-11 font-normal" />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
                <Button disabled={busy} onClick={send} className="h-12 sm:h-11 rounded-xl bg-orange-700 hover:bg-orange-800 font-bold px-6">
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : m.save}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setOpen(false)} className="h-12 sm:h-11 rounded-xl">Cancel</Button>
            </div>
        </section>
    );
};

/**
 * A change asked for after approval, waiting for the plant: what would change
 * and why. The plant approves or refuses it here.
 */
export const ChangeRequestBox = ({ c, busy, onApprove, onRefuse }: {
    c: Claim; busy?: boolean; onApprove?: () => void; onRefuse?: (note: string) => void;
}) => {
    const [note, setNote] = useState('');
    const rq = c.change_request;
    if (!rq) return null;
    const decide = Boolean(onApprove && c.actions.includes('change_ok'));
    return (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5 space-y-2 text-sm text-amber-950">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                Change asked for · {day(rq.at)} · by the {rq.by === 'vendor' ? 'store' : rq.by === 'customer' ? 'customer' : 'plant'} · waiting for the plant
            </p>
            <ul className="list-disc pl-5 font-semibold">{rq.changes.map((x, i) => <li key={i}>{x}</li>)}</ul>
            <p>{rq.note}</p>
            <MediaGrid urls={rq.photos} claimId={c.id} />
            {decide && (
                <div className="space-y-2 pt-2">
                    <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason, if you refuse" maxLength={1000} className="h-11 bg-white" />
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button disabled={busy} onClick={onApprove} className="h-11 rounded-xl bg-emerald-700 hover:bg-emerald-800 font-bold">Approve change</Button>
                        <Button variant="outline" disabled={busy} onClick={() => onRefuse?.(note)} className="h-11 rounded-xl">Refuse</Button>
                    </div>
                </div>
            )}
        </section>
    );
};
