import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, ArrowLeft, Search, Loader2, Edit, LayoutGrid, List } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState, useEffect } from "react";
import api from "@/lib/api";
import { cn, getWarrantyExpiration, formatToIST } from "@/lib/utils";
import EVProductsForm from "@/components/warranty/EVProductsForm";
import SeatCoverForm from "@/components/warranty/SeatCoverForm";
import { getWarrantyFormComponent, getEditFormProps } from "@/lib/warrantyFormRegistry";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import { WarrantySpecSheet } from "@/components/warranty/WarrantySpecSheet";
import { displaySerial } from "@/lib/ppfRolls";
import { warrantyVehicleNumber } from "@/lib/vehicleNumber";

const CustomerDashboard = () => {
    const { user, loading } = useAuth();
    const [warranties, setWarranties] = useState<any[]>([]);
    const [loadingWarranties, setLoadingWarranties] = useState(false);
    const [editingWarranty, setEditingWarranty] = useState<any>(null);
    const [creatingWarranty, setCreatingWarranty] = useState<'seat-cover' | 'ppf' | null>(null);
    const [warrantyPagination, setWarrantyPagination] = useState({ currentPage: 1, totalPages: 1, totalCount: 0, limit: 30, hasNextPage: false, hasPrevPage: false });

    // Stats State
    const [dashboardStats, setDashboardStats] = useState({
        pending: 0,
        pending_vendor: 0,
        validated: 0,
        rejected: 0
    });

    // Spec Sheet State
    const [specSheetData, setSpecSheetData] = useState<any | null>(null);

    // Search & Sort State
    const [warrantySearch, setWarrantySearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [activeTab, setActiveTab] = useState('approved');
    const [viewMode, setViewMode] = useState<'card' | 'list'>('list');

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(warrantySearch);
        }, 500);
        return () => clearTimeout(timer);
    }, [warrantySearch]);

    useEffect(() => {
        if (user?.role === "customer") {
            fetchWarranties(1);
            fetchStats();
        }
    }, [user, activeTab, debouncedSearch]);

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

    const fetchWarranties = async (page = 1) => {
        setLoadingWarranties(true);
        try {
            const queryParams = new URLSearchParams();
            queryParams.append('page', page.toString());
            queryParams.append('limit', '30');
            if (debouncedSearch) queryParams.append('search', debouncedSearch);

            // Map UI tabs to API status
            if (activeTab === 'approved') queryParams.append('status', 'validated');
            else if (activeTab === 'rejected') queryParams.append('status', 'rejected');
            else if (activeTab === 'pending') {
                // For customer, 'pending' includes both 'pending' (HO) and 'pending_vendor'
                queryParams.append('status', 'pending');
            }

            const response = await api.get(`/warranty?${queryParams.toString()}`);
            if (response.data.success) {
                setWarranties(response.data.warranties);
                if (response.data.pagination) {
                    setWarrantyPagination(response.data.pagination);
                }
            }
        } catch (error) {
            console.error("Failed to fetch warranties", error);
        } finally {
            setLoadingWarranties(false);
        }
    };

    // Skeleton Loading Component
    const DashboardSkeleton = () => (
        <div className="container mx-auto px-4 md:px-8 py-8 animate-in fade-in duration-500">
            {/* ... Skeleton code remains same ... */}
            <div className="hidden md:flex flex-col gap-4 mb-14">
                <div className="flex items-center gap-3">
                    <div className="h-12 w-32 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 rounded-xl animate-pulse" />
                    <div className="h-12 w-36 bg-gradient-to-r from-orange-100 via-orange-50 to-orange-100 rounded-xl animate-pulse" />
                </div>
                <div className="flex gap-3 items-center">
                    <div className="h-1.5 w-12 bg-slate-200 rounded-full animate-pulse" />
                    <div className="h-4 w-48 bg-slate-100 rounded-lg animate-pulse" />
                    <div className="h-1.5 w-12 bg-orange-100 rounded-full animate-pulse" />
                </div>
            </div>
            {/* ... Rest of skeleton ... */}
            <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />
                ))}
            </div>
        </div>
    );

    if (loading) return <DashboardSkeleton />;
    if (!user) return <Navigate to="/login?role=customer" replace />;
    if (user.role !== "customer") return <Navigate to="/warranty" replace />;

    if (editingWarranty || creatingWarranty) {
        // ... Form rendering code remains same ...
        const isEditing = !!editingWarranty;
        const productType = isEditing
            ? editingWarranty.product_type
            : (creatingWarranty === 'ppf' ? 'ev-products' : 'seat-cover');

        const FormComponent = getWarrantyFormComponent(productType);

        const formProps = isEditing
            ? getEditFormProps(editingWarranty, () => {
                setEditingWarranty(null);
                setCreatingWarranty(null);
                fetchWarranties();
                fetchStats();
              })
            : {
                onSuccess: () => {
                    setEditingWarranty(null);
                    setCreatingWarranty(null);
                    fetchWarranties();
                    fetchStats();
                },
              };

        return (
            <div className="">
                <div className="container mx-auto px-4 py-8">
                    <Button
                        variant="ghost"
                        onClick={() => {
                            setEditingWarranty(null);
                            setCreatingWarranty(null);
                        }}
                        className="mb-6"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" /> Home
                    </Button>
                    <FormComponent
                        {...formProps}
                    />
                </div>
            </div>
        );
    }

    // List Component
    const WarrantyList = ({ items, showReason = false, viewMode = 'list' }: { items: any[], showReason?: boolean, viewMode?: 'card' | 'list' }) => {
        if (items.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center py-16 text-center border rounded-xl border-dashed bg-muted/10">
                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                        <Package className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                    <h3 className="text-lg font-medium">No Warranties Found</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
                        No warranties found in this category.
                    </p>
                </div>
            );
        }

        return (
            <div className={viewMode === 'card' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-3"}>
                {items.map((warranty, index) => {
                    const productDetails = typeof warranty.product_details === 'string'
                        ? JSON.parse(warranty.product_details || '{}')
                        : warranty.product_details || {};

                    const productNameMapping: Record<string, string> = {
                        'paint-protection': 'Paint Protection Films',
                        'sun-protection': 'Sun Protection Films',
                        'ev-products': 'Paint Protection Film',
                    };

                    const toTitleCase = (str: string) => {
                        if (!str) return str;
                        return str.replace(/[_-]/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
                    };

                    const rawProductName = productDetails.product || productDetails.productName || warranty.product_type;
                    const productName = productNameMapping[rawProductName] || toTitleCase(rawProductName);
                    const { daysLeft, isExpired } = getWarrantyExpiration(warranty.created_at, warranty.warranty_type, warranty.purchase_date);

                    if (viewMode === 'card') {
                        return (
                            <div
                                key={warranty.id || index}
                                onClick={() => setSpecSheetData(warranty)}
                                className={cn(
                                    "group relative flex flex-col overflow-hidden rounded-3xl p-6 cursor-pointer transition-all duration-500 active:scale-[0.98]",
                                    "bg-white hover:bg-orange-50/30",
                                    "border border-orange-100 hover:border-orange-200",
                                    "shadow-sm hover:shadow-lg",
                                    "hover:-translate-y-1"
                                )}
                            >
                                {/* ... Card content ... */}
                                {/* Reusing existing card structure but simplified for brevity in replace block if possible, 
                                    but since I need to replace the component definition, I must include it all. 
                                    I will copy carefully from original. */}

                                <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl -mr-10 -mt-10 opacity-30 group-hover:opacity-50 transition-opacity duration-500 bg-orange-200" />
                                <div className="absolute bottom-0 left-0 w-20 h-20 rounded-full blur-2xl -ml-8 -mb-8 opacity-20 bg-orange-100" />

                                <div className="relative flex items-start justify-between mb-5">
                                    <div className="flex-1 min-w-0 pr-4">
                                        <h4 className="font-bold text-lg text-slate-900 truncate leading-tight">
                                            {warrantyVehicleNumber(warranty) || (warranty.product_type === 'seat-cover' ? 'Seat Cover' : 'Paint Protection Film')}
                                        </h4>
                                        {warranty.product_type !== 'seat-cover' && (warranty.car_make || warranty.car_model) && (
                                            <p className="text-xs font-semibold text-slate-500 mt-1 uppercase tracking-wider">
                                                {warranty.car_make} {warranty.car_model}
                                            </p>
                                        )}

                                        <p className={cn(
                                            "text-xs font-bold mt-1 tracking-wider",
                                            warranty.product_type === 'seat-cover' ? "text-red-500" : "text-blue-500"
                                        )}>
                                            {productName}
                                        </p>
                                    </div>
                                    <div className={cn(
                                        "relative h-14 w-14 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-500 group-hover:scale-110",
                                        warranty.product_type === 'seat-cover'
                                            ? "bg-gradient-to-br from-red-50 to-red-100 border border-red-200/60 shadow-lg shadow-red-500/10"
                                            : "bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200/60 shadow-lg shadow-blue-500/10"
                                    )}>
                                        <img
                                            src={warranty.product_type === 'seat-cover' ? "/seat-cover-icon.png" : "/ppf-icon.png"}
                                            alt="Icon"
                                            className="w-7 h-7 object-contain"
                                        />
                                    </div>
                                </div>

                                <div className="flex-1 space-y-2.5 mb-5">
                                    <div className="flex items-center justify-between p-3 rounded-xl bg-orange-50/50 border border-orange-100">
                                        <span className="text-[11px] font-semibold text-orange-400 tracking-wider">
                                            {warranty.product_type === 'seat-cover' ? 'UID' : 'Serial'}
                                        </span>
                                        <span className="font-mono font-bold text-sm text-slate-700">
                                            {warranty.product_type === 'seat-cover' ? (productDetails.uid || warranty.uid || 'N/A') : displaySerial(productDetails, warranty.uid)}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between p-3 rounded-xl bg-orange-50/50 border border-orange-100">
                                        <span className="text-[11px] font-semibold text-orange-400 tracking-wider">Purchased</span>
                                        <span className="font-bold text-sm text-slate-700">{formatToIST(warranty.purchase_date || warranty.created_at).split(',')[0]}</span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                                    <div className={cn(
                                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold",
                                        warranty.status === 'validated' ? "bg-green-50 text-green-600 border border-green-200" :
                                            ['pending', 'pending_vendor'].includes(warranty.status) ? "bg-amber-50 text-amber-600 border border-amber-200" :
                                                "bg-red-50 text-red-600 border border-red-200"
                                    )}>
                                        <div className={cn(
                                            "w-2 h-2 rounded-full animate-pulse",
                                            warranty.status === 'validated' ? "bg-green-500" :
                                                ['pending', 'pending_vendor'].includes(warranty.status) ? "bg-amber-500" :
                                                    "bg-red-500"
                                        )} />
                                        {warranty.status === 'pending_vendor' ? 'In Review' : warranty.status === 'validated' ? 'Approved' : warranty.status === 'pending' ? 'Verified (HO)' : warranty.status}
                                    </div>

                                    {warranty.status === 'validated' && (
                                        <div className={cn(
                                            "flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold text-sm",
                                            isExpired
                                                ? "bg-red-50 text-red-600 border border-red-200"
                                                : "bg-gradient-to-r from-green-50 to-emerald-50 text-green-600 border border-green-200"
                                        )}>
                                            {!isExpired && <span className="text-[10px] opacity-70">⏱</span>}
                                            {isExpired ? "Expired" : `${daysLeft}d`}
                                        </div>
                                    )}
                                </div>

                                {showReason && (
                                    <div className="mt-4 p-3 bg-red-50 rounded-xl border border-red-200/60">
                                        <p className="text-red-600 text-xs font-medium mb-3 flex items-start gap-2">
                                            <span className="shrink-0">⚠️</span>
                                            <span>{warranty.rejection_reason || "Check details and resubmit."}</span>
                                        </p>
                                        {(productDetails.retryCount || 0) >= 1 ? (
                                            <div className="text-[11px] text-red-500 font-semibold bg-red-100/50 p-2 rounded-lg border border-red-100">
                                                Max resubmission limit reached.
                                            </div>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="w-full border-red-200 text-red-700 hover:bg-red-100 h-9 rounded-xl font-semibold"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingWarranty(warranty);
                                                }}
                                            >
                                                <Edit className="w-3.5 h-3.5 mr-2" /> Edit & Resubmit
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    }

                    // List View
                    return (
                        <div key={warranty.id || index} className="group flex flex-col">
                            {/* ... List view structure ... */}
                            <div
                                onClick={() => setSpecSheetData(warranty)}
                                className={cn(
                                    "relative flex items-center gap-4 p-4 bg-white hover:bg-orange-50/50 transition-all duration-300 rounded-xl border border-orange-100 hover:border-orange-200 shadow-sm hover:shadow-md cursor-pointer active:scale-[0.99] z-10",
                                    showReason && "rounded-b-none border-b-0"
                                )}
                            >
                                <div className={cn(
                                    "h-12 w-12 rounded-xl flex items-center justify-center shrink-0 border",
                                    warranty.product_type === 'seat-cover' ? "bg-red-50 border-red-200/60" : "bg-blue-50 border-blue-200/60"
                                )}>
                                    <img
                                        src={warranty.product_type === 'seat-cover' ? "/seat-cover-icon.png" : "/ppf-icon.png"}
                                        alt="Icon"
                                        className="w-6 h-6 object-contain"
                                    />
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <h4 className="font-semibold text-base text-slate-800 truncate pr-2">
                                            {warrantyVehicleNumber(warranty) || (warranty.product_type === 'seat-cover' ? 'Seat Cover' : 'Paint Protection Film')}
                                        </h4>
                                        {warranty.status === 'validated' && (
                                            <Badge variant="outline" className={cn(
                                                "h-5 text-[10px] px-2 uppercase tracking-wide font-semibold rounded-full",
                                                isExpired ? "bg-red-100 text-red-600 border-red-200" : "bg-green-100 text-green-700 border-green-200"
                                            )}>
                                                {isExpired ? 'Expired' : 'Active'}
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-sm text-slate-500 truncate">
                                        <span className={cn(
                                            "font-bold",
                                            warranty.product_type === 'seat-cover' ? "text-red-500" : "text-blue-500"
                                        )}>{productName}</span>
                                        {warranty.product_type !== 'seat-cover' && (warranty.car_make || warranty.car_model) && (
                                            <>
                                                <span className="mx-2 text-slate-300">•</span>
                                                <span className="text-xs text-slate-400 font-semibold">{toTitleCase(warranty.car_make || '')} {toTitleCase(warranty.car_model || '')}</span>
                                            </>
                                        )}
                                        <span className="mx-2 text-slate-300">•</span>
                                        <span className="text-xs text-slate-400 font-semibold">{formatToIST(warranty.purchase_date || warranty.created_at).split(',')[0]}</span>
                                    </p>
                                </div>

                                <div className="shrink-0 flex flex-col items-end gap-1">
                                    {warranty.status === 'validated' && (
                                        <span className={cn(
                                            "text-sm font-bold",
                                            isExpired ? "text-red-600" : "text-green-600"
                                        )}>
                                            {isExpired ? "Expired" : `${daysLeft} days`}
                                        </span>
                                    )}
                                    <div className="flex items-center gap-1.5">
                                        <div className={cn(
                                            "w-2 h-2 rounded-full",
                                            warranty.status === 'validated' ? "bg-green-500" :
                                                ['pending', 'pending_vendor'].includes(warranty.status) ? "bg-amber-500" : "bg-red-500"
                                        )} />
                                        <span className="text-[10px] font-medium text-slate-400 capitalize">
                                            {warranty.status === 'pending_vendor' ? 'In Review' : warranty.status === 'validated' ? 'Approved' : warranty.status}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Rejection Handling in List View */}
                            {showReason && (
                                <div className="relative mx-1 p-3 bg-red-500/5 rounded-b-xl border border-t-0 border-red-500/10 text-sm animate-in slide-in-from-top-1 z-0">
                                    <p className="text-red-600 mb-2 font-medium flex items-start gap-2">
                                        <span className="shrink-0 pt-0.5">•</span>
                                        {warranty.rejection_reason || "Check details and resubmit."}
                                    </p>

                                    {(productDetails.retryCount || 0) >= 1 ? (
                                        <div className="mt-2 text-xs text-red-500 font-semibold bg-red-100/50 p-2 rounded border border-red-100">
                                            Max resubmission limit reached.
                                        </div>
                                    ) : (
                                        <Button size="sm" variant="outline" className="w-full border-red-200 text-red-700 hover:bg-red-50 h-8" onClick={(e) => {
                                            e.preventDefault();
                                            setEditingWarranty(warranty);
                                        }}>
                                            <Edit className="w-3 h-3 mr-2" /> Edit & Resubmit
                                        </Button>
                                    )}
                                </div>
                            )}

                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="w-full md:container md:mx-auto px-3 md:px-8 py-4 md:py-8">
            {/* Header Section */}
            <div className="flex flex-col gap-4 mb-8 md:mb-14">
                {/* Desktop Headline */}
                <div className="hidden md:flex flex-col gap-4">
                    <h1 className="font-black tracking-tight leading-none" style={{ fontSize: '3em' }}>
                        <span className="bg-gradient-to-r from-slate-800 to-slate-900 bg-clip-text text-transparent">Drive</span><span className="bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent ml-2">Shield</span>
                    </h1>
                    <div className="flex gap-3 items-center">
                        <div className="h-1.5 w-12 bg-black rounded-full" />
                        <p className="text-sm font-semibold text-slate-700 tracking-wide">protect your ride in style</p>
                        <div className="h-1.5 w-12 bg-gradient-to-r from-orange-500 to-orange-600 rounded-full" />
                    </div>
                </div>

                {/* Mobile Headline - Compact */}
                <div className="md:hidden flex items-center justify-between">
                    <div>
                        <h1 className="font-black tracking-tight text-3xl">
                            <span className="text-slate-900">Drive</span><span className="text-orange-500">Shield</span>
                        </h1>
                        <p className="text-xs font-medium text-slate-500 mt-1">Protect your ride in style</p>
                    </div>
                    {/* Optional: Add a small profile/logout button here if needed, but for now just branding */}
                </div>
            </div>

            {/* New Warranty Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                <button
                    onClick={() => setCreatingWarranty('seat-cover')}
                    className="relative group flex items-center gap-4 md:gap-6 p-5 md:p-8 min-h-[160px] md:min-h-[180px] rounded-2xl md:rounded-3xl border border-red-200/50 bg-gradient-to-r from-white via-white to-red-50/30 hover:to-red-50/60 transition-all duration-500 active:scale-[0.98] shadow-lg hover:shadow-2xl hover:shadow-red-500/15 overflow-hidden"
                >
                    {/* Background Decorations */}
                    <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-red-100/40 to-transparent rounded-full blur-2xl -mr-16 -mt-16 group-hover:scale-125 transition-transform duration-700" />
                    <div className="absolute bottom-0 right-0 w-32 h-32 border-[3px] border-red-200/20 rounded-full -mr-16 -mb-16 group-hover:border-red-300/30 transition-colors duration-500" />
                    <div className="absolute top-4 right-4 w-2 h-2 bg-red-400/40 rounded-full group-hover:bg-red-500/60 transition-colors" />
                    <div className="absolute top-4 right-8 w-1.5 h-1.5 bg-red-300/30 rounded-full" />

                    {/* Icon Container - Left Side */}
                    <div className="relative shrink-0">
                        <div className="w-20 h-20 md:w-28 md:h-28 rounded-2xl md:rounded-3xl bg-gradient-to-br from-red-50 to-red-100/80 border border-red-200/60 flex items-center justify-center shadow-lg shadow-red-500/10 group-hover:shadow-xl group-hover:shadow-red-500/20 group-hover:scale-105 transition-all duration-500">
                            <img src="/seat-cover-icon.png" className="w-10 h-10 md:w-16 md:h-16 object-contain group-hover:scale-110 transition-transform duration-500" alt="Seat Cover" />
                        </div>
                        {/* Floating Badge */}
                        <div className="absolute -top-2 -right-2 px-2 py-0.5 md:px-2.5 md:py-1 bg-red-500 text-white text-[9px] md:text-[10px] font-bold uppercase tracking-wider rounded-full shadow-lg shadow-red-500/30">
                            LuxeGuard
                        </div>
                    </div>

                    {/* Content - Right Side */}
                    <div className="flex-1 text-left relative z-10">
                        <div className="flex items-center gap-2 mb-1 md:mb-2">
                            <div className="w-1 h-5 md:h-6 bg-gradient-to-b from-red-500 to-red-400 rounded-full" />
                            <span className="text-[10px] md:text-[11px] font-bold text-red-500 uppercase tracking-widest">Warranty</span>
                        </div>
                        <h3 className="text-lg md:text-2xl font-black text-slate-900 mb-1 md:mb-2 leading-tight">Seat Cover</h3>
                        <p className="text-xs md:text-sm text-slate-500 leading-relaxed line-clamp-2 md:line-clamp-none">Protect your vehicle interiors with premium coverage</p>

                        {/* CTA Arrow */}
                        <div className="mt-3 md:mt-4 flex items-center gap-2 text-red-500 font-semibold text-xs md:text-sm group-hover:gap-3 transition-all duration-300">
                            <span>Register Now</span>
                            <svg className="w-3.5 h-3.5 md:w-4 md:h-4 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                            </svg>
                        </div>
                    </div>
                </button>

                <button
                    onClick={() => setCreatingWarranty('ppf')}
                    className="relative group flex items-center gap-4 md:gap-6 p-5 md:p-8 min-h-[160px] md:min-h-[180px] rounded-2xl md:rounded-3xl border border-blue-200/50 bg-gradient-to-r from-white via-white to-blue-50/30 hover:to-blue-50/60 transition-all duration-500 active:scale-[0.98] shadow-lg hover:shadow-2xl hover:shadow-blue-500/15 overflow-hidden"
                >
                    {/* Background Decorations */}
                    <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-blue-100/40 to-transparent rounded-full blur-2xl -mr-16 -mt-16 group-hover:scale-125 transition-transform duration-700" />
                    <div className="absolute bottom-0 right-0 w-32 h-32 border-[3px] border-blue-200/20 rounded-full -mr-16 -mb-16 group-hover:border-blue-300/30 transition-colors duration-500" />
                    <div className="absolute top-4 right-4 w-2 h-2 bg-blue-400/40 rounded-full group-hover:bg-blue-500/60 transition-colors" />
                    <div className="absolute top-4 right-8 w-1.5 h-1.5 bg-blue-300/30 rounded-full" />

                    {/* Icon Container - Left Side */}
                    <div className="relative shrink-0">
                        <div className="w-20 h-20 md:w-28 md:h-28 rounded-2xl md:rounded-3xl bg-gradient-to-br from-blue-50 to-blue-100/80 border border-blue-200/60 flex items-center justify-center shadow-lg shadow-blue-500/10 group-hover:shadow-xl group-hover:shadow-blue-500/20 group-hover:scale-105 transition-all duration-500">
                            <img src="/ppf-icon.png" className="w-10 h-10 md:w-16 md:h-16 object-contain group-hover:scale-110 transition-transform duration-500" alt="PPF" />
                        </div>
                        {/* Floating Badge */}
                        <div className="absolute -top-2 -right-2 px-2 py-0.5 md:px-2.5 md:py-1 bg-blue-500 text-white text-[9px] md:text-[10px] font-bold uppercase tracking-wider rounded-full shadow-lg shadow-blue-500/30">
                            Apex Shield
                        </div>
                    </div>

                    {/* Content - Right Side */}
                    <div className="flex-1 text-left relative z-10">
                        <div className="flex items-center gap-2 mb-1 md:mb-2">
                            <div className="w-1 h-5 md:h-6 bg-gradient-to-b from-blue-500 to-blue-400 rounded-full" />
                            <span className="text-[10px] md:text-[11px] font-bold text-blue-500 uppercase tracking-widest">Warranty</span>
                        </div>
                        <h3 className="text-lg md:text-2xl font-black text-slate-900 mb-1 md:mb-2 leading-tight">Paint Protection</h3>
                        <p className="text-xs md:text-sm text-slate-500 leading-relaxed line-clamp-2 md:line-clamp-none">Premium paint protection for your vehicle exterior</p>

                        {/* CTA Arrow */}
                        <div className="mt-3 md:mt-4 flex items-center gap-2 text-blue-500 font-semibold text-xs md:text-sm group-hover:gap-3 transition-all duration-300">
                            <span>Register Now</span>
                            <svg className="w-3.5 h-3.5 md:w-4 md:h-4 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                            </svg>
                        </div>
                    </div>
                </button>
            </div>

            {/* Tabs & Search Section */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-6 py-2">
                    {/* Filter Tabs */}
                    <div className="w-full md:w-auto overflow-x-auto pb-2 md:pb-0 scrollbar-none order-2 md:order-1">
                        <TabsList className="relative bg-slate-100/80 p-1 rounded-full h-10 md:h-11 w-full md:w-auto grid grid-cols-3 md:inline-flex gap-0.5 shadow-inner">
                            <TabsTrigger
                                value="approved"
                                className="relative z-10 rounded-full px-2 md:px-5 py-1.5 md:py-2 text-[10px] sm:text-xs md:text-sm font-medium text-slate-500 data-[state=active]:text-orange-600 data-[state=active]:bg-white data-[state=active]:shadow-md transition-all duration-300 ease-out flex items-center justify-center gap-1 md:gap-2 whitespace-nowrap"
                            >
                                Approved
                                <span className="ml-0.5 md:ml-1.5 py-0.5 px-1.5 md:px-2 rounded-full bg-green-100 text-green-700 text-[9px] md:text-[10px] font-bold">
                                    {dashboardStats.validated || 0}
                                </span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="pending"
                                className="relative z-10 rounded-full px-2 md:px-5 py-1.5 md:py-2 text-[10px] sm:text-xs md:text-sm font-medium text-slate-500 data-[state=active]:text-orange-600 data-[state=active]:bg-white data-[state=active]:shadow-md transition-all duration-300 ease-out flex items-center justify-center gap-1 md:gap-2 whitespace-nowrap"
                            >
                                Pending
                                <span className="ml-0.5 md:ml-1.5 py-0.5 px-1.5 md:px-2 rounded-full bg-amber-100 text-amber-700 text-[9px] md:text-[10px] font-bold">
                                    {/* Combining Pending Vendor and Pending HO for the badge if desired, or just show pending_vendor */}
                                    {(dashboardStats.pending_vendor || 0) + (dashboardStats.pending || 0)}
                                </span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="rejected"
                                className="relative z-10 rounded-full px-2 md:px-5 py-1.5 md:py-2 text-[10px] sm:text-xs md:text-sm font-medium text-slate-500 data-[state=active]:text-orange-600 data-[state=active]:bg-white data-[state=active]:shadow-md transition-all duration-300 ease-out flex items-center justify-center gap-1 md:gap-2 whitespace-nowrap"
                            >
                                Action Required
                                <span className="ml-0.5 md:ml-1.5 py-0.5 px-1.5 md:px-2 rounded-full bg-red-100 text-red-700 text-[9px] md:text-[10px] font-bold">
                                    {dashboardStats.rejected || 0}
                                </span>
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    {/* Right Side: Search & View Toggle */}
                    <div className="flex items-center gap-3 w-full md:w-auto order-1 md:order-2 md:mr-4">
                        {/* Search Bar */}
                        <div className="relative shadow-sm rounded-full w-full md:w-80 flex-1 md:flex-none">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-400" />
                            <input
                                type="text"
                                placeholder="Search your warranties..."
                                className="w-full pl-11 pr-4 py-2.5 rounded-full border border-orange-100 bg-white ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:border-orange-300 disabled:cursor-not-allowed disabled:opacity-50 text-sm transition-all shadow-sm"
                                value={warrantySearch}
                                onChange={(e) => setWarrantySearch(e.target.value)}
                            />
                        </div>

                        {/* View Toggle Buttons */}
                        <div className="flex items-center gap-1 bg-white p-1 rounded-full h-9 md:h-11 flex-shrink-0 border border-orange-100 shadow-sm">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewMode('card')}
                                className={cn(
                                    "rounded-full h-7 md:h-9 px-2 md:px-3 transition-all",
                                    viewMode === 'card' ? "bg-orange-50 text-orange-600 border border-orange-200 shadow-sm" : "text-slate-400 hover:text-orange-600"
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
                                    "rounded-full h-7 md:h-9 px-2 md:px-3 transition-all",
                                    viewMode === 'list' ? "bg-orange-50 text-orange-600 border border-orange-200 shadow-sm" : "text-slate-400 hover:text-orange-600"
                                )}
                                title="List View"
                            >
                                <List className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="outline-none animate-in fade-in slide-in-from-bottom-2 duration-500">
                    {loadingWarranties ? (
                        <div className="space-y-3">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="flex items-center gap-4 p-4 bg-white border border-slate-100 rounded-2xl">
                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 animate-pulse" />
                                    <div className="flex-1 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <div className="h-5 w-32 bg-slate-200 rounded animate-pulse" />
                                            <div className="h-5 w-16 bg-green-50 rounded-full animate-pulse" />
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
                                            <div className="h-3 w-1 bg-slate-100 rounded-full animate-pulse" />
                                            <div className="h-3 w-20 bg-slate-100 rounded animate-pulse" />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-slate-200 animate-pulse" />
                                        <div className="h-3 w-16 bg-slate-100 rounded animate-pulse" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <WarrantyList
                            items={warranties}
                            viewMode={viewMode}
                            showReason={activeTab === 'rejected'}
                        />
                    )}
                </div>
            </Tabs>

            {/* Pagination */}
            {warrantyPagination.totalPages > 1 && (
                <div className="mt-8">
                    <Pagination>
                        <PaginationContent>
                            <PaginationItem>
                                <PaginationPrevious
                                    onClick={() => fetchWarranties(Math.max(1, warrantyPagination.currentPage - 1))}
                                    aria-disabled={warrantyPagination.currentPage === 1}
                                    className={warrantyPagination.currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                />
                            </PaginationItem>
                            {Array.from({ length: warrantyPagination.totalPages }, (_, i) => i + 1)
                                .filter(page => page === 1 || page === warrantyPagination.totalPages || Math.abs(page - warrantyPagination.currentPage) <= 1)
                                .map((page, index, array) => {
                                    if (index > 0 && array[index - 1] !== page - 1) {
                                        return (
                                            <div key={`ellipsis-${page}`} className="flex items-center">
                                                <PaginationEllipsis />
                                                <PaginationItem>
                                                    <PaginationLink isActive={warrantyPagination.currentPage === page} onClick={() => fetchWarranties(page)} className="cursor-pointer">{page}</PaginationLink>
                                                </PaginationItem>
                                            </div>
                                        );
                                    }
                                    return (<PaginationItem key={page}><PaginationLink isActive={warrantyPagination.currentPage === page} onClick={() => fetchWarranties(page)} className="cursor-pointer">{page}</PaginationLink></PaginationItem>);
                                })}
                            <PaginationItem>
                                <PaginationNext
                                    onClick={() => fetchWarranties(Math.min(warrantyPagination.totalPages, warrantyPagination.currentPage + 1))}
                                    aria-disabled={warrantyPagination.currentPage === warrantyPagination.totalPages}
                                    className={warrantyPagination.currentPage === warrantyPagination.totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                />
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                </div>
            )}

            {/* The Spec Sheet Component */}
            <WarrantySpecSheet
                isOpen={!!specSheetData}
                onClose={() => setSpecSheetData(null)}
                warranty={specSheetData}
            />

            {/* Create Warranty Dialogs */}
            <Dialog open={creatingWarranty === 'seat-cover'} onOpenChange={(open) => !open && setCreatingWarranty(null)}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Register Seat Cover Warranty</DialogTitle>
                        <DialogDescription>Enter the details for your new seat cover warranty.</DialogDescription>
                    </DialogHeader>
                    <SeatCoverForm
                        onSuccess={() => {
                            setCreatingWarranty(null);
                            fetchWarranties();
                            fetchStats();
                        }}
                    />
                </DialogContent>
            </Dialog>

            <Dialog open={creatingWarranty === 'ppf'} onOpenChange={(open) => !open && setCreatingWarranty(null)}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Register PPF Warranty</DialogTitle>
                        <DialogDescription>Enter the details for your new paint protection film warranty.</DialogDescription>
                    </DialogHeader>
                    <EVProductsForm
                        embedded
                        isUniversal={false}
                        onSuccess={() => {
                            setCreatingWarranty(null);
                            fetchWarranties();
                            fetchStats();
                        }}
                    />
                </DialogContent>
            </Dialog>

            {/* Edit Warranty Dialog */}
            <Dialog open={!!editingWarranty} onOpenChange={(open) => !open && setEditingWarranty(null)}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit Warranty</DialogTitle>
                        <DialogDescription>Update the details for your application requiring action.</DialogDescription>
                    </DialogHeader>
                    {editingWarranty && (() => {
                        const FormComponent = getWarrantyFormComponent(editingWarranty.product_type);
                        const formProps = getEditFormProps(editingWarranty, () => {
                            setEditingWarranty(null);
                            fetchWarranties();
                            fetchStats();
                        });
                        return <FormComponent {...formProps} />;
                    })()}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default CustomerDashboard;
