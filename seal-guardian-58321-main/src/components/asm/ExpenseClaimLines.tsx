import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";
import { MODE_LABEL, formatDay, rupees, isCut, isDecided, type ExpenseClaim, type ExpenseItem } from "@/lib/asmExpenses";

/**
 * One claim's lines — what the ASM claimed and, once head office has decided,
 * what was approved. Shown to the ASM and to the admin reviewing it.
 */

const ITEM_LABEL: Record<ExpenseItem["kind"], string> = {
    trip: "Trip", onward: "Onward", return: "Return", hotel: "Hotel", other: "Other",
};

const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export const ExpenseClaimLines = ({ claim }: { claim: ExpenseClaim }) => {
    const decided = isDecided(claim.status);
    const cut = (i: ExpenseItem) => decided && i.approved_amount !== null && i.approved_amount !== i.amount;

    return (
        <div className="space-y-3">
            {claim.type === "tour" && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    {claim.travel_mode && <span>Mode: <b className="text-slate-700">{MODE_LABEL[claim.travel_mode] ?? claim.travel_mode}</b></span>}
                    {claim.tickets_by && <span>Tickets: <b className="text-slate-700">{claim.tickets_by === "self" ? "Booked by self" : "Booked by company"}</b></span>}
                    {claim.one_way && <span><b className="text-slate-700">One way</b></span>}
                </div>
            )}
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white">
                {claim.items.map(item => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 w-14 shrink-0">{ITEM_LABEL[item.kind]}</span>
                        <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">
                            {item.from_place && item.to_place ? `${item.from_place} → ${item.to_place}` : item.description}
                        </span>
                        {item.attachment_url && (
                            <a href={item.attachment_url} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs font-bold text-orange-600 hover:underline shrink-0">
                                <FileText className="h-3.5 w-3.5" /> Bill
                            </a>
                        )}
                        <span className="text-right shrink-0 tabular-nums">
                            <span className={cn("block text-sm font-black", cut(item) ? "text-slate-400 line-through text-xs" : "text-slate-800")}>
                                {rupees(item.amount)}
                            </span>
                            {cut(item) && (
                                <span className="block text-sm font-black text-emerald-700">{rupees(item.approved_amount ?? 0)}</span>
                            )}
                        </span>
                    </div>
                ))}
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50/70 rounded-b-2xl">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                        {decided ? "Claimed · Approved" : "Claimed"}
                    </span>
                    <span className="text-sm font-black tabular-nums text-slate-800">
                        {rupees(claim.total_amount)}
                        {decided && (
                            <span className={cn("ml-2", claim.status === "rejected" ? "text-rose-600" : "text-emerald-700")}>
                                · {rupees(claim.approved_amount ?? 0)}
                            </span>
                        )}
                    </span>
                </div>
            </div>
            {claim.remarks && <p className="text-xs text-slate-500"><b className="text-slate-600">Remarks:</b> {claim.remarks}</p>}
            {(claim.review_note || decided) && (
                <div className={cn("text-xs rounded-xl border px-3 py-2",
                    claim.status === "rejected" ? "bg-rose-50 border-rose-100 text-rose-800"
                        : isCut(claim) ? "bg-amber-50 border-amber-100 text-amber-800"
                            : "bg-emerald-50 border-emerald-100 text-emerald-800")}>
                    {claim.review_note && <p><b>{claim.status === "rejected" || isCut(claim) ? "Reason" : "Note"}:</b> {claim.review_note}</p>}
                    {decided && claim.reviewed_at && (
                        <p className="opacity-70 mt-0.5">
                            Decided by {claim.reviewed_by_name || "head office"} · {formatWhen(claim.reviewed_at)}
                        </p>
                    )}
                </div>
            )}
            {claim.status === "paid" && claim.paid_on && (
                <div className="text-xs rounded-xl border px-3 py-2 bg-slate-800 border-slate-800 text-white">
                    <p>
                        <b>Paid {rupees(claim.approved_amount ?? 0)}</b> on {formatDay(claim.paid_on)}
                        {claim.payment_ref && <> · Ref: {claim.payment_ref}</>}
                    </p>
                    {claim.paid_by_name && <p className="opacity-70 mt-0.5">Marked paid by {claim.paid_by_name}</p>}
                </div>
            )}
        </div>
    );
};
