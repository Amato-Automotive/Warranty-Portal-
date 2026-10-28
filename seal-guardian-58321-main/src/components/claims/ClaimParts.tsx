import { useEffect, useMemo, useState } from "react";
import { Camera, Check, ChevronDown, FileText, Loader2, Play, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { cn, formatToIST } from "@/lib/utils";
import { compressImage, isCompressibleImage } from "@/lib/imageCompression";
import { PhotoViewer } from "@/components/claims/PhotoViewer";
import {
    PROBLEMS, NEEDS_DESCRIPTION, STATUS, NOT_COVERED_LINE, AIRBAGS, trackerSteps, isPhoto, isVideo, day, vehicleText,
    type Claim, type ClaimHistory, type ClaimStatus, type Vehicle,
} from "@/lib/claims";

type Who = 'admin' | 'store' | 'customer';

export const ClaimStatusPill = ({ status, who, className }: { status: ClaimStatus; who: Who; className?: string }) => (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap", STATUS[status]?.tone, className)}>
        {STATUS[status]?.[who] ?? status}
    </span>
);

/** What each attachment is called in the viewer. */
export const mediaItems = (urls: string[], claimId?: number) => urls.map((u, i) => ({ url: u, claimId, label: isVideo(u) ? `Video ${i + 1}` : isPhoto(u) ? `Photo ${i + 1}` : `File ${i + 1}` }));

/** Photos, videos and PDFs on a claim, each opening large in the viewer. */
export const MediaGrid = ({ urls, className, claimId }: { urls: string[] | null | undefined; className?: string; claimId?: number }) => {
    const [open, setOpen] = useState<number | null>(null);
    if (!urls?.length) return null;
    return (
        <>
            <div className={cn("grid grid-cols-3 sm:grid-cols-4 gap-2", className)}>
                {urls.map((u, i) => (
                    <button key={i} type="button" onClick={() => setOpen(i)} aria-label={`Open attachment ${i + 1}`}
                        className="relative aspect-square overflow-hidden rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center hover:border-orange-400">
                        {isPhoto(u) ? <img src={u} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                            : isVideo(u) ? <span className="flex flex-col items-center gap-1 text-xs font-semibold text-gray-600"><Play className="h-6 w-6" />Video</span>
                                : <span className="flex flex-col items-center gap-1 text-xs font-semibold text-gray-600"><FileText className="h-6 w-6" />File</span>}
                    </button>
                ))}
            </div>
            {open !== null && <PhotoViewer items={mediaItems(urls, claimId)} start={open} onClose={() => setOpen(null)} />}
        </>
    );
};

/** Files picked on the phone or computer before they are sent, with previews and a remove button. */
export const FilePicker = ({ files, onChange, max = 5, accept = "image/*", label = "Add photo", hint }: {
    files: File[]; onChange: (f: File[]) => void; max?: number; accept?: string; label?: string; hint?: string;
}) => {
    const previews = useMemo(() => files.map(f => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)), [files]);
    useEffect(() => () => previews.forEach(p => p && URL.revokeObjectURL(p)), [previews]);
    return (
        <div className="space-y-2">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {files.map((f, i) => (
                    <div key={i} className="relative aspect-square rounded-xl bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center">
                        {previews[i] ? <img src={previews[i]!} alt={f.name} className="h-full w-full object-cover" />
                            : <span className="flex flex-col items-center gap-1 text-[11px] font-semibold text-gray-600 px-1 text-center"><Play className="h-5 w-5" />{f.name.slice(0, 18)}</span>}
                        <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}
                            className="absolute top-1 right-1 h-7 w-7 rounded-full bg-white/90 shadow flex items-center justify-center">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                ))}
                {files.length < max && (
                    <label className="aspect-square rounded-xl border-2 border-dashed border-gray-300 bg-white flex flex-col items-center justify-center gap-1 text-xs font-semibold text-gray-600 cursor-pointer hover:border-orange-400">
                        <Camera className="h-5 w-5" />{label}
                        <input type="file" accept={accept} multiple className="sr-only"
                            onChange={e => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; onChange([...files, ...picked].slice(0, max)); }} />
                    </label>
                )}
            </div>
            {hint && <p className="text-xs text-gray-500">{hint}</p>}
        </div>
    );
};

/** The form to send: images made smaller first, every field as text. */
export async function claimForm(fields: Record<string, unknown>, files: Record<string, File[]>): Promise<FormData> {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, String(v));
    for (const [field, list] of Object.entries(files)) {
        for (const f of list) fd.append(field, isCompressibleImage(f) ? await compressImage(f) : f);
    }
    return fd;
}

/**
 * Choose the issue. A grouped list rather than cards: the plant's list runs to
 * about 70, which only a dropdown keeps usable on a phone.
 */
export const ProblemPicker = ({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) => {
    const groups = useMemo(() => {
        const g = new Map<string, string[]>();
        for (const p of options) {
            const name = PROBLEMS[p]?.group ?? 'Other';
            g.set(name, [...(g.get(name) ?? []), p]);
        }
        return [...g.entries()];
    }, [options]);
    return (
        <div className="space-y-2">
            <select value={value} onChange={e => onChange(e.target.value)} aria-label="Issue"
                className="h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold">
                <option value="">Choose the issue</option>
                {groups.map(([name, list]) => (
                    <optgroup key={name} label={name}>
                        {list.map(p => <option key={p} value={p}>{PROBLEMS[p]?.label ?? p}</option>)}
                    </optgroup>
                ))}
            </select>
            {value && PROBLEMS[value]?.hint && <p className="text-xs text-gray-500">{PROBLEMS[value].hint}</p>}
            {options.some(p => p !== 'alteration') && <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">{NOT_COVERED_LINE}</p>}
        </div>
    );
};

export interface VehicleValue {
    vehicle_make: string; vehicle_model: string; airbags: '' | 'with' | 'sab' | 'without'; major_colour: string; minor_colour: string;
}
export const EMPTY_VEHICLE: VehicleValue = { vehicle_make: '', vehicle_model: '', airbags: '', major_colour: '', minor_colour: '' };
export const vehicleValueOf = (v: Vehicle | null | undefined): VehicleValue => ({
    vehicle_make: v?.make ?? '', vehicle_model: v?.model ?? '', airbags: v?.airbags ?? '', major_colour: v?.major_colour ?? '', minor_colour: v?.minor_colour ?? '',
});

/* The make → model list, loaded once a page; a customer gets no Maruti Suzuki models and types it. */
let modelsOnce: Promise<Record<string, string[]>> | null = null;
function useCarModels() {
    const [models, setModels] = useState<Record<string, string[]>>({});
    useEffect(() => {
        modelsOnce ??= api.get('/claims/meta').then(r => r.data.models ?? {}).catch(() => { modelsOnce = null; return {}; });
        let alive = true;
        modelsOnce.then(m => alive && setModels(m));
        return () => { alive = false; };
    }, []);
    return models;
}

const OTHER = '__other';

/** A list to pick from, with "Other" to type one that is not in it. */
const PickOrType = ({ label, options, value, onChange, placeholder }: {
    label: string; options: string[]; value: string; onChange: (v: string) => void; placeholder: string;
}) => {
    const [typing, setTyping] = useState(false);
    const listed = options.includes(value);
    if (!options.length || typing || (value && !listed)) return (
        <div className="space-y-1">
            <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={60} className="h-12 rounded-xl" aria-label={label} />
            {options.length > 0 && (
                <button type="button" onClick={() => { setTyping(false); onChange(''); }} className="text-xs font-semibold text-orange-700">Pick from the list</button>
            )}
        </div>
    );
    return (
        <select value={listed ? value : ''} aria-label={label} onChange={e => { if (e.target.value === OTHER) { setTyping(true); onChange(''); } else onChange(e.target.value); }}
            className="h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold">
            <option value="">{label}</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
            <option value={OTHER}>Other (type it)</option>
        </select>
    );
};

/** Make and model from the list, and for seat covers the airbags and the cover's colours. */
export const VehicleFields = ({ value, onChange, airbags, registered }: {
    value: VehicleValue; onChange: (v: VehicleValue) => void; airbags: boolean; registered?: string | null;
}) => {
    const models = useCarModels();
    const makes = Object.keys(models);
    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
                <PickOrType label="Make" options={makes} value={value.vehicle_make} placeholder="Make"
                    onChange={v => onChange({ ...value, vehicle_make: v, vehicle_model: v === value.vehicle_make ? value.vehicle_model : '' })} />
                <PickOrType key={value.vehicle_make} label="Model" options={models[value.vehicle_make] ?? []} value={value.vehicle_model} placeholder="Model"
                    onChange={v => onChange({ ...value, vehicle_model: v })} />
            </div>
            {airbags && (
                <>
                    <ChoiceRow<'with' | 'sab' | 'without'> name="airbags" value={value.airbags} onChange={v => onChange({ ...value, airbags: v })}
                        options={(['with', 'sab', 'without'] as const).map(k => ({ value: k, label: AIRBAGS[k] }))} />
                    <div className="grid grid-cols-2 gap-2">
                        <Input value={value.major_colour} onChange={e => onChange({ ...value, major_colour: e.target.value })} placeholder="Major colour" maxLength={40} className="h-12 rounded-xl" aria-label="Major colour" />
                        <Input value={value.minor_colour} onChange={e => onChange({ ...value, minor_colour: e.target.value })} placeholder="Minor colour" maxLength={40} className="h-12 rounded-xl" aria-label="Minor colour" />
                    </div>
                </>
            )}
            {registered && <p className="text-xs text-gray-500">Registered as: {registered}</p>}
        </div>
    );
};

/** What a new request is missing, in the words a toast shows; null when complete. */
export function missingForRequest(f: { problem: string; description: string; vehicle: VehicleValue; airbags: boolean; photos: number }): string | null {
    if (!f.vehicle.vehicle_make.trim()) return 'Enter the vehicle make';
    if (!f.vehicle.vehicle_model.trim()) return 'Enter the vehicle model';
    if (f.airbags && !f.vehicle.airbags) return 'Choose with airbags, SAB or without airbags';
    if (f.airbags && !f.vehicle.major_colour.trim()) return 'Enter the major colour';
    if (!f.problem) return 'Choose the issue';
    if (NEEDS_DESCRIPTION.includes(f.problem) && f.description.trim().length < 5) return 'Describe the problem';
    if (!f.photos) return 'Add at least one photo';
    return null;
}

/** The claim's own details: the vehicle, the issue and the customer's words. */
export const ClaimDetails = ({ c }: { c: Claim }) => (
    <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-gray-500">Vehicle</dt><dd className="font-semibold text-gray-900">{vehicleText(c.vehicle) ?? '—'}</dd>
        <dt className="text-gray-500">Issue</dt><dd className="font-semibold text-gray-900">{c.problem_text}{c.kind === 'alteration' ? ' (alteration)' : ''}</dd>
        {c.description && <><dt className="text-gray-500">Details</dt><dd className="text-gray-700 break-words">{c.description}</dd></>}
    </dl>
);

/**
 * A chargeable claim's agreement. The customer agrees for themselves; the
 * store, with the customer in front of it, ticks that the customer agreed.
 */
export const ConsentBox = ({ who, busy, onAgree, onDecline }: {
    who: 'customer' | 'store'; busy: boolean; onAgree: (note: string) => void; onDecline: (note: string) => void;
}) => {
    const [ticked, setTicked] = useState(false);
    const [note, setNote] = useState('');
    return (
        <div id={STEP_ID} className="scroll-mt-20 rounded-xl border-2 border-purple-200 bg-purple-50 p-4 space-y-3">
            <p className="font-bold text-purple-900">This repair is chargeable</p>
            <p className="text-sm text-purple-900">
                {who === 'customer'
                    ? 'It is not covered free of cost. The store will tell you the amount, and you pay at the store. Nothing is done until you agree.'
                    : 'Tell the customer it is chargeable and the amount; they pay at the store. Agree only once the customer has said yes.'}
            </p>
            <label className="flex items-start gap-3 text-sm font-semibold text-purple-950 cursor-pointer">
                <input type="checkbox" checked={ticked} onChange={e => setTicked(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-purple-700" />
                {who === 'customer'
                    ? 'I understand this is chargeable and agree to pay at the store.'
                    : 'The customer has understood the charge and agreed to it. I am confirming on their behalf.'}
            </label>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" maxLength={500} className="h-11 rounded-xl bg-white" />
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button disabled={!ticked || busy} onClick={() => onAgree(note)} className="h-12 sm:h-11 rounded-xl bg-purple-700 hover:bg-purple-800 font-bold">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : who === 'customer' ? 'I agree' : 'Customer agreed'}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => onDecline(note)} className="h-12 sm:h-11 rounded-xl">
                    {who === 'customer' ? 'No, I do not want it' : 'Customer declined'}
                </Button>
            </div>
        </div>
    );
};

/** Product, car and cover in two lines. */
export const ClaimSummary = ({ c }: { c: Claim }) => {
    const s = c.snapshot;
    return (
        <div className="space-y-0.5 text-sm text-gray-600">
            <p>{[s?.customer_name, s?.car, s?.registration_number].filter(Boolean).join(' · ')}</p>
            <p>{[s?.product_name, `UID ${c.warranty_uid}`, s?.warranty_type, s?.cover_end ? `covered till ${day(s.cover_end)}` : null].filter(Boolean).join(' · ')}</p>
        </div>
    );
};

/** Where the claim is, step by step: the same tracker for the customer, the store and the plant. */
export const ClaimTracker = ({ c }: { c: Claim }) => {
    if (c.status === 'rejected' || c.status === 'declined') return null;
    const steps = trackerSteps(c);
    return (
        <ol className="space-y-0">
            {steps.map((s, i) => (
                <li key={s.label} className="flex gap-3">
                    <div className="flex flex-col items-center">
                        <span className={cn("h-6 w-6 rounded-full flex items-center justify-center shrink-0",
                            s.done ? "bg-emerald-700 text-white" : s.current ? "border-[3px] border-blue-700 bg-white" : "border-2 border-gray-300 bg-white")}>
                            {s.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                        </span>
                        {i < steps.length - 1 && <span className={cn("w-0.5 flex-1 min-h-[22px]", s.done ? "bg-emerald-700" : "bg-gray-200")} />}
                    </div>
                    <div className="pb-4">
                        <p className={cn("text-sm font-semibold", s.done || s.current ? "text-gray-900" : "text-gray-500")}>{s.label}</p>
                        {s.detail && (s.done || s.current) && (
                            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-600">
                                {s.label === 'Dispatched' && <Truck className="h-3.5 w-3.5 text-orange-600" />}{s.detail}
                            </p>
                        )}
                        {s.current && c.status === 'on_hold' && <p className="mt-0.5 text-xs font-semibold text-yellow-800">On hold at the plant</p>}
                    </div>
                </li>
            ))}
        </ol>
    );
};

/** Every step with when and who; undone steps struck through. */
export const ClaimTimeline = ({ history, who }: { history: ClaimHistory[] | null | undefined; who: Who }) => {
    if (!history?.length) return null;
    const by = (h: ClaimHistory) => h.by_role === 'admin' ? (who === 'admin' ? h.by_name || 'Plant' : 'Autoform')
        : h.by_role === 'vendor' ? (who === 'store' ? 'You' : h.by_name || 'Store') : (who === 'customer' ? 'You' : 'Customer');
    return (
        <ol className="space-y-3">
            {history.map((h, i) => (
                <li key={i} className="text-sm">
                    <p className={cn("font-semibold text-gray-900", h.undone && "line-through text-gray-400")}>{h.text}</p>
                    <p className="text-xs text-gray-500">{formatToIST(h.at)} · {by(h)}</p>
                    {h.note && h.action !== 'raised' && <p className="mt-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700 break-words">{h.note}</p>}
                    {h.changes?.length ? (
                        <ul className="mt-1 list-disc pl-5 text-xs text-gray-600 space-y-0.5">{h.changes.map((ch, j) => <li key={j}>{ch}</li>)}</ul>
                    ) : null}
                </li>
            ))}
        </ol>
    );
};

/**
 * The page's main button pinned to the bottom of a phone screen, so it is
 * never a long scroll away. On wider screens the inline button is used.
 */
export const MobileActionBar = ({ children }: { children: React.ReactNode }) => (
    <>
        <div className="h-20 sm:hidden" aria-hidden />
        <div className="sm:hidden fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {children}
        </div>
    </>
);

/** The id of the section holding the step this person takes on a claim. */
export const STEP_ID = 'claim-step';

/**
 * On a phone, a button at the bottom that takes the person to their step
 * (verify, decide, dispatch…), shown until that step is on screen.
 */
export const StepJump = ({ label }: { label: string | null }) => {
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        const el = document.getElementById(STEP_ID);
        if (!label || !el || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { rootMargin: '0px 0px -30% 0px' });
        io.observe(el);
        return () => io.disconnect();
    }, [label]);
    if (!label || seen) return null;
    return (
        <MobileActionBar>
            <Button className="h-12 w-full rounded-xl bg-orange-700 hover:bg-orange-800 text-base font-bold"
                onClick={() => document.getElementById(STEP_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                {label}<ChevronDown className="h-5 w-5 ml-1" />
            </Button>
        </MobileActionBar>
    );
};

/** One numbered step of a request form, ticked once it is filled in. */
export const FormStep = ({ n, title, note, done, action, children }: {
    n: number; title: string; note?: string; done?: boolean; action?: React.ReactNode; children: React.ReactNode;
}) => (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold",
                    done ? "bg-emerald-600 text-white" : "bg-orange-100 text-orange-800")}>
                    {done ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
                </span>
                <div className="min-w-0">
                    <h2 className="text-base font-extrabold text-gray-900">{title}</h2>
                    {note && <p className="text-xs text-gray-500">{note}</p>}
                </div>
            </div>
            {action}
        </div>
        <div className="space-y-3">{children}</div>
    </section>
);

/** A row of chips that scrolls sideways on a phone rather than wrapping onto several lines. */
export const ChipRow = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={cn("flex gap-2 overflow-x-auto no-scrollbar pb-1 sm:flex-wrap sm:overflow-visible [&>*]:shrink-0", className)}>{children}</div>
);

/** A choice drawn as large tappable cards: two to a row on a phone. */
export function ChoiceRow<T extends string>({ options, value, onChange, name }: { options: { value: T; label: string }[]; value: T | ''; onChange: (v: T) => void; name: string }) {
    return (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {options.map(o => (
                <label key={o.value} className={cn("flex items-center gap-2 rounded-xl border bg-white px-3 sm:px-4 py-2 min-h-[48px] text-sm font-semibold cursor-pointer",
                    value === o.value ? "border-2 border-orange-600" : "border-gray-300")}>
                    <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} className="h-4 w-4 accent-orange-600" />
                    {o.label}
                </label>
            ))}
        </div>
    );
}
