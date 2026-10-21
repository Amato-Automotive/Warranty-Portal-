import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { 
    RotateCw, 
    CheckCircle2, 
    AlertTriangle, 
    Loader2, 
    ExternalLink, 
    FileText, 
    User, 
    Phone, 
    Mail, 
    Store,
    Smartphone,
    Car,
    Clock,
    ShieldAlert,
    MapPin,
    Wifi,
    Layers
} from "lucide-react";
import { cn, formatToIST } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Save, X, Upload } from "lucide-react";
import { WarrantyRemarks } from "@/components/admin/WarrantyRemarks";
import { vehicleNumberOf } from "@/lib/vehicleNumber";

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


interface QuickReviewPanelProps {
    warranty: any;
    onApprove: (uid: string) => Promise<void> | void;
    onReject: (uid: string) => Promise<void> | void;
    processingWarranty?: string | null;
    /** Reload the list after an edit, so the row matches what was saved. */
    onRefresh?: () => void;
}

export const QuickReviewPanel = ({
    warranty,
    onApprove,
    onReject,
    processingWarranty,
    onRefresh
}: QuickReviewPanelProps) => {
    const { toast } = useToast();
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [products, setProducts] = useState<any[]>([]);
    const [editData, setEditData] = useState<any>({});
    /** Which image slot is mid-upload, so only that card shows a spinner. */
    const [uploadingField, setUploadingField] = useState<string | null>(null);
    const [rotations, setRotations] = useState<Record<string, number>>({});
    const [actionLoading, setActionLoading] = useState<'approve' | 'reject' | null>(null);
    const [zoomState, setZoomState] = useState<{
        key: string;
        url: string;
        label: string;
        mouseX: number;
        mouseY: number;
        containerWidth: number;
        containerHeight: number;
    } | null>(null);

    // Reset rotations when the active warranty changes
    useEffect(() => {
        setRotations({});
        setActionLoading(null);
        setZoomState(null);
    }, [warranty]);

    /* Editing here mirrors the spec sheet's edit on the pending and approved
       tabs: same fields, same endpoint. Quick Review is where most reviewing
       actually happens, so a wrong name or registration had to be fixed by
       leaving the tab and finding the warranty again. */

    // Selecting a different warranty must not carry an open edit across to it.
    useEffect(() => {
        setIsEditing(false);
    }, [warranty?.uid, warranty?.id]);

    /**
     * The rolls this registration draws on, and whether anyone has used those
     * serials before.
     *
     * Fetched per warranty rather than carried in the list: it needs a count
     * across every other registration on each roll, which would be a join too
     * far for a page of warranties where most are seat covers.
     */
    const [rollContext, setRollContext] = useState<any[]>([]);
    const [capacity, setCapacity] = useState(250);

    useEffect(() => {
        const uid = warranty?.uid;
        if (!uid || warranty?.product_type === 'seat-cover') {
            setRollContext([]);
            return;
        }

        let cancelled = false;
        api.get(`/admin/warranties/${encodeURIComponent(uid)}/roll-context`)
            .then(res => {
                if (cancelled || !res.data.success) return;
                setRollContext(res.data.rolls || []);
                setCapacity(res.data.capacity ?? 250);
            })
            // A warranty filed before rolls were tracked has none; that is not
            // an error worth interrupting the reviewer over.
            .catch(() => { if (!cancelled) setRollContext([]); });

        return () => { cancelled = true; };
    }, [warranty?.uid, warranty?.product_type]);

    useEffect(() => {
        if (isEditing && products.length === 0) {
            api.get('/public/products')
                .then(res => { if (res.data.success) setProducts(res.data.products); })
                .catch(err => console.error("Failed to load products", err));
        }
        if (isEditing && warranty) {
            const pd = typeof warranty.product_details === 'string'
                ? JSON.parse(warranty.product_details || '{}')
                : warranty.product_details || {};
            setEditData({
                customer_name: warranty.customer_name || pd.customerName || '',
                customer_email: warranty.customer_email || pd.customerEmail || '',
                customer_phone: warranty.customer_phone || pd.customerPhone || '',
                car_make: warranty.car_make || '',
                car_model: warranty.car_model || '',
                registration_number: warranty.registration_number || pd.carRegistration || '',
                product_name: pd.product || pd.productName || '',
                warranty_type: warranty.warranty_type || '',
                purchase_date: warranty.purchase_date ? new Date(warranty.purchase_date).toISOString().split('T')[0] : '',
                // Editable identifiers: UID (seat covers) and Serial Number (PPF/EV).
                new_uid: warranty.uid || pd.uid || '',
                serial_number: pd.serialNumber || warranty.uid || ''
            });
        }
    }, [isEditing, warranty]);

    if (!warranty) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-slate-50 border rounded-3xl border-orange-100/50 min-h-[400px]">
                <Car className="h-12 w-12 text-slate-300 mb-4 animate-bounce" />
                <h3 className="text-lg font-bold text-slate-700">No Warranty Selected</h3>
                <p className="text-sm text-slate-400 max-w-xs mt-1">
                    Select a warranty registration from the list to start reviewing details instantly.
                </p>
            </div>
        );
    }

    const productDetails = typeof warranty.product_details === 'string'
        ? JSON.parse(warranty.product_details || '{}')
        : warranty.product_details || {};

    const toTitleCase = (str: string) => {
        if (!str) return str;
        return str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
    };

    // Extract Invoice File
    const invoiceFile = warranty.product_type === 'ev-products'
        ? productDetails.photos?.warranty
        : productDetails.invoiceFileName;
    const isInvoicePdf = typeof invoiceFile === 'string' && invoiceFile.toLowerCase().endsWith('.pdf');
    const invoiceUrl = invoiceFile 
        ? (typeof invoiceFile === 'string' && invoiceFile.startsWith('http') ? invoiceFile : `http://localhost:3000/uploads/${invoiceFile}`)
        : null;

    // Gather Photos
    const photosList: { key: string; label: string; url: string }[] = [];
    if (productDetails.photos) {
        const photoKeys = warranty.product_type === 'seat-cover' 
            ? [{ key: 'seatCover', label: 'Seat Cover' }, { key: 'vehicle', label: 'Car Exterior' }, { key: 'carOuter', label: 'Car Outer' }]
            : [{ key: 'lhs', label: 'LHS View' }, { key: 'rhs', label: 'RHS View' }, { key: 'frontReg', label: 'Front Reg' }, { key: 'backReg', label: 'Back Reg' }];

        photoKeys.forEach(({ key, label }) => {
            const raw = productDetails.photos[key];
            if (raw) {
                photosList.push({
                    key,
                    label,
                    url: typeof raw === 'string' && raw.startsWith('http') ? raw : `http://localhost:3000/uploads/${raw}`
                });
            }
        });
    }

    const handleRotate = (key: string) => {
        setRotations(prev => ({
            ...prev,
            [key]: ((prev[key] || 0) + 90) % 360
        }));
    };

    const handleMouseMove = (
        e: React.MouseEvent<HTMLDivElement>, 
        key: string, 
        url: string, 
        label: string
    ) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setZoomState({
            key,
            url,
            label,
            mouseX: e.clientX - rect.left,
            mouseY: e.clientY - rect.top,
            containerWidth: rect.width,
            containerHeight: rect.height
        });
    };

    const getImageTransformStyle = (key: string) => {
        const angle = rotations[key] || 0;
        // If rotated 90 or 270 degrees, scale the image down so its height fits inside the landscape grid box
        const scale = angle % 180 !== 0 ? "scale(0.7)" : "scale(1)";
        return `rotate(${angle}deg) ${scale}`;
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await api.put(`/admin/warranties/${warranty.uid}/details`, editData);
            if (res.data.success) {
                toast({ title: "Success", description: "Warranty details updated" });
                setIsEditing(false);
                onRefresh?.();
            }
        } catch (err: any) {
            toast({ title: "Error", description: getErrorMessage(err, "Failed to update details"), variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    /**
     * Swap one image. Sent on its own rather than bundled into Save, because an
     * admin replacing a blurred photo usually changes nothing else, and waiting
     * for a form submit to see whether the new picture is any better is worse.
     */
    const handleReplaceImage = async (field: string, file: File) => {
        if (!file) return;
        setUploadingField(field);
        try {
            const form = new FormData();
            form.append('field', field);
            form.append('image', file);
            const res = await api.put(`/admin/warranties/${warranty.uid}/photo`, form, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (res.data.success) {
                toast({ title: "Image replaced", description: "The new image has been saved." });
                onRefresh?.();
            }
        } catch (err: any) {
            toast({
                title: "Upload failed",
                description: getErrorMessage(err, "Could not replace the image"),
                variant: "destructive"
            });
        } finally {
            setUploadingField(null);
        }
    };

    const handleAction = async (type: 'approve' | 'reject') => {
        setActionLoading(type);
        try {
            if (type === 'approve') {
                await onApprove(warranty.uid || warranty.id);
            } else {
                await onReject(warranty.uid || warranty.id);
            }
        } catch (err) {
            console.error("Action execution failed", err);
        } finally {
            setActionLoading(null);
        }
    };

    const isProcessing = processingWarranty === (warranty.uid || warranty.id) || actionLoading !== null;

    const lensSize = 48;
    const S = 4;
    let lensX = 0;
    let lensY = 0;
    let lensCenterX = 0;
    let lensCenterY = 0;
    let rX = 0.5;
    let rY = 0.5;
    let angle = 0;
    let fitScale = 1.0;

    if (zoomState) {
        const cw = zoomState.containerWidth || 1;
        const ch = zoomState.containerHeight || 1;
        
        lensX = Math.max(0, Math.min(zoomState.mouseX - lensSize / 2, cw - lensSize));
        lensY = Math.max(0, Math.min(zoomState.mouseY - lensSize / 2, ch - lensSize));
        
        lensCenterX = lensX + lensSize / 2;
        lensCenterY = lensY + lensSize / 2;
        
        rX = cw > 0 ? lensCenterX / cw : 0.5;
        rY = ch > 0 ? lensCenterY / ch : 0.5;
        
        angle = rotations[zoomState.key] || 0;
        fitScale = angle % 180 !== 0 ? 0.7 : 1.0;
    }

    /* One definition for all four image slots (two photo rows, extra photos and
       the invoice), so the replace control behaves identically everywhere. */
    const ReplaceButton = ({ field }: { field: string }) => {
        if (!isEditing) return null;
        const busy = uploadingField === field;
        return (
            <label
                title="Replace this image"
                className={cn(
                    "absolute top-2 right-12 h-8 px-2.5 rounded-full shadow-md bg-white/90 hover:bg-white",
                    "text-slate-700 inline-flex items-center gap-1 text-[10px] font-bold uppercase z-10",
                    busy ? "cursor-wait opacity-80" : "cursor-pointer"
                )}
            >
                {busy
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Upload className="h-3.5 w-3.5" />}
                {busy ? "Saving" : "Replace"}
                <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={busy}
                    onChange={e => {
                        const file = e.target.files?.[0];
                        // Reset the input so picking the same file twice still fires.
                        e.target.value = '';
                        if (file) handleReplaceImage(field, file);
                    }}
                />
            </label>
        );
    };

    return (
        <Card className="h-full border-orange-100 shadow-sm flex flex-col bg-white rounded-3xl relative">
            {/* Zoom Overlay (rendered to the left) */}
            {zoomState && (
                <div className="absolute right-full mr-6 top-0 w-[80%] aspect-square bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl z-50 p-4 overflow-hidden flex flex-col pointer-events-none animate-in fade-in zoom-in-95 duration-200">
                    <div className="pb-2 mb-2 border-b border-slate-800 flex justify-between items-center shrink-0">
                        <span className="text-xs font-black uppercase tracking-wider text-slate-400">{zoomState.label} (Zoomed Preview)</span>
                    </div>
                    <div className="flex-1 relative overflow-hidden bg-slate-950 rounded-xl">
                        <div 
                            style={{
                                position: 'absolute',
                                left: `calc(50% - ${lensCenterX * S}px)`,
                                top: `calc(50% - ${lensCenterY * S}px)`,
                                width: `${zoomState.containerWidth * S}px`,
                                height: `${zoomState.containerHeight * S}px`,
                                transformOrigin: `${rX * 100}% ${rY * 100}%`,
                                transform: `rotate(${angle}deg) scale(${fitScale})`,
                            }}
                        >
                            <img 
                                src={zoomState.url} 
                                alt={zoomState.label} 
                                className="w-full h-full object-contain"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Header info */}
            <div className="p-5 border-b border-orange-50 bg-gradient-to-r from-orange-50/30 to-white flex items-center justify-between gap-4 flex-shrink-0 rounded-t-3xl">
                <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <Badge className="font-bold text-[10px] uppercase bg-orange-100 text-orange-700 hover:bg-orange-100 border-none px-2 py-0.5">
                            {warranty.product_type === 'seat-cover' ? 'Seat Cover' : 'PPF / SPF'}
                        </Badge>
                        <Badge variant={warranty.status === 'validated' ? 'default' : 'secondary'} className={cn(
                            "capitalize font-bold text-[10px]",
                            warranty.status === 'validated' && "bg-green-100 text-green-700 hover:bg-green-100 border-green-200",
                            warranty.status === 'pending' && "bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200",
                            warranty.status === 'pending_vendor' && "bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-200",
                            warranty.status === 'rejected' && "bg-red-100 text-red-700 hover:bg-red-100 border-red-200"
                        )}>
                            {warranty.status === 'validated' ? 'Approved' :
                                warranty.status === 'pending_vendor' ? 'Waiting Vendor' :
                                    warranty.status === 'pending' ? 'Pending' : 'Action Required'}
                        </Badge>
                    </div>
                    <div className="mt-1 flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-1 text-slate-800">
                        <h3 className="text-base font-extrabold uppercase tracking-tight leading-none flex items-center gap-1.5 min-w-0">
                            <User className="h-4 w-4 text-orange-500 shrink-0" />
                            <span className="truncate">{toTitleCase(warranty.customer_name || productDetails.customerName || 'N/A')}</span>
                        </h3>
                        <span className="hidden sm:inline text-slate-300">|</span>
                        <span className="text-xs font-bold text-slate-500 flex items-center gap-1 shrink-0">
                            <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            {warranty.customer_phone || productDetails.customerPhone || 'N/A'}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    {isEditing ? (
                        /* Save leads, Cancel is the quiet way out — and the pair sits
                           apart from the read-only badges so they never look related. */
                        <div className="flex items-center gap-2 pr-3 border-r border-orange-100">
                            <Button
                                size="sm" variant="ghost"
                                className="h-9 px-3 text-xs font-bold text-slate-500 hover:text-slate-700"
                                onClick={() => setIsEditing(false)}
                                disabled={saving}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                className="h-9 px-4 text-xs font-bold bg-orange-500 hover:bg-orange-600 shadow-sm"
                                onClick={handleSave}
                                disabled={saving}
                            >
                                {saving
                                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving</>
                                    : <><Save className="h-3.5 w-3.5 mr-1.5" /> Save changes</>}
                            </Button>
                        </div>
                    ) : (
                        <Button
                            size="sm" variant="outline"
                            className="h-9 px-3 text-xs font-bold text-orange-600 border-orange-200 hover:bg-orange-50"
                            onClick={() => setIsEditing(true)}
                            disabled={isProcessing}
                        >
                            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                        </Button>
                    )}
                    {warranty.fraud_score !== undefined && warranty.fraud_score !== null && (
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button 
                                    variant="outline"
                                    size="sm"
                                    className={cn(
                                        "h-9 rounded-xl border text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer hover:scale-102 active:scale-98",
                                        warranty.fraud_score >= 80 ? "bg-green-50/50 hover:bg-green-100/50 text-green-700 border-green-200" :
                                        warranty.fraud_score >= 40 ? "bg-yellow-50/50 hover:bg-yellow-100/50 text-yellow-700 border-yellow-200" :
                                        "bg-red-50/50 hover:bg-red-100/50 text-red-700 border-red-200"
                                    )}
                                    title="Click to view trust score breakdown"
                                >
                                    <ShieldAlert className="h-4 w-4 shrink-0" />
                                    <span>Trust: {warranty.fraud_score}%</span>
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 md:w-[450px] p-4 rounded-3xl border-orange-100 shadow-xl overflow-hidden bg-white z-50" align="end">
                                {(() => {
                                    const flags = typeof warranty.fraud_flags === 'string' ? JSON.parse(warranty.fraud_flags || '{}') : (warranty.fraud_flags || {});
                                    return (
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between border-b pb-2">
                                                <h4 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                                                    <ShieldAlert className="h-4 w-4 text-orange-500" />
                                                    Fraud Analysis Details
                                                </h4>
                                                <Badge className={cn(
                                                    "font-bold text-xs px-2 py-0.5 hover:opacity-100",
                                                    warranty.fraud_score >= 80 ? "bg-green-100 text-green-700 border-none" :
                                                    warranty.fraud_score >= 40 ? "bg-yellow-100 text-yellow-700 border-none" :
                                                    "bg-red-100 text-red-700 border-none"
                                                )}>
                                                    Trust Score: {warranty.fraud_score || 0}%
                                                </Badge>
                                            </div>
                                            
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                                {/* Distance Penalty */}
                                                <div className={cn("p-2.5 rounded-xl border", flags.distance_penalty >= 50 ? "bg-red-50/50 border-red-100" : flags.distance_penalty > 0 ? "bg-yellow-50/50 border-yellow-100" : "bg-green-50/30 border-green-100")}>
                                                    <div className="flex items-center gap-1.5 mb-1 text-slate-500 font-semibold">
                                                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                                                        <span>Distance Penalty</span>
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
                                                            <p className={cn("text-sm font-extrabold", flags.distance_penalty >= 50 ? "text-red-600" : flags.distance_penalty > 0 ? "text-yellow-700" : "text-green-600")}>
                                                                -{flags.distance_penalty || 0} pts <span className="text-xs font-normal opacity-85">{distanceText}</span>
                                                            </p>
                                                        );
                                                    })()}
                                                    <p className="text-[10px] text-slate-400 mt-1">
                                                        {flags.distance_penalty === 0 || !flags.distance_penalty ? '✓ Within Store Range' : flags.distance_penalty >= 50 ? '❌ Outside Area' : '⚠ Warning'}
                                                    </p>
                                                </div>

                                                {/* Time Penalty */}
                                                <div className={cn("p-2.5 rounded-xl border", flags.time_penalty >= 40 ? "bg-red-50/50 border-red-100" : flags.time_penalty > 0 ? "bg-yellow-50/50 border-yellow-100" : "bg-green-50/30 border-green-100")}>
                                                    <div className="flex items-center gap-1.5 mb-1 text-slate-500 font-semibold">
                                                        <Clock className="h-3.5 w-3.5 shrink-0" />
                                                        <span>Time Penalty</span>
                                                    </div>
                                                    <p className={cn("text-sm font-extrabold", flags.time_penalty >= 40 ? "text-red-600" : flags.time_penalty > 0 ? "text-yellow-700" : "text-green-600")}>
                                                        -{flags.time_penalty || 0} pts
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 mt-1">
                                                        {flags.time_penalty === 0 || !flags.time_penalty ? '✓ Immediate' : flags.time_penalty >= 40 ? '❌ Delayed' : '⚠ Review Delay'}
                                                    </p>
                                                </div>

                                                {/* IP Penalty */}
                                                <div className={cn("p-2.5 rounded-xl border", flags.ip_penalty > 0 ? "bg-yellow-50/50 border-yellow-100" : "bg-green-50/30 border-green-100")}>
                                                    <div className="flex items-center gap-1.5 mb-1 text-slate-500 font-semibold">
                                                        <Wifi className="h-3.5 w-3.5 shrink-0" />
                                                        <span>IP Penalty</span>
                                                    </div>
                                                    <p className={cn("text-sm font-extrabold", flags.ip_penalty > 0 ? "text-yellow-700" : "text-green-600")}>
                                                        -{flags.ip_penalty || 0} pts
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 mt-1">
                                                        {flags.ip_penalty === 0 || !flags.ip_penalty ? '✓ Matched IP' : '⚠ Region Mismatch'}
                                                    </p>
                                                </div>

                                                {/* Consistency Penalty */}
                                                <div className={cn("p-2.5 rounded-xl border", flags.consistency_penalty >= 40 ? "bg-red-50/50 border-red-100" : flags.consistency_penalty > 0 ? "bg-yellow-50/50 border-yellow-100" : "bg-green-50/30 border-green-100")}>
                                                    <div className="flex items-center gap-1.5 mb-1 text-slate-500 font-semibold">
                                                        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                                                        <span>Consistency</span>
                                                    </div>
                                                    <p className={cn("text-sm font-extrabold", flags.consistency_penalty >= 40 ? "text-red-600" : flags.consistency_penalty > 0 ? "text-yellow-700" : "text-green-600")}>
                                                        -{flags.consistency_penalty || 0} pts
                                                    </p>
                                                    <div className="text-[10px] text-slate-400 mt-1 space-y-0.5">
                                                        {flags.multi_device_detected && <p className="text-red-500 font-bold">❌ Multiple Devices</p>}
                                                        {flags.location_mismatch && <p className="text-red-500 font-bold">❌ Location Mismatch</p>}
                                                        {!flags.multi_device_detected && !flags.location_mismatch && <p>✓ All match</p>}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* System Info & Metadata */}
                                            <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-3 space-y-2 text-xs">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-slate-500 font-medium">Platform:</span>
                                                    <span className="font-bold text-slate-700 capitalize">{flags.device_category || 'Unknown'}</span>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-slate-500 font-medium">Source:</span>
                                                    <span className="font-bold text-slate-700">{productDetails.submissionSource || (warranty.manpower_id ? 'Franchise Dashboard' : 'Customer / QR')}</span>
                                                </div>
                                                {flags.is_missing_data && (
                                                    <p className="text-[10px] text-red-500 font-bold italic text-center">
                                                        ⚠ Some data denied by user
                                                    </p>
                                                )}
                                            </div>

                                            {/* Additional Metadata Footer */}
                                            <div className="pt-2 border-t border-slate-100 text-[10px] text-slate-400 font-mono space-y-1">
                                                {warranty.submission_ip && (
                                                    <div className="flex justify-between">
                                                        <span>IP Address:</span>
                                                        <span className="font-bold">{warranty.submission_ip} ({warranty.ip_city || 'N/A'})</span>
                                                    </div>
                                                )}
                                                {warranty.exif_lat && (
                                                    <div className="flex justify-between">
                                                        <span>Photo GPS:</span>
                                                        <span className="font-bold">{Number(warranty.exif_lat).toFixed(4)}, {Number(warranty.exif_lng).toFixed(4)}</span>
                                                    </div>
                                                )}
                                                {warranty.exif_timestamp && (
                                                    <div className="flex justify-between">
                                                        <span>Photo Time:</span>
                                                        <span className="font-bold">{new Date(warranty.exif_timestamp).toLocaleString()}</span>
                                                    </div>
                                                )}
                                                {warranty.device_fingerprint && (
                                                    <div className="flex flex-col mt-1">
                                                        <span>Fingerprint:</span>
                                                        <span className="font-bold truncate text-[9px] bg-slate-50 px-1 py-0.5 rounded border">{warranty.device_fingerprint}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </PopoverContent>
                        </Popover>
                    )}

                    <div className="text-right">
                        <span className="text-xs text-slate-400 font-bold block">WARRANTY TYPE</span>
                        <span className="text-sm font-black text-orange-600">{warranty.warranty_type || '1 Year'}</span>
                    </div>
                </div>
            </div>

            {/* Customer fields while editing.
                Their own full-width band under the header — inline beside the badges
                left them about 100px wide, too narrow to read a name in. */}
            {isEditing && (
                <div className="px-5 py-4 border-b border-orange-100 bg-orange-50/40 flex-shrink-0">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                <User className="h-3 w-3 text-orange-500" /> Customer name
                            </label>
                            <Input
                                value={editData.customer_name || ''}
                                onChange={e => setEditData({ ...editData, customer_name: e.target.value })}
                                placeholder="Customer name"
                                className="h-9 text-sm bg-white"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                <Phone className="h-3 w-3 text-slate-400" /> Phone
                            </label>
                            <Input
                                value={editData.customer_phone || ''}
                                onChange={e => setEditData({ ...editData, customer_phone: e.target.value })}
                                placeholder="Phone"
                                className="h-9 text-sm bg-white font-mono"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Main content split */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                
                {/* Rejection banner */}
                {warranty.status === 'rejected' && warranty.rejection_reason && (
                    <div className="bg-red-50/50 border border-red-100 rounded-2xl p-4 flex items-start gap-3 shadow-inner">
                        <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5 animate-pulse" />
                        <div>
                            <p className="text-[10px] font-black text-red-700/50 uppercase tracking-widest mb-1">Previous Rejection Feedback</p>
                            <p className="text-sm font-bold text-red-600 leading-relaxed italic">"{warranty.rejection_reason}"</p>
                        </div>
                    </div>
                )}

                <WarrantyRemarks uid={warranty.uid} />

                {/* Left/Right quick details grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Warranty Details */}
                    <div className="bg-slate-50/50 border border-slate-100 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                            <FileText className="h-4 w-4 text-orange-500" />
                            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Warranty Info</span>
                        </div>
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-slate-450 font-normal w-24 shrink-0">UID:</span>
                                {isEditing ? (
                                    <Input
                                        value={editData.new_uid || ''}
                                        onChange={e => setEditData({ ...editData, new_uid: e.target.value })}
                                        className="h-8 text-sm font-mono bg-white"
                                    />
                                ) : (
                                    <span className="font-mono font-bold text-slate-700">{warranty.uid || 'N/A'}</span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-slate-450 font-normal w-24 shrink-0">Product:</span>
                                {isEditing ? (
                                    <Select
                                        value={editData.product_name || ''}
                                        onValueChange={(val) => {
                                            const selected = products.find((p: any) => p.name === val);
                                            setEditData({
                                                ...editData,
                                                product_name: val,
                                                warranty_type: selected?.warranty_years || editData.warranty_type
                                            });
                                        }}
                                    >
                                        <SelectTrigger className="h-8 text-sm bg-white">
                                            <SelectValue placeholder="Select product" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {products.map((p: any) => (
                                                <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                <span className="font-bold text-slate-700 truncate" title={(() => {
                                    const productNameMapping: Record<string, string> = {
                                        'paint-protection': 'Paint Protection Films',
                                        'sun-protection': 'Sun Protection Films',
                                        'seat-cover': 'Seat Cover',
                                        'ev-products': 'EV Products'
                                    };
                                    const rawProductName = productDetails.product || productDetails.productName || warranty.product_type;
                                    return productNameMapping[rawProductName] || rawProductName || 'N/A';
                                })()}>
                                    {(() => {
                                        const productNameMapping: Record<string, string> = {
                                            'paint-protection': 'Paint Protection Films',
                                            'sun-protection': 'Sun Protection Films',
                                            'seat-cover': 'Seat Cover',
                                            'ev-products': 'EV Products'
                                        };
                                        const rawProductName = productDetails.product || productDetails.productName || warranty.product_type;
                                        const productName = productNameMapping[rawProductName] || rawProductName || 'N/A';
                                        return toTitleCase(productName);
                                    })()}
                                </span>
                                )}
                            </div>
                            {(isEditing || vehicleNumberOf(warranty.registration_number, productDetails.carRegistration)) && (
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-slate-450 font-normal w-24 shrink-0">Reg No:</span>
                                    {isEditing ? (
                                        <Input
                                            value={editData.registration_number || ''}
                                            onChange={e => setEditData({ ...editData, registration_number: e.target.value })}
                                            className="h-8 text-sm font-mono uppercase bg-white"
                                        />
                                    ) : (
                                        <span className="font-mono font-bold text-slate-700 uppercase">{vehicleNumberOf(warranty.registration_number, productDetails.carRegistration)}</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Rolls — PPF only.

                        Nothing pre-registers a roll: the serial the installer
                        types is what creates it, so a mistyped serial opens a
                        fresh roll with a full allowance instead of drawing on
                        the real one. This admin is the only check on that, so
                        a serial nobody has used before is called out here. */}
                    {warranty.product_type !== 'seat-cover' && rollContext.length > 0 && (
                        <div className="bg-slate-50/50 border border-slate-100 rounded-2xl p-4 space-y-3">
                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                <Layers className="h-4 w-4 text-orange-500" />
                                <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
                                    Roll{rollContext.length > 1 ? 's' : ''} Used
                                </span>
                            </div>

                            <div className="space-y-2.5">
                                {rollContext.map((roll) => (
                                    <div key={roll.serialNumber} className="rounded-xl bg-white border border-slate-100 p-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="font-mono font-bold text-sm text-slate-800 truncate">
                                                    {roll.serialNumber}
                                                </p>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    {roll.sqftUsed} sq.ft
                                                    {roll.installArea ? ` · ${roll.installArea}` : ''}
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-xs font-bold text-slate-700">
                                                    {roll.remainingSqft} sq.ft left
                                                </p>
                                                <p className="text-[11px] text-slate-400">
                                                    of {capacity} on this roll
                                                </p>
                                            </div>
                                        </div>

                                        {roll.isFirstUse ? (
                                            <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 mt-2">
                                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                                                <span>
                                                    First use of this serial — no other registration has drawn on it.
                                                    Check it matches the roll before approving.
                                                </span>
                                            </p>
                                        ) : (
                                            <p className="text-[11px] text-slate-400 mt-2">
                                                Also used on {roll.otherDraws} other registration{roll.otherDraws === 1 ? '' : 's'} ({roll.usedElsewhere} sq.ft)
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Store */}
                    <div className="bg-slate-50/50 border border-slate-100 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                            <Store className="h-4 w-4 text-orange-500" />
                            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Installer & Store</span>
                        </div>
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-slate-450 font-normal w-24 shrink-0">Store:</span>
                                {/* The store the warranty is filed under, with its city —
                                    several franchises share a name. The name typed on the
                                    form is only the fallback. */}
                                <span className="font-bold text-slate-700 truncate" title={warranty.vendor_store_name || productDetails.storeName || warranty.installer_name}>
                                    {warranty.vendor_store_name
                                        ? `${warranty.vendor_store_name}${warranty.vendor_city ? ` - ${warranty.vendor_city}` : ''}`
                                        : (productDetails.storeName || warranty.installer_name || 'N/A')}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-slate-450 font-normal w-24 shrink-0">Trust Score:</span>
                                <span className={cn(
                                    "font-mono font-black text-sm",
                                    warranty.fraud_score >= 80 ? "text-green-650" :
                                    warranty.fraud_score >= 40 ? "text-yellow-650" :
                                    "text-red-650"
                                )}>
                                    {warranty.fraud_score || 0}%
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-slate-450 font-normal w-24 shrink-0">City/State:</span>
                                <span className="font-bold text-slate-700 truncate" title={`${warranty.vendor_city || productDetails.storeCity || 'N/A'} / ${warranty.vendor_state || productDetails.storeState || 'N/A'}`}>
                                    {toTitleCase(warranty.vendor_city || productDetails.storeCity || 'N/A')}
                                    {' / '}
                                    {toTitleCase(warranty.vendor_state || productDetails.storeState || 'N/A')}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Photo workspace */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-400 uppercase tracking-wider">Uploaded Documents & Photos</span>
                        <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Registered: {formatToIST(warranty.created_at)}</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {/* Invoice */}
                        <div className="border border-slate-150 rounded-2xl bg-slate-50/50 p-3 flex flex-col h-64 relative overflow-hidden">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2 block">Invoice / MRP Sticker</span>
                            {invoiceUrl ? (
                                isInvoicePdf ? (
                                    <div className="flex-1 flex flex-col items-center justify-center bg-blue-50 text-blue-500 rounded-xl border border-dashed border-blue-200">
                                        <FileText className="h-10 w-10 mb-2" />
                                        <span className="text-xs font-bold text-center px-4">PDF Invoice Document</span>
                                        <Button variant="link" size="sm" className="mt-2 text-xs font-bold text-blue-600" onClick={() => window.open(invoiceUrl, '_blank')}>
                                            View PDF <ExternalLink className="h-3 w-3 ml-1" />
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex-1 relative rounded-xl overflow-hidden bg-slate-900 flex items-center justify-center group cursor-zoom-in"
                                         onMouseMove={(e) => invoiceUrl && !isInvoicePdf && handleMouseMove(e, 'invoice', invoiceUrl, 'Invoice / MRP Sticker')}
                                         onMouseLeave={() => setZoomState(null)}
                                    >
                                        <img 
                                            src={invoiceUrl} 
                                            alt="Invoice File" 
                                            style={{ transform: getImageTransformStyle('invoice') }}
                                            className="w-full h-full object-contain transition-transform duration-300"
                                        />
                                        {zoomState?.key === 'invoice' && (
                                            <div 
                                                style={{ 
                                                    left: `${lensX}px`, 
                                                    top: `${lensY}px`, 
                                                    width: `${lensSize}px`, 
                                                    height: `${lensSize}px` 
                                                }}
                                                className="absolute border-2 border-orange-500 bg-orange-500/10 pointer-events-none z-25 shadow-md backdrop-blur-[0.5px]"
                                            />
                                        )}
                                        {/* Float Rotate Action */}
                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            className="absolute top-2 right-2 h-8 w-8 rounded-full shadow-md bg-white/80 hover:bg-white text-slate-700 opacity-80 group-hover:opacity-100 transition-opacity z-10"
                                            onClick={() => handleRotate('invoice')}
                                            title="Rotate 90 degrees"
                                        >
                                            <RotateCw className="h-4 w-4" />
                                        </Button>
                                        <ReplaceButton field="invoiceFileName" />
                                    </div>
                                )
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center text-slate-300 rounded-xl border border-dashed border-slate-200 relative">
                                    <FileText className="h-10 w-10 mb-1" />
                                    <span className="text-xs font-medium">No invoice uploaded</span>
                                    {isEditing && (
                                        <label className="mt-2 cursor-pointer text-[10px] font-bold uppercase text-orange-600 hover:text-orange-700 inline-flex items-center gap-1">
                                            {uploadingField === 'invoiceFileName'
                                                ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving</>
                                                : <><Upload className="h-3 w-3" /> Upload invoice</>}
                                            <input
                                                type="file" accept="image/*" className="hidden"
                                                disabled={uploadingField === 'invoiceFileName'}
                                                onChange={e => {
                                                    const file = e.target.files?.[0];
                                                    e.target.value = '';
                                                    if (file) handleReplaceImage('invoiceFileName', file);
                                                }}
                                            />
                                        </label>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Remaining Photos */}
                        {photosList.slice(0, 2).map((photo) => (
                            <div key={photo.key} className="border border-slate-150 rounded-2xl bg-slate-50/50 p-3 flex flex-col h-64 relative overflow-hidden">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2 block">{photo.label}</span>
                                <div className="flex-1 relative rounded-xl overflow-hidden bg-slate-900 flex items-center justify-center group cursor-zoom-in"
                                     onMouseMove={(e) => handleMouseMove(e, photo.key, photo.url, photo.label)}
                                     onMouseLeave={() => setZoomState(null)}
                                >
                                    <img 
                                        src={photo.url} 
                                        alt={photo.label} 
                                        style={{ transform: getImageTransformStyle(photo.key) }}
                                        className="w-full h-full object-contain transition-transform duration-300"
                                    />
                                    {zoomState?.key === photo.key && (
                                        <div 
                                            style={{ 
                                                left: `${lensX}px`, 
                                                top: `${lensY}px`, 
                                                width: `${lensSize}px`, 
                                                height: `${lensSize}px` 
                                            }}
                                            className="absolute border-2 border-orange-500 bg-orange-500/10 pointer-events-none z-25 shadow-md backdrop-blur-[0.5px]"
                                        />
                                    )}
                                    {/* Float Rotate Action */}
                                    <Button
                                        size="icon"
                                        variant="secondary"
                                        className="absolute top-2 right-2 h-8 w-8 rounded-full shadow-md bg-white/80 hover:bg-white text-slate-700 opacity-80 group-hover:opacity-100 transition-opacity z-10"
                                        onClick={() => handleRotate(photo.key)}
                                        title="Rotate 90 degrees"
                                    >
                                        <RotateCw className="h-4 w-4" />
                                    </Button>
                                    <ReplaceButton field={photo.key} />
                                </div>
                            </div>
                        ))}
                        
                        {/* Fallback box if fewer than 2 photos are present */}
                        {photosList.length < 2 && Array.from({ length: 2 - photosList.length }).map((_, idx) => (
                            <div key={`fallback-${idx}`} className="border border-dashed border-slate-200 rounded-2xl bg-slate-50/30 p-3 flex flex-col h-64 items-center justify-center text-slate-300">
                                <Smartphone className="h-10 w-10 mb-1" />
                                <span className="text-xs font-medium">Photo not submitted</span>
                            </div>
                        ))}
                    </div>

                    {/* If there are more than 2 photos (PPF / SPF specific), show them in a second row */}
                    {photosList.length > 2 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {photosList.slice(2).map((photo) => (
                                <div key={photo.key} className="border border-slate-150 rounded-2xl bg-slate-50/50 p-3 flex flex-col h-64 relative overflow-hidden">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2 block">{photo.label}</span>
                                    <div className="flex-1 relative rounded-xl overflow-hidden bg-slate-900 flex items-center justify-center group cursor-zoom-in"
                                         onMouseMove={(e) => handleMouseMove(e, photo.key, photo.url, photo.label)}
                                         onMouseLeave={() => setZoomState(null)}
                                    >
                                        <img 
                                            src={photo.url} 
                                            alt={photo.label} 
                                            style={{ transform: getImageTransformStyle(photo.key) }}
                                            className="w-full h-full object-contain transition-transform duration-300"
                                        />
                                        {zoomState?.key === photo.key && (
                                            <div 
                                                style={{ 
                                                    left: `${lensX}px`, 
                                                    top: `${lensY}px`, 
                                                    width: `${lensSize}px`, 
                                                    height: `${lensSize}px` 
                                                }}
                                                className="absolute border-2 border-orange-500 bg-orange-500/10 pointer-events-none z-25 shadow-md backdrop-blur-[0.5px]"
                                            />
                                        )}
                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            className="absolute top-2 right-2 h-8 w-8 rounded-full shadow-md bg-white/80 hover:bg-white text-slate-700 opacity-80 group-hover:opacity-100 transition-opacity z-10"
                                            onClick={() => handleRotate(photo.key)}
                                            title="Rotate 90 degrees"
                                        >
                                            <RotateCw className="h-4 w-4" />
                                        </Button>
                                        <ReplaceButton field={photo.key} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Validation action footer */}
            <div className="p-4 border-t border-orange-50 bg-gradient-to-r from-orange-50/10 to-white flex gap-3 flex-shrink-0 rounded-b-3xl">
                {(warranty.status === 'pending' || warranty.status === 'pending_vendor') ? (
                    <>
                        <Button
                            className="flex-1 h-12 rounded-xl text-sm font-bold bg-green-600 hover:bg-green-700 text-white shadow-sm gap-2"
                            onClick={() => handleAction('approve')}
                            disabled={isProcessing}
                        >
                            {actionLoading === 'approve' ? (
                                <><Loader2 className="h-4 w-4 animate-spin" /> APPROVING...</>
                            ) : (
                                <><CheckCircle2 className="h-4.5 w-4.5" /> APPROVE CLAIM</>
                            )}
                        </Button>

                        <Button
                            className="flex-1 h-12 rounded-xl text-sm font-bold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 shadow-sm gap-2"
                            onClick={() => handleAction('reject')}
                            disabled={isProcessing}
                        >
                            {actionLoading === 'reject' ? (
                                <><Loader2 className="h-4 w-4 animate-spin" /> DECLINING...</>
                            ) : (
                                <><AlertTriangle className="h-4.5 w-4.5" /> DECLINE CLAIM</>
                            )}
                        </Button>
                    </>
                ) : warranty.status === 'validated' ? (
                    /* An approved claim can still be reversed — approvals are
                       sometimes given in error, and the record has to be
                       correctable. The reject dialog collects the reason. */
                    <div className="w-full space-y-2">
                        <div className="text-center py-2 bg-emerald-50 rounded-xl text-xs font-bold text-emerald-600 uppercase tracking-widest">
                            This claim is approved
                        </div>
                        <Button
                            variant="outline"
                            className="w-full h-11 rounded-xl text-sm font-bold text-red-600 border-red-200 hover:bg-red-50 gap-2"
                            onClick={() => handleAction('reject')}
                            disabled={isProcessing}
                        >
                            {actionLoading === 'reject' ? (
                                <><Loader2 className="h-4 w-4 animate-spin" /> REVERSING...</>
                            ) : (
                                <><AlertTriangle className="h-4 w-4" /> REVERSE APPROVAL</>
                            )}
                        </Button>
                        <p className="text-center text-[10px] text-slate-400">
                            The customer has already been told this warranty is active.
                        </p>
                    </div>
                ) : (
                    <div className="w-full text-center py-2 bg-slate-50 rounded-xl text-xs font-bold text-slate-400 uppercase tracking-widest">
                        This claim has already been marked as Action Required.
                    </div>
                )}
            </div>
        </Card>
    );
};
