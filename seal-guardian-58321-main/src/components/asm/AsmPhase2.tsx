import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ClipboardCheck, Loader2, Search } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { displayName } from "@/lib/asmStores";
import { AUDIT_QUESTIONS, BAND_META, auditLabel, scoreAudit } from "@/lib/auditQuestions";
import { AsmStoreDetail } from "./AsmStoreDetail";

/**
 * The ASM's stores' audits and warranty claims (read-only). Store names open
 * the store's page in place of the list.
 */

const dateText = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const Loading = () => <div className="flex items-center justify-center gap-3 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-orange-500" />Loading…</div>;

function useStoreOpener() {
    const [openId, setOpenId] = useState<string | null>(null);
    const open = (id: string | null) => { setOpenId(id); document.getElementById("main-dashboard-content-area")?.scrollTo({ top: 0 }); };
    return { open, page: openId ? <AsmStoreDetail storeId={openId} onBack={() => open(null)} /> : null };
}
const StoreLink = ({ id, name, onOpen }: { id: string; name: string; onOpen: (id: string) => void }) => (
    <button type="button" onClick={() => onOpen(id)} className="text-left font-semibold text-slate-900 hover:text-orange-600 hover:underline">{displayName(name)}</button>
);
const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", on ? "bg-orange-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-orange-50")}>{children}</button>
);

/* ---------------- Store audits ---------------- */

type AuditRow = Record<string, any> & { id: string; store_id: string; audit_date: string | null; channel: string | null; audited_by_name: string | null; support_needed: string | null; support_details: string | null };
type AuditStore = { store_id: string; store_name: string; city: string | null; live: boolean; last_audit: string | null };

function AuditAnswers({ a }: { a: AuditRow }) {
    const score = scoreAudit(a);
    return (
        <div className="space-y-2">
            <p className="text-sm text-slate-600">
                <span className={cn("rounded-md border px-1.5 py-0.5 text-xs font-bold tabular-nums", BAND_META[score.band].cls)}>{score.earned} / {score.total} marks</span>
                <span className="ml-2 text-xs text-slate-500">
                    {dateText(a.audit_date)} · {a.channel === "whatsapp" ? "on WhatsApp" : a.audited_by_name ? `by ${a.audited_by_name}` : "by phone"}
                    {score.unanswered ? ` · ${score.unanswered} left blank` : ""}
                </span>
            </p>
            <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {AUDIT_QUESTIONS.filter(q => q.key !== "online_presence_other" && q.key !== "support_details").map(q => (
                    <div key={q.key} className="text-sm">
                        <dt className="text-xs text-slate-400">{q.label}</dt>
                        <dd className="text-slate-800">{auditLabel(q.key, a[q.key]) || <span className="text-slate-400">Not answered</span>}</dd>
                    </div>
                ))}
            </dl>
            {a.support_needed === "yes" && a.support_details && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><b>Support asked for:</b> {a.support_details}</p>}
        </div>
    );
}

export function AsmAudits() {
    const { toast } = useToast();
    const [d, setD] = useState<{ audits: AuditRow[]; stores: AuditStore[] } | null>(null);
    const [only, setOnly] = useState<"audited" | "support" | "never">("audited");
    const [openId, setOpenId] = useState<string | null>(null);
    const { open, page } = useStoreOpener();
    useEffect(() => {
        api.get("/asm-portal/audits").then(r => setD(r.data))
            .catch(e => { setD({ audits: [], stores: [] }); toast({ title: "Could not load the audits", description: getErrorMessage(e, "Try again"), variant: "destructive" }); });
    }, [toast]);
    /* Each store's latest audit (the list comes newest first). */
    const latest = useMemo(() => {
        const m = new Map<string, AuditRow>();
        for (const a of d?.audits ?? []) if (!m.has(a.store_id)) m.set(a.store_id, a);
        return [...m.values()];
    }, [d]);
    if (page) return page;
    if (!d) return <Loading />;
    const names = new Map(d.stores.map(s => [s.store_id, s]));
    const scores = latest.map(a => scoreAudit(a).percent);
    const avg = scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null;
    const support = latest.filter(a => a.support_needed === "yes");
    const never = d.stores.filter(s => s.live && !s.last_audit);
    const list = only === "support" ? support : latest;
    const tiles = [
        { label: "Stores audited", value: `${latest.length} of ${d.stores.length}`, sub: latest.length ? `Latest on ${dateText(latest[0].audit_date)}` : "No audit yet" },
        { label: "Average score", value: avg === null ? "—" : `${avg}%`, sub: "each store's latest audit" },
        { label: "Asked for support", value: String(support.length), sub: "in their latest audit" },
        { label: "Live, never audited", value: String(never.length), sub: "stores" },
    ];
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {tiles.map(t => (
                    <div key={t.label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                        <p className="text-2xl font-black tabular-nums text-slate-900">{t.value}</p>
                        <p className="text-sm font-bold text-slate-600">{t.label}</p>
                        <p className="text-xs text-slate-400">{t.sub}</p>
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap gap-2">
                <Chip on={only === "audited"} onClick={() => setOnly("audited")}>Audited ({latest.length})</Chip>
                <Chip on={only === "support"} onClick={() => setOnly("support")}>Asked for support ({support.length})</Chip>
                <Chip on={only === "never"} onClick={() => setOnly("never")}>Never audited ({never.length})</Chip>
            </div>
            {only === "never" ? (
                <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-sm">
                    {never.map(s => <li key={s.store_id} className="px-4 py-2.5 text-sm"><StoreLink id={s.store_id} name={s.store_name} onOpen={open} />{s.city && <span className="ml-2 text-xs text-slate-400">{s.city}</span>}</li>)}
                    {!never.length && <li className="px-4 py-8 text-center text-sm text-slate-500">Every live store has been audited.</li>}
                </ul>
            ) : (
                <ul className="space-y-2">
                    {list.map(a => {
                        const s = scoreAudit(a);
                        const isOpen = openId === a.id;
                        return (
                            <li key={a.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                                    <span className="min-w-0 flex-1">
                                        <StoreLink id={a.store_id} name={names.get(a.store_id)?.store_name ?? ""} onOpen={open} />
                                        <span className="block text-xs text-slate-400">{[names.get(a.store_id)?.city, dateText(a.audit_date)].filter(Boolean).join(" · ")}</span>
                                    </span>
                                    {a.support_needed === "yes" && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">Support asked</span>}
                                    <span className={cn("rounded-md border px-2 py-0.5 text-sm font-bold tabular-nums", BAND_META[s.band].cls)}>{s.percent}%</span>
                                    <button type="button" onClick={() => setOpenId(isOpen ? null : a.id)} aria-expanded={isOpen} className="inline-flex items-center text-xs font-semibold text-orange-600">
                                        {isOpen ? "Hide answers" : "See answers"}<ChevronDown className={cn("ml-0.5 h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
                                    </button>
                                </div>
                                {isOpen && <div className="border-t border-slate-100 px-4 py-3"><AuditAnswers a={a} /></div>}
                            </li>
                        );
                    })}
                    {!list.length && <li className="rounded-2xl border border-slate-100 bg-white px-4 py-8 text-center text-sm text-slate-500">No audits here.</li>}
                </ul>
            )}
        </div>
    );
}

/** On the store page: its latest audit. */
export function AsmStoreAudit({ storeId }: { storeId: string }) {
    const [a, setA] = useState<AuditRow | null | undefined>(undefined);
    useEffect(() => {
        api.get("/asm-portal/audits").then(r => setA((r.data.audits as AuditRow[]).find(x => x.store_id === storeId) ?? null)).catch(() => setA(null));
    }, [storeId]);
    if (a === undefined) return null;
    return (
        <section>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900"><ClipboardCheck className="h-4 w-4 text-orange-500" />Last store audit</h3>
            {a ? <div className="mt-2"><AuditAnswers a={a} /></div> : <p className="mt-1 text-sm text-slate-500">Not audited yet.</p>}
        </section>
    );
}

/* ---------------- Warranty claims ---------------- */

type ClaimRow = {
    id: number; claim_no: string; kind: "warranty" | "alteration"; status: string; status_text: string; problem_text: string; waiting_on?: string | null;
    created_at: string; store_id: string; store_name: string; vehicle?: { make?: string; model?: string } | null;
};
const DONE = new Set(["closed", "rejected", "declined"]);

export function AsmClaims() {
    const { toast } = useToast();
    const [d, setD] = useState<{ live: boolean; claims: ClaimRow[] } | null>(null);
    const [only, setOnly] = useState<"open" | "all">("open");
    const [q, setQ] = useState("");
    const { open, page } = useStoreOpener();
    useEffect(() => {
        api.get("/asm-portal/claims").then(r => setD({ live: r.data.live !== false, claims: r.data.claims ?? [] }))
            .catch(e => { setD({ live: true, claims: [] }); toast({ title: "Could not load the claims", description: getErrorMessage(e, "Try again"), variant: "destructive" }); });
    }, [toast]);
    const list = useMemo(() => (d?.claims ?? []).filter(c => (only === "all" || !DONE.has(c.status))
        && (!q.trim() || `${c.claim_no} ${c.store_name}`.toLowerCase().includes(q.trim().toLowerCase()))), [d, only, q]);
    if (page) return page;
    if (!d) return <Loading />;
    if (!d.live) return <p className="rounded-2xl border border-slate-100 bg-white px-4 py-10 text-center text-sm text-slate-500">Warranty claims are not switched on for stores yet.</p>;
    const openCount = d.claims.filter(c => !DONE.has(c.status)).length;
    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-500">Warranty and alteration claims of your stores. Head office and the plant work on them; this keeps you informed.</p>
            <div className="flex flex-wrap items-center gap-2">
                <Chip on={only === "open"} onClick={() => setOnly("open")}>Open ({openCount})</Chip>
                <Chip on={only === "all"} onClick={() => setOnly("all")}>All ({d.claims.length})</Chip>
                <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search claim no. or store" className="h-9 pl-8" aria-label="Search claim number or store" /></div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Claim</th><th className="px-3 py-2">Store</th><th className="px-3 py-2">Problem</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Raised</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                        {list.map(c => (
                            <tr key={c.id}>
                                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs font-semibold text-slate-900">{c.claim_no}<span className="block font-sans font-normal text-slate-400">{c.kind === "alteration" ? "Alteration" : "Warranty"}</span></td>
                                <td className="px-3 py-2.5"><StoreLink id={c.store_id} name={c.store_name} onOpen={open} /></td>
                                <td className="px-3 py-2.5 text-xs text-slate-700">{c.problem_text}{c.vehicle?.make && <span className="block text-slate-400">{[c.vehicle.make, c.vehicle.model].filter(Boolean).join(" ")}</span>}</td>
                                <td className="px-3 py-2.5 text-xs"><span className="font-semibold text-slate-800">{c.status_text}</span>{c.waiting_on && <span className="block text-slate-400">Waiting on {c.waiting_on}</span>}</td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">{dateText(String(c.created_at).slice(0, 10))}</td>
                            </tr>
                        ))}
                        {!list.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No claims here.</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
