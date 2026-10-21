import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, FileText, ExternalLink, XCircle, Loader2, Pencil, Save, X, CheckCircle2, AlertTriangle, ZoomIn, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, getWarrantyExpiration, formatToIST } from "@/lib/utils";
import { useState, useEffect, createContext, useContext } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { displaySerial } from "@/lib/ppfRolls";
import { WarrantyRemarks } from "@/components/admin/WarrantyRemarks";

interface WarrantySpecSheetProps {
    isOpen: boolean;
    onClose: () => void;
    warranty: any;
    isMobile?: boolean;
    isAdmin?: boolean;
    onRefresh?: () => void;
    onApprove?: (uid: string) => Promise<void> | void;
    onReject?: (uid: string) => Promise<void> | void;
    /** Send a rejected warranty back for correction and resubmission. */
    onMoveToPending?: (uid: string) => Promise<void> | void;
    processingWarranty?: string | null;
}

const EditContext = createContext<any>(null);

const SpecRow = ({ label, value, mono = false, editField }: { label: string, value: string | React.ReactNode, mono?: boolean, editField?: string }) => {
    const { isEditing, editData, setEditData, products } = useContext(EditContext);

    return (
        <div className="flex justify-between items-center py-3 border-b border-orange-100 last:border-0 hover:bg-orange-50/50 px-3 rounded-lg transition-colors">
            <span className="text-sm text-muted-foreground font-medium whitespace-nowrap mr-4">{label}</span>
            {isEditing && editField ? (
                editField === 'product_name' ? (
                    <Select value={editData.product_name || ''} onValueChange={(val) => {
                        const selected = products.find((p: any) => p.name === val);
                        setEditData({ ...editData, product_name: val, warranty_type: selected?.warranty_years || editData.warranty_type });
                    }}>
                        <SelectTrigger className="w-[200px] h-8 text-sm"><SelectValue placeholder="Select Product" /></SelectTrigger>
                        <SelectContent>
                            {products.map((p: any) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                ) : editField === 'warranty_type' ? (
                    <span className={cn("text-sm text-foreground text-right", mono && "font-mono tracking-tight")}>{editData[editField] || "N/A"}</span>
                ) : (
                    <Input
                        type={editField === 'purchase_date' ? 'date' : 'text'}
                        value={editData[editField] || ''}
                        onChange={e => setEditData({ ...editData, [editField]: e.target.value })}
                        className="w-[200px] h-8 text-sm text-right bg-white"
                    />
                )
            ) : (
                <span className={cn("text-sm text-foreground text-right", mono && "font-mono tracking-tight")}>{value || "N/A"}</span>
            )}
        </div>
    );
};

export const WarrantySpecSheet = ({ isOpen, onClose, warranty, isAdmin, onRefresh, onApprove, onReject, onMoveToPending, processingWarranty }: WarrantySpecSheetProps) => {
    const { toast } = useToast();
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [products, setProducts] = useState<any[]>([]);
    const [editData, setEditData] = useState<any>({});
    const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
    /** Which image slot is mid-upload, so only that thumbnail shows a spinner. */
    const [uploadingField, setUploadingField] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<'approve' | 'reject' | 'pending' | null>(null);

    useEffect(() => {
        if (!isOpen) setIsEditing(false);
    }, [isOpen]);

    useEffect(() => {
        if (isEditing && products.length === 0) {
            api.get('/public/products').then(res => {
                if (res.data.success) setProducts(res.data.products);
            }).catch(err => console.error("Failed to load products", err));
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

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await api.put(`/admin/warranties/${warranty.uid}/details`, editData);
            if (res.data.success) {
                toast({ title: "Success", description: "Warranty details updated" });
                setIsEditing(false);
                if (onRefresh) onRefresh();
            }
        } catch (err: any) {
            toast({ title: "Error", description: getErrorMessage(err, "Failed to update details"), variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    /**
     * Swap one image. Same endpoint the Quick Review panel uses, so a photo
     * replaced from either screen behaves identically.
     *
     * Sent immediately rather than bundled into Save: replacing a blurred photo
     * usually changes nothing else, and the point is to see the new one.
     */
    const handleReplaceImage = async (field: string, file: File) => {
        if (!file || !warranty) return;
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

    /* One overlay for all four thumbnail blocks (seat-cover and PPF, invoice and
       photos), so replacing behaves the same wherever it is used. */
    const ReplaceOverlay = ({ field }: { field: string }) => {
        if (!isEditing || !isAdmin) return null;
        const busy = uploadingField === field;
        return (
            <label
                title="Replace this image"
                onClick={e => e.stopPropagation()}
                className={cn(
                    "absolute inset-x-0 top-0 h-7 z-20 flex items-center justify-center gap-1",
                    "bg-orange-500/90 text-white text-[10px] font-bold uppercase tracking-wide",
                    busy ? "cursor-wait" : "cursor-pointer hover:bg-orange-600"
                )}
            >
                {busy
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving</>
                    : <><Upload className="h-3 w-3" /> Replace</>}
                <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={busy}
                    onChange={e => {
                        const file = e.target.files?.[0];
                        // Reset so choosing the same file twice still fires.
                        e.target.value = '';
                        if (file) handleReplaceImage(field, file);
                    }}
                />
            </label>
        );
    };

    if (!warranty) return null;

    const toTitleCase = (str: string) => {
        if (!str) return str;
        return str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
    };

    const productDetails = typeof warranty.product_details === 'string'
        ? JSON.parse(warranty.product_details || '{}')
        : warranty.product_details || {};

    const productNameMapping: Record<string, string> = {
        'paint-protection': 'Paint Protection Films',
        'sun-protection': 'Sun Protection Films',
    };

    const rawProductName = isEditing ? editData.product_name : (productDetails.product || productDetails.productName || warranty.product_type);
    const productName = productNameMapping[rawProductName || ''] || toTitleCase(rawProductName || '') || 'Unknown Product';



    return (
        <EditContext.Provider value={{ isEditing, editData, setEditData, products }}>
            <Sheet open={isOpen} onOpenChange={onClose}>
                <SheetContent side="bottom" className="h-[85vh] rounded-t-[24px] p-0 overflow-hidden flex flex-col bg-white border-t border-orange-200">
                    {/* Header Section */}
                    <div className="p-6 pb-4 border-b border-orange-100 bg-gradient-to-r from-orange-50 to-white">
                        <div className="w-12 h-1.5 bg-orange-300 rounded-full mx-auto mb-6" /> {/* Drag Handle */}
                        <SheetHeader className="text-left space-y-1">
                            <div className="flex items-center justify-between">
                                <Badge variant="outline" className="uppercase tracking-widest text-[10px] py-0.5 px-2.5 border-orange-200 text-orange-600 bg-orange-50 font-semibold">
                                    Warranty Details
                                </Badge>
                                <div className="flex items-center gap-2">
                                    <Badge variant={warranty.status === 'validated' ? 'default' : 'secondary'} className={cn(
                                        "capitalize shadow-sm font-semibold",
                                        warranty.status === 'validated' && "bg-green-100 text-green-700 hover:bg-green-100 border-green-200",
                                        warranty.status === 'pending' && "bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200",
                                        warranty.status === 'pending_vendor' && "bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200",
                                        warranty.status === 'rejected' && "bg-red-100 text-red-700 hover:bg-red-100 border-red-200"
                                    )}>
                                        {warranty.status === 'validated' ? 'Approved' :
                                            warranty.status === 'pending_vendor' ? 'In Review' :
                                                warranty.status === 'pending' ? 'Pending' :
                                                    warranty.status === 'rejected' ? 'Action Required' :
                                                        warranty.status}
                                    </Badge>
                                    {isAdmin && (
                                        <>
                                            {isEditing ? (
                                                <div className="flex gap-1 ml-2">
                                                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] uppercase font-bold" onClick={() => setIsEditing(false)}>Cancel</Button>
                                                    <Button size="sm" className="h-6 px-2 text-[10px] uppercase font-bold bg-orange-600 hover:bg-orange-700" onClick={handleSave} disabled={saving}>
                                                        {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />} Save
                                                    </Button>
                                                </div>
                                            ) : (
                                                /* Approved warranties are editable too — an
                                                   admin has to be able to correct a mistake
                                                   after approval, not only before it. */
                                                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] uppercase font-bold ml-2 text-orange-600 border-orange-200 hover:bg-orange-50" onClick={() => setIsEditing(true)}>
                                                    <Pencil className="h-3 w-3 mr-1" /> Edit
                                                </Button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                            <SheetTitle className="text-2xl font-bold tracking-tight text-foreground/90">
                                {warranty.registration_number || productDetails.carRegistration || 'N/A'}
                            </SheetTitle>
                            <SheetDescription className="text-muted-foreground font-medium">
                                {(productName || '').replace(/-/g, ' ')} • {warranty.warranty_type} Warranty
                            </SheetDescription>
                        </SheetHeader>
                    </div>

                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {/* Rejection Reason - Highlighted at top if rejected */}
                        {warranty.status === 'rejected' && warranty.rejection_reason && (
                            <div className="animate-in fade-in slide-in-from-top-2 duration-500">
                                <h4 className="text-xs font-bold text-red-500 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                                    <div className="w-1 h-4 bg-red-500 rounded-full" />
                                    Action Required
                                </h4>
                                <div className="bg-red-50/50 border border-red-100 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
                                    <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black text-red-700/50 uppercase tracking-widest mb-1">Reviewer Remarks / Feedback</p>
                                        <p className="text-sm font-bold text-red-600 italic leading-relaxed">{warranty.rejection_reason}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Admin-only: customers and franchises open this same sheet. */}
                        {isAdmin && <WarrantyRemarks uid={warranty.uid} />}

                        {/* Product & Car Details */}
                        <div className="space-y-1">
                            <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                                <div className="w-1 h-4 bg-gradient-to-b from-orange-500 to-orange-400 rounded-full" />
                                Vehicle & Product
                            </h4>
                            <div className="bg-white rounded-xl p-2 border border-orange-100 shadow-sm">
                                <SpecRow label="Registration Number" value={warranty.registration_number || productDetails.carRegistration || "N/A"} mono editField="registration_number" />
                                {(warranty.car_make && String(warranty.car_make).toLowerCase() !== 'null' || warranty.car_model && String(warranty.car_model).toLowerCase() !== 'null') && (
                                    <>
                                        <SpecRow label="Car Make" value={toTitleCase(warranty.car_make || '')} editField="car_make" />
                                        <SpecRow label="Car Model" value={toTitleCase(warranty.car_model || '')} editField="car_model" />
                                    </>
                                )}
                                {warranty.product_type !== 'seat-cover' && (warranty.car_colour || productDetails.carColour) && (
                                    <SpecRow label="Vehicle Colour" value={toTitleCase(warranty.car_colour || productDetails.carColour)} editField="car_colour" />
                                )}
                                {warranty.product_type !== 'seat-cover' && (warranty.car_year || productDetails.carYear) && (
                                    <SpecRow label="Vehicle Year" value={warranty.car_year || productDetails.carYear} />
                                )}
                                <SpecRow label="Product Name" value={productName} editField="product_name" />
                                <SpecRow label="Warranty Type" value={isEditing ? editData.warranty_type : warranty.warranty_type} editField="warranty_type" />

                                {/* Seat Cover Specific Fields */}
                                {warranty.product_type === 'seat-cover' && (
                                    <>
                                        <SpecRow label="UID" value={warranty.uid || productDetails.uid || "N/A"} mono editField="new_uid" />
                                    </>
                                )}

                                {/* EV/PPF Specific Fields */}
                                {warranty.product_type !== 'seat-cover' && (
                                    <>
                                        {/* A warranty that draws on rolls shows them read-only: the
                                            serials are recorded in the roll ledger, so editing one
                                            here would leave the two disagreeing about which roll
                                            gave up the film. */}
                                        {Array.isArray(productDetails.rolls) && productDetails.rolls.length > 0 ? (
                                            /* One line per roll. A comma-joined list would lose which
                                               area belongs to which serial, and that pairing is the
                                               point of recording the area per roll. */
                                            <SpecRow
                                                label={productDetails.rolls.length > 1 ? "Rolls Used" : "Roll Used"}
                                                value={
                                                    <span className="flex flex-col items-end gap-1">
                                                        {productDetails.rolls.map((roll: any, i: number) => (
                                                            <span key={i} className="flex flex-wrap justify-end gap-x-1.5">
                                                                <span className="font-mono tracking-tight">{roll.serial}</span>
                                                                <span className="text-muted-foreground">
                                                                    · {roll.sqft} sq.ft
                                                                    {roll.installArea ? ` · ${roll.installArea}` : ''}
                                                                </span>
                                                            </span>
                                                        ))}
                                                    </span>
                                                }
                                            />
                                        ) : (
                                            <>
                                                <SpecRow label="Serial Number" value={displaySerial(productDetails, warranty.uid)} mono editField="serial_number" />
                                                {productDetails.installArea && (
                                                    <SpecRow label="Installation Area" value={productDetails.installArea} />
                                                )}
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Customer Details */}
                        <div className="space-y-1">
                            <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                                <div className="w-1 h-4 bg-gradient-to-b from-orange-500 to-orange-400 rounded-full" />
                                Customer Details
                            </h4>
                            <div className="bg-white rounded-xl p-2 border border-orange-100 shadow-sm">
                                <SpecRow label="Customer Name" value={toTitleCase(warranty.customer_name || productDetails.customerName) || "N/A"} editField="customer_name" />
                                <SpecRow label="Customer Email" value={warranty.customer_email || productDetails.customerEmail || "N/A"} editField="customer_email" />
                                <SpecRow label="Customer Phone" value={warranty.customer_phone || productDetails.customerPhone || "N/A"} editField="customer_phone" />
                            </div>
                        </div>

                        {/* Key Dates */}
                        <div className="space-y-1">
                            <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                                <div className="w-1 h-4 bg-gradient-to-b from-orange-500 to-orange-400 rounded-full" />
                                Important Dates
                            </h4>
                            <div className="bg-white rounded-xl p-2 border border-orange-100 shadow-sm">
                                <SpecRow label="Purchase Date" value={formatToIST(warranty.purchase_date).split(',')[0]} editField="purchase_date" />
                                <SpecRow label="Registered Date" value={formatToIST(warranty.created_at).split(',')[0]} />
                                {warranty.status === 'validated' && (
                                    <>
                                        {warranty.validated_at && (
                                            <SpecRow label="Approved Date" value={formatToIST(warranty.validated_at).split(',')[0]} />
                                        )}
                                        <SpecRow
                                            label="Expiration Date"
                                            value={formatToIST(getWarrantyExpiration(warranty.created_at, warranty.warranty_type, warranty.purchase_date).expirationDate).split(',')[0]}
                                        />
                                        <div className="flex justify-between items-center py-3 px-2 rounded-sm bg-green-500/5 mt-1 border border-green-500/10">
                                            <span className="text-sm text-green-700 font-medium">Days Remaining</span>
                                            <span className="text-sm text-green-700 font-bold">
                                                {getWarrantyExpiration(warranty.created_at, warranty.warranty_type, warranty.purchase_date).daysLeft} Days
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Store / Installer Info */}
                        <div className="space-y-1">
                            <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                                <div className="w-1 h-4 bg-gradient-to-b from-orange-500 to-orange-400 rounded-full" />
                                Store Details
                            </h4>
                            <div className="bg-white rounded-xl p-2 border border-orange-100 shadow-sm">
                                <SpecRow label="Store Name" value={productDetails.storeName || warranty.installer_name} />
                                <SpecRow
                                    label="Store Email"
                                    value={productDetails.storeEmail || (warranty.installer_contact?.includes('|') ? warranty.installer_contact.split('|')[0].trim() : warranty.installer_contact) || "N/A"}
                                />
                                <div className="hidden md:block">
                                    <SpecRow
                                        label="Store Phone"
                                        value={productDetails.storePhone || warranty.vendor_phone_number || productDetails.dealerMobile || 'N/A'}
                                    />
                                </div>
                                <div className="md:hidden">
                                    {(productDetails.storePhone || warranty.vendor_phone_number || productDetails.dealerMobile) && (
                                        <SpecRow
                                            label="Store Phone"
                                            value={productDetails.storePhone || warranty.vendor_phone_number || productDetails.dealerMobile}
                                        />
                                    )}
                                </div>
                                <SpecRow label="Applicator" value={productDetails.manpowerName || warranty.manpower_name_from_db || "Standard"} />
                            </div>
                        </div>

                        {/* EV/PPF: Dealer Address */}
                        {warranty.product_type === 'ev-products' && productDetails.dealerAddress && (
                            <div className="space-y-1">
                                <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                                    <div className="w-1 h-4 bg-gradient-to-b from-orange-500 to-orange-400 rounded-full" />
                                    Dealer Information
                                </h4>
                                <div className="bg-white rounded-xl p-3 border border-orange-100 shadow-sm">
                                    <p className="text-sm text-foreground">{productDetails.dealerAddress}</p>
                                </div>
                            </div>
                        )}

                        {/* Documents & Photos Section - Seat Cover */}
                        {warranty.product_type === 'seat-cover' && (
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-2 pl-1 flex items-center gap-2">
                                    <div className="w-1 h-4 bg-gradient-to-b from-orange-500 to-orange-400 rounded-full" />
                                    Documentation & Photos
                                </h4>
                                <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-thin">
                                    {/* Invoice */}
                                    {(() => {
                                        const raw = productDetails.invoiceFileName || productDetails.photos?.warranty;
                                        if (!raw) return null;
                                        const url = typeof raw === 'string' && raw.startsWith('http') ? raw : `http://localhost:3000/uploads/${raw}`;
                                        const isPdf = typeof raw === 'string' && raw.toLowerCase().endsWith('.pdf');
                                        return (
                                            <div className="relative group cursor-pointer rounded-xl overflow-hidden border border-orange-100 shadow-sm bg-slate-50 shrink-0 w-28 h-28" onClick={() => isPdf ? window.open(url, '_blank') : setViewingPhoto(raw)}>
                                                {isPdf ? (
                                                    <div className="w-full h-full flex flex-col items-center justify-center bg-blue-50 text-blue-500">
                                                        <FileText className="h-8 w-8 mb-1" />
                                                        <span className="text-[10px] font-medium px-2 text-center">PDF Document</span>
                                                    </div>
                                                ) : (
                                                    <img src={url} alt="Invoice" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                                                )}
                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                                    {isPdf ? <ExternalLink className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" /> : <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />}
                                                </div>
                                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                                                    <span className="text-white text-[10px] font-medium leading-tight block">Invoice / MRP</span>
                                                </div>
                                                <ReplaceOverlay field="invoiceFileName" />
                                            </div>
                                        );
                                    })()}

                                    {/* Photos */}
                                    {productDetails.photos && [{ key: 'vehicle', label: 'Car Exterior' }, { key: 'seatCover', label: 'Seat Cover' }, { key: 'carOuter', label: 'Car Outer' }]
                                        .filter(({ key }) => productDetails.photos[key])
                                        .map(({ key, label }) => {
                                            const raw = productDetails.photos[key];
                                            const url = typeof raw === 'string' && raw.startsWith('http') ? raw : `http://localhost:3000/uploads/${raw}`;
                                            return (
                                                <div key={key} className="relative group cursor-pointer rounded-xl overflow-hidden border border-orange-100 shadow-sm bg-slate-50 shrink-0 w-28 h-28" onClick={() => setViewingPhoto(raw)}>
                                                    <img src={url} alt={label} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                                        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    </div>
                                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                                                        <span className="text-white text-[10px] font-medium leading-tight block">{label}</span>
                                                    </div>
                                                    <ReplaceOverlay field={key} />
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        )}

                        {/* Documents & Photos Section - EV/PPF */}
                        {warranty.product_type === 'ev-products' && (
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-2 pl-1 flex items-center gap-2">
                                    <div className="w-1 h-4 bg-gradient-to-b from-orange-500 to-orange-400 rounded-full" />
                                    Documentation & Photos
                                </h4>
                                <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-thin">
                                    {/* Invoice */}
                                    {(() => {
                                        const raw = productDetails.photos?.warranty;
                                        if (!raw) return null;
                                        const url = typeof raw === 'string' && raw.startsWith('http') ? raw : `http://localhost:3000/uploads/${raw}`;
                                        const isPdf = typeof raw === 'string' && raw.toLowerCase().endsWith('.pdf');
                                        return (
                                            <div className="relative group cursor-pointer rounded-xl overflow-hidden border border-orange-100 shadow-sm bg-slate-50 shrink-0 w-28 h-28" onClick={() => isPdf ? window.open(url, '_blank') : setViewingPhoto(raw)}>
                                                {isPdf ? (
                                                    <div className="w-full h-full flex flex-col items-center justify-center bg-blue-50 text-blue-500">
                                                        <FileText className="h-8 w-8 mb-1" />
                                                        <span className="text-[10px] font-medium px-2 text-center">PDF Document</span>
                                                    </div>
                                                ) : (
                                                    <img src={url} alt="Invoice" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                                                )}
                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                                    {isPdf ? <ExternalLink className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" /> : <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />}
                                                </div>
                                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                                                    <span className="text-white text-[10px] font-medium leading-tight block">Invoice / MRP</span>
                                                </div>
                                                <ReplaceOverlay field="warranty" />
                                            </div>
                                        );
                                    })()}

                                    {/* Photos */}
                                    {productDetails.photos && [{ key: 'lhs', label: 'LHS View' }, { key: 'rhs', label: 'RHS View' }, { key: 'frontReg', label: 'Front Reg' }, { key: 'backReg', label: 'Back Reg' }]
                                        .filter(({ key }) => productDetails.photos[key])
                                        .map(({ key, label }) => {
                                            const raw = productDetails.photos[key];
                                            const url = typeof raw === 'string' && raw.startsWith('http') ? raw : `http://localhost:3000/uploads/${raw}`;
                                            return (
                                                <div key={key} className="relative group cursor-pointer rounded-xl overflow-hidden border border-orange-100 shadow-sm bg-slate-50 shrink-0 w-28 h-28" onClick={() => setViewingPhoto(raw)}>
                                                    <img src={url} alt={label} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                                        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    </div>
                                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                                                        <span className="text-white text-[10px] font-medium leading-tight block">{label}</span>
                                                    </div>
                                                    <ReplaceOverlay field={key} />
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        )}

                    </div>
                    {/* Footer Area */}
                    <div className="p-4 border-t border-orange-100 bg-gradient-to-r from-orange-50/50 to-white flex gap-3">
                        {isAdmin && onApprove && onReject && (warranty?.status === 'pending' || warranty?.status === 'pending_vendor') && (
                            <>
                                <Button
                                    className="flex-1 h-11 font-semibold bg-green-600 hover:bg-green-700 text-white rounded-xl gap-2"
                                    onClick={async () => {
                                        setActionLoading('approve');
                                        await onApprove(warranty.uid);
                                        setActionLoading(null);
                                        onClose();
                                    }}
                                    disabled={actionLoading !== null}
                                >
                                    {actionLoading === 'approve'
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <CheckCircle2 className="h-4 w-4" />}
                                    {actionLoading === 'approve' ? 'Approving...' : 'Approve'}
                                </Button>
                                <Button
                                    className="flex-1 h-11 font-semibold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl gap-2"
                                    variant="outline"
                                    onClick={async () => {
                                        setActionLoading('reject');
                                        await onReject(warranty.uid);
                                        setActionLoading(null);
                                        onClose();
                                    }}
                                    disabled={actionLoading !== null}
                                >
                                    {actionLoading === 'reject'
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <AlertTriangle className="h-4 w-4" />}
                                    {actionLoading === 'reject' ? 'Rejecting...' : 'Reject'}
                                </Button>
                            </>
                        )}
                        {/* A rejected warranty is not final — the store fixes what was
                            wrong and resubmits, so an admin can send it back to
                            pending. This was only reachable from the list, which the
                            warranties screen renders with actions turned off. */}
                        {isAdmin && onMoveToPending && warranty?.status === 'rejected' && (
                            <Button
                                className="flex-1 h-11 font-semibold text-orange-600 border-orange-200 hover:bg-orange-50 rounded-xl gap-2"
                                variant="outline"
                                onClick={async () => {
                                    setActionLoading('pending');
                                    await onMoveToPending(warranty.uid);
                                    setActionLoading(null);
                                    onClose();
                                }}
                                disabled={actionLoading !== null}
                            >
                                {actionLoading === 'pending'
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <RefreshCw className="h-4 w-4" />}
                                {actionLoading === 'pending' ? 'Moving...' : 'Move to pending'}
                            </Button>
                        )}

                        {/* An approval given in error has to be correctable, so a
                            validated warranty can still be reversed. The reject flow
                            collects the reason, which the server now requires. */}
                        {isAdmin && onReject && warranty?.status === 'validated' && (
                            <Button
                                className="flex-1 h-11 font-semibold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl gap-2"
                                variant="outline"
                                onClick={async () => {
                                    setActionLoading('reject');
                                    await onReject(warranty.uid);
                                    setActionLoading(null);
                                    onClose();
                                }}
                                disabled={actionLoading !== null}
                            >
                                {actionLoading === 'reject'
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <AlertTriangle className="h-4 w-4" />}
                                {actionLoading === 'reject' ? 'Reversing...' : 'Reverse approval'}
                            </Button>
                        )}
                        <Button className="flex-1 h-11 text-base font-semibold border-2 border-orange-200 text-orange-600 bg-white hover:bg-orange-50 hover:border-orange-300 transition-all rounded-xl" onClick={onClose} variant="outline" disabled={actionLoading !== null}>Done</Button>
                    </div>
                </SheetContent>

            </Sheet>

            <Dialog open={!!viewingPhoto} onOpenChange={(open) => !open && setViewingPhoto(null)}>
                <DialogContent className="max-w-4xl p-0 bg-black/95 border-none overflow-hidden flex flex-col sm:rounded-xl">
                    <DialogHeader className="p-4 bg-black/50 absolute top-0 left-0 right-0 z-10 flex flex-row items-center justify-between">
                        <DialogTitle className="text-white text-sm font-medium">Image Preview</DialogTitle>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" className="bg-white/10 hover:bg-white/20 border-white/20 text-white font-medium" onClick={() => {
                                if (viewingPhoto) {
                                    const url = viewingPhoto.startsWith('http') ? viewingPhoto : `http://localhost:3000/uploads/${viewingPhoto}`;
                                    window.open(url, '_blank');
                                }
                            }}>
                                <ExternalLink className="h-4 w-4 mr-2" />
                                Open in New Tab
                            </Button>
                        </div>
                    </DialogHeader>
                    <div className="flex-1 flex items-center justify-center p-4 min-h-[60vh] mt-12">
                        {viewingPhoto && (
                            <img
                                src={viewingPhoto.startsWith('http') ? viewingPhoto : `http://localhost:3000/uploads/${viewingPhoto}`}
                                className="max-w-full max-h-[80vh] object-contain rounded-md shadow-2xl"
                                alt="Preview"
                            />
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </EditContext.Provider>
    );
};
