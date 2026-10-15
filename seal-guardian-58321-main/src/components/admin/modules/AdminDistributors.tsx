import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import {
    Search,
    Download,
    Loader2,
    Check,
    X,
    Building2,
    MapPin,
    Phone,
    Mail,
    ArrowUpDown,
    Plus,
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

export const AdminDistributors = () => {
    const { toast } = useToast();
    const [vendors, setVendors] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [sortField, setSortField] = useState("created_at");
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

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

    // Add Distributor States
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [newDistributor, setNewDistributor] = useState({
        name: "",
        contact_name: "",
        email: "",
        phone_number: "",
        address: "",
        city: "",
        state: "",
        pincode: "",
        gst_number: "",
        asm_id: "",
        allowed_brands: "AF" as "AF" | "AC" | "AFAC"
    });
    // ASMs a new distributor can be put under (replaces the typed Area Head).
    const [asmOptions, setAsmOptions] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
    const [createErrors, setCreateErrors] = useState<any>({});

    // Brand update
    const [updatingBrand, setUpdatingBrand] = useState<string | null>(null);
    const [pendingBrandChange, setPendingBrandChange] = useState<{ vendor: any; brand: "AF" | "AC" | "AFAC" } | null>(null);

    const handleUpdateBrand = async () => {
        if (!pendingBrandChange) return;
        const { vendor, brand } = pendingBrandChange;
        setUpdatingBrand(vendor.id);
        try {
            await api.put(`/admin/vendors/${vendor.id}/allowed-brands`, {
                allowed_brands: brand,
                target: 'distributor',
                distributor_id: vendor.distributor_id
            });
            // Update local state directly — no re-fetch needed
            setVendors(prev => prev.map(v =>
                v.id === vendor.id ? { ...v, distributor_allowed_brands: brand } : v
            ));
            toast({ title: "Brand Updated", description: `${vendor.store_name} set to ${brand}` });
        } catch (error: any) {
            toast({ title: "Update Failed", description: getErrorMessage(error, "Failed to update brand"), variant: "destructive" });
        } finally {
            setUpdatingBrand(null);
            setPendingBrandChange(null);
        }
    };

    const handleCreateDistributor = async (e: React.FormEvent) => {
        e.preventDefault();
        
        const errs: any = {};
        if (!newDistributor.name) errs.name = "Store/Distributor Name is required";
        if (!newDistributor.contact_name) errs.contact_name = "Contact Person Name is required";
        if (!newDistributor.email) errs.email = "Email is required";
        if (!newDistributor.phone_number) errs.phone_number = "Phone number is required";
        
        if (Object.keys(errs).length > 0) {
            setCreateErrors(errs);
            return;
        }

        setCreateLoading(true);
        setCreateErrors({});
        try {
            const response = await api.post("/admin/distributors", newDistributor);
            if (response.data.success) {
                toast({
                    title: "Distributor Created",
                    description: response.data.message || "Distributor account created successfully"
                });
                setCreateDialogOpen(false);
                setNewDistributor({
                    name: "",
                    contact_name: "",
                    email: "",
                    phone_number: "",
                    address: "",
                    city: "",
                    state: "",
                    pincode: "",
                    gst_number: "",
                    asm_id: "",
                    allowed_brands: "AF"
                });
                fetchVendors(true);
            }
        } catch (error: any) {
            console.error("Failed to create distributor:", error);
            toast({
                title: "Creation Failed",
                description: getErrorMessage(error, "Failed to create distributor account"),
                variant: "destructive"
            });
        } finally {
            setCreateLoading(false);
        }
    };

    useEffect(() => {
        fetchVendors();
        api.get("/admin/vendor-asm-options")
            .then(res => setAsmOptions((res.data.asms || []).filter((a: { is_active: boolean }) => a.is_active)))
            .catch(() => setAsmOptions([]));
    }, []);

    // Reset pagination
    useEffect(() => {
        setCurrentPage(1);
    }, [filter, search]);

    const fetchVendors = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const response = await api.get("/admin/vendors");
            if (response.data.success) {
                const parsedVendors = response.data.vendors.map((v: any) => ({
                    ...v,
                    manpower_count: Number(v.manpower_count || 0),
                    order_pending_count: Number(v.order_pending_count || 0),
                    order_confirmed_count: Number(v.order_confirmed_count || 0),
                    order_declined_count: Number(v.order_declined_count || 0),
                    order_total_count: Number(v.order_total_count || 0),
                    is_verified: Boolean(v.is_verified),
                    is_active: v.is_active === 1 || v.is_active === true,
                    is_distributor: Boolean(v.is_distributor),
                    is_franchise: v.is_franchise === undefined ? true : Boolean(v.is_franchise),
                    distributor_allowed_brands: v.distributor_allowed_brands || 'AF',
                    franchise_allowed_brands: v.franchise_allowed_brands || 'AF',
                }));
                // Show only vendors promoted to distributors
                setVendors(parsedVendors.filter((v: any) => v.is_distributor));
            }
        } catch (error) {
            console.error("Failed to fetch distributors:", error);
            toast({
                title: "Distributor Fetch Failed",
                description: "Failed to fetch distributors list",
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
                    title: isVerified ? "Distributor Approved" : "Distributor Disapproved",
                    description: response.data.message,
                    variant: isVerified ? "default" : "destructive"
                });
                fetchVendors(true);
            }
        } catch (error: any) {
            console.error("Distributor verification error:", error);
            toast({
                title: "Verification Update Failed",
                description: getErrorMessage(error, "Failed to update distributor status"),
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
                    title: isActive ? "Distributor Activated" : "Distributor Deactivated",
                    description: response.data.message,
                    variant: isActive ? "default" : "destructive"
                });
                fetchVendors(true);
            }
        } catch (error: any) {
            console.error("Distributor activation error:", error);
            toast({
                title: "Activation Update Failed",
                description: getErrorMessage(error, "Failed to update distributor status"),
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
                toast({ description: "No distributors to export", variant: "destructive" });
                return;
            }

            const exportData = filteredVendors.map(v => ({
                "Store Name": v.store_name,
                "Brand": v.distributor_allowed_brands || "AF",
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
                "Status": v.is_verified ? "Active" : v.verified_at ? "Rejected" : "Pending",
                "Verified At": v.verified_at ? new Date(v.verified_at).toLocaleDateString() : "N/A",
                "Manpower Count": v.manpower_count || 0,
                "Team Members": v.manpower_names || "",
                "Allowed Categories": v.allowed_category_names || "None assigned",
                "Order Confirmed": v.order_confirmed_count || 0,
                "Order Pending": v.order_pending_count || 0,
                "Order Declined": v.order_declined_count || 0,
                "Order Total": v.order_total_count || 0
            }));

            downloadCSV(exportData, `distributors_${getISTTodayISO()}.csv`);

        } catch (error) {
            console.error("Export error:", error);
            toast({
                title: "Export Failed",
                description: "Failed to export distributor data",
                variant: "destructive"
            });
        }
    };

    const handleViewVendor = (vendor: any) => {
        setViewingVendor(vendor);
    };

    const filteredVendors = vendors
        .filter((vendor) => {
            if (filter === 'approved') return vendor.is_verified && vendor.is_active !== false;
            if (filter === 'inactive') return vendor.is_verified && vendor.is_active === false;
            if (filter === 'disapproved') return !vendor.is_verified && vendor.verified_at;
            if (filter === 'pending') return !vendor.is_verified && !vendor.verified_at;
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
                vendor.city?.toLowerCase().includes(term)
            );
        })
        .sort((a, b) => {
            let aVal = a[sortField];
            let bVal = b[sortField];

            if (sortField === 'created_at') {
                aVal = new Date(aVal || 0).getTime();
                bVal = new Date(bVal || 0).getTime();
            } else if (sortField === 'order_total_count') {
                aVal = Number(aVal) || 0;
                bVal = Number(bVal) || 0;
            } else if (sortField === 'status') {
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
        return <AdminVendorDetails vendor={viewingVendor} isDistributorsView={true} onBack={() => { setViewingVendor(null); fetchVendors(); }} />;
    }

    return (
        <div className="space-y-6">
            {/* Controls — tabs on top, search + actions on the line below */}
            <div className="flex flex-col gap-4 items-stretch">
                <Tabs value={filter} onValueChange={setFilter} className="w-full md:w-auto">
                    <TabsList className="grid w-full grid-cols-3 md:grid-cols-5 md:inline-flex bg-white/50 border border-orange-100 p-1 h-auto">
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

                <div className="flex flex-col sm:flex-row w-full gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder="Search distributors..."
                            className="pl-10 bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-11 sm:h-10"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="flex-1 sm:flex-none flex items-center gap-2 border-orange-100 h-11 sm:h-10">
                                    <ArrowUpDown className="h-4 w-4 text-orange-500" />
                                    {sortField === 'store_name' ? 'Name' : sortField === 'order_total_count' ? 'Orders' : sortField === 'city' ? 'Location' : sortField === 'status' ? 'Status' : 'Date'}
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
                                    onClick={() => { setSortField('order_total_count'); }}
                                    className="flex items-center justify-between text-xs font-bold py-3 px-3 rounded-xl cursor-pointer hover:bg-orange-50 focus:bg-orange-50 group"
                                >
                                    Total Orders {sortField === 'order_total_count' && <Check className="h-4 w-4 text-orange-500" />}
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
                        <Button variant="outline" onClick={handleExportVendors} className="flex-1 sm:flex-none h-11 sm:h-10 text-slate-600">
                            <Download className="h-4 w-4 mr-2" />
                            <span>Export</span>
                        </Button>
                        <Button onClick={() => setCreateDialogOpen(true)} className="flex-1 sm:flex-none h-11 sm:h-10 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl gap-2">
                            <Plus className="h-4 w-4" />
                            <span>Add Distributor</span>
                        </Button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <Card className="border-orange-100 shadow-sm overflow-hidden">
                <CardHeader className="bg-orange-50/30 border-b border-orange-50 pb-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-lg font-bold text-slate-800">Registered Distributors</CardTitle>
                            <CardDescription>Manage your distributor network partners</CardDescription>
                        </div>
                        <Badge variant="outline" className="bg-white text-slate-600 font-mono">
                            {filteredVendors.length} Total
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
                            <Building2 className="h-12 w-12 mx-auto mb-3 opacity-20" />
                            <p>No distributors found matching your criteria</p>
                        </div>
                    ) : (
                        <>
                            {/* Mobile View: Cards */}
                            <div className="grid grid-cols-1 gap-4 p-4 md:hidden">
                                {paginatedVendors.map((vendor) => (
                                    <div key={vendor.id} className="bg-white border border-orange-100 rounded-2xl p-5 shadow-sm space-y-4">
                                        <div className="flex justify-between items-start">
                                            <div
                                                className="cursor-pointer flex-1"
                                                onClick={() => handleViewVendor(vendor)}
                                            >
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-bold text-slate-800 text-lg leading-tight hover:text-orange-600 transition-colors">{vendor.store_name}</span>
                                                    {vendor.is_franchise ? (
                                                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200 text-[9px] px-1.5 py-0 font-bold">Franchise & Distributor</Badge>
                                                    ) : (
                                                        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200 text-[9px] px-1.5 py-0 font-bold">Pure Distributor</Badge>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-1.5">
                                                    <Mail className="h-3.5 w-3.5" /> {vendor.store_email}
                                                </div>
                                                <div className="text-[11px] text-slate-400 mt-1.5">
                                                    {vendor.allowed_category_names
                                                        ? `Sells: ${vendor.allowed_category_names}`
                                                        : 'No categories assigned'}
                                                </div>
                                            </div>
                                            <div className="flex gap-3 items-center">
                                                {/* Activation Toggle - only for verified vendors */}
                                                {vendor.is_verified && (
                                                    <div className="flex flex-col items-center gap-1" title={vendor.is_active ? "Deactivate Distributor" : "Activate Distributor"}>
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
                                                {vendor.is_verified && (
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
                                                {!vendor.is_verified && (
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
                                            </div>
                                            <div className="flex gap-4">
                                                <div className="text-center">
                                                    <div className="text-green-600 font-bold text-sm">{vendor.order_confirmed_count || 0}</div>
                                                    <div className="text-[8px] uppercase tracking-tighter text-slate-400">Confirmed</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="text-amber-600 font-bold text-sm">{vendor.order_pending_count || 0}</div>
                                                    <div className="text-[8px] uppercase tracking-tighter text-slate-400">Pending</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="text-red-600 font-bold text-sm">{vendor.order_declined_count || 0}</div>
                                                    <div className="text-[8px] uppercase tracking-tighter text-slate-400">Declined</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="text-slate-700 font-bold text-sm">{vendor.order_total_count || 0}</div>
                                                    <div className="text-[8px] uppercase tracking-tighter text-slate-400">Total</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Desktop View: Table */}
                            <table className="w-full text-sm text-left hidden md:table" style={{ minWidth: '1100px' }}>
                                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                                    <tr>
                                        <th className="px-6 py-4 whitespace-nowrap" style={{ minWidth: '220px' }}>Store Details</th>
                                        <th className="px-6 py-4 whitespace-nowrap" style={{ minWidth: '160px' }}>Contact</th>
                                        <th className="px-6 py-4 whitespace-nowrap" style={{ minWidth: '180px' }}>Location</th>
                                        <th className="px-6 py-4 text-center whitespace-nowrap" style={{ minWidth: '100px' }}>Status</th>
                                        <th className="px-6 py-4 text-center whitespace-nowrap" style={{ minWidth: '220px' }}>Orders</th>
                                        <th className="px-6 py-4 text-right whitespace-nowrap" style={{ minWidth: '240px' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {paginatedVendors.map((vendor) => (
                                        <tr key={vendor.id} className="hover:bg-orange-50/50 transition-colors group cursor-pointer" onClick={() => handleViewVendor(vendor)}>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 whitespace-nowrap">
                                                    <span className="font-bold text-slate-800 group-hover:text-orange-600 transition-colors">{vendor.store_name}</span>
                                                    {vendor.is_franchise ? (
                                                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200 text-[10px] px-2 py-0.5 font-bold whitespace-nowrap">Franchise & Distributor</Badge>
                                                    ) : (
                                                        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200 text-[10px] px-2 py-0.5 font-bold whitespace-nowrap">Pure Distributor</Badge>
                                                    )}
                                                    {/* Brand badge */}
                                                    {(vendor.distributor_allowed_brands || 'AF') === 'AFAC' ? (
                                                        <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[10px] px-2 py-0.5 font-bold whitespace-nowrap">AF+AC</Badge>
                                                    ) : (vendor.distributor_allowed_brands || 'AF') === 'AC' ? (
                                                        <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] px-2 py-0.5 font-bold whitespace-nowrap">AC</Badge>
                                                    ) : (
                                                        <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[10px] px-2 py-0.5 font-bold whitespace-nowrap">AF</Badge>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-500 flex items-center gap-1 mt-1 whitespace-nowrap">
                                                    <Mail className="h-3 w-3 shrink-0" /> {vendor.store_email}
                                                </div>
                                                <div className="text-[11px] text-slate-400 mt-1 max-w-[260px] truncate" title={vendor.allowed_category_names || 'No categories assigned'}>
                                                    {vendor.allowed_category_names
                                                        ? `Sells: ${vendor.allowed_category_names}`
                                                        : 'No categories assigned'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="font-medium text-slate-700">{vendor.contact_name}</div>
                                                <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                                                    <Phone className="h-3 w-3 shrink-0" /> {vendor.phone_number}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-1 text-slate-700">
                                                    <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                    {vendor.city}
                                                </div>
                                                <div className="text-xs text-slate-400 ml-4.5">{vendor.state}</div>
                                                {(vendor.latitude || vendor.longitude) && (
                                                    <div className="text-[10px] text-slate-400 ml-4.5 mt-0.5">Lat: {vendor.latitude || 'N/A'}, Lng: {vendor.longitude || 'N/A'}</div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-center whitespace-nowrap">
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
                                            <td className="px-6 py-4">
                                                <div className="flex justify-center gap-3 text-xs font-medium whitespace-nowrap">
                                                    <div className="text-center">
                                                        <div className="text-green-600">{vendor.order_confirmed_count || 0}</div>
                                                        <div className="text-[10px] text-slate-400">Confirmed</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-amber-600">{vendor.order_pending_count || 0}</div>
                                                        <div className="text-[10px] text-slate-400">Pending</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-red-600">{vendor.order_declined_count || 0}</div>
                                                        <div className="text-[10px] text-slate-400">Declined</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-slate-700">{vendor.order_total_count || 0}</div>
                                                        <div className="text-[10px] text-slate-400">Total</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex justify-end items-center gap-4 whitespace-nowrap">
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

                                                    {/* Brand selector */}
                                                    {vendor.is_verified && vendor.is_distributor && (
                                                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                                            {(['AF', 'AC', 'AFAC'] as const).map(b => (
                                                                <button
                                                                    key={b}
                                                                    disabled={updatingBrand === vendor.id}
                                                                    onClick={() => setPendingBrandChange({ vendor, brand: b })}
                                                                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all ${
                                                                        (vendor.distributor_allowed_brands || 'AF') === b
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

                                                    {!vendor.is_verified && (
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

            <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Reject Distributor Application</DialogTitle>
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

            {/* Brand change confirmation dialog */}
            <Dialog open={!!pendingBrandChange} onOpenChange={(open) => { if (!open) setPendingBrandChange(null); }}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle>Confirm Brand Update</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to update the brand for{' '}
                            <span className="font-semibold text-slate-800">{pendingBrandChange?.vendor.store_name}</span>{' '}
                            (Distributor) to{' '}
                            <span className={`font-bold ${pendingBrandChange?.brand === 'AF' ? 'text-orange-600' : pendingBrandChange?.brand === 'AC' ? 'text-blue-600' : 'text-purple-600'}`}>
                                {pendingBrandChange?.brand === 'AF' ? 'Autoform (AF)' : pendingBrandChange?.brand === 'AC' ? 'Autocruze (AC)' : 'AFAC'}
                            </span>?
                            <br /><br />
                            <span className="text-amber-700 font-medium text-xs">This affects which products this distributor can carry and which franchises can be assigned to them.</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="outline" onClick={() => setPendingBrandChange(null)}>Cancel</Button>
                        <Button
                            onClick={handleUpdateBrand}
                            disabled={!!updatingBrand}
                            className={pendingBrandChange?.brand === 'AF' ? 'bg-orange-500 hover:bg-orange-600 text-white' : pendingBrandChange?.brand === 'AC' ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-purple-500 hover:bg-purple-600 text-white'}
                        >
                            {updatingBrand ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Yes, Update to {pendingBrandChange?.brand}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border-orange-100 shadow-2xl p-6 sm:p-8">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-bold text-slate-800">Add New Distributor</DialogTitle>
                        <DialogDescription className="text-slate-500">
                            Create a new distributor account. They will be able to log in using their phone number via OTP.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateDistributor} className="space-y-5 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-2">
                                <Label htmlFor="name" className="text-sm font-bold text-slate-700">Distributor Store Name *</Label>
                                <Input
                                    id="name"
                                    placeholder="e.g. Autoform Delhi Dist"
                                    className="bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-11"
                                    value={newDistributor.name}
                                    onChange={(e) => setNewDistributor({ ...newDistributor, name: e.target.value })}
                                />
                                {createErrors.name && <p className="text-xs text-red-500 font-medium">{createErrors.name}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="contact_name" className="text-sm font-bold text-slate-700">Contact Person Name *</Label>
                                <Input
                                    id="contact_name"
                                    placeholder="e.g. Ramesh Kumar"
                                    className="bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-11"
                                    value={newDistributor.contact_name}
                                    onChange={(e) => setNewDistributor({ ...newDistributor, contact_name: e.target.value })}
                                />
                                {createErrors.contact_name && <p className="text-xs text-red-500 font-medium">{createErrors.contact_name}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-sm font-bold text-slate-700">Store Email *</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="e.g. delhi@autoform.com"
                                    className="bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-11"
                                    value={newDistributor.email}
                                    onChange={(e) => setNewDistributor({ ...newDistributor, email: e.target.value })}
                                />
                                {createErrors.email && <p className="text-xs text-red-500 font-medium">{createErrors.email}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone_number" className="text-sm font-bold text-slate-700">Phone Number (10-Digit OTP Login) *</Label>
                                <Input
                                    id="phone_number"
                                    placeholder="e.g. 9876543210"
                                    className="bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-11"
                                    value={newDistributor.phone_number}
                                    onChange={(e) => setNewDistributor({ ...newDistributor, phone_number: e.target.value })}
                                />
                                {createErrors.phone_number && <p className="text-xs text-red-500 font-medium">{createErrors.phone_number}</p>}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="address" className="text-sm font-bold text-slate-700">Address</Label>
                            <Input
                                id="address"
                                placeholder="Plot No, Street, Area"
                                className="bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-11"
                                value={newDistributor.address}
                                onChange={(e) => setNewDistributor({ ...newDistributor, address: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                            <div className="space-y-2">
                                <Label htmlFor="city" className="text-sm font-bold text-slate-700">City</Label>
                                <Input
                                    id="city"
                                    placeholder="City"
                                    className="bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-11"
                                    value={newDistributor.city}
                                    onChange={(e) => setNewDistributor({ ...newDistributor, city: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="state" className="text-sm font-bold text-slate-700">State</Label>
                                <Input
                                    id="state"
                                    placeholder="State"
                                    className="bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-11"
                                    value={newDistributor.state}
                                    onChange={(e) => setNewDistributor({ ...newDistributor, state: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="pincode" className="text-sm font-bold text-slate-700">Pincode</Label>
                                <Input
                                    id="pincode"
                                    placeholder="6-digit Pincode"
                                    className="bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-11"
                                    value={newDistributor.pincode}
                                    onChange={(e) => setNewDistributor({ ...newDistributor, pincode: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-2">
                                <Label htmlFor="gst_number" className="text-sm font-bold text-slate-700">GST Number</Label>
                                <Input
                                    id="gst_number"
                                    placeholder="e.g. 22AAAAA0000A1Z5"
                                    className="bg-white border-orange-100 focus:border-orange-300 focus:ring-orange-200 h-11 font-mono uppercase"
                                    value={newDistributor.gst_number}
                                    onChange={(e) => setNewDistributor({ ...newDistributor, gst_number: e.target.value.toUpperCase() })}
                                    maxLength={15}
                                />
                                <p className="text-[11px] text-slate-400">15-character GST Identification Number</p>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-sm font-bold text-slate-700">ASM</Label>
                                <Select
                                    value={newDistributor.asm_id || "none"}
                                    onValueChange={(v) => setNewDistributor({ ...newDistributor, asm_id: v === "none" ? "" : v })}
                                >
                                    <SelectTrigger className="bg-white border-orange-100 h-11">
                                        <SelectValue placeholder="No ASM assigned" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">No ASM assigned</SelectItem>
                                        {asmOptions.map(a => (
                                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-bold text-slate-700">Brand Assignment *</Label>
                            <div className="flex gap-2">
                                {(['AF', 'AC', 'AFAC'] as const).map(b => (
                                    <button
                                        key={b}
                                        type="button"
                                        onClick={() => setNewDistributor({ ...newDistributor, allowed_brands: b })}
                                        className={`flex-1 py-2 rounded-xl border text-sm font-bold transition-all ${
                                            newDistributor.allowed_brands === b
                                                ? b === 'AF' ? 'bg-orange-500 text-white border-orange-500'
                                                  : b === 'AC' ? 'bg-blue-500 text-white border-blue-500'
                                                  : 'bg-purple-500 text-white border-purple-500'
                                                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                                        }`}
                                    >
                                        {b === 'AF' ? 'Autoform (AF)' : b === 'AC' ? 'Autocruze (AC)' : 'AFAC'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <DialogFooter className="pt-4 gap-2">
                            <Button type="button" variant="outline" className="border-orange-100" onClick={() => setCreateDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={createLoading} className="bg-orange-500 hover:bg-orange-600 text-white font-bold">
                                {createLoading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        Creating...
                                    </>
                                ) : (
                                    "Create Distributor"
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
};
