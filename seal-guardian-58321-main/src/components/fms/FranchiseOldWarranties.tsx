import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Claim, ClaimWarranty } from "@/lib/claims";
import { StoreRaise } from "./FranchiseClaims";

/**
 * The store's warranties from the old portal (2023 – Apr 2026), placed with
 * the store by head office. The store finds one, sees whether it is still
 * covered, and raises a claim on it through the same claim form as a new
 * warranty; the steps after that are explained on the page.
 */

type OldWarranty = ClaimWarranty & { old: true; purchase_date: string | null };
type Data = {
    total: number; found: number; page: number; pages: number; claims_live: boolean;
    years: { year: number; n: number }[]; cover: { covered: number; over: number; not_recorded: number };
    warranties: OldWarranty[];
};

const day = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const fmt = (n: number) => n.toLocaleString("en-IN");

/** What a store does, and what happens after it raises a claim: the claim's real steps. */
const STEPS: { title: string; lines: string[] }[] = [
    { title: "Find the customer", lines: ["Search by the customer's name, mobile number or the warranty UID, or pick a year.", "Each warranty shows the product, the purchase date and its cover."] },
    { title: "Check the cover", lines: ["Covered till a date: you can raise a warranty claim.", "Cover over: you can raise an alteration (paid).", "Cover not recorded: the old portal did not save the cover. You can still raise a claim; head office confirms the cover first."] },
    { title: "Raise a claim", lines: ["Press Raise a claim, add the car, the problem and at least one photo, and send it to the plant.", "It then appears in Warranty Claims, where you follow it."] },
    { title: "What happens next", lines: ["With the plant: head office and the plant check it and decide.", "To repair: you repair it at your store. Or Being prepared: the plant makes the replacement.", "Customer to agree: for a paid job, the customer agrees to the charge before work starts.", "Dispatched: it is sent to you with a docket number. Fit it and press Fitted to close the claim.", "Not approved: the reason is shown on the claim."] },
];

function HowItWorks() {
    const [open, setOpen] = useState(true);
    return (
        <section className="rounded-2xl border border-orange-100 bg-orange-50/50">
            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
                <span className="text-sm font-bold text-gray-900">How old warranty claims work</span>
                <ChevronDown className={cn("h-4 w-4 text-gray-500 transition-transform", open && "rotate-180")} />
            </button>
            {open && (
                <ol className="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-4">
                    {STEPS.map((s, i) => (
                        <li key={s.title} className="rounded-xl bg-white p-3">
                            <p className="flex items-center gap-2 text-sm font-bold text-gray-900"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-orange-600 text-xs text-white">{i + 1}</span>{s.title}</p>
                            <ul className="mt-1.5 space-y-1">
                                {s.lines.map(l => <li key={l} className="text-xs leading-relaxed text-gray-600">{l}</li>)}
                            </ul>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}

/** The cover now: covered till, cover over, or not recorded. Also on the ASM's old warranties. */
export function OldCover({ w }: { w: Pick<ClaimWarranty, "covered" | "cover_end" | "cover_unknown"> }) {
    if (w.covered) return <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Covered till {day(w.cover_end)}</span>;
    if (w.cover_unknown) return <span className="whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Cover not recorded</span>;
    return <span className="whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">Cover over{w.cover_end ? ` ${day(w.cover_end)}` : ""}</span>;
}

export function FranchiseOldWarranties() {
    const { toast } = useToast();
    const [q, setQ] = useState("");
    const [query, setQuery] = useState("");
    const [year, setYear] = useState("");
    const [page, setPage] = useState(1);
    const [d, setD] = useState<Data | null>(null);
    const [loading, setLoading] = useState(true);
    const [raising, setRaising] = useState<OldWarranty | null>(null);
    const [sent, setSent] = useState<Claim | null>(null);

    useEffect(() => { const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 400); return () => clearTimeout(t); }, [q]);
    useEffect(() => {
        setLoading(true);
        api.get("/claims/store/old-warranties", { params: { ...(query ? { q: query } : {}), ...(year ? { year } : {}), page } })
            .then(r => setD(r.data))
            .catch(e => toast({ title: "Could not load your old warranties", description: getErrorMessage(e, "Try again"), variant: "destructive" }))
            .finally(() => setLoading(false));
    }, [query, year, page, toast]);

    if (raising) return (
        <StoreRaise preset={raising} backLabel="Old warranties" onBack={() => setRaising(null)} onDone={c => { setRaising(null); setSent(c); }} />
    );

    if (d && !d.total) return (
        <div className="mx-auto mt-8 w-full max-w-3xl space-y-4 md:mt-14">
            <h1 className="text-2xl font-extrabold text-gray-900">Old warranties</h1>
            <p className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">No old-portal warranties are placed with your store.</p>
        </div>
    );

    return (
        <div className="mx-auto mb-6 mt-8 w-full max-w-5xl space-y-4 md:mt-14">
            <div className="px-1">
                <h1 className="text-2xl font-extrabold text-gray-900">Old warranties</h1>
                <p className="text-sm text-gray-500">Warranties your store registered on the old portal{d?.years.length ? `, ${d.years[0].year} to ${d.years[d.years.length - 1].year}` : ""}.</p>
            </div>

            {sent && (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                    <div className="text-sm text-emerald-900"><b>Claim {sent.claim_no} sent to the plant.</b> Follow it in Warranty Claims.</div>
                </div>
            )}

            <HowItWorks />

            {d && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                        { label: "Old warranties", n: d.total, tone: "text-gray-900" },
                        { label: "Covered now", n: d.cover.covered, tone: "text-emerald-700" },
                        { label: "Cover over", n: d.cover.over, tone: "text-gray-600" },
                        { label: "Cover not recorded", n: d.cover.not_recorded, tone: "text-amber-800" },
                    ].map(t => (
                        <div key={t.label} className="rounded-2xl border border-gray-100 bg-white px-4 py-3">
                            <p className={cn("text-2xl font-black tabular-nums", t.tone)}>{fmt(t.n)}</p>
                            <p className="text-xs font-semibold text-gray-500">{t.label}</p>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Customer name, mobile or UID" className="h-11 rounded-xl pl-9" aria-label="Search by customer name, mobile or UID" /></div>
                <select value={year} onChange={e => { setYear(e.target.value); setPage(1); }} aria-label="Year" className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm">
                    <option value="">All years</option>
                    {(d?.years ?? []).map(y => <option key={y.year} value={y.year}>{y.year} ({fmt(y.n)})</option>)}
                </select>
            </div>
            {d && !d.claims_live && <p className="text-sm text-amber-800">Claims are not open yet: you can see and search your old warranties now; Raise a claim opens when claims start.</p>}

            <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white">
                {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><Loader2 className="h-5 w-5 animate-spin text-orange-600" /></div>}
                <ul className="divide-y divide-gray-50">
                    {(d?.warranties ?? []).map(w => (
                        <li key={w.uid + (w.purchase_date ?? "")} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-gray-900">{w.customer_name || "—"} <span className="font-normal tabular-nums text-gray-500">{w.customer_phone}</span></p>
                                <p className="text-xs text-gray-600">{[w.product_name, w.warranty_type, `bought ${day(w.purchase_date)}`].filter(Boolean).join(" · ")}</p>
                                <p className="font-mono text-[11px] text-gray-400">UID {w.uid}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <OldCover w={w} />
                                {d?.claims_live && w.claimable && (
                                    <Button size="sm" className="rounded-xl bg-orange-700 font-bold hover:bg-orange-800" onClick={() => { setSent(null); setRaising(w); }}>Raise a claim</Button>
                                )}
                            </div>
                        </li>
                    ))}
                    {d && !d.warranties.length && <li className="px-4 py-10 text-center text-sm text-gray-500">No old warranty matches.</li>}
                </ul>
            </div>
            {d && d.pages > 1 && (
                <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="mr-auto text-gray-500">{fmt(d.found)} found</span>
                    <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-gray-200 bg-white p-1.5 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                    <span className="tabular-nums text-gray-600">Page {page} of {d.pages}</span>
                    <button type="button" disabled={page >= d.pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-gray-200 bg-white p-1.5 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
                </div>
            )}
        </div>
    );
}
