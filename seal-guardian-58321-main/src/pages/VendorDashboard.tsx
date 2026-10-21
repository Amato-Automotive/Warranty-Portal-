import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Package, Plus, Search, Filter, CheckCircle, Clock, XCircle, Users, User, Trash2, Edit2, X, Check, ArrowLeft, Edit, FileText, Eye, Download, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { downloadCSV, getWarrantyExpiration, cn, formatToIST, getISTTodayISO } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import EVProductsForm from "@/components/warranty/EVProductsForm";
import SeatCoverForm from "@/components/warranty/SeatCoverForm";
import { getWarrantyFormComponent, getEditFormProps } from "@/lib/warrantyFormRegistry";
import { WarrantySpecSheet } from "@/components/warranty/WarrantySpecSheet";
import { ProductCatalog } from "@/components/vendor/ProductCatalog";
import VendorGrievances from "@/components/fms/VendorGrievances";
import { displaySerial } from "@/lib/ppfRolls";
import { vehicleNumberOf, warrantyVehicleNumber } from "@/lib/vehicleNumber";

// WarrantyList Component - Modern card design matching Customer Dashboard
const WarrantyList = ({ items, showReason = false, user, onEditWarranty, onVerify, onReject, isPendingVerification = false, onSelectWarranty }: {
    items: any[],
    showReason?: boolean,
    user: any,
    onVerify?: (warranty: any) => void,
    onReject?: (warranty: any) => void,
    onEditWarranty?: (warranty: any) => void,
    isPendingVerification?: boolean,
    onSelectWarranty?: (warranty: any) => void
}) => {
    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center border rounded-xl border-dashed bg-muted/10">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                    <Package className="h-8 w-8 text-muted-foreground/50" />
                </div>
                <h3 className="text-lg font-medium">No Warranties Found</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
                    {isPendingVerification ? 'No warranties pending your verification' : 'Warranties will appear here'}
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {items.map((warranty, index) => {
                const productDetails = typeof warranty.product_details === 'string'
                    ? JSON.parse(warranty.product_details)
                    : warranty.product_details || {};
                const productNameMapping: Record<string, string> = {
                    'paint-protection': 'Paint Protection Films',
                    'sun-protection': 'Sun Protection Films',
                };
                const rawProductName = productDetails.product || productDetails.productName || warranty.product_type;
                const productName = productNameMapping[rawProductName] || rawProductName;

                // Calculate warranty expiration
                const { daysLeft, isExpired } = getWarrantyExpiration(warranty.created_at, warranty.warranty_type, warranty.purchase_date);

                const toTitleCase = (str: string) => {
                    if (!str) return str;
                    return str.replace(/[_-]/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
                };

                return (
                    <div key={warranty.id || warranty.uid || `warranty-${index}`} className="group flex flex-col">
                        <div
                            onClick={() => onSelectWarranty && onSelectWarranty(warranty)}
                            className={cn(
                                "relative flex items-center gap-4 p-4 bg-card hover:bg-accent/5 transition-all rounded-xl border border-border/50 shadow-sm cursor-pointer active:scale-[0.99] z-10",
                                (showReason || isPendingVerification) && "rounded-b-none border-b-0"
                            )}
                        >
                            {/* Icon */}
                            <div className={cn(
                                "h-12 w-12 rounded-full flex items-center justify-center shrink-0 border",
                                warranty.product_type === 'seat-cover' ? "bg-blue-500/10 border-blue-500/20 text-blue-600" : "bg-purple-500/10 border-purple-500/20 text-purple-600"
                            )}>
                                <img
                                    src={warranty.product_type === 'seat-cover' ? "/seat-cover-icon.png" : "/ppf-icon.png"}
                                    alt="Icon"
                                    className="w-6 h-6 object-contain opacity-80 group-hover:opacity-100 transition-opacity"
                                />
                            </div>

                            {/* Main Info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <h4 className="font-semibold text-base truncate pr-2">
                                        {warrantyVehicleNumber(warranty) || warranty.customer_name || 'Warranty'}
                                    </h4>
                                </div>
                                <p className="text-xs text-slate-500 mt-1 mb-2 flex items-center flex-wrap gap-y-1">
                                    <span className={cn(
                                        "font-bold",
                                        warranty.product_type === 'seat-cover' ? "text-blue-600" : "text-purple-600"
                                    )}>{productName.replace(/-/g, ' ')}</span>
                                    {warranty.product_type !== 'seat-cover' && (warranty.car_make || warranty.car_model) && (
                                        <>
                                            <span className="mx-2 opacity-30">•</span>
                                            <span>{toTitleCase(warranty.car_make || '')} {toTitleCase(warranty.car_model || '')}</span>
                                        </>
                                    )}
                                    <span className="mx-2 opacity-30">•</span>
                                    <span className="text-xs opacity-70">{formatToIST(warranty.created_at)}</span>
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    👤 {warranty.customer_name} • {warranty.customer_phone}
                                    {warranty.product_type !== 'seat-cover' && (
                                        <span className="ml-2">• <span className="font-mono ml-1">Serial: {displaySerial(productDetails, warranty.uid)}</span></span>
                                    )}
                                </p>
                            </div>

                            {/* Status Indicator (Right aligned) */}
                            <div className="shrink-0 flex flex-col items-end gap-1">
                                {/* Show days remaining for approved warranties */}
                                {warranty.status === 'validated' && (
                                    <span className={cn(
                                        "text-xs font-semibold",
                                        isExpired ? "text-red-600" : "text-green-600"
                                    )}>
                                        {isExpired ? "Expired" : `${daysLeft} days`}
                                    </span>
                                )}
                                <div className="flex items-center gap-1.5">
                                    <div className={cn(
                                        "w-2.5 h-2.5 rounded-full shadow-sm",
                                        warranty.status === 'validated' ? "bg-green-500 shadow-green-500/50" :
                                            warranty.status === 'pending' ? "bg-amber-500 shadow-amber-500/50" :
                                                warranty.status === 'pending_vendor' ? "bg-blue-500 shadow-blue-500/50" :
                                                    "bg-red-500 shadow-red-500/50"
                                    )} />
                                    <span className="text-[10px] font-medium text-muted-foreground capitalize">
                                        {warranty.status === 'pending_vendor' ? 'Needs Review' : warranty.status === 'pending' ? 'Admin Review' : warranty.status === 'validated' ? 'Approved' : warranty.status}
                                    </span>
                                </div>
                            </div>

                            {/* Pending Verification Actions */}
                            {(isPendingVerification || (warranty.status === 'pending_vendor' && onVerify && onReject)) && (
                                <div className="relative mx-1 p-3 bg-blue-500/5 rounded-b-xl border border-t-0 border-blue-500/10 animate-in slide-in-from-top-1 z-0">
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            className="flex-1 h-9 bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-200"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onVerify && onVerify(warranty);
                                            }}
                                        >
                                            <CheckCircle className="w-4 h-4 mr-2" /> Approve Request
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="flex-1 h-9 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onReject && onReject(warranty);
                                            }}
                                        >
                                            <XCircle className="w-4 h-4 mr-2" /> Reject
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Rejection Reason + Edit & Resubmit */}
                            {showReason && warranty.rejection_reason && (
                                <div className="relative mx-1 p-3 bg-red-500/5 rounded-b-xl border border-t-0 border-red-500/10 text-sm animate-in slide-in-from-top-1 z-0">
                                    <p className="text-red-600 font-medium flex items-start gap-2">
                                        <span className="shrink-0 pt-0.5">•</span>
                                        {warranty.rejection_reason}
                                    </p>
                                    {onEditWarranty && (
                                        <Button
                                            size="sm"
                                            className="mt-2 w-full h-9 bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onEditWarranty(warranty);
                                            }}
                                        >
                                            <Edit2 className="w-4 h-4 mr-2" /> Edit & Resubmit
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

const VendorDashboard = () => {
    const { user, loading } = useAuth();
    const { toast } = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = searchParams.get("tab") || "all";
    const [warranties, setWarranties] = useState<any[]>([]);
    const [loadingWarranties, setLoadingWarranties] = useState(false);
    const [warrantyPagination, setWarrantyPagination] = useState({ currentPage: 1, totalPages: 1, totalCount: 0, limit: 30, hasNextPage: false, hasPrevPage: false });

    // Manpower state
    const [manpowerList, setManpowerList] = useState<any[]>([]); // Active manpower
    const [pastManpowerList, setPastManpowerList] = useState<any[]>([]); // Inactive manpower
    const [loadingManpower, setLoadingManpower] = useState(false);
    const [newManpowerName, setNewManpowerName] = useState("");
    const [newManpowerPhone, setNewManpowerPhone] = useState("");
    const [newManpowerType, setNewManpowerType] = useState("seat_cover");
    const [newManpowerId, setNewManpowerId] = useState("");
    const [addingManpower, setAddingManpower] = useState(false);
    const [manpowerTab, setManpowerTab] = useState("current"); // 'current' or 'past'

    // Edit state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [editPhone, setEditPhone] = useState("");
    const [editType, setEditType] = useState("");
    const [updatingManpower, setUpdatingManpower] = useState(false);

    // Verify/Reject Handlers
    const handleVerifyWarranty = async (warranty: any) => {
        try {
            const response = await api.post(`/vendor/warranty/${warranty.uid}/approve`);
            if (response.data.success) {
                toast({
                    title: "Warranty Approved",
                    description: "Installation status updated to Pending Admin Approval.",
                });
                fetchWarranties(); // Refresh list
            }
        } catch (error: any) {
            console.error("Verification failed", error);
            toast({
                title: "Action Failed",
                description: getErrorMessage(error, "Could not approve warranty"),
                variant: "destructive",
            });
        }
    };

    const handleRejectWarranty = async (warranty: any) => {
        // Prompt for reason? For now simple prompt or we can add a Dialog.
        // Let's use a simple prompt for speed, or better, a reason dialog state.
        const reason = prompt("Please enter the reason for rejection:");
        if (!reason) return;

        try {
            const response = await api.post(`/vendor/warranty/${warranty.uid}/reject`, { reason });
            if (response.data.success) {
                toast({
                    title: "Warranty Sent Back",
                    description: "Status updated to Action Required.",
                    variant: "destructive"
                });
                fetchWarranties();
            }
        } catch (error: any) {
            console.error("Rejection failed", error);
            toast({
                title: "Action Failed",
                description: getErrorMessage(error, "Could not reject warranty"),
                variant: "destructive",
            });
        }
    };

    // Manpower Warranty Details Dialog
    const [manpowerWarrantyDialogOpen, setManpowerWarrantyDialogOpen] = useState(false);
    const [manpowerWarrantyDialogData, setManpowerWarrantyDialogData] = useState<{ member: any; status: 'validated' | 'pending' | 'rejected'; warranties: any[] }>({ member: null, status: 'validated', warranties: [] });

    // Helper to show manpower warranties dialog
    const showManpowerWarranties = (member: any, status: 'validated' | 'pending' | 'rejected') => {
        // Filter warranties for this manpower by status
        const manpowerWarranties = warranties.filter((w: any) =>
            w.manpower_id === member.id && (
                status === 'pending'
                    ? (w.status === 'pending' || w.status === 'pending_vendor')
                    : w.status === status
            )
        );
        setManpowerWarrantyDialogData({ member, status, warranties: manpowerWarranties });
        setManpowerWarrantyDialogOpen(true);
    };

    // Spec Sheet State for viewing warranty details
    const [specSheetData, setSpecSheetData] = useState<any | null>(null);

    // Edit Warranty State (for rejected warranties)
    const [editingWarranty, setEditingWarranty] = useState<any | null>(null);

    // Warranty stats
    const pendingVendorWarranties = warranties.filter(w => w.status === 'pending_vendor');
    const pendingWarranties = warranties.filter(w => w.status === 'pending');
    const approvedWarranties = warranties.filter(w => w.status === 'validated');
    const rejectedWarranties = warranties.filter(w => w.status === 'rejected');

    // Search & Sort State - Warranties
    const [warrantySearch, setWarrantySearch] = useState('');
    const [warrantySortField, setWarrantySortField] = useState<'created_at' | 'customer_name' | 'status' | 'product_type'>('created_at');
    const [warrantySortOrder, setWarrantySortOrder] = useState<'asc' | 'desc'>('desc');
    const [warrantyDateFrom, setWarrantyDateFrom] = useState('');
    const [warrantyDateTo, setWarrantyDateTo] = useState('');

    // Filter and Sort Helper
    const filterAndSortWarranties = (items: any[]) => {
        return items
            .filter((warranty: any) => {
                // Date range filter
                if (warrantyDateFrom || warrantyDateTo) {
                    const warrantyDate = new Date(warranty.created_at);
                    warrantyDate.setHours(0, 0, 0, 0);
                    if (warrantyDateFrom) {
                        const fromDate = new Date(warrantyDateFrom);
                        fromDate.setHours(0, 0, 0, 0);
                        if (warrantyDate < fromDate) return false;
                    }
                    if (warrantyDateTo) {
                        const toDate = new Date(warrantyDateTo);
                        toDate.setHours(23, 59, 59, 999);
                        if (warrantyDate > toDate) return false;
                    }
                }

                if (!warrantySearch) return true;
                const search = warrantySearch.toLowerCase();

                // Parse product details key info
                const productDetails = typeof warranty.product_details === 'string'
                    ? JSON.parse(warranty.product_details || '{ }')
                    : warranty.product_details || {};
                const rawProductName = productDetails.product || productDetails.productName || warranty.product_type || '';

                // Handle specific search term mappings
                if (search === 'ppf') {
                    if (
                        rawProductName.toLowerCase().includes('paint-protection') ||
                        rawProductName.toLowerCase().includes('paint protection film') ||
                        rawProductName.toLowerCase().includes('ppf')
                    ) {
                        return true;
                    }
                }

                return (
                    warranty.customer_name?.toLowerCase().includes(search) ||
                    warranty.customer_phone?.includes(search) ||
                    warranty.uid?.toLowerCase().includes(search) ||
                    warranty.registration_number?.toLowerCase().includes(search) ||
                    warranty.car_make?.toLowerCase().includes(search) ||
                    warranty.car_model?.toLowerCase().includes(search) ||
                    warranty.product_type?.toLowerCase().includes(search) ||
                    rawProductName.toLowerCase().includes(search) ||
                    warranty.manpower_name?.toLowerCase().includes(search)
                );
            })
            .sort((a: any, b: any) => {
                let aVal = a[warrantySortField];
                let bVal = b[warrantySortField];
                if (warrantySortField === 'created_at') {
                    aVal = new Date(aVal).getTime();
                    bVal = new Date(bVal).getTime();
                } else {
                    aVal = (aVal || '').toString().toLowerCase();
                    bVal = (bVal || '').toString().toLowerCase();
                }
                return warrantySortOrder === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
            });
    };

    const handleExport = () => {
        const filteredData = filterAndSortWarranties(warranties);
        const exportData = filteredData.map(w => {
            const productDetails = typeof w.product_details === 'string'
                ? JSON.parse(w.product_details)
                : w.product_details || {};
            const rawProductName = productDetails.product || productDetails.productName || w.product_type;
            const productNameMapping: Record<string, string> = {
                'paint-protection': 'Paint Protection Films',
                'sun-protection': 'Sun Protection Films',
            };
            const productName = (productNameMapping[rawProductName] || rawProductName)?.toUpperCase() || w.product_type;

            return {
                Date: formatToIST(w.created_at),
                'Product': productName,
                'Product Type': w.product_type,
                'Customer': w.customer_name,
                'Phone': w.customer_phone,
                'UID/Lot': w.uid || productDetails.lotNumber || 'N/A',
                /*
                 * This column read productDetails.rollNumber, a field nothing
                 * has ever written, so every row printed N/A. PPF now records
                 * the rolls it drew on, which is what it was asking for.
                 */
                'Roll No': Array.isArray(productDetails.rolls) && productDetails.rolls.length > 0
                    ? productDetails.rolls
                        .map((r: any) => `${r.serial} (${r.sqft} sq.ft${r.installArea ? ` - ${r.installArea}` : ''})`)
                        .join('; ')
                    : (productDetails.serialNumber || 'N/A'),
                'Vehicle': (w.car_make && String(w.car_make).toLowerCase() !== 'null' || w.car_model && String(w.car_model).toLowerCase() !== 'null') ? `${w.car_make || ''} ${w.car_model || ''} (${w.car_year || ''})`.trim() : 'N/A',
                'Vehicle Colour': w.car_colour || '',
                'Registration': vehicleNumberOf(w.registration_number, productDetails.carRegistration, w.car_reg) || '',
                'Status': w.status.toUpperCase(),
                'Installer Name': productDetails.storeName || w.installer_name || 'N/A',
                'Manpower': w.manpower_name || productDetails.manpowerName || 'N/A',
                'Purchase Date': formatToIST(w.purchase_date)
            };
        });
        downloadCSV(exportData, `my_warranties_export_${getISTTodayISO()}.csv`);
        toast({
            title: "Export Successful",
            description: `${exportData.length} warranties exported to CSV.`,
        });
    };

    // Fetch warranties
    async function fetchWarranties(page = 1, background = false) {
        if (!background) setLoadingWarranties(true);
        try {
            const response = await api.get(`/warranty?page=${page}&limit=30`);
            if (response.data.success) {
                setWarranties(response.data.warranties);
                if (response.data.pagination) {
                    setWarrantyPagination(response.data.pagination);
                }
            }
        } catch (error) {
            console.error("Failed to fetch warranties", error);
            toast({
                title: "Failed to fetch warranties",
                variant: "destructive",
            });
        } finally {
            if (!background) setLoadingWarranties(false);
        }
    }

    // Fetch manpower
    async function fetchManpower(active: string = 'true') {
        setLoadingManpower(true);
        try {
            // approved=all so the store also sees staff awaiting admin approval
            // (badged in the UI); the installer picker fetches approved-only.
            const response = await api.get(`/vendor/manpower?active=${active}&approved=all`);
            if (response.data.success) {
                if (active === 'true') {
                    setManpowerList(response.data.manpower);
                } else if (active === 'false') {
                    setPastManpowerList(response.data.manpower);
                }
            }
        } catch (error) {
            console.error("Failed to fetch manpower", error);
        } finally {
            setLoadingManpower(false);
        }
    }

    // Handle tab switching for manpower
    useEffect(() => {
        if (manpowerTab === 'past' && pastManpowerList.length === 0) {
            fetchManpower('false');
        }
    }, [manpowerTab]);

    // Initial data fetch
    useEffect(() => {
        if (user?.role === "vendor") {
            fetchManpower('true');  // Fetch active manpower
            fetchWarranties();
        }
    }, [user]);

    // Auto-generate Manpower ID when name or phone changes
    useEffect(() => {
        const namePart = newManpowerName.slice(0, 3).toUpperCase();
        const phonePart = newManpowerPhone.slice(-4);
        setNewManpowerId((namePart && phonePart) ? `${namePart}${phonePart}` : "");
    }, [newManpowerName, newManpowerPhone]);

    // Manpower handlers
    const handleAddManpower = async (e: React.FormEvent) => {
        e.preventDefault();
        setAddingManpower(true);
        try {
            const response = await api.post("/vendor/manpower", {
                name: newManpowerName,
                phoneNumber: newManpowerPhone,
                applicatorType: newManpowerType
            });

            if (response.data.success) {
                toast({
                    title: "Manpower Added",
                    description: "New team member added successfully.",
                });
                setManpowerList([...manpowerList, response.data.manpower]);
                setNewManpowerName("");
                setNewManpowerPhone("");
                setNewManpowerType("seat_cover");
                setNewManpowerId("");
            }
        } catch (error: any) {
            toast({
                title: "Addition Failed",
                description: getErrorMessage(error, "Could not add manpower"),
                variant: "destructive",
            });
        } finally {
            setAddingManpower(false);
        }
    };

    const handleDeleteManpower = async (id: string) => {
        try {
            const response = await api.delete(`/vendor/manpower/${id}`);
            if (response.data.success) {
                toast({
                    title: "Manpower Removed",
                    description: "Team member removed successfully.",
                });
                setManpowerList(manpowerList.filter(m => m.id !== id));
            }
        } catch (error: any) {
            toast({
                title: "Removal Failed",
                description: getErrorMessage(error, "Could not remove manpower"),
                variant: "destructive",
            });
        }
    };

    const handleEditManpower = (member: any) => {
        setEditingId(member.id);
        setEditName(member.name);
        setEditPhone(member.phone_number);
        setEditType(member.applicator_type);
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditName("");
        setEditPhone("");
        setEditType("");
    };

    const handleUpdateManpower = async (id: string) => {
        setUpdatingManpower(true);
        try {
            const response = await api.put(`/vendor/manpower/${id}`, {
                name: editName,
                phoneNumber: editPhone,
                applicatorType: editType
            });

            if (response.data.success) {
                toast({
                    title: "Manpower Updated",
                    description: "Team member updated successfully.",
                });
                setManpowerList(manpowerList.map(m =>
                    m.id === id ? response.data.manpower : m
                ));
                handleCancelEdit();
            }
        } catch (error: any) {
            toast({
                title: "Update Failed",
                description: getErrorMessage(error, "Could not update manpower"),
                variant: "destructive",
            });
        } finally {
            setUpdatingManpower(false);
        }
    };

    // Loading and auth checks
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-12 w-12 text-primary animate-spin" />
                    <p className="text-muted-foreground font-medium animate-pulse">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" />;
    }

    if (user.role !== "vendor") {
        return <Navigate to="/" />;
    }

    // Show deactivation message if vendor is deactivated
    if (user.isActive === false) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
                <Header />
                <main className="container mx-auto px-4 py-16">
                    <div className="max-w-lg mx-auto text-center">
                        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-8 shadow-lg">
                            <div className="w-20 h-20 mx-auto mb-6 bg-red-100 rounded-full flex items-center justify-center">
                                <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                </svg>
                            </div>
                            <h1 className="text-2xl font-bold text-red-700 mb-4">Store Deactivated</h1>
                            <p className="text-gray-600 mb-6 leading-relaxed">
                                Your franchise account has been deactivated. You currently do not have access to the dashboard or any features.
                            </p>
                            <div className="bg-white rounded-lg p-4 border border-red-100">
                                <p className="text-sm text-gray-700 font-medium mb-2">For further information, please contact:</p>
                                <p className="text-lg font-semibold text-gray-800">Noida Office</p>
                                <p className="text-sm text-gray-500 mt-1">Our team will assist you with reactivation process</p>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        );
    }



    // Main dashboard view
    return (
        <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
            <Header />
            <main className="container mx-auto px-4 py-8">
                <div className="mb-8">
                    <h1 className="text-4xl font-bold mb-2">Dashboard</h1>
                    <p className="text-muted-foreground">
                        Manage customer warranty registrations for your store
                    </p>
                </div>

                {/* Stats Cards */}
                <div className="mb-6">
                    <h2 className="text-lg font-semibold mb-3 text-muted-foreground">Statistics</h2>
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Total Warranties</CardTitle>
                                <Package className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{warranties.length}</div>
                                <p className="text-xs text-muted-foreground">All registered products</p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Approved</CardTitle>
                                <CheckCircle className="h-4 w-4 text-green-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{approvedWarranties.length}</div>
                                <p className="text-xs text-muted-foreground">Verified warranties</p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Pending</CardTitle>
                                <Clock className="h-4 w-4 text-yellow-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{pendingWarranties.length}</div>
                                <p className="text-xs text-muted-foreground">Awaiting verification</p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Action Required</CardTitle>
                                <XCircle className="h-4 w-4 text-red-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{rejectedWarranties.length}</div>
                                <p className="text-xs text-muted-foreground">Action required</p>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* Action Bar & Filters */}
                <div className="flex flex-col gap-4 mb-6">
                    {/* Pill-shaped Search Bar */}
                    <div className="relative shadow-sm rounded-full">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search by customer, phone, car, UID..."
                            className="w-full pl-11 pr-4 py-3 rounded-full border-0 bg-background/80 backdrop-blur-md ring-1 ring-border/50 focus:ring-2 focus:ring-primary/20 text-sm shadow-lg shadow-black/5 transition-all"
                            value={warrantySearch}
                            onChange={(e) => setWarrantySearch(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                        {/* Date Range & Export */}
                        <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground whitespace-nowrap">From:</span>
                                <input
                                    type="date"
                                    className="px-3 py-2 rounded-md border border-input bg-background text-sm w-full md:w-auto"
                                    value={warrantyDateFrom}
                                    onChange={(e) => setWarrantyDateFrom(e.target.value)}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground whitespace-nowrap">To:</span>
                                <input
                                    type="date"
                                    className="px-3 py-2 rounded-md border border-input bg-background text-sm w-full md:w-auto"
                                    value={warrantyDateTo}
                                    onChange={(e) => setWarrantyDateTo(e.target.value)}
                                />
                            </div>
                            {(warrantyDateFrom || warrantyDateTo) && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => { setWarrantyDateFrom(''); setWarrantyDateTo(''); }}
                                >
                                    Clear Dates
                                </Button>
                            )}
                            <Button
                                size="sm"
                                onClick={handleExport}
                                className="bg-green-600 border-green-600 text-white hover:bg-green-700 hover:text-white transition-colors"
                            >
                                <Download className="h-4 w-4 mr-2" />
                                Export CSV
                            </Button>
                        </div>

                        {/* Sort & Filter */}
                        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
                            <select
                                className="px-3 py-2 rounded-md border border-input bg-background text-sm flex-1 md:flex-none"
                                value={warrantySortField}
                                onChange={(e) => setWarrantySortField(e.target.value as any)}
                            >
                                <option value="created_at">Sort by Date</option>
                                <option value="customer_name">Sort by Customer</option>
                                <option value="status">Sort by Status</option>
                            </select>
                            <select
                                className="px-3 py-2 rounded-md border border-input bg-background text-sm flex-1 md:flex-none"
                                value={warrantySearch.includes('seat-cover') ? 'seat-cover' : warrantySearch.includes('ppf') ? 'ppf' : 'all'}
                                onChange={(e) => {
                                    if (e.target.value === 'all') {
                                        setWarrantySearch('');
                                    } else {
                                        setWarrantySearch(e.target.value);
                                    }
                                }}
                            >
                                <option value="all">All Products</option>
                                <option value="seat-cover">Seat Cover</option>
                                <option value="ppf">PPF</option>
                            </select>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setWarrantySortOrder(warrantySortOrder === 'asc' ? 'desc' : 'asc')}
                            >
                                {warrantySortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Warranty Entries with Tabs */}
                <Tabs value={activeTab} onValueChange={(val) => setSearchParams({ tab: val })} className="space-y-6">
                    <TabsList className="w-full bg-muted/20 p-1.5 rounded-lg h-auto flex flex-wrap gap-1.5 md:grid md:grid-cols-6">
                        <TabsTrigger value="all" className="flex-1 min-w-[80px] rounded-md py-2 px-2 text-xs font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all">
                            All ({warranties.length})
                        </TabsTrigger>
                        <TabsTrigger value="approved" className="flex-1 min-w-[80px] rounded-md py-2 px-2 text-xs font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm text-green-700 data-[state=active]:text-green-800 data-[state=active]:border-2 data-[state=active]:border-green-500/20 transition-all">
                            Approved ({approvedWarranties.length})
                        </TabsTrigger>
                        <TabsTrigger value="disapproved" className="flex-1 min-w-[80px] rounded-md py-2 px-2 text-xs font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm text-red-700 data-[state=active]:text-red-800 data-[state=active]:border-2 data-[state=active]:border-red-500/20 transition-all">
                            Action Required ({rejectedWarranties.length})
                        </TabsTrigger>
                        <TabsTrigger value="pending_verification" className="flex-1 min-w-[90px] rounded-md py-2 px-2 text-xs font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm text-blue-700 data-[state=active]:text-blue-800 data-[state=active]:border-2 data-[state=active]:border-blue-500/20 transition-all">
                            <span className="hidden sm:inline">Pending for </span>Verification ({pendingVendorWarranties.length})
                        </TabsTrigger>
                        <TabsTrigger value="pending" className="flex-1 min-w-[90px] rounded-md py-2 px-2 text-xs font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm text-amber-700 data-[state=active]:text-amber-800 data-[state=active]:border-2 data-[state=active]:border-amber-500/20 transition-all">
                            <span className="hidden sm:inline">Pending from </span>Admin ({pendingWarranties.length})
                        </TabsTrigger>
                        <TabsTrigger value="manpower" className="flex-1 min-w-[80px] rounded-md py-2 px-2 text-xs font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm text-purple-700 data-[state=active]:text-purple-800 data-[state=active]:border-2 data-[state=active]:border-purple-500/20 transition-all">
                            Manpower ({manpowerList.length})
                        </TabsTrigger>
                        <TabsTrigger value="catalog" className="flex-1 min-w-[80px] rounded-md py-2 px-2 text-xs font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm text-blue-700 data-[state=active]:text-blue-800 data-[state=active]:border-2 data-[state=active]:border-blue-500/20 transition-all">
                            Catalogue
                        </TabsTrigger>
                        <TabsTrigger value="grievance" className="flex-1 min-w-[80px] rounded-md py-2 px-2 text-xs font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm text-orange-700 data-[state=active]:text-orange-800 data-[state=active]:border-2 data-[state=active]:border-orange-500/20 transition-all">
                            Complaints
                        </TabsTrigger>

                    </TabsList>


                    <TabsContent value="grievance" className="outline-none animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <VendorGrievances />
                    </TabsContent>

                    <TabsContent value="pending_verification" className="outline-none animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <WarrantyList
                            items={filterAndSortWarranties(pendingVendorWarranties)}
                            user={user}
                            onVerify={handleVerifyWarranty}
                            onReject={handleRejectWarranty}
                            isPendingVerification={true}
                            onSelectWarranty={setSpecSheetData}
                        />
                    </TabsContent>

                    <TabsContent value="all" className="outline-none animate-in fade-in slide-in-from-bottom-2 duration-500">
                        {loadingWarranties ? (
                            <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                        ) : (
                            <WarrantyList
                                items={filterAndSortWarranties(warranties)}
                                user={user}
                                onVerify={handleVerifyWarranty}
                                onReject={handleRejectWarranty}
                                onSelectWarranty={setSpecSheetData}
                            />
                        )}
                    </TabsContent>

                    <TabsContent value="approved" className="outline-none animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <WarrantyList
                            items={filterAndSortWarranties(approvedWarranties)}
                            user={user}
                            onSelectWarranty={setSpecSheetData}
                        />
                    </TabsContent>

                    <TabsContent value="disapproved" className="outline-none animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <WarrantyList
                            items={filterAndSortWarranties(rejectedWarranties)}
                            showReason={true}
                            user={user}
                            onEditWarranty={setEditingWarranty}
                            onSelectWarranty={setSpecSheetData}
                        />
                    </TabsContent>

                    <TabsContent value="pending" className="outline-none animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <WarrantyList
                            items={filterAndSortWarranties(pendingWarranties)}
                            user={user}
                            onSelectWarranty={setSpecSheetData}
                        />
                    </TabsContent>

                    <TabsContent value="manpower" className="space-y-4">
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle>Manpower Management</CardTitle>
                                        <CardDescription>Manage your team members and applicators</CardDescription>
                                    </div>
                                    <div className="h-10 w-10 rounded-full bg-secondary/20 flex items-center justify-center">
                                        <Users className="h-5 w-5 text-secondary-foreground" />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {/* Tabs for Current vs Past Team */}
                                <Tabs value={manpowerTab} onValueChange={setManpowerTab} className="space-y-6">
                                    <TabsList className="grid w-full grid-cols-2">
                                        <TabsTrigger value="current">
                                            Current Team ({manpowerList.length})
                                        </TabsTrigger>
                                        <TabsTrigger value="past">
                                            Past/Ex Team ({pastManpowerList.length})
                                        </TabsTrigger>
                                    </TabsList>

                                    {/* CURRENT TEAM TAB */}
                                    <TabsContent value="current" className="space-y-6">
                                        {/* Add New Manpower Form */}
                                        <form onSubmit={handleAddManpower} className="p-4 border rounded-lg bg-muted/30 space-y-4">
                                            <h3 className="font-medium text-sm">Add New Team Member</h3>
                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                                <Input
                                                    placeholder="Name"
                                                    value={newManpowerName}
                                                    onChange={(e) => setNewManpowerName(e.target.value)}
                                                    required
                                                />
                                                <Input
                                                    placeholder="Phone Number"
                                                    value={newManpowerPhone}
                                                    onChange={(e) => setNewManpowerPhone(e.target.value)}
                                                    required
                                                />
                                                <Input
                                                    placeholder="Manpower ID"
                                                    value={newManpowerId}
                                                    readOnly
                                                    className="bg-muted font-mono text-sm"
                                                />
                                                <div className="flex gap-2">
                                                    <select
                                                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                                        value={newManpowerType}
                                                        onChange={(e) => setNewManpowerType(e.target.value)}
                                                    >
                                                        <option value="seat_cover">Seat cover applicator</option>
                                                        <option value="ppf_spf">PPF Applicator</option>
                                                    </select>
                                                    <Button type="submit" size="icon" disabled={addingManpower}>
                                                        {addingManpower ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Plus className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                        </form>

                                        {/* Current Team List */}
                                        <div className="space-y-4">
                                            {loadingManpower ? (
                                                <div className="text-center py-4 text-muted-foreground">Loading...</div>
                                            ) : manpowerList.length === 0 ? (
                                                <div className="text-center py-8 border rounded-lg border-dashed text-muted-foreground">
                                                    No team members added yet.
                                                </div>
                                            ) : (
                                                <div className="grid gap-4">
                                                    {manpowerList.map((member) => (
                                                        <div key={member.id} className="p-4 border rounded-xl bg-card hover:shadow-md transition-all">
                                                            {editingId === member.id ? (
                                                                // Edit Mode
                                                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                                                                    <Input
                                                                        placeholder="Name"
                                                                        value={editName}
                                                                        onChange={(e) => setEditName(e.target.value)}
                                                                    />
                                                                    <Input
                                                                        placeholder="Phone"
                                                                        value={editPhone}
                                                                        onChange={(e) => setEditPhone(e.target.value)}
                                                                    />
                                                                    <select
                                                                        className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                                        value={editType}
                                                                        onChange={(e) => setEditType(e.target.value)}
                                                                    >
                                                                        <option value="seat_cover">Seat cover applicator</option>
                                                                        <option value="ppf_spf">PPF Applicator</option>
                                                                    </select>
                                                                    <div className="flex gap-2">
                                                                        <Button
                                                                            size="sm"
                                                                            onClick={() => handleUpdateManpower(member.id)}
                                                                            disabled={updatingManpower}
                                                                            className="flex-1"
                                                                        >
                                                                            {updatingManpower ? (
                                                                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                                                            ) : (
                                                                                <Check className="h-4 w-4 mr-1" />
                                                                            )}
                                                                            Save
                                                                        </Button>
                                                                        <Button
                                                                            size="sm"
                                                                            variant="outline"
                                                                            onClick={handleCancelEdit}
                                                                        >
                                                                            <X className="h-4 w-4" />
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                // View Mode - Clean Card Design
                                                                <div className="space-y-3">
                                                                    {/* Header: Name + Actions */}
                                                                    <div className="flex items-start justify-between">
                                                                        <div className="flex items-center gap-3">
                                                                            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0">
                                                                                <User className="h-5 w-5 text-primary" />
                                                                            </div>
                                                                            <div>
                                                                                <h4 className="font-semibold text-base">{member.name}</h4>
                                                                                <p className="text-sm text-muted-foreground">{member.phone_number}</p>
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex gap-1">
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-8 w-8"
                                                                                onClick={() => handleEditManpower(member)}
                                                                            >
                                                                                <Edit2 className="h-4 w-4" />
                                                                            </Button>
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                                                onClick={() => handleDeleteManpower(member.id)}
                                                                            >
                                                                                <Trash2 className="h-4 w-4" />
                                                                            </Button>
                                                                        </div>
                                                                    </div>

                                                                    {/* Meta Row: ID + Type */}
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{member.manpower_id}</span>
                                                                        <Badge variant="secondary" className="text-xs">
                                                                            {member.applicator_type === 'seat_cover' ? 'Seat cover applicator' : 'PPF Applicator'}
                                                                        </Badge>
                                                                    </div>

                                                                    {/* Stats Grid */}
                                                                    <div className="grid grid-cols-4 gap-2 pt-2 border-t">
                                                                        <button
                                                                            onClick={() => showManpowerWarranties(member, 'validated')}
                                                                            className="flex flex-col items-center p-2 rounded-lg bg-green-50 hover:bg-green-100 transition-colors"
                                                                        >
                                                                            <span className="text-lg font-bold text-green-700">{member.validated_count || 0}</span>
                                                                            <span className="text-[10px] text-green-600 font-medium">Approved</span>
                                                                        </button>
                                                                        <button
                                                                            onClick={() => showManpowerWarranties(member, 'pending')}
                                                                            className="flex flex-col items-center p-2 rounded-lg bg-amber-50 hover:bg-amber-100 transition-colors"
                                                                        >
                                                                            <span className="text-lg font-bold text-amber-700">{member.pending_count || 0}</span>
                                                                            <span className="text-[10px] text-amber-600 font-medium">Pending</span>
                                                                        </button>
                                                                        <button
                                                                            onClick={() => showManpowerWarranties(member, 'rejected')}
                                                                            className="flex flex-col items-center p-2 rounded-lg bg-red-50 hover:bg-red-100 transition-colors"
                                                                        >
                                                                            <span className="text-lg font-bold text-red-700">{member.rejected_count || 0}</span>
                                                                            <span className="text-[10px] text-red-600 font-medium">Action Req.</span>
                                                                        </button>
                                                                        <div className="flex flex-col items-center p-2 rounded-lg bg-muted/50">
                                                                            <span className="text-lg font-bold text-muted-foreground">{member.total_count || 0}</span>
                                                                            <span className="text-[10px] text-muted-foreground font-medium">Total</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </TabsContent>

                                    {/* PAST TEAM TAB */}
                                    <TabsContent value="past" className="space-y-4">
                                        <div className="p-4 bg-muted/30 rounded-lg border border-dashed">
                                            <p className="text-sm text-muted-foreground">
                                                This section shows archived team members. Their points are preserved for future rewards.
                                            </p>
                                        </div>
                                        {loadingManpower ? (
                                            <div className="text-center py-4 text-muted-foreground">Loading...</div>
                                        ) : pastManpowerList.length === 0 ? (
                                            <div className="text-center py-8 border rounded-lg border-dashed text-muted-foreground">
                                                No past team members.
                                            </div>
                                        ) : (
                                            <div className="grid gap-4">
                                                {pastManpowerList.map((member) => (
                                                    <div key={member.id} className="p-4 border rounded-xl bg-muted/40 transition-all opacity-90 hover:opacity-100">
                                                        <div className="space-y-3">
                                                            {/* Header: Name + Meta */}
                                                            <div className="flex items-start justify-between">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200">
                                                                        <User className="h-5 w-5 text-gray-500" />
                                                                    </div>
                                                                    <div>
                                                                        <h4 className="font-semibold text-base text-muted-foreground">{member.name}</h4>
                                                                        <p className="text-sm text-muted-foreground">{member.phone_number}</p>
                                                                    </div>
                                                                </div>
                                                                {member.removed_at && (
                                                                    <div className="text-right">
                                                                        <Badge variant="outline" className="text-xs bg-background/50">
                                                                            Removed: {formatToIST(member.removed_at)}
                                                                        </Badge>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Meta Row: ID + Type */}
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="font-mono text-xs bg-background px-2 py-1 rounded border">{member.manpower_id}</span>
                                                                <Badge variant="secondary" className="text-xs capitalize bg-background/50">
                                                                    {member.applicator_type?.replace('_', ' ')}
                                                                </Badge>
                                                                {member.removed_reason && (
                                                                    <span className="text-xs text-muted-foreground italic">
                                                                        Reason: {member.removed_reason}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* Stats Grid */}
                                                            <div className="grid grid-cols-4 gap-2 pt-2 border-t border-border/50">
                                                                <button
                                                                    onClick={() => showManpowerWarranties(member, 'validated')}
                                                                    className="flex flex-col items-center p-2 rounded-lg bg-green-50/50 hover:bg-green-50 transition-colors cursor-pointer"
                                                                >
                                                                    <span className="text-lg font-bold text-green-700/80">{member.validated_count || 0}</span>
                                                                    <span className="text-[10px] text-green-600/80 font-medium">Approved</span>
                                                                </button>
                                                                <button
                                                                    onClick={() => showManpowerWarranties(member, 'pending')}
                                                                    className="flex flex-col items-center p-2 rounded-lg bg-amber-50/50 hover:bg-amber-50 transition-colors cursor-pointer"
                                                                >
                                                                    <span className="text-lg font-bold text-amber-700/80">{member.pending_count || 0}</span>
                                                                    <span className="text-[10px] text-amber-600/80 font-medium">Pending</span>
                                                                </button>
                                                                <button
                                                                    onClick={() => showManpowerWarranties(member, 'rejected')}
                                                                    className="flex flex-col items-center p-2 rounded-lg bg-red-50/50 hover:bg-red-50 transition-colors cursor-pointer"
                                                                >
                                                                    <span className="text-lg font-bold text-red-700/80">{member.rejected_count || 0}</span>
                                                                    <span className="text-[10px] text-red-600/80 font-medium">Action Req.</span>
                                                                </button>
                                                                <div className="flex flex-col items-center p-2 rounded-lg bg-muted/30">
                                                                    <span className="text-lg font-bold text-muted-foreground">{member.total_count || 0}</span>
                                                                    <span className="text-[10px] text-muted-foreground font-medium">Total</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </TabsContent>
                                </Tabs>
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="catalog">
                        <ProductCatalog />
                    </TabsContent>
                </Tabs>

                {/* Manpower Warranty Details Dialog */}
                <Dialog open={manpowerWarrantyDialogOpen} onOpenChange={setManpowerWarrantyDialogOpen}>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>
                                {manpowerWarrantyDialogData.member?.name} - {manpowerWarrantyDialogData.status === 'validated' ? 'Approved' : manpowerWarrantyDialogData.status === 'rejected' ? 'Action Required' : 'Pending'} Warranties
                            </DialogTitle>
                            <DialogDescription>
                                {manpowerWarrantyDialogData.warranties.length} warranty registrations
                            </DialogDescription>
                        </DialogHeader>
                        <div className="mt-4 space-y-3">
                            {manpowerWarrantyDialogData.warranties.length === 0 ? (
                                <p className="text-center py-8 text-muted-foreground">No warranties found</p>
                            ) : (
                                manpowerWarrantyDialogData.warranties.map((w: any, index: number) => {
                                    const pd = typeof w.product_details === 'string' ? JSON.parse(w.product_details) : w.product_details || {};
                                    const productNameMapping: Record<string, string> = {
                                        'paint-protection': 'PPF',
                                        'sun-protection': 'Tint',
                                        'seat-cover': 'Seat Cover',
                                        'ev-products': 'EV Product'
                                    };
                                    return (
                                        <div key={w.id || index} className="p-3 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <p className="font-medium">{w.customer_name}</p>
                                                    <p className="text-xs text-muted-foreground">{w.customer_phone}</p>
                                                </div>
                                                <Badge variant={
                                                    w.status === 'validated' ? 'default' :
                                                        w.status === 'rejected' ? 'destructive' : 'secondary'
                                                } className={w.status === 'validated' ? 'bg-green-600' : ''}>
                                                    {productNameMapping[w.product_type] || w.product_type}
                                                </Badge>
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                                                <div>
                                                    <p className="text-xs text-muted-foreground">Vehicle</p>
                                                    <p>{w.car_make} {w.car_model}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground">Product</p>
                                                    <p>{pd.productName || pd.product || w.product_type}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground">
                                                        {w.product_type === 'seat-cover' ? 'UID' : 'Serial No'}
                                                    </p>
                                                    <p className="font-mono text-xs">
                                                        {w.product_type === 'seat-cover' ? w.uid : displaySerial(pd, w.uid)}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground">Registered</p>
                                                    <p>{formatToIST(w.created_at)}</p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Edit Warranty Dialog */}
                <Dialog open={!!editingWarranty} onOpenChange={(open) => !open && setEditingWarranty(null)}>
                    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Edit & Resubmit Warranty</DialogTitle>
                            <DialogDescription>Update the details for the warranty and resubmit for approval.</DialogDescription>
                        </DialogHeader>
                        {editingWarranty && (() => {
                            const FormComponent = getWarrantyFormComponent(editingWarranty.product_type);
                            const formProps = getEditFormProps(editingWarranty, () => {
                                setEditingWarranty(null);
                                fetchWarranties();
                            });
                            return <FormComponent {...formProps} />;
                        })()}
                    </DialogContent>
                </Dialog>

                {/* Warranty Spec Sheet for viewing details */}
                <WarrantySpecSheet
                    isOpen={!!specSheetData}
                    onClose={() => setSpecSheetData(null)}
                    warranty={specSheetData}
                />
            </main>
        </div>
    );
};

export default VendorDashboard;