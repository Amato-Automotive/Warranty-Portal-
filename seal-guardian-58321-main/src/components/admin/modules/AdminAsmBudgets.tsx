import { useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BudgetCard } from "@/components/asm/BudgetCard";
import { rupees, type BudgetQuarter, type BudgetSummary } from "@/lib/asmExpenses";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Wallet } from "lucide-react";

/**
 * ASM Expenses → Budgets: each ASM's budget for a quarter, set by HR — a total
 * and a fixed amount a month for local conveyance; the rest of the total is
 * for tours. The ASM sees the same card on their portal.
 */

interface Row {
    asm_id: string;
    name: string;
    is_active: boolean;
    set_by_name: string | null;
    updated_at: string | null;
    summary: BudgetSummary;
}

const amountOf = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, "").trim()) ? Number(v.replace(/,/g, "")) : NaN);

export const AdminAsmBudgets = ({ canEdit }: { canEdit: boolean }) => {
    const { toast } = useToast();
    const [quarterKey, setQuarterKey] = useState<string | null>(null);
    const [data, setData] = useState<{ quarter: BudgetQuarter; previous: string; next: string; current: string; rows: Row[] } | null>(null);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState<string | null>(null);

    const [editing, setEditing] = useState<Row | null>(null);
    const [total, setTotal] = useState("");
    const [local, setLocal] = useState("");
    const [saving, setSaving] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);

    const load = async (q = quarterKey) => {
        setLoading(true);
        try {
            const res = await api.get("/asm/expense-budgets", { params: q ? { quarter: q } : {} });
            setData(res.data);
        } catch (error) {
            toast({ title: "Could not load budgets", description: getErrorMessage(error, "Please try again"), variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load(quarterKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quarterKey]);

    const edit = (row: Row) => {
        setEditing(row);
        setTotal(row.summary.set ? String(row.summary.total) : "");
        setLocal(row.summary.set ? String(row.summary.local_monthly) : "");
        setConfirmRemove(false);
    };

    const t = amountOf(total);
    const l = amountOf(local);
    const split = useMemo(() => {
        if (Number.isNaN(t) || Number.isNaN(l)) return null;
        return { localQuarter: l * 3, tours: t - l * 3 };
    }, [t, l]);
    const invalid = !split || t <= 0 || split.tours < 0;

    const save = async () => {
        if (!editing || !data) return;
        setSaving(true);
        try {
            const res = await api.put(`/asm/expense-budgets/${editing.asm_id}/${data.quarter.key}`, { total, local_monthly: local });
            toast({ title: res.data?.message || "Budget saved" });
            setEditing(null);
            load();
        } catch (error) {
            toast({ title: "Could not save", description: getErrorMessage(error, "Please check the amounts"), variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!editing || !data) return;
        setSaving(true);
        try {
            const res = await api.delete(`/asm/expense-budgets/${editing.asm_id}/${data.quarter.key}`);
            toast({ title: res.data?.message || "Budget removed" });
            setEditing(null);
            load();
        } catch (error) {
            toast({ title: "Could not remove", description: getErrorMessage(error, "Please try again"), variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const rows = data?.rows ?? [];
    const set = rows.filter(r => r.summary.set);
    const totals = {
        allocated: set.reduce((s, r) => s + r.summary.total, 0),
        used: rows.reduce((s, r) => s + r.summary.used, 0),
        pending: rows.reduce((s, r) => s + r.summary.pending, 0),
        remaining: set.reduce((s, r) => s + r.summary.remaining, 0),
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-9 w-9" disabled={!data} onClick={() => data && setQuarterKey(data.previous)} aria-label="Previous quarter">
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="px-3 min-w-[9rem] text-center">
                        <p className="text-sm font-black text-slate-800">{data?.quarter.label ?? "…"}</p>
                        <p className="text-[11px] text-slate-400">{data?.quarter.span}</p>
                    </div>
                    <Button variant="outline" size="icon" className="h-9 w-9" disabled={!data} onClick={() => data && setQuarterKey(data.next)} aria-label="Next quarter">
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
                {data && data.quarter.key !== data.current && (
                    <Button variant="ghost" size="sm" className="text-xs text-slate-500" onClick={() => setQuarterKey(data.current)}>Back to this quarter</Button>
                )}
                {data && (
                    <p className="ml-auto text-xs text-slate-500 tabular-nums">
                        {set.length} of {rows.length} ASMs set · {rupees(totals.allocated)} allocated · {rupees(totals.used)} approved
                        {totals.pending > 0 && <> · {rupees(totals.pending)} awaiting</>}
                    </p>
                )}
            </div>

            {loading && !data ? (
                <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>
            ) : rows.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-orange-200 bg-white/40 p-12 text-center">
                    <Wallet className="h-8 w-8 text-slate-300 mx-auto mb-3" />
                    <p className="font-black text-slate-800 uppercase tracking-tight">No ASMs</p>
                    <p className="text-sm text-slate-500 mt-1">Add ASMs from ASM Management first.</p>
                </div>
            ) : (
                <div className={cn("space-y-2.5 transition-opacity", loading && "opacity-60")}>
                    {rows.map(r => {
                        const s = r.summary;
                        const isOpen = open === r.asm_id;
                        return (
                            <div key={r.asm_id} className={cn("rounded-2xl border bg-white shadow-sm transition-all", isOpen ? "border-orange-200" : "border-orange-100")}>
                                <div className="p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                                    <button onClick={() => setOpen(isOpen ? null : r.asm_id)} className="flex items-center gap-2 min-w-[12rem] flex-1 text-left">
                                        <ChevronDown className={cn("h-4 w-4 text-slate-400 shrink-0 transition-transform", isOpen && "rotate-180")} />
                                        <span className="text-sm font-black text-slate-800 truncate">{r.name}</span>
                                        {!r.is_active && <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200">Inactive</span>}
                                    </button>
                                    {s.set ? (
                                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-6 gap-y-1 text-xs tabular-nums">
                                            <Figure label="Total" value={rupees(s.total)} />
                                            <Figure label="Local / month" value={rupees(s.local_monthly)} />
                                            <Figure label="Tours" value={rupees(s.tour.allocated)} />
                                            <Figure label="Approved" value={rupees(s.used)} tone={s.over > 0 ? "text-rose-600" : undefined} />
                                            <Figure label="Left" value={rupees(s.remaining)} tone="text-emerald-700" />
                                        </div>
                                    ) : (
                                        <span className="text-xs text-slate-400">No budget set{s.used > 0 ? ` · ${rupees(s.used)} approved this quarter` : ""}</span>
                                    )}
                                    {canEdit && (
                                        <Button variant={s.set ? "outline" : "default"} size="sm" onClick={() => edit(r)}
                                            className={cn("font-bold shrink-0", !s.set && "bg-orange-500 hover:bg-orange-600")}>
                                            {s.set ? <><Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit</> : <><Plus className="h-3.5 w-3.5 mr-1.5" /> Set budget</>}
                                        </Button>
                                    )}
                                </div>
                                {isOpen && (
                                    <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                        <BudgetCard budget={s} />
                                        {r.set_by_name && (
                                            <p className="text-[11px] text-slate-400 mt-2">
                                                Last set by {r.set_by_name}{r.updated_at ? ` on ${new Date(r.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <Dialog open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }}>
                <DialogContent className="max-w-md">
                    {editing && data && (
                        <>
                            <DialogHeader>
                                <DialogTitle>{editing.summary.set ? "Edit" : "Set"} budget · {data.quarter.label}</DialogTitle>
                                <DialogDescription>{editing.name} · {data.quarter.span}</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-3">
                                <label className="block space-y-1">
                                    <span className="text-xs font-bold text-slate-600">Total budget for the quarter (₹)</span>
                                    <Input value={total} inputMode="decimal" autoFocus placeholder="e.g. 90000"
                                        onChange={e => setTotal(e.target.value.replace(/[^\d.,]/g, ""))} className="tabular-nums" />
                                </label>
                                <label className="block space-y-1">
                                    <span className="text-xs font-bold text-slate-600">Local conveyance per month (₹)</span>
                                    <Input value={local} inputMode="decimal" placeholder="e.g. 8000"
                                        onChange={e => setLocal(e.target.value.replace(/[^\d.,]/g, ""))} className="tabular-nums" />
                                </label>
                                {split && t > 0 && (
                                    <div className={cn("rounded-xl border px-4 py-3 text-sm tabular-nums",
                                        split.tours < 0 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-100 bg-slate-50 text-slate-600")}>
                                        <div className="flex justify-between"><span>Local · 3 × {rupees(l)}</span><span className="font-bold">{rupees(split.localQuarter)}</span></div>
                                        <div className="flex justify-between mt-1"><span>Outstation tours</span><span className="font-bold">{split.tours < 0 ? "—" : rupees(split.tours)}</span></div>
                                        {split.tours < 0 && <p className="text-xs mt-2">Local for three months is more than the total.</p>}
                                    </div>
                                )}
                                <p className="text-xs text-slate-500">
                                    Unused local lapses at the end of each month. Claims are counted once approved, by their travel date.
                                    {editing.summary.used > 0 && ` ${rupees(editing.summary.used)} is already approved this quarter.`}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 pt-2">
                                {editing.summary.set && (
                                    confirmRemove ? (
                                        <Button variant="ghost" onClick={remove} disabled={saving} className="text-rose-600 hover:bg-rose-50 font-bold">Confirm remove</Button>
                                    ) : (
                                        <Button variant="ghost" onClick={() => setConfirmRemove(true)} disabled={saving} className="text-slate-500">Remove budget</Button>
                                    )
                                )}
                                <Button variant="ghost" className="ml-auto" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
                                <Button onClick={save} disabled={saving || invalid} className="bg-orange-500 hover:bg-orange-600 font-bold">
                                    {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save
                                </Button>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

const Figure = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div>
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
        <p className={cn("text-sm font-black text-slate-800", tone)}>{value}</p>
    </div>
);
