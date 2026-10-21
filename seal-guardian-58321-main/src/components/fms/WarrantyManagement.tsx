import { useState, useMemo } from "react";
import {
    Search,
    Download,
    ChevronRight,
    ArrowUpDown,
    Check,
    X,
    RefreshCw,
    ShieldCheck,
    Calendar as CalendarIcon,
    XCircle,
    LayoutGrid,
    List,
    Filter,
    Loader2,
    Edit
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { cn, formatToIST, getWarrantyExpiration } from "@/lib/utils";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { Pagination } from "./Pagination";
import { warrantyVehicleNumber } from "@/lib/vehicleNumber";

interface WarrantyManagementProps {
    warranties: any[];
    onRegisterNew: (type: 'ev' | 'seat-cover') => void;
    onExport: () => void;
    onSelect: (warranty: any) => void;
    onEditWarranty?: (warranty: any) => void;
    onVerify: (warranty: any) => void;
    onReject: (warranty: any) => void;
    warrantySearch: string;
    setWarrantySearch: (q: string) => void;
    selectedProduct: string;
    setSelectedProduct: (val: string) => void;
    selectedMake: string;
    setSelectedMake: (val: string) => void;
    selectedModel: string;
    setSelectedModel: (val: string) => void;
    dateRange: DateRange | undefined;
    setDateRange: (range: DateRange | undefined) => void;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    actionLoadingId?: string | null;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    pagination?: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
    };
    onPageChange?: (page: number) => void;
    onRowsPerPageChange?: (limit: number) => void;
    stats?: {
        pending_vendor: number;
        pending: number;
        validated: number;
        rejected: number;
    };
}

export const WarrantyManagement = ({
    warranties,
    onRegisterNew,
    onExport,
    onSelect,
    onEditWarranty,
    onVerify,
    onReject,
    warrantySearch,
    setWarrantySearch,
    selectedProduct,
    setSelectedProduct,
    selectedMake,
    setSelectedMake,
    selectedModel,
    setSelectedModel,
    dateRange,
    setDateRange,
    activeTab,
    setActiveTab,
    actionLoadingId,
    onRefresh,
    isRefreshing = false,
    pagination,
    onPageChange,
    onRowsPerPageChange,
    stats: serverStats
}: WarrantyManagementProps) => {
    // View control states remain local
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [showFilters, setShowFilters] = useState(false);

    // Sort State
    const [sortConfig, setSortConfig] = useState<{ field: string; order: 'asc' | 'desc' }>({
        field: 'created_at',
        order: 'desc'
    });

    const toTitleCase = (str: string) => {
        if (!str) return str;
        return str.replace(/[_-]/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
    };

    // Derived Data for Filters
    const uniqueMakes = useMemo(() => {
        const makes = Array.from(new Set(warranties.map(w => w.car_make).filter(Boolean)));
        return makes.sort();
    }, [warranties]);

    const uniqueModels = useMemo(() => {
        const models = Array.from(new Set(
            warranties
                .filter(w => selectedMake === 'all' || w.car_make === selectedMake)
                .map(w => w.car_model)
                .filter(Boolean)
        ));
        return models.sort();
    }, [warranties, selectedMake]);

    // Data is now pre-filtered by the server and passed via props
    // Data is now pre-filtered by the server and passed via props
    const processedItems = (status: string) => {
        // Since the server filters by status only if we pass the param, 
        // but the UI has TABS for status.
        // Requirement Check: Does the parent send 'status' param based on the active tab?
        // Yes, FranchiseDashboard sends `activeStatusTab`.
        // HOWEVER, the logic in FranchiseDashboard sends status param. 
        // So `warranties` prop already SHOULD contains only the relevant status items.
        // BUT, wait... 
        // If I click "Approved" tab in `WarrantyManagement`, it calls `setActiveTab` prop.
        // `FranchiseDashboard` updates state -> triggers fetch -> returns only "approved" warranties.
        // So `warranties` array essentially ONLY has approved warranties.
        // So filtering by status LOCALLY again is redundant but harmless if we check for match, 
        // OR we might need to just return all warranties if they are already filtered.

        // Critical Check: 
        // If the user switches tab, `FranchiseDashboard` fetches new data.
        // While fetching, `warranties` might still be old or empty.
        // But fundamentally, `warranties` prop IS the data to show.

        return warranties;
    };

    const getStatusLabel = (tab: string) => {
        switch (tab) {
            case 'all': return 'All';
            case 'validated': return 'Approved';
            case 'pending_ho': return 'Verified';
            case 'pending': return 'Pending';
            case 'rejected': return 'Action Required';
            default: return tab;
        }
    };

    const getTabDescription = (tab: string) => {
        switch (tab) {
            case 'all':
                return 'All warranty registrations across all statuses';
            case 'validated':
                return 'Warranties approved by admin — fully verified and active';
            case 'pending_ho':
                return 'Warranties verified by franchise, pending admin approval';
            case 'pending':
                return 'New registrations pending verification by franchise';
            case 'rejected':
                return 'Warranties requiring action due to invalid or incomplete information';
            default:
                return '';
        }
    };

    const clearFilters = () => {
        setSelectedProduct('all');
        setSelectedMake('all');
        setSelectedModel('all');
        setDateRange(undefined);
    };

    // Stats are now likely coming from props or separate API, 
    // but for now we can't easily calculate "all" stats from a "filtered" list.
    // If the server returns paginated data for "approved", we don't know the count of "rejected".
    // 
    // Ideally, the parent should pass `stats` object with counts.
    // However, `WarrantyManagement` props doesn't have `stats`.
    // The previous implementation calculated stats from the FULL loaded list (client side).
    // Now that we paginate server-side, `warranties` is only a page.
    // We cannot verify these counts accurately anymore locally.

    // Quick Fix: 
    // We will leave these as 0 or ? for now, OR we need the backend to return status counts in the metadata.
    // Since `stats` object was used for the BADGES on tabs.
    // I highly recommend we might need a separate call or meta info.
    // For this step, I'll temporarily set them to 0 or use the current length, but they will be inaccurate.
    // Let's modify the UI to hide the count badges if they are not accurate, or 
    // check if `FranchiseDashboard` can fetch them.
    // 
    // Actually, `FranchiseDashboard` computes `homeStats` (lines 422 in FranchiseDashboard).
    // But `homeStats` is calculated from `warranties.length` which is now paginated (e.g. 10 items). 
    // So the counts on the Home Screen will ALSO be wrong (showing 10 instead of total).

    // This is a CRITICAL regression risk.
    // Backend `getDashboardStats` exists!
    // I should use `getDashboardStats` in `FranchiseDashboard` to populate the stats, 
    // instead of `warranties.filter(...)`.

    // Map server stats to UI stats
    // server 'pending' -> UI 'verified' (HO Pending)
    // server 'pending_vendor' -> UI 'pending' (Vendor Pending)
    // server 'validated' -> UI 'approved'
    const stats = useMemo(() => {
        if (!serverStats) return { pending: 0, approved: 0, verified: 0, rejected: 0 };
        return {
            pending: serverStats.pending_vendor || 0,
            verified: serverStats.pending || 0,
            approved: serverStats.validated || 0,
            rejected: serverStats.rejected || 0,
        };
    }, [serverStats]);

    const renderList = (status: string) => {
        const items = processedItems(status);

        if (items.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center py-16 text-center border rounded-2xl border-dashed border-orange-100 bg-orange-50/20">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-4 border border-orange-100 shadow-sm">
                        <ShieldCheck className="h-8 w-8 text-orange-200" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-700">No Warranties Found</h3>
                    <p className="text-sm text-slate-400 mt-1 max-w-xs mx-auto">
                        There are no records matching your current filter.
                    </p>
                </div>
            );
        }

        return (
            <>
                <div className={cn(
                    "mt-4 md:mt-6 animate-in fade-in slide-in-from-bottom-4 duration-500",
                    viewMode === 'grid' ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6" : "space-y-3"
                )}>
                    {items.map((warranty, index) => {
                        const isSeatCover = warranty.product_type === 'seat-cover';

                        if (viewMode === 'list') {
                            return (
                                <div key={warranty.id || index} className="group flex flex-col">
                                    <div
                                        onClick={() => onSelect(warranty)}
                                        className={cn(
                                            "relative flex flex-col md:flex-row md:items-center gap-3 md:gap-4 p-4 md:p-4 bg-white hover:bg-orange-50/50 transition-all duration-300 rounded-2xl border border-orange-100 hover:border-orange-200 shadow-sm hover:shadow-md cursor-pointer active:scale-[0.99] z-10",
                                            "before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-1 md:before:w-1.5 before:h-0 before:bg-gradient-to-b before:from-orange-500 before:to-orange-400 before:rounded-full before:transition-all before:duration-300 hover:before:h-8"
                                        )}
                                    >
                                        <div className="flex-1 flex items-center gap-4 min-w-0">
                                            <div className={cn(
                                                "h-10 w-10 md:h-12 md:w-12 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-300 group-hover:scale-105",
                                                isSeatCover ? "bg-red-50 border-red-200/60" : "bg-blue-50 border-blue-200/60"
                                            )}>
                                                <img
                                                    src={isSeatCover ? "/seat-cover-icon.png" : "/ppf-icon.png"}
                                                    alt="Icon"
                                                    className="w-6 h-6 md:w-7 md:w-7 object-contain"
                                                />
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <h4 className="font-bold text-sm md:text-base text-slate-800 truncate pr-2 tracking-tight">
                                                        {warrantyVehicleNumber(warranty) || toTitleCase(warranty.customer_name) || 'Warranty'}
                                                    </h4>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2 text-[10px] md:text-xs text-slate-500 font-medium tracking-tight truncate uppercase">
                                                        <span className={cn(
                                                            "font-black text-[9px] md:text-[10px]",
                                                            isSeatCover ? "text-red-500" : "text-blue-500"
                                                        )}>{(warranty.product_type === 'ev-products' ? 'PPF' : toTitleCase(warranty.product_type?.replace(/-/g, ' '))) || ''}</span>
                                                        <span className="text-slate-300">•</span>
                                                        <span className="text-slate-600 truncate font-black">{toTitleCase(warranty.customer_name)}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-[9px] md:text-[10px] font-bold text-slate-400">
                                                        <span className="flex items-center gap-1"><CalendarIcon className="h-3 w-3 text-orange-400" /> {formatToIST(warranty.purchase_date || warranty.created_at).split(',')[0]}</span>
                                                        {!isSeatCover && (warranty.car_make || warranty.car_model) && (
                                                            <>
                                                                <span className="text-slate-200">|</span>
                                                                <span className="font-bold text-slate-600 uppercase tracking-tight">
                                                                    {toTitleCase(warranty.car_make || '')} {toTitleCase(warranty.car_model || '')}
                                                                </span>
                                                            </>
                                                        )}
                                                        <span className="text-slate-200">|</span>
                                                        <span className="font-mono">{warranty.uid}</span>
                                                    </div>
                                                    {warranty.status === 'rejected' && warranty.rejection_reason && (
                                                        <div className="mt-1 space-y-2">
                                                            <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50/50 border border-red-100/50 max-w-md">
                                                                <XCircle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />
                                                                <p className="text-[9px] md:text-[10px] font-bold text-red-600 line-clamp-1 italic">Reason: {warranty.rejection_reason}</p>
                                                            </div>
                                                            {onEditWarranty && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-8 rounded-xl border-red-200 text-red-700 hover:bg-red-50 text-[10px] font-black uppercase tracking-wider"
                                                                    onClick={(e) => { e.stopPropagation(); onEditWarranty(warranty); }}
                                                                >
                                                                    <Edit className="h-3 w-3 mr-2" />
                                                                    Edit & Resubmit
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex flex-row md:flex-row items-center justify-between md:justify-end md:shrink-0 gap-3 md:gap-6 mt-2 md:mt-0 pt-3 md:pt-0 border-t md:border-0 border-slate-50">

                                            <div className={cn(
                                                "flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-[0.1em] border min-w-[110px]",
                                                warranty.status === 'validated' ? "bg-green-50 text-green-600 border-green-200" :
                                                    warranty.status === 'pending_vendor' ? "bg-blue-50 text-blue-600 border-blue-200" :
                                                        warranty.status === 'pending' ? "bg-amber-50 text-amber-600 border-amber-200" :
                                                            "bg-red-50 text-red-600 border-red-200"
                                            )}>
                                                <div className="flex items-center gap-1.5">
                                                    <div className={cn(
                                                        "w-1.5 h-1.5 rounded-full",
                                                        warranty.status === 'validated' ? "bg-green-500" :
                                                            warranty.status === 'pending_vendor' ? "bg-blue-500 animate-pulse" :
                                                                warranty.status === 'pending' ? "bg-amber-500" : "bg-red-500"
                                                    )} />
                                                    <span className="truncate max-w-[80px] sm:max-w-none">
                                                        {warranty.status === 'pending_vendor' ? 'Verify Now' :
                                                            warranty.status === 'pending' ? 'H.O Review' :
                                                                warranty.status === 'validated' ? 'Approved' : 'Action Required'}
                                                    </span>
                                                </div>
                                                {warranty.status === 'validated' && (
                                                    <span className="hidden lg:inline text-[8px] font-black opacity-70">
                                                        {getWarrantyExpiration(warranty.validated_at || warranty.created_at, warranty.warranty_type, warranty.purchase_date).daysLeft} Days Left
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-1.5 shadow-sm rounded-full bg-slate-50 p-0.5 md:p-0 md:bg-transparent md:shadow-none">
                                                {warranty.status === 'pending_vendor' && (
                                                    <>
                                                        <Button
                                                            size="icon"
                                                            className="h-7 w-7 md:h-8 md:w-8 rounded-full bg-green-600 hover:bg-green-700 text-white shadow-md active:scale-90 transition-all"
                                                            onClick={(e) => { e.stopPropagation(); onVerify(warranty); }}
                                                            disabled={!!actionLoadingId}
                                                        >
                                                            {actionLoadingId && actionLoadingId === (warranty.uid || warranty.id) ? (
                                                                <Loader2 className="h-3.5 w-3.5 md:h-4 md:w-4 animate-spin" />
                                                            ) : (
                                                                <Check className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                                            )}
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="destructive"
                                                            className="h-7 w-7 md:h-8 md:w-8 rounded-full shadow-md active:scale-90 transition-all"
                                                            onClick={(e) => { e.stopPropagation(); onReject(warranty); }}
                                                            disabled={!!actionLoadingId}
                                                        >
                                                            <X className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // Grid View
                        return (
                            <div
                                key={warranty.id || index}
                                onClick={() => onSelect(warranty)}
                                className={cn(
                                    "group relative flex flex-col overflow-hidden rounded-[32px] p-6 cursor-pointer transition-all duration-500 active:scale-[0.98]",
                                    "bg-white hover:bg-orange-50/30",
                                    "border border-orange-100 hover:border-orange-200",
                                    "shadow-sm hover:shadow-xl hover:shadow-orange-500/5",
                                    "hover:-translate-y-1.5",
                                    "before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-1.5 before:h-0 before:bg-gradient-to-b before:from-orange-500 before:to-orange-400 before:rounded-full before:transition-all before:duration-500 hover:before:h-16"
                                )}
                            >
                                <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl -mr-10 -mt-10 opacity-30 group-hover:opacity-50 transition-opacity duration-500 bg-orange-200" />

                                <div className="relative flex items-start justify-between mb-6">
                                    <div className="flex-1 min-w-0 pr-4">
                                        <h4 className="font-bold text-lg text-slate-900 truncate leading-tight">
                                            {warrantyVehicleNumber(warranty) || toTitleCase(warranty.customer_name) || 'Warranty'}
                                        </h4>

                                        <div className="flex items-center gap-2 mt-2">
                                            <Badge variant="outline" className={cn(
                                                "font-bold text-[10px] px-2.5 py-0.5 border-0 shadow-sm",
                                                isSeatCover ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-500"
                                            )}>
                                                {warranty.product_type === 'ev-products' ? 'Paint Protection Film' : toTitleCase(warranty.product_type?.replace('-', ' '))}
                                                {!isSeatCover && (warranty.car_make || warranty.car_model) && ` • ${toTitleCase(warranty.car_make || '')} ${toTitleCase(warranty.car_model || '')}`}
                                            </Badge>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{formatToIST(warranty.purchase_date || warranty.created_at).split(',')[0]}</span>
                                        </div>
                                    </div>

                                    <div className={cn(
                                        "relative h-14 w-14 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-500 group-hover:scale-110 shadow-lg shadow-orange-500/5",
                                        isSeatCover ? "bg-red-50 border border-red-100" : "bg-blue-50 border border-blue-100"
                                    )}>
                                        <img
                                            src={isSeatCover ? "/seat-cover-icon.png" : "/ppf-icon.png"}
                                            alt="Icon"
                                            className="w-8 h-8 object-contain opacity-80"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-3 mb-6 flex-1">
                                    <div className="p-4 rounded-2xl bg-orange-50/50 border border-orange-100/60 group-hover:bg-white transition-colors duration-500 shadow-inner">
                                        <div className="flex justify-between items-center mb-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                            <span>Customer Info</span>
                                            <span>UID / Serial</span>
                                        </div>
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="flex-1 min-w-0">
                                                <span className="font-bold text-sm text-slate-700 truncate block">{toTitleCase(warranty.customer_name)}</span>
                                                <span className="text-[10px] font-bold text-slate-400 block mt-0.5">{warranty.customer_phone}</span>
                                            </div>
                                            <span className="font-mono font-black text-xs text-orange-600 truncate">{warranty.uid}</span>
                                        </div>
                                        {warranty.status === 'rejected' && warranty.rejection_reason && (
                                            <div className="mt-3 pt-3 border-t border-orange-100/50 space-y-2">
                                                <div className="flex items-start gap-2 p-2 rounded-xl bg-red-50/50 border border-red-100/30">
                                                    <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[9px] font-black text-red-700/50 uppercase tracking-widest leading-none mb-1">Rejection Reason</p>
                                                        <p className="text-[10px] font-bold text-red-600 italic leading-tight line-clamp-2">{warranty.rejection_reason}</p>
                                                    </div>
                                                </div>
                                                {onEditWarranty && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="w-full h-9 rounded-xl border-red-200 text-red-700 hover:bg-red-50 text-[10px] font-black uppercase tracking-wider shadow-sm"
                                                        onClick={(e) => { e.stopPropagation(); onEditWarranty(warranty); }}
                                                    >
                                                        <Edit className="h-3.5 w-3.5 mr-2" />
                                                        Edit & Resubmit
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-5 border-t border-slate-100">
                                    <div className={cn(
                                        "flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border",
                                        warranty.status === 'validated' ? "bg-green-50 text-green-600 border-green-200" :
                                            warranty.status === 'pending_vendor' ? "bg-blue-50 text-blue-600 border-blue-200" :
                                                warranty.status === 'pending' ? "bg-amber-50 text-amber-600 border-amber-200" :
                                                    "bg-red-50 text-red-600 border-red-200"
                                    )}>
                                        <div className="flex flex-col items-center gap-0.5">
                                            <div className="flex items-center gap-2">
                                                <div className={cn(
                                                    "w-2 h-2 rounded-full",
                                                    warranty.status === 'validated' ? "bg-green-500" :
                                                        warranty.status === 'pending_vendor' ? "bg-blue-500 animate-pulse" :
                                                            warranty.status === 'pending' ? "bg-amber-500" : "bg-red-500"
                                                )} />
                                                {warranty.status === 'pending_vendor' ? 'Verify Now' :
                                                    warranty.status === 'pending' ? 'H.O Review' :
                                                        warranty.status === 'validated' ? 'Approved' : 'Action Required'}
                                            </div>
                                            {warranty.status === 'validated' && (
                                                <span className="hidden lg:inline text-[8px] font-black opacity-70">
                                                    {getWarrantyExpiration(warranty.validated_at || warranty.created_at, warranty.warranty_type, warranty.purchase_date).daysLeft} Days Left
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {warranty.status === 'pending_vendor' && (
                                            <div className="flex gap-1.5">
                                                <Button
                                                    size="sm"
                                                    onClick={(e) => { e.stopPropagation(); onVerify(warranty); }}
                                                    className="h-10 w-10 rounded-full bg-green-600 hover:bg-green-700 text-white shadow-lg active:scale-95 transition-all"
                                                    disabled={!!actionLoadingId}
                                                >
                                                    {actionLoadingId && actionLoadingId === (warranty.uid || warranty.id) ? (
                                                        <Loader2 className="h-5 w-5 animate-spin" />
                                                    ) : (
                                                        <Check className="h-5 w-5" />
                                                    )}
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    onClick={(e) => { e.stopPropagation(); onReject(warranty); }}
                                                    className="h-10 w-10 rounded-full shadow-lg active:scale-95 transition-all"
                                                    disabled={!!actionLoadingId}
                                                >
                                                    <X className="h-5 w-5" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {pagination && onPageChange && (
                    <div className="mt-12 flex justify-end">
                        <Pagination
                            currentPage={pagination.currentPage}
                            totalPages={pagination.totalPages}
                            onPageChange={onPageChange}
                            rowsPerPage={pagination.limit}
                            onRowsPerPageChange={onRowsPerPageChange}
                        />
                    </div>
                )}
            </>
        );
    };

    return (
        <div className="animate-in fade-in duration-700">
            <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="space-y-6"
            >


                {/* ===== MOBILE LAYOUT (lg:hidden) ===== */}
                <div className="lg:hidden space-y-3 mb-4">
                    {/* Mobile Row 1: Search, Refresh, Filter, Export */}
                    <div className="flex items-center gap-2">
                        <div className="relative group flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                            <input
                                type="text"
                                placeholder="Search..."
                                className="w-full h-10 pl-10 pr-3 rounded-xl border border-slate-100 bg-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/20 focus-visible:border-orange-500/30 text-sm transition-all shadow-sm"
                                value={warrantySearch}
                                onChange={(e) => setWarrantySearch(e.target.value)}
                            />
                        </div>
                        {onRefresh && (
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                className="h-10 w-10 rounded-xl border-orange-100 text-orange-600 hover:bg-orange-50 shadow-sm shrink-0"
                                title="Refresh"
                            >
                                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            onClick={() => setShowFilters(!showFilters)}
                            className={cn(
                                "h-10 w-10 rounded-xl border-orange-100 shadow-sm shrink-0",
                                showFilters ? "bg-orange-500 text-white border-orange-500" : "bg-white text-slate-700 hover:bg-orange-50 hover:text-orange-600"
                            )}
                            title="Filters"
                        >
                            <div className="relative">
                                <Filter className="h-4 w-4" />
                                {(selectedProduct !== 'all' || selectedMake !== 'all' || selectedModel !== 'all' || dateRange) && (
                                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500 border border-white" />
                                )}
                            </div>
                        </Button>
                        <Button
                            onClick={onExport}
                            className="h-10 w-10 rounded-xl bg-[#f46617] hover:bg-[#d85512] text-white shadow-sm shrink-0"
                            title="Export"
                        >
                            <Download className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Mobile Row 2: View Toggle + Status Dropdown */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-orange-100 shadow-sm">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewMode('grid')}
                                className={cn(
                                    "rounded-lg h-8 px-3",
                                    viewMode === 'grid' ? "bg-orange-50 text-orange-600" : "text-slate-400"
                                )}
                            >
                                <LayoutGrid className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewMode('list')}
                                className={cn(
                                    "rounded-lg h-8 px-3",
                                    viewMode === 'list' ? "bg-orange-50 text-orange-600" : "text-slate-400"
                                )}
                            >
                                <List className="h-4 w-4" />
                            </Button>
                        </div>

                        <div className="flex-1">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className="w-full h-10 rounded-xl border-orange-100 bg-white font-bold flex items-center justify-between px-4 shadow-sm"
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="w-1 h-5 bg-orange-500 rounded-full" />
                                            <span className="text-[10px] uppercase tracking-wider font-black text-slate-400">Status:</span>
                                            <span className="text-xs font-black text-orange-600 uppercase">{getStatusLabel(activeTab)}</span>
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-orange-500 rotate-90" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-[calc(100vw-2rem)] p-4 rounded-3xl border-orange-100 shadow-2xl bg-white mt-2 z-[100]" align="center">
                                    <div className="space-y-1">
                                        <div className="flex justify-center mb-4">
                                            <div
                                                onClick={() => setActiveTab('all')}
                                                className={cn(
                                                    "px-6 py-2 rounded-full text-xs font-black uppercase cursor-pointer border",
                                                    activeTab === 'all' ? "bg-orange-500 text-white border-orange-400" : "bg-orange-50 text-orange-600 border-orange-100"
                                                )}
                                            >
                                                All
                                            </div>
                                        </div>
                                        <DropdownMenuItem onClick={() => setActiveTab('validated')} className="flex flex-col items-start p-3 rounded-2xl cursor-pointer hover:bg-green-50">
                                            <div className="flex items-center justify-between w-full">
                                                <span className={cn("text-xs font-black uppercase", activeTab === 'validated' ? "text-green-600" : "text-slate-500")}>Approved</span>
                                                <Badge className="bg-green-100 text-green-700 font-black px-3 py-0.5 rounded-full text-[10px]">{stats.approved}</Badge>
                                            </div>
                                            <span className="text-[10px] text-slate-400 font-medium mt-1">Fully verified and active warranties</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setActiveTab('pending_ho')} className="flex flex-col items-start p-3 rounded-2xl cursor-pointer hover:bg-blue-50">
                                            <div className="flex items-center justify-between w-full">
                                                <span className={cn("text-xs font-black uppercase", activeTab === 'pending_ho' ? "text-blue-600" : "text-slate-500")}>Verified</span>
                                                <Badge className="bg-blue-100 text-blue-700 font-black px-3 py-0.5 rounded-full text-[10px]">{stats.verified}</Badge>
                                            </div>
                                            <span className="text-[10px] text-slate-400 font-medium mt-1">Verified by franchise, pending admin approval</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setActiveTab('pending')} className="flex flex-col items-start p-3 rounded-2xl cursor-pointer hover:bg-amber-50">
                                            <div className="flex items-center justify-between w-full">
                                                <span className={cn("text-xs font-black uppercase", activeTab === 'pending' ? "text-amber-600" : "text-slate-500")}>Pending</span>
                                                <Badge className="bg-amber-100 text-amber-700 font-black px-3 py-0.5 rounded-full text-[10px]">{stats.pending}</Badge>
                                            </div>
                                            <span className="text-[10px] text-slate-400 font-medium mt-1">New registrations pending franchise verification</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setActiveTab('rejected')} className="flex flex-col items-start p-3 rounded-2xl cursor-pointer hover:bg-red-50">
                                            <div className="flex items-center justify-between w-full">
                                                <span className={cn("text-xs font-black uppercase", activeTab === 'rejected' ? "text-red-600" : "text-slate-500")}>Action Required</span>
                                                <Badge className="bg-red-100 text-red-700 font-black px-3 py-0.5 rounded-full text-[10px]">{stats.rejected}</Badge>
                                            </div>
                                            <span className="text-[10px] text-slate-400 font-medium mt-1">Action required due to invalid or incomplete info</span>
                                        </DropdownMenuItem>
                                    </div>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </div>

                {/* ===== DESKTOP LAYOUT (hidden on mobile, visible lg+) ===== */}
                {/* Top Action Bar - Search on Left, Actions on Right */}
                <div className="hidden lg:flex items-center justify-between gap-4 mb-4">
                    <div className="relative group w-96">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                        <input
                            type="text"
                            placeholder="Search warranties..."
                            className="w-full h-11 pl-11 pr-4 py-2.5 rounded-2xl border border-slate-100 bg-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/20 focus-visible:border-orange-500/30 text-sm transition-all shadow-sm"
                            value={warrantySearch}
                            onChange={(e) => setWarrantySearch(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        {onRefresh && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                className="h-10 px-6 rounded-full border-orange-100 text-orange-600 font-bold hover:bg-orange-50 transition-all flex items-center gap-2 shadow-sm text-sm"
                            >
                                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                Refresh
                            </Button>
                        )}
                        <Button
                            onClick={onExport}
                            className="h-10 px-6 rounded-full bg-[#f46617] hover:bg-[#d85512] text-white font-bold text-xs shadow-lg shadow-orange-500/20 transition-all active:scale-95 flex items-center gap-2 uppercase tracking-widest"
                        >
                            <Download className="h-4 w-4" />
                            Export Data
                        </Button>
                    </div>
                </div>

                {/* Desktop Header Container: Tabs + View/Filter Actions */}
                <div className="hidden lg:flex gap-6 items-center justify-between mb-8 py-6 px-2 -mx-2 rounded-3xl border border-orange-100 shadow-sm">
                    {/* Desktop Tabs List */}
                    <TabsList className="relative bg-white/50 p-1 rounded-full h-11 w-auto flex flex-row gap-1 shadow-sm border border-orange-100/50 backdrop-blur-sm">
                        <TabsTrigger
                            value="all"
                            className="relative z-10 rounded-full px-6 py-2 text-xs font-black text-slate-500 data-[state=active]:text-orange-600 data-[state=active]:bg-orange-50/80 data-[state=active]:shadow-sm transition-all duration-300 uppercase tracking-widest"
                        >
                            All
                        </TabsTrigger>
                        <TabsTrigger
                            value="validated"
                            className="relative z-10 rounded-full px-6 py-2 text-xs font-black text-slate-500 data-[state=active]:text-green-600 data-[state=active]:bg-white data-[state=active]:shadow-md transition-all duration-300 flex items-center gap-2 uppercase tracking-widest border border-transparent data-[state=active]:border-green-100"
                        >
                            Approved
                            <span className="py-0.5 px-2 rounded-full bg-green-100 text-green-700 text-[10px] font-black">{stats.approved || 0}</span>
                        </TabsTrigger>
                        <TabsTrigger
                            value="pending_ho"
                            className="relative z-10 rounded-full px-6 py-2 text-xs font-black text-slate-500 data-[state=active]:text-blue-600 data-[state=active]:bg-white data-[state=active]:shadow-md transition-all duration-300 flex items-center gap-2 uppercase tracking-widest border border-transparent data-[state=active]:border-blue-100"
                        >
                            Verified
                            <span className="py-0.5 px-2 rounded-full bg-blue-100 text-blue-700 text-[10px] font-black">{stats.verified || 0}</span>
                        </TabsTrigger>
                        <TabsTrigger
                            value="pending"
                            className="relative z-10 rounded-full px-6 py-2 text-xs font-black text-slate-500 data-[state=active]:text-amber-600 data-[state=active]:bg-white data-[state=active]:shadow-md transition-all duration-300 flex items-center gap-2 uppercase tracking-widest border border-transparent data-[state=active]:border-amber-100"
                        >
                            Pending
                            <span className="py-0.5 px-2 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black">{stats.pending || 0}</span>
                        </TabsTrigger>
                        <TabsTrigger
                            value="rejected"
                            className="relative z-10 rounded-full px-6 py-2 text-xs font-black text-slate-500 data-[state=active]:text-red-600 data-[state=active]:bg-white data-[state=active]:shadow-md transition-all duration-300 flex items-center gap-2 uppercase tracking-widest border border-transparent data-[state=active]:border-red-100"
                        >
                            Action Required
                            <span className="py-0.5 px-2 rounded-full bg-red-100 text-red-700 text-[10px] font-black">{stats.rejected || 0}</span>
                        </TabsTrigger>
                    </TabsList>

                    {/* Desktop View Modes & Filter Toggle */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-white p-1 rounded-full h-11 border border-orange-100 shadow-sm backdrop-blur-sm">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewMode('grid')}
                                className={cn(
                                    "rounded-full h-9 px-4 transition-all",
                                    viewMode === 'grid' ? "bg-orange-50 text-orange-600 border border-orange-200 shadow-sm" : "text-slate-400 hover:text-orange-600"
                                )}
                                title="Card View"
                            >
                                <LayoutGrid className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewMode('list')}
                                className={cn(
                                    "rounded-full h-9 px-4 transition-all",
                                    viewMode === 'list' ? "bg-orange-50 text-orange-600 border border-orange-200 shadow-sm" : "text-slate-400 hover:text-orange-600"
                                )}
                                title="List View"
                            >
                                <List className="h-4 w-4" />
                            </Button>
                        </div>

                        <Button
                            variant="outline"
                            onClick={() => setShowFilters(!showFilters)}
                            className={cn(
                                "h-11 w-11 p-0 rounded-full border-orange-100 transition-all shadow-sm flex items-center justify-center shrink-0",
                                showFilters ? "bg-orange-500 text-white border-orange-500 shadow-orange-500/20 scale-105" : "bg-white text-slate-700 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200"
                            )}
                            title="Toggle Filters"
                        >
                            <div className="relative">
                                <Filter className={cn("h-4 w-4", showFilters ? "animate-pulse" : "")} />
                                {(selectedProduct !== 'all' || selectedMake !== 'all' || selectedModel !== 'all' || dateRange) && (
                                    <span className="absolute -top-1.5 -right-1.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-red-500 border border-white">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                    </span>
                                )}
                            </div>
                        </Button>
                    </div>
                </div>

                {/* Tab Description */}
                <div className="px-1 mb-4 animate-in fade-in duration-300">
                    <p className="text-xs text-slate-500 font-medium flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-orange-400"></span>
                        {getTabDescription(activeTab)}
                    </p>
                </div>

                {/* Advanced Filter & Sort Bar */}
                {showFilters && (
                    <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-center p-4 md:p-6 bg-slate-50/50 rounded-2xl md:rounded-[32px] border border-orange-100/50 animate-in slide-in-from-top-4 fade-in duration-500 mb-8 shadow-inner relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-orange-100/20 blur-3xl rounded-full -mr-32 -mt-32 pointer-events-none" />

                        <div className="flex items-center gap-2 mr-2 relative z-10 w-full md:w-auto">
                            <div className="w-1 h-5 md:w-1.5 md:h-6 bg-orange-500 rounded-full" />
                            <span className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest">Advanced Filters</span>
                        </div>

                        {/* Product Type Search */}
                        <div className="relative z-10 w-full sm:w-[160px] md:w-[180px]">
                            <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                                <SelectTrigger className="w-full h-10 md:h-11 bg-white border-orange-100 rounded-xl md:rounded-2xl text-[10px] md:text-xs font-bold shadow-sm hover:border-orange-200 transition-colors focus:ring-orange-500/20">
                                    <SelectValue placeholder="Product Type" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl md:rounded-2xl border-orange-100 shadow-2xl p-1">
                                    <SelectItem value="all" className="rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold py-2 md:py-2.5">All Categories</SelectItem>
                                    <SelectItem value="seat-cover" className="rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold py-2 md:py-2.5">Seat Cover</SelectItem>
                                    <SelectItem value="ev-products" className="rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold py-2 md:py-2.5">Paint Protection Film</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Make Filter */}
                        <div className="relative z-10 w-full sm:w-[160px] md:w-[180px]">
                            <Select value={selectedMake} onValueChange={(val) => { setSelectedMake(val); setSelectedModel('all'); }}>
                                <SelectTrigger className="w-full h-10 md:h-11 bg-white border-orange-100 rounded-xl md:rounded-2xl text-[10px] md:text-xs font-bold shadow-sm hover:border-orange-200 transition-colors focus:ring-orange-500/20">
                                    <SelectValue placeholder="Vehicle Make" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl md:rounded-2xl border-orange-100 shadow-2xl p-1">
                                    <SelectItem value="all" className="rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold py-2 md:py-2.5">All Makes</SelectItem>
                                    {uniqueMakes.map(make => (
                                        <SelectItem key={make} value={make} className="rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold py-2 md:py-2.5">{toTitleCase(make)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Model Filter */}
                        <div className="relative z-10 w-full sm:w-[160px] md:w-[180px]">
                            <Select value={selectedModel} onValueChange={setSelectedModel} disabled={selectedMake === 'all'}>
                                <SelectTrigger className="w-full h-10 md:h-11 bg-white border-orange-100 rounded-xl md:rounded-2xl text-[10px] md:text-xs font-bold shadow-sm hover:border-orange-200 transition-colors focus:ring-orange-500/20 disabled:opacity-50">
                                    <SelectValue placeholder="Vehicle Model" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl md:rounded-2xl border-orange-100 shadow-2xl p-1">
                                    <SelectItem value="all" className="rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold py-2 md:py-2.5">All Models</SelectItem>
                                    {uniqueModels.map(model => (
                                        <SelectItem key={model} value={model} className="rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold py-2 md:py-2.5">{toTitleCase(model)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Date Range Picker */}
                        <div className="relative z-10 w-full sm:w-[220px] md:w-[260px]">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-full h-10 md:h-11 justify-start text-left font-bold text-[10px] md:text-xs bg-white border-orange-100 rounded-xl md:rounded-2xl shadow-sm hover:bg-white hover:border-orange-200 transition-colors",
                                            !dateRange && "text-slate-400"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 md:mr-3 h-3.5 w-3.5 md:h-4 md:w-4 text-orange-500" />
                                        {dateRange?.from ? (
                                            dateRange.to ? (
                                                <span className="text-slate-700 truncate">
                                                    {format(dateRange.from, "MMM dd")} - {format(dateRange.to, "MMM dd, yy")}
                                                </span>
                                            ) : (
                                                <span className="text-slate-700">{format(dateRange.from, "MMM dd, yyyy")}</span>
                                            )
                                        ) : (
                                            <span className="truncate">Filter by Date Range</span>
                                        )}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 rounded-2xl md:rounded-[32px] border-orange-100 shadow-2xl overflow-hidden mt-2" align="start">
                                    <Calendar
                                        initialFocus
                                        mode="range"
                                        defaultMonth={dateRange?.from}
                                        selected={dateRange}
                                        onSelect={setDateRange}
                                        numberOfMonths={1}
                                        className="p-3 md:p-4"
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>

                        {/* Sort & Tools */}
                        <div className="flex flex-1 items-center gap-2 sm:gap-4 relative z-10 w-full sm:w-auto justify-between sm:justify-end mt-2 sm:mt-0">
                            <div className="h-8 border-l border-orange-200 hidden lg:block" />

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="h-10 md:h-11 px-4 md:px-5 rounded-xl md:rounded-2xl border-orange-100 text-[10px] md:text-xs font-bold bg-white shadow-sm hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-all flex items-center gap-2 md:gap-3">
                                        <ArrowUpDown className="h-3.5 w-3.5 md:h-4 md:w-4 text-orange-500" />
                                        Sort
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="rounded-xl md:rounded-2xl border-orange-100 shadow-2xl w-48 md:w-56 p-2 mt-2" align="end">
                                    <DropdownMenuLabel className="text-[9px] md:text-[10px] uppercase tracking-widest text-slate-400 px-3 py-2">Sort By</DropdownMenuLabel>
                                    <DropdownMenuSeparator className="bg-orange-50" />
                                    <DropdownMenuItem onClick={() => setSortConfig({ ...sortConfig, field: 'created_at' })} className="flex items-center justify-between text-[10px] md:text-xs font-bold py-2.5 md:py-3 px-3 rounded-lg md:rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group">
                                        Latest {sortConfig.field === 'created_at' && <Check className="h-3.5 w-3.5 md:h-4 md:w-4 text-orange-500" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setSortConfig({ ...sortConfig, field: 'customer_name' })} className="flex items-center justify-between text-[10px] md:text-xs font-bold py-2.5 md:py-3 px-3 rounded-lg md:rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group">
                                        Customer {sortConfig.field === 'customer_name' && <Check className="h-3.5 w-3.5 md:h-4 md:w-4 text-orange-500" />}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearFilters}
                                className="text-slate-400 hover:text-red-500 h-10 md:h-11 px-4 md:px-5 rounded-xl md:rounded-2xl hover:bg-red-50 font-bold text-[10px] md:text-xs transition-colors"
                            >
                                <X className="h-3.5 w-3.5 md:h-4 md:w-4 mr-1 md:mr-2" /> Reset
                            </Button>
                        </div>
                    </div>
                )}

                <div className="pt-2">
                    <TabsContent value="all" className="mt-0 outline-none focus-visible:ring-0">{renderList('all')}</TabsContent>
                    <TabsContent value="pending" className="mt-0 outline-none focus-visible:ring-0">{renderList('pending')}</TabsContent>
                    <TabsContent value="pending_ho" className="mt-0 outline-none focus-visible:ring-0">{renderList('pending_ho')}</TabsContent>
                    <TabsContent value="validated" className="mt-0 outline-none focus-visible:ring-0">{renderList('validated')}</TabsContent>
                    <TabsContent value="rejected" className="mt-0 outline-none focus-visible:ring-0">{renderList('rejected')}</TabsContent>
                </div>
            </Tabs>
        </div>
    );
};
