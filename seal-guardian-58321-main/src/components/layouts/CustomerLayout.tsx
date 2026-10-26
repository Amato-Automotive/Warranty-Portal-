import { useState, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import Header from "@/components/Header";
import { HelpPopover } from "@/components/fms/HelpPopover";
import { Button } from "@/components/ui/button";
import {
    FileText,
    LogOut,
    ChevronLeft,
    ChevronRight,
    User,
    LayoutDashboard,
    ShieldCheck
} from "lucide-react";
import { cn } from "@/lib/utils";

const CustomerLayout = () => {
    const { user, logout, loading } = useAuth();
    const { notifications, unreadCount, markAsRead } = useNotifications();
    const location = useLocation();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    // Calculate Section Updates from notifications (Hidden for Phase 1)
    const dashboardUpdates = notifications.filter(n => !n.is_read && n.type === 'warranty').length;
    const termsUpdates = notifications.filter(n =>
        !n.is_read &&
        n.type === 'system' &&
        (n.title.toLowerCase().includes('terms') || n.message.toLowerCase().includes('terms'))
    ).length;

    // Auto-mark notifications as read when visiting sections
    useEffect(() => {
        if (isActive("/dashboard/customer")) {
            const unreadWarrantyNotifs = notifications.filter(n => !n.is_read && n.type === 'warranty');
            unreadWarrantyNotifs.forEach(n => markAsRead(n.id));
        }
        if (isActive("/terms")) {
            const unreadTermsNotifs = notifications.filter(n =>
                !n.is_read &&
                n.type === 'system' &&
                (n.title.toLowerCase().includes('terms') || n.message.toLowerCase().includes('terms'))
            );
            unreadTermsNotifs.forEach(n => markAsRead(n.id));
        }
    }, [location.pathname, notifications, markAsRead]);

    // Visibility logic: Header shown ONLY when sidebar is collapsed (or on mobile if sidebar hidden)
    const shouldShowHeader = isCollapsed || isMobileOpen === false;

    const isActive = (path: string) => location.pathname === path;

    const navItems = [
        { path: "/dashboard/customer", label: "Dashboard", icon: LayoutDashboard, badge: dashboardUpdates },
        { path: "/dashboard/customer/claims", label: "My Claims", icon: ShieldCheck, badge: 0 },
        { path: "/terms", label: "Terms", icon: FileText, badge: termsUpdates },
    ];

    // Skeleton Loading for the entire layout
    if (loading) {
        return (
            <div className="min-h-screen bg-[#fff2e6] flex overflow-hidden relative">
                {/* Background Glow Blobs */}
                <div className="fixed inset-0 pointer-events-none">
                    <div className="glow-blob glow-blue top-[-10%] left-[-5%] opacity-20" />
                    <div className="glow-blob glow-purple bottom-[-10%] right-[10%] opacity-20" />
                </div>

                <div className="flex-1 flex gap-6 p-6 h-screen overflow-hidden relative z-10">
                    {/* Skeleton Sidebar */}
                    <aside className="hidden md:flex flex-col w-72 lg:w-80 bg-white rounded-[40px] border border-orange-100 shadow-[0_10px_40px_rgba(0,0,0,0.04)] overflow-hidden">
                        {/* Logo Skeleton */}
                        <div className="flex items-center justify-center h-24 px-8 border-b border-orange-50">
                            <div className="h-10 w-32 bg-slate-100 rounded-xl animate-pulse" />
                        </div>
                        {/* Nav Items Skeleton */}
                        <nav className="flex-1 px-4 py-4 space-y-10">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="flex items-center gap-3 px-3 h-12">
                                    <div className="h-10 w-10 rounded-xl bg-slate-100 animate-pulse" />
                                    <div className="h-4 w-24 bg-slate-100 rounded animate-pulse" />
                                </div>
                            ))}
                        </nav>
                        {/* Help Card Skeleton */}
                        <div className="px-3 py-2">
                            <div className="rounded-2xl bg-orange-50/50 border border-orange-100 p-4 space-y-3">
                                <div className="h-3 w-20 bg-orange-100 rounded animate-pulse" />
                                <div className="h-3 w-32 bg-slate-100 rounded animate-pulse" />
                                <div className="h-8 w-full bg-orange-100 rounded-xl animate-pulse" />
                            </div>
                        </div>
                        {/* Profile Skeleton */}
                        <div className="p-3 border-t border-orange-50 space-y-2">
                            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl">
                                <div className="w-10 h-10 rounded-xl bg-orange-100 animate-pulse" />
                                <div className="space-y-1.5">
                                    <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
                                    <div className="h-2 w-20 bg-slate-100 rounded animate-pulse" />
                                </div>
                            </div>
                            <div className="h-10 w-full bg-slate-50 rounded-xl animate-pulse" />
                        </div>
                    </aside>

                    {/* Main Content Skeleton */}
                    <main className="flex-1 flex flex-col bg-white rounded-[40px] shadow-[0_10px_40px_rgba(0,0,0,0.04)] overflow-hidden">
                        {/* Header Skeleton */}
                        <header className="h-20 border-b border-orange-50 px-10 flex items-center justify-between">
                            <div className="space-y-2">
                                <div className="h-6 w-32 bg-slate-100 rounded animate-pulse" />
                                <div className="h-2 w-24 bg-slate-50 rounded animate-pulse" />
                            </div>
                            <div className="flex gap-4">
                                <div className="h-10 w-10 bg-slate-100 rounded-full animate-pulse" />
                            </div>
                        </header>
                        {/* Content Skeleton */}
                        <div className="flex-1 p-8 space-y-6 overflow-auto">
                            <div className="h-12 w-64 bg-slate-100 rounded-xl animate-pulse" />
                            <div className="h-4 w-48 bg-slate-50 rounded animate-pulse" />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {[1, 2].map((i) => (
                                    <div key={i} className="h-44 bg-slate-50 rounded-3xl border border-slate-100 animate-pulse" />
                                ))}
                            </div>
                            <div className="space-y-3 mt-8">
                                {[1, 2, 3, 4].map((i) => (
                                    <div key={i} className="h-16 bg-slate-50 rounded-2xl border border-slate-100 animate-pulse" />
                                ))}
                            </div>
                        </div>
                    </main>
                </div>
            </div>
        );
    }

    // If not a customer, just render the standard header layout
    if (!user || user.role !== 'customer') {
        return (
            <div className="min-h-screen bg-[#030712]">
                <Header className="bg-white/5 backdrop-blur-md border-b border-white/5" />
                <main className="container mx-auto px-4 py-8">
                    <Outlet />
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 md:bg-[#fff2e6] text-slate-800 flex overflow-hidden relative">
            {/* Background Glow Blobs for the entire app */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="glow-blob glow-blue top-[-10%] left-[-5%] opacity-20" />
                <div className="glow-blob glow-purple bottom-[-10%] right-[10%] opacity-20" />
            </div>

            {/* Main Padded Wrapper */}
            <div className="flex-1 flex gap-6 p-0 md:p-2 h-screen overflow-hidden relative z-10">

                {/* Desktop Sidebar Panel */}
                <aside
                    className={cn(
                        "hidden md:flex flex-col bg-white rounded-[40px] border border-orange-100 shadow-[0_10px_40px_rgba(0,0,0,0.04)] overflow-hidden",
                        isCollapsed ? "w-24" : "w-72 lg:w-80",
                        "transition-all duration-500 ease-in-out"
                    )}
                >
                    {/* Logo Section */}
                    <div className={cn(
                        "flex items-center h-24 px-8 border-b border-orange-50 relative",
                        isCollapsed ? "justify-center" : "justify-center"
                    )}>
                        {!isCollapsed && (
                            <Link to="/" className="flex items-center gap-3 animate-in-slide-right">
                                <img
                                    src="/autoform-logo.png"
                                    alt="Autoform"
                                    className="h-10 w-auto"
                                />
                            </Link>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsCollapsed(!isCollapsed)}
                            className={cn(
                                "text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-full transition-colors",
                                isCollapsed ? "relative" : "absolute right-4"
                            )}
                        >
                            {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                        </Button>
                    </div>

                    {/* Navigation Items */}
                    <nav className="flex-1 px-4 py-4 space-y-10 overflow-y-auto custom-scrollbar overflow-x-hidden">
                        {navItems.map((item) => (
                            <Link key={item.path} to={item.path}>
                                <div
                                    className={cn(
                                        "sidebar-item group flex items-center h-12 rounded-2xl transition-all duration-300 cursor-pointer relative",
                                        isCollapsed ? "justify-center px-0" : "px-3 gap-3",
                                        isActive(item.path) ? "sidebar-item-active text-orange-600 border border-orange-100" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                                    )}
                                >
                                    <div className={cn(
                                        "h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-300 relative",
                                        isActive(item.path)
                                            ? "bg-orange-50 text-orange-600 border border-orange-200"
                                            : "bg-slate-100/80 text-slate-400 group-hover:bg-slate-200 group-hover:text-slate-600"
                                    )}>
                                        <item.icon className="h-4 w-4" />
                                        {/* Badge indicator on icon */}
                                        {item.badge > 0 && isCollapsed && (
                                            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-5 w-5 bg-orange-500 text-white text-[9px] font-bold items-center justify-center border-2 border-white">
                                                    {item.badge > 9 ? '9+' : item.badge}
                                                </span>
                                            </span>
                                        )}
                                    </div>
                                    {!isCollapsed && (
                                        <span className="font-bold text-sm tracking-wide animate-in-slide-right flex-1">{item.label}</span>
                                    )}
                                    {/* Badge when expanded */}
                                    {!isCollapsed && item.badge > 0 && (
                                        <span className="flex h-5 min-w-5 items-center justify-center px-1.5 rounded-full bg-orange-500 text-white text-[10px] font-bold animate-in-slide-right">
                                            {item.badge > 99 ? '99+' : item.badge}
                                        </span>
                                    )}

                                    {isCollapsed && (
                                        <div className="absolute left-24 px-4 py-2 bg-white border border-orange-100 text-slate-800 text-xs font-bold rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-300 translate-x-[-10px] group-hover:translate-x-0 whitespace-nowrap z-[100] shadow-xl flex items-center gap-2">
                                            {item.label}
                                            {item.badge > 0 && (
                                                <span className="px-1.5 py-0.5 rounded-full bg-orange-500 text-white text-[9px] font-bold">
                                                    {item.badge}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </Link>
                        ))}
                    </nav>

                    {/* Bottom Card (Help/Premium) */}
                    {!isCollapsed ? (
                        <div className="px-5 py-6 animate-in-slide-right">
                            <div className="group relative rounded-[32px] bg-white border border-orange-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 overflow-hidden transition-all duration-500 hover:shadow-xl hover:shadow-orange-500/5 hover:-translate-y-0.5">
                                <div className="flex items-start justify-between gap-3 mb-4">
                                    <div className="flex-1 space-y-2 pt-1">
                                        <p className="text-[14px] font-black text-[#f46617] uppercase tracking-tight">
                                            Need Help?
                                        </p>
                                        <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                                            We’ve got you covered—day or night. hassle-free support anytime.
                                        </p>
                                    </div>
                                    <div className="relative shrink-0 pt-1">
                                        <img
                                            src="/images/help-character.png"
                                            alt="Help"
                                            className="h-16 w-auto object-contain mix-blend-multiply group-hover:scale-110 transition-transform duration-500"
                                        />
                                    </div>
                                </div>

                                <Button
                                    className="w-full h-11 bg-[#f46617] hover:bg-[#d85512] text-white rounded-2xl text-xs font-bold shadow-lg shadow-orange-500/10 transition-all active:scale-95"
                                    onClick={() => window.open('https://wa.me/917217014601?text=Hi,%20I%20need%20assistance%20with%20my%20warranty.', '_blank')}
                                >
                                    Get Assistance
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="px-4 py-8 flex justify-center animate-in-fade">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-14 w-14 rounded-2xl bg-white border border-orange-100 shadow-sm hover:shadow-md hover:bg-orange-50 transition-all group relative"
                                onClick={() => window.open('https://wa.me/917217014601?text=Hi,%20I%20need%20assistance%20with%20my%20warranty.', '_blank')}
                            >
                                <img
                                    src="/images/help-icon-collapsed.png"
                                    alt="Help"
                                    className="h-10 w-10 object-contain mix-blend-multiply group-hover:scale-110 transition-transform duration-300"
                                />
                                {/* Collapsed Tooltip */}
                                <div className="absolute left-20 px-4 py-2 bg-white border border-orange-100 text-slate-800 text-xs font-bold rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-300 translate-x-[-10px] group-hover:translate-x-0 whitespace-nowrap z-[100] shadow-xl">
                                    Get Assistance
                                </div>
                            </Button>
                        </div>
                    )}

                    {/* Bottom Section: Profile & Logout */}
                    <div className="p-3 border-t border-orange-50 space-y-2">
                        <Link to="/profile">
                            <div className={cn(
                                "flex items-center rounded-2xl bg-slate-50/80 border border-slate-100 transition-all duration-300 hover:border-orange-200 hover:bg-orange-50/50 cursor-pointer",
                                isCollapsed ? "p-2 justify-center" : "p-3 gap-3"
                            )}>
                                <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-600 border border-orange-500/20">
                                    <User className="h-5 w-5" />
                                </div>
                                {!isCollapsed && (
                                    <div className="flex-1 min-w-0 animate-in-slide-right">
                                        <p className="text-sm font-bold truncate text-slate-900 tracking-tight">{user?.name || 'User'}</p>
                                        <p className="text-[9px] text-slate-400 truncate uppercase tracking-wider leading-none mt-0.5 font-semibold">
                                            Verified Customer
                                        </p>
                                    </div>
                                )}
                            </div>
                        </Link>

                        <Button
                            variant="ghost"
                            className={cn(
                                "w-full h-10 transition-all text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl",
                                isCollapsed ? "justify-center px-0" : "justify-start gap-3 px-4"
                            )}
                            onClick={logout}
                        >
                            <LogOut className="h-5 w-5" />
                            {!isCollapsed && <span className="font-semibold text-sm">Sign Out</span>}
                        </Button>
                    </div>
                </aside>

                {/* Content Panel */}
                <div className="flex-1 flex flex-col min-w-0 relative">
                    {/* Main Scrollable Panel */}
                    <main
                        className={cn(
                            "flex-1 w-full bg-white md:border border-orange-100 rounded-none md:rounded-[40px] shadow-none md:shadow-[0_15px_50px_rgba(0,0,0,0.03)] overflow-y-auto custom-scrollbar relative flex flex-col"
                        )}
                    >
                        <div className="hidden md:flex flex-1 p-8 md:p-10 flex-col">
                            <Outlet />
                        </div>
                        {/* Mobile Outlet Wrapper to control padding */}
                        <div className="md:hidden flex-1 flex flex-col pt-16">
                            <Outlet />
                        </div>
                    </main>
                </div>
            </div>

            {/* Mobile Sidebar - Removed floating button, using Header toggle instead */}
            {/* We keep the sidebar code but hide the trigger button. 
                TODO: Connect Header toggle to this sidebar if needed, 
                but currently Header has its own menu. 
            */}

            {/* Mobile normal header - Always shown on mobile now */}
            {!isMobileOpen && (
                <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-orange-100">
                    <div className="flex items-center">
                        <Header className="bg-transparent border-none shadow-none h-16 flex-1" />
                        <div className="pr-3">
                            <HelpPopover />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomerLayout;
