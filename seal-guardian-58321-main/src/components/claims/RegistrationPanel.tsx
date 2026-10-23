import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatToIST } from "@/lib/utils";
import { WarrantySpecSheet } from "@/components/warranty/WarrantySpecSheet";
import { day, isPhoto, type Claim } from "@/lib/claims";

const Row = ({ label, value }: { label: string; value: React.ReactNode }) =>
    value ? (
        <div className="min-w-0">
            <dt className="text-xs font-semibold text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-900 break-words">{value}</dd>
        </div>
    ) : null;

/** Photos with what each one is, opening full size in a new tab. */
export const LabeledPhotos = ({ photos }: { photos: { label: string; url: string }[] }) => (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {photos.map(p => (
            <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="block min-w-0">
                <span className="block aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
                    {isPhoto(p.url) ? <img src={p.url} alt={p.label} className="h-full w-full object-cover" loading="lazy" />
                        : <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs font-semibold text-gray-600"><FileText className="h-6 w-6" />PDF</span>}
                </span>
                <span className="mt-1 block truncate text-[11px] font-semibold text-gray-600">{p.label}</span>
            </a>
        ))}
    </div>
);

/**
 * The warranty as it was registered, beside the claim: what was fitted, when
 * and where, the registration photos to compare with, and the checks.
 */
export const RegistrationPanel = ({ c, who }: { c: Claim; who: 'admin' | 'store' }) => {
    const r = c.registration;
    const [open, setOpen] = useState(false);
    if (!r) return null;
    return (
        <section className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4 md:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-extrabold text-gray-900">At registration</p>
                {who === 'admin' && r.row && (
                    <Button variant="outline" className="h-10 rounded-xl" onClick={() => setOpen(true)}>Open full registration</Button>
                )}
            </div>

            {!!r.checks.length && (
                <ul className="space-y-1.5">
                    {r.checks.map((k, i) => (
                        <li key={i} className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
                            k.tone === 'ok' ? "bg-emerald-50 text-emerald-900" : k.tone === 'warn' ? "bg-amber-50 text-amber-900" : "bg-white text-gray-800")}>
                            {k.tone === 'ok' ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : k.tone === 'warn' ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> : <Info className="h-4 w-4 mt-0.5 shrink-0" />}
                            {k.text}
                        </li>
                    ))}
                </ul>
            )}

            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
                <Row label="Product" value={r.product_name} />
                <Row label="Warranty" value={`${r.warranty_type}${r.cover_end ? ` · till ${day(r.cover_end)}` : ''}`} />
                <Row label="UID" value={r.uid} />
                <Row label="Car" value={[r.car, r.car_colour].filter(Boolean).join(' · ')} />
                <Row label="Car number" value={r.registration_number} />
                <Row label="Customer" value={[r.customer_name, r.customer_phone].filter(Boolean).join(' · ')} />
                <Row label="Fitted on" value={day(r.fitted_on)} />
                <Row label="Fitted by" value={[r.fitted_store, r.fitted_city].filter(Boolean).join(', ') + (r.installer ? ` · ${r.installer}` : '')} />
                <Row label="Registered" value={`${day(r.registered_on)}${r.approved_on ? ` · approved ${day(r.approved_on)}` : ''}`} />
                {r.rolls?.length ? <Row label="Rolls" value={r.rolls.map(x => `${x.serial}${x.sqft ? ` · ${x.sqft} sqft` : ''}${x.area ? ` · ${x.area}` : ''}`).join('; ')} /> : null}
                {who === 'admin' && <Row label="Address" value={r.customer_address} />}
                {who === 'admin' && r.fraud_score != null && <Row label="Fraud score" value={String(r.fraud_score)} />}
            </dl>

            <div className="space-y-2">
                <p className="text-sm font-bold text-gray-900">Registration photos</p>
                {r.photos.length ? <LabeledPhotos photos={r.photos} /> : <p className="text-sm text-gray-500">No photos on the registration.</p>}
            </div>

            {who === 'admin' && !!r.remarks?.length && (
                <div className="space-y-1.5">
                    <p className="text-sm font-bold text-gray-900">Remarks on this warranty</p>
                    {r.remarks.map((m, i) => (
                        <p key={i} className="rounded-lg bg-white px-3 py-2 text-xs text-gray-700"><b>{m.admin_name}</b> · {formatToIST(m.created_at)}: {m.remark}</p>
                    ))}
                </div>
            )}

            {who === 'admin' && r.row && <WarrantySpecSheet isOpen={open} onClose={() => setOpen(false)} warranty={r.row} />}
        </section>
    );
};
