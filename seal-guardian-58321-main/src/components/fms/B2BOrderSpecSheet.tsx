import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { 
    Download, 
    XCircle, 
    Loader2, 
    CheckCircle2, 
    Package, 
    Clock, 
    Truck, 
    Ban, 
    Building2, 
    MapPin, 
    Phone, 
    Mail, 
    FileText 
} from "lucide-react";

interface B2BOrderSpecSheetProps {
    isOpen: boolean;
    onClose: () => void;
    order: any;
    onConfirm?: (orderId: string) => Promise<void> | void;
    onCancel?: (orderId: string) => Promise<void> | void;
    onDownloadPDF?: (orderId: string) => Promise<void> | void;
    confirmingId?: string | null;
    cancellingId?: string | null;
    productImages?: Record<string, string[]>;
    isIncoming?: boolean;
}

const SpecRow = ({ label, value, mono = false }: { label: string; value: string | React.ReactNode; mono?: boolean }) => {
    return (
        <div className="flex justify-between items-center py-3 border-b border-orange-100 last:border-0 hover:bg-orange-50/50 px-3 rounded-lg transition-colors">
            <span className="text-sm text-muted-foreground font-medium whitespace-nowrap mr-4">{label}</span>
            <span className={cn("text-sm text-foreground font-semibold text-right", mono && "font-mono tracking-tight")}>{value || "N/A"}</span>
        </div>
    );
};

const LocalStatusBadge = ({ status }: { status: string }) => {
    const config: Record<string, { label: string; icon: any; className: string }> = {
        pending:    { label: 'Pending',    icon: Clock,         className: 'bg-amber-50 text-amber-700 border-amber-200' },
        processing: { label: 'Confirmed',  icon: CheckCircle2,  className: 'bg-blue-50 text-blue-700 border-blue-200' },
        shipped:    { label: 'Shipped',    icon: Truck,         className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
        delivered:  { label: 'Delivered',  icon: CheckCircle2,  className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
        cancelled:  { label: 'Cancelled',  icon: Ban,           className: 'bg-rose-50 text-rose-700 border-rose-200' },
    };
    const c = config[status] || config.pending;
    const Icon = c.icon;
    return (
        <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border shadow-sm', c.className)}>
            <Icon className="w-3 h-3" />
            {c.label}
        </span>
    );
};

const formatOrderId = (orderId: string) => (orderId?.startsWith('AFI') ? orderId : orderId.slice(0, 8).toUpperCase());

const hasMeaningfulOrderText = (value?: string | null) => {
    if (typeof value !== 'string') return false;
    const normalized = value.trim();
    return normalized !== '' && normalized !== '0';
};

export const B2BOrderSpecSheet = ({
    isOpen,
    onClose,
    order,
    onConfirm,
    onCancel,
    onDownloadPDF,
    confirmingId,
    cancellingId,
    productImages = {},
    isIncoming = true
}: B2BOrderSpecSheetProps) => {

    if (!order) return null;

    const totalQty = order.items?.reduce((s: number, i: any) => s + i.quantity, 0) || 0;
    const canConfirm = order.status === 'pending';
    const canCancel = order.status === 'pending' || order.status === 'processing';

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent side="bottom" className="h-[85vh] rounded-t-[24px] p-0 overflow-hidden flex flex-col bg-white border-t border-orange-200 z-[9999]">
                {/* Header Section */}
                <div className="p-6 pb-4 border-b border-orange-100 bg-gradient-to-r from-orange-50 to-white shrink-0">
                    <div className="w-12 h-1.5 bg-orange-300 rounded-full mx-auto mb-6" /> {/* Drag Handle */}
                    <SheetHeader className="text-left space-y-1">
                        <div className="flex items-center justify-between">
                            <Badge variant="outline" className="uppercase tracking-widest text-[10px] py-0.5 px-2.5 border-orange-200 text-orange-600 bg-orange-50 font-black">
                                {isIncoming ? "Order details" : "Order details"}
                            </Badge>
                            <div className="flex items-center gap-2">
                                <LocalStatusBadge status={order.status} />
                                {onDownloadPDF && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => onDownloadPDF(order.id)}
                                        className="h-7 px-2 text-[10px] uppercase font-bold border-orange-200 text-orange-600 hover:bg-orange-50"
                                    >
                                        <Download className="w-3 h-3 mr-1" /> PDF Order
                                    </Button>
                                )}
                            </div>
                        </div>
                        <SheetTitle className="text-2xl font-bold tracking-tight text-foreground/90 font-mono">
                            #{formatOrderId(order.id)}
                        </SheetTitle>
                        <SheetDescription className="text-muted-foreground font-medium">
                            {isIncoming ? (
                                <>Submitted by <span className="text-slate-800 font-bold">{order.client_store_name || order.vendor_name || 'Franchise Partner'}</span></>
                            ) : (
                                <>Submitted to <span className="text-slate-800 font-bold">{order.distributor_name || 'Distributor'}</span></>
                            )}
                        </SheetDescription>
                    </SheetHeader>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Order Items */}
                    <div className="space-y-1">
                        <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                            <div className="w-1.5 h-4 bg-gradient-to-b from-orange-500 to-orange-400 rounded-full" />
                            Order Items
                        </h4>
                        <div className="space-y-2">
                            {order.items?.map((item: any) => {
                                const img = item.product_id ? productImages[item.product_id]?.[0] : null;
                                return (
                                    <div key={item.id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-orange-100 shadow-sm hover:bg-orange-50/20 transition-colors">
                                        <div className="w-12 h-12 bg-slate-50 border border-slate-100 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                                            {img ? (
                                                <img src={img} alt={item.product_name} className="object-contain w-full h-full p-1" />
                                            ) : (
                                                <Package className="w-6 h-6 text-slate-300" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-slate-800 truncate">{item.product_name}</p>
                                            {hasMeaningfulOrderText(item.variation_name) && (
                                                <p className="text-xs text-slate-400 truncate">{item.variation_name}</p>
                                            )}
                                            {item.car_label && <p className="text-xs font-semibold text-slate-600 truncate">{item.car_label}</p>}
                                            {item.needs_customization && (
                                                <p className="text-[10px] text-blue-600 font-black mt-0.5">✨ Custom Logo / Personalization</p>
                                            )}
                                            {item.customization_remarks && (
                                                <p className="text-[10px] text-slate-500 italic mt-0.5">Remark: {item.customization_remarks}</p>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0 ml-2">
                                            <span className="text-sm font-black text-slate-800">× {item.quantity}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Partner/Distributor Details */}
                    <div className="space-y-1">
                        <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                            <div className="w-1.5 h-4 bg-gradient-to-b from-orange-500 to-orange-400 rounded-full" />
                            {isIncoming ? "Franchise Partner" : "Assigned Distributor"}
                        </h4>
                        <div className="bg-white rounded-xl p-2 border border-orange-100 shadow-sm">
                            {isIncoming ? (
                                <>
                                    <SpecRow label="Store Name" value={order.client_store_name || "N/A"} />
                                    <SpecRow label="Contact Person" value={order.vendor_name || "N/A"} />
                                    {order.vendor_phone && (
                                        <SpecRow 
                                            label="Phone Number" 
                                            value={
                                                <a href={`tel:${order.vendor_phone}`} className="text-orange-600 hover:underline flex items-center gap-1.5 justify-end">
                                                    <Phone className="w-3.5 h-3.5" /> {order.vendor_phone}
                                                </a>
                                            } 
                                        />
                                    )}
                                    {order.client_store_email && (
                                        <SpecRow 
                                            label="Email Address" 
                                            value={
                                                <a href={`mailto:${order.client_store_email}`} className="text-orange-600 hover:underline flex items-center gap-1.5 justify-end">
                                                    <Mail className="w-3.5 h-3.5" /> {order.client_store_email}
                                                </a>
                                            } 
                                        />
                                    )}
                                </>
                            ) : (
                                <>
                                    <SpecRow label="Distributor Name" value={order.distributor_name || "N/A"} />
                                    {order.distributor_phone && (
                                        <SpecRow 
                                            label="Phone Number" 
                                            value={
                                                <a href={`tel:${order.distributor_phone}`} className="text-orange-600 hover:underline flex items-center gap-1.5 justify-end">
                                                    <Phone className="w-3.5 h-3.5" /> {order.distributor_phone}
                                                </a>
                                            } 
                                        />
                                    )}
                                    {order.distributor_email && (
                                        <SpecRow 
                                            label="Email Address" 
                                            value={
                                                <a href={`mailto:${order.distributor_email}`} className="text-orange-600 hover:underline flex items-center gap-1.5 justify-end">
                                                    <Mail className="w-3.5 h-3.5" /> {order.distributor_email}
                                                </a>
                                            } 
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* Shipping Address */}
                    <div className="space-y-1">
                        <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                            <div className="w-1.5 h-4 bg-gradient-to-b from-orange-500 to-orange-400 rounded-full" />
                            Shipping Destination
                        </h4>
                        <div className="bg-white rounded-xl p-2 border border-orange-100 shadow-sm">
                            <SpecRow label="Street Address" value={order.shipping_address} />
                            <SpecRow label="City & State" value={`${order.shipping_city}, ${order.shipping_state}`} />
                            <SpecRow label="Postal Pincode" value={order.shipping_pincode} mono />
                        </div>
                    </div>

                    {/* Order Meta */}
                    <div className="space-y-1">
                        <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                            <div className="w-1.5 h-4 bg-gradient-to-b from-orange-500 to-orange-400 rounded-full" />
                            Summary Information
                        </h4>
                        <div className="bg-white rounded-xl p-2 border border-orange-100 shadow-sm">
                            <SpecRow label="Submission Date" value={new Date(order.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} />
                            <SpecRow label="Total Items Types (SKUs)" value={order.items?.length || 0} />
                            <SpecRow label="Total Ordered Units" value={totalQty} />
                            {order.docket_id && (
                                <SpecRow label="Docket ID" value={order.docket_id} mono />
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer Buttons */}
                <div className="p-4 border-t border-orange-100 bg-gradient-to-r from-orange-50/50 to-white flex gap-3 shrink-0">
                    {onConfirm && canConfirm && (
                        <Button
                            className="flex-1 h-11 font-semibold bg-green-600 hover:bg-green-700 text-white rounded-xl gap-2 shadow-md shadow-green-100 transition-all duration-200"
                            onClick={() => {
                                onConfirm(order.id);
                                onClose();
                            }}
                            disabled={confirmingId === order.id}
                        >
                            {confirmingId === order.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <CheckCircle2 className="h-4 w-4" />
                            )}
                            Confirm & Allocate Stock
                        </Button>
                    )}
                    {onCancel && canCancel && (
                        <Button
                            className="flex-1 h-11 font-semibold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl gap-2 transition-all duration-200"
                            variant="outline"
                            onClick={() => {
                                onCancel(order.id);
                                onClose();
                            }}
                            disabled={cancellingId === order.id}
                        >
                            {cancellingId === order.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <XCircle className="h-4 w-4" />
                            )}
                            Decline Order
                        </Button>
                    )}
                    <Button 
                        className="flex-1 h-11 text-base font-semibold border-2 border-orange-200 text-orange-600 bg-white hover:bg-orange-50 hover:border-orange-300 transition-all rounded-xl shadow-sm" 
                        onClick={onClose} 
                        variant="outline"
                        disabled={confirmingId === order.id || cancellingId === order.id}
                    >
                        Done
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
};
