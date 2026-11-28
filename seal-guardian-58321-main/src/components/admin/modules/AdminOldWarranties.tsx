import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Download, ExternalLink, ChevronLeft, ChevronRight, Calendar, Store, Users, FileText, RefreshCw } from "lucide-react";
import { formatToIST } from "@/lib/utils";
import api from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { OldWarrantyPlacement, OldWarrantyTabs, type OwTab } from "./AdminOldWarrantyPlacement";

interface OldWarranty {
    id: number;
    uid: string;
    customer_name: string;
    customer_email: string;
    customer_mobile: string;
    product_name: string;
    warranty_type: string;
    store_email: string;
    purchase_date: string;
    store_name: string;
    file_proof_url: string;
    /** The portal store this warranty is placed on, if any. */
    franchise_name?: string | null;
}

interface Stats {
    total_records: number;
    unique_stores: number;
    unique_customers: number;
    earliest_date: string;
    latest_date: string;
}

interface Pagination {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    limit: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

export function AdminOldWarranties() {
    /* By franchise / Store not found / To confirm, then the full table as All warranties. */
    const [owTab, setOwTab] = useState<OwTab>("stores");
    const [owReload, setOwReload] = useState(0);
    const { toast } = useToast();
    const [warranties, setWarranties] = useState<OldWarranty[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(false);
    const [pagination, setPagination] = useState<Pagination>({
        currentPage: 1,
        totalPages: 1,
        totalCount: 0,
        limit: 50,
        hasNextPage: false,
        hasPrevPage: false
    });

    // Filters
    const [search, setSearch] = useState("");
    const [warrantyType, setWarrantyType] = useState("");
    const [storeName, setStoreName] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [sortBy, setSortBy] = useState("purchase_date");
    const [sortOrder, setSortOrder] = useState("DESC");

    // Filter options
    const [warrantyTypes, setWarrantyTypes] = useState<string[]>([]);
    const [storeNames, setStoreNames] = useState<string[]>([]);

    // Debounced search
    const [debouncedSearch, setDebouncedSearch] = useState("");

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Fetch data when filters change
    const fetchWarranties = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: "50",
                sort_by: sortBy,
                sort_order: sortOrder
            });

            if (debouncedSearch) params.append("search", debouncedSearch);
            if (warrantyType) params.append("warranty_type", warrantyType);
            if (storeName) params.append("store_name", storeName);
            if (dateFrom) params.append("date_from", dateFrom);
            if (dateTo) params.append("date_to", dateTo);

            const response = await api.get(`/admin/old-warranties/seatcovers?${params}`);
            setWarranties(response.data.warranties);
            setPagination(response.data.pagination);
        } catch (error: any) {
            console.error("Failed to fetch old warranties:", error);
            toast({
                title: "Error",
                description: "Failed to load old warranties",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch, warrantyType, storeName, dateFrom, dateTo, sortBy, sortOrder, toast]);

    // Fetch stats
    const fetchStats = async () => {
        try {
            const response = await api.get("/admin/old-warranties/seatcovers/stats");
            setStats(response.data.stats);
        } catch (error) {
            console.error("Failed to fetch stats:", error);
        }
    };

    // Fetch filter options
    const fetchFilterOptions = async () => {
        try {
            const [typesRes, storesRes] = await Promise.all([
                api.get("/admin/old-warranties/seatcovers/warranty-types"),
                api.get("/admin/old-warranties/seatcovers/store-names")
            ]);
            setWarrantyTypes(typesRes.data.warrantyTypes || []);
            setStoreNames(storesRes.data.storeNames || []);
        } catch (error) {
            console.error("Failed to fetch filter options:", error);
        }
    };

    // Initial load
    useEffect(() => {
        fetchStats();
        fetchFilterOptions();
    }, []);

    // Fetch when filters change
    useEffect(() => {
        fetchWarranties(1);
    }, [fetchWarranties]);

    // Export to CSV
    const handleExport = async () => {
        try {
            const params = new URLSearchParams();
            if (debouncedSearch) params.append("search", debouncedSearch);
            if (warrantyType) params.append("warranty_type", warrantyType);
            if (storeName) params.append("store_name", storeName);
            if (dateFrom) params.append("date_from", dateFrom);
            if (dateTo) params.append("date_to", dateTo);

            const response = await api.get(`/admin/old-warranties/seatcovers/export?${params}`);
            const data = response.data.data;

            if (!data || data.length === 0) {
                toast({ title: "No data to export", variant: "destructive" });
                return;
            }

            // Convert to CSV
            const headers = Object.keys(data[0]).join(",");
            const rows = data.map((row: any) =>
                Object.values(row).map((v: any) =>
                    typeof v === "string" ? `"${v.replace(/"/g, '""')}"` : v
                ).join(",")
            );
            const csv = [headers, ...rows].join("\n");

            // Download
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `old_warranties_seatcovers_${new Date().toISOString().split("T")[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);

            toast({ title: "Export complete", description: `Downloaded ${data.length} records` });
        } catch (error) {
            toast({ title: "Export failed", variant: "destructive" });
        }
    };

    // Clear filters
    const clearFilters = () => {
        setSearch("");
        setWarrantyType("");
        setStoreName("");
        setDateFrom("");
        setDateTo("");
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold">Old Warranties - Seat Covers</h2>
                    <p className="text-muted-foreground">Seat cover warranties from the old portal, and the store each one is placed on</p>
                </div>
                <Button onClick={handleExport} variant="outline" className="gap-2">
                    <Download className="h-4 w-4" />
                    Export CSV
                </Button>
            </div>

            <OldWarrantyTabs tab={owTab} onTab={setOwTab} reload={owReload} />
            {owTab !== "all" ? <OldWarrantyPlacement tab={owTab} onChanged={() => setOwReload(n => n + 1)} /> : <>

            {/* Stats Cards */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <FileText className="h-4 w-4 text-blue-500" />
                                Total Records
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-2xl font-bold">{stats.total_records.toLocaleString()}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <Store className="h-4 w-4 text-green-500" />
                                Unique Stores
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-2xl font-bold">{stats.unique_stores.toLocaleString()}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <Users className="h-4 w-4 text-purple-500" />
                                Unique Customers
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-2xl font-bold">{stats.unique_customers.toLocaleString()}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-amber-500" />
                                Date Range
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm">
                                {stats.earliest_date ? formatToIST(stats.earliest_date) : "N/A"} - {stats.latest_date ? formatToIST(stats.latest_date) : "N/A"}
                            </p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Search and Filters */}
            <Card>
                <CardContent className="pt-6">
                    <div className="space-y-4">
                        {/* Search Bar */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by UID, Customer Name, Email, Mobile, Store Name..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-10"
                            />
                        </div>

                        {/* Filters Row */}
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            <Select value={warrantyType || "__all__"} onValueChange={(v) => setWarrantyType(v === "__all__" ? "" : v)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Warranty Type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">All Types</SelectItem>
                                    {warrantyTypes.map((type) => (
                                        <SelectItem key={type} value={type}>{type}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={storeName || "__all__"} onValueChange={(v) => setStoreName(v === "__all__" ? "" : v)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Store Name" />
                                </SelectTrigger>
                                <SelectContent className="max-h-60">
                                    <SelectItem value="__all__">All Stores</SelectItem>
                                    {storeNames.map((store) => (
                                        <SelectItem key={store} value={store}>{store}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Input
                                type="date"
                                placeholder="From Date"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                            />

                            <Input
                                type="date"
                                placeholder="To Date"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                            />

                            <Button variant="ghost" onClick={clearFilters} className="gap-2">
                                <RefreshCw className="h-4 w-4" />
                                Clear
                            </Button>
                        </div>

                        {/* Active filters display */}
                        {(warrantyType || storeName || dateFrom || dateTo || debouncedSearch) && (
                            <div className="flex flex-wrap gap-2">
                                {debouncedSearch && (
                                    <Badge variant="secondary">Search: {debouncedSearch}</Badge>
                                )}
                                {warrantyType && (
                                    <Badge variant="secondary">Type: {warrantyType}</Badge>
                                )}
                                {storeName && (
                                    <Badge variant="secondary">Store: {storeName}</Badge>
                                )}
                                {dateFrom && (
                                    <Badge variant="secondary">From: {dateFrom}</Badge>
                                )}
                                {dateTo && (
                                    <Badge variant="secondary">To: {dateTo}</Badge>
                                )}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Results Table */}
            <Card>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[120px]">UID</TableHead>
                                    <TableHead>Customer Name</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Mobile</TableHead>
                                    <TableHead>Product</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Store (old portal)</TableHead>
                                    <TableHead>Franchise</TableHead>
                                    <TableHead>Purchase Date</TableHead>
                                    <TableHead className="w-[80px]">Proof</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8">
                                            <div className="flex items-center justify-center gap-2">
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                                Loading...
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ) : warranties.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                                            No records found
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    warranties.map((w) => (
                                        <TableRow key={w.id}>
                                            <TableCell className="font-mono text-xs">{w.uid}</TableCell>
                                            <TableCell className="font-medium">{w.customer_name || "-"}</TableCell>
                                            <TableCell className="text-sm">{w.customer_email || "-"}</TableCell>
                                            <TableCell className="text-sm">{w.customer_mobile || "-"}</TableCell>
                                            <TableCell className="text-sm max-w-[200px] truncate">{w.product_name || "-"}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{w.warranty_type || "-"}</Badge>
                                            </TableCell>
                                            <TableCell className="text-sm max-w-[150px] truncate">{w.store_name || "-"}</TableCell>
                                            <TableCell className="text-sm max-w-[150px] truncate">{w.franchise_name || <span className="text-muted-foreground">Not placed</span>}</TableCell>
                                            <TableCell className="text-sm">{w.purchase_date ? formatToIST(w.purchase_date) : "-"}</TableCell>
                                            <TableCell>
                                                {w.file_proof_url ? (
                                                    <a href={w.file_proof_url} target="_blank" rel="noopener noreferrer"
                                                        className="text-primary hover:underline inline-flex items-center gap-1">
                                                        <ExternalLink className="h-3 w-3" />
                                                        View
                                                    </a>
                                                ) : "-"}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    {pagination.totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t">
                            <p className="text-sm text-muted-foreground">
                                Showing {((pagination.currentPage - 1) * pagination.limit) + 1} - {Math.min(pagination.currentPage * pagination.limit, pagination.totalCount)} of {pagination.totalCount.toLocaleString()}
                            </p>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fetchWarranties(pagination.currentPage - 1)}
                                    disabled={!pagination.hasPrevPage || loading}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                    Previous
                                </Button>
                                <span className="text-sm">
                                    Page {pagination.currentPage} of {pagination.totalPages}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fetchWarranties(pagination.currentPage + 1)}
                                    disabled={!pagination.hasNextPage || loading}
                                >
                                    Next
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
            </>}
        </div>
    );
}
