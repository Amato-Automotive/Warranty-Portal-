import { useState, useEffect } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { formatToIST, cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { GrievanceForm, grievancePayload, type GrievanceDraft } from "@/components/grievance/GrievanceForm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCw, MessageSquare, AlertCircle, CheckCircle, Clock, Users, Building2, Package, Receipt, Store, Wrench, ShieldCheck, HelpCircle, Paperclip, Plus, X, Upload, Factory, Truck, UserCheck, Eye, Box, Monitor } from "lucide-react";
import { Pagination } from "./Pagination";
import { WarrantySpecSheet } from "@/components/warranty/WarrantySpecSheet";

interface Grievance {
    id: number;
    ticket_id: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    category: string;
    sub_category: string | null;
    subject: string;
    description: string;
    attachments: string;
    status: string;
    franchise_remarks: string | null;
    admin_remarks: string | null;
    created_by_role?: string;
    created_by_name?: string | null;
    customer_rating: number | null;
    created_at: string;
    resolved_at: string | null;
    department?: string;
    departmentDetails?: string;
    department_details?: string;
    department_display?: string;
    warranty_id?: string | number;
}

interface GrievanceRemark {
    id: number;
    grievance_id: number;
    added_by: 'franchise' | 'admin' | 'asm' | 'assignee';
    added_by_name: string;
    added_by_id: string;
    remark: string;
    created_at: string;
}

const CATEGORIES: Record<string, string> = {
    seat_cover: "Seat Cover",
    mats: "Mats",
    accessories: "Accessories",
    software_issue: "Software/Portal Issue",
    other: "Other",
};

const CATEGORY_CONFIG: Record<string, { color: string; icon: any; border: string; bg: string; text: string }> = {
    seat_cover: { color: "bg-blue-500", border: "border-blue-200", bg: "bg-blue-50", text: "text-blue-700", icon: Package },
    mats: { color: "bg-emerald-500", border: "border-emerald-200", bg: "bg-emerald-50", text: "text-emerald-700", icon: Box },
    accessories: { color: "bg-amber-500", border: "border-amber-200", bg: "bg-amber-50", text: "text-amber-700", icon: Wrench },
    software_issue: { color: "bg-fuchsia-500", border: "border-fuchsia-200", bg: "bg-fuchsia-50", text: "text-fuchsia-700", icon: Monitor },
    other: { color: "bg-slate-500", border: "border-slate-200", bg: "bg-slate-100", text: "text-slate-700", icon: HelpCircle },
};

const STATUS_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
    submitted: { color: "bg-gray-500", icon: Clock, label: "Submitted" },
    under_review: { color: "bg-blue-500", icon: AlertCircle, label: "Under Review" },
    in_progress: { color: "bg-amber-500", icon: RefreshCw, label: "In Progress" },
    resolved: { color: "bg-green-500", icon: CheckCircle, label: "Resolved" },
    rejected: { color: "bg-red-500", icon: AlertCircle, label: "Action Required" },
};

/**
 * Fallback only. Categories are managed by an admin and fetched below; this
 * list keeps the form usable if that request fails, rather than showing a store
 * no options at all.
 */
const FALLBACK_CATEGORIES = [
    { value: "seat_cover", label: "Seat Cover" },
    { value: "mats", label: "Mats" },
    { value: "accessories", label: "Accessories" },
    { value: "software_issue", label: "Software/Portal Issue" },
    { value: "ev_ppf", label: "EV & PPF" },
    { value: "other", label: "Other" },
];


const VendorGrievances = () => {
    const { toast } = useToast();
    const [grievances, setGrievances] = useState<Grievance[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedGrievance, setSelectedGrievance] = useState<Grievance | null>(null);
    const [remarks, setRemarks] = useState("");
    const [updating, setUpdating] = useState(false);
    const [remarksHistory, setRemarksHistory] = useState<GrievanceRemark[]>([]);
    const [loadingRemarks, setLoadingRemarks] = useState(false);

    // My Grievance state
    const [myGrievances, setMyGrievances] = useState<any[]>([]);
    const [loadingMyGrievances, setLoadingMyGrievances] = useState(false);
    const [showNewGrievanceForm, setShowNewGrievanceForm] = useState(false);

    // Warranty View State
    const [viewingWarranty, setViewingWarranty] = useState<any>(null);
    const [showWarrantySheet, setShowWarrantySheet] = useState(false);
    const [loadingWarranty, setLoadingWarranty] = useState(false);

    // Pagination states
    const [customerLimit, setCustomerLimit] = useState(15);
    const [myGrievanceLimit, setMyGrievanceLimit] = useState(15);
    const [customerPagination, setCustomerPagination] = useState({ currentPage: 1, totalPages: 1, totalCount: 0, limit: 15 });
    const [myGrievancePagination, setMyGrievancePagination] = useState({ currentPage: 1, totalPages: 1, totalCount: 0, limit: 15 });

    // Category labels for the list; the form loads its own.
    const [categories, setCategories] = useState(FALLBACK_CATEGORIES);

    // Only the active ones — a retired category stays on old grievances but
    // must not be offered again.
    useEffect(() => {
        api.get("/grievance/categories", { params: { active: true } })
            .then(res => {
                const list = (res.data?.categories || [])
                    .map((c: any) => ({ value: c.value, label: c.label }));
                if (list.length > 0) setCategories(list);
            })
            .catch(() => { /* keep the fallback */ });
    }, []);

    const fetchGrievances = async (page = 1, currentLimit = customerLimit) => {
        setLoading(true);
        try {
            const response = await api.get(`/grievance/vendor?page=${page}&limit=${currentLimit}`);
            if (response.data.success) {
                setGrievances(response.data.data);
                if (response.data.pagination) setCustomerPagination(response.data.pagination);
            }
        } catch (error: any) {
            toast({
                title: "Error",
                description: "Failed to fetch complaints",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const fetchMyGrievances = async (page = 1, currentLimit = myGrievanceLimit) => {
        setLoadingMyGrievances(true);
        try {
            const response = await api.get(`/grievance/franchise/submitted?page=${page}&limit=${currentLimit}`);
            if (response.data.success) {
                setMyGrievances(response.data.data);
                if (response.data.pagination) setMyGrievancePagination(response.data.pagination);
            }
        } catch (error: any) {
            console.error("Failed to fetch my grievances", error);
        } finally {
            setLoadingMyGrievances(false);
        }
    };

    const handleViewWarranty = async (warrantyId: string | number) => {
        setLoadingWarranty(true);
        try {
            // Attempt to fetch warranty details
            // Try standard warranty endpoint first
            const response = await api.get(`/warranty/${warrantyId}`);
            if (response.data.success) {
                setViewingWarranty(response.data.data || response.data.warranty);
                setShowWarrantySheet(true);
            } else {
                toast({ title: "Not Found", description: "Warranty details could not be loaded.", variant: "destructive" });
            }
        } catch (error) {
            console.error("Failed to fetch warranty", error);
            toast({ title: "Error", description: "Failed to load warranty details.", variant: "destructive" });
        } finally {
            setLoadingWarranty(false);
        }
    };

    useEffect(() => {
        fetchGrievances();
        fetchMyGrievances();
    }, []);

    const handleSubmitGrievance = async (draft: GrievanceDraft) => {
        try {
            const response = await api.post('/grievance/franchise', grievancePayload(draft));
            if (!response.data.success) return false;
            toast({
                title: "Complaint Submitted",
                description: "Your complaint has been submitted successfully.",
                className: "bg-green-500 text-white"
            });
            setShowNewGrievanceForm(false);
            fetchMyGrievances();
            return true;
        } catch (error: any) {
            console.error("Submit grievance error:", error);
            toast({
                title: "Submission Failed",
                description: getErrorMessage(error, "Failed to submit complaint"),
                variant: "destructive"
            });
            return false;
        }
    };

    const fetchRemarksHistory = async (grievanceId: number) => {
        setLoadingRemarks(true);
        try {
            const response = await api.get(`/grievance/${grievanceId}/remarks`);
            if (response.data.success) {
                setRemarksHistory(response.data.data);
            }
        } catch (error) {
            console.error("Failed to fetch remarks history", error);
        } finally {
            setLoadingRemarks(false);
        }
    };

    const handleOpenDetail = (g: Grievance) => {
        setSelectedGrievance(g);
        setRemarks(""); // Clear input on open
        fetchRemarksHistory(g.id);
    };

    const handleUpdate = async () => {
        if (!selectedGrievance || !remarks.trim()) return;

        setUpdating(true);
        try {
            await api.put(`/grievance/${selectedGrievance.id}/remarks`, { remarks });
            toast({ title: "Remarks Added", description: "Your response has been logged in history." });
            setRemarks(""); // Clear input
            fetchRemarksHistory(selectedGrievance.id); // Refresh history
            fetchGrievances(customerPagination.currentPage, customerLimit); // Refresh main list
        } catch (error: any) {
            toast({
                title: "Failed to Add Remark",
                description: getErrorMessage(error, "An error occurred"),
                variant: "destructive",
            });
        } finally {
            setUpdating(false);
        }
    };


    if (loading) {
        return (
            <div className="flex items-center justify-center h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="animate-in fade-in duration-700 space-y-6">
            {/* Unified Header */}
            <div className="flex justify-between items-center bg-white py-3 md:py-4 px-4 md:px-6 rounded-2xl md:rounded-3xl border border-orange-100 shadow-[0_8px_30px_rgba(0,0,0,0.02)]">
                <h2 className="text-base md:text-lg font-black text-slate-800 tracking-tight">Complaints</h2>

                <div className="flex items-center gap-2 md:gap-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            fetchGrievances();
                            fetchMyGrievances();
                        }}
                        className="h-10 md:h-11 px-3 md:px-6 rounded-xl md:rounded-2xl border-orange-100 text-orange-600 font-bold hover:bg-orange-50 transition-all flex items-center justify-center gap-2 shadow-sm text-xs md:text-sm"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading || loadingMyGrievances ? "animate-spin" : ""}`} />
                        <span className="hidden md:inline">Refresh</span>
                    </Button>
                    <Button
                        onClick={() => setShowNewGrievanceForm(true)}
                        className="h-10 md:h-11 px-4 md:px-8 rounded-xl md:rounded-2xl bg-orange-600 hover:bg-orange-700 text-white font-black uppercase md:tracking-widest shadow-xl shadow-orange-600/20 transition-all active:scale-95 flex items-center gap-2 text-xs"
                    >
                        <Plus className="h-4 w-4 md:h-5 md:w-5 shrink-0" />
                        <span className="hidden md:inline">Raise New Concern</span>
                        <span className="md:hidden">Raise</span>
                    </Button>
                </div>
            </div>

            {/* List Content */}
            <div className="outline-none">

                {loadingMyGrievances ? (
                    <div className="flex items-center justify-center p-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : myGrievances.length === 0 ? (
                    <Card className="border-dashed">
                        <CardContent className="py-12 text-center">
                            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                            <p className="text-muted-foreground">You haven't submitted any complaints yet</p>
                            <Button variant="link" onClick={() => setShowNewGrievanceForm(true)}>
                                Submit your first complaint
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {myGrievances.map((g) => {
                            const categoryConfig = CATEGORY_CONFIG[g.category] || CATEGORY_CONFIG['other'];
                            const CategoryIcon = categoryConfig.icon;

                            return (
                                <div
                                    key={g.id}
                                    onClick={() => handleOpenDetail(g)}
                                    className={`group relative flex items-center gap-3 md:gap-4 p-4 md:p-5 bg-white hover:bg-slate-50/50 transition-all duration-300 rounded-[18px] md:rounded-[24px] border border-slate-100 shadow-sm hover:shadow-xl cursor-pointer active:scale-[0.99] border-l-[6px] ${categoryConfig.border.replace('border-', 'border-l-')}`}
                                >
                                    <div className={`h-11 w-11 md:h-14 md:w-14 rounded-xl md:rounded-2xl flex items-center justify-center shrink-0 shadow-sm transition-transform duration-500 group-hover:scale-110 ${categoryConfig.bg} ${categoryConfig.text}`}>
                                        <CategoryIcon className="w-5 h-5 md:w-7 md:h-7" />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5 md:gap-2 mb-1.5">
                                            <span className="font-mono text-[8px] md:text-[10px] font-bold text-indigo-700 bg-indigo-50/80 px-1.5 py-0.5 md:px-2 md:py-1 rounded-md border border-indigo-100 shadow-sm">{g.ticket_id}</span>
                                            <Badge variant="outline" className={`${STATUS_CONFIG[g.status]?.color?.replace('bg-', 'text-')} border-0 bg-transparent font-black tracking-widest text-[8px] md:text-[10px] uppercase pl-0`}>
                                                • {STATUS_CONFIG[g.status]?.label}
                                            </Badge>
                                            {g.created_by_role === 'asm' && (
                                                <span className="text-[8px] md:text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-100 px-1.5 py-0.5 rounded-md">
                                                    Raised by {g.created_by_name || 'your ASM'} (your ASM)
                                                </span>
                                            )}


                                        </div>
                                        <h3 className="font-black text-slate-800 text-sm md:text-lg truncate tracking-tight group-hover:text-orange-600 transition-colors">{g.subject}</h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge variant="outline" className={`text-[8px] md:text-[9px] font-black uppercase tracking-widest border shrink-0 ${categoryConfig.bg} ${categoryConfig.text} ${categoryConfig.border}`}>
                                                {CATEGORIES[g.category] || categories.find(c => c.value === g.category)?.label || g.category}
                                            </Badge>
                                            <span className="text-slate-300 opacity-50">•</span>
                                            <span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">{formatToIST(g.created_at)}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {myGrievancePagination.totalPages > 0 && (
                    <div className="mt-8 flex justify-end pb-8">
                        <Pagination
                            currentPage={myGrievancePagination.currentPage}
                            totalPages={myGrievancePagination.totalPages}
                            onPageChange={fetchMyGrievances}
                            rowsPerPage={myGrievanceLimit}
                            onRowsPerPageChange={(rows) => {
                                setMyGrievanceLimit(rows);
                                fetchMyGrievances(1, rows);
                            }}
                        />
                    </div>
                )}

                {/* New Grievance Dialog */}
                <Dialog open={showNewGrievanceForm} onOpenChange={setShowNewGrievanceForm}>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 border-0 rounded-[30px] shadow-2xl bg-white">
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100 bg-slate-50/50">
                            <DialogTitle className="text-xl font-black text-slate-800">Submit New Complaint</DialogTitle>
                            <DialogDescription className="text-slate-500">
                                Report an issue to the Concerned Department.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="p-6">
                            <GrievanceForm
                                onSubmit={handleSubmitGrievance}
                                submitLabel="Submit Complaint"
                                footnote="Your complaint will be sent to the selected department and tracked by admin."
                            />
                        </div>
                    </DialogContent>
                </Dialog>
            </div>


            {/* Global Detail Dialog - Fixed scrolling and height */}
            <Dialog open={!!selectedGrievance} onOpenChange={() => setSelectedGrievance(null)}>
                <DialogContent className="max-w-2xl h-[85vh] p-0 border-0 rounded-[30px] overflow-hidden shadow-2xl flex flex-col font-sans bg-white">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Complaint Details</DialogTitle>
                        <DialogDescription>
                            Details for complaint {selectedGrievance?.ticket_id}
                        </DialogDescription>
                    </DialogHeader>
                    {selectedGrievance && (
                        <div className="flex flex-col h-full bg-white overflow-hidden">
                            {/* Header Section - Modern Gradient */}
                            <div className="px-6 md:px-8 pt-8 pb-6 bg-gradient-to-br from-indigo-50/80 via-white to-purple-50/50 border-b border-slate-100 flex-shrink-0 relative overflow-hidden">
                                {/* Decorative background elements */}
                                <div className="absolute -top-24 -right-12 w-48 h-48 bg-purple-200/40 rounded-full blur-3xl" />
                                <div className="absolute bottom-0 left-12 w-32 h-32 bg-indigo-200/40 rounded-full blur-2xl" />

                                <div className="relative z-10">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-3">
                                            <Badge variant="outline" className="bg-white/80 backdrop-blur-sm border-indigo-100 text-indigo-700 font-bold tracking-widest uppercase text-[10px] shadow-sm">
                                                {selectedGrievance.ticket_id}
                                            </Badge>
                                            <Badge className={cn(
                                                "font-black tracking-widest text-[10px] uppercase px-3 py-1 rounded-full shadow-sm",
                                                STATUS_CONFIG[selectedGrievance.status]?.color || "bg-slate-500"
                                            )}>
                                                {STATUS_CONFIG[selectedGrievance.status]?.label}
                                            </Badge>
                                        </div>
                                    </div>
                                    <h2 className="text-xl md:text-3xl font-black text-slate-900 tracking-tight leading-tight drop-shadow-sm">
                                        {selectedGrievance.subject}
                                    </h2>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-3 flex items-center gap-2">
                                        <Clock className="h-3.5 w-3.5 text-indigo-400" />
                                        {formatToIST(selectedGrievance.created_at)}
                                    </p>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 custom-scrollbar bg-slate-50/30">
                                {/* Target Info: Either Customer or Department */}
                                {selectedGrievance.department && (
                                    <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
                                        <h4 className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400 mb-3">Target Department</h4>
                                        <div className="flex items-center gap-4">
                                            <div className="h-12 w-12 rounded-xl bg-orange-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/10">
                                                <Building2 className="h-6 w-6" />
                                            </div>
                                            <div>
                                                <div className="font-black text-slate-800 text-base uppercase tracking-tight">
                                                    {selectedGrievance.department}
                                                </div>
                                                {(selectedGrievance.department_details || selectedGrievance.departmentDetails) && (
                                                    <div className="text-sm text-slate-500 font-bold opacity-80">
                                                        {selectedGrievance.department_details || selectedGrievance.departmentDetails}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {/* Customer Details section intentionally removed for franchise-raised grievances */}

                                {/* Issue Details */}
                                <div className="space-y-4">
                                    {/* Subject and Category explicit display */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm leading-relaxed">
                                        <div className="space-y-1.5">
                                            <h4 className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Subject</h4>
                                            <p className="font-bold text-slate-800 text-sm md:text-base">
                                                {selectedGrievance.subject}
                                            </p>
                                        </div>

                                        <div className="space-y-1.5">
                                            <h4 className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Category</h4>
                                            <div className="flex items-center gap-2 mt-1">
                                                {(() => {
                                                    const val = String(selectedGrievance.category || "").trim().toLowerCase();
                                                    const displayVal = CATEGORIES[val] ||
                                                        categories.find(c => c.value.toLowerCase() === val)?.label ||
                                                        selectedGrievance.category || "N/A";

                                                    // Dynamic color mapping for categories
                                                    const categoryColors: Record<string, string> = {
                                                        'seat_cover': 'bg-blue-50 text-blue-700 border-blue-200',
                                                        'seat-cover': 'bg-blue-50 text-blue-700 border-blue-200',
                                                        'mats': 'bg-emerald-50 text-emerald-700 border-emerald-200',
                                                        'accessories': 'bg-amber-50 text-amber-700 border-amber-200',
                                                        'software_issue': 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
                                                        'software/portal issue': 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
                                                        'other': 'bg-slate-100 text-slate-700 border-slate-200'
                                                    };

                                                    const colorClass = categoryColors[val] || 'bg-indigo-50 text-indigo-700 border-indigo-200';

                                                    return (
                                                        <Badge className={`uppercase text-[10px] font-black tracking-widest border shadow-sm ${colorClass}`}>
                                                            {displayVal}
                                                        </Badge>
                                                    );
                                                })()}
                                                {selectedGrievance.sub_category && (
                                                    <Badge variant="outline" className="border-slate-200 text-slate-500 uppercase text-[9px] font-black tracking-widest bg-slate-50">
                                                        {selectedGrievance.sub_category}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <h4 className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400 flex items-center gap-2">
                                            Description
                                        </h4>
                                        <div className="text-slate-700 text-sm md:text-base bg-white p-6 rounded-2xl border border-slate-100 shadow-sm leading-relaxed whitespace-pre-wrap font-medium">
                                            {selectedGrievance.description}
                                        </div>
                                    </div>

                                    {/* Link to Warranty if applicable */}
                                    {selectedGrievance.category === 'warranty_issue' && (() => {
                                        // Extract warranty ID from description if not present in the field
                                        let linkedWarrantyId = selectedGrievance.warranty_id;
                                        if (!linkedWarrantyId && selectedGrievance.description) {
                                            const match = selectedGrievance.description.match(/Warranty ID: ([\w-]+)/);
                                            if (match && match[1]) {
                                                linkedWarrantyId = match[1];
                                            }
                                        }

                                        return (
                                            <div className="mt-4 p-3 bg-orange-50/50 rounded-lg border border-orange-100 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                                                        <ShieldCheck className="h-4 w-4 text-orange-600" />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-semibold text-slate-800">Related Warranty</p>
                                                        <p className="text-xs text-slate-500">
                                                            {linkedWarrantyId
                                                                ? `ID: ${linkedWarrantyId}`
                                                                : "Status: Warranty Linked"}
                                                        </p>
                                                    </div>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        if (linkedWarrantyId) {
                                                            handleViewWarranty(linkedWarrantyId);
                                                        } else {
                                                            toast({ description: "No Warranty ID linked to this complaint." });
                                                        }
                                                    }}
                                                    disabled={!linkedWarrantyId || loadingWarranty}
                                                    className="border-orange-200 text-orange-700 hover:bg-orange-100 bg-white"
                                                >
                                                    {loadingWarranty ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                                                    View Details
                                                </Button>
                                            </div>
                                        );
                                    })()}

                                    {/* Attachments Section */}
                                    {(() => {
                                        let attachments: string[] = [];
                                        try {
                                            if (Array.isArray(selectedGrievance.attachments)) {
                                                attachments = selectedGrievance.attachments as unknown as string[];
                                            } else if (typeof selectedGrievance.attachments === 'string' && selectedGrievance.attachments) {
                                                attachments = JSON.parse(selectedGrievance.attachments);
                                            }
                                        } catch (e) {
                                            console.error("Failed to parse attachments", e);
                                        }

                                        if (attachments && attachments.length > 0) {
                                            return (
                                                <div className="pt-4">
                                                    <h4 className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400 mb-3 flex items-center gap-2">
                                                        <Paperclip className="h-3 w-3" />
                                                        Attachments ({attachments.length})
                                                    </h4>
                                                    <div className="flex flex-wrap gap-3">
                                                        {attachments.map((url, idx) => (
                                                            <div key={idx} className="group relative h-20 w-20 md:h-24 md:w-24 rounded-xl overflow-hidden border border-slate-200 hover:border-orange-500 transition-all shadow-sm hover:shadow-md">
                                                                <a
                                                                    href={url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="block h-full w-full"
                                                                >
                                                                    <img
                                                                        src={url}
                                                                        alt={`Attachment ${idx + 1}`}
                                                                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                                                                    />
                                                                </a>
                                                                <a
                                                                    href={url}
                                                                    download={`attachment-${idx + 1}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="absolute bottom-1 right-1 p-1.5 bg-white/90 hover:bg-white text-orange-600 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer"
                                                                    title="Download"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <Upload className="h-3.5 w-3.5 rotate-180" />
                                                                </a>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>

                                {/* Response History / Remarks Log */}
                                <div className="space-y-4 pt-6 mt-4 border-t border-slate-100">
                                    <h4 className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400 flex items-center gap-2">
                                        <Clock className="h-3 w-3" />
                                        Response History & Remarks
                                    </h4>

                                    {loadingRemarks ? (
                                        <div className="flex items-center gap-2 text-xs text-slate-400 p-4">
                                            <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                                            Loading history...
                                        </div>
                                    ) : remarksHistory.length === 0 ? (
                                        <div className="bg-slate-50/50 rounded-2xl p-6 text-center border border-dashed border-slate-200">
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">No response recorded yet</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                            {remarksHistory.map((remark) => (
                                                <div key={remark.id} className={cn(
                                                    "p-4 rounded-2xl border transition-all",
                                                    remark.added_by === 'admin'
                                                        ? "bg-blue-50/30 border-blue-100 ml-0 mr-8"
                                                        : remark.added_by === 'asm'
                                                            ? "bg-sky-50/40 border-sky-100 ml-0 mr-8"
                                                            : "bg-orange-50/30 border-orange-100 ml-8 mr-0"
                                                )}>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className={cn(
                                                            "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded",
                                                            remark.added_by === 'admin' ? "bg-blue-100 text-blue-700"
                                                                : remark.added_by === 'asm' ? "bg-sky-100 text-sky-700" : "bg-orange-100 text-orange-700"
                                                        )}>
                                                            {remark.added_by_name} ({remark.added_by === 'asm' ? 'your ASM' : remark.added_by})
                                                        </span>
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                                                            {formatToIST(remark.created_at)}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-slate-700 leading-relaxed font-medium">
                                                        {remark.remark}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Add New Remark Section */}
                                    <div className="space-y-3 pt-4 border-t border-slate-100">
                                        <h4 className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Add New Remark</h4>
                                        <Textarea
                                            value={remarks}
                                            onChange={(e) => setRemarks(e.target.value)}
                                            placeholder="Add your response or internal notes..."
                                            rows={4}
                                            className="rounded-2xl border-slate-200 focus:border-orange-500 focus:ring-orange-500/10 min-h-[120px] text-sm font-medium"
                                        />
                                        <Button
                                            onClick={handleUpdate}
                                            disabled={updating || !remarks.trim()}
                                            className="w-full h-12 rounded-2xl bg-slate-900 border-0 text-white font-black uppercase tracking-widest shadow-xl shadow-slate-900/10 hover:bg-slate-800 transition-all hover:translate-y-[-1px] active:translate-y-[0px] flex items-center justify-center"
                                        >
                                            {updating ? (
                                                <div className="flex items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Sending...
                                                </div>
                                            ) : (
                                                <>
                                                    <Plus className="h-4 w-4 mr-2" />
                                                    Post Official Remark
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
            <WarrantySpecSheet
                isOpen={showWarrantySheet}
                onClose={() => setShowWarrantySheet(false)}
                warranty={viewingWarranty}
            />
        </div>
    );
};

export default VendorGrievances;
