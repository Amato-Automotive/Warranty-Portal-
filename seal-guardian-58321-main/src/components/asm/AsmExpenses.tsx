import { useEffect, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AsmExpenseForm } from "./AsmExpenseForm";
import { EXPENSE_STATUS, claimDates, rupees, type ExpenseClaim } from "@/lib/asmExpenses";
import { ExpenseClaimLines } from "./ExpenseClaimLines";
import { ChevronDown, Loader2, MapPin, Plane, Plus, Receipt } from "lucide-react";

/** The ASM's expense claims, and the form for a new one. */


export const AsmExpenses = () => {
    const [view, setView] = useState<"list" | "new">("list");
    const [claims, setClaims] = useState<ExpenseClaim[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [open, setOpen] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError("");
        try {
            const res = await api.get("/asm-portal/expenses");
            setClaims(res.data.claims || []);
        } catch (e) {
            setError(getErrorMessage(e, "Could not load your claims"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    if (view === "new") {
        return <AsmExpenseForm onCancel={() => setView("list")} onSubmitted={() => { setView("list"); load(); }} />;
    }

    const pending = claims.filter(c => c.status === "submitted");

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="grid grid-cols-2 gap-3 sm:gap-4 flex-1 min-w-[260px] max-w-md">
                    <div className="rounded-[24px] border border-blue-50 bg-gradient-to-br from-blue-50 to-white p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Awaiting review</p>
                        <p className="text-2xl font-black text-slate-900 tabular-nums">{pending.length}</p>
                    </div>
                    <div className="rounded-[24px] border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Amount pending</p>
                        <p className="text-2xl font-black text-slate-900 tabular-nums">{rupees(pending.reduce((t, c) => t + c.total_amount, 0))}</p>
                    </div>
                </div>
                <Button onClick={() => setView("new")}
                    className="h-12 px-6 rounded-xl bg-orange-500 hover:bg-orange-600 font-black uppercase tracking-wide shadow-lg shadow-orange-200 transition-all hover:-translate-y-0.5 active:scale-95">
                    <Plus className="h-4 w-4 mr-1.5" /> New claim
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>
            ) : error ? (
                <div className="rounded-[28px] border border-rose-100 bg-rose-50 p-6 text-center text-sm text-rose-700">
                    {error} <button onClick={load} className="font-bold underline ml-1">Try again</button>
                </div>
            ) : claims.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-orange-200 bg-white/60 p-12 text-center animate-in fade-in zoom-in-95 duration-700">
                    <div className="h-16 w-16 bg-orange-50 rounded-3xl flex items-center justify-center mx-auto mb-5 border border-orange-100">
                        <Receipt className="h-7 w-7 text-orange-500" />
                    </div>
                    <h3 className="text-lg font-black tracking-tight text-slate-800 uppercase mb-2">No claims yet</h3>
                    <p className="text-sm text-slate-500 max-w-sm mx-auto">
                        Tap New claim to file local conveyance or an outstation tour. Claims must be filed within 7 days of travel.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {claims.map((c, index) => {
                        const st = EXPENSE_STATUS[c.status] ?? { label: c.status, tone: "bg-slate-100 text-slate-600 border-slate-200" };
                        const isOpen = open === c.id;
                        return (
                            <div
                                key={c.id}
                                style={{ animationDelay: `${Math.min(index, 10) * 60}ms` }}
                                className={cn(
                                    "rounded-[24px] border bg-white overflow-hidden transition-all animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both",
                                    isOpen ? "border-orange-200 shadow-xl shadow-orange-100/50" : "border-orange-100 hover:shadow-lg hover:-translate-y-0.5"
                                )}
                            >
                                <button onClick={() => setOpen(isOpen ? null : c.id)} className="w-full text-left p-4 md:p-5 flex items-center gap-4">
                                    <div className={cn("h-11 w-11 shrink-0 rounded-2xl flex items-center justify-center text-white shadow-md",
                                        c.type === "tour" ? "bg-purple-500" : "bg-orange-500")}>
                                        {c.type === "tour" ? <Plane className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-black text-slate-800">{c.claim_number}</span>
                                            <span className={cn("text-[10px] font-black uppercase px-2 py-0.5 rounded-full border", st.tone)}>{st.label}</span>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                                            {c.type === "tour" ? `Tour · ${c.from_place} → ${c.to_place}` : `Local · ${c.items.length} trip${c.items.length === 1 ? "" : "s"}`}
                                            {" · "}{claimDates(c)}
                                        </p>
                                    </div>
                                    <span className="text-right shrink-0 tabular-nums">
                                        <span className={cn("block font-black", c.status === "partially_approved" ? "text-xs text-slate-400 line-through" : "text-base md:text-lg text-slate-900")}>
                                            {rupees(c.total_amount)}
                                        </span>
                                        {c.status === "partially_approved" && (
                                            <span className="block text-base md:text-lg font-black text-emerald-700">{rupees(c.approved_amount ?? 0)}</span>
                                        )}
                                    </span>
                                    <ChevronDown className={cn("h-4 w-4 text-slate-400 shrink-0 transition-transform", isOpen && "rotate-180")} />
                                </button>
                                {isOpen && (
                                    <div className="px-4 md:px-5 pb-5 border-t border-orange-50 pt-4 bg-slate-50/50 animate-in fade-in slide-in-from-top-2 duration-300">
                                        <ExpenseClaimLines claim={c} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
