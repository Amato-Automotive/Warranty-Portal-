import { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardSidebar, FmsModule } from "@/components/fms/DashboardSidebar";
import { ModuleLayout } from "@/components/fms/ModuleLayout";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { LogOut, X } from "lucide-react";
import { Tx } from "@/contexts/LanguageContext";
import { menuGroups, SidebarItem } from "@/components/fms/DashboardSidebar";

const VendorPortalLayout = () => {
    const { user, logout, loading: authLoading } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [activeModule, setActiveModule] = useState<FmsModule>('home');

    // Sync activeModule with URL
    useEffect(() => {
        const path = location.pathname;
        if (path.includes('/catalogue') || path.includes('/category/') || path.includes('/product/')) {
            setActiveModule('catalogue');
        } else if (path.includes('/dashboard/vendor')) {
            setActiveModule('home'); // Dashboard home is the default for this route
        } else if (path.includes('/profile')) {
            setActiveModule('profile');
        } else if (path.includes('/grievance')) {
            setActiveModule('grievances');
        }
    }, [location.pathname]);

    const handleModuleChange = (module: FmsModule) => {
        setActiveModule(module);
        if (module === 'home') navigate('/dashboard/vendor');
        else if (module === 'catalogue') navigate('/catalogue');
        else if (module === 'profile') navigate('/profile');

        else {
            // Support other modules if they have routes, otherwise just set active (handles dashboard's state-based modules)
            navigate('/dashboard/vendor');
        }
    };

    if (authLoading) return null; // Let App handle global loader
    if (!user || user.role !== "vendor") return <Navigate to="/login" />;

    const getModuleTitle = () => {
        const path = location.pathname;
        if (path.includes('/product/')) return "Product Details";
        if (path.includes('/category/')) return "Category View";
        if (path === '/catalogue') return "Product Catalogue";
        if (path === '/profile') return "My Profile";

        const titles: Record<string, string> = {
            home: "Channel Partner Home",
            warranty: "Warranty Management",
            leads: "My Leads",
            manpower: "Manpower Control",
            catalogue: "Product Catalogue",
            news: "News & Alerts",
            grievances: "Grievance Redressal",
            profile: "My Profile"
        };
        return titles[activeModule] || "Dashboard";
    };

    return (
        <div className="flex h-screen bg-[#fffaf5]">
            <DashboardSidebar
                activeModule={activeModule}
                onModuleChange={handleModuleChange}
                isCollapsed={isCollapsed}
                onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
            />

            <div className="flex-1 flex flex-col overflow-hidden relative">
                <ModuleLayout
                    title={getModuleTitle()}
                    description={activeModule === 'home' ? `Welcome back, ${user.name}` : undefined}
                    isCollapsed={isCollapsed}
                    onNavigate={handleModuleChange}
                    onMenuToggle={() => setIsMobileMenuOpen(true)}
                >
                    <Outlet context={{ activeModule, setActiveModule }} />
                </ModuleLayout>

                {/* Mobile Menu Drawer - Ported from FranchiseDashboard */}
                <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                    <SheetContent side="left" className="w-80 p-0 border-none bg-white rounded-r-[40px] flex flex-col">
                        <SheetHeader className="p-8 border-b border-orange-50 shrink-0">
                            <div className="flex items-center justify-between">
                                <img
                                    src="/autoform-logo.png"
                                    alt="Autoform Logo"
                                    className="h-8 object-contain"
                                />
                                <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                            </div>
                        </SheetHeader>

                        <nav className="flex-1 py-6 px-4 space-y-8 overflow-y-auto custom-scrollbar">
                            {menuGroups.map((group) => (
                                <div key={group.label} className="space-y-3">
                                    <h2 className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                        <Tx>{group.label}</Tx>
                                    </h2>
                                    <div className="space-y-1">
                                        {group.items.map((item) => (
                                            <SidebarItem
                                                key={item.id}
                                                icon={item.icon}
                                                label={item.label}
                                                active={activeModule === item.id}
                                                onClick={() => {
                                                    handleModuleChange(item.id);
                                                    setIsMobileMenuOpen(false);
                                                }}
                                                comingSoon={item.comingSoon}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </nav>

                        <div className="p-4 border-t border-orange-50 space-y-2 shrink-0">
                            <Button
                                variant="ghost"
                                className="w-full h-12 justify-start gap-4 px-4 rounded-[32px] transition-all text-slate-400 hover:text-red-500 hover:bg-red-50"
                                onClick={() => {
                                    logout();
                                    setIsMobileMenuOpen(false);
                                }}
                            >
                                <LogOut className="h-5 w-5" />
                                <span className="font-bold text-sm"><Tx>Sign Out</Tx></span>
                            </Button>
                        </div>
                    </SheetContent>
                </Sheet>
            </div>
        </div>
    );
};

export default VendorPortalLayout;
