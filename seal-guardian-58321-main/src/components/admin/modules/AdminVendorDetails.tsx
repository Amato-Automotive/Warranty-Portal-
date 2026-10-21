import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VendorEngagementTabs } from "./VendorEngagementTabs";
import { VendorSourcingTab } from "./VendorSourcingTab";
import { VendorAnnouncementsTab } from "./VendorAnnouncementsTab";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, User, Mail, Phone, Download, Search, Loader2, QrCode, UserCheck } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QRCodeSVG } from "qrcode.react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminWarrantyList } from "@/components/admin/AdminWarrantyList";
import { AdminFranchiseOrdersDialog } from "./AdminFranchiseOrdersDialog";
import { formatWarrantyForExport, formatManpowerForExport } from "@/lib/adminExports";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import { downloadCSV, formatToIST, cn, getWarrantyExpiration } from "@/lib/utils";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { StoreActivityPanel } from "./AdminPortalActivity";

interface AdminVendorDetailsProps {
    vendor: any;
    onBack: () => void;
    isDistributorsView?: boolean;
}

export const AdminVendorDetails = ({ vendor: initialVendor, onBack, isDistributorsView }: AdminVendorDetailsProps) => {
    const { toast } = useToast();
    const [vendor, setVendor] = useState(initialVendor);
    const [activeTab, setActiveTab] = useState<
        'warranties' | 'manpower' | 'franchises' | 'orders' | 'posm' | 'grievances' | 'audits' | 'sourcing' | 'announcements' | 'activity'
    >('warranties');
    const [isLoadingDetails, setIsLoadingDetails] = useState(true);
    const [franchises, setFranchises] = useState<any[]>([]);
    const [franchisesLoading, setFranchisesLoading] = useState(false);
    const [ordersDialogOpen, setOrdersDialogOpen] = useState(false);
    const [selectedFranchise, setSelectedFranchise] = useState<any | null>(null);
    const [franchiseOrders, setFranchiseOrders] = useState<any[]>([]);
    const [loadingFranchiseOrders, setLoadingFranchiseOrders] = useState(false);

    // Fetch full details on mount
    useEffect(() => {
        const fetchDetails = async () => {
            setIsLoadingDetails(true);
            try {
                // Ensure we use the correct ID - relying on vendor.id (user_id) from the list
                const response = await api.get(`/admin/vendors/${initialVendor.id}`);
                if (response.data.success) {
                    setVendor(prev => ({
                        ...prev,
                        ...response.data.vendor,
                        warranties: response.data.warranties || [],
                        manpower: response.data.manpower || []
                    }));
                }
            } catch (error) {
                console.error("Failed to fetch vendor details:", error);
                toast({
                    title: "Error",
                    description: "Failed to load complete vendor details",
                    variant: "destructive"
                });
            } finally {
                setIsLoadingDetails(false);
            }
        };

        if (initialVendor?.id) {
            fetchDetails();
        }
    }, [initialVendor.id]);

    useEffect(() => {
        const fetchFranchises = async () => {
            if (!isDistributorsView || !vendor?.distributor_id) return;

            setFranchisesLoading(true);
            try {
                const response = await api.get(`/admin/distributors/${vendor.distributor_id}/franchises`);
                if (response.data.success) {
                    setFranchises(response.data.franchises || []);
                }
            } catch (error) {
                console.error("Failed to fetch mapped franchises:", error);
                toast({
                    title: "Error",
                    description: "Failed to load mapped franchises",
                    variant: "destructive"
                });
            } finally {
                setFranchisesLoading(false);
            }
        };

        fetchFranchises();
    }, [vendor?.distributor_id, isDistributorsView, toast]);

    // Pagination State
    const [warrantyPage, setWarrantyPage] = useState(1);
    const [manpowerPage, setManpowerPage] = useState(1);
    const itemsPerPage = 20;

    // Derived states

    // Warranties State
    const [warrantyFilter, setWarrantyFilter] = useState<'all' | 'validated' | 'rejected' | 'pending'>('all');
    const [warrantySearch, setWarrantySearch] = useState('');
    const [warrantySortField] = useState<'created_at' | 'customer_name' | 'status' | 'product_type'>('created_at');
    const [warrantySortOrder, setWarrantySortOrder] = useState<'asc' | 'desc'>('desc');
    const [warrantyDateFrom, setWarrantyDateFrom] = useState('');
    const [warrantyDateTo, setWarrantyDateTo] = useState('');

    // Manpower State
    const [manpowerSearch, setManpowerSearch] = useState('');
    const [manpowerSortField] = useState<'name' | 'points' | 'total_applications'>('name');
    const [manpowerSortOrder] = useState<'asc' | 'desc'>('asc');

    // Franchise State
    const [franchiseSearch, setFranchiseSearch] = useState('');
    const [franchisePage, setFranchisePage] = useState(1);

    // Processing State
    const [processingWarranty, setProcessingWarranty] = useState<string | null>(null);
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    const [selectedWarrantyId, setSelectedWarrantyId] = useState<string | null>(null);

    // Manpower Dialog State
    const [manpowerWarrantyDialogOpen, setManpowerWarrantyDialogOpen] = useState(false);
    const [manpowerWarrantyDialogData, setManpowerWarrantyDialogData] = useState<{ member: any; status: 'validated' | 'pending' | 'rejected'; warranties: any[] }>({ member: null, status: 'validated', warranties: [] });

    // Brand update
    const [updatingBrand, setUpdatingBrand] = useState(false);
    const [pendingBrand, setPendingBrand] = useState<"AF" | "AC" | "AFAC" | null>(null);

    const handleUpdateBrand = async () => {
        if (!pendingBrand) return;
        setUpdatingBrand(true);
        try {
            await api.put(`/admin/vendors/${vendor.id}/allowed-brands`, {
                allowed_brands: pendingBrand,
                target: isDistributorsView ? 'distributor' : 'franchise'
            });
            setVendor((prev: any) => ({
                ...prev,
                [isDistributorsView ? 'distributor_allowed_brands' : 'franchise_allowed_brands']: pendingBrand
            }));
            toast({ title: "Brand Updated", description: `Brand set to ${pendingBrand}` });
        } catch (error: any) {
            toast({ title: "Update Failed", description: getErrorMessage(error, "Failed to update brand"), variant: "destructive" });
        } finally {
            setUpdatingBrand(false);
            setPendingBrand(null);
        }
    };

    // QR Code State
    const [storeCodeInput, setStoreCodeInput] = useState("");
    const [savingStoreCode, setSavingStoreCode] = useState(false);
    const QR_BASE_URL = 'https://warranty2.autoformindia.co.in';

    const handleSaveStoreCode = async () => {
        if (!storeCodeInput.trim()) {
            toast({ title: "Error", description: "Please enter a store code", variant: "destructive" });
            return;
        }
        setSavingStoreCode(true);
        try {
            const response = await api.put(`/admin/vendors/${vendor.user_id}/store-code`, {
                store_code: storeCodeInput.trim()
            });
            if (response.data.success) {
                toast({ title: "Store Code Saved", description: `QR code generated for ${response.data.store_code}` });
                setVendor((prev: any) => ({ ...prev, store_code: response.data.store_code }));
                setStoreCodeInput("");
            }
        } catch (error: any) {
            toast({
                title: "Error",
                description: getErrorMessage(error, "Failed to save store code"),
                variant: "destructive"
            });
        } finally {
            setSavingStoreCode(false);
        }
    };

    // ASM — the area sales manager this store reports to. Admin-only; the
    // store itself never sees it.
    const [asmOptions, setAsmOptions] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
    const [savingAsm, setSavingAsm] = useState(false);

    useEffect(() => {
        api.get('/admin/vendor-asm-options')
            .then(res => setAsmOptions(res.data.asms || []))
            .catch(() => setAsmOptions([]));
    }, []);

    const handleAsmChange = async (value: string) => {
        const asmId = value === 'none' ? null : value;
        if (asmId === (vendor.asm_id ?? null)) return;
        setSavingAsm(true);
        try {
            const response = await api.put(`/admin/vendors/${vendor.user_id}/asm`, { asm_id: asmId });
            setVendor((prev: any) => ({ ...prev, asm_id: response.data.asm_id, asm_name: response.data.asm_name }));
            toast({
                title: "ASM updated",
                description: response.data.asm_name ? `Now under ${response.data.asm_name}` : "No ASM assigned",
            });
        } catch (error: any) {
            toast({ title: "Error", description: getErrorMessage(error, "Failed to update ASM"), variant: "destructive" });
        } finally {
            setSavingAsm(false);
        }
    };

    // Location Coordinates State
    const [isEditingCoordinates, setIsEditingCoordinates] = useState(false);
    const [coordinatesInput, setCoordinatesInput] = useState({ latitude: '', longitude: '' });
    const [savingCoordinates, setSavingCoordinates] = useState(false);

    useEffect(() => {
        if (vendor) {
            setCoordinatesInput({
                latitude: vendor.latitude ? String(vendor.latitude) : '',
                longitude: vendor.longitude ? String(vendor.longitude) : ''
            });
        }
    }, [vendor?.latitude, vendor?.longitude]);

    useEffect(() => {
        setFranchisePage(1);
    }, [franchiseSearch]);

    const handleDownloadOrderPdf = async (orderId: string) => {
        try {
            const res = await api.get(`/orders/${orderId}/pdf`, { responseType: 'blob' });
            const blob = new Blob([res.data], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Order-${orderId}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            toast({
                title: 'Download Failed',
                description: 'Could not download order PDF',
                variant: 'destructive'
            });
        }
    };

    const handleOpenFranchiseOrders = async (franchise: any) => {
        setSelectedFranchise(franchise);
        setOrdersDialogOpen(true);
        setFranchiseOrders([]);
        setLoadingFranchiseOrders(true);
        try {
            const response = await api.get(`/admin/franchises/${franchise.user_id}/orders`);
            if (response.data.success) {
                setFranchiseOrders(response.data.orders || []);
            }
        } catch (error) {
            console.error("Failed to fetch franchise orders:", error);
            toast({
                title: "Error",
                description: "Failed to load franchise orders",
                variant: "destructive"
            });
        } finally {
            setLoadingFranchiseOrders(false);
        }
    };

    const handleSaveCoordinates = async () => {
        setSavingCoordinates(true);
        try {
            const response = await api.put(`/admin/vendors/${vendor.user_id}/coordinates`, {
                latitude: coordinatesInput.latitude || null,
                longitude: coordinatesInput.longitude || null
            });
            if (response.data.success) {
                toast({ title: "Success", description: "Coordinates updated successfully" });
                setVendor((prev: any) => ({ ...prev, latitude: coordinatesInput.latitude, longitude: coordinatesInput.longitude }));
                setIsEditingCoordinates(false);
            }
        } catch (error: any) {
            toast({
                title: "Error",
                description: getErrorMessage(error, "Failed to update coordinates"),
                variant: "destructive"
            });
        } finally {
            setSavingCoordinates(false);
        }
    };

    // Edit Profile State
    const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
    const [editProfileForm, setEditProfileForm] = useState({
        store_name: '',
        contact_name: '',
        email: '',
        phone_number: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
        gst_number: ''
    });
    const [savingProfile, setSavingProfile] = useState(false);

    const openEditProfile = () => {
        setEditProfileForm({
            store_name: vendor.store_name || '',
            contact_name: vendor.contact_name || '',
            email: vendor.email || '',
            phone_number: vendor.phone_number || '',
            address: vendor.address || '',
            city: vendor.city || '',
            state: vendor.state || '',
            pincode: vendor.pincode || '',
            gst_number: vendor.gst_number || ''
        });
        setIsEditProfileOpen(true);
    };

    const handleSaveProfile = async () => {
        if (!editProfileForm.store_name || !editProfileForm.contact_name || !editProfileForm.email || !editProfileForm.phone_number) {
            toast({ title: 'Error', description: 'All fields are required', variant: 'destructive' });
            return;
        }

        setSavingProfile(true);
        try {
            const response = await api.put(`/admin/vendors/${vendor.user_id}/profile`, editProfileForm);
            if (response.data.success) {
                toast({ title: 'Success', description: 'Profile updated successfully' });
                setVendor((prev: any) => ({ ...prev, ...editProfileForm }));
                setIsEditProfileOpen(false);
            }
        } catch (error: any) {
            toast({
                title: 'Error',
                description: getErrorMessage(error, 'Failed to update profile'),
                variant: 'destructive'
            });
        } finally {
            setSavingProfile(false);
        }
    };

    const handleDownloadQR = () => {
        const svg = document.getElementById('vendor-qr-code');
        if (!svg) return;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const svgData = new XMLSerializer().serializeToString(svg);
        const img = new Image();

        img.onload = () => {
            canvas.width = 400;
            canvas.height = 400;
            ctx?.drawImage(img, 0, 0, 400, 400);
            const link = document.createElement('a');
            link.download = `${vendor.store_code}_qr.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        };

        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    };


    const handleUpdateStatus = async (warrantyId: string, status: 'validated' | 'rejected' | 'pending', reason?: string) => {
        setProcessingWarranty(warrantyId);
        try {
            const response = await api.put(`/admin/warranties/${warrantyId}/status`, {
                status,
                rejectionReason: reason
            });

            if (response.data.success) {
                let toastTitle = `Warranty ${status === 'validated' ? 'Approved' : 'Declined'}`;
                let toastVariant: "default" | "destructive" = status === 'validated' ? "default" : "destructive";

                if (status === 'pending') {
                    toastTitle = "Moved to Pending";
                    toastVariant = "default";
                }

                toast({
                    title: toastTitle,
                    description: response.data.message,
                    variant: toastVariant
                });

                // Update local state
                const updateWarrantyInList = (list: any[]) =>
                    list.map((w: any) =>
                        (w.uid === warrantyId || w.id === warrantyId)
                            ? { ...w, status, rejection_reason: reason }
                            : w
                    );

                setVendor(prev => ({
                    ...prev,
                    warranties: updateWarrantyInList(prev.warranties || [])
                }));
            }
        } catch (error: any) {
            toast({
                title: "Update Failed",
                description: getErrorMessage(error, "Failed to update warranty status"),
                variant: "destructive"
            });
        } finally {
            setProcessingWarranty(null);
            setRejectDialogOpen(false);
            setRejectReason("");
            setSelectedWarrantyId(null);
        }
    };

    const handleExportWarranties = (filteredWarranties: any[]) => {
        const exportData = filteredWarranties.map((w: any) => formatWarrantyForExport(w));
        downloadCSV(exportData, `vendor_warranties_export_${new Date().toISOString().split('T')[0]}.csv`);
    };

    const handleExportManpower = (filteredManpower: any[]) => {
        const exportData = filteredManpower.map(formatManpowerForExport);
        downloadCSV(exportData, `vendor_manpower_export_${new Date().toISOString().split('T')[0]}.csv`);
    };

    // Stores add their own staff, but a member is only usable once an admin
    // approves them here. Approval can also be revoked (back to pending).
    const [approvingManpowerId, setApprovingManpowerId] = useState<string | null>(null);

    const handleManpowerApproval = async (member: any, approve: boolean) => {
        setApprovingManpowerId(member.id);
        try {
            const res = await api.put(`/admin/manpower/${member.id}/approval`, { is_approved: approve });
            if (res.data.success) {
                toast({
                    title: approve ? 'Staff Approved' : 'Moved to Pending',
                    description: res.data.message
                });
                // Reflect the change locally so the row updates without a refetch.
                setVendor((prev: any) => ({
                    ...prev,
                    manpower: (prev.manpower || []).map((m: any) =>
                        m.id === member.id ? { ...m, is_approved: approve ? 1 : 0 } : m
                    )
                }));
            }
        } catch (error: any) {
            toast({
                title: 'Update Failed',
                description: getErrorMessage(error, 'Could not update approval status'),
                variant: 'destructive'
            });
        } finally {
            setApprovingManpowerId(null);
        }
    };

    // Bring an Ex-Team member back onto the roster. They return as pending so
    // they're re-verified before becoming selectable again.
    /**
     * Approve or decline a store's request to remove a staff member.
     *
     * Previously this could only be done from the standalone Manpower module, so
     * an admin looking at the franchise itself saw no sign a request was waiting.
     * Same endpoint, so reviewing from either place does the same thing.
     */
    const handleRemovalReview = async (member: any, approve: boolean) => {
        let note = "";
        if (!approve) {
            const reason = window.prompt(`Why are you declining the removal of ${member.name}? (optional)`);
            if (reason === null) return;   // cancelled
            note = reason;
        } else if (!window.confirm(`Approve removal of ${member.name}? They will move to Ex-Team.`)) {
            return;
        }

        setApprovingManpowerId(member.id);
        try {
            const res = await api.put(`/admin/manpower/${member.id}/removal-review`, { approve, note });
            if (res.data.success) {
                toast({
                    title: approve ? 'Removal Approved' : 'Removal Declined',
                    description: res.data.message,
                });
                setVendor((prev: any) => ({
                    ...prev,
                    manpower: (prev.manpower || []).map((m: any) =>
                        m.id === member.id
                            ? { ...m, is_active: approve ? 0 : m.is_active, request_status: approve ? 'approved' : 'rejected' }
                            : m
                    )
                }));
            }
        } catch (error: any) {
            toast({
                title: 'Review Failed',
                description: getErrorMessage(error, 'Could not review the removal request'),
                variant: 'destructive',
            });
        } finally {
            setApprovingManpowerId(null);
        }
    };

    const handleRestoreManpower = async (member: any) => {
        setApprovingManpowerId(member.id);
        try {
            const res = await api.put(`/vendor/manpower/${member.id}/restore`);
            if (res.data.success) {
                toast({ title: 'Member Restored', description: res.data.message });
                setVendor((prev: any) => ({
                    ...prev,
                    manpower: (prev.manpower || []).map((m: any) =>
                        m.id === member.id
                            ? { ...m, is_active: 1, is_approved: 0, removed_at: null, removed_reason: null }
                            : m
                    )
                }));
            }
        } catch (error: any) {
            toast({
                title: 'Restore Failed',
                description: getErrorMessage(error, 'Could not restore member'),
                variant: 'destructive'
            });
        } finally {
            setApprovingManpowerId(null);
        }
    };

    const showManpowerWarranties = (member: any, status: 'validated' | 'pending' | 'rejected') => {
        // The store owner is a virtual row with id 'owner', standing for every
        // warranty filed without a named installer. Its count is built server
        // side from manpower_id being 'owner', null or empty, so matching only
        // the literal string here found nothing and the dialog came up empty
        // beside a badge saying two.
        const isOwner = member.id === 'owner';
        const manpowerWarranties = (vendor.warranties || []).filter((w: any) => {
            if (w.status !== status) return false;
            return isOwner
                ? (w.manpower_id === 'owner' || w.manpower_id === null || w.manpower_id === '')
                : w.manpower_id === member.id;
        });
        setManpowerWarrantyDialogData({ member, status, warranties: manpowerWarranties });
        setManpowerWarrantyDialogOpen(true);
    };

    const openRejectDialog = (warrantyId: string) => {
        setSelectedWarrantyId(warrantyId);
        setRejectDialogOpen(true);
    };

    // Reset pagination when filters change
    useEffect(() => {
        setWarrantyPage(1);
    }, [warrantyFilter, warrantySearch, warrantyDateFrom, warrantyDateTo, warrantySortField, warrantySortOrder]);

    useEffect(() => {
        setManpowerPage(1);
    }, [manpowerSearch, manpowerSortField, manpowerSortOrder]);

    const filteredWarranties = (vendor.warranties || [])
        .filter((w: any) => {
            if (warrantyFilter !== 'all' && w.status !== warrantyFilter) return false;
            if (warrantyDateFrom || warrantyDateTo) {
                const d = new Date(w.created_at);
                d.setHours(0, 0, 0, 0);
                if (warrantyDateFrom && d < new Date(warrantyDateFrom)) return false;
                const endDate = new Date(warrantyDateTo);
                endDate.setHours(23, 59, 59, 999);
                if (warrantyDateTo && d > endDate) return false;
            }
            if (warrantySearch) {
                const s = warrantySearch.toLowerCase();
                const pd = typeof w.product_details === 'string' ? JSON.parse(w.product_details || '{}') : w.product_details || {};
                const pName = pd.product || pd.productName || w.product_type || '';
                return (
                    w.customer_name?.toLowerCase().includes(s) ||
                    w.customer_phone?.includes(s) ||
                    w.uid?.toLowerCase().includes(s) ||
                    pName.toLowerCase().includes(s)
                );
            }
            return true;
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

    const paginatedWarranties = filteredWarranties.slice(
        (warrantyPage - 1) * itemsPerPage,
        warrantyPage * itemsPerPage
    );

    return (
        <div className="min-h-screen">
            <div className="mb-6">
                <Button variant="ghost" onClick={onBack} className="gap-2">
                    ← Back to {isDistributorsView ? "Distributors" : "Franchises"}
                </Button>
            </div>

            {/* Enhanced Vendor Header */}
            <Card className="mb-6 overflow-hidden border-orange-100 shadow-md">
                <div className="bg-gradient-to-br from-slate-600 to-slate-800 p-8 text-white">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                        <div>
                            <h1 className="text-3xl font-bold mb-2 tracking-tight">{vendor.store_name}</h1>
                            <div className="flex items-center gap-2 text-slate-300">
                                <MapPin className="h-4 w-4 text-orange-400" />
                                <span>{vendor.address}, {vendor.city}, {vendor.state}</span>
                            </div>
                            {(vendor.latitude || vendor.longitude) && (
                                <div className="flex items-center gap-2 mt-1 text-slate-400 text-sm">
                                    <span>Lat: {vendor.latitude || 'N/A'}, Lng: {vendor.longitude || 'N/A'}</span>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-col gap-3 items-end">
                            {/* A rejected store previously read as "Pending", which is
                                how a decision already taken looked like one still to
                                make. verified_at set with is_verified false means it
                                was reviewed and turned down. */}
                            <Badge
                                className={cn(
                                    "text-sm px-4 py-1.5 h-auto w-fit",
                                    vendor.is_verified
                                        ? "bg-emerald-500 hover:bg-emerald-600 border-0"
                                        : vendor.verified_at
                                            ? "bg-red-500 hover:bg-red-600 border-0"
                                            : "bg-amber-500 hover:bg-amber-600 text-black border-0"
                                )}
                            >
                                {vendor.is_verified
                                    ? (isDistributorsView ? 'Verified Distributor' : 'Verified Franchise')
                                    : vendor.verified_at
                                        ? (isDistributorsView ? 'Distributor Rejected' : 'Registration Rejected')
                                        : (isDistributorsView ? 'Pending Distributor Verification' : 'Pending Verification')
                                }
                            </Badge>

                            {/* The reason the admin gave when rejecting — without it,
                                nobody can tell why, or what the store must fix. */}
                            {!vendor.is_verified && vendor.rejection_reason && (
                                <div className="max-w-xs rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-right">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-red-500">
                                        Rejection reason
                                    </p>
                                    <p className="text-xs text-red-700 mt-0.5 leading-relaxed">
                                        {vendor.rejection_reason}
                                    </p>
                                </div>
                            )}

                            {/* Brand selector */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-300 font-semibold uppercase tracking-wider">Brand</span>
                                <div className="flex gap-1.5">
                                    {(['AF', 'AC', 'AFAC'] as const).map(b => {
                                        const currentBrand = isDistributorsView
                                            ? (vendor.distributor_allowed_brands || 'AF')
                                            : (vendor.franchise_allowed_brands || 'AF');
                                        const isActive = currentBrand === b;
                                        return (
                                            <button
                                                key={b}
                                                disabled={updatingBrand}
                                                onClick={() => setPendingBrand(b)}
                                                className={`text-xs font-bold px-3 py-1 rounded-full border transition-all ${
                                                    isActive
                                                        ? b === 'AF' ? 'bg-orange-500 text-white border-orange-500'
                                                          : b === 'AC' ? 'bg-blue-500 text-white border-blue-500'
                                                          : 'bg-purple-500 text-white border-purple-500'
                                                        : 'bg-white/10 text-slate-300 border-white/20 hover:bg-white/20'
                                                }`}
                                            >
                                                {b}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <Button variant="outline" size="sm" onClick={openEditProfile} className="text-slate-700 bg-white hover:bg-slate-100">
                                Edit Profile
                            </Button>
                        </div>
                    </div>
                </div>
                <CardContent className="p-6 bg-white">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                            <div className="h-12 w-12 rounded-full bg-orange-100 flex items-center justify-center">
                                <User className="h-6 w-6 text-orange-600" />
                            </div>
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Contact Person</p>
                                <p className="font-semibold text-slate-700">{vendor.contact_name || 'N/A'}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                                <Mail className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Email</p>
                                <p className="font-semibold text-slate-700 break-all">{vendor.email || vendor.contact_email || 'N/A'}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                            <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
                                <Phone className="h-6 w-6 text-emerald-600" />
                            </div>
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Phone</p>
                                <p className="font-semibold text-slate-700">{vendor.phone_number || vendor.phone || 'N/A'}</p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Edit Profile Dialog */}
            <Dialog open={isEditProfileOpen} onOpenChange={setIsEditProfileOpen}>
                <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit {isDistributorsView ? "Distributor" : "Franchise"} Profile</DialogTitle>
                        <DialogDescription>
                            Make changes to the {isDistributorsView ? "distributor's" : "franchise's"} details here.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="store_name">Store Name *</Label>
                                <Input
                                    id="store_name"
                                    value={editProfileForm.store_name}
                                    onChange={(e) => setEditProfileForm({ ...editProfileForm, store_name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="contact_name">Contact Name *</Label>
                                <Input
                                    id="contact_name"
                                    value={editProfileForm.contact_name}
                                    onChange={(e) => setEditProfileForm({ ...editProfileForm, contact_name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email *</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={editProfileForm.email}
                                    onChange={(e) => setEditProfileForm({ ...editProfileForm, email: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone_number">Phone Number *</Label>
                                <Input
                                    id="phone_number"
                                    value={editProfileForm.phone_number}
                                    onChange={(e) => setEditProfileForm({ ...editProfileForm, phone_number: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="address">Address</Label>
                            <Input
                                id="address"
                                placeholder="Plot No, Street, Area"
                                value={editProfileForm.address}
                                onChange={(e) => setEditProfileForm({ ...editProfileForm, address: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="city">City</Label>
                                <Input
                                    id="city"
                                    value={editProfileForm.city}
                                    onChange={(e) => setEditProfileForm({ ...editProfileForm, city: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="state">State</Label>
                                <Input
                                    id="state"
                                    value={editProfileForm.state}
                                    onChange={(e) => setEditProfileForm({ ...editProfileForm, state: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="pincode">Pincode</Label>
                                <Input
                                    id="pincode"
                                    value={editProfileForm.pincode}
                                    onChange={(e) => setEditProfileForm({ ...editProfileForm, pincode: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* GST applies to franchises and distributors alike; Area Head is
                            a distributor-only field, so they no longer share a block. */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="gst_number">GST Number</Label>
                                <Input
                                    id="gst_number"
                                    className="font-mono uppercase"
                                    maxLength={15}
                                    placeholder="e.g. 22AAAAA0000A1Z5"
                                    value={editProfileForm.gst_number}
                                    onChange={(e) => setEditProfileForm({ ...editProfileForm, gst_number: e.target.value.toUpperCase() })}
                                />
                                {editProfileForm.gst_number && editProfileForm.gst_number.length !== 15 && (
                                    <p className="text-xs text-amber-600">
                                        A GST number is 15 characters — this one has {editProfileForm.gst_number.length}.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end gap-3">
                        <Button variant="outline" onClick={() => setIsEditProfileOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveProfile} disabled={savingProfile}>
                            {savingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Save Changes
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Business / Registration Details */}
            <Card className="mb-6 border-orange-100 shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg">
                        {isDistributorsView ? "Distributor" : "Franchise"} Details
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="sm:col-span-2 lg:col-span-3 bg-slate-50 p-4 rounded-lg border border-slate-100 flex flex-col">
                            <span className="text-xs uppercase font-semibold tracking-wider text-slate-500 mb-1">Address</span>
                            <span className="font-medium text-slate-800">{vendor.address || 'Not set'}</span>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 flex flex-col">
                            <span className="text-xs uppercase font-semibold tracking-wider text-slate-500 mb-1">City</span>
                            <span className="font-medium text-slate-800">{vendor.city || 'Not set'}</span>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 flex flex-col">
                            <span className="text-xs uppercase font-semibold tracking-wider text-slate-500 mb-1">State</span>
                            <span className="font-medium text-slate-800">{vendor.state || 'Not set'}</span>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 flex flex-col">
                            <span className="text-xs uppercase font-semibold tracking-wider text-slate-500 mb-1">Pincode</span>
                            <span className="font-medium text-slate-800">{vendor.pincode || 'Not set'}</span>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 flex flex-col">
                            <span className="text-xs uppercase font-semibold tracking-wider text-slate-500 mb-1">GST Number</span>
                            <span className="font-medium text-slate-800 font-mono">{vendor.gst_number || 'Not set'}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ASM Section */}
            <Card className="mb-6 border-orange-100 shadow-sm">
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                        <UserCheck className="h-5 w-5 text-orange-500" />
                        <CardTitle className="text-lg">Area Sales Manager</CardTitle>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <Select value={vendor.asm_id ?? 'none'} onValueChange={handleAsmChange} disabled={savingAsm}>
                            <SelectTrigger className="sm:w-72">
                                <SelectValue placeholder="No ASM assigned" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">No ASM assigned</SelectItem>
                                {asmOptions
                                    // An inactive ASM is offered only to the store already under them.
                                    .filter(a => a.is_active || a.id === vendor.asm_id)
                                    .map(a => (
                                        <SelectItem key={a.id} value={a.id}>
                                            {a.name}{a.is_active ? '' : ' (inactive)'}
                                        </SelectItem>
                                    ))}
                                {/* Shown even if the options failed to load, so the
                                    current value never reads as unassigned. */}
                                {vendor.asm_id && !asmOptions.some(a => a.id === vendor.asm_id) && (
                                    <SelectItem value={vendor.asm_id}>{vendor.asm_name || 'Current ASM'}</SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                        {savingAsm && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                        <p className="text-sm text-slate-500">
                            The ASM sees this {isDistributorsView ? 'distributor' : 'store'} in their portal. The {isDistributorsView ? 'distributor' : 'franchise'} does not see this.
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Location Coordinates Section */}
            <Card className="mb-6 border-orange-100 shadow-sm">
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-orange-500" />
                        <CardTitle className="text-lg">Location Coordinates</CardTitle>
                    </div>
                    <Button 
                        variant={isEditingCoordinates ? "outline" : "default"} 
                        size="sm" 
                        onClick={() => setIsEditingCoordinates(!isEditingCoordinates)}
                    >
                        {isEditingCoordinates ? "Cancel" : "Edit Coordinates"}
                    </Button>
                </CardHeader>
                <CardContent>
                    {isEditingCoordinates ? (
                        <div className="flex flex-col sm:flex-row gap-4">
                            <div className="flex-1 space-y-2">
                                <Label htmlFor="latitude">Latitude</Label>
                                <Input 
                                    id="latitude"
                                    placeholder="e.g. 28.6139" 
                                    value={coordinatesInput.latitude}
                                    onChange={(e) => setCoordinatesInput(prev => ({ ...prev, latitude: e.target.value }))}
                                />
                            </div>
                            <div className="flex-1 space-y-2">
                                <Label htmlFor="longitude">Longitude</Label>
                                <Input 
                                    id="longitude"
                                    placeholder="e.g. 77.2090" 
                                    value={coordinatesInput.longitude}
                                    onChange={(e) => setCoordinatesInput(prev => ({ ...prev, longitude: e.target.value }))}
                                />
                            </div>
                            <div className="flex items-end">
                                <Button 
                                    onClick={handleSaveCoordinates} 
                                    disabled={savingCoordinates}
                                    className="w-full sm:w-auto"
                                >
                                    {savingCoordinates ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                    Save Coordinates
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 flex flex-col">
                                <span className="text-xs uppercase font-semibold tracking-wider text-slate-500 mb-1">Latitude</span>
                                <span className="font-medium text-slate-800 text-lg">{vendor.latitude || 'Not set'}</span>
                            </div>
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 flex flex-col">
                                <span className="text-xs uppercase font-semibold tracking-wider text-slate-500 mb-1">Longitude</span>
                                <span className="font-medium text-slate-800 text-lg">{vendor.longitude || 'Not set'}</span>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* QR Code Section */}
            <Card className="mb-6 border-orange-100 shadow-sm">
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                        <QrCode className="h-5 w-5 text-orange-500" />
                        <CardTitle className="text-lg">Store QR Code</CardTitle>
                    </div>
                </CardHeader>
                <CardContent>
                    {vendor.store_code ? (
                        <div className="flex flex-col md:flex-row items-center gap-6">
                            <div className="bg-white p-4 rounded-xl border-2 border-slate-100 shadow-sm">
                                <QRCodeSVG
                                    id="vendor-qr-code"
                                    value={`${QR_BASE_URL}/connect/${vendor.store_code}`}
                                    size={160}
                                    level="H"
                                    includeMargin={true}
                                />
                            </div>
                            <div className="flex-1 space-y-3 text-center md:text-left">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Store Code</p>
                                    <p className="font-mono text-xl font-bold text-slate-800">{vendor.store_code}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">QR URL</p>
                                    <a
                                        href={`${QR_BASE_URL}/connect/${vendor.store_code}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-blue-600 hover:underline break-all"
                                    >
                                        {QR_BASE_URL}/connect/{vendor.store_code}
                                    </a>
                                </div>
                                <Button
                                    onClick={handleDownloadQR}
                                    variant="outline"
                                    className="gap-2 mt-2"
                                >
                                    <Download className="h-4 w-4" />
                                    Download QR Code
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-6 space-y-4">
                            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-slate-100">
                                <QrCode className="h-8 w-8 text-slate-400" />
                            </div>
                            <div>
                                <p className="text-slate-600 font-medium">No QR code generated yet</p>
                                <p className="text-sm text-slate-400 mt-1">Enter a store code to generate a QR for warranty registration</p>
                            </div>
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto">
                                <Input
                                    placeholder="Enter store code (e.g., FGM168)"
                                    value={storeCodeInput}
                                    onChange={(e) => setStoreCodeInput(e.target.value.toUpperCase())}
                                    className="text-center font-mono uppercase"
                                    maxLength={20}
                                />
                                <Button
                                    onClick={handleSaveStoreCode}
                                    disabled={savingStoreCode || !storeCodeInput.trim()}
                                    className="gap-2 bg-orange-500 hover:bg-orange-600 whitespace-nowrap"
                                >
                                    {savingStoreCode ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                                    Generate QR
                                </Button>
                            </div>
                            <p className="text-xs text-slate-400">Format: 3-20 alphanumeric characters (letters + numbers)</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-6">
                {/* Eight tabs do not fit one readable row, so the franchise view
                    wraps onto two rather than squeezing the labels. */}
                <TabsList className={`grid w-full h-auto p-1 bg-slate-100 rounded-lg ${isDistributorsView ? 'grid-cols-4' : 'grid-cols-3 sm:grid-cols-5 lg:grid-cols-9'}`}>
                    <TabsTrigger value="warranties" className="py-2.5">Warranties ({vendor.warranties?.length || 0})</TabsTrigger>
                    <TabsTrigger value="manpower" className="py-2.5">Manpower ({vendor.manpower?.length || 0})</TabsTrigger>
                    {/* Time in the portal and what they did — franchises and distributors alike. */}
                    {vendor.vendor_details_id && <TabsTrigger value="activity" className="py-2.5">Activity</TabsTrigger>}
                    {isDistributorsView && (
                        <TabsTrigger value="franchises" className="py-2.5">Franchises ({franchises.length})</TabsTrigger>
                    )}
                    {/* A distributor raises none of these itself — they belong to
                        franchises — so these tabs are for the franchise view only. */}
                    {!isDistributorsView && (
                        <>
                            <TabsTrigger value="orders" className="py-2.5">Orders</TabsTrigger>
                            <TabsTrigger value="posm" className="py-2.5">POSM</TabsTrigger>
                            <TabsTrigger value="grievances" className="py-2.5">Complaints</TabsTrigger>
                            <TabsTrigger value="audits" className="py-2.5">Audits</TabsTrigger>
                            <TabsTrigger value="sourcing" className="py-2.5">Sourcing</TabsTrigger>
                            <TabsTrigger value="announcements" className="py-2.5">Announcements</TabsTrigger>
                        </>
                    )}
                </TabsList>

                {!isDistributorsView && (
                    <>
                        <TabsContent value="orders">
                            <Card className="border-orange-100 shadow-sm">
                                <CardContent className="pt-6">
                                    <VendorEngagementTabs
                                        kind="orders"
                                        vendorDetailsId={vendor.vendor_details_id || null}
                                        userId={vendor.user_id || vendor.id || null}
                                    />
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="posm">
                            <Card className="border-orange-100 shadow-sm">
                                <CardContent className="pt-6">
                                    <VendorEngagementTabs
                                        kind="posm"
                                        vendorDetailsId={vendor.vendor_details_id || null}
                                        userId={vendor.user_id || vendor.id || null}
                                    />
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="grievances">
                            <Card className="border-orange-100 shadow-sm">
                                <CardContent className="pt-6">
                                    <VendorEngagementTabs
                                        kind="grievances"
                                        vendorDetailsId={vendor.vendor_details_id || null}
                                        userId={vendor.user_id || vendor.id || null}
                                    />
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="audits">
                            <Card className="border-orange-100 shadow-sm">
                                <CardContent className="pt-6">
                                    <VendorEngagementTabs
                                        kind="audits"
                                        vendorDetailsId={vendor.vendor_details_id || null}
                                        userId={vendor.user_id || vendor.id || null}
                                    />
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="sourcing">
                            <Card className="border-orange-100 shadow-sm">
                                <CardContent className="pt-6">
                                    {/* franchise_distributors keys on the profile id,
                                        not vendor_details.id. */}
                                    <VendorSourcingTab
                                        franchiseUserId={vendor.user_id || vendor.id || null}
                                        storeName={vendor.store_name}
                                    />
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="announcements">
                            <Card className="border-orange-100 shadow-sm">
                                <CardContent className="pt-6">
                                    <VendorAnnouncementsTab
                                        franchiseUserId={vendor.user_id || vendor.id || null}
                                        storeName={vendor.store_name}
                                    />
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </>
                )}

                {vendor.vendor_details_id && (
                    <TabsContent value="activity">
                        <Card className="border-orange-100 shadow-sm">
                            <CardContent className="pt-6">
                                <StoreActivityPanel vendorId={String(vendor.vendor_details_id)} />
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                <TabsContent value="warranties">
                    <Card className="border-orange-100 shadow-sm">
                        <CardHeader>
                            <CardTitle>Warranty Registrations</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Tabs value={warrantyFilter} onValueChange={(value: any) => setWarrantyFilter(value)} className="mb-6">
                                <TabsList className="grid w-full grid-cols-4 lg:w-auto h-auto bg-white border">
                                    <TabsTrigger value="all" className="data-[state=active]:bg-slate-100">All</TabsTrigger>
                                    <TabsTrigger value="validated" className="data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-700">Approved</TabsTrigger>
                                    <TabsTrigger value="rejected" className="data-[state=active]:bg-red-50 data-[state=active]:text-red-700">Action Required</TabsTrigger>
                                    <TabsTrigger value="pending" className="data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700">Pending</TabsTrigger>
                                </TabsList>
                            </Tabs>

                            <div className="flex flex-col gap-4 mb-6">
                                <div className="flex flex-wrap items-center gap-4 justify-between">
                                    <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-medium text-slate-500">From:</span>
                                            <input
                                                type="date"
                                                className="px-2 py-1 rounded border text-sm"
                                                value={warrantyDateFrom}
                                                onChange={(e) => setWarrantyDateFrom(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-medium text-slate-500">To:</span>
                                            <input
                                                type="date"
                                                className="px-2 py-1 rounded border text-sm"
                                                value={warrantyDateTo}
                                                onChange={(e) => setWarrantyDateTo(e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    {/* Search & Sort */}
                                    <div className="flex flex-1 items-center gap-4 min-w-[300px]">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                                            <Input
                                                placeholder="Search customer, product, UID..."
                                                className="pl-10"
                                                value={warrantySearch}
                                                onChange={(e) => setWarrantySearch(e.target.value)}
                                            />
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => setWarrantySortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                                        >
                                            {warrantySortOrder === 'asc' ? "↑" : "↓"}
                                        </Button>
                                    </div>

                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            // Logic mirrors render filter
                                            const filtered = (vendor.warranties || []).filter((w: any) => {
                                                if (warrantyFilter !== 'all' && w.status !== warrantyFilter) return false;
                                                return true;
                                                // (Simplified for export handler call, actual filtering happens in render)
                                            });
                                            handleExportWarranties(filtered);
                                        }}
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Export
                                    </Button>
                                </div>
                            </div>

                            {(!vendor.warranties || vendor.warranties.length === 0) ? (
                                <div className="text-center py-12 bg-slate-50 rounded-lg border border-dashed text-slate-400">
                                    No warranties registered yet.
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    <AdminWarrantyList
                                        items={paginatedWarranties}
                                        processingWarranty={processingWarranty}
                                        onApprove={(id) => handleUpdateStatus(id, 'validated')}
                                        onReject={(id) => openRejectDialog(id)}
                                        onMoveToPending={(id) => handleUpdateStatus(id, 'pending')}
                                        showActions={true}
                                        showRejectionReason={true}
                                    />

                                    {filteredWarranties.length > itemsPerPage && (
                                        <Pagination className="mt-4">
                                            <PaginationContent>
                                                <PaginationItem>
                                                    <PaginationPrevious
                                                        onClick={() => setWarrantyPage(p => Math.max(1, p - 1))}
                                                        aria-disabled={warrantyPage === 1}
                                                        className={warrantyPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                                    />
                                                </PaginationItem>
                                                {(() => {
                                                    const totalPages = Math.ceil(filteredWarranties.length / itemsPerPage);
                                                    return Array.from({ length: totalPages }, (_, i) => i + 1)
                                                        .filter(page => page === 1 || page === totalPages || Math.abs(page - warrantyPage) <= 1)
                                                        .map((page, index, array) => {
                                                            if (index > 0 && array[index - 1] !== page - 1) {
                                                                return (
                                                                    <div key={`ellipsis-${page}`} className="flex items-center">
                                                                        <PaginationEllipsis />
                                                                        <PaginationItem>
                                                                            <PaginationLink isActive={warrantyPage === page} onClick={() => setWarrantyPage(page)} className="cursor-pointer">{page}</PaginationLink>
                                                                        </PaginationItem>
                                                                    </div>
                                                                );
                                                            }
                                                            return (<PaginationItem key={page}><PaginationLink isActive={warrantyPage === page} onClick={() => setWarrantyPage(page)} className="cursor-pointer">{page}</PaginationLink></PaginationItem>);
                                                        });
                                                })()}
                                                <PaginationItem>
                                                    <PaginationNext
                                                        onClick={() => setWarrantyPage(p => Math.min(Math.ceil(filteredWarranties.length / itemsPerPage), p + 1))}
                                                        aria-disabled={warrantyPage === Math.ceil(filteredWarranties.length / itemsPerPage)}
                                                        className={warrantyPage === Math.ceil(filteredWarranties.length / itemsPerPage) ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                                    />
                                                </PaginationItem>
                                            </PaginationContent>
                                        </Pagination>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="manpower">
                    <Card className="border-orange-100 shadow-sm">
                        <CardHeader>
                            <CardTitle>Manpower List</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap items-center gap-4 mb-6">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <Input
                                        placeholder="Search manpower..."
                                        className="pl-10"
                                        value={manpowerSearch}
                                        onChange={(e) => setManpowerSearch(e.target.value)}
                                    />
                                </div>
                                <Button
                                    variant="outline"
                                    onClick={() => handleExportManpower(vendor.manpower || [])}
                                >
                                    <Download className="h-4 w-4 mr-2" />
                                    Export
                                </Button>
                            </div>

                            <Tabs defaultValue="active" className="space-y-6">
                                <TabsList className="w-full justify-start p-0 bg-transparent border-b h-auto rounded-none">
                                    <TabsTrigger value="active" className="data-[state=active]:border-b-2 data-[state=active]:border-orange-500 rounded-none px-6 py-3">
                                        Current Team ({vendor.manpower?.filter((m: any) => Boolean(m.is_active) && Boolean(m.is_approved)).length || 0})
                                    </TabsTrigger>
                                    <TabsTrigger value="pending" className="data-[state=active]:border-b-2 data-[state=active]:border-orange-500 rounded-none px-6 py-3">
                                        Pending Approval
                                        {(() => {
                                            const n = vendor.manpower?.filter((m: any) => Boolean(m.is_active) && !Boolean(m.is_approved)).length || 0;
                                            return n > 0 ? (
                                                <span className="ml-2 text-[10px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded-full">{n}</span>
                                            ) : <span className="ml-2 text-slate-400">(0)</span>;
                                        })()}
                                    </TabsTrigger>
                                    <TabsTrigger value="inactive" className="data-[state=active]:border-b-2 data-[state=active]:border-orange-500 rounded-none px-6 py-3">
                                        Ex-Team ({vendor.manpower?.filter((m: any) => !Boolean(m.is_active)).length || 0})
                                    </TabsTrigger>
                                </TabsList>

                                {['active', 'pending', 'inactive'].map((status) => (
                                    <TabsContent key={status} value={status}>
                                        <div className="space-y-4">
                                            {vendor.manpower
                                                ?.filter((m: any) => {
                                                    // active  = on the team AND approved
                                                    // pending = on the team but awaiting admin approval
                                                    // inactive= removed by the store (Ex-Team)
                                                    if (status === 'inactive') {
                                                        if (Boolean(m.is_active)) return false;
                                                    } else {
                                                        if (!Boolean(m.is_active)) return false;
                                                        const approved = Boolean(m.is_approved);
                                                        if (status === 'active' && !approved) return false;
                                                        if (status === 'pending' && approved) return false;
                                                    }
                                                    if (manpowerSearch) {
                                                        const s = manpowerSearch.toLowerCase();
                                                        return m.name?.toLowerCase().includes(s) || m.phone_number?.includes(s);
                                                    }
                                                    return true;
                                                })
                                                .slice((manpowerPage - 1) * itemsPerPage, manpowerPage * itemsPerPage)
                                                .map((member: any) => (
                                                    <div key={member.id} className="flex items-center justify-between p-4 border rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors">
                                                        <div className="flex items-center gap-4">
                                                            <div className="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-600">
                                                                {member.name.charAt(0)}
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <p className="font-semibold text-slate-800">{member.name}</p>
                                                                    {Boolean(member.is_active) && !Boolean(member.is_approved) && (
                                                                        <span className="text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                                                                            Pending Approval
                                                                        </span>
                                                                    )}
                                                                    {member.request_status === 'pending' && member.request_type === 'remove' && (
                                                                        <span
                                                                            title={member.request_reason ? `Reason: ${member.request_reason}` : undefined}
                                                                            className="text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full"
                                                                        >
                                                                            Removal Requested
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                                                                    <span className="font-mono bg-white border px-1.5 py-0.5 rounded">{member.phone_number}</span>
                                                                    <span>•</span>
                                                                    <span className="capitalize">{member.applicator_type?.replace('_', ' ')}</span>
                                                                </div>
                                                                {member.request_status === 'pending' && member.request_type === 'remove' && member.request_reason && (
                                                                    <p className="text-xs text-rose-600/90 mt-1 italic">
                                                                        Reason given: {member.request_reason}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2">
                                                            {/* A removal request is the decision that matters most on this
                                                                row, so it leads and replaces the usual approve/revoke pair. */}
                                                            {member.request_status === 'pending' && member.request_type === 'remove' && (
                                                                <>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        disabled={approvingManpowerId === member.id}
                                                                        onClick={() => handleRemovalReview(member, false)}
                                                                        className="h-7 text-xs"
                                                                    >
                                                                        Decline
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        disabled={approvingManpowerId === member.id}
                                                                        onClick={() => handleRemovalReview(member, true)}
                                                                        className="h-7 text-xs bg-rose-600 hover:bg-rose-700"
                                                                    >
                                                                        {approvingManpowerId === member.id
                                                                            ? <Loader2 className="h-3 w-3 animate-spin" />
                                                                            : 'Approve Removal'}
                                                                    </Button>
                                                                </>
                                                            )}
                                                            {/* Ex-Team members can be brought back; they return as pending. */}
                                                            {!Boolean(member.is_active) && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    disabled={approvingManpowerId === member.id}
                                                                    onClick={() => handleRestoreManpower(member)}
                                                                    className="h-7 text-xs border-orange-200 text-orange-600 hover:bg-orange-50"
                                                                >
                                                                    {approvingManpowerId === member.id
                                                                        ? <Loader2 className="h-3 w-3 animate-spin" />
                                                                        : 'Restore'}
                                                                </Button>
                                                            )}
                                                            {/* Approve / revoke — only while the member is on the team, and not
                                                                while a removal request is waiting: that decision comes first. */}
                                                            {Boolean(member.is_active) && !(member.request_status === 'pending' && member.request_type === 'remove') && (
                                                                Boolean(member.is_approved) ? (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        disabled={approvingManpowerId === member.id}
                                                                        onClick={() => handleManpowerApproval(member, false)}
                                                                        className="h-7 text-xs border-slate-200 text-slate-600 hover:bg-slate-100"
                                                                    >
                                                                        {approvingManpowerId === member.id
                                                                            ? <Loader2 className="h-3 w-3 animate-spin" />
                                                                            : 'Move to Pending'}
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        size="sm"
                                                                        disabled={approvingManpowerId === member.id}
                                                                        onClick={() => handleManpowerApproval(member, true)}
                                                                        className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                                                    >
                                                                        {approvingManpowerId === member.id
                                                                            ? <Loader2 className="h-3 w-3 animate-spin" />
                                                                            : 'Approve'}
                                                                    </Button>
                                                                )
                                                            )}
                                                            <button
                                                                onClick={() => showManpowerWarranties(member, 'validated')}
                                                                className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold hover:bg-emerald-200 transition-colors"
                                                            >
                                                                {member.points || 0} Approved
                                                            </button>
                                                            <button
                                                                onClick={() => showManpowerWarranties(member, 'pending')}
                                                                className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold hover:bg-amber-200 transition-colors"
                                                            >
                                                                {member.pending_points || 0} Pending
                                                            </button>
                                                            <button
                                                                onClick={() => showManpowerWarranties(member, 'rejected')}
                                                                className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold hover:bg-red-200 transition-colors"
                                                            >
                                                                {member.rejected_points || 0} Action Required
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}

                                            {(() => {
                                                const tabManpower = (vendor.manpower || []).filter((m: any) => {
                                                    // Keep in sync with the render filter above.
                                                    if (status === 'inactive') {
                                                        if (Boolean(m.is_active)) return false;
                                                    } else {
                                                        if (!Boolean(m.is_active)) return false;
                                                        const approved = Boolean(m.is_approved);
                                                        if (status === 'active' && !approved) return false;
                                                        if (status === 'pending' && approved) return false;
                                                    }
                                                    if (manpowerSearch) {
                                                        const s = manpowerSearch.toLowerCase();
                                                        return m.name?.toLowerCase().includes(s) || m.phone_number?.includes(s);
                                                    }
                                                    return true;
                                                });

                                                return (
                                                    <>
                                                        {tabManpower.length === 0 && (
                                                            <div className="text-center py-8 text-slate-400 italic">
                                                                {status === 'pending'
                                                                    ? 'No staff awaiting approval.'
                                                                    : status === 'inactive'
                                                                        ? 'No past team members found.'
                                                                        : 'No active team members found.'}
                                                            </div>
                                                        )}
                                                        {tabManpower.length > itemsPerPage && (
                                                            <Pagination className="mt-4">
                                                                <PaginationContent>
                                                                    <PaginationItem>
                                                                        <PaginationPrevious
                                                                            onClick={() => setManpowerPage(p => Math.max(1, p - 1))}
                                                                            aria-disabled={manpowerPage === 1}
                                                                            className={manpowerPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                                                        />
                                                                    </PaginationItem>
                                                                    {(() => {
                                                                        const totalPages = Math.ceil(tabManpower.length / itemsPerPage);
                                                                        return Array.from({ length: totalPages }, (_, i) => i + 1)
                                                                            .filter(page => page === 1 || page === totalPages || Math.abs(page - manpowerPage) <= 1)
                                                                            .map((page, index, array) => {
                                                                                if (index > 0 && array[index - 1] !== page - 1) {
                                                                                    return (
                                                                                        <div key={`ellipsis-${page}`} className="flex items-center">
                                                                                            <PaginationEllipsis />
                                                                                            <PaginationItem>
                                                                                                <PaginationLink isActive={manpowerPage === page} onClick={() => setManpowerPage(page)} className="cursor-pointer">{page}</PaginationLink>
                                                                                            </PaginationItem>
                                                                                        </div>
                                                                                    );
                                                                                }
                                                                                return (<PaginationItem key={page}><PaginationLink isActive={manpowerPage === page} onClick={() => setManpowerPage(page)} className="cursor-pointer">{page}</PaginationLink></PaginationItem>);
                                                                            });
                                                                    })()}
                                                                    <PaginationItem>
                                                                        <PaginationNext
                                                                            onClick={() => setManpowerPage(p => Math.min(Math.ceil(tabManpower.length / itemsPerPage), p + 1))}
                                                                            aria-disabled={manpowerPage === Math.ceil(tabManpower.length / itemsPerPage)}
                                                                            className={manpowerPage === Math.ceil(tabManpower.length / itemsPerPage) ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                                                        />
                                                                    </PaginationItem>
                                                                </PaginationContent>
                                                            </Pagination>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    </TabsContent>
                                ))}
                            </Tabs>
                        </CardContent>
                    </Card>
                </TabsContent>

                {isDistributorsView && (
                    <TabsContent value="franchises">
                        <Card className="border-orange-100 shadow-sm">
                            <CardHeader>
                                <CardTitle>Mapped Franchises</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-col gap-4 mb-6">
                                    <div className="flex flex-wrap items-center gap-4 justify-between">
                                        <div className="relative flex-1 min-w-[280px]">
                                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                                            <Input
                                                placeholder="Search franchise..."
                                                className="pl-10"
                                                value={franchiseSearch}
                                                onChange={(e) => setFranchiseSearch(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {franchisesLoading ? (
                                    <div className="flex justify-center items-center py-16">
                                        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                                    </div>
                                ) : franchises.length === 0 ? (
                                    <div className="text-center py-12 bg-slate-50 rounded-lg border border-dashed text-slate-400">
                                        No franchises mapped to this distributor yet.
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {franchises
                                            .filter((franchise: any) => {
                                                if (!franchiseSearch) return true;
                                                const term = franchiseSearch.toLowerCase();
                                                return (
                                                    franchise.store_name?.toLowerCase().includes(term) ||
                                                    franchise.city?.toLowerCase().includes(term) ||
                                                    franchise.state?.toLowerCase().includes(term) ||
                                                    franchise.phone_number?.includes(term)
                                                );
                                            })
                                            .slice((franchisePage - 1) * itemsPerPage, franchisePage * itemsPerPage)
                                            .map((franchise: any) => (
                                                <div
                                                    key={franchise.user_id}
                                                    className="p-4 border rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer"
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => handleOpenFranchiseOrders(franchise)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            handleOpenFranchiseOrders(franchise);
                                                        }
                                                    }}
                                                >
                                                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                                        <div className="space-y-2">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <p className="font-semibold text-slate-800">{franchise.store_name}</p>
                                                                {franchise.is_verified ? (
                                                                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200">Active</Badge>
                                                                ) : franchise.verified_at ? (
                                                                    <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-100 border-red-200">Rejected</Badge>
                                                                ) : (
                                                                    <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200">Pending</Badge>
                                                                )}
                                                                {/* Brand badge */}
                                                                {(franchise.allowed_brands || 'AF') === 'AFAC' ? (
                                                                    <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[10px] font-bold">AFAC</Badge>
                                                                ) : (franchise.allowed_brands || 'AF') === 'AC' ? (
                                                                    <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] font-bold">AC</Badge>
                                                                ) : (
                                                                    <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[10px] font-bold">AF</Badge>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                                <span className="font-mono bg-white border px-1.5 py-0.5 rounded">{franchise.phone_number || 'N/A'}</span>
                                                                <span>•</span>
                                                                <span>{franchise.city || 'N/A'}, {franchise.state || 'N/A'}</span>
                                                            </div>
                                                        </div>

                                                        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                                                            <div className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                                                                {franchise.order_confirmed_count || 0} Confirmed
                                                            </div>
                                                            <div className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">
                                                                {franchise.order_pending_count || 0} Pending
                                                            </div>
                                                            <div className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                                                                {franchise.order_declined_count || 0} Declined
                                                            </div>
                                                            <div className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-semibold">
                                                                {franchise.order_total_count || 0} Total
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}

                                        {(() => {
                                            const filteredFranchises = franchises.filter((franchise: any) => {
                                                if (!franchiseSearch) return true;
                                                const term = franchiseSearch.toLowerCase();
                                                return (
                                                    franchise.store_name?.toLowerCase().includes(term) ||
                                                    franchise.city?.toLowerCase().includes(term) ||
                                                    franchise.state?.toLowerCase().includes(term) ||
                                                    franchise.phone_number?.includes(term)
                                                );
                                            });
                                            const totalPages = Math.ceil(filteredFranchises.length / itemsPerPage);
                                            return totalPages > 1 ? (
                                                <Pagination className="mt-4">
                                                    <PaginationContent>
                                                        <PaginationItem>
                                                            <PaginationPrevious
                                                                onClick={() => setFranchisePage(p => Math.max(1, p - 1))}
                                                                aria-disabled={franchisePage === 1}
                                                                className={franchisePage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                                            />
                                                        </PaginationItem>
                                                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                                                            .filter(page => page === 1 || page === totalPages || Math.abs(page - franchisePage) <= 1)
                                                            .map((page, index, array) => {
                                                                if (index > 0 && array[index - 1] !== page - 1) {
                                                                    return (
                                                                        <div key={`ellipsis-${page}`} className="flex items-center">
                                                                            <PaginationEllipsis />
                                                                            <PaginationItem>
                                                                                <PaginationLink isActive={franchisePage === page} onClick={() => setFranchisePage(page)} className="cursor-pointer">{page}</PaginationLink>
                                                                            </PaginationItem>
                                                                        </div>
                                                                    );
                                                                }
                                                                return (
                                                                    <PaginationItem key={page}>
                                                                        <PaginationLink isActive={franchisePage === page} onClick={() => setFranchisePage(page)} className="cursor-pointer">{page}</PaginationLink>
                                                                    </PaginationItem>
                                                                );
                                                            })}
                                                        <PaginationItem>
                                                            <PaginationNext
                                                                onClick={() => setFranchisePage(p => Math.min(totalPages, p + 1))}
                                                                aria-disabled={franchisePage === totalPages}
                                                                className={franchisePage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                                            />
                                                        </PaginationItem>
                                                    </PaginationContent>
                                                </Pagination>
                                            ) : null;
                                        })()}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
            </Tabs>

            {/* Rejection Dialog */}
            <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Decline Warranty</DialogTitle>
                        <DialogDescription>Please provide reviewer remarks / feedback.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <textarea
                            className="w-full p-2 border rounded-md h-24"
                            placeholder="Reason..."
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            onClick={() => selectedWarrantyId && handleUpdateStatus(selectedWarrantyId, 'rejected', rejectReason)}
                            disabled={!rejectReason || !!processingWarranty}
                        >
                            {processingWarranty ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Decline"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Manpower Warranty Details Dialog */}
            <Dialog open={manpowerWarrantyDialogOpen} onOpenChange={setManpowerWarrantyDialogOpen}>
                <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {manpowerWarrantyDialogData.member?.name} - {manpowerWarrantyDialogData.status} Warranties
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                        {manpowerWarrantyDialogData.warranties.length === 0 ? (
                            <p className="text-center text-slate-500">No warranties found.</p>
                        ) : (
                            manpowerWarrantyDialogData.warranties.map((w: any) => {
                                /* Purchase and expiry are dates, not moments — formatToIST
                                   would append a "12:00 am" that was never recorded. */
                                const asDay = (d: string | Date | null | undefined) =>
                                    d ? new Date(d).toLocaleDateString('en-IN', {
                                        timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric'
                                    }) : '';

                                // The product the customer actually bought lives in the JSON;
                                // product_type is only the broad category.
                                let productName = '';
                                try {
                                    const pd = typeof w.product_details === 'string'
                                        ? JSON.parse(w.product_details || '{}')
                                        : (w.product_details || {});
                                    productName = pd.productName || pd.product || '';
                                } catch { /* leave blank rather than break the row */ }

                                const { expirationDate, isExpired } = getWarrantyExpiration(
                                    w.created_at, w.warranty_type, w.purchase_date
                                );
                                // Approved and rejected are the same column in spirit — whichever
                                // happened is the date this warranty was actioned.
                                const actionedAt = w.validated_at || w.rejected_at || w.vendor_approved_at;
                                const actionedLabel = w.validated_at
                                    ? 'Approved'
                                    : w.rejected_at ? 'Action required' : 'Vendor approved';

                                return (
                                    <div key={w.id} className="flex justify-between items-start gap-4 p-3 border rounded-lg bg-slate-50">
                                        <div className="min-w-0">
                                            <p className="font-semibold">{w.customer_name}</p>
                                            <p className="text-xs text-slate-500">{w.car_make} {w.car_model} - {w.product_type}</p>
                                            <p className="text-xs font-mono text-slate-400 mt-1">UID: {w.uid}</p>
                                            {productName && (
                                                <p className="text-xs text-slate-600 font-medium mt-0.5">
                                                    {productName}
                                                    {w.warranty_type && <span className="text-slate-400 font-normal"> · {w.warranty_type}</span>}
                                                </p>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0 space-y-1">
                                            <Badge>{formatToIST(w.created_at)}</Badge>
                                            <div className="text-[11px] text-slate-500 space-y-0.5">
                                                {w.purchase_date && (
                                                    <p>Purchased: <span className="text-slate-700">{asDay(w.purchase_date)}</span></p>
                                                )}
                                                {actionedAt && (
                                                    <p>{actionedLabel}: <span className="text-slate-700">{formatToIST(actionedAt)}</span></p>
                                                )}
                                                {expirationDate && (
                                                    <p>
                                                        Expires:{' '}
                                                        <span className={isExpired ? 'text-rose-600 font-semibold' : 'text-slate-700'}>
                                                            {asDay(expirationDate)}
                                                        </span>
                                                        {isExpired && <span className="text-rose-600 font-semibold"> (expired)</span>}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <AdminFranchiseOrdersDialog
                open={ordersDialogOpen}
                onOpenChange={setOrdersDialogOpen}
                franchise={selectedFranchise}
                orders={franchiseOrders}
                loading={loadingFranchiseOrders}
                onDownloadPdf={handleDownloadOrderPdf}
            />

            {/* Brand change confirmation dialog */}
            <Dialog open={!!pendingBrand} onOpenChange={(open) => { if (!open) setPendingBrand(null); }}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle>Confirm Brand Update</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to update the brand for{' '}
                            <span className="font-semibold text-slate-800">{vendor.store_name}</span>{' '}
                            ({isDistributorsView ? 'Distributor' : 'Franchise'}) to{' '}
                            <span className={`font-bold ${pendingBrand === 'AF' ? 'text-orange-600' : pendingBrand === 'AC' ? 'text-blue-600' : 'text-purple-600'}`}>
                                {pendingBrand === 'AF' ? 'Autoform (AF)' : pendingBrand === 'AC' ? 'Autocruze (AC)' : 'AFAC'}
                            </span>?
                            <br /><br />
                            <span className="text-amber-700 font-medium text-xs">This affects which products this {isDistributorsView ? 'distributor' : 'franchise'} can access.</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="outline" onClick={() => setPendingBrand(null)}>Cancel</Button>
                        <Button
                            onClick={handleUpdateBrand}
                            disabled={updatingBrand}
                            className={pendingBrand === 'AF' ? 'bg-orange-500 hover:bg-orange-600 text-white' : pendingBrand === 'AC' ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-purple-500 hover:bg-purple-600 text-white'}
                        >
                            {updatingBrand ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Yes, Update to {pendingBrand}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};
