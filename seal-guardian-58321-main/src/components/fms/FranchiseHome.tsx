import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import api from "@/lib/api";
import { Product } from "@/lib/catalogService";
import { Notification } from "@/contexts/NotificationContext";
import { useAuth } from "@/contexts/AuthContext";
import { useB2BCart } from "@/contexts/B2BCartContext";
import { cn } from "@/lib/utils";
import { ClubBadge } from "@/components/schemes/ClubBadge";
import type { Club } from "@/lib/schemes";
import type { LeadsView } from "@/components/fms/FranchiseLeads";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguage } from "@/contexts/LanguageContext";
import {
    ShieldCheck, PhoneCall, Truck, ShoppingCart, BookOpen, Image as ImageIcon, MessageSquareWarning,
    ArrowRight, CheckCircle2, Gift, Megaphone, ChevronDown, ChevronLeft, ChevronRight, Phone, HelpCircle,
} from "lucide-react";

/**
 * The franchise's home (design "A · Workspace", agreed 7 Oct 2026, then made
 * interactive the same day): the store's day, week or month at a glance —
 * every number opens the list behind it — its scheme standing, what is
 * waiting on it (opens right here, with a Call button per customer), quick
 * ways into the other pages, its latest warranties and what is new from
 * Autoform. English or Hindi, from the switch in the top bar.
 *
 * Colours and the sidebar are the app's own; nothing here registers a warranty
 * (hidden from franchises on purpose).
 */

interface RecentWarranty {
    time: string;
    status: string;          // 'success' | 'warning' | 'primary'
    customer?: string;
    registration?: string | null;
    car?: string | null;
    product?: string | null;
    created_at?: string;
}

/** Where a tap on the home leads. Days are IST "YYYY-MM-DD", both included. */
export type HomeTarget =
    | { module: "warranty"; tab?: string; from?: string; to?: string }
    | { module: "leads"; view?: LeadsView }
    | { module: string };

interface FranchiseHomeProps {
    stats: {
        total: number; approved: number; pending: number; manpower: number;
        this_month?: number; last_month?: number; daily?: { day: string; n: number }[];
    };
    recentActivity?: RecentWarranty[];
    onOpen: (target: HomeTarget) => void;
    newProducts?: Product[];
    latestUpdates?: Notification[];
}

interface HomeScheme {
    id: string; title: string; state: string; joined: boolean; has_score: boolean;
    open_window: { start: string; end: string } | null;
    next_window: { start: string; end: string } | null;
    achieved: { score: number; rank: number; of: number; club?: Club | null } | null;
}
interface HomeLead { id: string; customer_name: string | null; customer_phone: string | null; car: string | null; received: string | null; status: string }
interface PendingWarranty { id?: string; uid?: string; customer_name?: string; registration_number?: string; car_make?: string; car_model?: string }
interface ShippedOrder { id: string; distributor_name?: string | null; total_amount?: number | string | null }

/* ---------- Words, in English and Hindi ---------- */

type Period = "today" | "week" | "month";

const T = {
    en: {
        hello: (h: number, name: string) => `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}${name ? `, ${name}` : ""}`,
        periods: { today: "Today", week: "This week", month: "This month" } as Record<Period, string>,
        heading: { today: "Today so far", week: "This week so far", month: (m: string) => `${m} so far` },
        tapHint: "Tap a number to see the list",
        warranties: "Warranties registered",
        leads: "Customer leads",
        won: "Leads won",
        wonTip: "A lead is won when the customer bought from you. The % counts only the leads our team has already called.",
        ofCalled: (r: number) => `${r}% of leads called`,
        notCalled: "Once our team has called",
        more: (n: number, ref: string) => `▲ ${n} more than ${ref}`,
        fewer: (n: number, ref: string) => `▼ ${n} fewer than ${ref}`,
        same: (ref: string) => `Same as ${ref}`,
        ref: { today: "yesterday", week: "last week", month: (m: string) => `this time in ${m}` },
        chartLabel: "Warranties each day",
        points: "points",
        pointsTip: "You earn points on every approved invoice. More points take you to a higher club and a bigger reward. Rank is your place among all stores in the scheme.",
        rank: (r: number) => `Rank #${r}`,
        openTill: (d: string) => `Open till ${d}`,
        opens: (d: string) => `Opens ${d}`,
        noPointsYet: "Your points show here once an invoice is approved.",
        joinToEarn: "Join to start earning points on every invoice.",
        submit: "Submit an invoice",
        join: "Join the scheme",
        waiting: "Waiting on you",
        verifyTitle: (n: number) => `${n} warrant${n === 1 ? "y" : "ies"} to verify`,
        verifyDetail: "Customers are waiting for your approval",
        verifyAll: (n: number) => n === 1 ? "Verify it" : `Verify all ${n}`,
        followTitle: (n: number) => `${n} customer${n === 1 ? "" : "s"} to call back`,
        followDetail: "Our team spoke to them; they are still deciding",
        seeAllFollow: "See them in My Leads",
        orderTitle: (n: number, from: string | null) => n === 1 ? (from ? `Your order from ${from} is on its way` : "Your order is on its way") : `${n} orders are on their way`,
        orderDetail: "Mark it received when it arrives",
        track: "Track in Orders",
        call: "Call",
        caughtUp: "You're all caught up. Nothing is waiting on you right now.",
        customer: "Customer",
        quick: { orders: "Place an order", ecatalogue: "E-Catalogue", posm: "POSM request", grievances: "Raise an issue" },
        recent: "Recent warranties",
        viewAll: "View all",
        cols: ["Customer", "Car · Product", "Registered", "Status"],
        status: { success: "Approved", warning: "Needs correction", primary: "To verify" } as Record<string, string>,
        noWarranties: "No warranties yet.",
        fromAutoform: "From Autoform",
        newLaunch: "New launch",
        inStock: (n: string) => `${n} in stock with your distributor`,
        askStock: "Ask your distributor for stock",
        orderNow: "Order now",
        updates: "Updates",
        seeAll: "See all",
        todayWord: "Today",
        weekDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    hi: {
        hello: (_h: number, name: string) => `नमस्ते${name ? `, ${name}` : ""}`,
        periods: { today: "आज", week: "इस हफ़्ते", month: "इस महीने" } as Record<Period, string>,
        heading: { today: "आज अब तक", week: "इस हफ़्ते अब तक", month: (m: string) => `${m} में अब तक` },
        tapHint: "लिस्ट देखने के लिए नंबर पर टैप करें",
        warranties: "रजिस्टर हुई वारंटी",
        leads: "ग्राहक लीड",
        won: "पक्की हुई लीड",
        wonTip: "लीड पक्की तब होती है जब ग्राहक ने आपसे खरीदा। % सिर्फ़ उन लीड का है जिन्हें हमारी टीम कॉल कर चुकी है।",
        ofCalled: (r: number) => `कॉल की गई लीड का ${r}%`,
        notCalled: "टीम के कॉल के बाद दिखेगा",
        more: (n: number, ref: string) => `▲ ${ref} से ${n} ज़्यादा`,
        fewer: (n: number, ref: string) => `▼ ${ref} से ${n} कम`,
        same: (ref: string) => `${ref} जितनी`,
        ref: { today: "कल", week: "पिछले हफ़्ते", month: (_m: string) => "पिछले महीने इन्हीं दिनों" },
        chartLabel: "हर दिन की वारंटी",
        points: "पॉइंट",
        pointsTip: "हर मंज़ूर इनवॉइस पर पॉइंट मिलते हैं। ज़्यादा पॉइंट से ऊँचा क्लब और बड़ा इनाम। रैंक बताता है कि स्कीम के सभी स्टोर में आप कहाँ हैं।",
        rank: (r: number) => `रैंक #${r}`,
        openTill: (d: string) => `${d} तक खुला`,
        opens: (d: string) => `${d} से खुलेगा`,
        noPointsYet: "इनवॉइस मंज़ूर होते ही आपके पॉइंट यहाँ दिखेंगे।",
        joinToEarn: "जुड़ें और हर इनवॉइस पर पॉइंट कमाएँ।",
        submit: "इनवॉइस जमा करें",
        join: "स्कीम से जुड़ें",
        waiting: "आपके लिए काम",
        verifyTitle: (n: number) => `${n} वारंटी वेरिफ़ाई करनी हैं`,
        verifyDetail: "ग्राहक आपकी मंज़ूरी का इंतज़ार कर रहे हैं",
        verifyAll: (n: number) => n === 1 ? "वेरिफ़ाई करें" : `सभी ${n} वेरिफ़ाई करें`,
        followTitle: (n: number) => `${n} ग्राहकों को फिर से कॉल करें`,
        followDetail: "हमारी टीम ने बात की है; वे अभी सोच रहे हैं",
        seeAllFollow: "मेरी लीड में देखें",
        orderTitle: (n: number, from: string | null) => n === 1 ? (from ? `${from} से आपका ऑर्डर रास्ते में है` : "आपका ऑर्डर रास्ते में है") : `${n} ऑर्डर रास्ते में हैं`,
        orderDetail: "पहुँचने पर 'मिल गया' मार्क करें",
        track: "ऑर्डर में देखें",
        call: "कॉल करें",
        caughtUp: "सब काम पूरा है। अभी कुछ बाकी नहीं।",
        customer: "ग्राहक",
        quick: { orders: "ऑर्डर करें", ecatalogue: "ई-कैटलॉग", posm: "POSM मंगाएँ", grievances: "शिकायत दर्ज करें" },
        recent: "हाल की वारंटी",
        viewAll: "सब देखें",
        cols: ["ग्राहक", "कार · प्रोडक्ट", "तारीख", "स्थिति"],
        status: { success: "मंज़ूर", warning: "सुधार ज़रूरी", primary: "वेरिफ़ाई बाकी" } as Record<string, string>,
        noWarranties: "अभी कोई वारंटी नहीं।",
        fromAutoform: "Autoform की ओर से",
        newLaunch: "नया लॉन्च",
        inStock: (n: string) => `${n} आपके डिस्ट्रीब्यूटर के पास स्टॉक में`,
        askStock: "स्टॉक के लिए डिस्ट्रीब्यूटर से पूछें",
        orderNow: "अभी ऑर्डर करें",
        updates: "अपडेट",
        seeAll: "सब देखें",
        todayWord: "आज",
        weekDays: ["सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"],
    },
};

/* ---------- Dates: the store's clock is IST ---------- */

const DAY = 86_400_000;
const istNow = () => new Date(Date.now() + 5.5 * 3600_000);
const istToday = () => istNow().toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const minDay = (a: string, b: string) => (a < b ? a : b);
const monthName = (day: string, locale: string, style: "long" | "short" = "long") =>
    new Date(`${day.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(locale, { month: style, timeZone: "UTC" });
const fmt = (n: number) => n.toLocaleString("en-IN");
/* "2026-10-14T23:59" → "14 Oct" */
const windowDay = (stamp: string, locale: string) =>
    new Date(`${stamp.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
/* "7 Oct" — or "Today" — for an update's date. */
const updateDate = (iso: string | undefined, locale: string, todayWord: string) => {
    if (!iso) return "";
    const d = new Date(new Date(iso).getTime() + 5.5 * 3600_000);
    return d.toISOString().slice(0, 10) === istToday()
        ? todayWord
        : d.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
};
const productLabel = (p?: string | null) =>
    !p ? null : p.toLowerCase() === "ev" ? "PPF" : p.replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase());

/** The chosen period and the same stretch just before it, both up to today. */
function periodRanges(period: Period) {
    const today = istToday();
    if (period === "today") {
        const y = addDays(today, -1);
        return { cur: { start: today, end: today }, prev: { start: y, end: y } };
    }
    if (period === "week") {
        const monday = addDays(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7));
        return { cur: { start: monday, end: today }, prev: { start: addDays(monday, -7), end: addDays(today, -7) } };
    }
    const first = today.slice(0, 8) + "01";
    const lastOfPrev = addDays(first, -1);
    const prevFirst = lastOfPrev.slice(0, 8) + "01";
    const sameDay = addDays(prevFirst, Number(today.slice(8)) - 1);
    return { cur: { start: first, end: today }, prev: { start: prevFirst, end: minDay(sameDay, lastOfPrev) } };
}
const within = (day: string, r: { start: string; end: string }) => day >= r.start && day <= r.end;

/* The greeting uses the owner's first name, but not a word like "Store" when
   the login is named after the shop rather than a person. */
const NOT_A_NAME = /^(store|shop|franchise|showroom|outlet|autoform|test|admin|car|cars|auto|the|m\/s|ms)$/i;
const greetName = (full?: string | null) => {
    const first = String(full ?? "").trim().split(/\s+/)[0] ?? "";
    if (!first || NOT_A_NAME.test(first) || /\d/.test(first)) return "";
    return first.charAt(0).toUpperCase() + first.slice(1);
};

/* ---------- Pieces ---------- */

function Card({ children, className }: { children: ReactNode; className?: string }) {
    return <section className={cn("rounded-2xl border border-slate-200 bg-white", className)}>{children}</section>;
}

/** A short "?" explanation that opens on tap — tooltips don't work on phones. */
function Tip({ text, dark }: { text: string; dark?: boolean }) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" aria-label="What does this mean?" onClick={e => e.stopPropagation()}
                    className={cn("inline-grid h-7 w-7 place-items-center rounded-full", dark ? "text-slate-400 hover:text-white" : "text-slate-400 hover:text-orange-600")}>
                    <HelpCircle className="h-4 w-4" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 text-sm leading-relaxed text-slate-700" side="top">{text}</PopoverContent>
        </Popover>
    );
}

/** One number for the period against the stretch before it; the whole tile opens its list. */
function Figure({ label, value, diff, refWord, note, tip, onClick, divided, t }: {
    label: string; value: number | null; diff?: number | null; refWord: string; note?: string; tip?: string;
    onClick: () => void; divided?: boolean; t: typeof T["en"];
}) {
    return (
        <div className={cn("relative min-w-0", divided && "sm:border-r sm:border-slate-100 sm:pr-4")}>
            <button type="button" onClick={onClick}
                className="w-full flex flex-col gap-1 rounded-xl p-2 -m-2 text-left hover:bg-orange-50/60 active:bg-orange-50 transition-colors group">
                <span className="text-sm text-slate-500 pr-7">{label}</span>
                <span className="flex items-center gap-1.5">
                    <span className="text-4xl font-bold leading-none tabular-nums text-slate-900">{value === null ? "–" : fmt(value)}</span>
                    <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-orange-500 transition-colors" />
                </span>
                {diff !== null && diff !== undefined ? (
                    <span className={cn("text-sm font-semibold", diff > 0 ? "text-emerald-700" : diff < 0 ? "text-rose-600" : "text-slate-500")}>
                        {diff > 0 ? t.more(diff, refWord) : diff < 0 ? t.fewer(-diff, refWord) : t.same(refWord)}
                    </span>
                ) : note ? <span className="text-sm font-semibold text-slate-500">{note}</span> : <span className="h-5" />}
            </button>
            {tip && <span className="absolute right-0 top-0 sm:right-4"><Tip text={tip} /></span>}
        </div>
    );
}

/* ---------- The home ---------- */

export const FranchiseHome = ({ stats, recentActivity = [], onOpen, newProducts = [], latestUpdates = [] }: FranchiseHomeProps) => {
    const { user } = useAuth();
    const { distributorStock, isFranchise } = useB2BCart();
    const { lang } = useLanguage();
    const [period, setPeriod] = useState<Period>("month");
    const [store, setStore] = useState<string | null>(null);
    const [leads, setLeads] = useState<HomeLead[] | null>(null);
    const [scheme, setScheme] = useState<HomeScheme | null | undefined>(undefined);
    const [shipped, setShipped] = useState<ShippedOrder[]>([]);
    const [toVerify, setToVerify] = useState<PendingWarranty[]>([]);
    const [openTask, setOpenTask] = useState<string | null>(null);
    const [launchIdx, setLaunchIdx] = useState(0);
    const [paused, setPaused] = useState(false);
    const touchX = useRef<number | null>(null);

    const t = T[lang];
    const locale = lang === "hi" ? "hi-IN" : "en-IN";

    // The next new launch every 4 seconds, unless the store is looking at one.
    useEffect(() => {
        if (paused || newProducts.length < 2) return;
        const id = setInterval(() => setLaunchIdx(i => i + 1), 4000);
        return () => clearInterval(id);
    }, [paused, newProducts.length]);

    useEffect(() => {
        let alive = true;
        // Orders on their way: the distributor has shared a docket and the
        // store hasn't marked it received yet. (Status stays "processing" until
        // then — nothing in the app sets "shipped".)
        api.get("/orders/my-orders").then(r => {
            if (alive) setShipped((r.data.orders || []).filter((o: { status: string; docket_id?: string | null }) =>
                o.status === "shipped" || (o.status === "processing" && Boolean(o.docket_id))));
        }).catch(() => undefined);
        if (!isFranchise) return () => { alive = false; };
        api.get("/vendor/leads").then(r => {
            if (!alive) return;
            setLeads(r.data.leads || []);
            setStore(r.data.store?.name ?? null);
        }).catch(() => alive && setLeads([]));
        api.get("/schemes").then(r => {
            if (!alive) return;
            const live: HomeScheme[] = (r.data.schemes || []).filter((s: HomeScheme) => s.state === "live");
            setScheme(live.find(s => s.joined) ?? live[0] ?? null);
        }).catch(() => alive && setScheme(null));
        return () => { alive = false; };
    }, [isFranchise]);

    // The customers behind "to verify", for the list that opens on the home.
    useEffect(() => {
        if (!isFranchise || stats.pending < 1) { setToVerify([]); return; }
        let alive = true;
        api.get("/warranty?status=pending_vendor&page=1&limit=5")
            .then(r => alive && setToVerify(r.data.warranties || []))
            .catch(() => undefined);
        return () => { alive = false; };
    }, [isFranchise, stats.pending]);

    const ranges = useMemo(() => periodRanges(period), [period]);
    const today = istToday();
    const refWord = period === "month" ? t.ref.month(monthName(ranges.prev.start, locale, "short")) : t.ref[period];

    /* Warranties in the period and the stretch before, from the server's per-day counts. */
    const warrantyFigures = useMemo(() => {
        const daily = stats.daily ?? [];
        const sum = (r: { start: string; end: string }) => daily.filter(d => within(d.day, r)).reduce((n, d) => n + d.n, 0);
        const cur = sum(ranges.cur);
        return { cur, diff: cur - sum(ranges.prev) };
    }, [stats.daily, ranges]);

    /* Leads by when they reached the store; won and follow-up are the auditor's outcomes. */
    const leadFigures = useMemo(() => {
        if (!leads) return null;
        const day = (l: HomeLead) => String(l.received ?? "").slice(0, 10);
        const cur = leads.filter(l => within(day(l), ranges.cur));
        const called = cur.filter(l => l.status !== "pending");
        const won = cur.filter(l => l.status === "closed_won").length;
        return {
            count: cur.length,
            diff: cur.length - leads.filter(l => within(day(l), ranges.prev)).length,
            won,
            rate: called.length ? Math.round((won / called.length) * 100) : null,
            followUp: leads.filter(l => l.status === "follow_up"),
        };
    }, [leads, ranges]);

    /* The small bar chart: each day of the month, or each day of this week. */
    const days = useMemo(() => {
        const counts = new Map((stats.daily ?? []).map(d => [d.day, d.n]));
        const out: { day: string; label: string; n: number; today: boolean; future: boolean }[] = [];
        if (period === "month") {
            for (let d = ranges.cur.start; d <= today; d = addDays(d, 1)) {
                out.push({ day: d, label: String(Number(d.slice(8))), n: counts.get(d) ?? 0, today: d === today, future: false });
            }
        } else {
            const monday = periodRanges("week").cur.start;
            for (let i = 0; i < 7; i++) {
                const d = addDays(monday, i);
                out.push({ day: d, label: t.weekDays[i], n: counts.get(d) ?? 0, today: d === today, future: d > today });
            }
        }
        return out;
    }, [stats.daily, period, ranges, today, t]);
    const maxDay = Math.max(1, ...days.map(d => d.n));

    const leadsView = (status?: LeadsView["status"]): LeadsView =>
        period === "month"
            ? { period: "month", status }
            : { period: "custom", from: ranges.cur.start, to: ranges.cur.end, status };

    /* What is waiting on the store; each opens its own short list right here. */
    type Task = { key: string; icon: typeof ShieldCheck; tone: string; title: string; detail: string; body: ReactNode };
    const tasks: Task[] = [];
    if (isFranchise && stats.pending > 0) tasks.push({
        key: "verify", icon: ShieldCheck, tone: "bg-orange-50 text-orange-600",
        title: t.verifyTitle(stats.pending), detail: t.verifyDetail,
        body: (
            <>
                {toVerify.map((w, i) => (
                    <button key={w.uid ?? w.id ?? i} type="button" onClick={() => onOpen({ module: "warranty", tab: "pending" })}
                        className="w-full flex items-center gap-3 min-h-12 py-2 text-left border-t border-slate-100 first:border-t-0 hover:text-orange-700">
                        <span className="flex-1 min-w-0">
                            <span className="block font-medium text-slate-900 truncate">{w.customer_name || t.customer}</span>
                            <span className="block text-xs text-slate-500 truncate">{[w.registration_number, [w.car_make, w.car_model].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                    </button>
                ))}
                <TaskButton onClick={() => onOpen({ module: "warranty", tab: "pending" })}>{t.verifyAll(stats.pending)}</TaskButton>
            </>
        ),
    });
    if (leadFigures && leadFigures.followUp.length > 0) tasks.push({
        key: "follow", icon: PhoneCall, tone: "bg-blue-50 text-blue-600",
        title: t.followTitle(leadFigures.followUp.length),
        detail: leadFigures.followUp.slice(0, 2).map(l => [l.customer_name || t.customer, l.car ? `(${l.car})` : ""].join(" ").trim()).join(" · ") || t.followDetail,
        body: (
            <>
                {leadFigures.followUp.slice(0, 5).map(l => {
                    const phone = String(l.customer_phone ?? "").replace(/\D/g, "");
                    return (
                        <div key={l.id} className="flex items-center gap-3 min-h-12 py-2 border-t border-slate-100 first:border-t-0">
                            <span className="flex-1 min-w-0">
                                <span className="block font-medium text-slate-900 truncate">{l.customer_name || t.customer}</span>
                                <span className="block text-xs text-slate-500 truncate">{l.car || " "}</span>
                            </span>
                            {phone && (
                                <a href={`tel:${phone}`}
                                    className="shrink-0 inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
                                    <Phone className="h-4 w-4" /> {t.call}
                                </a>
                            )}
                        </div>
                    );
                })}
                <TaskButton onClick={() => onOpen({ module: "leads", view: { period: "all", status: "follow" } })}>{t.seeAllFollow}</TaskButton>
            </>
        ),
    });
    if (shipped.length > 0) tasks.push({
        key: "order", icon: Truck, tone: "bg-emerald-50 text-emerald-600",
        title: t.orderTitle(shipped.length, shipped[0]?.distributor_name ?? null), detail: t.orderDetail,
        body: (
            <>
                {shipped.slice(0, 5).map(o => (
                    <div key={o.id} className="flex items-center justify-between gap-3 min-h-12 py-2 border-t border-slate-100 first:border-t-0 text-sm">
                        <span className="text-slate-900 truncate">{o.distributor_name || "—"}</span>
                        {o.total_amount != null && <span className="shrink-0 tabular-nums text-slate-500">₹{fmt(Number(o.total_amount))}</span>}
                    </div>
                ))}
                <TaskButton onClick={() => onOpen({ module: "orders" })}>{t.track}</TaskButton>
            </>
        ),
    });
    // With one thing waiting, it is already open.
    const shownTask = openTask ?? (tasks.length === 1 ? tasks[0].key : null);

    const quick = [
        { label: t.quick.orders, icon: ShoppingCart, go: "orders" },
        { label: t.quick.ecatalogue, icon: BookOpen, go: "ecatalogue" },
        ...(isFranchise ? [{ label: t.quick.posm, icon: ImageIcon, go: "posm" }] : []),
        { label: t.quick.grievances, icon: MessageSquareWarning, go: "grievances" },
    ];

    const stockOf = (id: string) => distributorStock.filter(i => i.product_id === id).reduce((n, i) => n + (i.stock_quantity || 0), 0);
    /* New launches rotate in the box, in-stock ones first; hovering or a finger on it holds the current one. */
    const launches = useMemo(
        () => [...newProducts].sort((a, b) => Number(stockOf(b.id) > 0) - Number(stockOf(a.id) > 0)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [newProducts, distributorStock],
    );
    const launchAt = launches.length ? ((launchIdx % launches.length) + launches.length) % launches.length : 0;
    const launch = launches.length ? launches[launchAt] : null;
    const step = (n: number) => setLaunchIdx(launchAt + n);
    /* The latest five updates as one line each; the full message is on the News page. */
    const updates = latestUpdates.slice(0, 5);

    const now = istNow();
    const firstName = greetName(user?.name);
    const dateLine = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    const heading = period === "month" ? t.heading.month(monthName(today, locale)) : t.heading[period];

    return (
        <div className="flex flex-col gap-6 animate-in fade-in duration-500">
            {/* Greeting */}
            <header className="flex flex-col gap-1.5 min-w-0">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-orange-600">{dateLine}</span>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">{t.hello(now.getUTCHours(), firstName)}</h1>
                {store && <span className="text-[15px] text-slate-500">{store}</span>}
            </header>

            {/* Row 1: the period, and the scheme */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <Card className={cn("p-5 sm:p-6 flex flex-col gap-5", isFranchise && scheme !== null ? "lg:col-span-2" : "lg:col-span-3")}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-col">
                            <h2 className="text-lg font-bold text-slate-900">{heading}</h2>
                            <span className="text-xs text-slate-400">{t.tapHint}</span>
                        </div>
                        <div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Period">
                            {(["today", "week", "month"] as Period[]).map(p => (
                                <button key={p} type="button" onClick={() => setPeriod(p)} aria-pressed={period === p}
                                    className={cn("h-10 rounded-lg px-3.5 text-sm font-semibold transition-colors",
                                        period === p ? "bg-white text-orange-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
                                    {t.periods[p]}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-4">
                        <Figure t={t} label={t.warranties} value={warrantyFigures.cur} diff={warrantyFigures.diff} refWord={refWord} divided={isFranchise}
                            onClick={() => onOpen({ module: "warranty", tab: "all", from: ranges.cur.start, to: ranges.cur.end })} />
                        {isFranchise && <Figure t={t} label={t.leads} value={leadFigures?.count ?? null} diff={leadFigures?.diff ?? null} refWord={refWord} divided
                            onClick={() => onOpen({ module: "leads", view: leadsView() })} />}
                        {isFranchise && <Figure t={t} label={t.won} value={leadFigures?.won ?? null} refWord={refWord} tip={t.wonTip}
                            note={leadFigures?.rate !== null && leadFigures?.rate !== undefined ? t.ofCalled(leadFigures.rate) : t.notCalled}
                            onClick={() => onOpen({ module: "leads", view: leadsView("won") })} />}
                    </div>
                    {/* Warranties each day */}
                    <div className="flex flex-col gap-2" aria-label={t.chartLabel}>
                        <div className="flex items-end gap-1.5 h-[72px]">
                            {days.map(d => (
                                <div key={d.day} title={`${d.label}: ${d.n}`}
                                    className={cn("flex-1 rounded-t",
                                        d.future ? "bg-slate-100" : d.today ? "bg-orange-500" : within(d.day, ranges.cur) ? "bg-orange-300" : "bg-orange-100")}
                                    style={{ height: `${d.future ? 3 : Math.max(d.n ? 8 : 3, (d.n / maxDay) * 100)}%` }} />
                            ))}
                        </div>
                        <div className="flex gap-1.5 text-[11px] text-slate-400 tabular-nums">
                            {days.map(d => (
                                <span key={d.day} className={cn("flex-1 text-center truncate", d.today && "font-semibold text-orange-700")}>
                                    {d.today ? t.todayWord : period === "month" && days.length > 16 && Number(d.label) % 5 !== 1 ? "" : d.label}
                                </span>
                            ))}
                        </div>
                    </div>
                </Card>

                {isFranchise && scheme !== null && (
                    <section className="rounded-2xl bg-slate-900 text-white p-6 flex flex-col gap-4">
                        {scheme === undefined ? (
                            <div className="flex-1 rounded-xl bg-slate-800 animate-pulse min-h-[180px]" />
                        ) : (
                            <>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-orange-300 truncate">{scheme.title}</span>
                                    {scheme.open_window ? (
                                        <span className="shrink-0 text-xs rounded-full bg-slate-800 px-2.5 py-1 text-slate-200">{t.openTill(windowDay(scheme.open_window.end, locale))}</span>
                                    ) : scheme.next_window ? (
                                        <span className="shrink-0 text-xs rounded-full bg-slate-800 px-2.5 py-1 text-slate-200">{t.opens(windowDay(scheme.next_window.start, locale))}</span>
                                    ) : null}
                                </div>
                                {scheme.joined && scheme.achieved ? (
                                    <>
                                        {scheme.has_score && (
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-6xl font-extrabold leading-none tabular-nums">{fmt(scheme.achieved.score)}</span>
                                                <span className="text-slate-300">{t.points}</span>
                                                <Tip text={t.pointsTip} dark />
                                            </div>
                                        )}
                                        <div className="flex flex-wrap gap-2">
                                            {scheme.achieved.club && <ClubBadge club={scheme.achieved.club} />}
                                            {scheme.has_score && <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">{t.rank(scheme.achieved.rank)}</span>}
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-sm text-slate-300">{scheme.joined ? t.noPointsYet : t.joinToEarn}</p>
                                )}
                                <button type="button" onClick={() => onOpen({ module: "offers" })}
                                    className="mt-auto h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors">
                                    {scheme.joined ? t.submit : t.join} <ArrowRight className="h-4 w-4" />
                                </button>
                            </>
                        )}
                    </section>
                )}
            </div>

            {/* Row 2: waiting on you, and quick actions */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <Card className="lg:col-span-2 px-5 sm:px-6 py-2">
                    <h2 className="text-lg font-bold text-slate-900 mt-4 mb-2">{t.waiting}</h2>
                    {tasks.length ? tasks.map(w => {
                        const open = shownTask === w.key;
                        return (
                            <div key={w.key} className="border-t border-slate-100">
                                <button type="button" onClick={() => setOpenTask(open ? "" : w.key)} aria-expanded={open}
                                    className="w-full flex items-center gap-3.5 py-3.5 text-left group">
                                    <span className={cn("h-11 w-11 shrink-0 rounded-xl grid place-items-center", w.tone)}><w.icon className="h-5 w-5" /></span>
                                    <span className="flex-1 min-w-0">
                                        <span className="block font-semibold text-slate-900">{w.title}</span>
                                        <span className="block text-sm text-slate-500 truncate">{w.detail}</span>
                                    </span>
                                    <ChevronDown className={cn("h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:text-orange-600", open && "rotate-180")} />
                                </button>
                                {open && (
                                    <div className="mb-3 ml-0 sm:ml-[58px] rounded-xl bg-slate-50 px-4 py-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                        {w.body}
                                    </div>
                                )}
                            </div>
                        );
                    }) : (
                        <div className="flex items-center gap-3 border-t border-slate-100 py-4 mb-2 text-sm text-slate-600">
                            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                            {t.caughtUp}
                        </div>
                    )}
                    <div className="h-2" />
                </Card>

                <div className="grid grid-cols-2 gap-3 content-start">
                    {quick.map(q => (
                        <button key={q.go} type="button" onClick={() => onOpen({ module: q.go })}
                            className="rounded-2xl border border-slate-200 bg-white p-4 min-h-[104px] flex flex-col justify-between gap-3 text-left hover:border-orange-300 hover:bg-orange-50/40 active:bg-orange-50 transition-colors">
                            <q.icon className="h-[22px] w-[22px] text-orange-600" />
                            <span className="text-sm font-semibold text-slate-900">{q.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Row 3: recent warranties, and news from Autoform */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <Card className={cn("px-5 sm:px-6 py-5 min-w-0", (launch || updates.length) ? "lg:col-span-2" : "lg:col-span-3")}>
                    <div className="flex items-baseline justify-between mb-2">
                        <h2 className="text-lg font-bold text-slate-900">{t.recent}</h2>
                        <button type="button" onClick={() => onOpen({ module: "warranty", tab: "all" })} className="h-10 text-sm font-semibold text-orange-600 hover:text-orange-700">{t.viewAll}</button>
                    </div>
                    {recentActivity.length ? (
                        <>
                            {/* Phones: one line per customer */}
                            <ul className="sm:hidden divide-y divide-slate-100">
                                {recentActivity.map((w, i) => (
                                    <li key={i} className="py-3 flex items-start justify-between gap-3">
                                        <span className="min-w-0">
                                            <span className="block font-semibold text-slate-900 truncate">{w.customer || t.customer}</span>
                                            <span className="block text-xs text-slate-500 truncate">{[w.car, productLabel(w.product)].filter(Boolean).join(" · ") || w.registration || "—"}</span>
                                            <span className="block text-xs text-slate-400">{w.time}</span>
                                        </span>
                                        <StatusPill status={w.status} label={t.status[w.status] ?? t.status.primary} />
                                    </li>
                                ))}
                            </ul>
                            {/* Wider screens: the table */}
                            <div className="hidden sm:block overflow-x-auto">
                                <table className="w-full text-sm min-w-[520px]">
                                    <thead>
                                        <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                                            <th className="py-2.5 pr-3 font-medium">{t.cols[0]}</th>
                                            <th className="py-2.5 pr-3 font-medium">{t.cols[1]}</th>
                                            <th className="py-2.5 pr-3 font-medium">{t.cols[2]}</th>
                                            <th className="py-2.5 font-medium text-right">{t.cols[3]}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {recentActivity.map((w, i) => (
                                            <tr key={i} className="align-middle">
                                                <td className="py-3 pr-3">
                                                    <span className="block font-semibold text-slate-900">{w.customer || t.customer}</span>
                                                    {w.registration && <span className="block text-xs text-slate-400">{w.registration}</span>}
                                                </td>
                                                <td className="py-3 pr-3 text-slate-700">{[w.car, productLabel(w.product)].filter(Boolean).join(" · ") || "—"}</td>
                                                <td className="py-3 pr-3 text-slate-500 whitespace-nowrap">{w.time}</td>
                                                <td className="py-3 text-right"><StatusPill status={w.status} label={t.status[w.status] ?? t.status.primary} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    ) : (
                        <p className="py-8 text-center text-sm text-slate-500">{t.noWarranties}</p>
                    )}
                </Card>

                {(launch || updates.length > 0) && (
                    <div className="flex flex-col gap-3 min-w-0">
                        <h2 className="text-lg font-bold text-slate-900 mt-1">{t.fromAutoform}</h2>
                        {launch && (
                            <div className="relative rounded-2xl border border-slate-200 bg-white overflow-hidden hover:border-orange-300 transition-colors"
                                onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
                                onTouchStart={e => { touchX.current = e.touches[0].clientX; setPaused(true); }}
                                onTouchEnd={e => {
                                    const dx = touchX.current === null ? 0 : e.changedTouches[0].clientX - touchX.current;
                                    touchX.current = null;
                                    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
                                    setPaused(false);
                                }}>
                                <button type="button" onClick={() => onOpen({ module: "orders" })} className="block w-full text-left">
                                    <div className="h-40 bg-slate-50 flex items-center justify-center p-3">
                                        {launch.images?.[0]
                                            ? <img key={launch.id} src={launch.images[0]} alt={launch.name} className="h-full w-full object-contain animate-in fade-in duration-500" draggable={false} />
                                            : <Gift className="h-8 w-8 text-slate-300" />}
                                    </div>
                                    <div className="px-4 pt-4 pb-2 flex flex-col gap-1">
                                        <span className="text-xs font-bold uppercase tracking-[0.08em] text-orange-600">{t.newLaunch}</span>
                                        <span className="font-bold text-slate-900 truncate">{launch.name}</span>
                                        <span className={cn("text-sm", stockOf(launch.id) > 0 ? "text-emerald-700" : "text-slate-500")}>
                                            {stockOf(launch.id) > 0 ? t.inStock(fmt(stockOf(launch.id))) : t.askStock}
                                        </span>
                                        <span className="mt-1 text-sm font-semibold text-orange-600">{t.orderNow} →</span>
                                    </div>
                                </button>
                                {launches.length > 1 && (
                                    <>
                                        {/* Arrows for a mouse; a finger swipes */}
                                        <button type="button" onClick={() => step(-1)} aria-label="Previous"
                                            className="absolute left-2 top-[68px] hidden sm:grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow text-slate-600 hover:text-orange-600">
                                            <ChevronLeft className="h-5 w-5" />
                                        </button>
                                        <button type="button" onClick={() => step(1)} aria-label="Next"
                                            className="absolute right-2 top-[68px] hidden sm:grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow text-slate-600 hover:text-orange-600">
                                            <ChevronRight className="h-5 w-5" />
                                        </button>
                                        {/* One dot per product: the box moves on by itself, or jump to one. */}
                                        <div className="flex justify-center gap-1 pb-2">
                                            {launches.map((p, i) => (
                                                <button key={p.id} type="button" onClick={() => setLaunchIdx(i)} aria-label={`Show ${p.name}`}
                                                    className="grid h-6 place-items-center px-0.5">
                                                    <span className={cn("block h-1.5 rounded-full transition-all", i === launchAt ? "w-5 bg-orange-500" : "w-1.5 bg-slate-300")} />
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                        {updates.length > 0 && (
                            <Card className="px-4 py-3">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-bold text-slate-900">{t.updates}</span>
                                    <button type="button" onClick={() => onOpen({ module: "news" })} className="h-9 text-sm font-semibold text-orange-600 hover:text-orange-700">{t.seeAll}</button>
                                </div>
                                <ul className="divide-y divide-slate-100">
                                    {updates.map(u => (
                                        <li key={u.id}>
                                            <button type="button" onClick={() => onOpen({ module: "news" })} className="w-full flex items-center gap-2.5 min-h-11 py-2 text-left group">
                                                <Megaphone className="h-3.5 w-3.5 text-orange-600 shrink-0" />
                                                <span className="flex-1 min-w-0 truncate text-sm text-slate-800 group-hover:text-orange-700">{u.title}</span>
                                                <span className="shrink-0 text-xs text-slate-400">{updateDate(u.created_at, locale, t.todayWord)}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

function TaskButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" onClick={onClick}
            className="mt-1 mb-1 w-full h-11 rounded-xl border border-orange-200 bg-white text-sm font-semibold text-orange-700 hover:bg-orange-50 flex items-center justify-center gap-1.5">
            {children} <ArrowRight className="h-4 w-4" />
        </button>
    );
}

function StatusPill({ status, label }: { status: string; label: string }) {
    return (
        <span className={cn("shrink-0 inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
            status === "success" ? "bg-emerald-50 text-emerald-700"
                : status === "warning" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800")}>
            {label}
        </span>
    );
}
