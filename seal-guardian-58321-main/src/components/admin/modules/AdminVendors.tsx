import { useState, useEffect } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { downloadCSV, getISTTodayISO } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Search,
    Download,
    Loader2,
    Check,
    X,
    Eye,
    Store,
    MapPin,
    Phone,
    Mail,
    ArrowUpDown,
    Power,
    Trophy,
    CalendarRange,
    Filter,
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdminVendorDetails } from "./AdminVendorDetails";

export const AdminVendors = () => {
    const { toast } = useToast();
    const [vendors, setVendors] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [sortField, setSortField] = useState("created_at");
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    // Leaderboard mode (date range ranking)
    const [leaderboardMode, setLeaderboardMode] = useState(false);
    // Empty by default so the leaderboard opens on all time. The backend only
    // applies a range when both dates are present, so a hardcoded start date
    // silently dropped every warranty registered before it.
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [dateField, setDateField] = useState<'created_at' | 'purchase_date'>('created_at');
    const [stateFilter, setStateFilter] = useState("all");
    const [cityFilter, setCityFilter] = useState("all");
    // 'all', 'none' (no ASM yet) or an ASM id.
    const [asmFilter, setAsmFilter] = useState("all");

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    // Processing states
    const [processingVendor, setProcessingVendor] = useState<string | null>(null);
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
    const [selectedVendor, setSelectedVendor] = useState<any>(null);
    const [rejectReason, setRejectReason] = useState("");

    // View state
    const [viewingVendor, setViewingVendor] = useState<any>(null);

    // Brand update
    const [updatingBrand, setUpdatingBrand] = useState<string | null>(null);
    const [pendingBrandChange, setPendingBrandChange] = useState<{ vendor: any; brand: "AF" | "AC" | "AFAC" } | null>(null);

    const handleUpdateFranchiseBrand = async () => {
        if (!pendingBrandChange) return;
        const { vendor, brand } = pendingBrandChange;
        setUpdatingBrand(vendor.id);
        try {
            await api.put(`/admin/vendors/${vendor.id}/allowed-brands`, {
                allowed_brands: brand,
                target: 'franchise'
            });
            // Update local state directly — no re-fetch needed
            setVendors(prev => prev.map(v =>
                v.id === vendor.id ? { ...v, franchise_allowed_brands: brand } : v
            ));
            toast({ title: "Brand Updated", description: `${vendor.store_name} set to ${brand}` });
        } catch (error: any) {
            toast({ title: "Update Failed", description: getErrorMessage(error, "Failed to update brand"), variant: "destructive" });
        } finally {
            setUpdatingBrand(null);
            setPendingBrandChange(null);
        }
    };

    useEffect(() => {
        fetchVendors();
    }, []);

    useEffect(() => {
        if (leaderboardMode) fetchVendors();
    }, [leaderboardMode, startDate, endDate, dateField]);

    // Reset pagination
    useEffect(() => {
        setCurrentPage(1);
    }, [filter, search, leaderboardMode, stateFilter, cityFilter, asmFilter]);

    const fetchVendors = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const params = leaderboardMode ? { startDate, endDate, dateField } : {};
            const response = await api.get("/admin/vendors", { params });
            if (response.data.success) {
                const parsedVendors = response.data.vendors.map((v: any) => ({
                    ...v,
                    manpower_count: Number(v.manpower_count || 0),
                    is_verified: Boolean(v.is_verified),
                    is_active: v.is_active === 1 || v.is_active === true,
                    is_distributor: Boolean(v.is_distributor),
                    is_franchise: v.is_franchise === undefined ? true : Boolean(v.is_franchise),
                    franchise_allowed_brands: v.franchise_allowed_brands || 'AF',
                    distributor_allowed_brands: v.distributor_allowed_brands || 'AF',
                }));
                // Show only Franchises (includes franchises who are also distributors)
                setVendors(parsedVendors.filter((v: any) => v.is_franchise));
            }
        } catch (error) {
            console.error("Failed to fetch vendors:", error);
            toast({
                title: "Franchise Fetch Failed",
                description: "Failed to fetch franchises",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    const handleVendorVerification = async (vendorId: string, isVerified: boolean, reason?: string) => {
        setProcessingVendor(vendorId);
        try {
            const response = await api.put(`/admin/vendors/${vendorId}/verification`, {
                is_verified: isVerified,
                rejection_reason: reason
            });

            if (response.data.success) {
                toast({
                    title: isVerified ? "Franchise Approved" : "Franchise Disapproved",
                    description: response.data.message,
                    variant: isVerified ? "default" : "destructive"
                });
                fetchVendors(true);
            }
        } catch (error: any) {
            console.error("Vendor verification error:", error);
            toast({
                title: "Verification Update Failed",
                description: getErrorMessage(error, "Failed to update vendor status"),
                variant: "destructive"
            });
        } finally {
            setProcessingVendor(null);
            setRejectDialogOpen(false);
            setRejectReason("");
            setSelectedVendor(null);
        }
    };

    const handleVendorActivation = async (vendorId: string, isActive: boolean) => {
        setProcessingVendor(vendorId);
        try {
            const response = await api.put(`/admin/vendors/${vendorId}/activation`, {
                is_active: isActive
            });

            if (response.data.success) {
                toast({
                    title: isActive ? "Franchise Activated" : "Franchise Deactivated",
                    description: response.data.message,
                    variant: isActive ? "default" : "destructive"
                });
                fetchVendors(true);
            }
        } catch (error: any) {
            console.error("Vendor activation error:", error);
            toast({
                title: "Activation Update Failed",
                description: getErrorMessage(error, "Failed to update vendor status"),
                variant: "destructive"
            });
        } finally {
            setProcessingVendor(null);
        }
    };

    const handleToggleDistributor = async (vendorId: string, isDistributor: boolean) => {
        setProcessingVendor(vendorId);
        try {
            const response = await api.put(`/admin/vendors/${vendorId}/distributor-status`, {
                is_distributor: isDistributor
            });

            if (response.data.success) {
                toast({
                    title: isDistributor ? "Distributor Status Assigned" : "Distributor Status Revoked",
                    description: response.data.message,
                    variant: "default"
                });
                fetchVendors(true);
            }
        } catch (error: any) {
            console.error("Toggle distributor status error:", error);
            toast({
                title: "Failed to Update Distributor Status",
                description: getErrorMessage(error, "Failed to update distributor status"),
                variant: "destructive"
            });
        } finally {
            setProcessingVendor(null);
        }
    };

    const handleExportVendors = () => {
        try {
            if (filteredVendors.length === 0) {
                toast({ description: "No franchises to export", variant: "destructive" });
                return;
            }

            if (leaderboardMode) {
                const exportData = filteredVendors.map((v, i) => ({
                    "Rank": i + 1,
                    "Store Name": v.store_name,
                    "Brand": v.franchise_allowed_brands || "AF",
                    "Contact Person": v.contact_name,
                    "City": v.city,
                    "State": v.state,
                    "Total Warranties": v.range_total_warranties || 0,
                    "Approved Warranties": v.range_validated_warranties || 0,
                    "Pending Warranties": v.range_pending_warranties || 0,
                    "Rejected Warranties": v.range_rejected_warranties || 0
                }));
                downloadCSV(exportData, startDate && endDate
                    ? `franchise_leaderboard_${startDate}_to_${endDate}.csv`
                    : `franchise_leaderboard_all_time.csv`);
                return;
            }

            const exportData = filteredVendors.map(v => ({
                "Store Name": v.store_name,
                // Which brand the store may sell — shown in the table, and
                // missing from this file until now, so a downloaded list could
                // not be split by brand at all.
                "Brand": v.franchise_allowed_brands || "AF",
                "Store Email": v.store_email,
                "Contact Person": v.contact_name,
                "Phone": v.phone_number,
                "Email": v.email,
                "City": v.city,
                "State": v.state,
                "Latitude": v.latitude || 'N/A',
                "Longitude": v.longitude || 'N/A',
                "Address": v.full_address,
                "Pincode": v.pincode,
                "ASM": v.asm_name || "",
                "Status": v.is_verified ? "Active" : v.verified_at ? "Rejected" : "Pending",
                "Verified At": v.verified_at ? new Date(v.verified_at).toLocaleDateString() : "N/A",
                "Rejection Reason": v.is_verified ? "" : (v.rejection_reason || ""),
                "Manpower Count": v.manpower_count || 0,
                "Team Members": v.manpower_names || "",
                "Total Warranties": v.total_warranties || 0,
                "Approved Warranties": v.validated_warranties || 0,
                "Pending Warranties": v.pending_warranties || 0,
                "Rejected Warranties": v.rejected_warranties || 0
            }));

            downloadCSV(exportData, `franchises_${getISTTodayISO()}.csv`);

        } catch (error) {
            console.error("Export error:", error);
            toast({
                title: "Export Failed",
                description: "Failed to export vendor data",
                variant: "destructive"
            });
        }
    };

    const handleViewVendor = (vendor: any) => {
        setViewingVendor(vendor);
    };

    // The leaderboard always ranks franchises by TOTAL warranties in range,
    // regardless of the selected tab. (The per-column Approved/Pending/Rejected
    // counts are still shown, but they no longer drive the ranking or inclusion.)
    const leaderboardCountField = 'range_total_warranties';

    // State and city are typed per franchise, so the same place can arrive as
    // "Gujarat", "RAJASTHAN" or "delhi". Group case-insensitively and match the
    // same way, otherwise picking one spelling silently hides the others.
    const titleCase = (v: string) =>
        v.trim().toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());

    // Beyond casing, the same state is spelt several ways in the data
    // ("Maharastra", "Utter pradesh ", "J&K"). Folding the known variants onto
    // one key keeps 6 franchises from disappearing when their state is picked.
    // Display only — nothing is rewritten in the database.
    const STATE_ALIASES: Record<string, string> = {
        'chattisgarh': 'chhattisgarh',
        'maharastra': 'maharashtra',
        'utter pradesh': 'uttar pradesh',
        'new delhi': 'delhi',
        'j&k': 'jammu & kashmir',
        'jammu kashmir': 'jammu & kashmir',
        'tamilnadu': 'tamil nadu',
    };

    const stateKey = (v: string) => {
        // Collapse repeated spaces first — one value is "Jammu  Kashmir".
        const k = v.trim().toLowerCase().replace(/\s+/g, ' ');
        return STATE_ALIASES[k] || k;
    };

    const cityKey = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

    // Shown as a badge on the Filters button so an active filter is visible
    // while the popover is shut. The range defaults to empty (all time), so a
    // date set here is a real narrowing and counts.
    const activeLeaderboardFilters =
        (stateFilter !== 'all' ? 1 : 0) +
        (cityFilter !== 'all' ? 1 : 0) +
        (dateField !== 'created_at' ? 1 : 0) +
        (startDate || endDate ? 1 : 0);

    const stateOptions = Array.from(
        new Map(
            vendors
                .map((v) => (v.state || '').trim())
                .filter(Boolean)
                .map((v) => [stateKey(v), titleCase(stateKey(v))] as [string, string])
        ).entries()
    ).sort((a, b) => a[1].localeCompare(b[1]));

    // Cities follow the chosen state, so the list stays short and can't offer a
    // city that would return nothing.
    const cityOptions = Array.from(
        new Map(
            vendors
                .filter((v) => stateFilter === 'all' || stateKey(v.state || '') === stateFilter)
                .map((v) => (v.city || '').trim())
                .filter(Boolean)
                .map((v) => [cityKey(v), titleCase(v)] as [string, string])
        ).entries()
    ).sort((a, b) => a[1].localeCompare(b[1]));

    // The ASMs that stores are actually under, for the filter.
    const asmOptions = Array.from(
        new Map(vendors.filter((v) => v.asm_id).map((v) => [v.asm_id, v.asm_name || 'Unknown ASM'] as [string, string])).entries()
    ).sort((a, b) => a[1].localeCompare(b[1]));

    const filteredVendors = vendors
        .filter((vendor) => {
            if (asmFilter === 'none') return !vendor.asm_id;
            if (asmFilter !== 'all') return vendor.asm_id === asmFilter;
            return true;
        })
        .filter((vendor) => {
            if (leaderboardMode) return Number(vendor[leaderboardCountField] || 0) > 0;
            if (filter === 'approved') return vendor.is_verified && vendor.is_active !== false;
            if (filter === 'inactive') return vendor.is_verified && vendor.is_active === false;
            if (filter === 'disapproved') return !vendor.is_verified && vendor.verified_at; // Assuming verified_at + !is_verified = rejected
            if (filter === 'pending') return !vendor.is_verified && !vendor.verified_at;
            return true;
        })
        .filter((vendor) => {
            if (stateFilter !== 'all' && stateKey(vendor.state || '') !== stateFilter) return false;
            if (cityFilter !== 'all' && cityKey(vendor.city || '') !== cityFilter) return false;
            return true;
        })
        .filter((vendor) => {
            if (!search) return true;
            const term = search.toLowerCase();
            return (
                vendor.store_name?.toLowerCase().includes(term) ||
                vendor.contact_name?.toLowerCase().includes(term) ||
                vendor.store_email?.toLowerCase().includes(term) ||
                vendor.phone_number?.includes(term) ||
                vendor.city?.toLowerCase().includes(term) ||
                vendor.asm_name?.toLowerCase().includes(term)
            );
        })
        .sort((a, b) => {
            if (leaderboardMode) {
                const aVal = Number(a[leaderboardCountField] || 0);
                const bVal = Number(b[leaderboardCountField] || 0);
                if (aVal !== bVal) return bVal - aVal;
                return Number(b.range_total_warranties || 0) - Number(a.range_total_warranties || 0);
            }

            let aVal = a[sortField];
            let bVal = b[sortField];

            if (sortField === 'created_at') {
                aVal = new Date(aVal || 0).getTime();
                bVal = new Date(bVal || 0).getTime();
            } else if (sortField === 'total_warranties') {
                aVal = Number(aVal) || 0;
                bVal = Number(bVal) || 0;
            } else if (sortField === 'status') {
                // Verified/Active first in desc
                aVal = a.is_verified ? 1 : (a.verified_at ? -1 : 0);
                bVal = b.is_verified ? 1 : (b.verified_at ? -1 : 0);
            } else {
                aVal = (aVal || '').toString().toLowerCase();
                bVal = (bVal || '').toString().toLowerCase();
            }

            if (aVal === bVal) return 0;
            const result = aVal > bVal ? 1 : -1;
            return sortOrder === 'asc' ? result : -result;
        });

    // Pagination Calculation
    const totalPages = Math.ceil(filteredVendors.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedVendors = filteredVendors.slice(startIndex, startIndex + itemsPerPage);

    if (viewingVendor) {
        return <AdminVendorDetails vendor={viewingVendor} onBack={() => { setViewingVendor(null); fetchVendors(); }} />;
    }

    return (
        <div className="space-y-6">
            {/* Controls */}
            <div className="flex flex-col gap-4">
                {leaderboardMode && (
                    <div className="flex flex-wrap items-center gap-2">
                        {/* The date and location controls were overflowing their
                            row, so they live behind a Filters popover now. Only
                            search and the actions stay on the surface. */}
                        <div className="relative flex-1 min-w-[200px] sm:max-w-xs">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder="Search franchises..."
                                className="pl-10 bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-10"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    className={`h-10 gap-2 shrink-0 ${activeLeaderboardFilters > 0
                                        ? "text-orange-600 border-orange-200 bg-orange-50"
                                        : "text-slate-600 border-orange-100 bg-white"}`}
                                >
                                    <Filter className="h-4 w-4" />
                                    <span>Filters</span>
                                    {activeLeaderboardFilters > 0 && (
                                        <span className="ml-0.5 h-5 min-w-5 px-1.5 rounded-full bg-orange-600 text-white text-[10px] font-black flex items-center justify-center">
                                            {activeLeaderboardFilters}
                                        </span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-80 rounded-2xl p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Filters</p>
                                    {activeLeaderboardFilters > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setStateFilter('all');
                                                setCityFilter('all');
                                                setDateField('created_at');
                                                setStartDate('');
                                                setEndDate('');
                                            }}
                                            className="text-[11px] font-bold text-orange-600 hover:text-orange-700"
                                        >
                                            Clear all
                                        </button>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Date Range</p>
                                    <div className="flex items-center bg-slate-50 border border-orange-100 rounded-md p-1 gap-1 text-xs font-bold">
                                        <button
                                            type="button"
                                            onClick={() => setDateField('created_at')}
                                            className={`flex-1 px-3 py-1.5 rounded-sm transition-colors ${dateField === 'created_at' ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            Registered
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDateField('purchase_date')}
                                            className={`flex-1 px-3 py-1.5 rounded-sm transition-colors ${dateField === 'purchase_date' ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            Purchase
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 min-w-0">
                                            <DatePicker value={startDate} onChange={setStartDate} maxDate={new Date()} placeholder="Start date" />
                                        </div>
                                        <span className="text-slate-400 text-xs font-bold shrink-0">to</span>
                                        <div className="flex-1 min-w-0">
                                            <DatePicker value={endDate} onChange={setEndDate} maxDate={new Date()} minDate={startDate ? new Date(startDate) : undefined} placeholder="End date" />
                                        </div>
                                    </div>
                                    {/* The range only applies once both ends are
                                        set, so say so rather than let a half-filled
                                        range look like it is filtering. */}
                                    <p className="text-[11px] font-bold text-slate-400">
                                        {startDate && endDate
                                            ? 'Showing the selected range'
                                            : (startDate || endDate)
                                                ? 'Pick both dates to apply the range'
                                                : 'Showing all time'}
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Location</p>
                                    <Select
                                        value={stateFilter}
                                        onValueChange={(v) => {
                                            setStateFilter(v);
                                            // The city list is scoped to the state, so a
                                            // city held over from the previous state would
                                            // filter everything out.
                                            setCityFilter('all');
                                        }}
                                    >
                                        <SelectTrigger className="h-10 bg-white border-orange-100 text-xs font-bold">
                                            <div className="flex items-center gap-2 truncate">
                                                <MapPin className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                                                <SelectValue placeholder="All States" />
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-orange-100 max-h-72">
                                            <SelectItem value="all" className="text-xs font-bold">All States</SelectItem>
                                            {stateOptions.map(([value, label]) => (
                                                <SelectItem key={value} value={value} className="text-xs font-bold">{label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>

                                    <Select value={cityFilter} onValueChange={setCityFilter}>
                                        <SelectTrigger className="h-10 bg-white border-orange-100 text-xs font-bold">
                                            <div className="flex items-center gap-2 truncate">
                                                <Store className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                                                <SelectValue placeholder="All Cities" />
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-orange-100 max-h-72">
                                            <SelectItem value="all" className="text-xs font-bold">All Cities</SelectItem>
                                            {cityOptions.map(([value, label]) => (
                                                <SelectItem key={value} value={value} className="text-xs font-bold">{label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </PopoverContent>
                        </Popover>

                        {/* Export acts on exactly what the filters have narrowed.
                            The exit is here because the Leaderboard toggle is
                            hidden while this bar is open. */}
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={handleExportVendors}
                            title="Export leaderboard"
                            aria-label="Export leaderboard"
                            className="h-10 w-10 shrink-0 bg-white border-orange-100 text-slate-600 hover:text-orange-600 hover:border-orange-300"
                        >
                            <Download className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                                setStateFilter('all');
                                setCityFilter('all');
                                setLeaderboardMode(false);
                            }}
                            title="Exit leaderboard"
                            aria-label="Exit leaderboard"
                            className="h-10 w-10 shrink-0 bg-white border-orange-100 text-slate-500 hover:text-orange-600 hover:border-orange-300"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                )}

                {/* Both children are hidden in leaderboard mode, so skip the
                    wrapper too rather than leave an empty flex row behind. */}
                {!leaderboardMode && (
                <div className="flex flex-col gap-3">
                {/* Two rows: the toolbar (search stretching, then the ASM filter
                    and actions) and the status tabs under it. On one row they
                    were wider than the panel on a laptop and the page scrolled
                    sideways. */}
                <div className="flex flex-col md:flex-row gap-2 md:items-center">
                <div className="relative w-full md:flex-1 md:min-w-0">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                        placeholder="Search franchises..."
                        className="pl-10 bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-11 sm:h-10"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>


                <div className="flex flex-col sm:flex-row w-full md:w-auto gap-2 md:shrink-0">
                    <Select value={asmFilter} onValueChange={setAsmFilter}>
                        <SelectTrigger className={`h-11 sm:h-10 sm:w-44 text-xs font-bold ${asmFilter !== 'all' ? 'text-orange-600 border-orange-200 bg-orange-50' : 'bg-white border-orange-100'}`}>
                            <SelectValue placeholder="All ASMs" />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl border-orange-100 max-h-72">
                            <SelectItem value="all" className="text-xs font-bold">All ASMs</SelectItem>
                            <SelectItem value="none" className="text-xs font-bold">No ASM assigned</SelectItem>
                            {asmOptions.map(([id, name]) => (
                                <SelectItem key={id} value={id} className="text-xs font-bold">{name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                                // The location selects only render in leaderboard
                                // mode, so leaving it with one set would filter the
                                // main list with no visible control to undo it.
                                setStateFilter('all');
                                setCityFilter('all');
                                setLeaderboardMode((v) => !v);
                            }}
                            title="Leaderboard"
                            aria-label="Leaderboard"
                            className="h-11 w-11 sm:h-10 sm:w-10 shrink-0 border-orange-100 text-slate-600 hover:text-orange-600 hover:border-orange-300"
                        >
                            <Trophy className="h-4 w-4" />
                        </Button>
                        {!leaderboardMode && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="flex-1 sm:flex-none flex items-center gap-2 border-orange-100 h-11 sm:h-10">
                                        <ArrowUpDown className="h-4 w-4 text-orange-500" />
                                        {sortField === 'store_name' ? 'Name' : sortField === 'total_warranties' ? 'Stats' : sortField === 'city' ? 'Location' : sortField === 'status' ? 'Status' : 'Date'}
                                        {sortOrder === 'asc' ? '↑' : '↓'}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="rounded-2xl border-orange-100 shadow-xl p-2 w-48">
                                    <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-400 px-3 py-2">Sort By</DropdownMenuLabel>
                                    <DropdownMenuSeparator className="bg-orange-50" />
                                    <DropdownMenuItem
                                        onClick={() => { setSortField('created_at'); }}
                                        className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group"
                                    >
                                        Registration Date {sortField === 'created_at' && <Check className="h-4 w-4 text-orange-500" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => { setSortField('store_name'); }}
                                        className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group"
                                    >
                                        Store Name {sortField === 'store_name' && <Check className="h-4 w-4 text-orange-500" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => { setSortField('city'); }}
                                        className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group"
                                    >
                                        Location {sortField === 'city' && <Check className="h-4 w-4 text-orange-500" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => { setSortField('status'); }}
                                        className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group"
                                    >
                                        Status {sortField === 'status' && <Check className="h-4 w-4 text-orange-500" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => { setSortField('total_warranties'); }}
                                        className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group"
                                    >
                                        Total Warranties {sortField === 'total_warranties' && <Check className="h-4 w-4 text-orange-500" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-orange-50" />
                                    <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-400 px-3 py-2">Order</DropdownMenuLabel>
                                    <DropdownMenuItem
                                        onClick={() => setSortOrder('desc')}
                                        className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group"
                                    >
                                        Newest/Highest First {sortOrder === 'desc' && <Check className="h-4 w-4 text-orange-500" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => setSortOrder('asc')}
                                        className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group"
                                    >
                                        Oldest/Lowest First {sortOrder === 'asc' && <Check className="h-4 w-4 text-orange-500" />}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                        <Button variant="outline" onClick={handleExportVendors} className="flex-1 sm:flex-none h-11 sm:h-10 text-slate-600">
                            <Download className="h-4 w-4 mr-2" />
                            <span>Export</span>
                        </Button>
                    </div>
                </div>
                </div>

                <Tabs value={filter} onValueChange={setFilter} className="w-full md:w-auto">
                    <TabsList className="grid w-full grid-cols-3 md:grid-cols-5 md:inline-flex md:w-auto bg-white/50 border border-orange-100 p-1 h-auto">
                        <TabsTrigger value="all" className="gap-2">
                            All
                            <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none px-1.5 py-0 h-4 text-[10px] font-bold">
                                {vendors.length}
                            </Badge>
                        </TabsTrigger>
                        <TabsTrigger value="approved" className="gap-2 data-[state=active]:bg-green-50 data-[state=active]:text-green-700">
                            Approved
                            <Badge variant="secondary" className="bg-green-100/50 text-green-700 border-none px-1.5 py-0 h-4 text-[10px] font-bold">
                                {vendors.filter(v => v.is_verified && v.is_active !== false).length}
                            </Badge>
                        </TabsTrigger>
                        <TabsTrigger value="pending" className="gap-2 data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700">
                            Pending
                            <Badge variant="secondary" className="bg-amber-100/50 text-amber-700 border-none px-1.5 py-0 h-4 text-[10px] font-bold">
                                {vendors.filter(v => !v.is_verified && !v.verified_at).length}
                            </Badge>
                        </TabsTrigger>
                        <TabsTrigger value="inactive" className="gap-2 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-700">
                            Inactive
                            <Badge variant="secondary" className="bg-slate-200/70 text-slate-600 border-none px-1.5 py-0 h-4 text-[10px] font-bold">
                                {vendors.filter(v => v.is_verified && v.is_active === false).length}
                            </Badge>
                        </TabsTrigger>
                        <TabsTrigger value="disapproved" className="gap-2 data-[state=active]:bg-red-50 data-[state=active]:text-red-700">
                            Rejected
                            <Badge variant="secondary" className="bg-red-100/50 text-red-700 border-none px-1.5 py-0 h-4 text-[10px] font-bold">
                                {vendors.filter(v => !v.is_verified && v.verified_at).length}
                            </Badge>
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
                </div>
                )}
            </div>

            {/* Content */}
            <Card className="border-orange-100 shadow-sm overflow-hidden">
                <CardHeader className="bg-orange-50/30 border-b border-orange-50 pb-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                {leaderboardMode && <Trophy className="h-5 w-5 text-orange-500" />}
                                {leaderboardMode ? "Franchise Leaderboard" : "Registered Franchises"}
                            </CardTitle>
                            <CardDescription className="flex items-center gap-1.5">
                                {leaderboardMode ? (
                                    <>
                                        <CalendarRange className="h-3.5 w-3.5" />
                                        Ranked by total warranties ({dateField === 'purchase_date' ? 'purchase date' : 'registered date'}), {startDate && endDate
                                            ? `${new Date(startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} – ${new Date(endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                                            : 'all time'}
                                    </>
                                ) : "Manage your network partners"}
                            </CardDescription>
                        </div>
                        <Badge variant="outline" className="bg-white text-slate-600 font-mono">
                            {filteredVendors.length} {leaderboardMode ? "Active" : "Total"}
                        </Badge>
                    </div>
                </CardHeader>
                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="flex justify-center items-center h-64">
                            <Loader2 className="h-8 w-8 text-orange-500 animate-spin" />
                        </div>
                    ) : paginatedVendors.length === 0 ? (
                        <div className="text-center py-16 text-slate-400">
                            <Store className="h-12 w-12 mx-auto mb-3 opacity-20" />
                            <p>No franchises found matching your criteria</p>
                        </div>
                    ) : (
                        <>
                            {/* Mobile View: Cards */}
                            <div className="grid grid-cols-1 gap-4 p-4 md:hidden">
                                {paginatedVendors.map((vendor, index) => (
                                    <div key={vendor.id} className="bg-white border border-orange-100 rounded-2xl p-5 shadow-sm space-y-4">
                                        <div className="flex justify-between items-start">
                                            <div
                                                className="cursor-pointer flex-1 flex items-start gap-3"
                                                onClick={() => handleViewVendor(vendor)}
                                            >
                                                {leaderboardMode && (
                                                    <span className={`shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-full font-bold text-xs mt-0.5 ${startIndex + index === 0 ? "bg-orange-100 text-orange-700" : startIndex + index === 1 ? "bg-slate-200 text-slate-700" : startIndex + index === 2 ? "bg-amber-100 text-amber-800" : "bg-slate-50 text-slate-500"}`}>
                                                        {startIndex + index + 1}
                                                    </span>
                                                )}
                                                <div>
                                                    <div className="font-bold text-slate-800 text-lg leading-tight hover:text-orange-600 transition-colors">{vendor.store_name}</div>
                                                    <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-1.5">
                                                        <Mail className="h-3.5 w-3.5" /> {vendor.store_email}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-3 items-center">
                                                {/* Activation Toggle - only for verified vendors */}
                                                {!leaderboardMode && vendor.is_verified && (
                                                    <div className="flex flex-col items-center gap-1" title={vendor.is_active ? "Deactivate Franchise" : "Activate Franchise"}>
                                                        <span className="text-[9px] font-bold text-slate-400">Active</span>
                                                        <Switch
                                                            checked={vendor.is_active !== false}
                                                            onCheckedChange={(checked) => handleVendorActivation(vendor.id, checked)}
                                                            disabled={processingVendor === vendor.id}
                                                            className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-red-400"
                                                        />
                                                    </div>
                                                )}
                                                {/* Distributor Toggle - only for verified vendors */}
                                                {!leaderboardMode && vendor.is_verified && (
                                                    <div className="flex flex-col items-center gap-1" title={vendor.is_distributor ? "Revoke Distributor Privileges" : "Make Distributor"}>
                                                        <span className="text-[9px] font-bold text-slate-400">Distributor</span>
                                                        <Switch
                                                            checked={vendor.is_distributor}
                                                            onCheckedChange={(checked) => handleToggleDistributor(vendor.id, checked)}
                                                            disabled={processingVendor === vendor.id}
                                                            className="data-[state=checked]:bg-orange-500 data-[state=unchecked]:bg-slate-300"
                                                        />
                                                    </div>
                                                )}
                                                {!leaderboardMode && !vendor.is_verified && !vendor.verified_at && (
                                                    <div className="flex gap-2">
                                                        <Button
                                                            size="icon"
                                                            className="h-10 w-10 bg-green-500 text-white rounded-xl shadow-sm"
                                                            onClick={() => handleVendorVerification(vendor.id, true)}
                                                        >
                                                            <Check className="h-5 w-5" />
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="destructive"
                                                            className="h-10 w-10 rounded-xl shadow-sm"
                                                            onClick={() => {
                                                                setSelectedVendor(vendor);
                                                                setRejectDialogOpen(true);
                                                            }}
                                                        >
                                                            <X className="h-5 w-5" />
                                                        </Button>
                                                    </div>
                                                )}

                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Contact</div>
                                                <div className="text-sm font-medium text-slate-700">{vendor.contact_name}</div>
                                                <div className="text-[11px] text-slate-500 flex items-center gap-1">
                                                    <Phone className="h-3 w-3" /> {vendor.phone_number}
                                                </div>
                                                <div className={`text-[11px] ${vendor.asm_name ? 'text-slate-500' : 'text-slate-300'}`}>
                                                    ASM: {vendor.asm_name || 'not assigned'}
                                                </div>
                                            </div>
                                            <div className="space-y-1 text-right">
                                                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Location</div>
                                                <div className="text-sm font-medium text-slate-700">{vendor.city}</div>
                                                <div className="text-[11px] text-slate-500 truncate">{vendor.state}</div>
                                                {(vendor.latitude || vendor.longitude) && (
                                                    <div className="text-[9px] text-slate-400">Lat: {vendor.latitude || 'N/A'}, Lng: {vendor.longitude || 'N/A'}</div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between pt-2 border-t border-orange-50">
                                            <div className="space-y-1">
                                                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Status</div>
                                                {leaderboardMode ? (
                                                    <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">In Range</Badge>
                                                ) : vendor.is_verified ? (
                                                    vendor.is_active === false ? (
                                                        <Badge className="bg-slate-200 text-slate-600 hover:bg-slate-200 border-slate-300">Inactive</Badge>
                                                    ) : (
                                                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200">Active</Badge>
                                                    )
                                                ) : vendor.verified_at ? (
                                                    <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-100 border-red-200">Rejected</Badge>
                                                ) : (
                                                    <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200">Pending</Badge>
                                                )}
                                            </div>
                                            <div className="flex gap-4">
                                                <div className="text-center">
                                                    <div className="text-green-600 font-bold text-sm">{leaderboardMode ? (vendor.range_validated_warranties || 0) : (vendor.validated_warranties || 0)}</div>
                                                    <div className="text-[8px] uppercase tracking-tighter text-slate-400">Approved</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="text-slate-700 font-bold text-sm">{leaderboardMode ? (vendor.range_total_warranties || 0) : (vendor.total_warranties || 0)}</div>
                                                    <div className="text-[8px] uppercase tracking-tighter text-slate-400">Total</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Desktop View: Table */}
                            <table className="w-full text-sm text-left hidden md:table">
                                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                                    <tr>
                                        {leaderboardMode && <th className="px-6 py-4 text-center">Rank</th>}
                                        <th className="px-6 py-4">Store Details</th>
                                        <th className="px-6 py-4">Contact</th>
                                        <th className="px-6 py-4">Location</th>
                                        {!leaderboardMode && <th className="px-6 py-4 text-center">Status</th>}
                                        <th className="px-6 py-4 text-center">Stats</th>
                                        {!leaderboardMode && <th className="px-6 py-4 text-right">Actions</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {paginatedVendors.map((vendor, index) => (
                                        <tr key={vendor.id} className="hover:bg-orange-50/50 transition-colors group cursor-pointer" onClick={() => handleViewVendor(vendor)}>
                                            {leaderboardMode && (
                                                <td className="px-6 py-4 text-center">
                                                    <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full font-bold text-xs ${startIndex + index === 0 ? "bg-orange-100 text-orange-700" : startIndex + index === 1 ? "bg-slate-200 text-slate-700" : startIndex + index === 2 ? "bg-amber-100 text-amber-800" : "bg-slate-50 text-slate-500"}`}>
                                                        {startIndex + index + 1}
                                                    </span>
                                                </td>
                                            )}
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-slate-800 group-hover:text-orange-600 transition-colors">{vendor.store_name}</span>
                                                    {(vendor.franchise_allowed_brands || 'AF') === 'AFAC' ? (
                                                        <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[10px] px-2 py-0.5 font-bold whitespace-nowrap">AF+AC</Badge>
                                                    ) : (vendor.franchise_allowed_brands || 'AF') === 'AC' ? (
                                                        <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] px-2 py-0.5 font-bold whitespace-nowrap">AC</Badge>
                                                    ) : (
                                                        <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[10px] px-2 py-0.5 font-bold whitespace-nowrap">AF</Badge>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                                                    <Mail className="h-3 w-3" /> {vendor.store_email}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-medium text-slate-700">{vendor.contact_name}</div>
                                                <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                                                    <Phone className="h-3 w-3" /> {vendor.phone_number}
                                                </div>
                                                <div className={`text-[11px] mt-1 ${vendor.asm_name ? 'text-slate-500' : 'text-slate-300'}`}>
                                                    ASM: {vendor.asm_name || 'not assigned'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-1 text-slate-700">
                                                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                                                    {vendor.city}
                                                </div>
                                                <div className="text-xs text-slate-400 ml-4.5">{vendor.state}</div>
                                                {(vendor.latitude || vendor.longitude) && (
                                                    <div className="text-[10px] text-slate-400 ml-4.5 mt-0.5">Lat: {vendor.latitude || 'N/A'}, Lng: {vendor.longitude || 'N/A'}</div>
                                                )}
                                            </td>
                                            {!leaderboardMode && (
                                                <td className="px-6 py-4 text-center">
                                                    {vendor.is_verified ? (
                                                        vendor.is_active === false ? (
                                                            <Badge className="bg-slate-200 text-slate-600 hover:bg-slate-200 border-slate-300">Inactive</Badge>
                                                        ) : (
                                                            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200">Active</Badge>
                                                        )
                                                    ) : vendor.verified_at ? (
                                                        <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-100 border-red-200">Rejected</Badge>
                                                    ) : (
                                                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200">Pending</Badge>
                                                    )}
                                                </td>
                                            )}
                                            <td className="px-6 py-4">
                                                <div className="flex justify-center gap-3 text-xs font-medium">
                                                    <div className="text-center">
                                                        <div className="text-green-600">{leaderboardMode ? (vendor.range_validated_warranties || 0) : (vendor.validated_warranties || 0)}</div>
                                                        <div className="text-[10px] text-slate-400">Approved</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-red-600">{leaderboardMode ? (vendor.range_rejected_warranties || 0) : (vendor.rejected_warranties || 0)}</div>
                                                        <div className="text-[10px] text-slate-400">Rejected</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-amber-600">{leaderboardMode ? (vendor.range_pending_warranties || 0) : (vendor.pending_warranties || 0)}</div>
                                                        <div className="text-[10px] text-slate-400">Pending</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-slate-700">{leaderboardMode ? (vendor.range_total_warranties || 0) : (vendor.total_warranties || 0)}</div>
                                                        <div className="text-[10px] text-slate-400">Total</div>
                                                    </div>
                                                </div>
                                            </td>
                                            {!leaderboardMode && (
                                                <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex justify-end items-center gap-4">
                                                        {/* Activate/Deactivate Toggle - only for verified vendors */}
                                                        {vendor.is_verified && (
                                                            <div className="flex items-center gap-2 px-1" title={vendor.is_active ? "Deactivate Store" : "Activate Store"}>
                                                                <span className="text-xs font-bold text-slate-500">Active</span>
                                                                <Switch
                                                                    checked={vendor.is_active}
                                                                    onCheckedChange={(checked) => handleVendorActivation(vendor.id, checked)}
                                                                    disabled={processingVendor === vendor.id}
                                                                    className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-slate-300"
                                                                />
                                                            </div>
                                                        )}

                                                        {/* Distributor Toggle - only for verified vendors */}
                                                        {vendor.is_verified && (
                                                            <div className="flex items-center gap-2 px-1" title={vendor.is_distributor ? "Revoke Distributor Status" : "Make Distributor"}>
                                                                <span className="text-xs font-bold text-slate-500">Distributor</span>
                                                                <Switch
                                                                    checked={vendor.is_distributor}
                                                                    onCheckedChange={(checked) => handleToggleDistributor(vendor.id, checked)}
                                                                    disabled={processingVendor === vendor.id}
                                                                    className="data-[state=checked]:bg-orange-500 data-[state=unchecked]:bg-slate-300"
                                                                />
                                                            </div>
                                                        )}

                                                        {/* Franchise Brand selector */}
                                                        {vendor.is_verified && (
                                                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                                                {(['AF', 'AC', 'AFAC'] as const).map(b => (
                                                                    <button
                                                                        key={b}
                                                                        disabled={updatingBrand === vendor.id}
                                                                        onClick={() => setPendingBrandChange({ vendor, brand: b })}
                                                                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all ${
                                                                            (vendor.franchise_allowed_brands || 'AF') === b
                                                                                ? b === 'AF' ? 'bg-orange-500 text-white border-orange-500'
                                                                                  : b === 'AC' ? 'bg-blue-500 text-white border-blue-500'
                                                                                  : 'bg-purple-500 text-white border-purple-500'
                                                                                : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'
                                                                        }`}
                                                                    >
                                                                        {b}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {!vendor.is_verified && !vendor.verified_at && (
                                                            <>
                                                                <Button
                                                                    size="icon"
                                                                    className="h-8 w-8 bg-green-500 hover:bg-green-600 text-white rounded-full shadow-sm"
                                                                    onClick={() => handleVendorVerification(vendor.id, true)}
                                                                    title="Approve"
                                                                >
                                                                    <Check className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    size="icon"
                                                                    variant="destructive"
                                                                    className="h-8 w-8 rounded-full shadow-sm"
                                                                    onClick={() => {
                                                                        setSelectedVendor(vendor);
                                                                        setRejectDialogOpen(true);
                                                                    }}
                                                                    title="Reject"
                                                                >
                                                                    <X className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        )}

                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </>
                    )}
                </div>
            </Card>

            {totalPages > 1 && (
                <Pagination>
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
                                return page === 1 ||
                                    page === totalPages ||
                                    Math.abs(page - currentPage) <= 1;
                            })
                            .map((page, index, array) => {
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

            {/* Brand change confirmation dialog */}
            <Dialog open={!!pendingBrandChange} onOpenChange={(open) => { if (!open) setPendingBrandChange(null); }}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle>Confirm Brand Update</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to update the brand for{' '}
                            <span className="font-semibold text-slate-800">{pendingBrandChange?.vendor.store_name}</span>{' '}
                            (Franchise) to{' '}
                            <span className={`font-bold ${pendingBrandChange?.brand === 'AF' ? 'text-orange-600' : pendingBrandChange?.brand === 'AC' ? 'text-blue-600' : 'text-purple-600'}`}>
                                {pendingBrandChange?.brand === 'AF' ? 'Autoform (AF)' : pendingBrandChange?.brand === 'AC' ? 'Autocruze (AC)' : 'AFAC'}
                            </span>?
                            <br /><br />
                            <span className="text-amber-700 font-medium text-xs">This affects which products this franchise can see and order.</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="outline" onClick={() => setPendingBrandChange(null)}>Cancel</Button>
                        <Button
                            onClick={handleUpdateFranchiseBrand}
                            disabled={!!updatingBrand}
                            className={pendingBrandChange?.brand === 'AF' ? 'bg-orange-500 hover:bg-orange-600 text-white' : pendingBrandChange?.brand === 'AC' ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-purple-500 hover:bg-purple-600 text-white'}
                        >
                            {updatingBrand ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Yes, Update to {pendingBrandChange?.brand}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Reject Franchise Application</DialogTitle>
                        <DialogDescription>
                            Please provide a reason for rejecting {selectedVendor?.store_name}.
                            The vendor will be notified.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="reason" className="mb-2 block">Rejection Reason</Label>
                        <Textarea
                            id="reason"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Enter detailed reason..."
                            className="h-32"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            onClick={() => handleVendorVerification(selectedVendor.id, false, rejectReason)}
                            disabled={!rejectReason}
                        >
                            Confirm Rejection
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};



