import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
    LogOut,
    ChevronRight,
    ChevronLeft,
    ChevronDown,
    User,
    Crown
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ADMIN_MENU_GROUPS, adminModuleGroup, canSeeAdminModule, type AdminModule } from "./adminModules";
import { useAdminAttention } from "./useAdminAttention";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";


export type { AdminModule } from "./adminModules";

interface SidebarItemProps {
    icon: any;
    label: string;
    active?: boolean;
    onClick: () => void;
    badge?: string;
    isCollapsed?: boolean;
}

const SidebarItem = ({ icon: Icon, label, active, onClick, badge, isCollapsed }: SidebarItemProps) => {
    const item = (
        <button
            onClick={onClick}
            className={cn(
                "w-full flex items-center transition-all duration-300 group relative",
                isCollapsed ? "h-12 px-0 justify-center rounded-2xl" : "h-11 px-3 gap-3 rounded-[32px] hover:translate-x-1",
                active
                    ? "text-orange-600 bg-orange-50 border border-orange-100"
                    : "text-slate-500 hover:bg-slate-50 border border-transparent"
            )}
        >
            <div className={cn(
                "flex items-center justify-center shrink-0 transition-all duration-300",
                isCollapsed ? "h-10 w-10 rounded-xl" : "h-9 w-9 rounded-xl",
                active
                    ? "bg-orange-100 border border-orange-200 text-orange-600"
                    : "bg-slate-100 text-slate-400 group-hover:text-orange-500 group-hover:bg-orange-50"
            )}>
                <Icon className={cn("transition-transform duration-300", isCollapsed ? "h-5 w-5" : "h-4 w-4", "group-hover:scale-110")} />
            </div>

            {!isCollapsed && (
                <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="font-bold text-xs tracking-tight truncate">{label}</span>
                    {badge && (
                        <div className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-black text-white shadow-sm ring-2 ring-white">
                            {badge}
                        </div>
                    )}
                </div>
            )}

            {isCollapsed && badge && (
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
                    {item}
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-white text-slate-700 text-[10px] font-bold uppercase tracking-widest rounded-xl px-4 py-2 border border-orange-100 shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
                    {label}
                </TooltipContent>
            </Tooltip>
        );
    }

    return item;
};

interface AdminSidebarProps {
    activeModule: AdminModule;
    onModuleChange: (module: AdminModule) => void;
    isCollapsed: boolean;
    onToggleCollapse?: () => void;
}


// Extracted Sidebar Content for reuse in Mobile Sheet
export const SidebarContent = ({
    activeModule,
    onModuleChange,
    isCollapsed = false,
    onToggleCollapse
}: AdminSidebarProps) => {
    const { logout, user, hasPermission } = useAuth();
    // Work nobody has picked up yet. This used to count unread notifications
    // of type 'grievance' — a type the server never sends, so it never showed.
    const attention = useAdminAttention();

    const countFor = (id: AdminModule): number =>
        (id === 'grievances' ? attention.grievances
            : id === 'posm' ? attention.posm
            : id === 'vendors' ? attention.franchises
            : id === 'manpower' ? attention.manpower
            : id === 'asm-management' ? attention.asmExpenses
            : 0) || 0;

    const badgeText = (n: number): string | undefined =>
        n <= 0 ? undefined : n > 99 ? '99+' : String(n);

    // Filter groups/items by permission
    const menuGroups = ADMIN_MENU_GROUPS
        .map(group => ({
            ...group,
            items: group.items
                .filter(item => canSeeAdminModule(item.id, user, hasPermission))
                .map(item => ({ ...item, count: countFor(item.id), badge: badgeText(countFor(item.id)) }))
        }))
        .filter(group => group.items.length > 0);

    /*
     * Groups fold to their heading. The one holding the open module is always
     * expanded — including when a module is opened from Ctrl+K or a link — and
     * the rest stay however the admin left them.
     */
    const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
        const g = adminModuleGroup(activeModule);
        return new Set(g ? [g] : []);
    });

    useEffect(() => {
        const g = adminModuleGroup(activeModule);
        if (g) setOpenGroups(prev => (prev.has(g) ? prev : new Set(prev).add(g)));
    }, [activeModule]);

    const toggleGroup = (label: string) =>
        setOpenGroups(prev => {
            const next = new Set(prev);
            if (next.has(label)) next.delete(label); else next.add(label);
            return next;
        });

    return (
        <TooltipProvider>
            <div className="flex flex-col h-full bg-white">
                {/* Brand Logo & Collapse Toggle */}
                <div className="flex h-24 items-center px-6 border-b border-orange-50 justify-between shrink-0">
                    {!isCollapsed && (
                        <div className="flex items-center gap-3 animate-in-fade">
                            <img
                                src="/autoform-logo.png"
                                alt="Autoform"
                                className="h-12 w-auto object-contain"
                            />
                            <div className="min-w-0 hidden">
                                <h1 className="font-black text-lg leading-tight tracking-tight text-slate-800 truncate">Autoform</h1>
                                <p className="text-[10px] uppercase font-bold text-orange-500 tracking-widest leading-none">Admin</p>
                            </div>
                        </div>
                    )}

                    {onToggleCollapse && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onToggleCollapse}
                            className={cn(
                                "h-10 w-10 bg-slate-50 text-slate-400 hover:text-orange-500 transition-all rounded-xl",
                                isCollapsed && "mx-auto"
                            )}
                        >
                            {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                        </Button>
                    )}
                </div>

                {/* Nav Items - Always scrollable now */}
                <nav className={cn("flex-1 px-4 py-8 overflow-y-auto custom-scrollbar", isCollapsed ? "space-y-10" : "space-y-4")}>
                    {menuGroups.map((group) => (
                        <div key={group.label} className="space-y-2">
                            {!isCollapsed && (() => {
                                const open = openGroups.has(group.label);
                                // A folded group still shows that something inside wants attention.
                                const pending = group.items.reduce((n, i) => n + i.count, 0);
                                return (
                                    <button
                                        type="button"
                                        onClick={() => toggleGroup(group.label)}
                                        aria-expanded={open}
                                        className="w-full flex items-center justify-between gap-2 px-4 py-1 rounded-lg text-left text-slate-400 hover:text-slate-600 transition-colors animate-in-fade"
                                    >
                                        <h2 className="min-w-0 truncate whitespace-nowrap text-[10px] font-black uppercase tracking-[0.14em]">
                                            {group.label}
                                        </h2>
                                        <span className="flex shrink-0 items-center gap-2">
                                            {!open && pending > 0 && (
                                                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-black text-white">
                                                    {badgeText(pending)}
                                                </span>
                                            )}
                                            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", !open && "-rotate-90")} />
                                        </span>
                                    </button>
                                );
                            })()}
                            {/* Icon-only mode has no headings to unfold, so every item shows. */}
                            <div className="space-y-2" hidden={!isCollapsed && !openGroups.has(group.label)}>
                                {group.items.map((item: any) => (
                                    <SidebarItem
                                        key={item.id}
                                        icon={item.icon}
                                        label={item.label}
                                        active={activeModule === item.id}
                                        onClick={() => onModuleChange(item.id)}
                                        isCollapsed={isCollapsed}
                                        badge={item.badge}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </nav>

                {/* Profile Section */}
                <div className="p-3 border-t border-orange-50 space-y-2 shrink-0 overflow-visible">
                    <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                            <div
                                onClick={() => onModuleChange('profile')}
                                className={cn(
                                    "flex items-center rounded-2xl bg-slate-50 border border-slate-100 transition-all duration-300 hover:border-orange-200 hover:bg-orange-50 cursor-pointer group relative",
                                    isCollapsed ? "p-2 justify-center" : "p-3 gap-3"
                                )}
                            >
                                <div className="w-10 h-10 shrink-0 rounded-xl bg-slate-900 flex items-center justify-center text-white border border-slate-700">
                                    <User className="h-5 w-5" />
                                </div>
                                {!isCollapsed && (
                                    <div className="flex-1 min-w-0 animate-in-fade">
                                        <p className="text-xs font-black text-slate-800 truncate uppercase mt-0.5">{user?.name || "Administrator"}</p>
                                        <p className="text-[10px] font-bold tracking-tighter truncate uppercase leading-none flex items-center gap-1"
                                            style={{ color: user?.isSuperAdmin ? '#f97316' : '#64748b' }}>
                                            {user?.isSuperAdmin ? (
                                                <><Crown className="h-2.5 w-2.5" />Super Admin</>
                                            ) : 'Admin'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </TooltipTrigger>
                        {isCollapsed && (
                            <TooltipContent side="right" className="bg-white text-slate-700 text-[10px] font-bold uppercase tracking-widest rounded-xl px-4 py-2 border border-orange-100 shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
                                View Profile
                            </TooltipContent>
                        )}
                    </Tooltip>

                    <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                className={cn(
                                    "w-full h-10 transition-all text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-2xl group relative",
                                    isCollapsed ? "justify-center px-0" : "justify-start gap-3 px-4"
                                )}
                                onClick={logout}
                            >
                                <LogOut className="h-5 w-5" />
                                {!isCollapsed && <span className="font-bold text-xs">Sign Out</span>}
                            </Button>
                        </TooltipTrigger>
                        {isCollapsed && (
                            <TooltipContent side="right" className="bg-white text-red-600 text-[10px] font-bold uppercase tracking-widest rounded-xl px-4 py-2 border border-red-100 shadow-[0_10px_40px_rgba(220,38,38,0.08)]">
                                Sign Out
                            </TooltipContent>
                        )}
                    </Tooltip>
                </div>
            </div>
        </TooltipProvider>
    );
};

export const AdminSidebar = (props: AdminSidebarProps) => {
    return (
        <aside
            className={cn(
                "hidden md:flex border border-orange-100 flex-col transition-all duration-500 ease-in-out z-40 h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] ml-4 md:ml-6 my-4 md:my-6 mr-0 rounded-[40px] shadow-[0_15px_50px_rgba(0,0,0,0.03)] overflow-hidden",
                props.isCollapsed ? "w-24" : "w-72"
            )}
        >
            <SidebarContent {...props} />
        </aside>
    );
};
