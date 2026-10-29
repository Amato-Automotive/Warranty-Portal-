import { useEffect, useMemo, useRef, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { PRODUCTS, SOURCE_LABEL, phoneTail, type AsmLead, type FollowUp, type FollowUpChannel } from "@/lib/asmLeads";
import { FollowUpBadge, FollowUpDialog, FollowUpLog } from "./LeadFollowUp";
import { Calendar, Car, ChevronRight, ClipboardCheck, Hash, Inbox, Loader2, MapPin, MessageCircle, Package, Phone, Radio, RefreshCw, Search, X } from "lucide-react";

/**
 * The leads routed to this ASM. A dense list that stays usable at hundreds of
 * leads: filter by period, product and whether they have been contacted,
 * search, and rows are rendered a page at a time.
 *
 * The ASM logs each contact with a customer (LeadFollowUp). Coming back from
 * the Call or WhatsApp button asks how it went, so the log fills itself in
 * without being a chore; head office sees the same log on the lead.
 */

type Period = "all" | "today" | "week" | "month";
const PERIODS: { id: Period; label: string }[] = [
    { id: "all", label: "All time" },
    { id: "today", label: "Today" },
    { id: "week", label: "Last 7 days" },
    { id: "month", label: "This month" },
];
const PAGE = 50;

type Contact = "all" | "not" | "done";
const CONTACTS: { id: Contact; label: string }[] = [
    { id: "all", label: "Contacted or not" },
    { id: "not", label: "Not contacted" },
    { id: "done", label: "Contacted" },
];

const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const inPeriod = (iso: string, period: Period) => {
    if (period === "all") return true;
    const day = istDay(new Date(iso));
    const today = istDay(new Date());
    if (period === "today") return day === today;
    if (period === "month") return day.slice(0, 7) === today.slice(0, 7);
    return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`) <= 6 * 86_400_000;
};

/** "3:15 pm", "Yesterday", or "5 Oct". */
const received = (iso: string) => {
    const d = new Date(iso);
    const day = istDay(d);
    if (day === istDay(new Date())) return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
    if (day === istDay(new Date(Date.now() - 86_400_000))) return "Yesterday";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};

const AVATAR = ["bg-orange-500", "bg-blue-500", "bg-purple-500", "bg-emerald-500", "bg-rose-500", "bg-amber-500"];
const avatarFor = (seed: string) => AVATAR[[...seed].reduce((t, c) => t + c.charCodeAt(0), 0) % AVATAR.length];

const fullWhen = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
        weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
    });

/** Every detail of one lead, with the two ways to reach the customer. */
const LeadDetail = ({ lead, onReach, onLog }: { lead: AsmLead; onReach: (channel: FollowUpChannel) => void; onLog: () => void }) => {
    const tail = phoneTail(lead.customer_phone);
    const rows: { icon: typeof Phone; label: string; value: string | null; mono?: boolean }[] = [
        { icon: Phone, label: "Mobile", value: tail ? `+91 ${tail.slice(0, 5)} ${tail.slice(5)}` : null, mono: true },
        { icon: Package, label: "Product", value: lead.product },
        { icon: Car, label: "Car", value: lead.car_model },
        { icon: MapPin, label: "Area", value: lead.raw_area || lead.matched_area },
        { icon: Hash, label: "Pincode", value: lead.pincode, mono: true },
        { icon: MapPin, label: "State", value: lead.state },
        { icon: Radio, label: "Came via", value: (lead.source && SOURCE_LABEL[lead.source]) || lead.source },
        { icon: Calendar, label: "Received", value: fullWhen(lead.created_at) },
    ];
    return (
        <div className="space-y-4">
            <dl className="rounded-2xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
                {rows.map(r => (
                    <div key={r.label} className="flex items-start gap-3 px-4 py-3">
                        <r.icon className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                        <dt className="w-24 shrink-0 text-sm text-slate-500">{r.label}</dt>
                        <dd className={cn("flex-1 min-w-0 text-sm font-semibold text-slate-800 break-words", r.mono && "font-mono")}>
                            {r.value || <span className="text-slate-300 font-normal">—</span>}
                        </dd>
                    </div>
                ))}
            </dl>
            {tail && (
                <div className="grid grid-cols-2 gap-3">
                    <a href={`tel:+91${tail}`} onClick={() => onReach("call")}
                        className="h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-2 active:scale-95 transition">
                        <Phone className="h-4 w-4" /> Call
                    </a>
                    <a href={`https://wa.me/91${tail}`} target="_blank" rel="noopener noreferrer" onClick={() => onReach("whatsapp")}
                        className="h-12 rounded-2xl bg-green-500 hover:bg-green-600 text-white font-bold flex items-center justify-center gap-2 active:scale-95 transition">
                        <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                </div>
            )}
            <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-800">Your follow-ups</h3>
                    <button type="button" onClick={onLog}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-100">
                        <ClipboardCheck className="h-3.5 w-3.5" /> Log a contact
                    </button>
                </div>
                <FollowUpLog followups={lead.followups ?? []} />
            </div>
        </div>
    );
};

const COLS = "md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.3fr)_96px_100px_92px] md:items-center md:gap-4";

export const AsmLeads = () => {
    const [leads, setLeads] = useState<AsmLead[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const [period, setPeriod] = useState<Period>("all");
    const [product, setProduct] = useState<string>("all");
    const [search, setSearch] = useState("");
    const [shown, setShown] = useState(PAGE);
    const [openLead, setOpenLead] = useState<AsmLead | null>(null);
    const [contact, setContact] = useState<Contact>("all");
    const [logging, setLogging] = useState<{ lead: AsmLead; channel?: FollowUpChannel } | null>(null);
    /* The lead whose Call / WhatsApp button was just tapped: asked about when the ASM comes back. */
    const reaching = useRef<{ lead: AsmLead; channel: FollowUpChannel } | null>(null);
    const isMobile = useIsMobile();

    const askTimer = useRef<number>();

    // Back from the dialer or WhatsApp: ask how it went.
    const ask = useRef(() => {
        const r = reaching.current;
        if (!r || document.visibilityState !== "visible") return;
        window.clearTimeout(askTimer.current);
        reaching.current = null;
        setOpenLead(null);
        setLogging(r);
    }).current;

    const reach = (lead: AsmLead, channel: FollowUpChannel) => {
        reaching.current = { lead, channel };
        // A desktop with no dialer never leaves the page, so ask after a moment there too.
        window.clearTimeout(askTimer.current);
        askTimer.current = window.setTimeout(() => { if (document.hasFocus()) ask(); }, 2500);
    };

    useEffect(() => {
        document.addEventListener("visibilitychange", ask);
        window.addEventListener("focus", ask);
        return () => {
            window.clearTimeout(askTimer.current);
            document.removeEventListener("visibilitychange", ask);
            window.removeEventListener("focus", ask);
        };
    }, [ask]);

    const saved = (leadId: string, followups: FollowUp[], followup: AsmLead["followup"]) => {
        setLeads(list => list.map(l => l.id === leadId ? { ...l, followups, followup } : l));
        setOpenLead(o => o && o.id === leadId ? { ...o, followups, followup } : o);
    };

    const load = async (silent = false) => {
        if (silent) setRefreshing(true);
        else setLoading(true);
        setError("");
        try {
            const res = await api.get("/asm-portal/leads");
            setLeads(res.data.leads || []);
        } catch (e) {
            setError(getErrorMessage(e, "Could not load your leads"));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => { load(); }, []);
    useEffect(() => { setShown(PAGE); }, [period, product, search, contact]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return leads.filter(l =>
            inPeriod(l.created_at, period)
            && (product === "all" || l.product === product)
            && (contact === "all" || (contact === "done") === Boolean(l.followup))
            && (!q || [l.customer_name, l.customer_phone, l.matched_area, l.raw_area, l.pincode, l.car_model, l.state]
                .some(v => (v || "").toLowerCase().includes(q))));
    }, [leads, period, product, search, contact]);

    const filtered = period !== "all" || product !== "all" || contact !== "all" || !!search.trim();
    const notContacted = leads.filter(l => !l.followup).length;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                <span className="text-sm font-medium">Loading your leads…</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-6 text-center text-sm text-rose-700">
                {error} <button onClick={() => load()} className="font-bold underline ml-1">Try again</button>
            </div>
        );
    }

    return (
        <div className="space-y-5 animate-in fade-in duration-300">
            {/* Toolbar */}
            <div className="flex flex-col md:flex-row gap-2">
                <div className="relative flex-1 md:max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search name, number, area, car…"
                        className="h-11 pl-9 pr-8 rounded-xl border-slate-200 bg-white"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Clear search">
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
                <div className="flex gap-2">
                    <Select value={period} onValueChange={v => setPeriod(v as Period)}>
                        <SelectTrigger className="h-11 flex-1 md:w-44 rounded-xl border-slate-200 bg-white text-sm font-semibold"><SelectValue /></SelectTrigger>
                        <SelectContent className="rounded-xl">
                            {PERIODS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={product} onValueChange={setProduct}>
                        <SelectTrigger className="h-11 flex-1 md:w-44 rounded-xl border-slate-200 bg-white text-sm font-semibold"><SelectValue /></SelectTrigger>
                        <SelectContent className="rounded-xl">
                            <SelectItem value="all">All products</SelectItem>
                            {PRODUCTS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={contact} onValueChange={v => setContact(v as Contact)}>
                        <SelectTrigger className="h-11 flex-1 md:w-48 rounded-xl border-slate-200 bg-white text-sm font-semibold"><SelectValue /></SelectTrigger>
                        <SelectContent className="rounded-xl">
                            {CONTACTS.map(c => <SelectItem key={c.id} value={c.id}>{c.label}{c.id === "not" ? ` (${notContacted})` : ""}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <button
                        onClick={() => load(true)}
                        disabled={refreshing}
                        aria-label="Refresh"
                        className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:text-orange-600 hover:border-orange-200 transition-colors"
                    >
                        <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                    </button>
                </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span><b className="text-slate-700 tabular-nums">{visible.length}</b> lead{visible.length === 1 ? "" : "s"}{filtered && ` of ${leads.length}`}</span>
                {filtered && (
                    <button onClick={() => { setPeriod("all"); setProduct("all"); setContact("all"); setSearch(""); }} className="font-semibold text-orange-600 hover:underline">
                        Clear filters
                    </button>
                )}
            </div>

            {visible.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-orange-200 bg-white/60 py-16 px-6 text-center">
                    <Inbox className="h-8 w-8 text-orange-400 mx-auto mb-3" />
                    <p className="text-base font-bold text-slate-700">{leads.length === 0 ? "No leads yet" : "No leads match"}</p>
                    <p className="text-xs text-slate-500 mt-1">
                        {leads.length === 0 ? "Enquiries from your areas will appear here." : "Try another period, product or search."}
                    </p>
                </div>
            ) : (
                <div className="rounded-3xl border border-orange-100 bg-white overflow-hidden shadow-sm">
                    {/* Column heads — desktop */}
                    <div className={cn("hidden px-5 py-3 bg-slate-50/80 border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400", COLS)}>
                        <span>Customer</span><span>Product</span><span>Car</span><span>Area</span><span>Source</span><span>Received</span><span />
                    </div>

                    <ul className="divide-y divide-slate-100">
                        {visible.slice(0, shown).map((l, i) => {
                            const name = l.customer_name?.trim() || "Customer";
                            const tail = phoneTail(l.customer_phone);
                            const area = l.matched_area || l.raw_area || l.state || "—";
                            const fresh = Date.now() - Date.parse(l.created_at) < 86_400_000;
                            return (
                                <li
                                    key={l.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setOpenLead(l)}
                                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenLead(l); } }}
                                    aria-label={`Open details for ${name}`}
                                    style={{ animationDelay: `${Math.min(i, 15) * 20}ms` }}
                                    className={cn("cursor-pointer active:bg-orange-50 flex items-center gap-3 px-4 md:px-5 py-4 hover:bg-orange-50/40 transition-colors animate-in fade-in duration-300 fill-mode-both", COLS)}
                                >
                                    {/* Customer */}
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <span className={cn("h-10 w-10 shrink-0 rounded-xl text-white text-sm font-black flex items-center justify-center", avatarFor(l.id))}>
                                            {name.charAt(0).toUpperCase()}
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[15px] font-bold text-slate-800 truncate flex items-center gap-1.5">
                                                <span className="truncate">{name}</span>
                                                {fresh && <span className="h-1.5 w-1.5 rounded-full bg-orange-500 shrink-0" title="Last 24 hours" />}
                                            </p>
                                            <p className="text-xs font-mono text-slate-400 truncate hidden md:block mt-0.5">{tail}</p>
                                            <FollowUpBadge lead={l} className="mt-1" />
                                            {/* Phone: the rest of the row collapses into one line */}
                                            <p className="text-xs text-slate-500 truncate md:hidden mt-0.5">
                                                {[l.product, l.car_model, area].filter(Boolean).join(" · ")}
                                            </p>
                                        </div>
                                    </div>

                                    <span className="hidden md:block text-sm text-slate-600 truncate">{l.product || "—"}</span>
                                    <span className="hidden md:block text-sm text-slate-600 truncate">{l.car_model || "—"}</span>
                                    <span className="hidden md:block text-sm text-slate-600 truncate" title={area}>
                                        {area}{l.pincode && !area.includes(l.pincode) && <span className="text-slate-400 font-mono text-xs"> · {l.pincode}</span>}
                                    </span>
                                    <span className="hidden md:block text-xs text-slate-500 truncate">{(l.source && SOURCE_LABEL[l.source]) || l.source || "—"}</span>
                                    <span className="text-xs md:text-sm font-semibold text-slate-400 md:text-slate-500 shrink-0 tabular-nums">{received(l.created_at)}</span>

                                    <div className="flex items-center gap-1.5 shrink-0 md:justify-end" onClick={e => e.stopPropagation()}>
                                        {tail && (
                                            <>
                                                <a href={`tel:+91${tail}`} aria-label={`Call ${name}`} onClick={() => reach(l, "call")}
                                                    className="h-10 w-10 rounded-xl flex items-center justify-center text-emerald-600 bg-emerald-50/60 hover:bg-emerald-100 active:scale-90 transition">
                                                    <Phone className="h-4 w-4" />
                                                </a>
                                                <a href={`https://wa.me/91${tail}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${name}`} onClick={() => reach(l, "whatsapp")}
                                                    className="h-10 w-10 rounded-xl flex items-center justify-center text-green-600 bg-green-50/60 hover:bg-green-100 active:scale-90 transition">
                                                    <MessageCircle className="h-4 w-4" />
                                                </a>
                                            </>
                                        )}
                                        <ChevronRight className="h-4 w-4 text-slate-300 md:hidden" />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    {visible.length > shown && (
                        <button
                            onClick={() => setShown(n => n + PAGE)}
                            className="w-full py-4 text-sm font-bold text-orange-600 hover:bg-orange-50 border-t border-slate-100 transition-colors"
                        >
                            Show more · {visible.length - shown} left
                        </button>
                    )}
                </div>
            )}

            {isMobile ? (
                <Drawer open={!!openLead} onOpenChange={o => { if (!o) setOpenLead(null); }}>
                    <DrawerContent className="rounded-t-[28px] max-h-[90vh]">
                        {openLead && (
                            <div className="overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                                <DrawerHeader className="px-0 text-left">
                                    <DrawerTitle className="text-lg font-black text-slate-900">
                                        {openLead.customer_name?.trim() || "Customer"}
                                    </DrawerTitle>
                                    <DrawerDescription>Lead details</DrawerDescription>
                                </DrawerHeader>
                                <LeadDetail lead={openLead} onReach={c => reach(openLead, c)} onLog={() => { setLogging({ lead: openLead }); setOpenLead(null); }} />
                            </div>
                        )}
                    </DrawerContent>
                </Drawer>
            ) : (
                <Dialog open={!!openLead} onOpenChange={o => { if (!o) setOpenLead(null); }}>
                    <DialogContent className="max-w-md rounded-3xl">
                        {openLead && (
                            <>
                                <DialogHeader>
                                    <DialogTitle className="text-lg font-black">{openLead.customer_name?.trim() || "Customer"}</DialogTitle>
                                    <DialogDescription>Lead details</DialogDescription>
                                </DialogHeader>
                                <LeadDetail lead={openLead} onReach={c => reach(openLead, c)} onLog={() => { setLogging({ lead: openLead }); setOpenLead(null); }} />
                            </>
                        )}
                    </DialogContent>
                </Dialog>
            )}

            <FollowUpDialog lead={logging?.lead ?? null} channel={logging?.channel} onClose={() => setLogging(null)} onSaved={saved} />
        </div>
    );
};
