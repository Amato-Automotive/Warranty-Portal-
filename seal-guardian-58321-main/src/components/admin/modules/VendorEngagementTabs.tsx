import { useState, useEffect, useMemo } from "react";
import api from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, MessageSquareWarning, ClipboardCheck, Paperclip, ChevronRight, ShoppingCart, Download } from "lucide-react";
import { cn, formatToIST } from "@/lib/utils";
import { AUDIT_QUESTIONS, auditLabel, type AuditFieldKey } from "@/lib/auditQuestions";

/**
 * One store's POSM requests, grievances and audits.
 *
 * These already exist as their own admin screens, organised by workflow. Here
 * they are organised by store instead, so a conversation about one franchise
 * does not mean opening three tabs and searching each.
 *
 * All three endpoints return everything and are filtered here. That is fine at
 * present volumes (tens of rows) and avoids changing three backends; if these
 * grow, they want per-vendor endpoints instead.
 */

interface Props {
    /** vendor_details.id — what POSM and audits key on. */
    vendorDetailsId: string | null;
    /** profiles.id — what grievances key on (they store the store's user id). */
    userId: string | null;
    kind: "posm" | "grievances" | "audits" | "orders";
}

const POSM_STATUS: Record<string, string> = {
    open: "bg-blue-50 text-blue-700 border-blue-200",
    under_review: "bg-amber-50 text-amber-700 border-amber-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    in_production: "bg-purple-50 text-purple-700 border-purple-200",
    pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
    dispatched: "bg-indigo-50 text-indigo-700 border-indigo-200",
    delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
    closed: "bg-slate-100 text-slate-600 border-slate-200",
    rejected: "bg-red-50 text-red-700 border-red-200",
};

const GRIEVANCE_STATUS: Record<string, string> = {
    submitted: "bg-slate-100 text-slate-600 border-slate-200",
    under_review: "bg-amber-50 text-amber-700 border-amber-200",
    in_progress: "bg-blue-50 text-blue-700 border-blue-200",
    resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-red-50 text-red-700 border-red-200",
};

const REVIEW_STATUS: Record<string, string> = {
    new: "bg-blue-50 text-blue-700 border-blue-200",
    reviewed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    follow_up: "bg-amber-50 text-amber-700 border-amber-200",
};

const label = (s: string) => s.replace(/_/g, " ");

export const VendorEngagementTabs = ({ vendorDetailsId, userId, kind }: Props) => {
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        // Orders already have a per-franchise endpoint, so ask for just this
        // store's rows. The other three return everything and are filtered below.
        const url =
            kind === "posm" ? "/posm/admin/all" :
            kind === "grievances" ? "/grievance/admin" :
            kind === "orders" ? `/admin/franchises/${userId}/orders` :
            "/admin/audits";

        if (kind === "orders" && !userId) {
            setRows([]);
            setLoading(false);
            return;
        }

        api.get(url)
            .then(res => {
                if (cancelled) return;
                const data = res.data.orders || res.data.data || res.data.grievances || res.data.audits || [];
                setRows(Array.isArray(data) ? data : []);
            })
            .catch(() => { if (!cancelled) setRows([]); })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [kind, userId]);

    /**
     * Match on whichever id space this record uses. POSM and audits key on
     * vendor_details.id; grievances store the store's profiles.id in
     * customer_id. Both are checked rather than assumed, since mixing the two
     * is the usual cause of a store's records looking empty.
     */
    const mine = useMemo(() => {
        return rows.filter((r: any) => {
            if (kind === "posm") {
                return vendorDetailsId && r.franchise_id === vendorDetailsId;
            }
            if (kind === "grievances") {
                return r.source_type === "franchise" && userId && r.customer_id === userId;
            }
            // Already scoped to this store by the endpoint.
            if (kind === "orders") return true;
            return vendorDetailsId && r.vendor_details_id === vendorDetailsId;
        });
    }, [rows, kind, vendorDetailsId, userId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
            </div>
        );
    }

    if (mine.length === 0) {
        const EmptyIcon =
            kind === "posm" ? Package :
            kind === "grievances" ? MessageSquareWarning :
            kind === "orders" ? ShoppingCart :
            ClipboardCheck;
        const text =
            kind === "posm" ? "No POSM requests from this store yet." :
            kind === "grievances" ? "No complaints raised by this store." :
            kind === "orders" ? "No orders placed by this store yet." :
            "No audits recorded for this store yet.";
        return (
            <div className="text-center py-16">
                <EmptyIcon className="h-10 w-10 mx-auto text-slate-200 mb-3" />
                <p className="text-sm text-slate-400">{text}</p>
            </div>
        );
    }

    if (kind === "posm") {
        return (
            <div className="space-y-3">
                {mine.map((r: any) => (
                    <div key={r.id} className="p-4 rounded-2xl border border-slate-100 bg-white hover:border-orange-100 transition-colors">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-lg">
                                {r.ticket_id}
                            </span>
                            <Badge variant="outline" className={cn("text-[10px] uppercase font-bold", POSM_STATUS[r.status])}>
                                {r.status === "rejected" ? "Action Required" : label(r.status)}
                            </Badge>
                            {r.created_by_role === "admin" && (
                                <span className="text-[9px] font-black uppercase tracking-wider text-purple-600 bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded">
                                    By admin
                                </span>
                            )}
                            {r.created_by_role === "asm" && (
                                <span className="text-[9px] font-black uppercase tracking-wider text-sky-700 bg-sky-50 border border-sky-100 px-1.5 py-0.5 rounded">
                                    By ASM
                                </span>
                            )}
                            <span className="ml-auto text-[11px] text-slate-400">{formatToIST(r.created_at)}</span>
                        </div>
                        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{r.requirement}</p>
                    </div>
                ))}
            </div>
        );
    }

    if (kind === "grievances") {
        return (
            <div className="space-y-3">
                {mine.map((g: any) => (
                    <div key={g.id} className="p-4 rounded-2xl border border-slate-100 bg-white hover:border-orange-100 transition-colors">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-lg">
                                {g.ticket_id}
                            </span>
                            <Badge variant="outline" className={cn("text-[10px] uppercase font-bold", GRIEVANCE_STATUS[g.status])}>
                                {g.status === "rejected" ? "Action Required" : label(g.status)}
                            </Badge>
                            {g.created_by_role === "admin" && (
                                <span className="text-[9px] font-black uppercase tracking-wider text-purple-600 bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded">
                                    By admin
                                </span>
                            )}
                            {g.created_by_role === "asm" && (
                                <span className="text-[9px] font-black uppercase tracking-wider text-sky-700 bg-sky-50 border border-sky-100 px-1.5 py-0.5 rounded">
                                    By ASM
                                </span>
                            )}
                            <span className="ml-auto text-[11px] text-slate-400">{formatToIST(g.created_at)}</span>
                        </div>
                        <p className="text-sm font-bold text-slate-800">{g.subject}</p>
                        <p className="text-sm text-slate-600 mt-1 leading-relaxed whitespace-pre-wrap">{g.description}</p>
                        <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-slate-400">
                            {g.category && <span>Category: <span className="text-slate-600 font-medium">{label(g.category)}</span></span>}
                            {g.assigned_to && <span>Assigned: <span className="text-slate-600 font-medium">{g.assigned_to}</span></span>}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (kind === "orders") {
        return <OrderHistory orders={mine} />;
    }

    // Audits — a store accumulates one of these every month, so years of them
    // have to stay readable. Rows are collapsed to a single line and grouped by
    // period; the answers open on demand rather than all at once.
    return <AuditHistory audits={mine} />;
};

/** Month heading for grouping, e.g. "August 2026". */
const periodOf = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

/** Short date for a collapsed row. */
const shortDate = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const AuditHistory = ({ audits }: { audits: any[] }) => {
    const [openId, setOpenId] = useState<string | null>(null);

    // Newest first, then grouped by month so a long history reads as periods
    // rather than an undifferentiated run of rows.
    const groups = useMemo(() => {
        const sorted = [...audits].sort(
            (a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
        );
        const out: { period: string; rows: any[] }[] = [];
        for (const a of sorted) {
            const period = periodOf(a.submitted_at);
            const last = out[out.length - 1];
            if (last && last.period === period) last.rows.push(a);
            else out.push({ period, rows: [a] });
        }
        return out;
    }, [audits]);

    /** The one-line summary: what an admin scans for without opening anything. */
    const summaryOf = (a: any) => {
        const bits: string[] = [];
        if (a.signage_status) bits.push(auditLabel("signage_status" as AuditFieldKey, a.signage_status));
        if (a.support_needed === "yes") bits.push("Needs support");
        if (a.warranty_registration === "no") bits.push("No warranty reg");
        if (a.staff_training === "training_required") bits.push("Training required");
        return bits;
    };

    return (
        <div className="space-y-5">
            {/* Newest period first; one line per audit. */}
            {groups.map(g => (
                <div key={g.period}>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                        {g.period}
                        <span className="ml-2 font-bold text-slate-300">
                            {g.rows.length} audit{g.rows.length === 1 ? "" : "s"}
                        </span>
                    </p>

                    <div className="rounded-2xl border border-slate-100 overflow-hidden divide-y divide-slate-50">
                        {g.rows.map((a: any) => {
                            const open = openId === a.id;
                            const flags = summaryOf(a);
                            return (
                                <div key={a.id}>
                                    <button
                                        onClick={() => setOpenId(open ? null : a.id)}
                                        className={cn(
                                            "w-full text-left px-4 py-3 flex items-center gap-3 transition-colors",
                                            open ? "bg-orange-50/40" : "hover:bg-slate-50/60"
                                        )}
                                    >
                                        <ChevronRight
                                            className={cn(
                                                "h-4 w-4 text-slate-300 shrink-0 transition-transform",
                                                open && "rotate-90 text-orange-500"
                                            )}
                                        />
                                        <span className="text-xs font-bold text-slate-600 tabular-nums shrink-0 w-14">
                                            {shortDate(a.submitted_at)}
                                        </span>
                                        <Badge variant="outline" className={cn(
                                            "text-[9px] uppercase font-bold shrink-0",
                                            a.channel === "call"
                                                ? "bg-purple-50 text-purple-700 border-purple-200"
                                                : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                        )}>
                                            {a.channel === "call" ? "Call" : "WhatsApp"}
                                        </Badge>

                                        {/* Only what warrants attention, so a clean audit stays quiet. */}
                                        <span className="flex flex-wrap gap-1.5 min-w-0">
                                            {flags.map(f => (
                                                <span
                                                    key={f}
                                                    className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded truncate"
                                                >
                                                    {f}
                                                </span>
                                            ))}
                                        </span>

                                        <Badge variant="outline" className={cn(
                                            "text-[9px] uppercase font-bold ml-auto shrink-0",
                                            REVIEW_STATUS[a.review_status]
                                        )}>
                                            {label(a.review_status)}
                                        </Badge>
                                    </button>

                                    {open && (
                                        <div className="px-4 pb-4 pt-1 bg-orange-50/20">
                                            {a.audited_by_name && (
                                                <p className="text-[11px] text-slate-500 mb-2">
                                                    Recorded by {a.audited_by_name}
                                                </p>
                                            )}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                                                {AUDIT_QUESTIONS.map(q => {
                                                    const v = a[q.key];
                                                    if (!v) return null;
                                                    return (
                                                        <div
                                                            key={q.key}
                                                            className="flex justify-between gap-3 py-1.5 border-b border-slate-100/70 last:border-0"
                                                        >
                                                            <span className="text-[11px] text-slate-400 shrink-0">{q.label}</span>
                                                            <span className="text-[12px] text-slate-700 font-medium text-right">
                                                                {q.options ? auditLabel(q.key as AuditFieldKey, v) : String(v)}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            {a.review_note && (
                                                <p className="text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-100 flex items-start gap-1.5">
                                                    <Paperclip className="h-3 w-3 mt-0.5 shrink-0" />
                                                    {a.review_note}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};

/**
 * Download an order's invoice.
 *
 * Same endpoint the orders dialog uses, so a PDF pulled from the franchise tab
 * is the identical document — the invoice is generated server-side and this
 * only ever fetches it.
 */
const downloadOrderPdf = async (orderId: string, onError: () => void) => {
    try {
        const res = await api.get(`/orders/${orderId}/pdf`, { responseType: "blob" });
        const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `Order-${orderId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch {
        onError();
    }
};

const ORDER_STATUS: Record<string, string> = {
    pending: "bg-slate-100 text-slate-600 border-slate-200",
    processing: "bg-blue-50 text-blue-700 border-blue-200",
    confirmed: "bg-indigo-50 text-indigo-700 border-indigo-200",
    shipped: "bg-purple-50 text-purple-700 border-purple-200",
    delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    cancelled: "bg-red-50 text-red-700 border-red-200",
    rejected: "bg-red-50 text-red-700 border-red-200",
};

/**
 * This store's orders, newest first and grouped by month.
 *
 * Same shape as the audit history: a store orders repeatedly, so rows collapse
 * to one line and the items open on demand rather than all at once.
 */
const OrderHistory = ({ orders }: { orders: any[] }) => {
    const { toast } = useToast();
    const [openId, setOpenId] = useState<string | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);

    const getPdf = async (orderId: string) => {
        setDownloading(orderId);
        await downloadOrderPdf(orderId, () =>
            toast({
                title: "Download failed",
                description: "Could not download the order PDF.",
                variant: "destructive",
            })
        );
        setDownloading(null);
    };

    const groups = useMemo(() => {
        const sorted = [...orders].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        const out: { period: string; rows: any[] }[] = [];
        for (const o of sorted) {
            const period = periodOf(o.created_at);
            const last = out[out.length - 1];
            if (last && last.period === period) last.rows.push(o);
            else out.push({ period, rows: [o] });
        }
        return out;
    }, [orders]);

    const qtyOf = (o: any) =>
        o.items?.reduce((sum: number, i: any) => sum + Number(i.quantity || 0), 0) || 0;

    return (
        <div className="space-y-5">
            {groups.map(g => (
                <div key={g.period}>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                        {g.period}
                        <span className="ml-2 font-bold text-slate-300">
                            {g.rows.length} order{g.rows.length === 1 ? "" : "s"}
                        </span>
                    </p>

                    <div className="rounded-2xl border border-slate-100 overflow-hidden divide-y divide-slate-50">
                        {g.rows.map((o: any) => {
                            const open = openId === o.id;
                            return (
                                <div key={o.id}>
                                    <div className={cn(
                                        "flex items-center transition-colors",
                                        open ? "bg-orange-50/40" : "hover:bg-slate-50/60"
                                    )}>
                                    <button
                                        onClick={() => setOpenId(open ? null : o.id)}
                                        className="flex-1 min-w-0 text-left pl-4 py-3 flex items-center gap-3"
                                    >
                                        <ChevronRight
                                            className={cn(
                                                "h-4 w-4 text-slate-300 shrink-0 transition-transform",
                                                open && "rotate-90 text-orange-500"
                                            )}
                                        />
                                        <span className="text-xs font-bold text-slate-600 tabular-nums shrink-0 w-14">
                                            {shortDate(o.created_at)}
                                        </span>
                                        <Badge variant="outline" className={cn(
                                            "text-[9px] uppercase font-bold shrink-0",
                                            ORDER_STATUS[o.status] || "bg-slate-100 text-slate-600 border-slate-200"
                                        )}>
                                            {label(o.status)}
                                        </Badge>
                                        {o.distributor_name && (
                                            <span className="text-[11px] text-slate-500 truncate min-w-0">
                                                {o.distributor_name}
                                            </span>
                                        )}
                                        <span className="ml-auto text-[11px] text-slate-400 shrink-0 tabular-nums">
                                            {qtyOf(o)} unit{qtyOf(o) === 1 ? "" : "s"}
                                        </span>
                                    </button>

                                    {/* A sibling of the toggle, not nested inside it:
                                        an interactive element inside a <button> is
                                        invalid and swallows its own clicks. */}
                                    <button
                                        onClick={() => getPdf(o.id)}
                                        disabled={downloading === o.id}
                                        title="Download invoice"
                                        className="shrink-0 mr-4 ml-2 h-8 w-8 rounded-lg border border-slate-200 hover:border-orange-200 hover:bg-orange-50 flex items-center justify-center text-slate-400 hover:text-orange-600 transition-colors disabled:opacity-50"
                                    >
                                        {downloading === o.id
                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            : <Download className="h-3.5 w-3.5" />}
                                    </button>
                                    </div>

                                    {open && (
                                        <div className="px-4 pb-4 pt-1 bg-orange-50/20">
                                            {o.order_group_id && (
                                                <p className="text-[11px] text-slate-400 mb-2 font-mono">
                                                    {o.order_group_id}
                                                </p>
                                            )}
                                            {o.items?.length ? (
                                                <table className="w-full text-xs">
                                                    <thead>
                                                        <tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                            <th className="pb-2 pr-4">Product</th>
                                                            <th className="pb-2 pr-4">Variation</th>
                                                            <th className="pb-2 text-right">Qty</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {o.items.map((i: any) => (
                                                            <tr key={i.id} className="border-t border-slate-100/70">
                                                                <td className="py-2 pr-4 text-slate-700 font-medium">
                                                                    {i.product_name}
                                                                    {i.needs_customization && (
                                                                        <span className="ml-1.5 text-[9px] font-black uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">
                                                                            Custom
                                                                        </span>
                                                                    )}
                                                                    {i.customization_remarks && (
                                                                        <span className="block text-[10px] text-slate-400 mt-0.5">
                                                                            {i.customization_remarks}
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="py-2 pr-4 text-slate-500">{i.variation_name || "—"}</td>
                                                                <td className="py-2 text-right text-slate-700 font-bold tabular-nums">{i.quantity}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            ) : (
                                                <p className="text-xs text-slate-400">No line items recorded.</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};
