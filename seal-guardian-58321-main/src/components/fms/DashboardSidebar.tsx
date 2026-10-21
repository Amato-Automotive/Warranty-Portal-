import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
    ShieldCheck,
    ShoppingBag,
    LifeBuoy,
    Users,
    Gift,
    Bell,
    Home,
    ClipboardCheck,
    ClipboardList,
    Target,
    Image as ImageIcon,
    BookOpen,
    ChevronRight,
    ChevronLeft,
    LogOut,
    User,
    PhoneIncoming
}
    from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { Button } from "@/components/ui/button";
import { useB2BCart } from "@/contexts/B2BCartContext";
import { Tx, useLanguage } from "@/contexts/LanguageContext";

import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";

export type FmsModule =
    | 'home'
    | 'warranty'
    | 'leads'
    | 'register'
    | 'orders'
    | 'grievances'
    | 'manpower'
    | 'offers'
    | 'catalogue'
    | 'ecatalogue'
    | 'news'
    | 'audit'
    | 'targets'
    | 'posm'
    | 'terms'
    | 'claim-process'
    | 'profile';

interface SidebarItemProps {
    icon: any;
    label: string;
    active?: boolean;
    onClick: () => void;
    badge?: string;
    comingSoon?: boolean;
    isCollapsed?: boolean;
}

export const SidebarItem = ({ icon: Icon, label: english, active, onClick, badge, comingSoon, isCollapsed }: SidebarItemProps) => {
    const { t } = useLanguage();
    const label = t(english);
    const itemContent = (
        <button
            onClick={onClick}
            disabled={comingSoon}
            className={cn(
                "flex items-center transition-all duration-300 group relative",
                isCollapsed
                    ? "w-12 h-12 mx-auto justify-center"
                    : "w-full h-11 px-3 gap-3 rounded-[32px] border",
                !isCollapsed && (active
                    ? "text-orange-600 bg-orange-50/50 border-orange-100"
                    : "text-slate-500 hover:bg-slate-50 border-transparent"),
                isCollapsed && (active ? "text-orange-600" : "text-slate-400 hover:text-orange-500"),
                comingSoon && "opacity-50 cursor-not-allowed filter grayscale"
            )}
        >
            <div className={cn(
                "flex items-center justify-center shrink-0 transition-all duration-300",
                isCollapsed ? "h-12 w-12" : "h-9 w-9 rounded-xl",
                !isCollapsed && (active
                    ? "bg-orange-100 border border-orange-200 text-orange-600"
                    : "bg-slate-100 text-slate-400 group-hover:text-orange-500 group-hover:bg-orange-50")
            )}>
                <Icon className={cn("transition-transform duration-300", isCollapsed ? "h-6 w-6" : "h-4 w-4", "group-hover:scale-110")} />
            </div>

            {!isCollapsed && (
                <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="font-bold text-xs tracking-tight truncate">{label}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {comingSoon && (
                            <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full font-black uppercase">{t("Soon")}</span>
                        )}
                        {badge && !comingSoon && (
                            <div className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-black text-white shadow-sm ring-2 ring-white">
                                {badge}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {isCollapsed && badge && !comingSoon && (
                <div className="absolute top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-orange-500 text-[8px] font-black text-white shadow-sm ring-1 ring-white">
                    {badge}
                </div>
            )}
        </button>
    );

    if (isCollapsed) {
        return (
            <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                    {itemContent}
                </TooltipTrigger>
                <TooltipContent
                    side="right"
                    sideOffset={15}
                    className="px-4 py-2.5 bg-white border border-orange-100 text-slate-800 text-[10px] font-black uppercase tracking-[0.15em] rounded-2xl shadow-[0_15px_40px_rgba(244,102,23,0.15)] flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-300"
                >
                    <div className="w-1 h-3 bg-orange-500 rounded-full" />
                    {label}
                </TooltipContent>
            </Tooltip>
        );
    }

    return itemContent;
};

interface DashboardSidebarProps {
    activeModule: FmsModule;
    onModuleChange: (module: FmsModule) => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
}

export const menuGroups = [
    {
        label: "Core",
        items: [
            { id: 'home' as const, label: "Home", icon: Home },
            // { id: 'register' as const, label: "Register Warranty", icon: PlusCircle }, // Hidden by request
            { id: 'profile' as const, label: "My Profile", icon: User },
            {
                id: 'warranty' as const,
                label: "Warranty Management",
                icon: ShieldCheck,
            },
            /* Leads this store was sent, and how the auditor's call went. */
            { id: 'leads' as const, label: "My Leads", icon: PhoneIncoming },
        ]
    },
    {
        label: "Operations",
        items: [
            // { // Hidden by request — not public yet
            //     id: 'catalogue' as const,
            //     label: "Product Catalogue",
            //     icon: Box,
            // },
            {
                id: 'ecatalogue' as const,
                label: "E-Catalogue",
                icon: BookOpen,
            },
            {
                id: 'posm' as const,
                label: "POSM Requirements",
                icon: ImageIcon,
            },
            {
                id: 'orders' as const,
                label: "Order Management",
                icon: ShoppingBag,
            },
            {
                id: 'offers' as const,
                label: "Offers & Schemes",
                icon: Gift,
            },
            { id: 'audit' as const, label: "Audit & Compliance", icon: ClipboardCheck },
        ]
    },
    {
        label: "Support",
        items: [
            {
                id: 'news' as const,
                label: "News & Alerts",
                icon: Bell,
            },
            { id: 'grievances' as const, label: "Grievance Redressal", icon: LifeBuoy },
            { id: 'terms' as const, label: "Terms & Conditions", icon: BookOpen },
            { id: 'claim-process' as const, label: "Claim Process", icon: ClipboardList },
        ]
    },
    {
        label: "Team & Performance",
        items: [
            { id: 'manpower' as const, label: "Manpower Control", icon: Users },
            { id: 'targets' as const, label: "Targets & Achievements", icon: Target, comingSoon: true },
        ]
    }
];
export const DashboardSidebar = ({ activeModule, onModuleChange, isCollapsed, onToggleCollapse }: DashboardSidebarProps) => {
    const { logout, user } = useAuth();
    const { notifications } = useNotifications();
    const { isDistributor, isFranchise } = useB2BCart();
    const navigate = useNavigate();

    const getBadgeCount = (type: string | string[]) => {
        const types = Array.isArray(type) ? type : [type];
        return notifications.filter(n => !n.is_read && types.includes(n.type)).length;
    };

    const groupsWithBadges = menuGroups.map(group => ({
        ...group,
        items: group.items.map(item => {
            let badge;
            if (item.id === 'orders') {
                badge = getBadgeCount('order') > 0 ? getBadgeCount('order').toString() : undefined;
            } else if (item.id === 'offers') {
                badge = getBadgeCount('scheme') > 0 ? getBadgeCount('scheme').toString() : undefined;
            } else if (item.id === 'posm') {
                badge = getBadgeCount('posm') > 0 ? getBadgeCount('posm').toString() : undefined;
            } else if (item.id === 'news') {
                badge = getBadgeCount(['alert', 'system']) > 0 ? getBadgeCount(['alert', 'system']).toString() : undefined;
            }
            return { ...item, badge };
        })
    }));

    const filteredGroups = groupsWithBadges.map(group => {
        let items = group.items;

        if (isDistributor && !isFranchise) {
            const franchiseOnly = ['warranty', 'leads', 'register', 'manpower', 'posm', 'offers', 'audit', 'targets'];
            items = items.filter(item => !franchiseOnly.includes(item.id));
        }

        return { ...group, items };
    }).filter(group => group.items.length > 0);

    return (
        <aside
            className={cn(
                "hidden md:flex bg-white border border-orange-100 flex-col transition-all duration-500 ease-in-out z-50 h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] ml-4 md:ml-6 my-4 md:my-6 mr-0 rounded-[40px] shadow-[0_15px_50px_rgba(0,0,0,0.03)] overflow-x-visible shrink-0",
                isCollapsed ? "w-20" : "w-72"
            )}
        >
            {/* Brand Logo & Collapse Toggle */}
            <div className={cn(
                "relative flex border-b border-orange-50 shrink-0",
                isCollapsed ? "h-32 flex-col items-center justify-center py-4" : "h-24 pr-10 items-center justify-center"
            )}>
                <div className={cn(
                    "flex items-center transition-all duration-500",
                    isCollapsed ? "justify-center w-full mb-3" : "justify-center w-full"
                )}>
                    {isCollapsed ? (
                        <img
                            src="/favicon.png"
                            alt="Logo"
                            className="h-10 w-10 object-contain animate-in-fade"
                        />
                    ) : (
                        <img
                            src="/autoform-logo.png"
                            alt="Autoform Logo"
                            className="h-10 object-contain animate-in-fade max-w-[160px]"
                        />
                    )}
                </div>

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onToggleCollapse}
                    className={cn(
                        "h-10 w-10 bg-slate-50 text-slate-400 hover:text-orange-500 transition-all rounded-xl shadow-sm",
                        isCollapsed ? "relative" : "absolute right-4 top-1/2 -translate-y-1/2"
                    )}
                >
                    {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                </Button>
            </div>

            <nav className={cn(
                "flex-1 py-8 custom-scrollbar transition-all duration-300 overflow-y-auto overflow-x-visible",
                isCollapsed ? "px-2 space-y-6" : "px-4 space-y-10"
            )}>
                {filteredGroups.map((group) => (
                    <div key={group.label} className="space-y-4">
                        {!isCollapsed && (
                            <h2 className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 animate-in-fade">
                                <Tx>{group.label}</Tx>
                            </h2>
                        )}
                        <div className="space-y-2">
                            {group.items.map((item) => (
                                <SidebarItem
                                    key={item.id}
                                    icon={item.icon}
                                    label={item.label}
                                    active={activeModule === item.id}
                                    onClick={() => onModuleChange(item.id)}
                                    isCollapsed={isCollapsed}
                                    badge={item.badge}
                                    comingSoon={item.comingSoon}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </nav>

            {/* Profile Section */}
            <div className="p-3 border-t border-orange-50 space-y-2 shrink-0 overflow-visible">
                {isCollapsed ? (
                    <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                            <div
                                className="w-12 h-12 mx-auto flex items-center justify-center cursor-pointer group relative text-orange-600 rounded-full hover:bg-orange-50 transition-all duration-300"
                                onClick={() => onModuleChange('profile')}
                            >
                                <User className="h-6 w-6 transition-transform group-hover:scale-110" />
                            </div>
                        </TooltipTrigger>
                        <TooltipContent
                            side="right"
                            sideOffset={15}
                            className="px-4 py-2.5 bg-white border border-orange-100 text-slate-800 text-[10px] font-black uppercase tracking-[0.15em] rounded-2xl shadow-[0_15px_40px_rgba(244,102,23,0.15)] flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-300"
                        >
                            <div className="w-1 h-3 bg-orange-500 rounded-full" />
                            <Tx>My Profile</Tx>
                        </TooltipContent>
                    </Tooltip>
                ) : (
                    <div className="flex items-center rounded-2xl bg-slate-50/80 border border-slate-100 transition-all duration-300 hover:border-orange-200 hover:bg-orange-50/50 cursor-pointer group p-3 gap-3"
                        onClick={() => onModuleChange('profile')}
                    >
                        <div className="w-10 h-10 shrink-0 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-600 border border-orange-500/20">
                            <User className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0 animate-in-fade">
                            <p className="text-xs font-black text-slate-800 truncate uppercase mt-0.5">{user?.name || <Tx>Partner</Tx>}</p>
                            <p className="text-[10px] font-bold text-orange-500 tracking-tighter truncate uppercase leading-none">
                                {isDistributor && isFranchise
                                    ? <Tx>Distributor / Franchise Dashboard</Tx>
                                    : isDistributor
                                        ? <Tx>Distributor Portal</Tx>
                                        : <Tx>Franchise Portal</Tx>}
                            </p>
                        </div>
                    </div>
                )}

                {isCollapsed ? (
                    <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                className="h-12 w-12 mx-auto flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 p-0"
                                onClick={logout}
                            >
                                <LogOut className="h-6 w-6 transition-transform group-hover:scale-110" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent
                            side="right"
                            sideOffset={15}
                            className="px-4 py-2.5 bg-white border border-red-100 text-slate-800 text-[10px] font-black uppercase tracking-[0.15em] rounded-2xl shadow-[0_15px_40px_rgba(220,38,38,0.15)] flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-300"
                        >
                            <div className="w-1 h-3 bg-red-500 rounded-full" />
                            <Tx>Sign Out</Tx>
                        </TooltipContent>
                    </Tooltip>
                ) : (
                    <Button
                        variant="ghost"
                        className="w-full h-11 justify-start gap-3 px-4 rounded-[32px] transition-all text-slate-400 hover:text-red-500 hover:bg-red-50 group"
                        onClick={logout}
                    >
                        <LogOut className="h-5 w-5 transition-transform group-hover:scale-110" />
                        <span className="font-bold text-xs"><Tx>Sign Out</Tx></span>
                    </Button>
                )}
            </div>
        </aside>
    );
};
