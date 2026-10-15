import { useState, useEffect, useMemo } from "react";
import api from "@/lib/api";
import { downloadCSV, cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
    Card,
    CardContent,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
    Search,
    Download,
    Filter,
    RefreshCw,
    Calendar as CalendarIcon,
    ArrowUpDown,
    Check,
    X,
    Loader2,
    RotateCcw
} from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import { format, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { DateRange } from "react-day-picker";
import { AdminWarrantyList } from "@/components/admin/AdminWarrantyList";
import { QuickReviewPanel } from "@/components/admin/QuickReviewPanel";
import { SelectiveExportDialog } from "@/components/warranty/SelectiveExportDialog";
import { exportWarrantiesToCSV } from "@/lib/adminExports";
import { Skeleton } from "@/components/ui/skeleton";

// Standard reasons offered when declining a warranty. The chosen sentence is
// saved as-is to rejection_reason and shown to the customer, so keep each one
// a complete, customer-readable sentence.
const REJECTION_REASONS = [
    "The product UID does not match the MRP sticker.",
    "The product image does not match the invoice.",
    "The product image is missing.",
    "The vehicle image is missing.",
    "An estimated invoice cannot be accepted.",
    "The invoice or MRP sticker is not attached.",
    "The files are not readable.",
    "The images are phone screenshots.",
    "The product image does not match the product name.",
    "The MRP sticker is not clear. Please attach the invoice.",
    "The vehicle image is not original.",
    "The files are corrupted.",
    "The MRP sticker is torn or damaged.",
    "Vehicle registration number does not match the product image.",
];
const CUSTOM_REJECTION = "__custom__";

const WarrantyListSkeleton = () => (
    <Card className="border-orange-100 shadow-sm overflow-hidden rounded-3xl">
        <CardContent className="p-3 md:p-4 space-y-4">
            {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="rounded-2xl border border-slate-100 p-4 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-12 w-12 rounded-full" />
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-36" />
                                <Skeleton className="h-3 w-24" />
                            </div>
                        </div>
                        <Skeleton className="h-6 w-24 rounded-full" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                </div>
            ))}
        </CardContent>
    </Card>
);

export const AdminWarranties = () => {
    const { toast } = useToast();
    const [warranties, setWarranties] = useState<any[]>([]);
    const [resubmissions, setResubmissions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);
    const [selectedWarranty, setSelectedWarranty] = useState<any>(null);

    // Filters
    const [statusFilter, setStatusFilter] = useState("all");
    const [showFilters, setShowFilters] = useState(false);

    // Advanced Filter State
    const [productTypeFilter, setProductTypeFilter] = useState("all");
    /* Narrows whatever tab is open to the ones already rejected once, rather
       than being a tab of its own — a resubmitted warranty is genuinely
       pending, and moving it out would make the count disagree with the list. */
    const [resubmittedOnly, setResubmittedOnly] = useState(false);
    /* Quick Review steps through both waiting queues; this narrows it to one —
       Pending (with the head office) or Vendor (with the store). */
    const [reviewQueue, setReviewQueue] = useState<'all' | 'pending' | 'pending_vendor'>('all');
    const [selectedMake, setSelectedMake] = useState<string>('all');
    const [selectedModel, setSelectedModel] = useState<string>('all');
    const [dateRange, setDateRange] = useState<DateRange | undefined>();
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");

    // Server-provided list metadata. The UI remains unchanged; only its data source
    // is paginated so the browser never has to load the complete warranty table.
    const [statusCounts, setStatusCounts] = useState({
        validated: 0,
        pending: 0,
        pending_vendor: 0,
        rejected: 0
    });
    const [filterOptions, setFilterOptions] = useState<{ makes: string[]; models: string[] }>({
        makes: [],
        models: []
    });
    const [serverPagination, setServerPagination] = useState({
        currentPage: 1,
        totalPages: 0,
        totalCount: 0,
        limit: 10,
        hasNextPage: false,
        hasPrevPage: false
    });

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    // Sort State
    const [sortConfig, setSortConfig] = useState<{ field: string; order: 'asc' | 'desc' }>({
        field: 'created_at',
        order: 'desc'
    });

    // Action State
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);

    // Rejection Dialog State
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
    // rejectPreset is one of REJECTION_REASONS, CUSTOM_REJECTION, or "" (nothing picked yet);
    // rejectReason is the typed text, used only when CUSTOM_REJECTION is picked.
    const [rejectPreset, setRejectPreset] = useState("");
    const [rejectReason, setRejectReason] = useState("");
    const [rejectingWarrantyId, setRejectingWarrantyId] = useState<string | null>(null);
    const finalRejectReason = rejectPreset === CUSTOM_REJECTION ? rejectReason.trim() : rejectPreset;
    const resetRejectReason = () => {
        setRejectPreset("");
        setRejectReason("");
    };

    const toTitleCase = (str: string) => {
        if (!str) return str;
        return str.replace(/[_-]/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
    };

    // The dropdown contents come from the server so they are not limited to the
    // ten records on the current page.
    const uniqueMakes = filterOptions.makes;
    const uniqueModels = filterOptions.models;

    const clearFilters = () => {
        setProductTypeFilter('all');
        setSelectedMake('all');
        setSelectedModel('all');
        setDateRange(undefined);
        setResubmittedOnly(false);
        setReviewQueue('all');
        setSearch("");
        setCurrentPage(1);
    };

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, productTypeFilter, selectedMake, selectedModel, dateRange, search, resubmittedOnly, reviewQueue]);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
        return () => window.clearTimeout(timer);
    }, [search]);

    const buildWarrantyQuery = (limit = itemsPerPage, exportAll = false, exportPage = 1) => {
        const params = new URLSearchParams({
            page: exportAll ? String(exportPage) : String(currentPage),
            limit: String(limit),
            status: statusFilter === 'quick_review' && reviewQueue !== 'all' ? reviewQueue : statusFilter,
            product_type: productTypeFilter,
            make: selectedMake,
            model: selectedModel,
            sort_by: sortConfig.field,
            sort_order: sortConfig.order
        });

        if (resubmittedOnly) params.set('resubmitted', 'true');

        if (debouncedSearch) params.set('search', debouncedSearch);
        if (dateRange?.from) {
            params.set('date_from', format(dateRange.from, 'yyyy-MM-dd'));
            params.set('date_to', format(dateRange.to || dateRange.from, 'yyyy-MM-dd'));
        }
        if (exportAll) params.set('export', 'true');
        return params.toString();
    };

    const handleSelectiveExport = async (selectedFields: string[]) => {
        try {
            /*
             * Fetched page by page until every matching warranty is in.
             *
             * One request used to ask for 10,000 rows, the server's ceiling for
             * an export — and with 11,727 warranties the file silently stopped
             * at 10,000, dropping the oldest. Pages keep each response a
             * sensible size however many warranties there are. Rows are keyed
             * by id, so one shifted across a page boundary by a new warranty
             * arriving mid-export is not written twice.
             */
            const PAGE = 2000;
            const byId = new Map<string, any>();
            let page = 1;
            let totalPages = 1;
            do {
                const response = await api.get(`/admin/warranties?${buildWarrantyQuery(PAGE, true, page)}`);
                for (const w of response.data.warranties || []) byId.set(String(w.id ?? w.uid), w);
                totalPages = response.data.pagination?.totalPages || 1;
                page++;
            } while (page <= totalPages);
            const exportRecords = [...byId.values()];

            if (exportRecords.length === 0) {
                toast({ description: "No records found to export", variant: "destructive" });
                return;
            }

            exportWarrantiesToCSV(
                exportRecords,
                `warranties_export_${new Date().toISOString().split('T')[0]}.csv`,
                selectedFields
            );

            toast({ title: "Export Successful", description: `Exported ${exportRecords.length} records with ${selectedFields.length} fields` });
            setExportDialogOpen(false);
        } catch (error) {
            console.error("Export failed:", error);
            toast({ title: "Export Failed", variant: "destructive" });
        }
    };

    useEffect(() => {
        fetchWarranties();
        // The individual values intentionally drive a new server request.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, statusFilter, productTypeFilter, selectedMake, selectedModel, dateRange, debouncedSearch, resubmittedOnly, reviewQueue, sortConfig.field, sortConfig.order]);

    const fetchWarranties = async (isRefresh = false) => {
        setLoading(true);
        if (isRefresh) {
            setRefreshKey(prev => prev + 1);
        }

        try {
            const mainRes = await api.get(`/admin/warranties?${buildWarrantyQuery()}&t=${Date.now()}`);

            if (mainRes.data.success) {
                setWarranties(mainRes.data.warranties || []);
                setServerPagination(mainRes.data.pagination);
                setStatusCounts(current => ({ ...current, ...(mainRes.data.statusCounts || {}) }));
                setFilterOptions({
                    makes: mainRes.data.filterOptions?.makes || [],
                    models: mainRes.data.filterOptions?.models || []
                });
            }
            
            if (isRefresh) {
                toast({ description: "Data refreshed" });
            }
        } catch (error) {
            console.error("Failed to fetch warranties", error);
            toast({ variant: "destructive", description: "Failed to refresh" });
        } finally {
            setLoading(false);
        }
    };

    const handleStatusFilterChange = (status: string) => {
        if (status === statusFilter) return;

        // Start the consistent loading state immediately, before the effect
        // issues the request for the selected tab.
        setLoading(true);
        setStatusFilter(status);
    };

    const handleUpdateStatus = async (id: string, status: 'validated' | 'rejected' | 'pending', reason?: string) => {
        setProcessingId(id);
        try {
            if (statusFilter === 'resubmitted') {
                const action = status === 'validated' ? 'approve' : 'reject';
                const response = await api.post(`/admin/warranties/resubmissions/${id}/${action}`, { notes: reason });
                if (response.data.success) {
                    toast({ title: status === 'validated' ? "Resubmission Approved" : "Resubmission Rejected", className: status === 'validated' ? "bg-green-600 text-white" : "bg-red-600 text-white" });
                    setResubmissions(prev => prev.filter(w => w.id !== id && w.original_uid !== id));
                    fetchWarranties(false); // Reload main list slightly after
                }
            } else {
                const response = await api.put(`/admin/warranties/${id}/status`, { status, rejectionReason: reason });
                if (response.data.success) {
                    let toastTitle = "Status Updated";
                    let toastClass = "bg-slate-800 text-white";
                    
                    if (status === 'validated') {
                        toastTitle = "Approved";
                        toastClass = "bg-green-600 text-white";
                    } else if (status === 'rejected') {
                        toastTitle = "Rejected";
                        toastClass = "bg-red-600 text-white";
                    } else if (status === 'pending') {
                        toastTitle = "Moved to Pending";
                        toastClass = "bg-orange-600 text-white";
                    }

                    toast({ title: toastTitle, className: toastClass });
                    // Optimistic update
                    setWarranties(prev => prev.map(w => String(w.id) === String(id) || w.uid === id ? { ...w, status, rejection_reason: reason } : w));
                    await fetchWarranties(false);
                }
            }
        } catch (error) {
            toast({ title: "Update Failed", variant: "destructive" });
        } finally {
            setProcessingId(null);
        }
    };

    // Filtering, sorting, and pagination now happen on the API. Keeping these names
    // means the original rendered UI below stays byte-for-byte structurally intact.
    const filteredWarranties = warranties;

    // Pagination Calculation
    const totalPages = serverPagination.totalPages;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedWarranties = warranties;

    // Auto-select next available warranty when list, page, or filters change (only in Quick Review workstation mode)
    useEffect(() => {
        if (loading || statusFilter !== 'quick_review') return;

        if (paginatedWarranties.length === 0) {
            setSelectedWarranty(null);
            return;
        }

        // Check if previously selected warranty still exists in the active paginated list
        const activeId = selectedWarranty?.uid || selectedWarranty?.id;
        const existsInCurrentPage = paginatedWarranties.find((w: any) => (w.uid || w.id) === activeId);

        if (existsInCurrentPage) {
            // Keep it selected, but update reference to catch any refreshed data fields
            // only if the object reference is actually different to avoid triggering loops
            if (existsInCurrentPage !== selectedWarranty) {
                setSelectedWarranty(existsInCurrentPage);
            }
        } else {
            // If it's gone (or none selected), auto-select the first item of the current page
            setSelectedWarranty(paginatedWarranties[0]);
        }
    }, [filteredWarranties, paginatedWarranties, loading, startIndex, selectedWarranty, statusFilter]);

    // Clear parent selectedWarranty state when not in Quick Review tab
    useEffect(() => {
        if (statusFilter !== 'quick_review') {
            setSelectedWarranty(null);
        }
    }, [statusFilter]);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header / Search / Actions */}
            <div className="flex flex-col xl:flex-row gap-4 justify-between xl:items-center bg-white p-4 rounded-3xl border border-orange-50 shadow-sm">
                <div className="flex flex-col xl:flex-row flex-1 gap-4">
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight shrink-0">Warranty Management</h2>
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder="Search warranties..."
                            className="pl-10 h-11 rounded-xl border-orange-100 bg-white focus:border-orange-300 focus:ring-orange-200"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setShowFilters(!showFilters)}
                        className={cn(
                            "h-11 w-11 rounded-xl border-orange-100 transition-all",
                            showFilters ? "bg-orange-50 text-orange-600 border-orange-200" : "bg-white text-slate-600 hover:bg-orange-50"
                        )}
                    >
                        <Filter className="h-4 w-4" />
                    </Button>

                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => fetchWarranties(true)}
                        disabled={loading}
                        title="Refresh Data"
                        className="h-11 w-11 rounded-xl border-orange-100 hover:bg-orange-50 text-orange-600 shrink-0"
                    >
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </Button>

                    <Button
                        variant="outline"
                        onClick={() => setExportDialogOpen(true)}
                        className="hidden md:flex gap-2 h-11 border-orange-100 hover:bg-orange-50 rounded-xl px-5 font-bold text-slate-600 shadow-sm"
                    >
                        <Download className="h-4 w-4" />
                        <span>EXPORT</span>
                    </Button>
                </div>
            </div>

            {/* Mobile Status Filter */}
            <div className="md:hidden w-full">
                <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
                    <SelectTrigger className="w-full h-11 bg-white border-orange-100 rounded-2xl font-bold shadow-sm">
                        <SelectValue placeholder="Filter by Status" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-orange-100 shadow-xl">
                        <SelectItem value="all">All Warranties</SelectItem>
                        <SelectItem value="validated">Approved</SelectItem>
                        <SelectItem value="pending">Pending Approval</SelectItem>
                        <SelectItem value="pending_vendor">Pending Vendor</SelectItem>
                        <SelectItem value="rejected">Action Required</SelectItem>
                        <SelectItem value="quick_review">Quick Review (Workstation)</SelectItem>

                    </SelectContent>
                </Select>
            </div>

            {/* Desktop Status Tabs */}
            <Tabs value={statusFilter} onValueChange={handleStatusFilterChange} className="hidden md:block w-full xl:w-auto">
                <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 xl:inline-flex h-auto bg-white border border-orange-100 p-1">
                    <TabsTrigger value="all" className="data-[state=active]:bg-orange-50 data-[state=active]:text-orange-700 gap-2">
                        All
                        <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none px-1.5 py-0 h-4 text-[10px] font-bold">
                            {Object.values(statusCounts).reduce((total, count) => total + count, 0)}
                        </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="validated" className="data-[state=active]:bg-green-50 data-[state=active]:text-green-700 gap-2">
                        Approved
                        <Badge variant="secondary" className="bg-green-100/50 text-green-700 border-none px-1.5 py-0 h-4 text-[10px] font-bold">
                            {statusCounts.validated}
                        </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="pending" className="data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700 gap-2">
                        Pending
                        <Badge variant="secondary" className="bg-amber-100/50 text-amber-700 border-none px-1.5 py-0 h-4 text-[10px] font-bold">
                            {statusCounts.pending}
                        </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="pending_vendor" className="data-[state=active]:bg-orange-50 data-[state=active]:text-orange-700 gap-2">
                        Vendor
                        <Badge variant="secondary" className="bg-orange-100/50 text-orange-700 border-none px-1.5 py-0 h-4 text-[10px] font-bold">
                            {statusCounts.pending_vendor}
                        </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="rejected" className="data-[state=active]:bg-red-50 data-[state=active]:text-red-700 gap-2">
                        Action Required
                        <Badge variant="secondary" className="bg-red-100/50 text-red-700 border-none px-1.5 py-0 h-4 text-[10px] font-bold">
                            {statusCounts.rejected}
                        </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="quick_review" className="data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700 gap-2 font-bold text-orange-600 border border-orange-200/50">
                        ⚡ Quick Review
                        <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-none px-1.5 py-0 h-4 text-[10px] font-bold">
                            {reviewQueue === 'pending' ? statusCounts.pending
                                : reviewQueue === 'pending_vendor' ? statusCounts.pending_vendor
                                : statusCounts.pending + statusCounts.pending_vendor}
                        </Badge>
                    </TabsTrigger>

                </TabsList>
            </Tabs>

            {/* Advanced Filters Panel */}
            {showFilters && (
                <div className="flex flex-wrap gap-4 items-center p-6 bg-slate-50/50 rounded-[32px] border border-orange-100/50 animate-in slide-in-from-top-4 fade-in duration-500 mb-8 shadow-inner relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-orange-100/20 blur-3xl rounded-full -mr-32 -mt-32 pointer-events-none" />

                    <div className="flex items-center gap-2 mr-2 relative z-10">
                        <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
                        <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Advanced Filters</span>
                    </div>

                    {/* Quick Review queue: only on that tab, where both queues are mixed. */}
                    {statusFilter === 'quick_review' && (
                        <div className="relative z-10">
                            <Select value={reviewQueue} onValueChange={(v) => setReviewQueue(v as typeof reviewQueue)}>
                                <SelectTrigger className="w-[200px] h-11 bg-white border-orange-100 rounded-2xl text-xs font-bold shadow-sm hover:border-orange-200 transition-colors focus:ring-orange-500/20">
                                    <SelectValue placeholder="Queue" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl border-orange-100 shadow-2xl p-1">
                                    <SelectItem value="all" className="rounded-xl text-xs font-bold py-2.5">Pending + Vendor ({statusCounts.pending + statusCounts.pending_vendor})</SelectItem>
                                    <SelectItem value="pending" className="rounded-xl text-xs font-bold py-2.5">Pending only ({statusCounts.pending})</SelectItem>
                                    <SelectItem value="pending_vendor" className="rounded-xl text-xs font-bold py-2.5">Vendor only ({statusCounts.pending_vendor})</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Product Type Filter */}
                    <div className="relative z-10">
                        <Select value={productTypeFilter} onValueChange={setProductTypeFilter}>
                            <SelectTrigger className="w-[180px] h-11 bg-white border-orange-100 rounded-2xl text-xs font-bold shadow-sm hover:border-orange-200 transition-colors focus:ring-orange-500/20">
                                <SelectValue placeholder="Product Type" />
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-orange-100 shadow-2xl p-1">
                                <SelectItem value="all" className="rounded-xl text-xs font-bold py-2.5">All Categories</SelectItem>
                                <SelectItem value="seat-cover" className="rounded-xl text-xs font-bold py-2.5">Seat Cover</SelectItem>
                                <SelectItem value="ppf" className="rounded-xl text-xs font-bold py-2.5">Paint Protection Film</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Make Filter */}
                    <div className="relative z-10">
                        <Select value={selectedMake} onValueChange={(val) => { setSelectedMake(val); setSelectedModel('all'); }}>
                            <SelectTrigger className="w-[180px] h-11 bg-white border-orange-100 rounded-2xl text-xs font-bold shadow-sm hover:border-orange-200 transition-colors focus:ring-orange-500/20">
                                <SelectValue placeholder="Vehicle Make" />
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-orange-100 shadow-2xl p-1">
                                <SelectItem value="all" className="rounded-xl text-xs font-bold py-2.5">All Makes</SelectItem>
                                {uniqueMakes.map(make => (
                                    <SelectItem key={make} value={make} className="rounded-xl text-xs font-bold py-2.5">{toTitleCase(make)}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Model Filter */}
                    <div className="relative z-10">
                        <Select value={selectedModel} onValueChange={setSelectedModel} disabled={selectedMake === 'all'}>
                            <SelectTrigger className="w-[180px] h-11 bg-white border-orange-100 rounded-2xl text-xs font-bold shadow-sm hover:border-orange-200 transition-colors focus:ring-orange-500/20 disabled:opacity-50">
                                <SelectValue placeholder="Vehicle Model" />
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-orange-100 shadow-2xl p-1">
                                <SelectItem value="all" className="rounded-xl text-xs font-bold py-2.5">All Models</SelectItem>
                                {uniqueModels.map(model => (
                                    <SelectItem key={model} value={model} className="rounded-xl text-xs font-bold py-2.5">{toTitleCase(model)}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Resubmitted — a toggle rather than a dropdown: there are
                        only two answers, and the off state is "everything",
                        which is what every other filter here already means. */}
                    <div className="relative z-10">
                        <Button
                            variant="outline"
                            onClick={() => setResubmittedOnly(v => !v)}
                            aria-pressed={resubmittedOnly}
                            className={cn(
                                "h-11 justify-start text-left font-bold text-xs rounded-2xl shadow-sm transition-colors",
                                resubmittedOnly
                                    ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300"
                                    : "bg-white border-orange-100 text-slate-500 hover:bg-white hover:border-orange-200"
                            )}
                        >
                            <RotateCcw className={cn("mr-3 h-4 w-4", resubmittedOnly ? "text-blue-600" : "text-orange-500")} />
                            Resubmitted only
                        </Button>
                    </div>

                    {/* Date Range Picker */}
                    <div className="relative z-10">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}
                                    className={cn(
                                        "w-[240px] h-11 justify-start text-left font-bold text-xs bg-white border-orange-100 rounded-2xl shadow-sm hover:bg-white hover:border-orange-200 transition-colors",
                                        !dateRange && "text-slate-400"
                                    )}
                                >
                                    <CalendarIcon className="mr-3 h-4 w-4 text-orange-500" />
                                    {dateRange?.from ? (
                                        dateRange.to ? (
                                            <span className="text-slate-700">
                                                {format(dateRange.from, "MMM dd, yyyy")} - {format(dateRange.to, "MMM dd, yyyy")}
                                            </span>
                                        ) : (
                                            <span className="text-slate-700">{format(dateRange.from, "MMM dd, yyyy")}</span>
                                        )
                                    ) : (
                                        <span>Filter by Date Range</span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 rounded-[32px] border-orange-100 shadow-2xl overflow-hidden mt-2" align="start">
                                <Calendar
                                    initialFocus
                                    mode="range"
                                    defaultMonth={dateRange?.from}
                                    selected={dateRange}
                                    onSelect={setDateRange}
                                    numberOfMonths={2}
                                    className="p-4"
                                />
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* Sort & Tools */}
                    <div className="ml-auto flex items-center gap-4 relative z-10">
                        <div className="h-8 border-l border-orange-200 hidden md:block" />

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="h-11 px-5 rounded-2xl border-orange-100 text-xs font-bold bg-white shadow-sm hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-all flex items-center gap-3">
                                    <ArrowUpDown className="h-4 w-4 text-orange-500" />
                                    Sort: {sortConfig.field === 'created_at' ? 'Latest' : sortConfig.field === 'customer_name' ? 'Customer' : toTitleCase(sortConfig.field)}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="rounded-2xl border-orange-100 shadow-2xl w-56 p-2 mt-2">
                                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-400 px-3 py-2">Sort By</DropdownMenuLabel>
                                <DropdownMenuSeparator className="bg-orange-50" />
                                <DropdownMenuItem onClick={() => setSortConfig({ ...sortConfig, field: 'created_at' })} className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group">
                                    Registration Date {sortConfig.field === 'created_at' && <Check className="h-4 w-4 text-orange-500" />}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSortConfig({ ...sortConfig, field: 'purchase_date' })} className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group">
                                    Purchase Date {sortConfig.field === 'purchase_date' && <Check className="h-4 w-4 text-orange-500" />}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSortConfig({ ...sortConfig, field: 'customer_name' })} className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group">
                                    Customer Name {sortConfig.field === 'customer_name' && <Check className="h-4 w-4 text-orange-500" />}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-orange-50" />
                                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-400 px-3 py-2">Order</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => setSortConfig({ ...sortConfig, order: 'desc' })} className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group">
                                    Newest First {sortConfig.order === 'desc' && <Check className="h-4 w-4 text-orange-500" />}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSortConfig({ ...sortConfig, order: 'asc' })} className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group">
                                    Oldest First {sortConfig.order === 'asc' && <Check className="h-4 w-4 text-orange-500" />}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearFilters}
                            className="text-slate-400 hover:text-red-500 h-11 px-5 rounded-2xl hover:bg-red-50 font-bold text-xs transition-colors"
                        >
                            <X className="h-4 w-4 mr-2" /> Reset
                        </Button>
                    </div>
                </div>
            )}

            {loading ? (
                <WarrantyListSkeleton />
            ) : (
            statusFilter === 'quick_review' ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {/* Left Panel: Scrollable List (40% width on lg screens) */}
                    <div className="lg:col-span-5 space-y-4">
                        <Card className="border-orange-100 shadow-sm overflow-hidden rounded-3xl">
                            <CardContent className="p-0">
                                <div key={refreshKey}>
                                    <AdminWarrantyList
                                        items={paginatedWarranties}
                                        isSplitScreen={true}
                                        activeUid={selectedWarranty?.uid || selectedWarranty?.id}
                                        onSelect={(w) => setSelectedWarranty(w)}
                                        showActions={false}
                                        onRefresh={() => fetchWarranties(false)}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right Panel: Quick Review Workspace (60% width on lg screens, sticky on desktop) */}
                    <div className="lg:col-span-7 lg:sticky lg:top-6">
                        <QuickReviewPanel
                            warranty={selectedWarranty}
                            processingWarranty={processingId}
                            onRefresh={() => fetchWarranties(false)}
                            onApprove={(id) => handleUpdateStatus(id, 'validated')}
                            onReject={(id) => {
                                setRejectingWarrantyId(id);
                                resetRejectReason();
                                setRejectDialogOpen(true);
                                return new Promise<void>((resolve) => {
                                    // Resolve will be called after the reject dialog submits
                                    (window as any).__rejectResolve = resolve;
                                });
                            }}
                        />
                    </div>
                </div>
            ) : (
                <Card className="border-orange-100 shadow-sm overflow-hidden rounded-3xl">
                    <CardContent className="p-0">
                        <div key={refreshKey}>
                            <AdminWarrantyList
                                items={paginatedWarranties}
                                showActions={false}
                                onApprove={(id) => handleUpdateStatus(id, 'validated')}
                                onReject={(id) => {
                                    setRejectingWarrantyId(id);
                                    resetRejectReason();
                                    setRejectDialogOpen(true);
                                    return new Promise<void>((resolve) => {
                                        // Resolve will be called after the reject dialog submits
                                        (window as any).__rejectResolve = resolve;
                                    });
                                }}
                                onMoveToPending={(id) => handleUpdateStatus(id, 'pending')}
                                processingWarranty={processingId}
                                onRefresh={() => fetchWarranties(false)}
                            />
                        </div>
                    </CardContent>
                </Card>
            )
            )}

            {!loading && totalPages > 1 && (
                <Pagination className="mt-4">
                    <PaginationContent>
                        <PaginationItem>
                            <PaginationPrevious
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                aria-disabled={currentPage === 1}
                                className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            />
                        </PaginationItem>

                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                            .filter(page => {
                                // Show first, last, current, and adjacent pages
                                return page === 1 ||
                                    page === totalPages ||
                                    Math.abs(page - currentPage) <= 1;
                            })
                            .map((page, index, array) => {
                                // Add ellipsis
                                if (index > 0 && array[index - 1] !== page - 1) {
                                    return (
                                        <div key={`ellipsis-${page}`} className="flex items-center">
                                            <PaginationEllipsis />
                                            <PaginationItem>
                                                <PaginationLink
                                                    isActive={currentPage === page}
                                                    onClick={() => setCurrentPage(page)}
                                                    className="cursor-pointer"
                                                >
                                                    {page}
                                                </PaginationLink>
                                            </PaginationItem>
                                        </div>
                                    );
                                }

                                return (
                                    <PaginationItem key={page}>
                                        <PaginationLink
                                            isActive={currentPage === page}
                                            onClick={() => setCurrentPage(page)}
                                            className="cursor-pointer"
                                        >
                                            {page}
                                        </PaginationLink>
                                    </PaginationItem>
                                );
                            })}

                        <PaginationItem>
                            <PaginationNext
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                aria-disabled={currentPage === totalPages}
                                className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            />
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>
            )}

            <SelectiveExportDialog
                isOpen={exportDialogOpen}
                onClose={() => setExportDialogOpen(false)}
                onExport={handleSelectiveExport}
                title="Selective Warranty Export"
                description="Choose the information you want to include in your CSV report."
            />

            {/* Rejection Reason Dialog */}
            <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Decline Warranty</DialogTitle>
                        <DialogDescription>
                            Please provide feedback for this warranty registration.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="rejection-preset">Reason</Label>
                            <Select value={rejectPreset} onValueChange={setRejectPreset}>
                                <SelectTrigger id="rejection-preset" className="h-auto min-h-10 text-left whitespace-normal">
                                    <SelectValue placeholder="Select a reason..." />
                                </SelectTrigger>
                                <SelectContent className="max-h-80">
                                    {REJECTION_REASONS.map((reason) => (
                                        <SelectItem key={reason} value={reason} className="whitespace-normal">
                                            {reason}
                                        </SelectItem>
                                    ))}
                                    <SelectItem value={CUSTOM_REJECTION} className="font-semibold">
                                        Write your own reason...
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {rejectPreset === CUSTOM_REJECTION && (
                            <div className="space-y-2">
                                <Label htmlFor="rejection-reason">Reviewer Remarks / Feedback</Label>
                                <Textarea
                                    id="rejection-reason"
                                    placeholder="Enter feedback for the user..."
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    className="min-h-[100px]"
                                    autoFocus
                                />
                            </div>
                        )}
                        <div className="flex justify-end gap-3">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setRejectDialogOpen(false);
                                    resetRejectReason();
                                    setRejectingWarrantyId(null);
                                    if ((window as any).__rejectResolve) {
                                        (window as any).__rejectResolve();
                                        (window as any).__rejectResolve = null;
                                    }
                                }}
                                disabled={processingId === rejectingWarrantyId}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={async () => {
                                    if (rejectingWarrantyId && finalRejectReason) {
                                        await handleUpdateStatus(rejectingWarrantyId, 'rejected', finalRejectReason);
                                        setRejectDialogOpen(false);
                                        resetRejectReason();
                                        setRejectingWarrantyId(null);
                                        if ((window as any).__rejectResolve) {
                                            (window as any).__rejectResolve();
                                            (window as any).__rejectResolve = null;
                                        }
                                    }
                                }}
                                disabled={!finalRejectReason || processingId === rejectingWarrantyId}
                            >
                                {processingId === rejectingWarrantyId ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Declining...</>
                                ) : (
                                    "Decline Warranty"
                                )}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};
