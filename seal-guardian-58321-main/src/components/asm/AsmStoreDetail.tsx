import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { POSMLines } from "@/components/posm/POSMLines";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import type { PosmLine } from "@/lib/posm";
import { cn } from "@/lib/utils";
import {
    type AsmStoreSummary, REASON_DOT, callReasons, daysSinceWarranty, displayName, isLive, monthName, statusNote,
    storeAvatar, storeInitials,
} from "@/lib/asmStores";
import { StorePulse } from "./StorePulse";
import { AsmRaisePosm } from "./AsmRaisePosm";
import { AsmRaiseGrievance } from "./AsmRaiseGrievance";
import { ArrowLeft, ChevronDown, FileText, Loader2, Mail, MessageCircle, Paperclip, Phone, Plus, Send, X } from "lucide-react";

/**
 * One of the ASM's stores. Read top to bottom: who to ring, how the store is
 * doing (warranty numbers only, never the warranties), what is waiting on
 * someone right now, then everything that has been closed.
 *
 * The ASM can raise a POSM request or a grievance for the store, and reply on
 * its tickets — every POSM request, and the grievances the store raised (a
 * customer's complaint is the store's to answer).
 */

interface PosmRequest {
    id: number;
    ticket_id: string;
    requirement: string;
    status: string | null;
    created_by_role: string;
    created_by_name: string | null;
    created_at: string;
    updated_at: string | null;
    /** Item lines on requests from the item flow; null on the older free-text ones. */
    items: PosmLine[] | null;
    messages: { sender_role: string; sender_name: string | null; message: string; attachments: string[]; created_at: string }[];
}

interface Grievance {
    id: number;
    ticket_id: string;
    source_type: "customer" | "franchise";
    category: string | null;
    sub_category: string | null;
    subject: string | null;
    description: string | null;
    attachments: string[];
    status: string;
    priority: string | null;
    warranty_uid: string | null;
    department: string | null;
    department_details: string | null;
    franchise_remarks: string | null;
    admin_remarks: string | null;
    assigned_to: string | null;
    customer_rating: number | null;
    customer_feedback: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    created_by_role: string;
    created_by_name: string | null;
    created_at: string;
    resolved_at: string | null;
    remarks: { added_by: string; added_by_name: string | null; remark: string; created_at: string }[];
}

const GRIEVANCE_DONE = ["resolved", "rejected"];
const POSM_DONE = ["delivered", "closed", "rejected"];

const sentence = (v: string) => {
    const s = v.replace(/_/g, " ").trim();
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

// Status as a word in a colour, not a badge: green done, rose refused, amber everything in between.
const statusTone = (status: string, done: string[]) =>
    status === "rejected" ? "text-rose-600" : done.includes(status) ? "text-emerald-600" : "text-amber-600";

const formatDay = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
const formatWhen = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
/** Who raised a ticket on the store's behalf, as a trailing phrase; empty when the store did. */
const raisedBy = (role: string, name: string | null) =>
    role === "admin" ? " by head office" : role === "asm" ? ` by ${name || "the ASM"} (ASM)` : "";

const ageOf = (iso: string) => {
    const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
    return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="min-w-0">
        <dt className="text-xs text-slate-400">{label}</dt>
        <dd className="text-sm text-slate-800 mt-0.5 break-words">{children}</dd>
    </div>
);

const Attachments = ({ urls }: { urls: string[] }) =>
    urls.length ? (
        <div className="flex flex-wrap gap-2">
            {urls.map((u, i) => {
                const isImage = /\.(jpe?g|png|webp|gif|heic)$/i.test(u);
                return (
                    <a key={u} href={u} target="_blank" rel="noopener noreferrer"
                        className="block rounded-lg border border-slate-200 overflow-hidden bg-slate-50 hover:border-orange-300">
                        {isImage
                            ? <img src={u} alt={`Attachment ${i + 1}`} className="h-20 w-20 object-cover" loading="lazy" />
                            : <span className="h-20 w-20 flex flex-col items-center justify-center gap-1 text-xs text-slate-500">
                                <FileText className="h-5 w-5" />{u.split(".").pop()?.toLowerCase()}
                            </span>}
                    </a>
                );
            })}
        </div>
    ) : null;

type Message = { who: string; fromStore: boolean; text: string; when: string; attachments?: string[]; asm?: boolean };

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Head office on the left, the store (and its ASM) on the right. A message sent twice in a row by the same person shows once. */
const Thread = ({ items }: { items: Message[] }) => {
    const shown = items.filter((m, i) => {
        const prev = items[i - 1];
        return !prev || prev.who !== m.who || !sameText(prev.text, m.text) || (m.attachments?.length ?? 0) > 0;
    });
    return shown.length ? (
        <div className="space-y-2">
            {shown.map((m, i) => (
                <div key={i} className={cn("flex", m.fromStore ? "justify-end" : "justify-start")}>
                    <div className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                        m.asm ? "bg-sky-50 rounded-br-sm" : m.fromStore ? "bg-orange-50 rounded-br-sm" : "bg-slate-100 rounded-bl-sm"
                    )}>
                        <p className="text-xs text-slate-500"><span className="font-semibold text-slate-700">{m.who}</span>, {formatWhen(m.when)}</p>
                        <p className="text-slate-800 whitespace-pre-wrap break-words mt-0.5">{m.text}</p>
                        {m.attachments && m.attachments.length > 0 && <div className="mt-2"><Attachments urls={m.attachments} /></div>}
                    </div>
                </div>
            ))}
        </div>
    ) : null;
};

/**
 * The ASM's reply on a ticket. POSM replies can carry photos; grievance
 * remarks are text, as everyone else's are.
 */
const ReplyBox = ({ withFiles, onSend }: { withFiles?: boolean; onSend: (text: string, files: File[]) => Promise<boolean> }) => {
    const [text, setText] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [sending, setSending] = useState(false);
    const send = async () => {
        if (!text.trim() && !files.length) return;
        setSending(true);
        if (await onSend(text.trim(), files)) { setText(""); setFiles([]); }
        setSending(false);
    };
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-2">
            <Textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={2000}
                placeholder="Write a reply…" aria-label="Reply"
                className="border-0 shadow-none focus-visible:ring-0 resize-none text-sm" />
            {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-2 pb-2">
                    {files.map((f, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 pl-2 pr-1 py-0.5 text-xs text-slate-600 max-w-[200px]">
                            <span className="truncate">{f.name}</span>
                            <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}
                                className="h-5 w-5 rounded flex items-center justify-center hover:bg-slate-200"><X className="h-3 w-3" /></button>
                        </span>
                    ))}
                </div>
            )}
            <div className="flex items-center justify-between gap-2 px-1">
                {withFiles ? (
                    <label className="inline-flex items-center gap-1.5 h-8 px-2 rounded-lg text-xs font-medium text-slate-500 hover:text-orange-700 hover:bg-orange-50 cursor-pointer">
                        <Paperclip className="h-3.5 w-3.5" /> Photo
                        <input type="file" accept="image/*,application/pdf" multiple className="hidden"
                            onChange={e => { const add = Array.from(e.target.files ?? []); setFiles(f => [...f, ...add].slice(0, 5)); e.target.value = ""; }} />
                    </label>
                ) : <span />}
                <Button size="sm" onClick={send} disabled={sending || (!text.trim() && !files.length)} className="h-8 rounded-lg bg-orange-500 hover:bg-orange-600">
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                    {!sending && "Send"}
                </Button>
            </div>
        </div>
    );
};

/** One grievance or POSM request: a line you can open to read all of it. */
const Row = ({ kind, title, status, statusClass, sub, children }: {
    kind: "Grievance" | "POSM"; title: string; status: string; statusClass: string; sub: string; children: React.ReactNode;
}) => {
    const [open, setOpen] = useState(false);
    return (
        <li>
            <button onClick={() => setOpen(o => !o)} aria-expanded={open}
                className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-orange-50">
                <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-400">{!sub.toUpperCase().startsWith(kind.slice(0, 3).toUpperCase()) && `${kind} `}<span className="font-mono">{sub}</span></p>
                    <p className="text-[15px] font-semibold text-slate-900 mt-0.5 line-clamp-2">{title}</p>
                    <p className={cn("text-sm mt-0.5", statusClass)}>{status}</p>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-slate-400 mt-1.5 shrink-0 transition-transform duration-200", open && "rotate-180")} />
            </button>
            {open && <div className="px-4 pb-5 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">{children}</div>}
        </li>
    );
};

const GrievanceRow = ({ g, onReply }: { g: Grievance; onReply: (g: Grievance, text: string) => Promise<boolean> }) => (
    <Row
        kind="Grievance"
        sub={g.ticket_id}
        title={g.subject || sentence(g.category || "Grievance")}
        status={`${sentence(g.status)}, raised ${GRIEVANCE_DONE.includes(g.status) ? formatDay(g.created_at) : ageOf(g.created_at)}${g.source_type === "franchise" ? (raisedBy(g.created_by_role, g.created_by_name) || " by the store") : " by a customer"}`}
        statusClass={statusTone(g.status, GRIEVANCE_DONE)}
    >
        {g.description && <p className="text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed">{g.description}</p>}
        <Attachments urls={g.attachments} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Category">{[g.category, g.sub_category].filter(Boolean).map(v => sentence(v!)).join(", ") || "Not set"}</Field>
            {g.source_type === "customer"
                ? <Field label="Customer">{g.customer_name || "Not given"}{g.customer_phone && <span className="block font-mono text-slate-500">{g.customer_phone}</span>}</Field>
                : <Field label="Department">{[g.department, g.department_details].filter(Boolean).join(", ") || "Not set"}</Field>}
            {g.priority && g.priority !== "normal" && <Field label="Priority">{sentence(g.priority)}</Field>}
            {g.warranty_uid && <Field label="Warranty UID"><span className="font-mono">{g.warranty_uid}</span></Field>}
            {g.assigned_to && <Field label="Assigned to">{g.assigned_to}</Field>}
            {g.resolved_at && <Field label="Resolved">{formatDay(g.resolved_at)}</Field>}
        </dl>
        {g.franchise_remarks && <Field label="Store's remarks">{g.franchise_remarks}</Field>}
        {g.admin_remarks && <Field label="Head office remarks">{g.admin_remarks}</Field>}
        <Thread items={g.remarks.map(r => ({
            who: r.added_by === "asm" ? `${r.added_by_name || "ASM"} (ASM)` : r.added_by_name || sentence(r.added_by),
            fromStore: r.added_by === "franchise" || r.added_by === "asm", asm: r.added_by === "asm",
            text: r.remark, when: r.created_at,
        }))} />
        {g.source_type === "franchise" && !GRIEVANCE_DONE.includes(g.status) && <ReplyBox onSend={text => onReply(g, text)} />}
        {(g.customer_rating || g.customer_feedback) && (
            <Field label="Customer's rating">
                {g.customer_rating ? `${g.customer_rating} out of 5` : ""}{g.customer_rating && g.customer_feedback ? ": " : ""}{g.customer_feedback}
            </Field>
        )}
    </Row>
);

const PosmRow = ({ r, onReply }: { r: PosmRequest; onReply: (r: PosmRequest, text: string, files: File[]) => Promise<boolean> }) => {
    const status = r.status || "open";
    return (
        <Row
            kind="POSM"
            sub={r.ticket_id}
            title={r.requirement}
            status={`${sentence(status)}, asked ${POSM_DONE.includes(status) ? formatDay(r.created_at) : ageOf(r.created_at)}${raisedBy(r.created_by_role, r.created_by_name)}`}
            statusClass={statusTone(status, POSM_DONE)}
        >
            {r.items?.length
                ? <POSMLines lines={r.items} />
                : <p className="text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed">{r.requirement}</p>}
            <Thread items={r.messages.map(m => ({
                who: m.sender_role === "admin" ? "Head office" : m.sender_role === "asm" ? `${m.sender_name || "ASM"} (ASM)` : "Store",
                fromStore: m.sender_role !== "admin", asm: m.sender_role === "asm",
                text: m.message, when: m.created_at, attachments: m.attachments,
            }))} />
            {!POSM_DONE.includes(status) && <ReplyBox withFiles onSend={(text, files) => onReply(r, text, files)} />}
            <p className="text-xs text-slate-400">Last updated {formatWhen(r.updated_at || r.created_at)}</p>
        </Row>
    );
};

const List = ({ children }: { children: React.ReactNode }) => (
    <ul className="rounded-2xl border border-slate-200/80 bg-white divide-y divide-slate-100 overflow-hidden">{children}</ul>
);

export const AsmStoreDetail = ({ storeId, onBack }: { storeId: string; onBack: () => void }) => {
    const { toast } = useToast();
    const [store, setStore] = useState<AsmStoreSummary | null>(null);
    const [posm, setPosm] = useState<PosmRequest[]>([]);
    const [grievances, setGrievances] = useState<Grievance[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [history, setHistory] = useState<"grievances" | "posm">("grievances");
    const [raising, setRaising] = useState<"posm" | "grievance" | null>(null);

    // After a raise or a reply the page reloads quietly, keeping what is open.
    const load = useCallback((quiet = false) => {
        if (!quiet) setLoading(true);
        return api.get(`/asm-portal/stores/${storeId}`)
            .then(res => {
                setStore(res.data.store);
                setGrievances(res.data.grievances || []);
                setPosm(res.data.posm || []);
            })
            .catch(e => { if (!quiet) setError(getErrorMessage(e, "Could not load this store")); })
            .finally(() => setLoading(false));
    }, [storeId]);

    useEffect(() => { load(); }, [load]);

    const replyPosm = async (r: PosmRequest, text: string, files: File[]) => {
        try {
            const fd = new FormData();
            if (text) fd.append("message", text);
            files.forEach(f => fd.append("attachments", f));
            await api.post(`/asm-portal/posm/${r.id}/messages`, fd, { headers: { "Content-Type": "multipart/form-data" } });
            await load(true);
            return true;
        } catch (e) {
            toast({ title: "Could not send", description: getErrorMessage(e, "Please try again."), variant: "destructive" });
            return false;
        }
    };

    const replyGrievance = async (g: Grievance, text: string) => {
        try {
            await api.post(`/asm-portal/grievances/${g.id}/remarks`, { remarks: text });
            await load(true);
            return true;
        } catch (e) {
            toast({ title: "Could not send", description: getErrorMessage(e, "Please try again."), variant: "destructive" });
            return false;
        }
    };

    const back = (
        <button onClick={onBack} className="inline-flex items-center gap-1.5 h-9 pr-3 rounded-lg text-sm font-medium text-slate-500 hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <ArrowLeft className="h-4 w-4" /> All stores
        </button>
    );

    if (loading) {
        return (
            <div className="space-y-4">
                {back}
                <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                    <span className="text-sm">Loading store…</span>
                </div>
            </div>
        );
    }

    if (error || !store) {
        return (
            <div className="space-y-4">
                {back}
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-6 text-center text-sm text-rose-700">{error || "Store not found"}</div>
            </div>
        );
    }

    const phone = (store.phone_number || "").replace(/\D/g, "").slice(-10);
    const mail = store.email || store.store_email;
    const note = statusNote(store);
    const since = daysSinceWarranty(store);
    const reasons = callReasons(store);
    const decided = store.warranties_approved + store.warranties_pending + store.warranties_rejected;

    const openG = grievances.filter(g => !GRIEVANCE_DONE.includes(g.status));
    const openP = posm.filter(r => !POSM_DONE.includes(r.status || "open"));
    const closedG = grievances.filter(g => GRIEVANCE_DONE.includes(g.status));
    const closedP = posm.filter(r => POSM_DONE.includes(r.status || "open"));
    // Open work, oldest first: that is the order it should be chased in.
    const waiting = [
        ...openG.map(g => ({ at: g.created_at, el: <GrievanceRow key={`g${g.id}`} g={g} onReply={replyGrievance} /> })),
        ...openP.map(r => ({ at: r.created_at, el: <PosmRow key={`p${r.id}`} r={r} onReply={replyPosm} /> })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    return (
        <div className="max-w-6xl animate-in fade-in duration-300">
            {back}
            <div className="mt-4 grid gap-10 xl:grid-cols-2 xl:gap-14 xl:items-start">
                <div className="space-y-9">
                    <div>
                        {/* Who */}
                        <div className="flex items-start gap-4">
                            <span className={cn(
                                "h-14 w-14 shrink-0 rounded-2xl text-white text-lg font-bold flex items-center justify-center",
                                isLive(store) ? storeAvatar(store.vendor_details_id) : "bg-slate-300"
                            )}>
                                {storeInitials(store.store_name)}
                            </span>
                            <div className="min-w-0">
                                <h2 className="text-2xl font-bold text-slate-900 leading-tight tracking-tight">{displayName(store.store_name)}</h2>
                                <p className="text-sm text-slate-500 mt-1">
                                    {[store.city, store.state].filter(Boolean).join(", ") || "No city on file"}
                                    {store.store_code && <> <span className="text-slate-300">/</span> <span className="font-mono">{store.store_code}</span></>}
                                </p>
                                {(store.is_distributor || note) && (
                                    <p className="text-sm mt-1">
                                        {store.is_distributor && <span className="text-violet-700 font-medium">Distributor</span>}
                                        {store.is_distributor && note && <span className="text-slate-300"> / </span>}
                                        {note && <span className="text-slate-500 font-medium">{note}</span>}
                                    </p>
                                )}
                            </div>
                        </div>

                        {reasons.length > 0 && (
                            <ul className="mt-5 space-y-1">
                                {reasons.map(r => (
                                    <li key={r.kind} className="text-sm text-slate-700 flex items-center gap-2">
                                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", REASON_DOT[r.kind])} />{r.text}
                                    </li>
                                ))}
                            </ul>
                        )}

                        {/* Owner */}
                        <div className="mt-5 rounded-2xl bg-slate-50 p-4 2xl:flex 2xl:items-center 2xl:gap-4">
                            <div className="min-w-0 flex-1">
                                <p className="text-xs text-slate-400">Owner</p>
                                <p className="text-base font-semibold text-slate-900 truncate">{store.contact_name || "Not on file"}</p>
                                <p className="text-sm text-slate-500 truncate">
                                    <span className="font-mono">{store.phone_number || "No number"}</span>
                                    {mail && <a href={`mailto:${mail}`} className="block truncate hover:text-orange-700"><Mail className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />{mail}</a>}
                                </p>
                            </div>
                            {phone && (
                                <div className="mt-3 2xl:mt-0 grid grid-cols-2 gap-2 shrink-0">
                                    <a href={`tel:+91${phone}`} className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-orange-600 text-sm font-semibold text-white hover:bg-orange-700 active:scale-[0.98] transition">
                                        <Phone className="h-4 w-4" /> Call
                                    </a>
                                    <a href={`https://wa.me/91${phone}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-800 hover:border-emerald-400 hover:text-emerald-700 active:scale-[0.98] transition">
                                        <MessageCircle className="h-4 w-4" /> WhatsApp
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* How it is doing */}
                    <section>
                        <h3 className="text-base font-semibold text-slate-900">Warranties</h3>
                        <p className="mt-1 text-sm text-slate-500 leading-relaxed">
                            <span className="text-slate-900 font-semibold tabular-nums">{store.warranties_this_month.toLocaleString("en-IN")}</span> so far in {monthName(0)},{" "}
                            <span className="text-slate-900 font-semibold tabular-nums">{store.warranties_last_month.toLocaleString("en-IN")}</span> in {monthName(-1)},{" "}
                            <span className="text-slate-900 font-semibold tabular-nums">{store.warranties_total.toLocaleString("en-IN")}</span> in all.{" "}
                            {since === null ? "None registered yet." : since === 0 ? "Last one today." : `Last one ${since === 1 ? "yesterday" : `${since} days ago`}.`}
                        </p>

                        <div className="mt-4">
                            <StorePulse weekly={store.weekly} size="lg" floor={4} muted={!isLive(store)} />
                            <div className="mt-1.5 flex justify-between text-xs text-slate-400">
                                <span>12 weeks ago</span><span>Past 7 days</span>
                            </div>
                        </div>

                        {decided > 0 && (
                            <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-slate-100 pt-4">
                                {[
                                    { label: "Approved", value: store.warranties_approved, tone: "text-emerald-700" },
                                    { label: "Awaiting approval", value: store.warranties_pending, tone: "text-amber-700" },
                                    { label: "Rejected", value: store.warranties_rejected, tone: "text-rose-700" },
                                ].map(s => (
                                    <div key={s.label}>
                                        <dt className="text-xs text-slate-400">{s.label}</dt>
                                        <dd className={cn("text-xl font-semibold tabular-nums mt-0.5", s.tone)}>{s.value.toLocaleString("en-IN")}</dd>
                                    </div>
                                ))}
                            </dl>
                        )}
                    </section>

                </div>

                <div className="space-y-9">
                    {/* What is waiting */}
                    <section>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-base font-semibold text-slate-900 flex items-baseline gap-2">
                                Open now {waiting.length > 0 && <span className="text-sm font-normal text-slate-400 tabular-nums">{waiting.length}</span>}
                            </h3>
                            {/* Raising for a store is for live stores only. */}
                            {isLive(store) && (
                                <div className="flex gap-2">
                                    <Button size="sm" variant="outline" onClick={() => setRaising("posm")} className="h-9 rounded-xl border-orange-200 text-orange-700 hover:bg-orange-50">
                                        <Plus className="h-4 w-4 mr-1" /> Raise POSM
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setRaising("grievance")} className="h-9 rounded-xl border-orange-200 text-orange-700 hover:bg-orange-50">
                                        <Plus className="h-4 w-4 mr-1" /> Raise grievance
                                    </Button>
                                </div>
                            )}
                        </div>
                        {waiting.length === 0
                            ? <p className="mt-2 text-sm text-slate-500">No open grievances or POSM requests.</p>
                            : <div className="mt-3"><List>{waiting.map(w => w.el)}</List></div>}
                    </section>

                    {/* Everything closed */}
                    {(closedG.length > 0 || closedP.length > 0) && (
                        <section>
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="text-base font-semibold text-slate-900">Closed</h3>
                                <div role="tablist" className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
                                    {([["grievances", "Grievances", closedG.length], ["posm", "POSM", closedP.length]] as const).map(([id, label, n]) => (
                                        <button key={id} role="tab" aria-selected={history === id} onClick={() => setHistory(id)}
                                            className={cn("h-8 px-3 rounded-md font-medium transition-colors", history === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
                                            {label} <span className="tabular-nums text-slate-400">{n}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="mt-3">
                                {history === "grievances"
                                    ? closedG.length ? <List>{closedG.map(g => <GrievanceRow key={g.id} g={g} onReply={replyGrievance} />)}</List> : <p className="text-sm text-slate-500">No closed grievances.</p>
                                    : closedP.length ? <List>{closedP.map(r => <PosmRow key={r.id} r={r} onReply={replyPosm} />)}</List> : <p className="text-sm text-slate-500">No closed POSM requests.</p>}
                            </div>
                        </section>
                    )}
                </div>
            </div>

            <AsmRaisePosm storeId={store.vendor_details_id} storeName={displayName(store.store_name)}
                open={raising === "posm"} onOpenChange={o => setRaising(o ? "posm" : null)} onRaised={() => load(true)} />
            <AsmRaiseGrievance storeId={store.vendor_details_id} storeName={displayName(store.store_name)}
                open={raising === "grievance"} onOpenChange={o => setRaising(o ? "grievance" : null)} onRaised={() => load(true)} />
        </div>
    );
};
