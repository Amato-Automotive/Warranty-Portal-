import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Star, Send, RefreshCw, X, ImageIcon, MessageSquare, Store, FileText, HelpCircle, AlertTriangle, Clock, Shield, Car, Video } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { formatToIST, cn } from "@/lib/utils";
import { compressImage, isCompressibleImage } from "@/lib/imageCompression";
import { compressVideo, isCompressibleVideo, canCompressVideo } from "@/lib/videoCompression";
import { displaySerial } from "@/lib/ppfRolls";

interface Grievance {
    id: number;
    ticket_id: string;
    category: string;
    sub_category: string | null;
    subject: string;
    description: string;
    status: string;
    priority: string;
    franchise_name: string | null;
    franchise_remarks: string | null;
    admin_remarks: string | null;
    customer_rating: number | null;
    customer_feedback: string | null;
    created_at: string;
    resolved_at: string | null;
}

interface GrievanceRemark {
    id: number;
    grievance_id: number;
    added_by: 'franchise' | 'admin';
    added_by_name: string;
    added_by_id: string;
    remark: string;
    created_at: string;
}

interface Dealer {
    id: string;
    store_name: string;
    city: string;
    address: string;
}

const CATEGORIES = [
    { value: "product_issue", label: "Product Issue", requiresAttachment: true },
    { value: "billing_issue", label: "Billing Issue", requiresAttachment: true },
    { value: "warranty_issue", label: "Warranty Issue", requiresAttachment: true },
    { value: "store_issue", label: "Store/Dealer Issue", requiresAttachment: false },
    { value: "manpower_issue", label: "Manpower Issue", requiresAttachment: false },
    { value: "service_issue", label: "Service Issue", requiresAttachment: false },
    { value: "other", label: "Other", requiresAttachment: false },
];

const STATUS_COLORS: Record<string, string> = {
    submitted: "bg-gray-500",
    under_review: "bg-blue-500",
    in_progress: "bg-amber-500",
    resolved: "bg-green-500",
    rejected: "bg-red-500",
};

const GrievancePage = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState("list");
    const [grievances, setGrievances] = useState<Grievance[]>([]);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Form state
    const [category, setCategory] = useState("");
    const [subCategory, setSubCategory] = useState("");
    const [subject, setSubject] = useState("");
    const [description, setDescription] = useState("");
    const [selectedDealer, setSelectedDealer] = useState("");

    // Separate attachment slots
    const [attachment1, setAttachment1] = useState<File | null>(null);
    const [attachment2, setAttachment2] = useState<File | null>(null);
    const [attachment3, setAttachment3] = useState<File | null>(null);
    const [compressing, setCompressing] = useState(false);

    // Dealers list
    const [dealers, setDealers] = useState<Dealer[]>([]);
    const [loadingDealers, setLoadingDealers] = useState(false);

    // Warranties list
    const [warranties, setWarranties] = useState<any[]>([]);
    const [selectedWarranty, setSelectedWarranty] = useState<string>("");
    const [loadingWarranties, setLoadingWarranties] = useState(false);

    // Rating state
    const [ratingGrievanceId, setRatingGrievanceId] = useState<number | null>(null);
    const [rating, setRating] = useState(0);
    const [feedback, setFeedback] = useState("");

    // Remarks history state
    const [remarksHistoryMap, setRemarksHistoryMap] = useState<Record<number, GrievanceRemark[]>>({});
    const [loadingRemarksMap, setLoadingRemarksMap] = useState<Record<number, boolean>>({});
    const [expandedRemarks, setExpandedRemarks] = useState<Record<number, boolean>>({});

    const fetchGrievances = async () => {
        setLoading(true);
        try {
            const response = await api.get("/grievance");
            if (response.data.success) {
                setGrievances(response.data.data);
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

    const fetchDealers = async () => {
        setLoadingDealers(true);
        try {
            const response = await api.get("/public/stores");
            if (response.data.success) {
                // Map stores data to dealer interface
                setDealers(response.data.stores.map((s: any) => ({
                    id: s.vendor_details_id,
                    store_name: s.store_name,
                    city: s.city,
                    address: s.address
                })));
            }
        } catch (error) {
            console.error("Failed to fetch dealers", error);
        } finally {
            setLoadingDealers(false);
        }
    };

    const fetchWarranties = async () => {
        setLoadingWarranties(true);
        try {
            // Fetch all warranties (high limit) to populate dropdown
            const response = await api.get("/warranty?limit=100");
            if (response.data.success) {
                const fetchedWarranties = response.data.warranties || [];
                setWarranties(fetchedWarranties);

                // Auto-select if only one warranty exists
                if (fetchedWarranties.length === 1) {
                    setSelectedWarranty(fetchedWarranties[0].id.toString());
                }
            }
        } catch (error) {
            console.error("Failed to fetch warranties", error);
        } finally {
            setLoadingWarranties(false);
        }
    };

    useEffect(() => {
        fetchGrievances();
        fetchDealers();
        fetchWarranties();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validation
        if (!selectedDealer) {
            toast({
                title: "Dealer Required",
                description: "Please select the dealer/store related to your complaint",
                variant: "destructive",
            });
            return;
        }

        if (!category || !subject || !description) {
            toast({
                title: "Missing Fields",
                description: "Please fill all required fields",
                variant: "destructive",
            });
            return;
        }

        // Collect attachments
        const attachments = [attachment1, attachment2, attachment3].filter(Boolean) as File[];

        const selectedCategory = CATEGORIES.find(c => c.value === category);
        if (selectedCategory?.requiresAttachment && attachments.length === 0) {
            toast({
                title: "Attachment Required",
                description: "Please upload at least one photo/document for this category",
                variant: "destructive",
            });
            return;
        }

        setSubmitting(true);
        try {
            const formData = new FormData();
            formData.append("category", category);
            formData.append("subCategory", subCategory);
            formData.append("subject", subject);

            // Append warranty details to description if selected
            let finalDescription = description;
            if (category === 'warranty_issue' && selectedWarranty) {
                const warranty = warranties.find(w => w.id.toString() === selectedWarranty);
                if (warranty) {
                    const productDetails = typeof warranty.product_details === 'string'
                        ? JSON.parse(warranty.product_details || '{}')
                        : warranty.product_details || {};
                    const serialBtn = warranty.product_type === 'seat-cover' ? `UID: ${productDetails.uid || warranty.uid}` : `Serial: ${displaySerial(productDetails, warranty.uid)}`;

                    finalDescription += `\n\n[Related Warranty: ${warranty.car_make} ${warranty.car_model} - ${warranty.product_type} (${serialBtn})]\nWarranty ID: ${warranty.id}`;

                    // Also strictly send warranty_id if backend supports it (it might not, but good for future)
                    formData.append("warrantyId", selectedWarranty);
                    formData.append("warranty_id", selectedWarranty); // Try both standard conventions
                }
            }

            formData.append("description", finalDescription);
            if (selectedDealer) {
                formData.append("franchiseId", selectedDealer);
            }
            attachments.forEach(file => formData.append("attachments", file));

            const response = await api.post("/grievance", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });

            if (response.data.success) {
                toast({
                    title: "Complaint Submitted",
                    description: `Ticket ID: ${response.data.data.ticketId}`,
                });
                // Reset form
                setCategory("");
                setSubCategory("");
                setSubject("");
                setDescription("");
                setAttachment1(null);
                setAttachment2(null);
                setAttachment3(null);
                setSelectedDealer("");
                setActiveTab("list");
                fetchGrievances();
            }
        } catch (error: any) {
            toast({
                title: "Submission Failed",
                description: getErrorMessage(error, "Failed to submit complaint"),
                variant: "destructive",
            });
        } finally {
            setSubmitting(false);
        }
    };

    const handleRating = async (grievanceId: number) => {
        if (rating < 1 || rating > 5) {
            toast({
                title: "Invalid Rating",
                description: "Please select a rating between 1 and 5",
                variant: "destructive",
            });
            return;
        }

        try {
            const response = await api.put(`/grievance/${grievanceId}/rating`, {
                rating,
                feedback,
            });

            if (response.data.success) {
                toast({ title: "Thank you!", description: "Your feedback has been submitted" });
                setRatingGrievanceId(null);
                setRating(0);
                setFeedback("");
                fetchGrievances();
            }
        } catch (error: any) {
            toast({
                title: "Error",
                description: getErrorMessage((error as any), "Failed to submit rating"),
                variant: "destructive",
            });
        }
    };

    const fetchRemarksHistory = async (grievanceId: number) => {
        if (remarksHistoryMap[grievanceId]) return;

        setLoadingRemarksMap(prev => ({ ...prev, [grievanceId]: true }));
        try {
            const response = await api.get(`/grievance/${grievanceId}/remarks`);
            if (response.data.success) {
                setRemarksHistoryMap(prev => ({ ...prev, [grievanceId]: response.data.data }));
            }
        } catch (error) {
            console.error("Failed to fetch remarks history", error);
        } finally {
            setLoadingRemarksMap(prev => ({ ...prev, [grievanceId]: false }));
        }
    };

    const toggleRemarks = (grievanceId: number) => {
        const isExpanding = !expandedRemarks[grievanceId];
        setExpandedRemarks(prev => ({ ...prev, [grievanceId]: isExpanding }));
        if (isExpanding) {
            fetchRemarksHistory(grievanceId);
        }
    };

    const handleAttachmentChange = async (
        e: React.ChangeEvent<HTMLInputElement>,
        setter: React.Dispatch<React.SetStateAction<File | null>>,
        slotName: string
    ) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Matches the server's grievance limit. The old 5MB cap here rejected
        // every clip a phone produces, so video was effectively impossible.
        const MAX_FILE_SIZE = 20 * 1024 * 1024;
        const fmt = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

        let processedFile = file;

        if (isCompressibleImage(file) && file.size > 1024 * 1024) { // Compress if > 1MB
            setCompressing(true);
            try {
                processedFile = await compressImage(file, { maxSizeKB: 1024, quality: 0.8 });
            } catch (err) {
                console.error('Compression failed:', err);
                // Continue with original file if compression fails
            }
            setCompressing(false);
        } else if (isCompressibleVideo(file)) {
            /*
             * Phone video is routinely 30-80MB and would never have fit. Re-encode
             * in the browser first — 720p at 1.2 Mbps keeps a fault clearly visible
             * and keeps the audio, which is often the evidence.
             *
             * Re-encoding plays the clip through in real time, so tell the user
             * what is happening rather than leaving the form looking stuck.
             */
            if (!canCompressVideo()) {
                if (file.size > MAX_FILE_SIZE) {
                    toast({
                        title: "Video too large",
                        description: `This browser cannot compress video, and the file is ${fmt(file.size)}. Please record a shorter clip under ${fmt(MAX_FILE_SIZE)}.`,
                        variant: "destructive",
                    });
                    e.target.value = '';
                    return;
                }
            } else if (file.size > 5 * 1024 * 1024) {
                setCompressing(true);
                toast({
                    title: "Compressing video…",
                    description: "This plays the clip through once, so it takes about as long as the video itself.",
                });
                try {
                    processedFile = await compressVideo(file, { maxDimension: 1280 });
                    if (processedFile.size < file.size) {
                        toast({
                            title: "Video compressed",
                            description: `${fmt(file.size)} → ${fmt(processedFile.size)}`,
                        });
                    }
                } catch (err) {
                    console.error('Video compression failed:', err);
                } finally {
                    setCompressing(false);
                }
            }
        }

        if (processedFile.size > MAX_FILE_SIZE) {
            toast({
                title: "File Too Large",
                description: isCompressibleVideo(file)
                    ? `Still ${fmt(processedFile.size)} after compressing. Please record a shorter clip — the limit is ${fmt(MAX_FILE_SIZE)}.`
                    : `${slotName} must be under ${fmt(MAX_FILE_SIZE)}`,
                variant: "destructive",
            });
            e.target.value = '';
            return;
        }

        setter(processedFile);
        // Clear the input so the same file can be re-selected if needed
        e.target.value = '';
    };

    const selectedCategory = CATEGORIES.find(c => c.value === category);

    return (
        <div className="relative py-6 px-4 md:py-12 md:px-10">
            <div className="w-full md:container mx-auto max-w-4xl relative z-10">
                {/* Back Button - Top Left */}
                {/* Header Section */}
                <div className="mb-8 text-center px-4">
                    <h1 className="text-4xl md:text-6xl font-black text-slate-900 tracking-tighter mb-4">
                        Help & <span className="text-orange-600">Support</span>
                    </h1>
                    <p className="text-slate-500 text-lg font-bold max-w-2xl mx-auto">
                        Need assistance? Raise a ticket and our team will get back to you.
                    </p>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                    <TabsList className="grid w-full grid-cols-2 max-w-md mx-auto bg-white border border-orange-100 shadow-sm rounded-2xl overflow-hidden h-14 p-1">
                        <TabsTrigger value="list" className="rounded-xl data-[state=active]:bg-orange-600 data-[state=active]:text-white text-slate-400 font-bold transition-all duration-300">
                            <RefreshCw className="h-4 w-4 mr-2" />
                            My Tickets
                        </TabsTrigger>
                        <TabsTrigger value="new" className="rounded-xl data-[state=active]:bg-orange-600 data-[state=active]:text-white text-slate-400 font-bold transition-all duration-300">
                            <Send className="h-4 w-4 mr-2" />
                            Raise Ticket
                        </TabsTrigger>
                    </TabsList>

                    {/* List Tab */}
                    <TabsContent value="list" className="mt-6">
                        <div className="hidden md:flex justify-end mb-4">
                            <Button variant="outline" size="sm" onClick={fetchGrievances} disabled={loading}>
                                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                                Refresh
                            </Button>
                        </div>

                        {loading ? (
                            <div className="space-y-4">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                                        <div className="p-6 space-y-4">
                                            <div className="flex justify-between items-start">
                                                <div className="space-y-2">
                                                    <div className="h-5 w-48 bg-slate-200 rounded animate-pulse" />
                                                    <div className="h-3 w-32 bg-slate-100 rounded animate-pulse" />
                                                </div>
                                                <div className="flex gap-2">
                                                    <div className="h-6 w-20 bg-slate-100 rounded-full animate-pulse" />
                                                </div>
                                            </div>
                                            <div className="h-3 w-40 bg-slate-100 rounded animate-pulse" />
                                            <div className="h-4 w-full bg-slate-50 rounded animate-pulse" />
                                            <div className="h-4 w-3/4 bg-slate-50 rounded animate-pulse" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : grievances.length === 0 ? (
                            <Card className="glass-morphism border-none">
                                <CardContent className="py-20 text-center">
                                    <MessageSquare className="h-16 w-16 text-slate-600 mx-auto mb-4 opacity-50" />
                                    <p className="text-slate-400 text-lg">No active tickets found</p>
                                    <Button className="mt-4" onClick={() => setActiveTab("new")}>
                                        Submit Your First Complaint
                                    </Button>
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="space-y-4">
                                {grievances.map((g) => (
                                    <Card key={g.id}>
                                        <CardHeader className="pb-2">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <CardTitle className="text-lg">{g.subject}</CardTitle>
                                                    <CardDescription>
                                                        {g.ticket_id} • {formatToIST(g.created_at)}
                                                    </CardDescription>
                                                </div>
                                                <div className="flex gap-2">
                                                    <Badge className={STATUS_COLORS[g.status]}>
                                                        {g.status === 'rejected' ? 'Action Required' : g.status.replace("_", " ")}
                                                    </Badge>
                                                    {g.priority !== "normal" && (
                                                        <Badge variant="outline" className="text-amber-500 border-amber-500">
                                                            {g.priority}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="text-sm text-muted-foreground mb-2">
                                                Category: {CATEGORIES.find(c => c.value === g.category)?.label || g.category}
                                            </p>
                                            <p className="text-sm">{g.description}</p>

                                            {/* Unified Remarks History */}
                                            <div className="mt-4 pt-3 border-t border-slate-100">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="w-full justify-between text-slate-500 hover:text-orange-600 hover:bg-orange-50/50 rounded-xl px-2"
                                                    onClick={() => toggleRemarks(g.id)}
                                                >
                                                    <span className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
                                                        <Clock className="h-3.5 w-3.5" />
                                                        {expandedRemarks[g.id] ? "Hide History" : "View Response History"}
                                                    </span>
                                                    <Badge variant="secondary" className="bg-slate-100 text-slate-500 rounded-lg text-[10px]">
                                                        {(g.franchise_remarks ? 1 : 0) + (g.admin_remarks ? 1 : 0)} Responses
                                                    </Badge>
                                                </Button>

                                                {expandedRemarks[g.id] && (
                                                    <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                                        {loadingRemarksMap[g.id] ? (
                                                            <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-widest p-4 bg-slate-50/50 rounded-2xl border border-dashed">
                                                                <Loader2 className="h-3 w-3 animate-spin text-orange-500" />
                                                                Fetching timeline...
                                                            </div>
                                                        ) : !remarksHistoryMap[g.id] || remarksHistoryMap[g.id].length === 0 ? (
                                                            <div className="p-4 bg-slate-50/50 rounded-2xl border border-dashed text-center">
                                                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">No detailed history available</p>
                                                            </div>
                                                        ) : (
                                                            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar p-1">
                                                                {remarksHistoryMap[g.id].map((remark) => (
                                                                    <div key={remark.id} className={cn(
                                                                        "p-3 rounded-2xl border text-sm transition-all",
                                                                        remark.added_by === 'admin'
                                                                            ? "bg-blue-50/30 border-blue-100 ml-0 mr-4"
                                                                            : "bg-orange-50/30 border-orange-100 ml-4 mr-0"
                                                                    )}>
                                                                        <div className="flex items-center justify-between mb-1">
                                                                            <span className={cn(
                                                                                "text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded",
                                                                                remark.added_by === 'admin' ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"
                                                                            )}>
                                                                                {remark.added_by_name} ({remark.added_by})
                                                                            </span>
                                                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                                                                                {formatToIST(remark.created_at)}
                                                                            </span>
                                                                        </div>
                                                                        <p className="text-slate-700 leading-relaxed font-medium text-xs">
                                                                            {remark.remark}
                                                                        </p>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Rating Section */}
                                            {(g.status === "resolved" || g.status === "rejected") && !g.customer_rating && (
                                                <div className="mt-4 p-4 border-2 border-dashed border-green-100 bg-green-50/30 rounded-2xl">
                                                    {ratingGrievanceId === g.id ? (
                                                        <div className="space-y-3">
                                                            <Label>Rate your experience</Label>
                                                            <div className="flex gap-1">
                                                                {[1, 2, 3, 4, 5].map((star) => (
                                                                    <Star
                                                                        key={star}
                                                                        className={`h-6 w-6 cursor-pointer ${star <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
                                                                            }`}
                                                                        onClick={() => setRating(star)}
                                                                    />
                                                                ))}
                                                            </div>
                                                            <Textarea
                                                                placeholder="Additional feedback (optional)"
                                                                value={feedback}
                                                                onChange={(e) => setFeedback(e.target.value)}
                                                            />
                                                            <div className="flex gap-2">
                                                                <Button size="sm" onClick={() => handleRating(g.id)}>
                                                                    Submit Rating
                                                                </Button>
                                                                <Button size="sm" variant="outline" onClick={() => setRatingGrievanceId(null)}>
                                                                    Cancel
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <Button variant="outline" size="sm" onClick={() => setRatingGrievanceId(g.id)}>
                                                            <Star className="h-4 w-4 mr-2" />
                                                            Rate This Resolution
                                                        </Button>
                                                    )}
                                                </div>
                                            )}

                                            {g.customer_rating && (
                                                <div className="mt-3 flex items-center gap-2">
                                                    <span className="text-sm text-muted-foreground">Your rating:</span>
                                                    <div className="flex">
                                                        {[1, 2, 3, 4, 5].map((star) => (
                                                            <Star
                                                                key={star}
                                                                className={`h-4 w-4 ${star <= g.customer_rating! ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
                                                                    }`}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </TabsContent>

                    {/* Submit New Tab */}
                    <TabsContent value="new" className="mt-6">
                        <Card className="shadow-2xl border-0 bg-white dark:bg-slate-800 rounded-[30px] overflow-hidden">
                            <CardHeader className="pb-4 bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 px-6 pt-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-3 rounded-2xl bg-orange-100 dark:bg-orange-900/20">
                                        <HelpCircle className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl font-black text-slate-800">Submit a Complaint</CardTitle>
                                        <CardDescription className="text-slate-500">
                                            Tell us about your issue and we'll help resolve it
                                        </CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-6">
                                <form onSubmit={handleSubmit} className="space-y-6">
                                    {/* Dealer Selection */}
                                    <div className="space-y-2">
                                        <Label htmlFor="dealer" className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                            <Store className="h-4 w-4 text-orange-500" />
                                            Select Dealer/Store <span className="text-red-500">*</span>
                                        </Label>
                                        <Select value={selectedDealer} onValueChange={setSelectedDealer}>
                                            <SelectTrigger className="h-12 rounded-2xl border-2 border-slate-100 bg-slate-50/50 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10">
                                                <SelectValue placeholder={loadingDealers ? "Loading dealers..." : "Select the dealer/store"} />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-2xl">
                                                {dealers.filter(d => d.id).map((dealer) => (
                                                    <SelectItem key={dealer.id} value={dealer.id} className="rounded-xl">
                                                        <span className="font-medium">{dealer.store_name}</span>
                                                        <span className="text-muted-foreground ml-2 text-xs">
                                                            ({dealer.city}{dealer.address ? `, ${dealer.address}` : ''})
                                                        </span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[10px] text-slate-400">
                                            Select the dealer where you purchased or had service done
                                        </p>
                                    </div>

                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label htmlFor="category" className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                                <AlertTriangle className="h-4 w-4 text-amber-500" />
                                                Category <span className="text-red-500">*</span>
                                            </Label>
                                            <Select value={category} onValueChange={setCategory}>
                                                <SelectTrigger className="h-12 rounded-2xl border-2 border-slate-100 bg-slate-50/50 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10">
                                                    <SelectValue placeholder="Select category" />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-2xl">
                                                    {CATEGORIES.map((cat) => (
                                                        <SelectItem key={cat.value} value={cat.value} className="rounded-xl">
                                                            {cat.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {/* Warranty Selection - Only show if Warranty Issue is selected */}
                                        {category === 'warranty_issue' && (
                                            <div className="space-y-2 col-span-1 md:col-span-2 animate-in fade-in slide-in-from-top-2">
                                                <Label htmlFor="warranty" className="flex items-center gap-2 text-sm font-medium">
                                                    <Shield className="h-4 w-4 text-green-600" />
                                                    Select Warranty <span className="text-red-500">*</span>
                                                </Label>
                                                <Select value={selectedWarranty} onValueChange={setSelectedWarranty}>
                                                    <SelectTrigger className="h-12 bg-green-50/50 border-green-200">
                                                        <SelectValue placeholder={loadingWarranties ? "Loading warranties..." : "Select the relevant warranty"} />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {warranties.filter(w => w.id).map((w) => {
                                                            const productDetails = typeof w.product_details === 'string'
                                                                ? JSON.parse(w.product_details || '{}')
                                                                : w.product_details || {};
                                                            const title = `${w.car_make} ${w.car_model} - ${w.product_type}`;
                                                            const sub = w.product_type === 'seat-cover' ? `UID: ${productDetails.uid || w.uid}` : `Serial: ${displaySerial(productDetails, w.uid)}`;

                                                            return (
                                                                <SelectItem key={w.id} value={w.id.toString()}>
                                                                    <div className="flex flex-col text-left">
                                                                        <span className="font-medium flex items-center gap-2">
                                                                            <Car className="h-3 w-3 text-slate-400" /> {title}
                                                                        </span>
                                                                        <span className="text-xs text-muted-foreground ml-5">
                                                                            {sub} • {formatToIST(w.created_at).split(',')[0]}
                                                                        </span>
                                                                    </div>
                                                                </SelectItem>
                                                            );
                                                        })}
                                                    </SelectContent>
                                                </Select>
                                                {warranties.length === 0 && !loadingWarranties && (
                                                    <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl relative overflow-hidden">
                                                        <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                                                        <p className="text-xs text-amber-700 flex items-start gap-2">
                                                            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                                                            <span>
                                                                <strong>No active warranties found.</strong> If you recently registered a warranty, it may still be <strong>pending approval</strong> by the store or admin. You can still submit a complaint by providing your product details in the description below.
                                                            </span>
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="space-y-2">
                                            <Label htmlFor="subCategory" className="text-xs font-black text-slate-400 uppercase tracking-widest">
                                                Sub-Category (Optional)
                                            </Label>
                                            <Input
                                                id="subCategory"
                                                value={subCategory}
                                                onChange={(e) => setSubCategory(e.target.value)}
                                                placeholder="Specify further if needed"
                                                className="h-12 rounded-2xl border-2 border-slate-100 bg-slate-50/50 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="subject" className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                            <FileText className="h-4 w-4 text-indigo-500" />
                                            Subject <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            id="subject"
                                            value={subject}
                                            onChange={(e) => setSubject(e.target.value)}
                                            placeholder="Brief summary of your issue"
                                            maxLength={200}
                                            className="h-12 rounded-2xl border-2 border-slate-100 bg-slate-50/50 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="description" className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                            <MessageSquare className="h-4 w-4 text-green-500" />
                                            Description <span className="text-red-500">*</span>
                                        </Label>
                                        <Textarea
                                            id="description"
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            placeholder="Describe your issue in detail..."
                                            rows={5}
                                            maxLength={1000}
                                            className="rounded-2xl border-2 border-slate-100 bg-slate-50/50 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10 resize-none px-4 py-3"
                                        />
                                        <p className="text-[10px] text-slate-400 text-right">
                                            {description.length}/1000
                                        </p>
                                    </div>

                                    <div className="space-y-3">
                                        <Label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                            <Upload className="h-4 w-4 text-purple-500" />
                                            Attachments {selectedCategory?.requiresAttachment ? <span className="text-red-500">*</span> : <span className="text-slate-400 font-normal normal-case">(Optional)</span>}
                                        </Label>
                                        {/* Say what is allowed up front, rather than letting
                                            people discover it by being rejected. */}
                                        <p className="text-[11px] text-slate-400">
                                            Photos, video or PDF — up to 20MB each. Long videos are compressed automatically.
                                        </p>
                                        {compressing && (
                                            <div className="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 p-3 rounded-xl">
                                                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                                <span>Compressing… a video takes about as long as the clip itself, so please keep this page open.</span>
                                            </div>
                                        )}
                                        <div className="grid gap-3 grid-cols-3">
                                            {/* Attachment 1 */}
                                            <div className={`border-2 border-dashed rounded-2xl p-4 relative transition-all h-28 flex items-center justify-center ${attachment1 ? 'border-orange-400 bg-orange-50' : 'border-slate-200 hover:border-orange-300 hover:bg-orange-50/30'}`}>
                                                <input
                                                    type="file"
                                                    id="attachment1"
                                                    className="hidden"
                                                    accept="image/*,video/*,.pdf"
                                                    onChange={(e) => handleAttachmentChange(e, setAttachment1, "Attachment 1")}
                                                />
                                                {attachment1 ? (
                                                    <div className="flex flex-col items-center gap-1">
                                                        {isCompressibleVideo(attachment1) ? <Video className="h-6 w-6 text-orange-500" /> : <ImageIcon className="h-6 w-6 text-orange-500" />}
                                                        <span className="text-[10px] text-orange-600 font-bold truncate max-w-full text-center">{attachment1.name.length > 10 ? attachment1.name.substring(0, 10) + '...' : attachment1.name}</span>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg"
                                                            onClick={() => setAttachment1(null)}
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <label htmlFor="attachment1" className="flex flex-col items-center cursor-pointer">
                                                        <Upload className="h-6 w-6 text-slate-400 mb-1" />
                                                        <span className="text-[10px] text-slate-400 font-medium">Upload</span>
                                                    </label>
                                                )}
                                            </div>

                                            {/* Attachment 2 */}
                                            <div className={`border-2 border-dashed rounded-2xl p-4 relative transition-all h-28 flex items-center justify-center ${attachment2 ? 'border-orange-400 bg-orange-50' : 'border-slate-200 hover:border-orange-300 hover:bg-orange-50/30'}`}>
                                                <input
                                                    type="file"
                                                    id="attachment2"
                                                    className="hidden"
                                                    accept="image/*,video/*,.pdf"
                                                    onChange={(e) => handleAttachmentChange(e, setAttachment2, "Attachment 2")}
                                                />
                                                {attachment2 ? (
                                                    <div className="flex flex-col items-center gap-1">
                                                        {isCompressibleVideo(attachment2) ? <Video className="h-6 w-6 text-orange-500" /> : <ImageIcon className="h-6 w-6 text-orange-500" />}
                                                        <span className="text-[10px] text-orange-600 font-bold truncate max-w-full text-center">{attachment2.name.length > 10 ? attachment2.name.substring(0, 10) + '...' : attachment2.name}</span>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg"
                                                            onClick={() => setAttachment2(null)}
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <label htmlFor="attachment2" className="flex flex-col items-center cursor-pointer">
                                                        <Upload className="h-6 w-6 text-slate-400 mb-1" />
                                                        <span className="text-[10px] text-slate-400 font-medium">Upload</span>
                                                    </label>
                                                )}
                                            </div>

                                            {/* Attachment 3 */}
                                            <div className={`border-2 border-dashed rounded-2xl p-4 relative transition-all h-28 flex items-center justify-center ${attachment3 ? 'border-orange-400 bg-orange-50' : 'border-slate-200 hover:border-orange-300 hover:bg-orange-50/30'}`}>
                                                <input
                                                    type="file"
                                                    id="attachment3"
                                                    className="hidden"
                                                    accept="image/*,video/*,.pdf"
                                                    onChange={(e) => handleAttachmentChange(e, setAttachment3, "Attachment 3")}
                                                />
                                                {attachment3 ? (
                                                    <div className="flex flex-col items-center gap-1">
                                                        {isCompressibleVideo(attachment3) ? <Video className="h-6 w-6 text-orange-500" /> : <ImageIcon className="h-6 w-6 text-orange-500" />}
                                                        <span className="text-[10px] text-orange-600 font-bold truncate max-w-full text-center">{attachment3.name.length > 10 ? attachment3.name.substring(0, 10) + '...' : attachment3.name}</span>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg"
                                                            onClick={() => setAttachment3(null)}
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <label htmlFor="attachment3" className="flex flex-col items-center cursor-pointer">
                                                        <Upload className="h-6 w-6 text-slate-400 mb-1" />
                                                        <span className="text-[10px] text-slate-400 font-medium">Upload</span>
                                                    </label>
                                                )}
                                            </div>
                                        </div>
                                        {selectedCategory?.requiresAttachment && (
                                            <p className="text-[10px] text-amber-600 font-medium">
                                                At least one photo/document is required for {selectedCategory.label}
                                            </p>
                                        )}
                                    </div>

                                    <Button
                                        type="submit"
                                        disabled={submitting || compressing}
                                        className="w-full h-12 rounded-2xl bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white font-black uppercase tracking-widest shadow-xl shadow-orange-900/20 transition-all hover:translate-y-[-1px] active:translate-y-[0px]"
                                    >
                                        {submitting ? (
                                            <>
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                Submitting...
                                            </>
                                        ) : (
                                            <>
                                                <Send className="h-4 w-4 mr-2" />
                                                Submit Complaint
                                            </>
                                        )}
                                    </Button>
                                </form>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
};

export default GrievancePage;

