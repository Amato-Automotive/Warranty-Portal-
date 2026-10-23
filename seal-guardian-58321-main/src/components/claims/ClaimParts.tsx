import { useEffect, useMemo } from "react";
import { Camera, Check, FileText, Play, Truck, X } from "lucide-react";
import { cn, formatToIST } from "@/lib/utils";
import { compressImage, isCompressibleImage } from "@/lib/imageCompression";
import {
    PROBLEMS, STATUS, NOT_COVERED_LINE, trackerSteps, isPhoto, isVideo, day,
    type Claim, type ClaimHistory, type ClaimStatus,
} from "@/lib/claims";

type Who = 'admin' | 'store' | 'customer';

export const ClaimStatusPill = ({ status, who, className }: { status: ClaimStatus; who: Who; className?: string }) => (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap", STATUS[status]?.tone, className)}>
        {STATUS[status]?.[who] ?? status}
    </span>
);

/** Photos, videos and PDFs on a claim, each opening in a new tab. */
export const MediaGrid = ({ urls, className }: { urls: string[] | null | undefined; className?: string }) => {
    if (!urls?.length) return null;
    return (
        <div className={cn("grid grid-cols-3 sm:grid-cols-4 gap-2", className)}>
            {urls.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noreferrer" className="relative aspect-square overflow-hidden rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center">
                    {isPhoto(u) ? <img src={u} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                        : isVideo(u) ? <span className="flex flex-col items-center gap-1 text-xs font-semibold text-gray-600"><Play className="h-6 w-6" />Video</span>
                            : <span className="flex flex-col items-center gap-1 text-xs font-semibold text-gray-600"><FileText className="h-6 w-6" />File</span>}
                </a>
            ))}
        </div>
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

/** Choose the problem: what the T&C cover, or an alteration, with the exclusions underneath. */
export const ProblemPicker = ({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) => (
    <div className="space-y-2">
        {options.map(p => (
            <label key={p} className={cn("flex items-center gap-3 rounded-xl border bg-white px-4 py-3 min-h-[52px] cursor-pointer",
                value === p ? "border-2 border-orange-600" : "border-gray-200")}>
                <input type="radio" name="claim-problem" checked={value === p} onChange={() => onChange(p)} className="h-4 w-4 accent-orange-600" />
                <span>
                    <span className="block text-sm font-semibold text-gray-900">{PROBLEMS[p]?.label ?? p}</span>
                    <span className="block text-xs text-gray-500">{PROBLEMS[p]?.hint}</span>
                </span>
            </label>
        ))}
        {options.some(p => p !== 'alteration') && <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">{NOT_COVERED_LINE}</p>}
    </div>
);

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

/** The customer's view of where the claim is. */
export const ClaimTracker = ({ c }: { c: Claim }) => {
    if (c.status === 'rejected') return null;
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
                        {s.current && c.dispatch?.courier && s.label === 'Material on the way' && (
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-600"><Truck className="h-3.5 w-3.5 text-orange-600" />{[c.dispatch.courier, c.dispatch.tracking].filter(Boolean).join(' · ')}</p>
                        )}
                    </div>
                </li>
            ))}
        </ol>
    );
};

/** Every step with when and who; undone steps struck through. */
export const ClaimTimeline = ({ history, who }: { history: ClaimHistory[] | null | undefined; who: Who }) => {
    if (!history?.length) return null;
    const by = (h: ClaimHistory) => h.by_role === 'admin' ? (who === 'admin' ? h.by_name || 'Head office' : 'Autoform')
        : h.by_role === 'vendor' ? (who === 'store' ? 'You' : h.by_name || 'Store') : (who === 'customer' ? 'You' : 'Customer');
    return (
        <ol className="space-y-3">
            {history.map((h, i) => (
                <li key={i} className="text-sm">
                    <p className={cn("font-semibold text-gray-900", h.undone && "line-through text-gray-400")}>{h.text}</p>
                    <p className="text-xs text-gray-500">{formatToIST(h.at)} · {by(h)}</p>
                    {h.note && h.action !== 'raised' && <p className="mt-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700 break-words">{h.note}</p>}
                </li>
            ))}
        </ol>
    );
};

/** A choice drawn as large tappable cards. */
export function ChoiceRow<T extends string>({ options, value, onChange, name }: { options: { value: T; label: string }[]; value: T | ''; onChange: (v: T) => void; name: string }) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map(o => (
                <label key={o.value} className={cn("flex items-center gap-2 rounded-xl border bg-white px-4 min-h-[44px] text-sm font-semibold cursor-pointer",
                    value === o.value ? "border-2 border-orange-600" : "border-gray-300")}>
                    <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} className="h-4 w-4 accent-orange-600" />
                    {o.label}
                </label>
            ))}
        </div>
    );
}
