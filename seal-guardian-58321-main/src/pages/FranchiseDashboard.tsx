import { useState, useEffect, useRef } from "react";
import { Navigate, useOutletContext } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePortalActivity } from "@/hooks/usePortalActivity";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { Loader2, X, ChevronRight, Search, Hash } from "lucide-react";
import { cn, formatToIST, getISTTodayISO } from "@/lib/utils";
import { fetchProducts, Product, fetchCategories, Category } from '@/lib/catalogService';
import { useNotifications } from "@/contexts/NotificationContext";

import { Tx, useLanguage } from "@/contexts/LanguageContext";
import { DashboardSidebar, FmsModule, menuGroups, SidebarItem } from "@/components/fms/DashboardSidebar";
import { ModuleLayout } from "@/components/fms/ModuleLayout";
import { FranchiseHome, type HomeTarget } from "@/components/fms/FranchiseHome";
import { WarrantyManagement } from "@/components/fms/WarrantyManagement";
import { StaffManagement } from "@/components/fms/StaffManagement";
import VendorCatalog from "@/components/eshop/VendorCatalog";
import CatalogHeader from "@/components/eshop/CatalogHeader";
import { NewsAlerts } from "@/components/fms/NewsAlerts";
import { ComingSoon } from "@/components/fms/ComingSoon";
import { FranchiseAudits } from "@/components/fms/FranchiseAudits";
import { FranchiseLeads, type LeadsView } from "@/components/fms/FranchiseLeads";
import { FranchiseSchemes } from "@/components/fms/FranchiseSchemes";
import VendorGrievances from "@/components/fms/VendorGrievances";
import POSMModule from "@/components/fms/POSMModule";
import FeedbackModule from "@/components/fms/FeedbackModule";
import { FeedbackReminder } from "@/components/fms/FeedbackReminder";
import ECatalogue from "@/components/fms/ECatalogue";
import B2BOrderManagement from "@/components/fms/B2BOrderManagement";
import Profile from "./Profile";
import Terms from "./Terms";
import ClaimProcess from "./ClaimProcess";
import { ClaimProcessAnnouncement } from "@/components/fms/ClaimProcessAnnouncement";
import { useB2BCart } from "@/contexts/B2BCartContext";
import CategoryPage from "./eshop/CategoryPage";
import ProductPage from "./eshop/ProductPage";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LogOut } from "lucide-react";
import { SelectiveExportDialog } from "@/components/warranty/SelectiveExportDialog";
import { exportWarrantiesToCSV } from "@/lib/adminExports";

// Existing Components for Modals
import EVProductsForm from "@/components/warranty/EVProductsForm";
import SeatCoverForm from "@/components/warranty/SeatCoverForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { WarrantySpecSheet } from "@/components/warranty/WarrantySpecSheet";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { getWarrantyFormComponent, getEditFormProps } from "@/lib/warrantyFormRegistry";

interface DashboardContext {
    activeModule: FmsModule;
    setActiveModule: (module: FmsModule) => void;
}

const FranchiseDashboard = () => {
    const { user, logout, loading: authLoading } = useAuth();
    const { toast } = useToast();
    const { fullHistory } = useNotifications();
    const { tr } = useLanguage();
    const { isDistributor, isFranchise, loadingProfile } = useB2BCart();
    const context = useOutletContext<DashboardContext>();
    const [localActiveModule, setLocalActiveModule] = useState<FmsModule>('home');

    // Use context state if available (from Layout), otherwise fallback to local state
    const activeModule = context?.activeModule || localActiveModule;
    const setActiveModule = context?.setActiveModule || setLocalActiveModule;
    // What is open and for how long, for the admin's Portal Activity screens.
    usePortalActivity(activeModule, user?.role === 'vendor');
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const filteredMenuGroups = menuGroups.map(group => {
        if (isDistributor && !isFranchise) {
            const filteredItems = group.items.filter(item => {
                const franchiseOnly = ['warranty', 'leads', 'register', 'manpower', 'posm', 'offers', 'audit', 'targets', 'feedback'];
                return !franchiseOnly.includes(item.id);
            });
            return { ...group, items: filteredItems };
        }
        return group;
    }).filter(group => group.items.length > 0);
    const [registerTab, setRegisterTab] = useState('seat-cover');

    // Data States
    const [warranties, setWarranties] = useState<any[]>([]);
    const [manpowerList, setManpowerList] = useState<any[]>([]);
    const [pastManpowerList, setPastManpowerList] = useState<any[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [warrantyLimit, setWarrantyLimit] = useState(10);
    const [manpowerLimit, setManpowerLimit] = useState(10);
    const [pastManpowerLimit, setPastManpowerLimit] = useState(10);

    const [warrantyPagination, setWarrantyPagination] = useState({ currentPage: 1, totalPages: 1, totalCount: 0, limit: 10, hasNextPage: false, hasPrevPage: false });
    const [manpowerPagination, setManpowerPagination] = useState({ currentPage: 1, totalPages: 1, totalCount: 0, limit: 10, hasNextPage: false, hasPrevPage: false });
    const [pastManpowerPagination, setPastManpowerPagination] = useState({ currentPage: 1, totalPages: 1, totalCount: 0, limit: 10, hasNextPage: false, hasPrevPage: false });

    // Stats State
    const [dashboardStats, setDashboardStats] = useState<{
        pending_vendor: number; pending: number; validated: number; rejected: number;
        this_month?: number; last_month?: number; daily?: { day: string; n: number }[];
    }>({
        pending_vendor: 0,
        pending: 0,
        validated: 0,
        rejected: 0
    });

    // Search & Filter States
    const [warrantySearch, setWarrantySearch] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<string>('all');
    const [selectedMake, setSelectedMake] = useState<string>('all');
    const [selectedModel, setSelectedModel] = useState<string>('all');
    const [dateRange, setDateRange] = useState<any | undefined>();
    const [activeStatusTab, setActiveStatusTab] = useState<string>('all');
    // A tap on the home opens Warranties or My Leads already filtered to what was tapped.
    const [leadsView, setLeadsView] = useState<LeadsView | undefined>();
    const homeFilteredWarranties = useRef(false);
    const [viewingProductId, setViewingProductId] = useState<string | null>(null);
    const [viewingCategoryId, setViewingCategoryId] = useState<string | null>(null);
    const [expandedMobileCategory, setExpandedMobileCategory] = useState<string | null>(null);
    const [isMobileSearchActive, setIsMobileSearchActive] = useState(false);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);

    /* The home's filters last only while that page is open: leaving it (or
       opening it from the sidebar) shows everything again. */
    useEffect(() => {
        if (activeModule !== 'leads') setLeadsView(undefined);
        if (activeModule !== 'warranty' && homeFilteredWarranties.current) {
            homeFilteredWarranties.current = false;
            setActiveStatusTab('all');
            setDateRange(undefined);
        }
    }, [activeModule]);

    const openFromHome = (target: HomeTarget) => {
        if (target.module === 'warranty' && 'tab' in target) {
            setActiveStatusTab(target.tab ?? 'all');
            // IST days, both included.
            setDateRange(target.from && target.to
                ? { from: new Date(`${target.from}T00:00:00+05:30`), to: new Date(`${target.to}T23:59:59+05:30`) }
                : undefined);
            homeFilteredWarranties.current = true;
        }
        if (target.module === 'leads' && 'view' in target) setLeadsView(target.view);
        setActiveModule(target.module as FmsModule);
    };

    useEffect(() => {
        const scrollContainer = document.getElementById('main-dashboard-content-area');
        if (scrollContainer) {
            scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
        }
    }, [activeModule, viewingProductId, viewingCategoryId]);

    // Link Interceptor Logic exposed for programmatic use
    const handleInternalLink = (href: string) => {
        if (!href || href.includes('?')) return false;

        if (href.startsWith('/product/')) {
            const productId = href.split('/').pop();
            if (productId) {
                setViewingProductId(productId);
                setViewingCategoryId(null);
                if (activeModule !== 'catalogue') setActiveModule('catalogue');
                return true;
            }
        } else if (href.startsWith('/category/')) {
            const categoryId = href.split('/').pop();
            if (categoryId) {
                setViewingCategoryId(categoryId);
                setViewingProductId(null);
                if (activeModule !== 'catalogue') setActiveModule('catalogue');
                return true;
            }
        } else if (href === '/catalogue') {
            if (activeModule !== 'catalogue') setActiveModule('catalogue');
            setViewingProductId(null);
            setViewingCategoryId(null);
            return true;
        } else if (href === '/ecatalogue') {
            if (activeModule !== 'ecatalogue') setActiveModule('ecatalogue');
            return true;
        }
        return false;
    };

    // Global interceptor for product and category links to keep user in dashboard
    useEffect(() => {
        const handleGlobalClick = (e: MouseEvent) => {
            const anchor = (e.target as HTMLElement).closest('a');
            if (anchor) {
                const href = anchor.getAttribute('href');
                if (href && handleInternalLink(href)) {
                    e.preventDefault();
                }
            }
        };
        document.addEventListener('click', handleGlobalClick, true); // Use capture phase
        return () => document.removeEventListener('click', handleGlobalClick, true);
    }, [activeModule]);

    // Modal/Dialog States
    const [registrationType, setRegistrationType] = useState<'ev' | 'seat-cover' | null>(null);
    const [selectedWarranty, setSelectedWarranty] = useState<any | null>(null);
    const [editingWarranty, setEditingWarranty] = useState<any | null>(null);
    const [manpowerWarrantyDialogOpen, setManpowerWarrantyDialogOpen] = useState(false);
    const [manpowerWarrantyDialogData, setManpowerWarrantyDialogData] = useState<{ member: any; status: 'validated' | 'pending' | 'rejected'; warranties: any[] }>({ member: null, status: 'validated', warranties: [] });

    // Manpower Form State
    const [editingId, setEditingId] = useState<string | null>(null);
    const [addingManpower, setAddingManpower] = useState(false);
    const [updatingManpower, setUpdatingManpower] = useState(false);
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

    useEffect(() => {
        if (user?.role === "vendor") {
            fetchAllData();
            fetchStats();
        }
    }, [user]);

    const fetchStats = async () => {
        try {
            const response = await api.get('/warranty/stats');
            if (response.data.success) {
                setDashboardStats(response.data.stats);
            }
        } catch (error) {
            console.error("Failed to fetch stats", error);
        }
    };

    const fetchAllData = async () => {
        setLoading(true);
        try {
            const [warrantyRes, manpowerRes, pastManpowerRes, prods, cats] = await Promise.all([
                api.get(`/warranty?limit=${warrantyLimit}&page=1`),
                // approved=all so the store still sees staff awaiting admin approval
                // (shown with a "Pending approval" badge). The installer picker on
                // warranty forms fetches approved-only separately.
                api.get(`/vendor/manpower?active=true&approved=all&limit=${manpowerLimit}&page=1`),
                api.get(`/vendor/manpower?active=false&approved=all&limit=${pastManpowerLimit}&page=1`),
                fetchProducts(),
                fetchCategories()
            ]);

            setProducts(prods);
            setCategories(cats);

            if (warrantyRes.data.success) {
                setWarranties(warrantyRes.data.warranties);
                if (warrantyRes.data.pagination) setWarrantyPagination(warrantyRes.data.pagination);
            }
            if (manpowerRes.data.success) {
                setManpowerList(manpowerRes.data.manpower);
                if (manpowerRes.data.pagination) setManpowerPagination(manpowerRes.data.pagination);
            }
            if (pastManpowerRes.data.success) {
                setPastManpowerList(pastManpowerRes.data.manpower);
                if (pastManpowerRes.data.pagination) setPastManpowerPagination(pastManpowerRes.data.pagination);
            }
        } catch (error) {
            console.error("Fetch failed", error);
            toast({ title: "Sync Failed", description: "Could not refresh dashboard data.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const fetchWarranties = async (page = 1, currentLimit = warrantyLimit, background = false) => {
        if (!background) setLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('page', page.toString());
            params.append('limit', currentLimit.toString());

            // UI tab values → DB status values mapping
            const tabToStatus: Record<string, string> = {
                'pending': 'pending_vendor',   // "Pending" tab = needs franchise verification
                'pending_ho': 'pending',        // "Verified" tab = franchise done, HO pending
                'validated': 'validated',
                'rejected': 'rejected',
            };
            if (activeStatusTab !== 'all') {
                const dbStatus = tabToStatus[activeStatusTab] || activeStatusTab;
                params.append('status', dbStatus);
            }
            if (selectedProduct !== 'all') params.append('product_type', selectedProduct);
            if (selectedMake !== 'all') params.append('make', selectedMake);
            if (selectedModel !== 'all') params.append('model', selectedModel);
            if (warrantySearch) params.append('search', warrantySearch);
            if (dateRange?.from) params.append('date_from', dateRange.from.toISOString());
            if (dateRange?.to) params.append('date_to', dateRange.to.toISOString());

            const response = await api.get(`/warranty?${params.toString()}`);
            if (response.data.success) {
                setWarranties(response.data.warranties);
                if (response.data.pagination) setWarrantyPagination(response.data.pagination);
            }
        } catch (error) {
            console.error("Failed to fetch warranties", error);
        } finally {
            if (!background) setLoading(false);
        }
    };

    // Filter Effects
    useEffect(() => {
        const handler = setTimeout(() => {
            fetchWarranties(1);
        }, 500); // 500ms debounce for search
        return () => clearTimeout(handler);
    }, [warrantySearch]);

    useEffect(() => {
        fetchWarranties(1);
    }, [selectedProduct, selectedMake, selectedModel, dateRange, activeStatusTab]);

    const fetchManpower = async (page = 1, active = true, currentLimit = active ? manpowerLimit : pastManpowerLimit, background = false) => {
        if (!background) setLoading(true);
        try {
            // approved=all — the store sees pending staff too (badged in the UI).
            const response = await api.get(`/vendor/manpower?page=${page}&limit=${currentLimit}&active=${active}&approved=all`);
            if (response.data.success) {
                if (active) {
                    setManpowerList(response.data.manpower);
                    if (response.data.pagination) setManpowerPagination(response.data.pagination);
                } else {
                    setPastManpowerList(response.data.manpower);
                    if (response.data.pagination) setPastManpowerPagination(response.data.pagination);
                }
            }
        } catch (error) {
            console.error("Failed to fetch manpower", error);
        } finally {
            if (!background) setLoading(false);
        }
    };

    // Handlers ported from VendorDashboard
    const handleVerifyWarranty = async (warranty: any) => {
        const warrantyId = warranty.uid || warranty.id;
        if (!warrantyId) {
            toast({ title: "Error", description: "Invalid warranty identifier", variant: "destructive" });
            return;
        }
        setActionLoadingId(warrantyId);
        try {
            const response = await api.post(`/vendor/warranty/${warrantyId}/approve`);
            if (response.data.success) {
                toast({ title: "Warranty Approved", description: "Installation status updated." });
                fetchWarranties(warrantyPagination.currentPage, warrantyLimit, true);
            }
        } catch (error: any) {
            toast({ title: "Action Failed", description: getErrorMessage(error, "Could not approve"), variant: "destructive" });
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleRejectWarranty = async (warranty: any) => {
        const reason = prompt("Please enter the reason for rejection:");
        if (!reason) return;
        const warrantyId = warranty.uid || warranty.id;
        if (!warrantyId) {
            toast({ title: "Error", description: "Invalid warranty identifier", variant: "destructive" });
            return;
        }
        setActionLoadingId(warrantyId);
        try {
            const response = await api.post(`/vendor/warranty/${warrantyId}/reject`, { reason });
            if (response.data.success) {
                toast({ title: "Needs Correction", variant: "destructive" });
                fetchWarranties(warrantyPagination.currentPage, warrantyLimit, true);
            }
        } catch (error: any) {
            toast({ title: "Action Failed", description: getErrorMessage(error, "Could not reject"), variant: "destructive" });
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleAddManpower = async (data: any) => {
        setAddingManpower(true);
        try {
            const response = await api.post("/vendor/manpower", {
                name: data.name,
                phoneNumber: data.phone,
                applicatorType: data.type
            });
            if (response.data.success) {
                // The server says "awaiting admin approval" — pass that through, since
                // a bare "Added" reads as done and the member is not selectable yet.
                toast({
                    title: "Added — awaiting approval",
                    description: response.data.message || "An admin needs to approve this member before they can be picked on a warranty form."
                });
                setManpowerList([...manpowerList, response.data.manpower]);
                return true;
            }
        } catch (error: any) {
            toast({ title: "Addition Failed", description: getErrorMessage(error, "Could not add"), variant: "destructive" });
        } finally {
            setAddingManpower(false);
        }
        return false;
    };

    const handleUpdateManpower = async (id: string, data: any) => {
        setUpdatingManpower(true);
        try {
            const response = await api.put(`/vendor/manpower/${id}`, {
                name: data.name,
                phoneNumber: data.phone,
                applicatorType: data.type
            });
            if (response.data.success) {
                toast({ title: "Manpower Updated", description: response.data.message });
                setManpowerList(manpowerList.map(m => m.id === id ? response.data.manpower : m));
                setEditingId(null);
                return true;
            }
        } catch (error: any) {
            toast({ title: "Update Failed", description: getErrorMessage(error, "Could not update"), variant: "destructive" });
        } finally {
            setUpdatingManpower(false);
        }
        return false;
    };

    // Stores can't remove staff directly — they raise a request with a reason and
    // an admin approves it. The member stays on the team until then.
    const handleDeleteManpower = async (id: string, reason?: string) => {
        if (!reason || !reason.trim()) {
            toast({ title: "Reason Required", description: "Please tell us why this member should be removed.", variant: "destructive" });
            return false;
        }
        try {
            const response = await api.delete(`/vendor/manpower/${id}`, { data: { reason: reason.trim() } });
            if (response.data.success) {
                toast({ title: "Request Sent", description: response.data.message });
                // Refresh so the member shows under "Removal Requested".
                fetchManpower(1, true, manpowerLimit, true);
                return true;
            }
        } catch (error: any) {
            toast({ title: "Request Failed", description: getErrorMessage(error, "Could not raise the removal request"), variant: "destructive" });
        }
        return false;
    };

    // Bring an Ex-Team member back. They return as pending, so an admin
    // re-approves before they can be picked as an installer again.
    const handleRestoreManpower = async (id: string, reason?: string) => {
        try {
            const response = await api.put(`/vendor/manpower/${id}/restore`, { reason });
            if (response.data.success) {
                toast({ title: "Restore Requested", description: response.data.message });
                // Refresh both lists so they move from Ex-Team into Pending.
                fetchManpower(1, true, manpowerLimit, true);
                fetchManpower(1, false, pastManpowerLimit, true);
                return true;
            }
            return false;
        } catch (error: any) {
            toast({ title: "Restore Failed", description: getErrorMessage(error, "Could not restore member"), variant: "destructive" });
            return false;
        }
    };

    const showManpowerWarranties = async (member: any, status: 'validated' | 'pending' | 'rejected') => {
        try {
            // Fetch warranties for this manpower from the API
            const response = await api.get(`/vendor/manpower/${member.id}/warranties?status=${status}`);
            if (response.data.success) {
                setManpowerWarrantyDialogData({
                    member,
                    status,
                    warranties: response.data.warranties
                });
                setManpowerWarrantyDialogOpen(true);
            }
        } catch (error: any) {
            console.error("Failed to fetch manpower warranties", error);
            toast({
                title: "Failed to load warranties",
                description: getErrorMessage(error, "Could not fetch warranty details"),
                variant: "destructive"
            });
        }
    };

    const handleExportWarranties = () => {
        setExportDialogOpen(true);
    };

    const handleSelectiveExport = async (selectedFields: string[]) => {
        setLoading(true);
        try {
            // Fetch all records for export (using a high limit to get everything)
            const response = await api.get(`/warranty?limit=5000&page=1`);
            let allWarranties = response.data.success ? response.data.warranties : warranties;

            // Apply the same filters as in the view
            const exportTabToStatus: Record<string, string> = {
                'pending': 'pending_vendor',
                'pending_ho': 'pending',
                'validated': 'validated',
                'rejected': 'rejected',
            };
            const filteredForExport = allWarranties.filter((w: any) => {
                // Status Tab Filter
                const expectedDbStatus = exportTabToStatus[activeStatusTab];
                const matchesStatus = activeStatusTab === 'all' ? true : w.status === expectedDbStatus;
                if (!matchesStatus) return false;

                // Search Filter
                if (warrantySearch) {
                    const search = warrantySearch.toLowerCase();
                    const matchesSearch = (
                        w.customer_name?.toLowerCase().includes(search) ||
                        w.customer_phone?.includes(search) ||
                        w.uid?.toLowerCase().includes(search) ||
                        w.registration_number?.toLowerCase().includes(search) ||
                        w.car_make?.toLowerCase().includes(search) ||
                        w.car_model?.toLowerCase().includes(search)
                    );
                    if (!matchesSearch) return false;
                }

                // Product Filter
                if (selectedProduct !== 'all') {
                    if (w.product_type !== selectedProduct) return false;
                }

                // Make Filter
                if (selectedMake !== 'all') {
                    if (w.car_make !== selectedMake) return false;
                }

                // Model Filter
                if (selectedModel !== 'all') {
                    if (w.car_model !== selectedModel) return false;
                }

                // Date Range Filter
                if (dateRange?.from) {
                    const purchaseDate = new Date(w.purchase_date || w.created_at);
                    const rangeEnd = dateRange.to || dateRange.from;
                    const start = new Date(dateRange.from);
                    start.setHours(0, 0, 0, 0);
                    const end = new Date(rangeEnd);
                    end.setHours(23, 59, 59, 999);
                    if (purchaseDate < start || purchaseDate > end) return false;
                }

                return true;
            });

            if (filteredForExport.length === 0) {
                toast({ description: "No records found to export", variant: "destructive" });
                return;
            }

            exportWarrantiesToCSV(
                filteredForExport,
                `warranties_export_${getISTTodayISO()}.csv`,
                selectedFields
            );

            toast({ title: "Export Successful", description: `Exported ${filteredForExport.length} records with ${selectedFields.length} fields` });
            setExportDialogOpen(false);
        } catch (error) {
            console.error("Export failed", error);
            toast({ title: "Export Failed", description: "Could not fetch records for export.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    if (authLoading) return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-white gap-4">
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest animate-pulse">Initializing FMS...</p>
        </div>
    );
    if (!user) return <Navigate to="/login?role=vendor" />;
    if (user.role !== "vendor") return <Navigate to="/" />;
    if (loadingProfile) return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-white gap-4">
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest animate-pulse">Loading Dashboard...</p>
        </div>
    );

    const renderModule = () => {
        // Use real stats from backend (dashboardStats), not the paginated local list
        const homeStats = {
            total: (dashboardStats.pending_vendor || 0) + (dashboardStats.validated || 0) + (dashboardStats.rejected || 0),
            approved: dashboardStats.validated || 0,
            pending: dashboardStats.pending_vendor || 0,
            manpower: manpowerPagination.totalCount || manpowerList.length,
            // For the home's "this month" card.
            this_month: dashboardStats.this_month ?? 0,
            last_month: dashboardStats.last_month ?? 0,
            daily: dashboardStats.daily ?? [],
        };

        const recentActivityData = warranties
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 5)
            .map(w => {
                const toTitleCase = (str: string) => {
                    if (!str) return str;
                    return str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
                };
                return {
                    time: formatToIST(w.created_at),
                    action: w.status === 'validated' ? 'Warranty Approved' :
                        w.status === 'rejected' ? 'Needs Correction' : 'New Registration',
                    sub: `${w.registration_number || 'N/A'} • ${toTitleCase(w.customer_name)}`,
                    status: w.status === 'validated' ? 'success' :
                        w.status === 'rejected' ? 'warning' : 'primary',
                    // The home's recent-warranties table.
                    customer: toTitleCase(w.customer_name) || 'Customer',
                    registration: w.registration_number || null,
                    car: [w.car_make, w.car_model].filter(Boolean).join(' ') || null,
                    product: w.product_type || null,
                    created_at: w.created_at,
                };
            });

        // New Arrivals: Products marked as new arrivals, or fallback to latest 8 products
        const markedNewArrivals = products.filter((p: any) => p.isNewArrival);
        const newProducts = markedNewArrivals.length > 0
            ? markedNewArrivals.slice(0, 8)
            : [...products].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 8);

        // Platform Updates: the latest 5 alert/system/product notifications, one line each on the home
        const latestUpdates = fullHistory
            .filter(n => n.type === 'alert' || n.type === 'system' || n.type === 'product')
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 5);

        switch (activeModule) {
            case 'home':
                return <FranchiseHome
                    stats={homeStats}
                    recentActivity={recentActivityData}
                    onOpen={openFromHome}
                    newProducts={newProducts}
                    latestUpdates={latestUpdates}
                />;
            case 'register':
                return (
                    <div className="flex h-[60vh] flex-col items-center justify-center text-center">
                        <h2 className="text-6xl font-black text-slate-800 mb-4">404</h2>
                        <p className="text-slate-500 font-medium">This page is no longer available.</p>
                        <Button 
                            onClick={() => setActiveModule('home')} 
                            className="mt-8 bg-orange-500 hover:bg-orange-600 rounded-full px-8"
                        >
                            Return to Dashboard
                        </Button>
                    </div>
                );
            /* --- RETAINED FOR ROLLBACK ---
            case 'register':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <div className="max-w-4xl mx-auto">
                            <Tabs value={registerTab} onValueChange={setRegisterTab} className="w-full">
                                <TabsList className="grid w-full grid-cols-2 h-auto min-h-[3.5rem] bg-slate-100/40 rounded-2xl p-1 mb-6">
                                    <TabsTrigger
                                        value="seat-cover"
                                        className="rounded-xl min-h-[2.75rem] h-auto py-2 data-[state=active]:bg-white data-[state=active]:shadow-md font-bold flex items-center justify-center"
                                    >
                                        <img src="/seat-cover-icon.png" alt="Seat Cover" className="w-5 h-5 mr-2 flex-shrink-0" />
                                        <span className="text-sm">Seat Cover</span>
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="ev"
                                        className="rounded-xl min-h-[2.75rem] h-auto py-2 data-[state=active]:bg-white data-[state=active]:shadow-md font-bold flex items-center justify-center"
                                    >
                                        <img src="/ppf-icon.png" alt="PPF" className="w-5 h-5 mr-2 flex-shrink-0" />
                                        <span className="text-sm hidden sm:inline text-center">Paint Protection Film (PPF)</span>
                                        <span className="text-sm sm:hidden">PPF</span>
                                    </TabsTrigger>
                                </TabsList>
                                <TabsContent value="ev" forceMount={undefined}>
                                    {registerTab === 'ev' && (
                                        <Card className="border-orange-100 rounded-3xl shadow-xl">
                                            <CardContent className="p-2 md:p-8">
                                                <EVProductsForm
                                                    embedded
                                                    vendorDirect={true}
                                                    onSuccess={() => { fetchAllData(); setActiveModule('warranty'); }}
                                                />
                                            </CardContent>
                                        </Card>
                                    )}
                                </TabsContent>
                                <TabsContent value="seat-cover" forceMount={undefined}>
                                    {registerTab === 'seat-cover' && (
                                        <Card className="border-orange-100 rounded-3xl shadow-xl">
                                            <CardContent className="p-2 md:p-8">
                                                <SeatCoverForm
                                                    vendorDirect={true}
                                                    onSuccess={() => { fetchAllData(); setActiveModule('warranty'); }}
                                                />
                                            </CardContent>
                                        </Card>
                                    )}
                                </TabsContent>
                            </Tabs>
                        </div>
                    </div>
                );
            ------------------------------ */
            case 'warranty':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <WarrantyManagement
                            warranties={warranties}
                            onRegisterNew={setRegistrationType}
                            onExport={handleExportWarranties}
                            onSelect={setSelectedWarranty}
                            onEditWarranty={setEditingWarranty}
                            onVerify={handleVerifyWarranty}
                            onReject={handleRejectWarranty}
                            warrantySearch={warrantySearch}
                            setWarrantySearch={setWarrantySearch}
                            selectedProduct={selectedProduct}
                            setSelectedProduct={setSelectedProduct}
                            selectedMake={selectedMake}
                            setSelectedMake={setSelectedMake}
                            selectedModel={selectedModel}
                            setSelectedModel={setSelectedModel}
                            dateRange={dateRange}
                            setDateRange={setDateRange}
                            activeTab={activeStatusTab}
                            setActiveTab={setActiveStatusTab}
                            actionLoadingId={actionLoadingId}
                            onRefresh={() => { fetchWarranties(1); fetchStats(); }}
                            isRefreshing={loading}
                            pagination={warrantyPagination}
                            onPageChange={fetchWarranties}
                            onRowsPerPageChange={(rows) => {
                                setWarrantyLimit(rows);
                                fetchWarranties(1, rows);
                            }}
                            stats={dashboardStats}
                        />
                    </div>
                );
            case 'terms':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <Terms />
                    </div>
                );
            case 'claim-process':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <ClaimProcess />
                    </div>
                );
            case 'manpower':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <StaffManagement
                            manpowerList={manpowerList}
                            pastManpowerList={pastManpowerList}
                            onAdd={handleAddManpower}
                            onEdit={handleUpdateManpower}
                            onDelete={handleDeleteManpower}
                            onRestore={handleRestoreManpower}
                            onShowWarranties={showManpowerWarranties}
                            editingId={editingId}
                            setEditingId={setEditingId}
                            onRefresh={fetchAllData}
                            isRefreshing={loading}
                            pagination={manpowerPagination}
                            pastPagination={pastManpowerPagination}
                            onPageChange={fetchManpower}
                            onRowsPerPageChange={(rows) => {
                                setManpowerLimit(rows);
                                fetchManpower(1, true, rows);
                            }}
                            onPastRowsPerPageChange={(rows) => {
                                setPastManpowerLimit(rows);
                                fetchManpower(1, false, rows);
                            }}
                        />
                    </div>
                );
            case 'catalogue':
                if (viewingProductId) {
                    return (
                        <div className="-mt-8 md:-mt-14">
                            <ProductPage productId={viewingProductId} embedded={true} isDashboard={true} />
                        </div>
                    );
                }
                if (viewingCategoryId) {
                    return (
                        <div className="-mt-8 md:-mt-14">
                            <CategoryPage categoryId={viewingCategoryId} embedded={true} isDashboard={true} />
                        </div>
                    );
                }
                return (
                    <div className="-mt-8 md:-mt-14">
                        <CatalogHeader
                            isDashboard={true}
                            externalSearchOpen={isMobileSearchActive}
                            setExternalSearchOpen={setIsMobileSearchActive}
                        />
                        <div className="mt-4">
                            <VendorCatalog />
                        </div>
                    </div>
                );
            case 'news':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <NewsAlerts onNavigate={setActiveModule} onLinkClick={handleInternalLink} />
                    </div>
                );
            case 'grievances':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <VendorGrievances />
                    </div>
                );
            case 'profile':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <Profile embedded={true} />
                    </div>
                );
            case 'orders':
                return <B2BOrderManagement />;
            case 'offers':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <FranchiseSchemes />
                    </div>
                );
            case 'audit':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <FranchiseAudits />
                    </div>
                );
            case 'leads':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <FranchiseLeads key={JSON.stringify(leadsView ?? {})} initial={leadsView} />
                    </div>
                );
            case 'targets':
                return <ComingSoon title="Targets & Achievements" />;
            case 'posm':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <POSMModule />
                    </div>
                );
            case 'feedback':
                return <FeedbackModule />;
            case 'ecatalogue':
                return (
                    <div className="-mt-8 md:-mt-14">
                        <ECatalogue />
                    </div>
                );
            default:
                return (
                    <div className="-mt-8 md:-mt-14">
                        <FranchiseHome
                            stats={homeStats}
                            recentActivity={recentActivityData}
                            onOpen={openFromHome}
                            newProducts={newProducts}
                            latestUpdates={latestUpdates}
                        />
                    </div>
                );
        }
    };

    const getModuleTitle = () => {
        const titles: Record<string, string> = {
            home: "Home",
            warranty: "Warranty Management",
            manpower: "Manpower Control",
            catalogue: "Product Catalogue",
            ecatalogue: "E-Catalogue",
            news: "News & Alerts",
            orders: "Order Management",
            grievances: "Complaint Redressal",
            terms: "Terms & Conditions",
            "claim-process": "Claim Process",
            offers: "Offers & Schemes",
            audit: "Audit & Compliance",
            targets: "Targets & Achievements",
            posm: "POSM Requirements",
            feedback: "Review & Feedback",
            profile: "My Profile"
        };
        return titles[activeModule] || "Dashboard";
    };

    const getModuleActions = () => {
        if (activeModule === 'catalogue') {
            return (
                <div className="md:hidden flex items-center pr-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsMobileSearchActive(!isMobileSearchActive)}
                        className={cn(
                            "h-10 w-10 rounded-xl transition-all duration-300",
                            isMobileSearchActive
                                ? "bg-orange-500 text-white shadow-lg shadow-orange-200"
                                : "bg-orange-50 text-orange-600 border border-orange-100 shadow-sm"
                        )}
                    >
                        {isMobileSearchActive ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
                    </Button>
                </div>
            );
        }
        return null;
    };

    // Show deactivation message if franchise is deactivated
    if (user?.isActive === false) {
        return (
            <div className="flex h-screen bg-[#fffaf5] items-center justify-center">
                <div className="max-w-lg w-full px-4">
                    <div className="bg-white border-2 border-red-100 rounded-2xl p-8 shadow-xl text-center">
                        <div className="w-20 h-20 mx-auto mb-6 bg-red-50 rounded-full flex items-center justify-center">
                            <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                        </div>
                        <h1 className="text-2xl font-bold text-slate-800 mb-3">
                            {isDistributor && isFranchise
                                ? "Partner Account Deactivated"
                                : isDistributor
                                    ? "Distributor Deactivated"
                                    : "Franchise Deactivated"}
                        </h1>
                        <p className="text-slate-500 mb-8 leading-relaxed">
                            Your account has been deactivated. Access to the dashboard and all features has been restricted.
                        </p>
                        <div className="bg-slate-50 rounded-xl p-6 border border-slate-100">
                            <p className="text-sm text-slate-500 font-medium mb-2 uppercase tracking-wide">For assistance contact</p>
                            <p className="text-lg font-bold text-slate-800">Noida Head Office</p>
                            <p className="text-sm text-slate-400 mt-1">Our support team will guide you through current status</p>
                        </div>
                        <Button
                            variant="ghost"
                            className="mt-8 text-slate-400 hover:text-slate-600"
                            onClick={logout}
                        >
                            <LogOut className="w-4 h-4 mr-2" />
                            <Tx>Sign Out</Tx>
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-[#fffaf5]">
            {/* One-time-per-login notice pointing franchises at the new Claim Process */}
            <ClaimProcessAnnouncement onView={() => setActiveModule('claim-process')} />
            {/* The monthly feedback reminder, when the admin has it on and this store has not filled it. */}
            {isFranchise && <FeedbackReminder onFill={() => setActiveModule('feedback')} />}

            <DashboardSidebar
                activeModule={activeModule}
                onModuleChange={setActiveModule}
                isCollapsed={isCollapsed}
                onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
            />

            <div className="flex-1 flex flex-col overflow-hidden relative">
                <ModuleLayout
                    title={getModuleTitle()}
                    description={activeModule === 'home' ? tr(`Welcome back, ${user.name}`, `वापसी पर स्वागत है, ${user.name}`) : undefined}
                    isCollapsed={isCollapsed}
                    actions={getModuleActions()}
                    onNavigate={setActiveModule}
                    onLinkClick={handleInternalLink}
                    onMenuToggle={() => setIsMobileMenuOpen(true)}
                >
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-[400px] gap-4">
                            <Loader2 className="h-8 w-8 text-primary animate-spin" />
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Synchronizing Module...</p>
                        </div>
                    ) : renderModule()}
                </ModuleLayout>

                {/* Modals for Registration */}
                <Dialog open={!!registrationType} onOpenChange={() => setRegistrationType(null)}>
                    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-bold">
                                {registrationType === 'ev' ? 'PPF Product Registration' : 'Seat Cover Registration'}
                            </DialogTitle>
                        </DialogHeader>
                        {registrationType === 'ev' ? (
                            <EVProductsForm embedded onSuccess={() => { setRegistrationType(null); fetchAllData(); }} />
                        ) : (
                            <SeatCoverForm onSuccess={() => { setRegistrationType(null); fetchAllData(); }} />
                        )}
                    </DialogContent>
                </Dialog>

                {/* Edit Warranty Dialog */}
                <Dialog open={!!editingWarranty} onOpenChange={(open) => !open && setEditingWarranty(null)}>
                    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-bold">Edit & Resubmit Warranty</DialogTitle>
                            <DialogDescription>Update the details for the warranty and resubmit for approval.</DialogDescription>
                        </DialogHeader>
                        {editingWarranty && (() => {
                            const FormComponent = getWarrantyFormComponent(editingWarranty.product_type);
                            const formProps = getEditFormProps(editingWarranty, () => {
                                setEditingWarranty(null);
                                fetchAllData();
                                fetchStats();
                            });
                            return <FormComponent {...formProps} />;
                        })()}
                    </DialogContent>
                </Dialog>

                {/* Spec Sheet Drawer */}
                <WarrantySpecSheet
                    warranty={selectedWarranty}
                    isOpen={!!selectedWarranty}
                    onClose={() => setSelectedWarranty(null)}
                />

                {/* Selective Export Dialog */}
                <SelectiveExportDialog
                    isOpen={exportDialogOpen}
                    onClose={() => setExportDialogOpen(false)}
                    onExport={handleSelectiveExport}
                    title="Selective Warranty Export"
                    description="Choose the information you want to include in your CSV report."
                />

                {/* Manpower Warranty Details Dialog */}
                <Dialog open={manpowerWarrantyDialogOpen} onOpenChange={setManpowerWarrantyDialogOpen}>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="text-xl font-bold">
                                {manpowerWarrantyDialogData.member?.name} - {manpowerWarrantyDialogData.status === 'validated' ? 'Approved' : manpowerWarrantyDialogData.status === 'rejected' ? 'Action Required' : 'Pending'} Warranties
                            </DialogTitle>
                            <DialogDescription>
                                {manpowerWarrantyDialogData.warranties.length} entries found
                            </DialogDescription>
                        </DialogHeader>
                        <div className="mt-6 space-y-4">
                            {manpowerWarrantyDialogData.warranties.length === 0 ? (
                                <p className="text-center py-12 text-muted-foreground font-medium">No warranties found in this category.</p>
                            ) : (
                                manpowerWarrantyDialogData.warranties.map((w: any) => (
                                    <div key={w.id} className="p-4 border rounded-xl bg-muted/30 hover:bg-muted/50 transition-all group">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <p className="font-bold text-base group-hover:text-primary transition-colors">{w.customer_name}</p>
                                                <p className="text-xs text-muted-foreground font-medium">{w.customer_phone}</p>
                                            </div>
                                            <Badge variant="outline" className="bg-background/80 font-bold uppercase text-[10px]">
                                                {w.product_type}
                                            </Badge>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4 text-xs">
                                            <div>
                                                <p className="text-muted-foreground mb-1 uppercase tracking-tighter font-bold">Vehicle</p>
                                                <p className="font-semibold">{w.car_make} {w.car_model}</p>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground mb-1 uppercase tracking-tighter font-bold">Date</p>
                                                <p className="font-semibold">{formatToIST(w.created_at)}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </DialogContent>
                </Dialog>


                {/* Mobile Menu Drawer */}
                <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                    <SheetContent side="left" className="w-80 p-0 border-none bg-white rounded-r-[40px] flex flex-col">
                        <SheetHeader className="sr-only">
                            <SheetTitle>Mobile Navigation Menu</SheetTitle>
                            <DialogDescription>Access dashboard modules and navigation links</DialogDescription>
                        </SheetHeader>

                        <nav className="flex-1 py-6 px-4 space-y-8 overflow-y-auto custom-scrollbar">
                            {filteredMenuGroups.map((group) => (
                                <div key={group.label} className="space-y-3">
                                    <h2 className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                        <Tx>{group.label}</Tx>
                                    </h2>
                                    <div className="space-y-1">
                                        {group.items.map((item) => (
                                            <div key={item.id} className="space-y-1">
                                                <SidebarItem
                                                    icon={item.icon}
                                                    label={item.label}
                                                    active={activeModule === item.id}
                                                    onClick={() => {
                                                        setActiveModule(item.id);
                                                        if ((item.id as string) !== 'catalogue') setIsMobileMenuOpen(false);
                                                    }}
                                                    comingSoon={'comingSoon' in item ? item.comingSoon : undefined}
                                                />
                                                {/* No menu item is 'catalogue' now (the e-catalogue is 'ecatalogue'),
                                                    so this sub-list does not show; kept for when it returns. */}
                                                {(item.id as string) === 'catalogue' && (activeModule as string) === 'catalogue' && (
                                                    <div className="pl-12 py-1 space-y-1 animate-in slide-in-from-top-2 duration-300">
                                                        <button
                                                            onClick={() => {
                                                                setViewingProductId(null);
                                                                setViewingCategoryId(null);
                                                                setIsMobileMenuOpen(false);
                                                            }}
                                                            className={cn(
                                                                "w-full text-left py-2 px-3 text-[11px] font-bold uppercase tracking-wider rounded-xl transition-colors",
                                                                (!viewingProductId && !viewingCategoryId) ? "bg-orange-600 text-white" : "text-slate-500 hover:bg-slate-50"
                                                            )}
                                                        >
                                                            All Products
                                                        </button>
                                                        {(() => {
                                                            const priority = ["seat cover", "accessories", "mat"];
                                                            const mainCats = categories.filter(c => !c.parentId).sort((a, b) => {
                                                                const aName = a.name.toLowerCase();
                                                                const bName = b.name.toLowerCase();
                                                                const aIdx = priority.findIndex(p => aName.includes(p));
                                                                const bIdx = priority.findIndex(p => bName.includes(p));
                                                                if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                                                                if (aIdx !== -1) return -1;
                                                                if (bIdx !== -1) return 1;
                                                                return aName.localeCompare(bName);
                                                            });

                                                            return mainCats.map(mainCat => {
                                                                const hasSub = categories.some(sc => sc.parentId === mainCat.id);
                                                                const isExpanded = expandedMobileCategory === mainCat.id;

                                                                return (
                                                                    <div key={mainCat.id} className="space-y-1">
                                                                        <button
                                                                            onClick={() => {
                                                                                setViewingCategoryId(mainCat.id);
                                                                                if (hasSub) {
                                                                                    setExpandedMobileCategory(isExpanded ? null : mainCat.id);
                                                                                } else {
                                                                                    setIsMobileMenuOpen(false);
                                                                                }
                                                                            }}
                                                                            className={cn(
                                                                                "w-full flex items-center justify-between py-2.5 px-3 text-[11px] font-bold uppercase tracking-wider rounded-xl transition-all",
                                                                                viewingCategoryId === mainCat.id ? "bg-orange-500 text-white" : "text-slate-600 hover:bg-slate-50"
                                                                            )}
                                                                        >
                                                                            <span>{mainCat.name}</span>
                                                                            {hasSub && (
                                                                                <ChevronRight className={cn(
                                                                                    "h-3 w-3 transition-transform duration-300",
                                                                                    isExpanded ? "rotate-90" : ""
                                                                                )} />
                                                                            )}
                                                                        </button>

                                                                        {hasSub && isExpanded && (
                                                                            <div className="pl-4 py-1 space-y-1 border-l-2 border-orange-100 ml-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                                                                {categories.filter(sc => sc.parentId === mainCat.id).map(subCat => (
                                                                                    <button
                                                                                        key={subCat.id}
                                                                                        onClick={() => {
                                                                                            setViewingCategoryId(subCat.id);
                                                                                            setIsMobileMenuOpen(false);
                                                                                        }}
                                                                                        className={cn(
                                                                                            "w-full text-left py-2 px-3 text-[10px] font-bold uppercase tracking-tighter rounded-lg transition-colors",
                                                                                            viewingCategoryId === subCat.id ? "text-orange-600 bg-orange-50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                                                                                        )}
                                                                                    >
                                                                                        {subCat.name}
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            });
                                                        })()}
                                                    </div>
                                                )}
                                            </div>
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

export default FranchiseDashboard;
