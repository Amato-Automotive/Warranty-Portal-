import { useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ExpenseClaimLines } from "@/components/asm/ExpenseClaimLines";
import { EXPENSE_STATUS, claimDates, rupees, type ExpenseClaim } from "@/lib/asmExpenses";
import {
    Banknote, CheckCircle2, CircleDashed, Pencil, FileText, Loader2, MapPin, Plane, RefreshCw, Scissors, XCircle
} from "lucide-react";

/**
 * ASM Expenses — the ASMs' expense claims, for HR to decide and pay. Its own
 * module and permission (`asm_expenses`), apart from ASM Management.
 *
 * Each claim is decided: approve in full, approve part of it (an approved
 * amount per line, with a reason), or reject (with a reason). The decision can
 * be changed until the claim is marked paid, which only an approved or partly
 * approved claim can be. The ASM sees each step on their portal, and on
 * WhatsApp once that template is switched on.
 */

type Filter = "submitted" | "approved" | "partially_approved" | "rejected" | "paid" | "all";
type Mode = "approve" | "partial" | "reject" | null;

const FILTERS: { id: Filter; label: string; icon: typeof CheckCircle2; color: string }[] = [
    { id: "submitted", label: "Awaiting decision", icon: CircleDashed, color: "text-blue-600" },
    { id: "approved", label: "Approved", icon: CheckCircle2, color: "text-emerald-600" },
    { id: "partially_approved", label: "Partly approved", icon: Scissors, color: "text-amber-600" },
    { id: "rejected", label: "Rejected", icon: XCircle, color: "text-rose-600" },
    { id: "paid", label: "Paid", icon: Banknote, color: "text-slate-800" },
];

/** Today in IST, for the paid-on date. */
const istToday = () => new Date().toLocaleString("en-CA", { timeZone: "Asia/Kolkata", hour12: false }).split(",")[0];

const ITEM_LABEL: Record<string, string> = { trip: "Trip", onward: "Onward", return: "Return", hotel: "Hotel", other: "Other" };

export const AdminAsmExpenses = () => {
    const { toast } = useToast();
    const { hasPermission, user } = useAuth();
    const canEdit = !!user?.isSuperAdmin || hasPermission("asm_expenses", "write");
    const [asms, setAsms] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
    const [filter, setFilter] = useState<Filter>("submitted");
    const [asmId, setAsmId] = useState<string>("all");
    const [claims, setClaims] = useState<ExpenseClaim[]>([]);
    const [counts, setCounts] = useState<Record<string, { n: number; claimed: number }>>({});
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [selected, setSelected] = useState<ExpenseClaim | null>(null);
    const [mode, setMode] = useState<Mode>(null);
    const [note, setNote] = useState("");
    const [amounts, setAmounts] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [changing, setChanging] = useState(false);
    const [paying, setPaying] = useState(false);
    const [paidOn, setPaidOn] = useState(istToday());
    const [paymentRef, setPaymentRef] = useState("");

    const load = async (silent = false) => {
        if (silent) setRefreshing(true);
        else setLoading(true);
        try {
            const res = await api.get("/asm/expenses", {
                params: { status: filter, ...(asmId !== "all" ? { asm_id: asmId } : {}) },
            });
            setClaims(res.data.claims || []);
            setCounts(res.data.counts || {});
            setAsms(res.data.asms || []);
        } catch (error) {
            toast({ title: "Could not load claims", description: getErrorMessage(error, "Please try again"), variant: "destructive" });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filter, asmId]);

    const open = (claim: ExpenseClaim) => {
        setSelected(claim);
        resetActions(claim);
    };

    const resetActions = (claim: ExpenseClaim) => {
        setMode(null);
        setNote("");
        setChanging(false);
        setPaying(false);
        setPaidOn(istToday());
        setPaymentRef("");
        // Changing a partial decision starts from what was approved, not what was claimed.
        setAmounts(Object.fromEntries(claim.items.map(i => [i.id, String(claim.status === "rejected" ? i.amount : i.approved_amount ?? i.amount)])));
    };

    const markPaid = async () => {
        if (!selected) return;
        setSaving(true);
        try {
            const res = await api.put(`/asm/expenses/${selected.id}/paid`, { paid_on: paidOn, reference: paymentRef });
            toast({ title: res.data?.message || "Marked paid" });
            setSelected(res.data.claim);
            resetActions(res.data.claim);
            load(true);
        } catch (error) {
            toast({ title: "Could not mark paid", description: getErrorMessage(error, "Please try again"), variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const partialTotal = useMemo(
        () => Object.values(amounts).reduce((t, v) => t + (/^\d+(\.\d{1,2})?$/.test(v.trim()) ? Number(v) : 0), 0),
        [amounts]
    );

    const decide = async () => {
        if (!selected || !mode) return;
        if (mode !== "approve" && !note.trim()) {
            toast({ title: "Give a reason", description: "The ASM sees it with the decision.", variant: "destructive" });
            return;
        }
        setSaving(true);
        try {
            const res = await api.put(`/asm/expenses/${selected.id}/decision`, {
                action: mode,
                note,
                ...(mode === "partial" ? { amounts } : {}),
            });
            toast({ title: res.data?.message || "Decision saved" });
            setSelected(res.data.claim);
            resetActions(res.data.claim);
            load(true);
        } catch (error) {
            toast({ title: "Could not save", description: getErrorMessage(error, "Please try again"), variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const total = (Object.values(counts) as { n: number }[]).reduce((t, c) => t + c.n, 0);

    return (
        <div className="space-y-5">
            {/* Filter cards double as the counts */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {FILTERS.map((f, i) => {
                    const c = counts[f.id] ?? { n: 0, claimed: 0 };
                    const active = filter === f.id;
                    return (
                        <button
                            key={f.id}
                            onClick={() => setFilter(active ? "all" : f.id)}
                            style={{ animationDelay: `${i * 60}ms` }}
                            className="text-left animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both"
                        >
                            <Card className={cn("border-orange-100 transition-all hover:shadow-md hover:-translate-y-0.5",
                                active && "border-orange-300 ring-2 ring-orange-100 shadow-md")}>
                                <CardContent className="p-4 flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center">
                                        <f.icon className={`h-5 w-5 ${f.color}`} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 truncate">{f.label}</p>
                                        <p className={`text-xl font-black tabular-nums ${f.color}`}>{c.n}</p>
                                        <p className="text-[11px] text-slate-400 tabular-nums">{rupees(c.claimed)} claimed</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </button>
                    );
                })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Select value={asmId} onValueChange={setAsmId}>
                    <SelectTrigger className="w-56 h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All ASMs</SelectItem>
                        {asms.map(a => <SelectItem key={a.id} value={a.id}>{a.name}{a.is_active ? "" : " (inactive)"}</SelectItem>)}
                    </SelectContent>
                </Select>
                {filter !== "all" && (
                    <Button variant="ghost" size="sm" onClick={() => setFilter("all")} className="text-xs text-slate-500">
                        Show all {total}
                    </Button>
                )}
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => load(true)} disabled={refreshing}>
                    <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>
            ) : claims.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-orange-200 bg-white/40 p-12 text-center animate-in fade-in zoom-in-95 duration-500">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-3" />
                    <p className="font-black text-slate-800 uppercase tracking-tight">
                        {filter === "submitted" ? "Nothing waiting" : "No claims here"}
                    </p>
                    <p className="text-sm text-slate-500 mt-1">
                        {filter === "submitted" ? "Every submitted claim has been decided." : "Try another filter or ASM."}
                    </p>
                </div>
            ) : (
                <div className="space-y-2.5">
                    {claims.map((c, i) => {
                        const st = EXPENSE_STATUS[c.status] ?? { label: c.status, tone: "bg-slate-100 text-slate-600 border-slate-200" };
                        return (
                            <button
                                key={c.id}
                                onClick={() => open(c)}
                                style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                                className="w-full text-left rounded-2xl border border-orange-100 bg-white p-4 flex items-center gap-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-orange-200 animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both"
                            >
                                <div className={cn("h-10 w-10 shrink-0 rounded-xl flex items-center justify-center text-white",
                                    c.type === "tour" ? "bg-purple-500" : "bg-orange-500")}>
                                    {c.type === "tour" ? <Plane className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-black text-slate-800">{c.claim_number}</span>
                                        <span className="text-sm font-semibold text-slate-600 truncate">{c.asm_name || "Removed ASM"}</span>
                                        <span className={cn("text-[10px] font-black uppercase px-2 py-0.5 rounded-full border", st.tone)}>{st.label}</span>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                                        {c.type === "tour" ? `Tour · ${c.from_place} → ${c.to_place}` : `Local · ${c.items.length} trip${c.items.length === 1 ? "" : "s"}`}
                                        {" · "}{claimDates(c)}
                                        {c.items.some(it => it.attachment_url) && <FileText className="inline h-3 w-3 ml-1.5 -mt-0.5 text-slate-400" />}
                                    </p>
                                </div>
                                <div className="text-right shrink-0 tabular-nums">
                                    <p className="text-base font-black text-slate-900">{rupees(c.total_amount)}</p>
                                    {c.approved_amount !== null && c.approved_amount !== c.total_amount && (
                                        <p className={cn("text-xs font-bold", c.status === "rejected" ? "text-rose-600" : "text-emerald-700")}>
                                            {rupees(c.approved_amount)} approved
                                        </p>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Review */}
            <Dialog open={!!selected} onOpenChange={o => { if (!o) setSelected(null); }}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto grid-cols-1 [&>*]:min-w-0">
                    {selected && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex flex-wrap items-center gap-2">
                                    {selected.claim_number}
                                    <span className={cn("text-[10px] font-black uppercase px-2 py-0.5 rounded-full border",
                                        (EXPENSE_STATUS[selected.status] ?? EXPENSE_STATUS.submitted).tone)}>
                                        {(EXPENSE_STATUS[selected.status] ?? { label: selected.status }).label}
                                    </span>
                                </DialogTitle>
                                <DialogDescription>
                                    {selected.asm_name || "Removed ASM"}{selected.asm_phone ? ` · ${selected.asm_phone}` : ""}
                                    {" · "}{selected.type === "tour" ? "Outstation tour" : "Local conveyance"} · {claimDates(selected)}
                                    {" · "}filed {new Date(selected.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                                </DialogDescription>
                            </DialogHeader>

                            {mode === "partial" ? (
                                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <p className="text-xs text-slate-500">Set the amount approved on each line. Lower a line to 0 to refuse it.</p>
                                    <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
                                        {selected.items.map(item => {
                                            const v = amounts[item.id] ?? "";
                                            const over = Number(v) > item.amount;
                                            return (
                                                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 w-14 shrink-0">{ITEM_LABEL[item.kind]}</span>
                                                    <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">
                                                        {item.from_place && item.to_place ? `${item.from_place} → ${item.to_place}` : item.description}
                                                    </span>
                                                    {item.attachment_url && (
                                                        <a href={item.attachment_url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-orange-600 hover:underline shrink-0">
                                                            Bill
                                                        </a>
                                                    )}
                                                    <span className="text-xs text-slate-400 tabular-nums shrink-0 w-20 text-right">of {rupees(item.amount)}</span>
                                                    <Input
                                                        value={v}
                                                        inputMode="decimal"
                                                        onChange={e => setAmounts({ ...amounts, [item.id]: e.target.value.replace(/[^\d.]/g, "") })}
                                                        className={cn("w-28 h-9 text-right tabular-nums", over && "border-rose-400 text-rose-600")}
                                                    />
                                                </div>
                                            );
                                        })}
                                        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/70">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Approving</span>
                                            <span className="text-sm font-black tabular-nums">
                                                <span className="text-emerald-700">{rupees(partialTotal)}</span>
                                                <span className="text-slate-400"> of {rupees(selected.total_amount)}</span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <ExpenseClaimLines claim={selected} />
                            )}

                            {/* Decided and not yet paid: pay it, or change the decision */}
                            {canEdit && ["approved", "partially_approved", "rejected"].includes(selected.status) && !changing && (
                                paying ? (
                                    <div className="rounded-2xl border border-slate-300 bg-slate-50 p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        <p className="text-sm font-bold text-slate-700">Mark {rupees(selected.approved_amount ?? 0)} paid</p>
                                        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                                            <label className="space-y-1">
                                                <span className="text-xs text-slate-500">Date paid</span>
                                                <Input type="date" value={paidOn} max={istToday()} onChange={e => setPaidOn(e.target.value)} className="bg-white" />
                                            </label>
                                            <label className="space-y-1">
                                                <span className="text-xs text-slate-500">Reference (optional)</span>
                                                <Input value={paymentRef} maxLength={100} onChange={e => setPaymentRef(e.target.value)}
                                                    placeholder="UTR, cheque number or cash" className="bg-white" />
                                            </label>
                                        </div>
                                        <p className="text-xs text-slate-500">Once paid, the decision on this claim can no longer change.</p>
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" onClick={() => setPaying(false)} disabled={saving}>Back</Button>
                                            <Button onClick={markPaid} disabled={saving || !paidOn} className="bg-slate-800 hover:bg-slate-900 font-bold">
                                                {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                                                Confirm paid
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                                        <Button variant="outline" onClick={() => setChanging(true)} className="font-bold">
                                            <Pencil className="h-4 w-4 mr-1.5" /> Change decision
                                        </Button>
                                        {selected.status !== "rejected" && (
                                            <Button onClick={() => setPaying(true)} className="bg-slate-800 hover:bg-slate-900 font-bold">
                                                <Banknote className="h-4 w-4 mr-1.5" /> Mark paid
                                            </Button>
                                        )}
                                    </div>
                                )
                            )}

                            {(selected.status === "submitted" || changing) && canEdit && (
                                <div className="space-y-3 pt-1">
                                    {changing && mode === null && (
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-xs text-slate-500">Choose the new decision. The ASM is told it changed.</p>
                                            <Button variant="ghost" size="sm" onClick={() => setChanging(false)}>Cancel</Button>
                                        </div>
                                    )}
                                    {mode === null ? (
                                        <div className="grid gap-2 sm:grid-cols-3">
                                            <Button onClick={() => setMode("approve")} className="bg-emerald-600 hover:bg-emerald-700 font-bold">
                                                <CheckCircle2 className="h-4 w-4 mr-1.5" /> Approve {rupees(selected.total_amount)}
                                            </Button>
                                            <Button variant="outline" onClick={() => setMode("partial")} className="border-amber-300 text-amber-700 hover:bg-amber-50 font-bold">
                                                <Scissors className="h-4 w-4 mr-1.5" /> Approve part
                                            </Button>
                                            <Button variant="outline" onClick={() => setMode("reject")} className="border-rose-200 text-rose-600 hover:bg-rose-50 font-bold">
                                                <XCircle className="h-4 w-4 mr-1.5" /> Reject
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className={cn("rounded-2xl border p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300",
                                            mode === "approve" ? "border-emerald-200 bg-emerald-50/50"
                                                : mode === "partial" ? "border-amber-200 bg-amber-50/50" : "border-rose-200 bg-rose-50/50")}>
                                            <p className="text-sm font-bold text-slate-700">
                                                {mode === "approve" && `Approve the full ${rupees(selected.total_amount)}`}
                                                {mode === "partial" && `Approve ${rupees(partialTotal)} of ${rupees(selected.total_amount)}`}
                                                {mode === "reject" && "Reject this claim"}
                                            </p>
                                            <Textarea
                                                value={note}
                                                onChange={e => setNote(e.target.value)}
                                                rows={2}
                                                maxLength={1000}
                                                autoFocus
                                                placeholder={mode === "approve" ? "Note for the ASM (optional)" : "Reason — the ASM will see this"}
                                                className="bg-white"
                                            />
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" onClick={() => setMode(null)} disabled={saving}>Back</Button>
                                                <Button
                                                    onClick={decide}
                                                    disabled={saving || (mode !== "approve" && !note.trim())}
                                                    className={cn("font-bold",
                                                        mode === "approve" ? "bg-emerald-600 hover:bg-emerald-700"
                                                            : mode === "partial" ? "bg-amber-600 hover:bg-amber-700" : "bg-rose-600 hover:bg-rose-700")}
                                                >
                                                    {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                                                    {changing ? "Save new decision" : mode === "approve" ? "Confirm approval" : mode === "partial" ? "Confirm partial approval" : "Confirm rejection"}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};
