import { useState, useEffect } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { Badge } from "@/components/ui/badge";
import {
    Loader2, ClipboardCheck, MessageCircle, Phone, ChevronDown, ChevronUp, Clock, CheckCircle2
} from "lucide-react";
import {
    AUDIT_QUESTIONS, AUDIT_SECTIONS, auditLabel, scoreAudit, BAND_META, type AuditFieldKey
} from "@/lib/auditQuestions";

/**
 * The store's own audit history.
 *
 * A store answers the audit on WhatsApp and then has no record of what it said.
 * This is that record — the same questions and the same wording as the form
 * they filled, so the two are comparable.
 *
 * Read-only on purpose: an audit is answered through the WhatsApp Flow or by
 * phone with an auditor, never edited afterwards.
 */

interface AuditRow {
    id: string;
    round_id: string | null;
    round_name: string | null;
    channel: "whatsapp" | "call";
    audit_date: string | null;
    submitted_at: string;
    audited_by_name: string | null;
    review_status: string;
    [key: string]: any;
}

const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
    }) : "—";

export const FranchiseAudits = () => {
    const { toast } = useToast();
    const { t, tr } = useLanguage();
    const [audits, setAudits] = useState<AuditRow[]>([]);
    const [pending, setPending] = useState<{ round_name: string; sent_at: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [openId, setOpenId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.get("/vendor/audits")
            .then(res => {
                if (cancelled) return;
                setAudits(res.data.audits || []);
                setPending(res.data.pending || null);
                // Open the most recent one; it is usually the reason for looking.
                if (res.data.audits?.length) setOpenId(res.data.audits[0].id);
            })
            .catch(error => {
                if (cancelled) return;
                toast({
                    title: t("Could not load your audits"),
                    description: getErrorMessage(error, t("Please try again in a moment")),
                    variant: "destructive",
                });
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [toast, t]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px] gap-3 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                <span className="text-sm font-medium">{t("Loading your audits…")}</span>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-2xl font-black tracking-tight text-slate-800 uppercase">{t("Audit & Compliance")}</h2>
                <p className="text-sm text-slate-500 mt-1">
                    {t("The store audits you have completed, and what you answered.")}
                </p>
            </div>

            {/* An audit that is currently being asked for. Shown first, because a
                store looking at this page is usually here to act on it. */}
            {pending && (
                <div className="rounded-3xl border border-amber-200 bg-amber-50/60 p-5 flex items-start gap-4">
                    <div className="h-11 w-11 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
                        <Clock className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-black text-amber-800 uppercase tracking-tight">{t("Audit pending")}</p>
                        <p className="text-[13px] text-amber-700/90 mt-1 leading-relaxed">
                            {tr(`An audit was sent to your WhatsApp on ${fmt(pending.sent_at)} and has not been answered yet. Open the message and complete the form — it takes a couple of minutes.`,
                                `${fmt(pending.sent_at)} को आपके WhatsApp पर एक ऑडिट भेजा गया था, जिसका जवाब अभी नहीं दिया गया। मैसेज खोलें और फ़ॉर्म भरें — इसमें बस दो मिनट लगते हैं।`)}
                        </p>
                    </div>
                </div>
            )}

            {audits.length === 0 ? (
                <div className="rounded-[32px] border border-dashed border-orange-200 bg-white/40 p-12 text-center">
                    <div className="h-20 w-20 bg-orange-50 rounded-[28px] flex items-center justify-center mx-auto mb-6 border border-orange-100">
                        <ClipboardCheck className="h-9 w-9 text-orange-500 opacity-80" />
                    </div>
                    <h3 className="text-xl font-black tracking-tight text-slate-800 uppercase mb-2">
                        {t("No audits yet")}
                    </h3>
                    <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
                        {t("When you complete a store audit on WhatsApp, your answers will appear here so you always have a record of what was submitted.")}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {audits.map(a => {
                        const open = openId === a.id;
                        return (
                            <div key={a.id} className="rounded-3xl border border-slate-100 bg-white overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setOpenId(open ? null : a.id)}
                                    className="w-full flex items-center justify-between gap-3 p-5 text-left hover:bg-orange-50/40 transition-colors"
                                >
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className="h-11 w-11 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                                            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-slate-800 truncate">
                                                {a.round_name || t("Store audit")}
                                            </p>
                                            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-400 font-medium">
                                                <span className="flex items-center gap-1">
                                                    {a.channel === "call"
                                                        ? <><Phone className="h-3 w-3" /> {t("By phone")}</>
                                                        : <><MessageCircle className="h-3 w-3" /> WhatsApp</>}
                                                </span>
                                                <span>·</span>
                                                <span>{fmt(a.submitted_at)}</span>
                                                {a.channel === "call" && a.audited_by_name && (
                                                    <><span>·</span><span>{tr(`with ${a.audited_by_name}`, `${a.audited_by_name} के साथ`)}</span></>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {(() => {
                                            const sc = scoreAudit(a);
                                            return (
                                                <span
                                                    title={`${sc.earned} / ${sc.total}`}
                                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-black tabular-nums ${BAND_META[sc.band].cls}`}
                                                >
                                                    <span className={`h-1.5 w-1.5 rounded-full ${BAND_META[sc.band].dot}`} />
                                                    {sc.earned}/{sc.total}
                                                </span>
                                            );
                                        })()}
                                        <Badge variant="secondary" className="hidden sm:inline-flex bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-black uppercase">
                                            {t("Submitted")}
                                        </Badge>
                                        {open
                                            ? <ChevronUp className="h-4 w-4 text-slate-400" />
                                            : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                    </div>
                                </button>

                                {open && (
                                    <div className="border-t border-slate-100 p-5 space-y-5 bg-slate-50/40">
                                        {/* What the score was, and which answers cost marks — a store
                                            asking "why 70?" should not have to work it out. */}
                                        {(() => {
                                            const sc = scoreAudit(a);
                                            const lost = sc.breakdown.filter(b => b.earned < b.marks);
                                            return (
                                                <div className={`rounded-2xl border p-4 ${BAND_META[sc.band].cls}`}>
                                                    <p className="text-[10px] font-black uppercase tracking-widest opacity-70">
                                                        {t("Your score")}
                                                    </p>
                                                    <p className="text-3xl font-black tabular-nums leading-tight mt-1">
                                                        {sc.earned}<span className="text-lg opacity-50"> / {sc.total}</span>
                                                    </p>
                                                    {lost.length > 0 ? (
                                                        <div className="mt-3">
                                                            <p className="text-[11px] font-bold opacity-75 mb-1.5">
                                                                {t("Marks lost on:")}
                                                            </p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {lost.map(b => (
                                                                    <span key={b.key} className="text-[10px] font-bold bg-white/70 rounded px-1.5 py-0.5">
                                                                        {b.label} 0/{b.marks}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <p className="text-[12px] font-bold opacity-80 mt-2">
                                                            {t("Full marks on every question.")}
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })()}

                                        {AUDIT_SECTIONS.map(section => {
                                            const qs = AUDIT_QUESTIONS.filter(q => q.section === section);
                                            // Only what this store actually answered.
                                            const answered = qs.filter(q => {
                                                const v = a[q.key as AuditFieldKey];
                                                return v !== null && v !== undefined && String(v).trim() !== "";
                                            });
                                            if (answered.length === 0) return null;
                                            return (
                                                <div key={section}>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-orange-400/90 mb-2">
                                                        {section}
                                                    </p>
                                                    <div className="space-y-2">
                                                        {answered.map(q => (
                                                            <div key={q.key} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4 py-2 border-b border-slate-100 last:border-0">
                                                                <p className="text-[12px] text-slate-500 sm:max-w-[55%]">{q.label}</p>
                                                                <p className="text-[13px] font-bold text-slate-800 sm:text-right">
                                                                    {auditLabel(q.key as AuditFieldKey, String(a[q.key as AuditFieldKey]))}
                                                                </p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
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
