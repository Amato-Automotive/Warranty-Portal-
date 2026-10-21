import { useState, useEffect, useCallback } from "react";
import {
    Search,
    Plus,
    Trash2,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
    Hash,
    Loader2,
    AlertCircle,
    Package,
    ArrowLeft,
    Eye,
    ArrowUpDown,
    History,
    Globe,
    Download,
    Upload,
    FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { vehicleNumberOf } from "@/lib/vehicleNumber";

interface UIDRecord {
    uid: string;
    is_used: boolean;
    used_at: string | null;
    created_at: string;
    source: "api_sync" | "manual" | "legacy_migration" | "customer_added" | "unknown";
    product_name?: string;
    customer_name?: string;
    customer_email?: string;
    customer_phone?: string;
    registration_number?: string;
    product_type?: string;
    warranty_type?: string;
    warranty_status?: string;
    purchase_date?: string;
    product_details?: string;
    installer_name?: string;
    installer_contact?: string;
    car_year?: string;
    car_colour?: string;
    car_make?: string;
    car_model?: string;
    warranty_created_at?: string;
    rejection_reason?: string;
}

interface UIDStats {
    total: number;
    available: number;
    used: number;
    synced: number;
    manual_count: number;
    legacy_count: number;
    customer_added_count: number;
}

interface UIDManagementProps {
    onBack?: () => void;
}

export const AdminUIDManagement = ({ onBack }: UIDManagementProps) => {
    const { toast } = useToast();
    const [uids, setUIDs] = useState<UIDRecord[]>([]);
    const [stats, setStats] = useState<UIDStats>({ total: 0, available: 0, used: 0, synced: 0, manual_count: 0, legacy_count: 0, customer_added_count: 0 });
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "available" | "used">("all");
    const [sourceFilter, setSourceFilter] = useState<string>("all");
    const [sort, setSort] = useState<string>("created_at");
    const [order, setOrder] = useState<"asc" | "desc">("desc");
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    // Spec Sheet Dialog
    const [selectedUID, setSelectedUID] = useState<UIDRecord | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);

    // Add UID dialog
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [newUID, setNewUID] = useState("");
    const [newProductName, setNewProductName] = useState("");
    const [isCustomProduct, setIsCustomProduct] = useState(false);
    const [products, setProducts] = useState<any[]>([]);
    const [addLoading, setAddLoading] = useState(false);

    // Bulk add (CSV/Excel) dialog
    const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
    const [bulkFileName, setBulkFileName] = useState("");
    const [bulkParsedUids, setBulkParsedUids] = useState<string[]>([]);
    const [bulkParseError, setBulkParseError] = useState("");
    const [bulkLoading, setBulkLoading] = useState(false);
    const [bulkResult, setBulkResult] = useState<any>(null);

    // Delete confirmation
    const [deleteUID, setDeleteUID] = useState<string | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);

    // Export loading
    const [exportLoading, setExportLoading] = useState(false);

    useEffect(() => {
        const fetchProducts = async () => {
            try {
                const response = await api.get('/public/products');
                if (response.data.success) {
                    setProducts(response.data.products.filter((p: any) => p.type === 'seat_cover'));
                }
            } catch (err) {
                console.error("Failed to fetch products:", err);
            }
        };
        fetchProducts();
    }, []);

    const fetchUIDs = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: "30",
                status: statusFilter,
                source: sourceFilter,
                sort,
                order,
            });
            if (search) params.set("search", search);

            const response = await api.get(`/uid?${params.toString()}`);
            if (response.data.success) {
                setUIDs(response.data.uids);
                setStats(response.data.stats);
                setTotalPages(response.data.pagination.totalPages);
                setTotalCount(response.data.pagination.totalCount);
            }
        } catch (error) {
            console.error("Failed to fetch UIDs:", error);
            toast({ title: "Error", description: "Failed to load UIDs", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [page, statusFilter, sourceFilter, sort, order, search, toast]);

    const fetchUIDDetails = async (uid: string) => {
        setDetailsLoading(true);
        setDetailsOpen(true);
        try {
            const response = await api.get(`/uid/${uid}/details`);
            if (response.data.success) {
                setSelectedUID(response.data.data);
            }
        } catch (error) {
            console.error("Failed to fetch UID details:", error);
            toast({ title: "Error", description: "Failed to load UID details", variant: "destructive" });
            setDetailsOpen(false);
        } finally {
            setDetailsLoading(false);
        }
    };

    useEffect(() => {
        fetchUIDs();
    }, [fetchUIDs]);

    // Debounce search
    useEffect(() => {
        setPage(1);
    }, [search, statusFilter, sourceFilter]);

     const handleAddUID = async () => {
        if (!/^\d{13,22}$/.test(newUID)) {
            toast({ title: "Invalid UID", description: "UID must be a 13-22 digit number", variant: "destructive" });
            return;
        }
        setAddLoading(true);
        try {
            const response = await api.post("/uid/add", { 
                uid: newUID,
                productName: newProductName
            });
            if (response.data.success) {
                toast({ title: "Success", description: `UID ${newUID} added successfully` });
                setNewUID("");
                setNewProductName("");
                setIsCustomProduct(false);
                setAddDialogOpen(false);
                fetchUIDs();
            }
        } catch (error: any) {
            const msg = getErrorMessage(error, "Failed to add UID");
            toast({ title: "Error", description: msg, variant: "destructive" });
        } finally {
            setAddLoading(false);
        }
    };

    const resetBulk = () => {
        setBulkFileName("");
        setBulkParsedUids([]);
        setBulkParseError("");
        setBulkResult(null);
    };

    // Parse a CSV/Excel file into a list of UID strings (first column, any sheet).
    const handleBulkFileSelected = async (file: File | null) => {
        resetBulk();
        if (!file) return;
        setBulkFileName(file.name);
        try {
            const XLSX = await import("xlsx");
            const data = await file.arrayBuffer();
            const wb = XLSX.read(data, { type: "array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });

            // Flatten every cell, keep 13-16 digit numeric tokens. Skip a header
            // cell like "UID" automatically since it won't match the digit rule.
            const seen = new Set<string>();
            const uids: string[] = [];
            for (const row of rows) {
                for (const cell of row) {
                    const val = String(cell ?? "").trim();
                    if (/^\d{13,16}$/.test(val) && !seen.has(val)) {
                        seen.add(val);
                        uids.push(val);
                    }
                }
            }

            if (uids.length === 0) {
                setBulkParseError("No valid 13-16 digit UIDs found in this file.");
                return;
            }
            setBulkParsedUids(uids);
        } catch (err) {
            console.error("Failed to parse file:", err);
            setBulkParseError("Could not read this file. Please upload a valid .csv or .xlsx file.");
        }
    };

    const handleBulkAdd = async () => {
        if (bulkParsedUids.length === 0) return;
        setBulkLoading(true);
        setBulkResult(null);
        try {
            const response = await api.post("/uid/bulk-add", { uids: bulkParsedUids });
            if (response.data.success) {
                setBulkResult(response.data.stats);
                const s = response.data.stats;
                toast({
                    title: "Bulk Upload Complete",
                    description: `${s.inserted} added, ${s.already_exists_available + s.already_exists_used} already existed, ${s.invalid_format} invalid.`,
                });
                fetchUIDs();
            }
        } catch (error: any) {
            const msg = getErrorMessage(error, "Failed to upload UIDs");
            toast({ title: "Error", description: msg, variant: "destructive" });
        } finally {
            setBulkLoading(false);
        }
    };

    const handleDeleteUID = async () => {
        if (!deleteUID) return;
        setDeleteLoading(true);
        try {
            const response = await api.delete(`/uid/${deleteUID}`);
            if (response.data.success) {
                toast({ title: "Deleted", description: `UID ${deleteUID} removed` });
                setDeleteUID(null);
                fetchUIDs();
            }
        } catch (error: any) {
            const msg = getErrorMessage(error, "Failed to delete UID");
            toast({ title: "Error", description: msg, variant: "destructive" });
        } finally {
            setDeleteLoading(false);
        }
    };

    const handleExport = async () => {
        setExportLoading(true);
        try {
            const params = new URLSearchParams({
                status: statusFilter,
                source: sourceFilter,
                sort,
                order,
            });
            if (search) params.set("search", search);

            const response = await api.get(`/uid/export?${params.toString()}`, {
                responseType: 'blob'
            });

            // Create a link to download the file
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `uids_export_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();

            toast({ title: "Success", description: "UID export started" });
        } catch (error) {
            console.error("Failed to export UIDs:", error);
            toast({ title: "Error", description: "Failed to export UIDs", variant: "destructive" });
        } finally {
            setExportLoading(false);
        }
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return "—";
        return new Date(dateStr).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    return (
        <div className="animate-in fade-in duration-500 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <Button variant="ghost" size="icon" onClick={onBack} className="rounded-full h-9 w-9 hover:bg-orange-50">
                            <ArrowLeft className="h-5 w-5 text-slate-600" />
                        </Button>
                    )}
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight">UID Management</h2>
                        <p className="text-sm text-slate-500">Manage pre-generated product UIDs for seat cover warranties</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchUIDs}
                        disabled={loading}
                        className="h-9 px-4 rounded-xl border-orange-100 text-orange-600 hover:bg-orange-50"
                    >
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExport}
                        disabled={exportLoading || loading}
                        className="h-9 px-4 rounded-xl border-blue-100 text-blue-600 hover:bg-blue-50"
                    >
                        {exportLoading ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Download className="h-4 w-4 mr-2" />
                        )}
                        Export
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { resetBulk(); setBulkDialogOpen(true); }}
                        className="h-9 px-4 rounded-xl border-emerald-100 text-emerald-600 hover:bg-emerald-50"
                    >
                        <Upload className="h-4 w-4 mr-2" />
                        Bulk Add
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => setAddDialogOpen(true)}
                        className="h-9 px-4 rounded-xl bg-[#f46617] hover:bg-[#d85512] text-white shadow-lg shadow-orange-500/20"
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Add UID
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm text-center">
                    <div className="text-2xl font-black text-slate-800">{stats.total.toLocaleString()}</div>
                    <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mt-1">Total</div>
                </div>
                <div className="bg-white rounded-2xl border border-emerald-100 p-4 shadow-sm text-center">
                    <div className="text-2xl font-black text-emerald-600">{stats.available.toLocaleString()}</div>
                    <div className="text-xs font-medium text-emerald-400 uppercase tracking-wider mt-1">Available</div>
                </div>
                <div className="bg-white rounded-2xl border border-blue-100 p-4 shadow-sm text-center lg:col-span-1">
                    <div className="text-2xl font-black text-blue-600">{stats.used.toLocaleString()}</div>
                    <div className="text-xs font-medium text-blue-400 uppercase tracking-wider mt-1">Used</div>
                </div>
                <div className="bg-white rounded-2xl border border-indigo-100 p-4 shadow-sm text-center">
                    <div className="text-2xl font-black text-indigo-600">{stats.synced.toLocaleString()}</div>
                    <div className="text-xs font-medium text-indigo-400 uppercase tracking-wider mt-1">Synced</div>
                </div>
                <div className="bg-white rounded-2xl border border-amber-100 p-4 shadow-sm text-center">
                    <div className="text-2xl font-black text-amber-600">{stats.manual_count.toLocaleString()}</div>
                    <div className="text-xs font-medium text-amber-400 uppercase tracking-wider mt-1">Manual</div>
                </div>
                <div className="bg-white rounded-2xl border border-pink-100 p-4 shadow-sm text-center">
                    <div className="text-2xl font-black text-pink-600">{stats.customer_added_count.toLocaleString()}</div>
                    <div className="text-xs font-medium text-pink-400 uppercase tracking-wider mt-1">Customer Added</div>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                        type="text"
                        placeholder="Search UIDs, customer, vehicle..."
                        className="pl-10 h-10 rounded-xl border-slate-200 bg-white"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Status Filter */}
                    <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-100 shadow-sm">
                        {(["all", "available", "used"] as const).map((s) => (
                            <Button
                                key={s}
                                variant="ghost"
                                size="sm"
                                onClick={() => setStatusFilter(s)}
                                className={`
                                    rounded-lg h-8 px-3 text-[10px] font-bold uppercase tracking-wider
                                    ${statusFilter === s
                                        ? s === "available"
                                            ? "bg-emerald-50 text-emerald-600"
                                            : s === "used"
                                                ? "bg-blue-50 text-blue-600"
                                                : "bg-orange-50 text-orange-600"
                                        : "text-slate-400"
                                    }
                                `}
                            >
                                {s}
                            </Button>
                        ))}
                    </div>

                    {/* Source Filter */}
                    <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-100 shadow-sm">
                        {[
                            { id: "all", label: "All Sources" },
                            { id: "api_sync", label: "Synced", color: "text-indigo-600", bg: "bg-indigo-50" },
                            { id: "manual", label: "Manual", color: "text-amber-600", bg: "bg-amber-50" },
                            { id: "legacy_migration", label: "Legacy", color: "text-blue-600", bg: "bg-blue-50" },
                            { id: "customer_added", label: "Customer Added", color: "text-pink-600", bg: "bg-pink-50" },
                        ].map((s) => (
                            <Button
                                key={s.id}
                                variant="ghost"
                                size="sm"
                                onClick={() => setSourceFilter(s.id)}
                                className={`
                                    rounded-lg h-8 px-3 text-[10px] font-bold uppercase tracking-wider
                                    ${sourceFilter === s.id
                                        ? `${s.bg || "bg-orange-50"} ${s.color || "text-orange-600"}`
                                        : "text-slate-400"
                                    }
                                `}
                            >
                                {s.label}
                            </Button>
                        ))}
                    </div>

                    {/* Sort Toggle */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
                        className="h-10 px-3 rounded-xl border-slate-200 text-slate-600 bg-white"
                        title={`Sorting ${order === "asc" ? "Ascending" : "Descending"}`}
                    >
                        <ArrowUpDown className={`h-4 w-4 ${order === "asc" ? "rotate-180" : ""} transition-transform`} />
                    </Button>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
                        <span className="ml-2 text-sm text-slate-500">Loading UIDs...</span>
                    </div>
                ) : uids.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                        <Package className="h-10 w-10 mb-3 text-slate-300" />
                        <p className="text-sm font-medium">No UIDs found</p>
                        <p className="text-xs mt-1">
                            {search ? "Try a different search term" : "Add UIDs manually or sync from the UID generator"}
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Desktop Table */}
                        <div className="hidden md:block">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-50 bg-slate-50/50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                        <th className="text-left py-3 px-4 cursor-pointer hover:text-orange-600 transition-colors" onClick={() => setSort("uid")}>
                                            <div className="flex items-center gap-1">UID {sort === "uid" && <ArrowUpDown className="h-3 w-3" />}</div>
                                        </th>
                                        <th className="text-left py-3 px-4">Product Name</th>
                                        <th className="text-center py-3 px-4">Status</th>
                                        <th className="text-left py-3 px-4 cursor-pointer hover:text-orange-600 transition-colors" onClick={() => setSort("source")}>
                                            <div className="flex items-center gap-1">Source {sort === "source" && <ArrowUpDown className="h-3 w-3" />}</div>
                                        </th>
                                        <th className="text-left py-3 px-4">Linked To</th>
                                        <th className="text-left py-3 px-4 cursor-pointer hover:text-orange-600 transition-colors" onClick={() => setSort("used_at")}>
                                            <div className="flex items-center gap-1">Used At {sort === "used_at" && <ArrowUpDown className="h-3 w-3" />}</div>
                                        </th>
                                        <th className="text-left py-3 px-4 cursor-pointer hover:text-orange-600 transition-colors" onClick={() => setSort("created_at")}>
                                            <div className="flex items-center gap-1">Created {sort === "created_at" && <ArrowUpDown className="h-3 w-3" />}</div>
                                        </th>
                                        <th className="text-center py-3 px-4">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {uids.map((uid) => (
                                        <tr key={uid.uid} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                                            <td className="py-3 px-4">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <Hash className="h-3.5 w-3.5 text-slate-300" />
                                                        <span className="font-mono font-semibold text-slate-700 tracking-wider truncate max-w-[150px]">{uid.uid}</span>
                                                    </div>
                                                    {uid.uid.length > 16 && (
                                                        <span className="text-[9px] font-bold text-orange-500 uppercase mt-0.5 ml-5">Old Format</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-slate-600 font-semibold text-xs max-w-[150px] truncate">
                                                {uid.product_name || <span className="text-slate-300">—</span>}
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                {uid.is_used ? (
                                                    <Badge className="bg-blue-50 text-blue-600 border border-blue-100 font-bold text-[9px] rounded-full h-5 px-2">
                                                        Used
                                                    </Badge>
                                                ) : (
                                                    <Badge className="bg-emerald-50 text-emerald-600 border border-emerald-100 font-bold text-[9px] rounded-full h-5 px-2">
                                                        Available
                                                    </Badge>
                                                )}
                                            </td>
                                            <td className="py-3 px-4">
                                                {uid.source === "api_sync" ? (
                                                    <Badge className="bg-indigo-50 text-indigo-600 border border-indigo-100 font-bold text-[9px] rounded-full h-5 px-2">
                                                        Synced
                                                    </Badge>
                                                ) : uid.source === "manual" ? (
                                                    <Badge className="bg-amber-50 text-amber-600 border border-amber-100 font-bold text-[9px] rounded-full h-5 px-2">
                                                        Manual
                                                    </Badge>
                                                ) : uid.source === "legacy_migration" ? (
                                                    <Badge className="bg-blue-50 text-blue-600 border border-blue-100 font-bold text-[9px] rounded-full h-5 px-2">
                                                        Legacy
                                                    </Badge>
                                                ) : uid.source === "customer_added" ? (
                                                    <Badge className="bg-pink-50 text-pink-600 border border-pink-100 font-bold text-[9px] rounded-full h-5 px-2">
                                                        Customer Added
                                                    </Badge>
                                                ) : (
                                                    <Badge className="bg-slate-50 text-slate-400 border border-slate-100 font-bold text-[9px] rounded-full h-5 px-2">
                                                        Unknown
                                                    </Badge>
                                                )}
                                            </td>
                                            <td className="py-3 px-4">
                                                {uid.customer_name ? (
                                                    <div className="flex flex-col">
                                                        <span className="font-semibold text-slate-700 truncate max-w-[120px]">{uid.customer_name}</span>
                                                        {vehicleNumberOf(uid.registration_number) && <span className="text-[10px] text-slate-400 uppercase">{vehicleNumberOf(uid.registration_number)}</span>}
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-300">â€”</span>
                                                )}
                                            </td>
                                            <td className="py-3 px-4 text-slate-500 text-xs">{formatDate(uid.used_at)}</td>
                                            <td className="py-3 px-4 text-slate-500 text-xs">{formatDate(uid.created_at)}</td>
                                            <td className="py-3 px-4 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => fetchUIDDetails(uid.uid)}
                                                        className="h-8 w-8 rounded-lg text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50"
                                                        title="View Spec Sheet"
                                                    >
                                                        <Eye className="h-3.5 w-3.5" />
                                                    </Button>
                                                    {!uid.is_used && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => setDeleteUID(uid.uid)}
                                                            className="h-8 w-8 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50"
                                                            title="Delete"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile Cards */}
                        <div className="md:hidden divide-y divide-slate-50">
                            {uids.map((uid) => (
                                <div key={uid.uid} className="p-4 flex flex-col gap-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <Hash className="h-3 w-3 text-slate-300 shrink-0" />
                                                <span className="font-mono font-semibold text-slate-700 text-sm tracking-wider truncate">{uid.uid}</span>
                                            </div>
                                            {uid.uid.length > 16 && (
                                                <div className="text-[9px] font-bold text-orange-500 uppercase ml-5 mb-2">Old Format</div>
                                            )}

                                            <div className="flex flex-wrap gap-2 mb-2">
                                                {uid.is_used ? (
                                                    <Badge className="bg-blue-50 text-blue-600 border border-blue-100 font-bold text-[8px] rounded-full px-2 py-0">Used</Badge>
                                                ) : (
                                                    <Badge className="bg-emerald-50 text-emerald-600 border border-emerald-100 font-bold text-[8px] rounded-full px-2 py-0">Available</Badge>
                                                )}

                                                <Badge className={`
                                                    font-bold text-[8px] rounded-full px-2 py-0 border
                                                    ${uid.source === "api_sync" ? "bg-indigo-50 text-indigo-600 border-indigo-100" :
                                                        uid.source === "manual" ? "bg-amber-50 text-amber-600 border-amber-100" :
                                                            uid.source === "legacy_migration" ? "bg-blue-50 text-blue-600 border-blue-100" :
                                                                uid.source === "customer_added" ? "bg-pink-50 text-pink-600 border-pink-100" :
                                                                    "bg-slate-50 text-slate-400 border-slate-100"}
                                                `}>
                                                    {uid.source === "api_sync" ? "Synced" :
                                                        uid.source === "manual" ? "Manual" :
                                                            uid.source === "legacy_migration" ? "Legacy" :
                                                                uid.source === "customer_added" ? "Customer Added" : "Unknown"}
                                                </Badge>
                                            </div>

                                            {uid.product_name && (
                                                <div className="text-xs font-semibold text-slate-600 mb-2">
                                                    Product: {uid.product_name}
                                                </div>
                                            )}

                                            {uid.customer_name && (
                                                <div className="flex flex-col mb-2 p-2 bg-slate-50 rounded-lg">
                                                    <span className="text-xs font-bold text-slate-600 truncate">{uid.customer_name}</span>
                                                    {vehicleNumberOf(uid.registration_number) && <span className="text-[9px] text-slate-400 uppercase tracking-tight">{vehicleNumberOf(uid.registration_number)}</span>}
                                                </div>
                                            )}

                                            <div className="flex flex-col gap-1 text-[10px] text-slate-400">
                                                <div className="flex items-center gap-1"><Plus className="h-2.5 w-2.5" /> Created {formatDate(uid.created_at)}</div>
                                                {uid.used_at && <div className="flex items-center gap-1"><History className="h-2.5 w-2.5" /> Used {formatDate(uid.used_at)}</div>}
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-2 shrink-0">
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                onClick={() => fetchUIDDetails(uid.uid)}
                                                className="h-8 w-8 rounded-xl border-slate-100 text-indigo-500 shadow-sm"
                                            >
                                                <Eye className="h-3.5 w-3.5" />
                                            </Button>
                                            {!uid.is_used && (
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() => setDeleteUID(uid.uid)}
                                                    className="h-8 w-8 rounded-xl border-red-50 text-red-400 shadow-sm"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between py-2">
                    <span className="text-xs text-slate-400">
                        Showing {(page - 1) * 30 + 1}â€“{Math.min(page * 30, totalCount)} of {totalCount}
                    </span>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="h-8 w-8 rounded-lg border-slate-200"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-xs font-bold text-slate-600">{page} / {totalPages}</span>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="h-8 w-8 rounded-lg border-slate-200"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Add UID Dialog */}
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogContent className="sm:max-w-md rounded-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-bold">Add UID Manually</DialogTitle>
                        <DialogDescription>
                            Enter a 13â€“22 digit UID from the product packaging. This is for cases where the sticker was removed or misplaced.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">UID (13-16 digits)</label>
                            <Input
                                type="text"
                                placeholder="Enter 13-16 digit UID"
                                value={newUID}
                                onChange={(e) => setNewUID(e.target.value.replace(/\D/g, "").slice(0, 16))}
                                maxLength={16}
                                className="font-mono tracking-wider text-center text-lg h-12 rounded-xl border-slate-200"
                            />
                        </div>
                        <div className="flex items-center justify-between px-1">
                            <span className="text-xs text-slate-400">{newUID.length}/16 digits</span>
                            {newUID.length >= 13 && newUID.length <= 16 ? (
                                <span className="text-xs text-emerald-500 flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" /> Valid format
                                </span>
                            ) : newUID.length > 0 ? (
                                <span className="text-xs text-red-400 flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3" /> Need {13 - newUID.length > 0 ? `${13 - newUID.length} more` : "valid"} digits
                                </span>
                            ) : null}
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Product Name / Design</label>
                            <select 
                                className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-orange-500"
                                value={isCustomProduct ? "custom" : newProductName}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === "custom") {
                                        setIsCustomProduct(true);
                                        setNewProductName("");
                                    } else {
                                        setIsCustomProduct(false);
                                        setNewProductName(val);
                                    }
                                }}
                            >
                                <option value="">No Product linked</option>
                                {products.map(p => (
                                    <option key={p.id} value={p.name}>{p.name}</option>
                                ))}
                                <option value="custom">+ Add New Design / Custom Product</option>
                            </select>
                        </div>

                        {isCustomProduct && (
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">New Product Name</label>
                                <Input
                                    type="text"
                                    placeholder="Enter new product design name"
                                    value={newProductName}
                                    onChange={(e) => setNewProductName(e.target.value)}
                                    className="rounded-xl border-slate-200 text-sm"
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setAddDialogOpen(false); setNewUID(""); setNewProductName(""); setIsCustomProduct(false); }} className="rounded-xl">
                            Cancel
                        </Button>
                        <Button
                            onClick={handleAddUID}
                            disabled={addLoading || !/^\d{13,16}$/.test(newUID)}
                            className="rounded-xl bg-[#f46617] hover:bg-[#d85512] text-white"
                        >
                            {addLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Add UID
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Bulk Add (CSV/Excel) Dialog */}
            <Dialog open={bulkDialogOpen} onOpenChange={(open) => { if (!open) { setBulkDialogOpen(false); resetBulk(); } }}>
                <DialogContent className="sm:max-w-md rounded-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-bold flex items-center gap-2">
                            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                            Bulk Add UIDs
                        </DialogTitle>
                        <DialogDescription>
                            Upload a CSV or Excel file. Every 13-16 digit number found in the file is added as a new UID (source: Manual). Duplicates and already-existing UIDs are skipped automatically.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        {/* File picker */}
                        <label
                            htmlFor="bulkUidFile"
                            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-xl p-6 cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors text-center"
                        >
                            <Upload className="h-6 w-6 text-slate-400" />
                            <div className="text-sm font-medium text-slate-700">
                                {bulkFileName || "Click to choose a .csv or .xlsx file"}
                            </div>
                            <div className="text-xs text-slate-400">First column should contain the UIDs</div>
                            <input
                                id="bulkUidFile"
                                type="file"
                                accept=".csv,.xlsx,.xls"
                                className="hidden"
                                onChange={(e) => handleBulkFileSelected(e.target.files?.[0] || null)}
                            />
                        </label>

                        {bulkParseError && (
                            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">
                                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                <span>{bulkParseError}</span>
                            </div>
                        )}

                        {bulkParsedUids.length > 0 && !bulkResult && (
                            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                <span><span className="font-bold">{bulkParsedUids.length.toLocaleString()}</span> valid UID{bulkParsedUids.length === 1 ? "" : "s"} found and ready to upload.</span>
                            </div>
                        )}

                        {/* Result summary */}
                        {bulkResult && (
                            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
                                <div className="text-sm font-bold text-slate-800">Upload Result</div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="flex justify-between bg-white rounded-lg px-3 py-2"><span className="text-slate-500">Added</span><span className="font-bold text-emerald-600">{bulkResult.inserted}</span></div>
                                    <div className="flex justify-between bg-white rounded-lg px-3 py-2"><span className="text-slate-500">Already existed</span><span className="font-bold text-blue-600">{bulkResult.already_exists_available + bulkResult.already_exists_used}</span></div>
                                    <div className="flex justify-between bg-white rounded-lg px-3 py-2"><span className="text-slate-500">Invalid</span><span className="font-bold text-red-500">{bulkResult.invalid_format}</span></div>
                                    <div className="flex justify-between bg-white rounded-lg px-3 py-2"><span className="text-slate-500">Duplicates in file</span><span className="font-bold text-amber-600">{bulkResult.duplicate_in_request}</span></div>
                                </div>
                                <div className="text-[11px] text-slate-400 pt-1">Total received: {bulkResult.total_received.toLocaleString()}</div>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        {bulkResult ? (
                            <Button onClick={() => { setBulkDialogOpen(false); resetBulk(); }} className="rounded-xl bg-[#f46617] hover:bg-[#d85512] text-white">
                                Done
                            </Button>
                        ) : (
                            <>
                                <Button variant="outline" onClick={() => { setBulkDialogOpen(false); resetBulk(); }} className="rounded-xl">
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleBulkAdd}
                                    disabled={bulkLoading || bulkParsedUids.length === 0}
                                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
                                >
                                    {bulkLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    Upload {bulkParsedUids.length > 0 ? `${bulkParsedUids.length.toLocaleString()} UIDs` : ""}
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteUID} onOpenChange={(open) => !open && setDeleteUID(null)}>
                <DialogContent className="sm:max-w-sm rounded-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-bold text-red-600">Delete UID</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete UID <span className="font-mono font-bold text-slate-700">{deleteUID}</span>? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteUID(null)} className="rounded-xl">Cancel</Button>
                        <Button
                            onClick={handleDeleteUID}
                            disabled={deleteLoading}
                            className="rounded-xl bg-red-500 hover:bg-red-600 text-white"
                        >
                            {deleteLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {/* UID Details / Spec Sheet Dialog */}
            <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
                <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <div className="flex items-center gap-2 mb-1">
                            <Badge className="bg-orange-50 text-orange-600 border-orange-100 font-bold text-[10px] rounded-full px-2 py-0">Spec Sheet</Badge>
                            {selectedUID?.uid.length && selectedUID.uid.length > 16 && (
                                <Badge className="bg-amber-50 text-amber-500 border-amber-100 font-bold text-[10px] rounded-full px-2 py-0">Old Format</Badge>
                            )}
                        </div>
                        <DialogTitle className="text-xl font-bold flex items-center gap-2">
                            <Hash className="h-5 w-5 text-slate-400" />
                            <span className="font-mono tracking-wider">{selectedUID?.uid}</span>
                        </DialogTitle>
                        <DialogDescription>
                            Detailed record and linked warranty information
                        </DialogDescription>
                    </DialogHeader>

                    {detailsLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                            <p className="text-sm text-slate-500 font-medium">Fetching details...</p>
                        </div>
                    ) : selectedUID ? (
                        <div className="space-y-6 py-2">
                             {/* UID & Source Section */}
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Source</p>
                                    <div className="flex items-center gap-1.5">
                                        {selectedUID.source === 'api_sync' ? <Globe className="h-3 w-3 text-indigo-500" /> : <Plus className="h-3 w-3 text-amber-500" />}
                                        <p className="text-sm font-bold text-slate-700 capitalize">
                                            {selectedUID.source?.replace('_', ' ') || 'Unknown'}
                                        </p>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Created</p>
                                    <p className="text-sm font-bold text-slate-700">{formatDate(selectedUID.created_at)}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Product Name</p>
                                    <p className="text-sm font-bold text-slate-700 truncate" title={selectedUID.product_name || 'Not specified'}>
                                        {selectedUID.product_name || '—'}
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Status</p>
                                    <Badge className={`${selectedUID.is_used ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'} font-bold text-[10px] rounded-full`}>
                                        {selectedUID.is_used ? 'Registered' : 'Available'}
                                    </Badge>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Used At</p>
                                    <p className="text-sm font-bold text-slate-700">{formatDate(selectedUID.used_at)}</p>
                                </div>
                            </div>

                            {selectedUID.is_used ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Customer & Vehicle */}
                                    <div className="space-y-4">
                                        <div className="space-y-3">
                                            <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                                                <div className="h-1 w-4 bg-orange-500 rounded-full" /> Customer Details
                                            </h4>
                                            <div className="space-y-2 pl-6 border-l-2 border-slate-100">
                                                <div>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Name</p>
                                                    <p className="text-sm font-semibold text-slate-700">{selectedUID.customer_name}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Phone</p>
                                                    <p className="text-sm font-semibold text-slate-700">{selectedUID.customer_phone}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Email</p>
                                                    <p className="text-sm font-semibold text-slate-700 lowercase">{selectedUID.customer_email}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-3 pt-2">
                                            <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                                                <div className="h-1 w-4 bg-blue-500 rounded-full" /> Vehicle Details
                                            </h4>
                                            <div className="space-y-2 pl-6 border-l-2 border-slate-100">
                                                <div className="grid grid-cols-2 gap-4">
                                                    {vehicleNumberOf(selectedUID.registration_number) && (
                                                        <div>
                                                            <p className="text-[10px] text-slate-400 font-bold uppercase">Reg. Number</p>
                                                            <p className="text-sm font-black text-slate-700 uppercase tracking-wider">{vehicleNumberOf(selectedUID.registration_number)}</p>
                                                        </div>
                                                    )}
                                                    <div>
                                                        <p className="text-[10px] text-slate-400 font-bold uppercase">Year</p>
                                                        <p className="text-sm font-semibold text-slate-700">{selectedUID.car_year || 'â€”'}</p>
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Colour</p>
                                                    <p className="text-sm font-semibold text-slate-700">{selectedUID.car_colour || '—'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Make / Model</p>
                                                    <p className="text-sm font-semibold text-slate-700">{selectedUID.car_make} {selectedUID.car_model}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Product & Installer */}
                                    <div className="space-y-4">
                                        <div className="space-y-3">
                                            <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                                                <div className="h-1 w-4 bg-emerald-500 rounded-full" /> Warranty & Product
                                            </h4>
                                            <div className="space-y-2 pl-6 border-l-2 border-slate-100">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Badge className={`
                                                        font-black text-[9px] rounded-full px-2 py-0.5 border
                                                        ${selectedUID.warranty_status === 'validated' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                                            selectedUID.warranty_status === 'rejected' ? 'bg-red-50 text-red-600 border-red-100' :
                                                                'bg-amber-50 text-amber-600 border-amber-100'}
                                                    `}>
                                                        {selectedUID.warranty_status?.toUpperCase()}
                                                    </Badge>
                                                    <Badge className="bg-slate-100 text-slate-600 border-slate-200 font-bold text-[9px] rounded-full px-2 py-0.5">
                                                        {selectedUID.warranty_type}
                                                    </Badge>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Product Type</p>
                                                    <p className="text-sm font-semibold text-slate-700 capitalize">{selectedUID.product_type?.replace('-', ' ')}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Purchase Date</p>
                                                    <p className="text-sm font-semibold text-slate-700">{formatDate(selectedUID.purchase_date)}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-3 pt-2">
                                            <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                                                <div className="h-1 w-4 bg-indigo-500 rounded-full" /> Installer Info
                                            </h4>
                                            <div className="space-y-2 pl-6 border-l-2 border-slate-100">
                                                <div>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Name</p>
                                                    <p className="text-sm font-semibold text-slate-700">{selectedUID.installer_name || 'â€”'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Contact</p>
                                                    <p className="text-sm font-semibold text-slate-700">{selectedUID.installer_contact || 'â€”'}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400">
                                    <Package className="h-12 w-12 mb-3 opacity-20" />
                                    <p className="text-sm font-bold uppercase tracking-widest text-slate-400">Not Linked To Warranty</p>
                                    <p className="text-[10px] mt-1">This UID is available for the next registration</p>
                                </div>
                            )}

                            {selectedUID.rejection_reason && (
                                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
                                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5" />
                                    <div>
                                        <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-1">Rejection Reason</p>
                                        <p className="text-xs text-red-600 font-medium leading-relaxed">{selectedUID.rejection_reason}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : null}

                    <div className="flex justify-end pt-2 border-t border-slate-50">
                        <Button onClick={() => setDetailsOpen(false)} className="rounded-xl h-10 px-8 bg-slate-900 hover:bg-slate-800 text-white font-bold">
                            Close
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default AdminUIDManagement;

