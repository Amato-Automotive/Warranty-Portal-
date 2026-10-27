import { useMemo, useRef, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { cn, getISTTodayISO } from "@/lib/utils";
import { compressImage, isCompressibleImage } from "@/lib/imageCompression";
import { budgetOverspend, type BudgetSummary } from "@/lib/asmExpenses";
import {
    AlertTriangle, ArrowLeft, Bus, Car, CarTaxiFront, Check, FileText, Hotel, Loader2, Paperclip, Plane, Plus, TrainFront, Trash2, X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * A new expense claim — an outstation tour. Mirrors the server's rules
 * (asmExpenseRules.ts) so the ASM finds out before submitting; the server's
 * check is the one that counts.
 *
 * ASMs no longer file local conveyance (owner's call, 27 Oct 2026): it is the
 * fixed monthly part of their budget. The server still reads local claims, so
 * the ones already filed show as before.
 */

type Mode = "train" | "bus" | "flight" | "cab" | "own_vehicle";
type Bill = "onward_ticket" | "return_ticket" | "hotel_bill";

const BACKDATE_DAYS = 7;
const TICKETED: Mode[] = ["train", "bus", "flight"];
const MODES: { id: Mode; label: string; icon: LucideIcon }[] = [
    { id: "train", label: "Train", icon: TrainFront },
    { id: "bus", label: "Bus", icon: Bus },
    { id: "flight", label: "Flight", icon: Plane },
    { id: "cab", label: "Cab", icon: CarTaxiFront },
    { id: "own_vehicle", label: "Own vehicle", icon: Car },
];

const shiftDay = (iso: string, days: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
    Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const amountOf = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim()) ? Number(v) : 0);
const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

// ── Small pieces in the portal's style ───────────────────────────────────────

const Section = ({ title, children, delay = 0 }: { title: string; children: React.ReactNode; delay?: number }) => (
    <section
        style={{ animationDelay: `${delay}ms` }}
        className="rounded-[28px] border border-orange-100 bg-white p-5 md:p-6 space-y-4 shadow-[0_15px_50px_rgba(0,0,0,0.03)] animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both"
    >
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{title}</h3>
        {children}
    </section>
);

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
    <label className="block space-y-1.5">
        <span className="text-xs font-bold text-slate-600">{label}</span>
        {children}
        {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
    </label>
);

const inputCls = "h-11 rounded-xl border-slate-200 focus-visible:ring-orange-400";
/** A block that appears because of an answer above it. */
const reveal = "animate-in fade-in slide-in-from-top-2 duration-300";

/** YYYY-MM-DD to a local-midnight Date, which is what the calendar compares against. */
const toDate = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
};

const Choice = ({ selected, onClick, icon: Icon, label, sub }: {
    selected: boolean; onClick: () => void; icon?: LucideIcon; label: string; sub?: string;
}) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            "flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-300 active:scale-[0.97]",
            selected
                ? "border-orange-300 bg-orange-50 text-orange-700 shadow-lg shadow-orange-100 -translate-y-0.5"
                : "border-slate-200 bg-white text-slate-600 hover:border-orange-200 hover:-translate-y-0.5 hover:shadow-md"
        )}
    >
        {Icon && (
            <span className={cn("h-9 w-9 shrink-0 rounded-xl flex items-center justify-center transition-all duration-300",
                selected ? "bg-orange-500 text-white scale-110 shadow-md shadow-orange-200" : "bg-slate-100 text-slate-500")}>
                <Icon className="h-4 w-4" />
            </span>
        )}
        <span className="min-w-0">
            <span className="block text-sm font-bold">{label}</span>
            {sub && <span className="block text-[11px] text-slate-400 font-medium">{sub}</span>}
        </span>
        {selected && <Check className="h-4 w-4 ml-auto shrink-0 animate-in zoom-in-50 duration-300" />}
    </button>
);

const BillPicker = ({ label, file, onChange }: { label: string; file?: File; onChange: (f?: File) => void }) => {
    const ref = useRef<HTMLInputElement>(null);
    return (
        <div className="space-y-1.5">
            <span className="text-xs font-bold text-slate-600">{label} *</span>
            <input
                ref={ref}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={e => { onChange(e.target.files?.[0]); e.target.value = ""; }}
            />
            {file ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 h-11 animate-in fade-in zoom-in-95 duration-300">
                    <FileText className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span className="text-sm font-semibold text-emerald-800 truncate flex-1">{file.name}</span>
                    <button type="button" onClick={() => onChange(undefined)} className="text-emerald-700 hover:text-rose-600" title="Remove">
                        <X className="h-4 w-4" />
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => ref.current?.click()}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange-200 bg-orange-50/40 h-11 text-sm font-bold text-orange-600 hover:bg-orange-50"
                >
                    <Paperclip className="h-4 w-4" /> Attach photo or PDF
                </button>
            )}
        </div>
    );
};

// ── The form ─────────────────────────────────────────────────────────────────

interface Props {
    /** This quarter's budget, to warn when a claim goes over it. */
    budget?: BudgetSummary | null;
    onCancel: () => void;
    onSubmitted: () => void;
}

export const AsmExpenseForm = ({ budget = null, onCancel, onSubmitted }: Props) => {
    const { toast } = useToast();
    const today = getISTTodayISO();
    const earliest = shiftDay(today, -BACKDATE_DAYS);

    const [remarks, setRemarks] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Tour
    const [startDate, setStartDate] = useState(today);
    const [endDate, setEndDate] = useState(today);
    const [fromCity, setFromCity] = useState("");
    const [toCity, setToCity] = useState("");
    const [mode, setMode] = useState<Mode | null>(null);
    const [ticketsBy, setTicketsBy] = useState<"self" | "company" | null>(null);
    const [oneWay, setOneWay] = useState(false);
    const [onwardAmount, setOnwardAmount] = useState("");
    const [returnAmount, setReturnAmount] = useState("");
    const [hotelStay, setHotelStay] = useState<boolean | null>(null);
    const [hotelNights, setHotelNights] = useState("1");
    const [hotelPersons, setHotelPersons] = useState("1");
    const [hotelAmount, setHotelAmount] = useState("");
    const [others, setOthers] = useState<{ description: string; amount: string }[]>([]);
    const [bills, setBills] = useState<Partial<Record<Bill, File>>>({});

    const ticketed = mode ? TICKETED.includes(mode) : false;
    const paidBySelf = !!mode && (!ticketed || ticketsBy === "self");
    const needsBill = mode !== "own_vehicle";
    const span = Math.max(0, daysBetween(startDate, endDate));
    const maxNights = Math.max(1, span);

    const requiredBills = useMemo<Bill[]>(() => {
        const r: Bill[] = [];
        if (paidBySelf && needsBill) {
            r.push("onward_ticket");
            if (!oneWay) r.push("return_ticket");
        }
        if (hotelStay) r.push("hotel_bill");
        return r;
    }, [paidBySelf, needsBill, oneWay, hotelStay]);

    const total = useMemo(() => {
        let t = 0;
        if (paidBySelf) {
            t += amountOf(onwardAmount);
            if (!oneWay) t += amountOf(returnAmount);
        }
        if (hotelStay) t += amountOf(hotelAmount);
        return t + others.reduce((s, o) => s + amountOf(o.amount), 0);
    }, [paidBySelf, onwardAmount, oneWay, returnAmount, hotelStay, hotelAmount, others]);

    // Going over is allowed; the ASM is only told, and HR sees it when deciding.
    const over = total > 0 ? budgetOverspend(budget, startDate, total) : null;

    const pickStart = (v: string) => {
        setStartDate(v);
        if (daysBetween(v, endDate) < 0) setEndDate(v);
    };

    const chooseHotel = (yes: boolean) => {
        setHotelStay(yes);
        if (yes) setHotelNights(String(maxNights));
    };

    const submit = async () => {
        const missing = requiredBills.filter(b => !bills[b]);
        if (missing.length) {
            const names: Record<Bill, string> = { onward_ticket: "onward ticket", return_ticket: "return ticket", hotel_bill: "hotel bill" };
            toast({ title: "Bill missing", description: `Attach the ${missing.map(m => names[m]).join(", ")}.`, variant: "destructive" });
            return;
        }

        const claim = {
            type: "tour", startDate, endDate, fromCity, toCity, travelMode: mode, ticketsBy: ticketed ? ticketsBy : null,
            oneWay, onwardAmount, returnAmount, hotelStay: !!hotelStay, hotelNights, hotelPersons, hotelAmount,
            others, remarks,
        };

        setSubmitting(true);
        try {
            const form = new FormData();
            form.append("claim", JSON.stringify(claim));
            for (const b of requiredBills) {
                let file = bills[b]!;
                if (isCompressibleImage(file)) file = await compressImage(file);
                form.append(b, file);
            }
            const res = await api.post("/asm-portal/expenses", form);
            toast({ title: "Claim submitted", description: res.data?.message });
            onSubmitted();
        } catch (error) {
            toast({ title: "Could not submit", description: getErrorMessage(error, "Please check the form and try again"), variant: "destructive" });
        } finally {
            setSubmitting(false);
        }
    };

    const setBill = (b: Bill) => (f?: File) => setBills(prev => ({ ...prev, [b]: f }));

    return (
        <div className="max-w-3xl space-y-5 pb-24 md:pb-28">
            <button onClick={onCancel} className="flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-orange-600">
                <ArrowLeft className="h-4 w-4" /> Back to my claims
            </button>

            <>
                    <Section title="1 · Outstation tour" delay={0}>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Start date">
                                <DatePicker value={startDate} onChange={pickStart} maxDate={toDate(today)} className={inputCls} />
                            </Field>
                            <Field label="Return date" hint={`Within the last ${BACKDATE_DAYS} days`}>
                                <DatePicker value={endDate} onChange={setEndDate}
                                    minDate={toDate(startDate > earliest ? startDate : earliest)} maxDate={toDate(today)} className={inputCls} />
                            </Field>
                            <Field label="From city">
                                <Input value={fromCity} onChange={e => setFromCity(e.target.value)} placeholder="e.g. Noida" className={inputCls} />
                            </Field>
                            <Field label="To city">
                                <Input value={toCity} onChange={e => setToCity(e.target.value)} placeholder="e.g. Jaipur" className={inputCls} />
                            </Field>
                        </div>
                    </Section>

                    <Section title="2 · Mode of travel" delay={80}>
                        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                            {MODES.map(m => (
                                <Choice key={m.id} selected={mode === m.id} onClick={() => setMode(m.id)} icon={m.icon} label={m.label} />
                            ))}
                        </div>

                        {ticketed && (
                            <div className={cn("space-y-2 pt-1", reveal)}>
                                <span className="text-xs font-bold text-slate-600">Tickets booked by</span>
                                <div className="grid gap-2 grid-cols-2">
                                    <Choice selected={ticketsBy === "self"} onClick={() => setTicketsBy("self")} label="Self" sub="You paid — claim the fare" />
                                    <Choice selected={ticketsBy === "company"} onClick={() => setTicketsBy("company")} label="Company" sub="Nothing to claim for tickets" />
                                </div>
                            </div>
                        )}

                        {paidBySelf && (
                            <div className={cn("space-y-4 pt-1", reveal)}>
                                <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 cursor-pointer w-fit">
                                    <input type="checkbox" checked={oneWay} onChange={e => setOneWay(e.target.checked)} className="h-4 w-4 accent-orange-500" />
                                    One way only
                                </label>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-3">
                                        <p className="text-xs font-black uppercase tracking-wider text-slate-500">
                                            Onward{fromCity && toCity ? ` · ${fromCity} → ${toCity}` : ""}
                                        </p>
                                        <Field label="Amount (₹)">
                                            <Input value={onwardAmount} inputMode="decimal" placeholder="0" className={inputCls}
                                                onChange={e => setOnwardAmount(e.target.value.replace(/[^\d.]/g, ""))} />
                                        </Field>
                                        {needsBill && <BillPicker label={mode === "cab" ? "Cab receipt" : "Ticket"} file={bills.onward_ticket} onChange={setBill("onward_ticket")} />}
                                    </div>
                                    {!oneWay && (
                                        <div className={cn("rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-3", reveal)}>
                                            <p className="text-xs font-black uppercase tracking-wider text-slate-500">
                                                Return{fromCity && toCity ? ` · ${toCity} → ${fromCity}` : ""}
                                            </p>
                                            <Field label="Amount (₹)">
                                                <Input value={returnAmount} inputMode="decimal" placeholder="0" className={inputCls}
                                                    onChange={e => setReturnAmount(e.target.value.replace(/[^\d.]/g, ""))} />
                                            </Field>
                                            {needsBill && <BillPicker label={mode === "cab" ? "Cab receipt" : "Ticket"} file={bills.return_ticket} onChange={setBill("return_ticket")} />}
                                        </div>
                                    )}
                                </div>
                                {mode === "own_vehicle" && (
                                    <p className="text-[11px] text-slate-400">No bill needed for your own vehicle.</p>
                                )}
                            </div>
                        )}
                    </Section>

                    <Section title="3 · Hotel stay" delay={160}>
                        <div className="grid gap-2 grid-cols-2 max-w-sm">
                            <Choice selected={hotelStay === true} onClick={() => chooseHotel(true)} icon={Hotel} label="Yes" />
                            <Choice selected={hotelStay === false} onClick={() => setHotelStay(false)} label="No" />
                        </div>
                        {hotelStay && (
                            <div className={cn("grid gap-3 sm:grid-cols-3", reveal)}>
                                <Field label="Nights" hint={`Up to ${maxNights} for these dates`}>
                                    <Input type="number" min={1} max={maxNights} value={hotelNights} className={inputCls}
                                        onChange={e => setHotelNights(e.target.value)} />
                                </Field>
                                <Field label="Persons staying">
                                    <Input type="number" min={1} max={10} value={hotelPersons} className={inputCls}
                                        onChange={e => setHotelPersons(e.target.value)} />
                                </Field>
                                <Field label="Hotel amount (₹)">
                                    <Input value={hotelAmount} inputMode="decimal" placeholder="0" className={inputCls}
                                        onChange={e => setHotelAmount(e.target.value.replace(/[^\d.]/g, ""))} />
                                </Field>
                                <div className="sm:col-span-3">
                                    <BillPicker label="Hotel bill" file={bills.hotel_bill} onChange={setBill("hotel_bill")} />
                                </div>
                            </div>
                        )}
                    </Section>

                    <Section title="4 · Other expenses (optional)" delay={240}>
                        <p className="text-[11px] text-slate-400 -mt-2">Local cabs at the destination, food and similar.</p>
                        {others.map((o, i) => (
                            <div key={i} className={cn("grid gap-3 grid-cols-[1fr_120px_auto] items-end", reveal)}>
                                <Field label="What for">
                                    <Input value={o.description} placeholder="e.g. Local cab to store" className={inputCls}
                                        onChange={e => setOthers(others.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                                </Field>
                                <Field label="Amount (₹)">
                                    <Input value={o.amount} inputMode="decimal" placeholder="0" className={inputCls}
                                        onChange={e => setOthers(others.map((x, j) => j === i ? { ...x, amount: e.target.value.replace(/[^\d.]/g, "") } : x))} />
                                </Field>
                                <button type="button" onClick={() => setOthers(others.filter((_, j) => j !== i))}
                                    className="h-11 w-9 flex items-center justify-center text-slate-400 hover:text-rose-600" title="Remove">
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                        {others.length < 10 && (
                            <Button type="button" variant="outline" onClick={() => setOthers([...others, { description: "", amount: "" }])}
                                className="rounded-xl border-orange-200 text-orange-600 hover:bg-orange-50 font-bold">
                                <Plus className="h-4 w-4 mr-1.5" /> Add expense
                            </Button>
                        )}
                    </Section>
            </>

            <Section title="5 · Remarks" delay={320}>
                <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={3} maxLength={1000}
                    placeholder="Optional — e.g. stores visited, purpose of the trip" className="rounded-xl border-slate-200" />
            </Section>

            {/* Total and submit, kept in reach on a phone */}
            <div className="fixed md:sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-3 right-3 md:left-0 md:right-0 md:bottom-4 z-30 rounded-[24px] border border-orange-100 bg-white/95 backdrop-blur px-5 py-3 md:px-6 md:py-4 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] animate-in slide-in-from-bottom-8 fade-in duration-500">
                    {!!over && (
                        <p className="mb-2 flex items-start gap-1.5 text-xs font-bold text-amber-700 animate-in fade-in duration-300">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                            This goes {rupees(over)} over your {budget?.quarter.label} tour budget. You can still submit; head office will decide.
                        </p>
                    )}
                    <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Total claim</p>
                        <p key={total} className="text-2xl font-black text-slate-900 tabular-nums animate-in zoom-in-90 fade-in duration-300">{rupees(total)}</p>
                    </div>
                    <Button onClick={submit} disabled={submitting || total <= 0}
                        className="h-12 px-6 rounded-xl bg-orange-500 hover:bg-orange-600 font-black uppercase tracking-wide shadow-lg shadow-orange-200 transition-all hover:-translate-y-0.5 active:scale-95">
                        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Submit claim
                    </Button>
                    </div>
                </div>
        </div>
    );
};
