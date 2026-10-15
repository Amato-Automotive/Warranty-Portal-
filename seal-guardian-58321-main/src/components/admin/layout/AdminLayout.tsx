import { lazy, Suspense, useState } from "react";
import { AdminSidebar, SidebarContent } from "./AdminSidebar";
import type { AdminModule } from "./AdminSidebar";
import { adminModuleTitle } from "./adminModules";
import { AdminModuleLayout } from "./AdminModuleLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { useAppBack } from "@/hooks/useAppBack";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

import { AdminCommandPalette } from "../AdminCommandPalette";

// Modules load only when selected. This keeps the overview from downloading every
// management screen (and their dependencies) before it can render.
const Profile = lazy(() => import("@/pages/Profile"));
const AdminHome = lazy(() => import("../modules/AdminHome").then(({ AdminHome }) => ({ default: AdminHome })));
const AdminWarranties = lazy(() => import("../modules/AdminWarranties").then(({ AdminWarranties }) => ({ default: AdminWarranties })));
const AdminVendors = lazy(() => import("../modules/AdminVendors").then(({ AdminVendors }) => ({ default: AdminVendors })));
const AdminDistributors = lazy(() => import("../modules/AdminDistributors").then(({ AdminDistributors }) => ({ default: AdminDistributors })));
const AdminManpower = lazy(() => import("../modules/AdminManpower").then(({ AdminManpower }) => ({ default: AdminManpower })));
const AdminLeadManagement = lazy(() => import("../modules/AdminLeadManagement").then(({ AdminLeadManagement }) => ({ default: AdminLeadManagement })));
const AdminCustomers = lazy(() => import("../modules/AdminCustomers").then(({ AdminCustomers }) => ({ default: AdminCustomers })));
const AdminAdmins = lazy(() => import("../modules/AdminAdmins").then(({ AdminAdmins }) => ({ default: AdminAdmins })));
const AdminActivityLogs = lazy(() => import("../modules/AdminActivityLogs").then(({ AdminActivityLogs }) => ({ default: AdminActivityLogs })));
const AdminGrievances = lazy(() => import("../modules/AdminGrievances").then(({ AdminGrievances }) => ({ default: AdminGrievances })));
const AdminProducts = lazy(() => import("../modules/AdminProducts").then(({ AdminProducts }) => ({ default: AdminProducts })));
const AdminTerms = lazy(() => import("../modules/AdminTerms").then(({ AdminTerms }) => ({ default: AdminTerms })));
const AdminContentManager = lazy(() => import("../modules/AdminContentManager").then(({ AdminContentManager }) => ({ default: AdminContentManager })));
const AdminWarrantyForm = lazy(() => import("../modules/AdminWarrantyForm").then(({ AdminWarrantyForm }) => ({ default: AdminWarrantyForm })));
const AdminAnnouncements = lazy(() => import("../modules/AdminAnnouncements").then(({ AdminAnnouncements }) => ({ default: AdminAnnouncements })));
const AdminNotificationSettings = lazy(() => import("../modules/AdminNotificationSettings").then(({ AdminNotificationSettings }) => ({ default: AdminNotificationSettings })));
const AdminFranchiseDistributorMap = lazy(() => import("../modules/AdminFranchiseDistributorMap").then(({ AdminFranchiseDistributorMap }) => ({ default: AdminFranchiseDistributorMap })));
const AdminAudits = lazy(() => import("../modules/AdminAudits").then(({ AdminAudits }) => ({ default: AdminAudits })));
const AdminPortalActivity = lazy(() => import("../modules/AdminPortalActivity").then(({ AdminPortalActivity }) => ({ default: AdminPortalActivity })));
const AdminOldWarranties = lazy(() => import("../modules/AdminOldWarranties").then(({ AdminOldWarranties }) => ({ default: AdminOldWarranties })));
const AdminWarrantyProducts = lazy(() => import("../modules/AdminWarrantyProducts").then(({ AdminWarrantyProducts }) => ({ default: AdminWarrantyProducts })));
const AdminPOSM = lazy(() => import("../modules/AdminPOSM").then(({ AdminPOSM }) => ({ default: AdminPOSM })));
const AdminSchemes = lazy(() => import("../modules/AdminSchemes").then(({ AdminSchemes }) => ({ default: AdminSchemes })));
const AdminECatalogue = lazy(() => import("../modules/AdminECatalogue").then(({ AdminECatalogue }) => ({ default: AdminECatalogue })));
const AdminUIDManagement = lazy(() => import("../modules/AdminUIDManagement"));
const AdminPPFRolls = lazy(() => import("../modules/AdminPPFRolls"));
const AdminAnalytics = lazy(() => import("../modules/AdminAnalytics").then(({ AdminAnalytics }) => ({ default: AdminAnalytics })));
const AdminOrderManagement = lazy(() => import("../modules/AdminOrderManagement").then(({ AdminOrderManagement }) => ({ default: AdminOrderManagement })));

const ModuleLoadingFallback = () => (
    <div className="flex h-[400px] flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Loading module…</p>
    </div>
);

export const AdminLayout = () => {
    const { user, loading } = useAuth();
    const [activeModule, setActiveModuleRaw] = useState<AdminModule>('overview');
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    // Guard: non-super-admins cannot navigate to the 'admins' module
    const setActiveModule = (module: AdminModule) => {
        if (module === 'admins' && !user?.isSuperAdmin) return;
        setActiveModuleRaw(module);
    };

    // App back button: modules are local state, so step back to Overview.
    useAppBack(() => {
        if (activeModule === 'overview') return false;
        setActiveModuleRaw('overview');
        return true;
    });

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#fffaf5]">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </div>
        );
    }

    if (!user || user.role !== 'admin') {
        return <Navigate to="/login?role=admin" replace />;
    }

    const renderModule = () => {
        switch (activeModule) {
            case 'overview': return <AdminHome />;
            case 'analytics': return <AdminAnalytics onNavigate={setActiveModule} />;
            case 'warranties': return <AdminWarranties />;
            case 'vendors': return <AdminVendors />;
            case 'portal-activity': return <AdminPortalActivity />;
            case 'distributors': return <AdminDistributors />;
            case 'manpower': return <AdminManpower />;
            case 'customers': return <AdminCustomers />;
            case 'warranty-products': return <AdminWarrantyProducts />;
            case 'old-warranties': return <AdminOldWarranties />;
            case 'admins': return <AdminAdmins />;
            case 'activity-logs': return <AdminActivityLogs />;
            case 'grievances': return <AdminGrievances />;
            case 'products':
                return <AdminProducts />;
            case 'terms':
                return <AdminTerms />;
            case 'content-manager':
                return <AdminContentManager />;
            case 'warranty-form':
                return <AdminWarrantyForm />;
            case 'announcements':
                return <AdminAnnouncements />;
            case 'notification-settings':
                return <AdminNotificationSettings />;
            case 'franchise-distributor-map':
                return <AdminFranchiseDistributorMap />;
            case 'audits':
                return <AdminAudits />;
            case 'leads':
                return <AdminLeadManagement />;
            case 'posm':
                return <AdminPOSM />;
            case 'schemes':
                return <AdminSchemes />;
            case 'uid-management':
                return <AdminUIDManagement />;
            case 'ppf-rolls':
                return <AdminPPFRolls />;
            case 'ecatalogue':
                return <AdminECatalogue />;
            case 'order-management':
                return <AdminOrderManagement />;
            case 'profile': return <Profile embedded={true} />;
            default: return <AdminHome />;
        }
    };

    const getModuleTitle = () => adminModuleTitle(activeModule);

    return (
        <div className="flex flex-col md:flex-row h-screen bg-[#fffaf5] overflow-hidden">
            {/* Mobile Menu Sheet */}
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                <SheetContent side="left" className="p-0 w-72 border-r-orange-100 bg-white">
                    <SidebarContent
                        activeModule={activeModule}
                        onModuleChange={(module) => {
                            setActiveModule(module);
                            setIsMobileMenuOpen(false);
                        }}
                        isCollapsed={false}
                    />
                </SheetContent>
            </Sheet>

            {/* Desktop Sidebar */}
            <AdminSidebar
                activeModule={activeModule}
                onModuleChange={setActiveModule}
                isCollapsed={isCollapsed}
                onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
            />

            {/* Main Content */}
            <div className="flex-1 flex flex-col h-full overflow-hidden w-full">
                <AdminModuleLayout
                    title={getModuleTitle()}
                    description={`Managed by ${user.name}`}
                    actions={
                        <AdminCommandPalette onNavigate={setActiveModule} />
                    }
                    onMenuToggle={() => setIsMobileMenuOpen(true)}
                    onProfileClick={() => setActiveModule('profile')}
                    stickyHeader={activeModule !== 'warranties'}
                >
                    <Suspense fallback={<ModuleLoadingFallback />}>
                        {renderModule()}
                    </Suspense>
                </AdminModuleLayout>
            </div>
        </div>
    );
};
