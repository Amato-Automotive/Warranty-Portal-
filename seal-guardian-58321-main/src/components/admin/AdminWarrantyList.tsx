import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, getWarrantyExpiration, formatToIST } from "@/lib/utils";
import { WarrantySpecSheet } from "@/components/warranty/WarrantySpecSheet";
import { displaySerial } from "@/lib/ppfRolls";
import {
    Check,
    Download,
    Eye,
    FileText,
    Loader2,
    Mail,
    Package,
    Phone,
    Store,
    User,
    X,
    ShieldAlert,
    MapPin,
    Wifi,
    Clock,
    ChevronUp,
    RefreshCw,
    RotateCcw
} from "lucide-react";
import { WarrantyHistory } from "./WarrantyHistory";
import { warrantyVehicleNumber } from "@/lib/vehicleNumber";

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}



interface AdminWarrantyListProps {
    items: any[];
    showRejectionReason?: boolean;
    showActions?: boolean;
    processingWarranty?: string | null;
    onApprove?: (warrantyId: string) => void;
    onReject?: (warrantyId: string) => void;
    onMoveToPending?: (warrantyId: string) => void;
    onRefresh?: () => void;
    isSplitScreen?: boolean;
    activeUid?: string;
    onSelect?: (warranty: any) => void;
}

export const AdminWarrantyList = ({
    items,
    showRejectionReason = false,
    showActions = true,
    processingWarranty,
    onApprove,
    onReject,
    onMoveToPending,
    onRefresh,
    isSplitScreen = false,
    activeUid,
    onSelect
}: AdminWarrantyListProps) => {
    const [selectedWarranty, setSelectedWarranty] = useState<any>(null);
    const [expandedFraud, setExpandedFraud] = useState<Set<string>>(new Set());

    // When items refresh (e.g. after an admin edit), sync the open SpecSheet
    // with the updated warranty data so photos & fields don't go stale.
    useEffect(() => {
        if (selectedWarranty) {
            const refreshed = items.find((w: any) =>
                w.uid === selectedWarranty.uid ||
                String(w.id) === String(selectedWarranty.id)
            );
            if (refreshed) setSelectedWarranty(refreshed);
        }
    }, [items]);

    const toggleFraudDetails = (id: string) => {
        setExpandedFraud(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const getFraudBadgeColor = (percentage: number) => {
        if (percentage >= 80) return 'bg-green-100 text-green-700 border-green-200';
        if (percentage >= 40) return 'bg-yellow-100 text-yellow-700 border-yellow-200';
        return 'bg-red-100 text-red-700 border-red-200';
    };

    if (items.length === 0) {
        return (
            <div className="text-center py-12 border rounded-lg border-dashed">
                <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Warranties Found</h3>
                <p className="text-muted-foreground mb-4">No warranties in this category</p>
            </div>
        );
    }

    return (
        <div className="grid gap-4">
            {items.map((warranty) => {
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
                const { expirationDate, daysLeft, isExpired } = getWarrantyExpiration(warranty.created_at, warranty.warranty_type, warranty.purchase_date);

                if (isSplitScreen) {
                    const isActive = warranty.uid === activeUid || String(warranty.id) === String(activeUid);
                    return (
                        <Card 
                            key={warranty.uid || warranty.id} 
                            className={cn(
                                "cursor-pointer transition-all border duration-200 hover:-translate-y-0.5", 
                                isActive 
                                    ? "border-orange-500 ring-1 ring-orange-500/20 bg-orange-50/10 shadow-sm" 
                                    : "hover:shadow-sm border-slate-200 hover:border-slate-300"
                            )}
                            onClick={() => onSelect && onSelect(warranty)}
                        >
                            <CardContent className="p-3">
                                <div className="flex justify-between items-start gap-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-tight truncate max-w-[150px]">
                                                {productName.replace(/-/g, ' ')}
                                            </h4>
                                            {warranty.product_brand && <Badge variant="outline" className={`shrink-0 font-bold ${warranty.product_brand === "AC" ? "bg-slate-900 text-white border-slate-900" : "bg-orange-50 text-orange-700 border-orange-200"} text-[9px] px-1 py-0 h-4`}>{warranty.product_brand}</Badge>}
                                            <Badge variant="outline" className="bg-blue-50/50 text-blue-700 border-blue-200 text-[9px] px-1 py-0 h-4 shrink-0 font-bold">
                                                {warranty.warranty_type || '1 Year'}
                                            </Badge>
                                        </div>
                                        <p className="text-xs font-semibold text-slate-600 mt-1 flex items-center gap-1">
                                            <User className="h-3 w-3 text-slate-400 shrink-0" /> {warranty.customer_name}
                                        </p>
                                        {warrantyVehicleNumber(warranty) && (
                                            <p className="text-[10px] text-slate-400 mt-0.5">
                                                Reg: <span className="font-bold text-slate-600 font-mono">{warrantyVehicleNumber(warranty)}</span>
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                                        <Badge variant={
                                            warranty.status === 'validated' ? 'default' :
                                                warranty.status === 'rejected' ? 'destructive' : 'secondary'
                                        } className={cn(
                                            "text-[9px] px-1.5 py-0 h-4.5 font-bold",
                                            warranty.status === 'validated' && "bg-green-600 hover:bg-green-700 text-white",
                                            warranty.status === 'rejected' && "bg-red-600 hover:bg-red-700 text-white",
                                            warranty.status === 'pending' && "bg-amber-600 hover:bg-amber-700 text-white",
                                            warranty.status === 'pending_vendor' && "bg-orange-600 hover:bg-orange-700 text-white"
                                        )}>
                                            {warranty.status === 'validated' ? 'Approved' :
                                                warranty.status === 'rejected' ? 'Action Req' :
                                                    warranty.status === 'pending_vendor' ? 'Pending Vendor' : 'Pending'}
                                        </Badge>
                                        <span className="text-[9px] text-slate-400 font-medium">
                                            {formatToIST(warranty.created_at).split(',')[0]}
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                }

                return (
                    <Card key={warranty.uid || warranty.id} className="hover:shadow-sm transition-shadow border-slate-200">
                        <CardContent className="p-3 md:p-4">
                            <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4 relative">
                                {/* Product Icon - Hidden on mobile */}
                                <div className={cn(
                                    "hidden md:flex h-12 w-12 rounded-full items-center justify-center shrink-0 border mr-4",
                                    warranty.product_type === 'seat-cover' ? "bg-blue-500/10 border-blue-500/20" : "bg-purple-500/10 border-purple-500/20"
                                )}>
                                    <img
                                        src={warranty.product_type === 'seat-cover' ? "/seat-cover-icon.png" : "/ppf-icon.png"}
                                        alt={warranty.product_type}
                                        className="w-6 h-6 object-contain"
                                    />
                                </div>
                                <div className="flex-1 w-full md:w-auto">
                                    <div className="flex items-start justify-between w-full">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-base md:text-lg font-bold uppercase tracking-wide">
                                                    {productName.replace(/-/g, ' ')}
                                                </h3>
                                                {warranty.product_brand && <Badge variant="outline" className={`shrink-0 font-bold ${warranty.product_brand === "AC" ? "bg-slate-900 text-white border-slate-900" : "bg-orange-50 text-orange-700 border-orange-200"} text-[10px] px-2 py-0.5 h-5`}>{warranty.product_brand}</Badge>}
                                                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] px-2 py-0.5 h-5 whitespace-nowrap">
                                                    {warranty.warranty_type || '1 Year'}
                                                </Badge>
                                            </div>
                                            {/* Mobile: Show Customer Name here */}
                                            <p className="md:hidden text-sm font-medium text-slate-700 mt-1 flex items-center gap-1">
                                                <User className="h-3 w-3" /> {warranty.customer_name}
                                            </p>
                                        </div>

                                        {/* Mobile Eye Button - Triggers details sheet */}
                                        <div className="md:hidden">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-slate-500"
                                                onClick={() => setSelectedWarranty(warranty)}
                                            >
                                                <Eye className="h-5 w-5" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Desktop Dates */}
                                    <p className="hidden md:block text-sm text-muted-foreground mt-1">
                                        Registered on {formatToIST(warranty.created_at)}
                                        {/*
                                          * Rejected once, corrected, and waiting again.
                                          *
                                          * There is no status for this: resubmitting returns the
                                          * warranty to the ordinary queue, so it sits among
                                          * registrations nobody has ever looked at. What marks it
                                          * out is rejected_at surviving that move.
                                          *
                                          * A tag rather than a tab, so the pending count keeps
                                          * meaning what it says.
                                          *
                                          * Only while it is waiting. Two hundred and fifty-nine
                                          * approved warranties were also rejected once; that is
                                          * history, not something the reviewer needs flagged.
                                          */}
                                        {warranty.rejected_at
                                            && (warranty.status === 'pending' || warranty.status === 'pending_vendor') && (
                                            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700 align-middle">
                                                <RotateCcw className="h-3 w-3" />
                                                Resubmitted
                                            </span>
                                        )}
                                    </p>
                                    {warranty.status === 'validated' && expirationDate && (
                                        <p className="hidden md:block text-sm text-muted-foreground mt-0.5">
                                            Expires on {formatToIST(expirationDate)}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 mt-2 md:mt-0">
                                    {warranty.status === 'validated' && expirationDate && (
                                        <span className={cn("hidden md:inline text-sm font-medium", isExpired ? "text-destructive" : "text-green-600")}>
                                            {isExpired ? "Expired" : `${daysLeft} days left`}
                                        </span>
                                    )}

                                    <Badge variant={
                                        warranty.status === 'validated' ? 'default' :
                                            warranty.status === 'rejected' ? 'destructive' : 'secondary'
                                    } className={cn(
                                        "text-xs md:text-sm px-2 py-0.5 md:px-2.5 md:py-0.5",
                                        warranty.status === 'validated' && "bg-green-600 hover:bg-green-700",
                                        warranty.status === 'rejected' && "bg-red-600 hover:bg-red-700",
                                        warranty.status === 'pending' && "bg-yellow-600 hover:bg-yellow-700 text-white",
                                        warranty.status === 'pending_vendor' && "bg-orange-600 hover:bg-orange-700 text-white"
                                    )}>
                                        {warranty.status === 'validated' ? 'Approved' :
                                            warranty.status === 'rejected' ? 'Action Required' :
                                                warranty.status === 'pending_vendor' ? 'Waiting Vendor' : 'Pending'}
                                    </Badge>
                                    {/* Fraud Score Badge */}
                                    {warranty.fraud_score !== undefined && warranty.fraud_score !== null && (
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Badge
                                                        variant="outline"
                                                        className={cn(
                                                            "text-[10px] px-1.5 py-0.5 h-5 cursor-pointer gap-1 hidden md:inline-flex",
                                                            getFraudBadgeColor(warranty.fraud_score)
                                                        )}
                                                        onClick={() => toggleFraudDetails(warranty.uid || warranty.id)}
                                                    >
                                                        <ShieldAlert className="h-3 w-3" />
                                                        Trust: {warranty.fraud_score}%
                                                    </Badge>
                                                </TooltipTrigger>
                                                <TooltipContent side="bottom">
                                                    <p className="text-xs">Fraud Risk Score — Click to expand details</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    )}
                                </div>
                            </div>

                            {/* Mobile: Grid is hidden or highly simplified. User said "Too detailed".
                                So on Mobile, we HIDE the entire grid below?
                                And rely ONLY on the Eye button?
                                YES. "Show only necessary details and show an eye button".
                            */}
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 pt-3 border-t hidden md:grid">
                                {/* Desktop Grid Content (Unchanged) */}

                                <div>
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Customer</p>
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className="cursor-pointer hover:bg-muted/50 p-1.5 -m-1.5 rounded-md transition-colors">
                                                    <h3 className="text-sm font-medium flex items-center gap-1">
                                                        <User className="h-4 w-4 text-blue-600" />
                                                        {warranty.customer_name}
                                                    </h3>
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom" className="max-w-xs p-3">
                                                <div className="space-y-2">
                                                    <p className="font-semibold text-sm border-b pb-1">Customer Details</p>
                                                    <div className="text-xs space-y-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <User className="h-3 w-3 text-muted-foreground" />
                                                            <span>{warranty.customer_name}</span>
                                                        </div>
                                                        {warranty.customer_email && (
                                                            <div className="flex items-center gap-2">
                                                                <Mail className="h-3 w-3 text-muted-foreground" />
                                                                <span>{warranty.customer_email}</span>
                                                            </div>
                                                        )}
                                                        {warranty.customer_phone && (
                                                            <div className="flex items-center gap-2">
                                                                <Phone className="h-3 w-3 text-muted-foreground" />
                                                                <span>{warranty.customer_phone}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>


                                <div>
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                                        {warranty.status === 'pending_vendor' ? 'Installer' : 'Verified By'}
                                    </p>
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className="text-sm cursor-pointer hover:bg-muted/50 p-1.5 -m-1.5 rounded-md transition-colors">
                                                    <p className="font-medium flex items-center gap-1.5">
                                                        <Store className="h-4 w-4 text-purple-600" />
                                                        {/* With the city: several franchises share a name. */}
                                                        {warranty.vendor_store_name
                                                            ? `${warranty.vendor_store_name}${warranty.vendor_city ? ` - ${warranty.vendor_city}` : ''}`
                                                            : (productDetails.storeName || 'N/A')}
                                                    </p>
                                                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium mt-1 bg-purple-100 text-purple-800">
                                                        Franchise
                                                    </span>
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom" className="max-w-xs p-3">
                                                <div className="space-y-2">
                                                    <p className="font-semibold text-sm border-b pb-1">
                                                        {warranty.status === 'pending_vendor' ? 'Installer Details' : 'Verified By Details'}
                                                    </p>
                                                    <div className="text-xs space-y-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <User className="h-3 w-3 text-muted-foreground" />
                                                            <span>
                                                                {productDetails.manpowerName ||
                                                                    warranty.manpower_name_from_db ||
                                                                    productDetails.installerName ||
                                                                    'Not specified'}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <MapPin className="h-3 w-3 text-muted-foreground" />
                                                            <span>{warranty.vendor_city || productDetails.storeCity || 'City not available'}</span>
                                                        </div>
                                                        {(productDetails.storeEmail || warranty.installer_contact) && (
                                                            <div className="flex items-center gap-2">
                                                                <Mail className="h-3 w-3 text-muted-foreground" />
                                                                <span>{productDetails.storeEmail || warranty.installer_contact}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>

                                {warranty.product_type === 'seat-cover' && (
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">UID</p>
                                        <p className="font-mono text-sm font-semibold">{warranty.uid || productDetails.uid || 'N/A'}</p>
                                    </div>
                                )}

                                {warranty.product_type !== 'seat-cover' && (
                                    <div>
                                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Serial Number</p>
                                        <p className="font-mono text-sm font-semibold">{displaySerial(productDetails, warranty.uid)}</p>
                                    </div>
                                )}







                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Invoice</p>
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button variant="outline" size="sm" className="h-7 text-xs w-full border-slate-200">
                                                <FileText className="h-3 w-3 mr-1.5" />
                                                View
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                                            <DialogHeader>
                                                <DialogTitle>Invoice Document</DialogTitle>
                                                <DialogDescription>
                                                    Uploaded invoice for {productName.replace(/-/g, ' ')}
                                                </DialogDescription>
                                            </DialogHeader>
                                            <div className="mt-4">
                                                {(() => {
                                                    const invoiceFile = warranty.product_type === 'ev-products'
                                                        ? productDetails.photos?.warranty
                                                        : productDetails.invoiceFileName;
                                                    if (invoiceFile) {
                                                        return (
                                                            <div className="space-y-4">
                                                                <div className="border rounded-lg p-4 bg-muted/50 relative">
                                                                    <div className="absolute inset-0 flex items-center justify-center bg-muted/50 rounded-lg" id={`invoice-loader-${warranty.id}`}>
                                                                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                                                    </div>
                                                                    <img
                                                                        src={(typeof invoiceFile === 'string' && invoiceFile.startsWith('http')) ? invoiceFile : `http://localhost:3000/uploads/${invoiceFile}`}
                                                                        alt="Invoice"
                                                                        className="w-full h-auto rounded"
                                                                        onLoad={(e) => {
                                                                            const loader = document.getElementById(`invoice-loader-${warranty.id}`);
                                                                            if (loader) loader.style.display = 'none';
                                                                        }}
                                                                        onError={(e) => {
                                                                            const loader = document.getElementById(`invoice-loader-${warranty.id}`);
                                                                            if (loader) loader.style.display = 'none';
                                                                            e.currentTarget.style.display = 'none';
                                                                            const nextEl = e.currentTarget.nextElementSibling as HTMLElement;
                                                                            if (nextEl) nextEl.classList.remove('hidden');
                                                                        }}
                                                                    />
                                                                    <div className="hidden text-center py-8 text-muted-foreground">
                                                                        <FileText className="h-16 w-16 mx-auto mb-2" />
                                                                        <p>Preview not available (PDF or other format)</p>
                                                                    </div>
                                                                </div>
                                                                <Button
                                                                    className="w-full"
                                                                    onClick={() => {
                                                                        const fileUrl = (typeof invoiceFile === 'string' && invoiceFile.startsWith('http')) ? invoiceFile : `http://localhost:3000/uploads/${invoiceFile}`;
                                                                        fetch(fileUrl)
                                                                            .then(res => res.blob())
                                                                            .then(blob => {
                                                                                const blobUrl = window.URL.createObjectURL(blob);
                                                                                const link = document.createElement("a");
                                                                                link.href = blobUrl;
                                                                                link.download = invoiceFile;
                                                                                document.body.appendChild(link);
                                                                                link.click();
                                                                                link.remove();
                                                                                window.URL.revokeObjectURL(blobUrl);
                                                                            })
                                                                            .catch(err => console.error("Download failed", err));
                                                                    }}
                                                                >
                                                                    <Download className="h-4 w-4 mr-2" />
                                                                    Download Document
                                                                </Button>
                                                            </div>
                                                        );
                                                    } else {
                                                        return (
                                                            <div className="text-center py-8 text-muted-foreground">
                                                                <FileText className="h-16 w-16 mx-auto mb-2" />
                                                                <p>No invoice uploaded</p>
                                                            </div>
                                                        );
                                                    }
                                                })()}
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                </div>

                                <div>
                                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Details</p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs w-full border-slate-200"
                                        onClick={() => setSelectedWarranty(warranty)}
                                    >
                                        <Eye className="h-3 w-3 mr-1.5" />
                                        View
                                    </Button>
                                </div>
                            </div>

                            {showRejectionReason && (
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Reviewer Remarks / Feedback</p>
                                    <p className="text-sm text-red-600">{warranty.rejection_reason || 'N/A'}</p>
                                </div>
                            )}

                            {/* The rejection-and-fix chain, for a warranty that has
                                one. Renders nothing on a first-time submission. */}
                            <WarrantyHistory uid={warranty.uid} />

                            {/* Fraud Details Panel (Toggle with badge click) */}
                            {expandedFraud.has(warranty.uid || warranty.id) && warranty.fraud_score !== undefined && (() => {
                                const flags = typeof warranty.fraud_flags === 'string' ? JSON.parse(warranty.fraud_flags || '{}') : (warranty.fraud_flags || {});
                                return (
                                    <div className="mt-3 pt-3 border-t border-dashed border-red-200 bg-red-50/30 rounded-lg p-3">
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="text-xs font-semibold uppercase tracking-wider text-red-700 flex items-center gap-1.5">
                                                <ShieldAlert className="h-3.5 w-3.5" />
                                                Fraud Analysis — Trust Score: {warranty.fraud_score}%
                                            </h4>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-6 w-6 p-0 text-slate-400"
                                                onClick={() => toggleFraudDetails(warranty.uid || warranty.id)}
                                            >
                                                <ChevronUp className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                            <div className={cn("p-2 rounded border", flags.distance_penalty >= 50 ? "bg-red-100 border-red-200" : flags.distance_penalty > 0 ? "bg-yellow-100 border-yellow-200" : "bg-green-50 border-green-200")}>
                                                <div className="flex items-center gap-1 mb-1">
                                                    <MapPin className="h-3 w-3" />
                                                    <span className="font-medium">Distance Penalty</span>
                                                </div>
                                                {(() => {
                                                    let distanceText = "";
                                                    if (warranty.store_lat && warranty.store_lng && warranty.exif_lat && warranty.exif_lng) {
                                                        const dist = haversineDistance(
                                                            Number(warranty.exif_lat), Number(warranty.exif_lng),
                                                            Number(warranty.store_lat), Number(warranty.store_lng)
                                                        );
                                                        distanceText = ` (${dist < 1 ? (dist * 1000).toFixed(0) + ' m' : dist.toFixed(1) + ' km'})`;
                                                    }
                                                    return (
                                                        <p className={cn("text-sm font-bold", flags.distance_penalty >= 50 ? "text-red-600" : flags.distance_penalty > 0 ? "text-yellow-700" : "text-green-600")}>
                                                            -{flags.distance_penalty} pts <span className="text-xs font-normal opacity-80">{distanceText}</span>
                                                        </p>
                                                    );
                                                })()}
                                                <p className="text-[10px] text-muted-foreground mt-1">
                                                    {flags.distance_penalty === 0 ? '✓ Within Store Range' : flags.distance_penalty >= 50 ? '❌ Outside Area' : '⚠ Warning'}
                                                </p>
                                            </div>

                                            <div className={cn("p-2 rounded border", flags.time_penalty >= 40 ? "bg-red-100 border-red-200" : flags.time_penalty > 0 ? "bg-yellow-100 border-yellow-200" : "bg-green-50 border-green-200")}>
                                                <div className="flex items-center gap-1 mb-1">
                                                    <Clock className="h-3 w-3" />
                                                    <span className="font-medium">Time Penalty</span>
                                                </div>
                                                <p className={cn("text-sm font-bold", flags.time_penalty >= 40 ? "text-red-600" : flags.time_penalty > 0 ? "text-yellow-700" : "text-green-600")}>
                                                    -{flags.time_penalty} pts
                                                </p>
                                                <p className="text-[10px] text-muted-foreground mt-1">
                                                    {flags.time_penalty === 0 ? '✓ Immediate' : flags.time_penalty >= 40 ? '❌ Delayed' : '⚠ Review Delay'}
                                                </p>
                                            </div>

                                            <div className={cn("p-2 rounded border", flags.ip_penalty > 0 ? "bg-yellow-100 border-yellow-200" : "bg-green-50 border-green-200")}>
                                                <div className="flex items-center gap-1 mb-1">
                                                    <Wifi className="h-3 w-3" />
                                                    <span className="font-medium">IP Penalty</span>
                                                </div>
                                                <p className={cn("text-sm font-bold", flags.ip_penalty > 0 ? "text-yellow-700" : "text-green-600")}>
                                                    -{flags.ip_penalty} pts
                                                </p>
                                                <p className="text-[10px] text-muted-foreground mt-1">
                                                    {flags.ip_penalty === 0 ? '✓ Matched IP' : '⚠ Region Mismatch'}
                                                </p>
                                            </div>

                                            <div className={cn("p-2 rounded border", flags.consistency_penalty >= 40 ? "bg-red-100 border-red-200" : flags.consistency_penalty > 0 ? "bg-yellow-100 border-yellow-200" : "bg-green-50 border-green-200")}>
                                                <div className="flex items-center gap-1 mb-1">
                                                    <ShieldAlert className="h-3 w-3" />
                                                    <span className="font-medium">Consistency</span>
                                                </div>
                                                <p className={cn("text-sm font-bold", flags.consistency_penalty >= 40 ? "text-red-600" : flags.consistency_penalty > 0 ? "text-yellow-700" : "text-green-600")}>
                                                    -{flags.consistency_penalty} pts
                                                </p>
                                                <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                                                    {flags.multi_device_detected && <p className="text-red-600 font-medium">❌ Multiple Devices</p>}
                                                    {flags.location_mismatch && <p className="text-red-600 font-medium">❌ Location Mismatch</p>}
                                                    {!flags.multi_device_detected && !flags.location_mismatch && <p>✓ All images match</p>}
                                                </div>
                                            </div>

                                            <div className={cn("p-2 rounded border border-slate-200 bg-slate-50")}>
                                                <div className="flex items-center gap-1 mb-1">
                                                    <ShieldAlert className="h-3 w-3" />
                                                    <span className="font-medium">System Info</span>
                                                </div>
                                                <p className="text-xs font-semibold capitalize text-slate-700">
                                                    Platform: {flags.device_category || 'Unknown'}
                                                </p>
                                                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                                                    Source: {productDetails.submissionSource || (warranty.manpower_id ? 'Franchise Dashboard' : 'Customer / QR')}
                                                </p>
                                                {flags.is_missing_data && (
                                                    <p className="text-[10px] text-red-600 mt-1 font-medium italic">
                                                        ⚠ Some data denied by user
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        {/* Additional metadata */}
                                        <div className="mt-2 pt-2 border-t text-[10px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                                            {warranty.submission_ip && <span>IP: {warranty.submission_ip} ({warranty.ip_city || 'N/A'})</span>}
                                            {warranty.exif_lat && <span>Photo GPS: {Number(warranty.exif_lat).toFixed(4)}, {Number(warranty.exif_lng).toFixed(4)}</span>}
                                            {warranty.exif_timestamp && <span>Photo Time: {new Date(warranty.exif_timestamp).toLocaleString()}</span>}
                                            {warranty.device_fingerprint && <span className="font-mono">Fingerprint: {warranty.device_fingerprint}</span>}
                                        </div>
                                    </div>
                                );
                            })()}
                            {showActions && (
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Actions</p>
                                    <div className="flex gap-2">
                                        {(warranty.status === 'pending' || warranty.status === 'pending_vendor') && (
                                            <>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                                    onClick={() => onApprove(warranty.uid || warranty.id)}
                                                    disabled={processingWarranty === (warranty.uid || warranty.id)}
                                                >
                                                    {processingWarranty === (warranty.uid || warranty.id) ? (
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                    ) : (
                                                        <Check className="h-3 w-3" />
                                                    )}
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                    onClick={() => onReject(warranty.uid || warranty.id)}
                                                    disabled={processingWarranty === (warranty.uid || warranty.id)}
                                                >
                                                    {processingWarranty === (warranty.uid || warranty.id) ? (
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                    ) : (
                                                        <X className="h-3 w-3" />
                                                    )}
                                                </Button>
                                            </>
                                        )}
                                        {warranty.status === 'validated' && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => onReject(warranty.uid || warranty.id)}
                                                disabled={processingWarranty === (warranty.uid || warranty.id)}
                                            >
                                                {processingWarranty === (warranty.uid || warranty.id) ? (
                                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                                ) : (
                                                    <X className="h-3 w-3 mr-1" />
                                                )}
                                                Decline
                                            </Button>
                                        )}
                                        {warranty.status === 'rejected' && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight bg-slate-50 px-2 py-1 rounded-md border border-slate-100">Waiting for Resubmission</span>
                                                
                                                {onMoveToPending && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8 text-[10px] font-bold uppercase tracking-tight text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200"
                                                        onClick={() => onMoveToPending(warranty.uid || warranty.id)}
                                                        disabled={processingWarranty === (warranty.uid || warranty.id)}
                                                    >
                                                        {processingWarranty === (warranty.uid || warranty.id) ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                            <RefreshCw className="h-3 w-3 mr-1" />
                                                        )}
                                                        Move to Pending
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                );
            })}


            {/* Details Sheet (Desktop & Mobile) - only when not in split screen */}
            {!isSplitScreen && (
                <WarrantySpecSheet
                    isOpen={!!selectedWarranty}
                    onClose={() => setSelectedWarranty(null)}
                    warranty={selectedWarranty}
                    isMobile={false} // Adapted for unified view
                    isAdmin={true}
                    onRefresh={onRefresh}
                    onApprove={onApprove}
                    onReject={onReject}
                    onMoveToPending={onMoveToPending}
                    processingWarranty={processingWarranty}
                />
            )}
        </div >
    );
};
