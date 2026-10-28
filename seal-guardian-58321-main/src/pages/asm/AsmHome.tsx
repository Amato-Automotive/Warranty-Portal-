import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { SidebarItem } from "@/components/fms/DashboardSidebar";
import { ModuleLayout } from "@/components/fms/ModuleLayout";
import { AsmExpenses } from "@/components/asm/AsmExpenses";
import { AsmLeads } from "@/components/asm/AsmLeads";
import { AsmAreas } from "@/components/asm/AsmAreas";
import { AsmStores } from "@/components/asm/AsmStores";
import { AsmProfile, AsmAvatar, type AsmProfileData } from "@/components/asm/AsmProfile";
import api from "@/lib/api";
import { rupees, type BudgetSummary } from "@/lib/asmExpenses";
import { BudgetCard } from "@/components/asm/BudgetCard";
import {
    Loader2, LogOut, Home, Receipt, User, ChevronLeft, ChevronRight, BriefcaseBusiness,
    Inbox, MapPinned, CalendarDays, ArrowUpRight, Store, GraduationCap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The ASM portal, at /asm — the franchise dashboard's shell (sidebar, header,
 * cream canvas) with the ASM's own modules.
 */

type AsmModule = "home" | "leads" | "stores" | "areas" | "expenses" | "profile";

/* "training" is not a module: it opens the training store in its own tab. */
const MENU: { label: string; items: { id: AsmModule | "training"; label: string; icon: LucideIcon; comingSoon?: boolean }[] }[] = [
    { label: "Overview", items: [{ id: "home", label: "Home", icon: Home }] },
    {
        label: "Sales",
        items: [
            { id: "leads", label: "My Leads", icon: Inbox },
            { id: "stores", label: "My Stores", icon: Store },
            { id: "areas", label: "My Areas", icon: MapPinned },
        ],
    },
    { label: "Operations", items: [{ id: "expenses", label: "Expenses", icon: Receipt }] },
    { label: "Learn", items: [{ id: "training", label: "Training Store", icon: GraduationCap }] },
];

const TITLES: Record<AsmModule, string> = {
    home: "Home", leads: "My Leads", stores: "My Stores", areas: "My Areas", expenses: "Expenses", profile: "My Profile",
};

/** The numbers on Home and the sidebar badge. */
interface Summary {
    leads: { total: number; today: number; week: number; this_month: number };
    areas: number;
    stores: number;
    claims: { pending: number; amount: number };
}

const AsmHome = () => {
    const { user, loading, logout, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [active, setActive] = useState<AsmModule>("home");
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [profile, setProfile] = useState<AsmProfileData | null>(null);
    const [budget, setBudget] = useState<BudgetSummary | null>(null);

    const loadSummary = useCallback(() => {
        api.get("/asm-portal/summary").then(res => setSummary(res.data)).catch(() => {});
        api.get("/asm-portal/expenses/budget").then(res => setBudget(res.data.budget)).catch(() => {});
    }, []);

    useEffect(() => {
        if (user?.role === "asm") loadSummary();
    }, [user?.role, loadSummary, active]);

    useEffect(() => {
        if (user?.role === "asm") api.get("/asm-portal/profile").then(res => setProfile(res.data.profile)).catch(() => {});
    }, [user?.role]);

    useEffect(() => {
        if (!loading && user?.role !== "asm") navigate("/asm/login", { replace: true });
    }, [user, loading, navigate]);

    // A deactivated ASM is refused by the server on their next request. This
    // page makes few of them, so re-check on focus and every minute — that is
    // what takes them back to the login screen.
    useEffect(() => {
        const recheck = () => { if (document.visibilityState === "visible") refreshUser(); };
        const timer = setInterval(recheck, 60_000);
        document.addEventListener("visibilitychange", recheck);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", recheck);
        };
        // refreshUser is a new function on every render of AuthProvider.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (loading || user?.role !== "asm") {
        return (
            <div className="flex h-screen bg-[#fffaf5] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </div>
        );
    }

    const signOut = async () => {
        await logout();
        navigate("/asm/login", { replace: true });
    };

    // The saved name wins over the session's copy until the session catches up.
    const displayName = profile?.name ?? user.name;

    const profileChanged = (p: AsmProfileData) => {
        setProfile(p);
        if (p.name !== user.name) refreshUser();
    };

    const go = (id: AsmModule) => {
        setActive(id);
        setMobileOpen(false);
        // Each tab starts at its top, as in any app.
        document.getElementById("main-dashboard-content-area")?.scrollTo({ top: 0, behavior: "smooth" });
    };

    const tabs: { id: AsmModule; label: string; icon: LucideIcon }[] = [
        { id: "home", label: "Home", icon: Home },
        { id: "leads", label: "Leads", icon: Inbox },
        { id: "stores", label: "Stores", icon: Store },
        { id: "expenses", label: "Expenses", icon: Receipt },
        { id: "profile", label: "Profile", icon: User },
    ];
    const tabIndex = Math.max(0, tabs.findIndex(t => t.id === active));
    const newToday = summary?.leads.today ?? 0;

    const nav = (isCollapsed: boolean) => MENU.map(group => (
        <div key={group.label} className={isCollapsed ? "space-y-4" : "space-y-3"}>
            {!isCollapsed && (
                <h2 className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{group.label}</h2>
            )}
            <div className="space-y-2">
                {group.items.map(item => (
                    <SidebarItem
                        key={item.id}
                        icon={item.icon}
                        label={item.label}
                        active={active === item.id}
                        onClick={() => item.id === "training" ? window.open("/training", "_blank") : go(item.id)}
                        isCollapsed={isCollapsed}
                        comingSoon={item.comingSoon}
                        badge={item.id === "leads" && summary?.leads.today ? String(summary.leads.today) : undefined}
                    />
                ))}
            </div>
        </div>
    ));

    const profileChip = (
        <div
            className="flex items-center rounded-2xl bg-slate-50/80 border border-slate-100 transition-all duration-300 hover:border-orange-200 hover:bg-orange-50/50 cursor-pointer p-3 gap-3"
            onClick={() => go("profile")}
        >
            <AsmAvatar name={displayName} photoUrl={profile?.photo_url} className="w-10 h-10 shrink-0 rounded-xl text-sm" />
            <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-slate-800 truncate uppercase mt-0.5">{displayName}</p>
                <p className="text-[10px] font-bold text-orange-500 tracking-tighter truncate uppercase leading-none">ASM Portal</p>
            </div>
        </div>
    );

    const signOutButton = (
        <Button
            variant="ghost"
            className="w-full h-11 justify-start gap-3 px-4 rounded-[32px] transition-all text-slate-400 hover:text-red-500 hover:bg-red-50 group"
            onClick={signOut}
        >
            <LogOut className="h-5 w-5 transition-transform group-hover:scale-110" />
            <span className="font-bold text-xs">Sign Out</span>
        </Button>
    );

    return (
        <div className="flex h-screen bg-[#fffaf5]">
            {/* Desktop sidebar — same frame as the franchise one */}
            <aside
                className={cn(
                    "hidden md:flex bg-white border border-orange-100 flex-col transition-all duration-500 ease-in-out z-50 md:h-[calc(100vh-3rem)] ml-6 my-6 mr-0 rounded-[40px] shadow-[0_15px_50px_rgba(0,0,0,0.03)] shrink-0",
                    collapsed ? "w-20" : "w-72"
                )}
            >
                <div className={cn(
                    "relative flex border-b border-orange-50 shrink-0",
                    collapsed ? "h-32 flex-col items-center justify-center py-4" : "h-24 pr-10 items-center justify-center"
                )}>
                    <div className={cn("flex items-center justify-center w-full", collapsed && "mb-3")}>
                        {collapsed
                            ? <img src="/favicon.png" alt="Logo" className="h-10 w-10 object-contain" />
                            : <img src="/autoform-logo.png" alt="Autoform Logo" className="h-10 object-contain max-w-[160px]" />}
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setCollapsed(c => !c)}
                        className={cn(
                            "h-10 w-10 bg-slate-50 text-slate-400 hover:text-orange-500 transition-all rounded-xl shadow-sm",
                            collapsed ? "relative" : "absolute right-4 top-1/2 -translate-y-1/2"
                        )}
                    >
                        {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                    </Button>
                </div>

                <nav className={cn("flex-1 py-8 overflow-y-auto custom-scrollbar", collapsed ? "px-2 space-y-6" : "px-4 space-y-10")}>
                    {nav(collapsed)}
                </nav>

                <div className="p-3 border-t border-orange-50 space-y-2 shrink-0">
                    {collapsed ? (
                        <>
                            <Tooltip delayDuration={0}>
                                <TooltipTrigger asChild>
                                    <button
                                        className="w-12 h-12 mx-auto flex items-center justify-center rounded-full hover:bg-orange-50 transition-all"
                                        onClick={() => go("profile")}
                                    >
                                        <AsmAvatar name={displayName} photoUrl={profile?.photo_url} className="h-9 w-9 rounded-full text-xs" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="right" sideOffset={15}>My Profile</TooltipContent>
                            </Tooltip>
                            <Tooltip delayDuration={0}>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className="h-12 w-12 mx-auto flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 p-0"
                                        onClick={signOut}
                                    >
                                        <LogOut className="h-6 w-6" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="right" sideOffset={15}>Sign Out</TooltipContent>
                            </Tooltip>
                        </>
                    ) : (
                        <>
                            {profileChip}
                            {signOutButton}
                        </>
                    )}
                </div>
            </aside>

            <div className="flex-1 flex flex-col overflow-hidden relative">
                <ModuleLayout
                    title={TITLES[active]}
                    description={active === "home" ? `Welcome back, ${displayName}` : undefined}
                    roleLabel="ASM"
                    onNavigate={(m: AsmModule) => go(m)}
                    onMenuToggle={() => setMobileOpen(true)}
                >
                    {/* Room for the bottom tab bar on phones */}
                    <div className="pb-28 md:pb-0">
                        {active === "home" && <AsmHomeModule name={displayName} summary={summary} budget={budget} onOpen={go} />}
                        {active === "leads" && <AsmLeads />}
                        {active === "stores" && <AsmStores />}
                        {active === "areas" && <AsmAreas />}
                        {active === "expenses" && <AsmExpenses />}
                        {active === "profile" && (
                            <AsmProfile profile={profile} onChange={profileChanged} onSignOut={signOut} />
                        )}
                    </div>
                </ModuleLayout>
            </div>

            {/* Bottom tab bar — phones only. Thumb-reach navigation, as native apps do. */}
            <nav
                className="md:hidden fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 pointer-events-none animate-in slide-in-from-bottom-full duration-500"
                aria-label="ASM portal"
            >
                <div className="pointer-events-auto relative mx-auto max-w-md grid grid-cols-5 rounded-[26px] bg-white/95 backdrop-blur-xl border border-orange-100 shadow-[0_-8px_40px_rgba(0,0,0,0.08)] p-1.5">
                    {/* Sliding highlight behind the active tab */}
                    <span
                        aria-hidden
                        className="absolute top-1.5 bottom-1.5 rounded-[20px] bg-orange-50 border border-orange-100 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                        style={{ width: "calc((100% - 0.75rem) / 5)", left: `calc(0.375rem + ${tabIndex} * (100% - 0.75rem) / 5)` }}
                    />
                    {tabs.map(t => {
                        const on = active === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => go(t.id)}
                                aria-current={on ? "page" : undefined}
                                className="relative z-10 flex flex-col items-center justify-center gap-0.5 h-14 rounded-[20px] active:scale-90 transition-transform"
                            >
                                <span className="relative">
                                    <t.icon className={cn("h-5 w-5 transition-all duration-300", on ? "text-orange-600 -translate-y-0.5 scale-110" : "text-slate-400")} />
                                    {t.id === "leads" && newToday > 0 && (
                                        <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-black flex items-center justify-center ring-2 ring-white animate-in zoom-in-50 duration-300">
                                            {newToday > 99 ? "99+" : newToday}
                                        </span>
                                    )}
                                </span>
                                <span className={cn("text-[10px] font-black tracking-tight transition-colors", on ? "text-orange-600" : "text-slate-400")}>
                                    {t.label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </nav>

            {/* Mobile menu — same drawer as the franchise dashboard */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetContent side="left" className="w-80 p-0 border-none bg-white rounded-r-[40px] flex flex-col">
                    <SheetHeader className="sr-only">
                        <SheetTitle>Menu</SheetTitle>
                        <SheetDescription>ASM portal navigation</SheetDescription>
                    </SheetHeader>
                    <div className="h-24 flex items-center justify-center border-b border-orange-50 shrink-0">
                        <img src="/autoform-logo.png" alt="Autoform Logo" className="h-10 object-contain max-w-[160px]" />
                    </div>
                    <nav className="flex-1 py-6 px-4 space-y-8 overflow-y-auto custom-scrollbar">{nav(false)}</nav>
                    <div className="p-3 border-t border-orange-50 space-y-2 shrink-0">
                        {profileChip}
                        {signOutButton}
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
};

const greeting = () => {
    const h = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

const AsmHomeModule = ({ name, summary, budget, onOpen }: { name: string; summary: Summary | null; budget: BudgetSummary | null; onOpen: (m: AsmModule) => void }) => {
    const stats: { label: string; value: string; sub: string; icon: LucideIcon; tone: string; to: AsmModule }[] = [
        { label: "Leads today", value: String(summary?.leads.today ?? "–"), sub: `${summary?.leads.week ?? 0} in the last 7 days`, icon: Inbox, tone: "bg-orange-50 text-orange-600", to: "leads" },
        { label: "This month", value: String(summary?.leads.this_month ?? "–"), sub: `${summary?.leads.total ?? 0} leads in total`, icon: CalendarDays, tone: "bg-blue-50 text-blue-600", to: "leads" },
        { label: "Stores", value: String(summary?.stores ?? "–"), sub: "Franchises and distributors", icon: Store, tone: "bg-emerald-50 text-emerald-600", to: "stores" },
        { label: "Claims pending", value: String(summary?.claims.pending ?? "–"), sub: summary ? `${rupees(summary.claims.amount)} awaiting review` : "Expense claims", icon: Receipt, tone: "bg-purple-50 text-purple-600", to: "expenses" },
    ];

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center gap-4 rounded-3xl border border-orange-100 bg-gradient-to-r from-orange-50 to-white p-5">
                <div className="h-12 w-12 shrink-0 rounded-2xl bg-orange-500 text-white flex items-center justify-center shadow-md shadow-orange-200">
                    <BriefcaseBusiness className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                    <p className="text-lg md:text-xl font-black text-slate-900 truncate">{greeting()}, {name.split(" ")[0]}</p>
                    <p className="text-sm text-slate-500">Area Sales Manager</p>
                </div>
            </div>

            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                {stats.map(s => (
                    <button
                        key={s.label}
                        onClick={() => onOpen(s.to)}
                        className="group text-left rounded-3xl border border-orange-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-orange-200 active:scale-[0.98]"
                    >
                        <div className="flex items-center justify-between">
                            <span className={`h-10 w-10 rounded-xl flex items-center justify-center ${s.tone}`}>
                                <s.icon className="h-5 w-5" />
                            </span>
                            <ArrowUpRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-orange-500 transition-colors" />
                        </div>
                        <p className="text-3xl font-black text-slate-900 tabular-nums mt-4 leading-none">{s.value}</p>
                        <p className="text-sm font-bold text-slate-600 mt-2">{s.label}</p>
                        <p className="text-xs text-slate-400 truncate mt-0.5">{s.sub}</p>
                    </button>
                ))}
            </div>

            <BudgetCard budget={budget} compact onOpen={() => onOpen("expenses")} />
        </div>
    );
};

export default AsmHome;
