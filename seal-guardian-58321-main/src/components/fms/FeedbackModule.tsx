import { useEffect, useRef, useState } from "react";
import { Angry, Check, CheckCircle2, ChevronDown, Frown, Laugh, Loader2, Meh, MessageSquareHeart, Paperclip, Send, Smile, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { cn, formatToIST } from "@/lib/utils";
import { answerText, dateText, monthName, type FeedbackAnswer, type FeedbackQuestion, type FormState } from "@/lib/feedback";

interface Current {
    month: string; enabled: boolean; state?: FormState; title: string; intro: string;
    questions: FeedbackQuestion[];
    response: { answers: FeedbackAnswer[]; submitted_at: string } | null;
}

/* A number's colour on a scale, red at the low end to green at the high end. */
const hueAt = (i: number, n: number) => Math.round((n <= 1 ? 1 : i / (n - 1)) * 130);

/** Number buttons in a scale: two rows on a phone, one row on a wider screen. */
function NumberScale({ nums, value, onChange, label, low, high }: {
    nums: number[]; value: any; onChange: (n: number) => void; label: string; low: string; high: string;
}) {
    const cols = nums.length > 6 ? Math.ceil(nums.length / 2) : nums.length;
    return (
        <div>
            <div role="radiogroup" aria-label={label}
                className="grid gap-1.5 sm:gap-2 [grid-template-columns:repeat(var(--cm),minmax(0,1fr))] sm:[grid-template-columns:repeat(var(--cs),minmax(0,1fr))]"
                style={{ "--cm": cols, "--cs": nums.length } as React.CSSProperties}>
                {nums.map((n, i) => {
                    const h = hueAt(i, nums.length), on = value === n;
                    return (
                        <button key={n} type="button" role="radio" aria-checked={on} onClick={() => onChange(n)}
                            className={cn("h-12 sm:h-11 rounded-xl border-2 text-base font-black tabular-nums transition-all active:scale-95", on && "scale-105 shadow-md")}
                            style={on
                                ? { background: `hsl(${h} 70% 42%)`, borderColor: `hsl(${h} 70% 42%)`, color: "#fff" }
                                : { background: `hsl(${h} 85% 97%)`, borderColor: `hsl(${h} 60% 88%)`, color: `hsl(${h} 55% 30%)` }}>
                            {n}
                        </button>
                    );
                })}
            </div>
            <div className="flex justify-between text-[11px] font-semibold mt-1.5">
                <span style={{ color: "hsl(0 55% 45%)" }}>{low}</span><span style={{ color: "hsl(130 45% 32%)" }}>{high}</span>
            </div>
        </div>
    );
}

/* Choices that read as how happy someone is get a face. */
const FACES: [RegExp, typeof Smile, number][] = [
    [/^very\s+dissatisfied|^very\s+unhappy|^very\s+poor/i, Angry, 0],
    [/^dissatisfied|^unhappy|^poor|^bad/i, Frown, 25],
    [/^neutral|^average|^okay|^ok$/i, Meh, 45],
    [/^very\s+satisfied|^very\s+happy|^excellent/i, Laugh, 130],
    [/^satisfied|^happy|^good/i, Smile, 95],
];
const faceOf = (o: string) => FACES.find(([re]) => re.test(o.trim()));

/** One question's input (the admin's preview uses it too). */
export function Field({ q, value, onChange, files, onFiles }: {
    q: FeedbackQuestion; value: any; onChange: (v: any) => void; files: File[]; onFiles: (f: File[]) => void;
}) {
    switch (q.type) {
        case "rating":
            return (
                <div className="flex gap-1" role="radiogroup" aria-label={q.label}>
                    {[1, 2, 3, 4, 5].map(n => (
                        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? "" : "s"}`}
                            onClick={() => onChange(n)} className="p-1">
                            <Star className={cn("h-8 w-8 transition-colors", (value ?? 0) >= n ? "fill-amber-400 text-amber-400" : "text-slate-300 hover:text-amber-300")} />
                        </button>
                    ))}
                </div>
            );
        case "scale": {
            const lo = q.scale_min ?? 1, hi = q.scale_max ?? 10;
            return <NumberScale nums={Array.from({ length: hi - lo + 1 }, (_, k) => lo + k)} value={value} onChange={onChange} label={q.label} low={q.low_label || "Poor"} high={q.high_label || "Excellent"} />;
        }
        case "nps":
            return <NumberScale nums={[...Array(11).keys()]} value={value} onChange={onChange} label={q.label} low="Not likely" high="Very likely" />;
        case "yesno":
            return (
                <div className="grid grid-cols-2 gap-2">
                    {([["Yes", true, 130], ["No", false, 0]] as const).map(([l, b, h]) => {
                        const on = value === b;
                        return (
                            <button key={l} type="button" aria-pressed={on} onClick={() => onChange(b)}
                                className="h-12 rounded-xl border-2 text-base font-bold transition-all active:scale-95"
                                style={on ? { background: `hsl(${h} 65% 40%)`, borderColor: `hsl(${h} 65% 40%)`, color: "#fff" } : { background: "#fff", borderColor: "#e2e8f0", color: "#334155" }}>
                                {l}
                            </button>
                        );
                    })}
                </div>
            );
        case "single": case "multi": {
            const picked: string[] = q.type === "multi" ? (value ?? []) : value ? [value] : [];
            const opts = q.options ?? [];
            const faces = opts.length > 1 && opts.every(o => faceOf(o));
            return (
                <div className="grid gap-2 sm:grid-cols-2">
                    {q.type === "multi" && <p className="sm:col-span-2 -mb-0.5 text-[11px] text-slate-400">Pick all that apply</p>}
                    {opts.map(o => {
                        const on = picked.includes(o);
                        const face = faces ? faceOf(o) : undefined;
                        const Icon = face?.[1];
                        const h = face?.[2];
                        return (
                            <button key={o} type="button" aria-pressed={on}
                                onClick={() => onChange(q.type === "multi" ? (on ? picked.filter(x => x !== o) : [...picked, o]) : o)}
                                className={cn("flex items-center gap-3 min-h-[3rem] rounded-xl border-2 px-3.5 py-2 text-left text-[15px] font-semibold transition-all active:scale-[0.98]",
                                    !face && (on ? "border-brand-orange bg-orange-50 text-orange-800" : "border-slate-200 bg-white text-slate-700"))}
                                style={face ? (on
                                    ? { background: `hsl(${h} 70% 95%)`, borderColor: `hsl(${h} 60% 45%)`, color: `hsl(${h} 60% 25%)` }
                                    : { background: "#fff", borderColor: "#e2e8f0", color: "#334155" }) : undefined}>
                                {Icon
                                    ? <Icon className="h-7 w-7 shrink-0" style={{ color: `hsl(${h} 65% ${on ? 38 : 55}%)` }} />
                                    : <span className={cn("grid place-items-center h-5 w-5 shrink-0 border-2", q.type === "multi" ? "rounded-md" : "rounded-full", on ? "border-brand-orange bg-brand-orange text-white" : "border-slate-300")}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>}
                                <span className="flex-1">{o}</span>
                                {Icon && on && <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: `hsl(${h} 60% 40%)` }} />}
                            </button>
                        );
                    })}
                </div>
            );
        }
        case "text": return <Input value={value ?? ""} onChange={e => onChange(e.target.value)} className="h-12 rounded-xl text-base" placeholder="Type your answer" />;
        case "textarea": return <Textarea rows={4} value={value ?? ""} onChange={e => onChange(e.target.value)} className="rounded-xl text-base" placeholder="Type your answer" />;
        case "number": return <Input type="number" inputMode="decimal" value={value ?? ""} onChange={e => onChange(e.target.value)} className="h-12 rounded-xl text-base max-w-[220px]" />;
        case "photo": {
            const max = q.max_files ?? 1;
            const id = `fb-photo-${q.id}`;
            return (
                <div className="space-y-1.5">
                    <input id={id} type="file" accept="image/*" multiple={max > 1} className="hidden"
                        onChange={e => { const fl = e.target.files; if (fl) onFiles([...files, ...Array.from(fl)].slice(0, max)); e.target.value = ""; }} />
                    <label htmlFor={id} className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-5 text-sm font-semibold text-slate-500 cursor-pointer hover:border-orange-200 active:bg-orange-50">
                        <Paperclip className="h-4 w-4" /> Add {max > 1 ? `up to ${max} photos` : "a photo"}
                    </label>
                    {files.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {files.map((f, i) => (
                                <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-orange-50 text-orange-700 text-xs px-2 py-1 max-w-[220px]">
                                    <span className="truncate">{f.name}</span>
                                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onFiles(files.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            );
        }
    }
}

export const isEmpty = (q: FeedbackQuestion, v: any, files: File[]) =>
    q.type === "photo" ? !files.length : v == null || v === "" || (Array.isArray(v) && !v.length);

/** The form's heading: month, title, introduction (the admin's preview uses it too). */
export function FeedbackHeader({ month, title, intro, count }: { month: string; title: string; intro?: string; count?: number }) {
    return (
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 via-orange-500 to-amber-400 p-5 sm:p-6 text-white shadow-lg shadow-orange-500/20">
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
            <div className="absolute right-10 -bottom-10 h-24 w-24 rounded-full bg-white/10" />
            <div className="relative flex items-start gap-3.5">
                <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur grid place-items-center shrink-0"><MessageSquareHeart className="h-6 w-6" /></div>
                <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-white/80">{monthName(month)}</p>
                    <h2 className="text-xl sm:text-2xl font-black leading-tight">{title}</h2>
                    {intro && <p className="text-sm text-white/90 mt-1.5 whitespace-pre-line">{intro}</p>}
                    {!!count && (
                        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold">{count} question{count === 1 ? "" : "s"} · about {Math.max(1, Math.round(count * 0.4))} min</p>
                    )}
                </div>
            </div>
        </div>
    );
}

/** One question as a card: its number (a tick once answered), the question, its input. */
export function QuestionCard({ q, n, value, files, onChange, onFiles, flash, cardRef }: {
    q: FeedbackQuestion; n: number; value: any; files: File[]; onChange: (v: any) => void; onFiles: (f: File[]) => void;
    flash?: boolean; cardRef?: (el: HTMLDivElement | null) => void;
}) {
    const ok = !isEmpty(q, value, files);
    return (
        <div ref={cardRef}
            className={cn("scroll-mt-24 rounded-2xl border-2 bg-white p-4 sm:p-5 space-y-3 transition-colors",
                flash ? "border-red-400 ring-4 ring-red-100" : ok ? "border-emerald-200" : "border-slate-100")}>
            <div className="flex items-start gap-3">
                <span className={cn("grid place-items-center h-7 w-7 shrink-0 rounded-full text-xs font-black tabular-nums transition-colors",
                    ok ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500")}>
                    {ok ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-800 leading-snug text-[15px] sm:text-base">{q.label || "—"}</p>
                    {q.help && <p className="text-xs text-slate-500 mt-0.5">{q.help}</p>}
                    {!q.required && <p className="text-[11px] text-slate-400 mt-0.5">Optional</p>}
                </div>
            </div>
            <Field q={q} value={value} onChange={onChange} files={files} onFiles={onFiles} />
        </div>
    );
}

/**
 * The store's monthly Review & Feedback: this month's questions until it is
 * sent, then what was sent; and the earlier months below.
 */
export default function FeedbackModule() {
    const { toast } = useToast();
    const [cur, setCur] = useState<Current | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [values, setValues] = useState<Record<string, any>>({});
    const [files, setFiles] = useState<Record<string, File[]>>({});
    const [sending, setSending] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [past, setPast] = useState<{ month: string; submitted_at: string; answers: FeedbackAnswer[] }[]>([]);
    const [openMonth, setOpenMonth] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const cards = useRef<Record<string, HTMLDivElement | null>>({});

    const load = () => {
        setError(null);
        api.get("/feedback/current").then(r => setCur(r.data.data)).catch(e => setError(getErrorMessage(e, "Could not load the form")));
        api.get("/feedback/mine").then(r => setPast(r.data.data || [])).catch(() => setPast([]));
    };
    useEffect(load, []);

    if (error) return <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center text-sm text-slate-500">{error} <Button variant="link" onClick={load}>Try again</Button></div>;
    if (!cur) return <div className="flex justify-center p-12"><Loader2 className="h-7 w-7 animate-spin text-brand-orange" /></div>;

    const missing = cur.questions.filter(q => q.required && isEmpty(q, values[q.id], files[q.id] ?? []));
    const done = cur.questions.filter(q => !isEmpty(q, values[q.id], files[q.id] ?? [])).length;
    const total = cur.questions.length;

    /* Picking a quick answer moves the next unanswered question into view. */
    const QUICK = ["rating", "scale", "nps", "yesno", "single"];
    const answer = (q: FeedbackQuestion, v: any) => {
        const next = { ...values, [q.id]: v };
        setValues(next);
        if (!QUICK.includes(q.type) || !isEmpty(q, values[q.id], [])) return;
        const i = cur.questions.findIndex(x => x.id === q.id);
        const after = cur.questions.slice(i + 1).find(x => isEmpty(x, next[x.id], files[x.id] ?? []));
        if (after) setTimeout(() => cards.current[after.id]?.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
    };
    /* Send with questions left: show the first one instead. */
    const showMissing = () => {
        const q = missing[0];
        if (!q) return;
        cards.current[q.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlash(q.id);
        setTimeout(() => setFlash(null), 1600);
    };
    const send = async () => {
        setSending(true);
        try {
            const fd = new FormData();
            fd.append("answers", JSON.stringify(values));
            for (const [qid, fl] of Object.entries(files)) fl.forEach(f => fd.append(`q_${qid}`, f));
            await api.post("/feedback", fd, { headers: { "Content-Type": "multipart/form-data" } });
            toast({ title: "Thank you!", description: `Your feedback for ${monthName(cur.month)} is sent.` });
            setConfirm(false);
            load();
        } catch (e) {
            toast({ variant: "destructive", title: "Not sent", description: getErrorMessage(e, "Try again.") });
        } finally {
            setSending(false);
        }
    };

    const earlier = past.filter(p => p.month !== cur.month);

    return (
        <div className="space-y-4 sm:space-y-5 mb-6 max-w-3xl mx-auto">
            <FeedbackHeader month={cur.month} title={cur.title} intro={cur.intro} count={cur.enabled && !cur.response ? total : 0} />

            {cur.response ? (
                <div className="rounded-2xl border-2 border-emerald-100 bg-white p-5 space-y-4">
                    <div className="flex flex-col items-center text-center gap-2 py-2">
                        <span className="grid place-items-center h-14 w-14 rounded-full bg-emerald-50"><CheckCircle2 className="h-8 w-8 text-emerald-600" /></span>
                        <div>
                            <p className="text-lg font-black text-slate-800">Sent — thank you!</p>
                            <p className="text-xs text-slate-500">You sent this month's feedback on {formatToIST(cur.response.submitted_at)}. The next one opens next month.</p>
                        </div>
                    </div>
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                        {cur.response.answers.map(a => (
                            <div key={a.qid} className="p-3">
                                <p className="text-xs font-semibold text-slate-500">{a.label}</p>
                                <p className="text-sm text-slate-800 whitespace-pre-line">{answerText(a)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            ) : !cur.enabled ? (
                <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-500">
                    <MessageSquareHeart className="mx-auto h-10 w-10 text-slate-200 mb-2" />
                    {cur.state?.why === "not_yet" && cur.state.opens_on
                        ? `This month's feedback opens on ${dateText(cur.state.opens_on)}.`
                        : cur.state?.why === "closed" && cur.state.opens_on
                            ? `This month's feedback has closed. The next one opens on ${dateText(cur.state.opens_on)}.`
                            : cur.state?.why === "not_for_you"
                                ? "There's no feedback form for your store right now."
                                : "The feedback form isn't open right now. We'll let you know when it is."}
                </div>
            ) : (
                <div className="space-y-3 pb-2">
                    {cur.questions.map((q, i) => {
                        return (
                            <QuestionCard key={q.id} q={q} n={i + 1} value={values[q.id]} files={files[q.id] ?? []} flash={flash === q.id}
                                cardRef={el => { cards.current[q.id] = el; }}
                                onChange={v => answer(q, v)} onFiles={f => setFiles(p => ({ ...p, [q.id]: f }))} />
                        );
                    })}

                    <div className="sticky bottom-2 sm:bottom-3 z-10 rounded-2xl bg-gray-900 text-white shadow-[0_-8px_30px_rgba(0,0,0,0.15)] px-4 pt-3 pb-3">
                        {confirm ? (
                            <div className="space-y-2.5">
                                <p className="text-sm font-semibold">Send your feedback? <span className="font-normal text-gray-300">You can't change it after.</span></p>
                                <div className="grid grid-cols-2 gap-2">
                                    <Button variant="ghost" className="h-11 text-white bg-white/10 hover:bg-white/20 hover:text-white rounded-xl" onClick={() => setConfirm(false)} disabled={sending}>Back</Button>
                                    <Button onClick={send} disabled={sending} className="h-11 bg-brand-orange hover:bg-brand-orange/90 text-white rounded-xl font-bold">
                                        {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />} Yes, send
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <svg viewBox="0 0 36 36" className="h-10 w-10 shrink-0 -rotate-90" aria-hidden>
                                    <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
                                    <circle cx="18" cy="18" r="15" fill="none" stroke={missing.length ? "#f97316" : "#10b981"} strokeWidth="4" strokeLinecap="round"
                                        strokeDasharray={`${(total ? done / total : 0) * 94.25} 94.25`} className="transition-all duration-500" />
                                </svg>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold tabular-nums">{done} of {total} answered</p>
                                    <p className="text-[11px] text-gray-400 truncate">{missing.length ? `${missing.length} required left` : "All set — send when ready"}</p>
                                </div>
                                <Button onClick={() => (missing.length ? showMissing() : setConfirm(true))} disabled={!total}
                                    className={cn("h-11 rounded-xl px-5 font-bold text-white", missing.length ? "bg-white/15 hover:bg-white/25" : "bg-brand-orange hover:bg-brand-orange/90")}>
                                    {missing.length ? "Next question" : <><Send className="h-4 w-4 mr-1.5" /> Send</>}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {earlier.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-sm font-bold text-slate-800">Earlier months</h3>
                    <div className="rounded-2xl border border-slate-100 bg-white divide-y divide-slate-100">
                        {earlier.map(p => (
                            <div key={p.month}>
                                <button type="button" onClick={() => setOpenMonth(openMonth === p.month ? null : p.month)}
                                    className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-slate-50">
                                    <span className="font-semibold text-slate-700">{monthName(p.month)}</span>
                                    <span className="flex items-center gap-2 text-xs text-slate-400">Sent {formatToIST(p.submitted_at)} <ChevronDown className={cn("h-4 w-4 transition-transform", openMonth === p.month && "rotate-180")} /></span>
                                </button>
                                {openMonth === p.month && (
                                    <div className="px-4 pb-4 space-y-2">
                                        {p.answers.map(a => (
                                            <div key={a.qid}>
                                                <p className="text-xs font-semibold text-slate-500">{a.label}</p>
                                                <p className="text-sm text-slate-800 whitespace-pre-line">{answerText(a)}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
