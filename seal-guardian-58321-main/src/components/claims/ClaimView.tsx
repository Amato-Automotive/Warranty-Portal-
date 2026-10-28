import { useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WarrantySpecSheet } from "@/components/warranty/WarrantySpecSheet";
import { cn, formatToIST } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LabeledPhotos } from "@/components/claims/RegistrationPanel";
import { MediaGrid, mediaItems } from "@/components/claims/ClaimParts";
import { DownloadAll } from "@/components/claims/PhotoViewer";
import { decisionText, day, HOLD_REASONS, REJECT_REASONS, STATUS, trackerSteps, vehicleText, type Claim } from "@/lib/claims";

type Who = 'store' | 'customer' | 'admin';

/* The steps a person can take on a claim, as opposed to the plant's corrections. */
const STEPS = ['verify', 'consent', 'decline', 'fitted'];

/**
 * Where the claim is, at the top of the page: the status, the plant's
 * decision, and the expected date or the docket once there is one.
 */
export const StatusHero = ({ c, who }: { c: Claim; who: Who }) => {
    const mine = c.actions.some(a => STEPS.includes(a)) && !c.watching;
    const d = c.decision;
    const tone = mine ? 'step'
        : c.status === 'rejected' ? 'red'
            : c.status === 'declined' ? 'gray'
                : c.status === 'closed' ? 'green'
                    : c.status === 'on_hold' ? 'yellow' : 'blue';
    const box = {
        step: "bg-orange-50 border-2 border-orange-400", red: "bg-red-50 border border-red-200", gray: "bg-gray-100 border border-gray-200",
        green: "bg-emerald-50 border border-emerald-200", yellow: "bg-yellow-50 border border-yellow-200", blue: "bg-indigo-50 border border-indigo-200",
    }[tone];
    const ink = {
        step: "text-orange-900", red: "text-red-900", gray: "text-gray-700", green: "text-emerald-900", yellow: "text-yellow-900", blue: "text-indigo-900",
    }[tone];
    const pill = {
        step: "bg-orange-700", red: "bg-red-700", gray: "bg-gray-600", green: "bg-emerald-700", yellow: "bg-yellow-700", blue: "bg-indigo-700",
    }[tone];
    const line = c.status === 'on_hold' && c.hold ? [HOLD_REASONS[c.hold.reason] ?? 'On hold', c.hold.note].filter(Boolean).join(' · ')
        : c.status === 'rejected' && d ? [REJECT_REASONS[d.reason ?? ''] ?? null, d.remarks].filter(Boolean).join(' · ')
            : decisionText(c);
    const showEdd = c.plan?.edd && ['plan', 'production', 'ready'].includes(c.status);
    const showDispatch = c.dispatch && c.status === 'dispatched';

    return (
        <section className={cn("rounded-2xl p-4 sm:p-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_260px] md:items-center", box)}>
            <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs sm:text-sm font-bold text-gray-600">{c.claim_no} · {c.kind === 'alteration' ? 'Alteration' : 'Warranty claim'}</span>
                    {mine && <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-extrabold text-white", pill)}>Your step</span>}
                </div>
                <h1 className="text-2xl sm:text-3xl font-black leading-tight text-gray-900">{STATUS[c.status]?.[who] ?? c.status_text}</h1>
                {line && <p className={cn("text-sm sm:text-base", ink)}>{line}</p>}
            </div>
            {showEdd && (
                <div className="rounded-xl bg-white px-4 py-3 border border-indigo-200">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">Expected by (EDD)</p>
                    <p className="text-2xl sm:text-3xl font-black text-indigo-950">{day(c.plan!.edd!)}</p>
                    {c.plan!.alteration_no && <p className="text-xs text-gray-600">Alteration no. {c.plan!.alteration_no}</p>}
                </div>
            )}
            {showDispatch && (
                <div className="rounded-xl bg-white px-4 py-3 border border-sky-200">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">Dispatched {day(c.dispatch!.date)}</p>
                    <p className="text-xl font-black text-sky-950 break-words">Docket {c.dispatch!.docket}</p>
                    {c.dispatch!.courier && <p className="text-xs text-gray-600">{c.dispatch!.courier}</p>}
                </div>
            )}
        </section>
    );
};

/**
 * The stages in one slim row: a short name and the date under each dot; the
 * full step, its date and time and any detail show on hover.
 */
export const StageDates = ({ c, who }: { c: Claim; who?: Who }) => {
    type Step = { short: string; label: string; at?: string | null; detail?: string | null; state: 'done' | 'now' | 'todo' | 'stop' };
    let steps: Step[];
    if (c.status === 'rejected' || c.status === 'declined') {
        steps = [{ short: 'Requested', label: 'Claim requested', at: c.created_at, state: 'done' }];
        if (c.verification) steps.push({ short: 'Verified', label: 'Verified by the store', at: c.verification.at, state: 'done' });
        if (c.status === 'declined' && c.decision) steps.push({ short: 'Approved', label: 'Approved by the plant', at: c.decision.at, state: 'done' });
        steps.push(c.status === 'rejected'
            ? { short: 'Rejected', label: 'Not approved by the plant', at: c.decision?.at, detail: c.decision ? REJECT_REASONS[c.decision.reason ?? ''] : null, state: 'stop' }
            : { short: 'Declined', label: 'Customer declined the charge', at: c.consent?.at, state: 'stop' });
    } else {
        steps = trackerSteps(c).map(s => {
            const wip = s.short === 'Being prepared';
            return {
                short: wip ? (who === 'admin' ? 'WIP' : 'Preparing') : s.short,
                label: wip && who === 'admin' ? 'Alteration no. given · WIP' : s.label,
                at: s.at,
                detail: wip ? [c.plan?.alteration_no && who === 'admin' ? `Alteration no. ${c.plan.alteration_no}` : null, s.edd ? `EDD ${day(s.edd)}` : null].filter(Boolean).join(' · ') || null : s.detail,
                state: s.done ? 'done' : s.current ? 'now' : 'todo',
            };
        });
    }
    return (
        <ol className="flex overflow-x-auto no-scrollbar rounded-xl border border-gray-200 bg-white px-2 py-3">
            {steps.map((s, i) => (
                <li key={s.label} className="relative flex min-w-[76px] flex-1 flex-col items-center">
                    {i > 0 && <span aria-hidden className={cn("absolute right-1/2 top-[11px] h-0.5 w-full", s.state === 'todo' ? "bg-gray-200" : "bg-emerald-600")} />}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button type="button" className="relative z-10 flex flex-col items-center gap-1 rounded-lg px-1 outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                                <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                                    s.state === 'done' ? "bg-emerald-600 text-white"
                                        : s.state === 'now' ? "border-[3px] border-orange-500 bg-white"
                                            : s.state === 'stop' ? "bg-red-600 text-white" : "border-2 border-gray-300 bg-white text-gray-400")}>
                                    {s.state === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : s.state === 'stop' ? '✕' : s.state === 'todo' ? i + 1 : null}
                                </span>
                                <span className={cn("whitespace-nowrap text-xs font-semibold",
                                    s.state === 'now' ? "text-orange-700" : s.state === 'stop' ? "text-red-700" : s.state === 'todo' ? "text-gray-400" : "text-gray-900")}>{s.short}</span>
                                <span className="text-[11px] tabular-nums text-gray-500">{s.at && s.state !== 'todo' ? day(s.at).replace(/ \d{4}$/, '') : '—'}</span>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                            <p className="font-bold">{s.label}</p>
                            <p className="text-xs">{s.at && s.state !== 'todo' ? formatToIST(s.at) : s.state === 'now' ? 'Now' : 'Not yet'}</p>
                            {s.detail && <p className="text-xs">{s.detail}</p>}
                        </TooltipContent>
                    </Tooltip>
                </li>
            ))}
        </ol>
    );
};

/**
 * The warranty as registered beside the claim, row by row, so the two are
 * easy to compare; a row that does not match is shaded.
 */
export const CompareTable = ({ c, who }: { c: Claim; who: Who }) => {
    const r = c.registration;
    const s = c.snapshot;
    const inside = who !== 'customer';
    const [sheet, setSheet] = useState(false);
    // The colours have rows of their own.
    const claimCar = c.vehicle ? vehicleText({ ...c.vehicle, major_colour: null, minor_colour: null }) : null;
    const carDiffers = Boolean(r?.car && c.vehicle?.model && !r.car.toLowerCase().includes(c.vehicle.model.toLowerCase()));
    const storeDiffers = Boolean(r?.fitted_store && c.store_name && r.fitted_store !== c.store_name);
    const rows: { k: string; left: React.ReactNode; right: React.ReactNode; diff?: boolean }[] = [
        { k: 'Product', left: r?.product_name, right: s?.product_name },
        { k: 'Vehicle', left: [r?.car, r?.car_colour].filter(Boolean).join(' · '), right: claimCar, diff: carDiffers },
        ...(c.vehicle?.major_colour || c.vehicle?.minor_colour ? [
            { k: 'Major colour', left: null, right: c.vehicle?.major_colour },
            { k: 'Minor colour', left: null, right: c.vehicle?.minor_colour },
        ] : []),
        { k: 'Car number', left: r?.registration_number, right: s?.registration_number },
        ...(inside ? [{ k: 'Customer', left: [r?.customer_name, r?.customer_phone].filter(Boolean).join(' · '), right: [s?.customer_name, s?.customer_phone].filter(Boolean).join(' · ') }] : []),
        ...(who === 'admin' && r?.customer_address ? [{ k: 'Address', left: r.customer_address, right: null }] : []),
        { k: 'Date', left: [r?.fitted_on ? `Fitted ${day(r.fitted_on)}` : null, who === 'admin' && r?.registered_on ? `registered ${day(r.registered_on)}` : null,
            who === 'admin' && r?.approved_on ? `approved ${day(r.approved_on)}` : null].filter(Boolean).join(' · '), right: `Raised ${day(c.created_at)}` },
        { k: 'Store', left: [[r?.fitted_store, r?.fitted_city].filter(Boolean).join(', '), inside ? r?.installer : null].filter(Boolean).join(' · '), right: [c.store_name, c.store_city].filter(Boolean).join(', '), diff: storeDiffers },
        { k: 'Warranty', left: r ? [r.warranty_type, r.cover_end ? `till ${day(r.cover_end)}` : null].filter(Boolean).join(' · ') : null, right: c.kind === 'alteration' ? 'Alteration' : 'Warranty claim' },
        { k: 'Issue', left: null, right: <>{c.problem_text}{c.description && <span className="block font-normal text-gray-700 break-words">“{c.description}”</span>}</> },
    ];
    const diffs = rows.filter(x => x.diff).length;
    const cell = "px-3 sm:px-4 py-2.5 text-sm font-semibold text-gray-900 break-words min-w-0";
    const dash = <span className="text-gray-400">—</span>;

    return (
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-3">
                <h2 className="text-base sm:text-lg font-extrabold text-gray-900">{who === 'customer' ? 'Your product' : 'At registration vs in this claim'}</h2>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {diffs > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">{diffs} differ{diffs === 1 ? 's' : ''}</span>}
                    {who === 'admin' && r?.row && <Button variant="outline" className="h-9 rounded-xl" onClick={() => setSheet(true)}>Open full registration</Button>}
                </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] border-t border-gray-200 bg-gray-50 text-[11px] font-bold uppercase tracking-wider">
                <span className="hidden sm:block" />
                <span className="px-3 sm:px-4 py-2 text-gray-500">{who === 'customer' ? 'When fitted' : 'At registration'}</span>
                <span className="px-3 sm:px-4 py-2 text-orange-700 border-l border-gray-200 sm:border-l-0">{who === 'customer' ? 'What you sent' : 'In this claim'}</span>
            </div>
            {/* The photos first, side by side. */}
            <div className="grid grid-cols-2 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] border-t border-gray-200">
                <span className="col-span-2 sm:col-span-1 px-3 sm:px-4 pt-2 sm:py-2.5 text-[11px] sm:text-sm font-bold sm:font-semibold text-gray-500 sm:text-gray-600">Photos</span>
                <div className="p-2 sm:p-3 min-w-0">
                    {r?.photos.length ? <LabeledPhotos photos={r.photos} claimId={c.id} className="grid-cols-2 sm:grid-cols-3" /> : dash}
                    {inside && r?.photos.length ? <div className="mt-2"><DownloadAll items={r.photos.map(p => ({ ...p, claimId: c.id }))} /></div> : null}
                </div>
                <div className="p-2 sm:p-3 min-w-0 border-l border-gray-200 sm:border-l-0">
                    {c.vehicle?.photo && <LabeledPhotos photos={[{ label: 'Vehicle', url: c.vehicle.photo }]} claimId={c.id} className="mb-2 grid-cols-2 sm:grid-cols-3" />}
                    {c.media?.length ? <MediaGrid urls={c.media} claimId={c.id} className="grid-cols-2 sm:grid-cols-3" /> : !c.vehicle?.photo && dash}
                    {inside && (c.media?.length || c.vehicle?.photo) ? (
                        <div className="mt-2"><DownloadAll items={[...(c.vehicle?.photo ? [{ url: c.vehicle.photo, label: 'Vehicle', claimId: c.id }] : []), ...mediaItems(c.media ?? [], c.id)]} /></div>
                    ) : null}
                </div>
            </div>
            {rows.map(x => (
                <div key={x.k} className={cn("grid grid-cols-2 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] border-t border-gray-200", x.diff && "bg-amber-50")}>
                    <span className="col-span-2 sm:col-span-1 px-3 sm:px-4 pt-2 sm:py-2.5 text-[11px] sm:text-sm font-bold sm:font-semibold text-gray-500 sm:text-gray-600">{x.k}</span>
                    <span className={cell}>{x.left || dash}</span>
                    <span className={cn(cell, "border-l border-gray-200 sm:border-l-0", x.diff && "text-amber-900")}>
                        {x.right || dash}{x.diff && <AlertTriangle className="ml-1 inline h-4 w-4 text-amber-600" />}
                    </span>
                </div>
            ))}
            {inside && !!r?.checks.length && (
                <ul className="flex flex-wrap gap-2 border-t border-gray-200 p-3 sm:p-4">
                    {r.checks.map((k, i) => (
                        <li key={i} className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
                            k.tone === 'ok' ? "bg-emerald-50 text-emerald-900" : k.tone === 'warn' ? "bg-amber-50 text-amber-900" : "bg-gray-100 text-gray-800")}>
                            {k.tone === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : k.tone === 'warn' ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <Info className="h-3.5 w-3.5 shrink-0" />}
                            {k.text}
                        </li>
                    ))}
                </ul>
            )}
            {who === 'admin' && r?.row && <WarrantySpecSheet isOpen={sheet} onClose={() => setSheet(false)} warranty={r.row} />}
        </section>
    );
};
