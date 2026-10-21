import { useState, useEffect } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { formatToIST } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCw, MessageSquare, Search, Paperclip, Store, Users, Mail, Send, Clock, Plus } from "lucide-react";

interface Grievance {
    id: number;
    ticket_id: string;
    customer_name: string;
    customer_email: string;
    franchise_name: string | null;
    category: string;
    sub_category: string | null;
    subject: string;
    description: string;
    status: string;
    attachments: string;
    assigned_to: string | null;
    franchise_remarks: string | null;
    admin_remarks: string | null;
    admin_notes: string | null;
    customer_rating: number | null;
    customer_feedback: string | null;
    created_at: string;
    resolved_at: string | null;
    status_updated_at: string | null;
    franchise_address?: string;
    franchise_city?: string;
    source_type?: 'customer' | 'franchise';
    department?: string;
    department_details?: string;
}

interface AssignmentRecord {
    id: number;
    assignee_name: string;
    assignee_email: string;
    remarks: string | null;
    assignment_type: 'initial' | 'follow_up';
    email_sent_at: string;
    sent_by_name: string | null;
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

const CATEGORIES: Record<string, string> = {
    seat_cover: "Seat Cover",
    mats: "Mats",
    accessories: "Accessories",
    software_issue: "Software/Portal Issue",
    other: "Other",
};

const STATUS_COLORS: Record<string, string> = {
    submitted: "bg-gray-500",
    under_review: "bg-blue-500",
    in_progress: "bg-amber-500",
    resolved: "bg-green-500",
    rejected: "bg-red-500",
};

const AdminGrievances = () => {
    const { toast } = useToast();
    const [grievances, setGrievances] = useState<Grievance[]>([]);
    const [filteredGrievances, setFilteredGrievances] = useState<Grievance[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedGrievance, setSelectedGrievance] = useState<Grievance | null>(null);
    const [adminRemarks, setAdminRemarks] = useState("");
    const [adminNotes, setAdminNotes] = useState("");
    const [updating, setUpdating] = useState(false);

    // Filters
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");

    // Assignment Email State
    const [assigneeName, setAssigneeName] = useState("");
    const [assigneeEmail, setAssigneeEmail] = useState("");
    const [assigneeRemarks, setAssigneeRemarks] = useState("");
    const [estimatedCompletionDate, setEstimatedCompletionDate] = useState("");
    const [sendingEmail, setSendingEmail] = useState(false);
    const [assignmentHistory, setAssignmentHistory] = useState<AssignmentRecord[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [remarksHistory, setRemarksHistory] = useState<GrievanceRemark[]>([]);
    const [loadingRemarks, setLoadingRemarks] = useState(false);

    const [dialogTab, setDialogTab] = useState<'details' | 'assignment'>('details');

    const fetchGrievances = async () => {
        setLoading(true);
        try {
            const response = await api.get("/grievance/admin");
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

    useEffect(() => {
        fetchGrievances();
    }, []);

    useEffect(() => {
        let result = grievances.filter(g => g.source_type === 'franchise');

        // Search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            result = result.filter(g =>
                g.ticket_id.toLowerCase().includes(query) ||
                g.customer_name?.toLowerCase().includes(query) ||
                g.franchise_name?.toLowerCase().includes(query) ||
                g.subject.toLowerCase().includes(query) ||
                (CATEGORIES[g.category] || g.category).toLowerCase().includes(query)
            );
        }

        // Status filter
        if (statusFilter !== "all") {
            result = result.filter(g => g.status === statusFilter);
        }

        setFilteredGrievances(result);
    }, [searchQuery, statusFilter, grievances]);

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

    const handleOpenDetail = async (g: Grievance) => {
        setSelectedGrievance(g);
        setAdminRemarks(""); // Clear input when opening
        setAdminNotes(g.admin_notes || "");
        setAssigneeName(g.assigned_to || "");
        setAssigneeEmail("");
        setAssigneeRemarks("");
        setEstimatedCompletionDate("");
        setDialogTab('details');
        setAssignmentHistory([]);
        setRemarksHistory([]);

        // Fetch remarks history
        fetchRemarksHistory(g.id);

        // Fetch assignment history
        setLoadingHistory(true);
        try {
            const response = await api.get(`/grievance/${g.id}/assignments`);
            if (response.data.success) {
                setAssignmentHistory(response.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch assignment history:', error);
        } finally {
            setLoadingHistory(false);
        }
    };

    const handleSaveChanges = async () => {
        if (!selectedGrievance) return;

        // Validation: Public remarks mandatory for Resolved/Rejected if no previous remarks exist
        if (["resolved", "rejected"].includes(selectedGrievance.status) && !adminRemarks.trim() && remarksHistory.length === 0) {
            toast({
                title: "Validation Error",
                description: "Public remarks are required when resolving or rejecting.",
                variant: "destructive",
            });
            return;
        }

        setUpdating(true);
        try {
            await api.put(`/grievance/${selectedGrievance.id}/admin-update`, {
                status: selectedGrievance.status,
                admin_remarks: adminRemarks.trim() || undefined,
                admin_notes: adminNotes
            });

            toast({ title: "Saved", description: "Complaint status and remarks updated" });

            // If they just updated or added remarks, refresh the history instead of closing
            if (adminRemarks.trim()) {
                setAdminRemarks("");
                fetchRemarksHistory(selectedGrievance.id);
            } else {
                setSelectedGrievance(null);
            }
            fetchGrievances();
        } catch (error: any) {
            toast({
                title: "Error",
                description: getErrorMessage(error, "Failed to save changes"),
                variant: "destructive",
            });
        } finally {
            setUpdating(false);
        }
    };

    const handlePostRemark = async () => {
        if (!selectedGrievance || !adminRemarks.trim()) return;

        setUpdating(true);
        try {
            await api.put(`/grievance/${selectedGrievance.id}/remarks`, { remarks: adminRemarks.trim() });
            toast({ title: "Remark Posted", description: "Your response has been added to history" });
            setAdminRemarks("");
            fetchRemarksHistory(selectedGrievance.id);
            fetchGrievances(); // Refresh list to update counts
        } catch (error: any) {
            toast({
                title: "Error",
                description: getErrorMessage(error, "Failed to post remark"),
                variant: "destructive",
            });
        } finally {
            setUpdating(false);
        }
    };

    const handleStatusLocalUpdate = (status: string) => {
        if (selectedGrievance) {
            setSelectedGrievance({ ...selectedGrievance, status });
        }
    };

    const handleAssign = async (id: number, assignedTo: string) => {
        try {
            // Only update if changed (optional check, but good for perf)
            const current = grievances.find(g => g.id === id);
            if (current && current.assigned_to === assignedTo) return;

            await api.put(`/grievance/${id}/assign`, { assignedTo });
            toast({ title: "Assigned", description: "Complaint assigned successfully" });

            // Update local state
            setGrievances(prev => prev.map(g => g.id === id ? { ...g, assigned_to: assignedTo } : g));
            setFilteredGrievances(prev => prev.map(g => g.id === id ? { ...g, assigned_to: assignedTo } : g));
        } catch (error: any) {
            toast({
                title: "Error",
                description: "Failed to assign",
                variant: "destructive",
            });
            fetchGrievances(); // Revert
        }
    };

    const getStats = () => {
        const tabGrievances = grievances.filter(g => g.source_type === 'franchise');
        const total = tabGrievances.length;
        const open = tabGrievances.filter(g => !["resolved", "rejected"].includes(g.status)).length;
        const resolved = tabGrievances.filter(g => ["resolved", "rejected"].includes(g.status)).length;
        return { total, open, resolved };
    };

    const stats = getStats();

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold">Complaint Management</h2>
                    <p className="text-muted-foreground">Monitor and manage all customer complaints</p>
                </div>
                <Button variant="outline" onClick={fetchGrievances}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                </Button>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-3xl font-bold">{stats.total}</p>
                        <p className="text-sm text-muted-foreground">Total Complaints</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-3xl font-bold text-amber-500">{stats.open}</p>
                        <p className="text-sm text-muted-foreground">Open Cases</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-3xl font-bold text-green-500">{stats.resolved}</p>
                        <p className="text-sm text-muted-foreground">Resolved</p>
                    </CardContent>
                </Card>
            </div>


            <div className="flex flex-col md:flex-row gap-4 mb-6 justify-between items-center">
                <div className="flex gap-2 w-full md:w-auto">
                    <div className="relative w-full md:w-[300px]">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by ticket, name, category..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="submitted">Submitted</SelectItem>
                        <SelectItem value="under_review">Under Review</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Grievances Table/List */}
            {filteredGrievances.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">No complaints found</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="border rounded-lg overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="text-left p-3 text-sm font-medium w-12">S.No</th>
                                <th className="text-left p-3 text-sm font-medium">Date</th>
                                <th className="text-left p-3 text-sm font-medium">Ticket</th>
                                <th className="text-left p-3 text-sm font-medium">Raised By</th>
                                <th className="text-left p-3 text-sm font-medium">To Department</th>
                                <th className="text-left p-3 text-sm font-medium">Category</th>
                                <th className="text-left p-3 text-sm font-medium">Status</th>
                                <th className="text-left p-3 text-sm font-medium">Assigned To</th>
                                <th className="text-left p-3 text-sm font-medium">Last Update</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredGrievances.map((g, index) => (
                                <tr
                                    key={g.id}
                                    className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                                    onClick={() => handleOpenDetail(g)}
                                >
                                    <td className="p-3 text-sm text-muted-foreground">{index + 1}</td>
                                    <td className="p-3 text-sm">
                                        {formatToIST(g.created_at)}
                                    </td>
                                    <td className="p-3 font-mono text-sm">{g.ticket_id}</td>
                                    <td className="p-3">{g.customer_name}</td>
                                    <td className="p-3 text-sm text-muted-foreground">{g.franchise_name || "-"}</td>
                                    <td className="p-3">
                                        <Badge variant="outline">{CATEGORIES[g.category] || g.category}</Badge>
                                    </td>
                                    <td className="p-3">
                                        <Badge className={STATUS_COLORS[g.status]}>
                                            {g.status === 'rejected' ? 'Action Required' : g.status.replace("_", " ")}
                                        </Badge>
                                    </td>
                                    <td className="p-3 text-sm">
                                        {g.assigned_to || <span className="text-muted-foreground">Unassigned</span>}
                                    </td>
                                    <td className="p-3 text-xs text-muted-foreground">
                                        {g.status_updated_at ? formatToIST(g.status_updated_at) : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Detail Dialog */}
            <Dialog open={!!selectedGrievance} onOpenChange={() => setSelectedGrievance(null)}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    {selectedGrievance && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <span>{selectedGrievance.ticket_id}</span>
                                    <Badge className={STATUS_COLORS[selectedGrievance.status]}>
                                        {selectedGrievance.status === 'rejected' ? 'Action Required' : selectedGrievance.status.replace("_", " ")}
                                    </Badge>
                                </DialogTitle>
                                <DialogDescription>{selectedGrievance.subject}</DialogDescription>
                            </DialogHeader>

                            {/* Sub-Tabs */}
                            <Tabs value={dialogTab} onValueChange={(v) => setDialogTab(v as 'details' | 'assignment')} className="mt-4">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="details">Details</TabsTrigger>
                                    <TabsTrigger value="assignment" className="flex items-center gap-2">
                                        Assignment
                                        {assignmentHistory.length > 0 && (
                                            <Badge variant="secondary" className="h-5 px-1.5 text-xs">{assignmentHistory.length}</Badge>
                                        )}
                                    </TabsTrigger>
                                </TabsList>

                                {/* Details Tab */}
                                <TabsContent value="details" className="mt-4 space-y-4">
                                    {/* For Franchise Grievances - show clean "Raised By" section */}
                                    {selectedGrievance.source_type === 'franchise' ? (
                                        <div className="p-4 bg-muted rounded-lg">
                                            <h4 className="font-semibold mb-4 flex items-center gap-2 text-base border-b pb-2">
                                                <Store className="h-4 w-4" />
                                                Raised By
                                            </h4>
                                            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                                                <div>
                                                    <p className="text-muted-foreground text-xs mb-1">Store Name</p>
                                                    <p className="font-medium">{selectedGrievance.customer_name}</p>
                                                </div>
                                                <div>
                                                    <p className="text-muted-foreground text-xs mb-1">Email</p>
                                                    <p className="font-medium">{selectedGrievance.customer_email}</p>
                                                </div>
                                                {selectedGrievance.franchise_name && (
                                                    <div>
                                                        <p className="text-muted-foreground text-xs mb-1">Complaint For (Department)</p>
                                                        <p className="font-medium text-primary">{selectedGrievance.franchise_name}</p>
                                                    </div>
                                                )}
                                                {(selectedGrievance.franchise_address || selectedGrievance.franchise_city) && (
                                                    <div className="col-span-2">
                                                        <p className="text-muted-foreground text-xs mb-1">Address</p>
                                                        <p className="font-medium">
                                                            {[selectedGrievance.franchise_address, selectedGrievance.franchise_city].filter(Boolean).join(', ')}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        /* For Customer Grievances - show Customer and Franchise sections */
                                        <div className="grid md:grid-cols-2 gap-4">
                                            <div className="p-4 bg-muted rounded-lg">
                                                <h4 className="font-semibold mb-2 flex items-center gap-2">
                                                    <Users className="h-4 w-4" />
                                                    Customer
                                                </h4>
                                                <div className="text-sm space-y-1">
                                                    <p>{selectedGrievance.customer_name}</p>
                                                    <p className="text-muted-foreground">{selectedGrievance.customer_email}</p>
                                                </div>
                                            </div>
                                            <div className="p-4 bg-muted rounded-lg">
                                                <h4 className="font-semibold mb-2 flex items-center gap-2">
                                                    <Store className="h-4 w-4" />
                                                    Franchise
                                                </h4>
                                                <div className="text-sm space-y-1">
                                                    <p className="font-medium">{selectedGrievance.franchise_name || "Not specified"}</p>
                                                    {selectedGrievance.franchise_address && (
                                                        <p className="text-muted-foreground text-xs">{selectedGrievance.franchise_address}</p>
                                                    )}
                                                    {selectedGrievance.franchise_city && (
                                                        <p className="text-muted-foreground text-xs">{selectedGrievance.franchise_city}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <h4 className="font-semibold mb-2">Issue Details</h4>
                                        <div className="space-y-3 text-sm">
                                            <p><strong>Category:</strong> {CATEGORIES[selectedGrievance.category] || selectedGrievance.category}</p>
                                            {selectedGrievance.sub_category && (
                                                <p><strong>Sub-Category:</strong> {selectedGrievance.sub_category}</p>
                                            )}
                                            <p><strong>Subject:</strong> {selectedGrievance.subject}</p>
                                            <div>
                                                <p className="mb-1"><strong>Description:</strong></p>
                                                <p className="whitespace-pre-wrap bg-muted p-3 rounded">{selectedGrievance.description || "No description provided"}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {selectedGrievance.attachments && (() => {
                                        try {
                                            const attachments = JSON.parse(selectedGrievance.attachments || "[]");
                                            if (Array.isArray(attachments) && attachments.length > 0) {
                                                return (
                                                    <div>
                                                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                                                            <Paperclip className="h-4 w-4" />
                                                            Attachments
                                                        </h4>
                                                        <div className="flex flex-wrap gap-2">
                                                            {attachments.map((url: string, idx: number) => (
                                                                <a key={idx} href={url} target="_blank" rel="noopener noreferrer"
                                                                    className="text-sm px-3 py-1 bg-primary/10 text-primary rounded hover:bg-primary/20">
                                                                    Attachment {idx + 1}
                                                                </a>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            }
                                        } catch { return null; }
                                        return null;
                                    })()}

                                    {/* Response History / Remarks Log */}
                                    <div className="space-y-4 pt-4 border-t">
                                        <h4 className="font-semibold flex items-center gap-2">
                                            <Clock className="h-4 w-4" />
                                            Response History
                                        </h4>

                                        {loadingRemarks ? (
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Loading history...
                                            </div>
                                        ) : remarksHistory.length === 0 ? (
                                            <div className="bg-muted/30 rounded-lg p-6 text-center border border-dashed">
                                                <p className="text-sm text-muted-foreground">No response recorded yet</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                                {remarksHistory.map((remark) => (
                                                    <div key={remark.id} className={`p-3 rounded-lg border text-sm ${remark.added_by === 'admin'
                                                        ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-100"
                                                        : "bg-amber-50/50 dark:bg-amber-950/20 border-amber-100 ml-6"
                                                        }`}>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${remark.added_by === 'admin' ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                                                                }`}>
                                                                {remark.added_by_name} ({remark.added_by})
                                                            </span>
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {formatToIST(remark.created_at)}
                                                            </span>
                                                        </div>
                                                        <p className="leading-relaxed">{remark.remark}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap gap-2 pt-2">
                                        <span className="text-sm font-medium mr-2">Update Status:</span>
                                        {["under_review", "in_progress", "resolved"].map(status => (
                                            <Button key={status} size="sm"
                                                variant={selectedGrievance.status === status ? "default" : "outline"}
                                                onClick={() => handleStatusLocalUpdate(status)}>
                                                {status.replace("_", " ")}
                                            </Button>
                                        ))}
                                    </div>

                                    <div>
                                        <label className="text-sm font-medium">Add Public Remark (Visible to Franchise & Customer)</label>
                                        <Textarea value={adminRemarks} onChange={(e) => setAdminRemarks(e.target.value)}
                                            placeholder="Add a new response or resolution details..." rows={3} className="mt-1" />
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={handlePostRemark}
                                            disabled={updating || !adminRemarks.trim()}
                                            className="mt-2 w-full bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                                        >
                                            {updating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                                            Post Official Remark
                                        </Button>
                                    </div>

                                    <div>
                                        <div className="flex justify-between">
                                            <label className="text-sm font-medium">Internal Notes (Private)</label>
                                            <span className="text-xs text-muted-foreground">{adminNotes.length}/1000</span>
                                        </div>
                                        <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)}
                                            maxLength={1000} placeholder="Private observations, hidden from vendor..."
                                            rows={3} className="mt-1 bg-yellow-50/50" />
                                    </div>

                                    <Button onClick={handleSaveChanges} disabled={updating} className="w-full">
                                        {updating ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>) : "Save Changes"}
                                    </Button>
                                </TabsContent>

                                {/* Assignment Tab */}
                                <TabsContent value="assignment" className="mt-4 space-y-4">
                                    <div className="p-4 border rounded-lg bg-blue-50/50 dark:bg-blue-950/20">
                                        <h4 className="font-semibold mb-3 flex items-center gap-2">
                                            <Mail className="h-4 w-4" />
                                            Send Assignment Email
                                        </h4>
                                        <div className="grid md:grid-cols-3 gap-3">
                                            <div>
                                                <label className="text-xs text-muted-foreground">Assignee Name</label>
                                                <Input value={assigneeName} onChange={(e) => setAssigneeName(e.target.value)}
                                                    placeholder="Enter name" className="mt-1" />
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted-foreground">Assignee Email</label>
                                                <Input type="email" value={assigneeEmail} onChange={(e) => setAssigneeEmail(e.target.value)}
                                                    placeholder="email@example.com" className="mt-1" />
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted-foreground">Expected Resolution Date</label>
                                                <Input type="date" value={estimatedCompletionDate}
                                                    min={new Date().toISOString().split('T')[0]}
                                                    onChange={(e) => setEstimatedCompletionDate(e.target.value)}
                                                    className="mt-1" />
                                            </div>
                                        </div>
                                        <div className="mt-3">
                                            <label className="text-xs text-muted-foreground">Remarks for Assignee (Optional)</label>
                                            <Textarea value={assigneeRemarks} onChange={(e) => setAssigneeRemarks(e.target.value)}
                                                placeholder="Any additional notes or instructions..." rows={2} className="mt-1" />
                                        </div>
                                        <Button
                                            onClick={async () => {
                                                if (!assigneeName.trim() || !assigneeEmail.trim()) {
                                                    toast({ title: "Missing Info", description: "Please enter both name and email", variant: "destructive" });
                                                    return;
                                                }
                                                setSendingEmail(true);
                                                try {
                                                    const response = await api.post(`/grievance/${selectedGrievance.id}/send-assignment-email`, {
                                                        assigneeName: assigneeName.trim(),
                                                        assigneeEmail: assigneeEmail.trim(),
                                                        remarks: assigneeRemarks.trim() || undefined,
                                                        estimatedCompletionDate: estimatedCompletionDate || undefined,
                                                        assignmentType: assignmentHistory.length === 0 ? 'initial' : 'follow_up'
                                                    });
                                                    if (response.data.success) {
                                                        toast({ title: "Email Sent", description: response.data.message });
                                                        setSelectedGrievance(prev => prev ? { ...prev, assigned_to: assigneeName.trim() } : null);
                                                        setGrievances(prev => prev.map(g => g.id === selectedGrievance.id ? { ...g, assigned_to: assigneeName.trim() } : g));
                                                        setFilteredGrievances(prev => prev.map(g => g.id === selectedGrievance.id ? { ...g, assigned_to: assigneeName.trim() } : g));
                                                        const historyResponse = await api.get(`/grievance/${selectedGrievance.id}/assignments`);
                                                        if (historyResponse.data.success) setAssignmentHistory(historyResponse.data.data);
                                                        setAssigneeEmail("");
                                                        setAssigneeRemarks("");
                                                    }
                                                } catch (error: any) {
                                                    toast({ title: "Error", description: getErrorMessage(error, "Failed to send email"), variant: "destructive" });
                                                } finally {
                                                    setSendingEmail(false);
                                                }
                                            }}
                                            disabled={sendingEmail || !assigneeName.trim() || !assigneeEmail.trim()}
                                            className="w-full mt-3"
                                        >
                                            {sendingEmail ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...</>) :
                                                (<><Send className="h-4 w-4 mr-2" /> {assignmentHistory.length === 0 ? 'Send Initial Assignment' : 'Send Follow-up'}</>)}
                                        </Button>
                                    </div>

                                    <div>
                                        <h4 className="font-semibold mb-3 flex items-center gap-2">
                                            <Clock className="h-4 w-4" />
                                            Assignment History
                                        </h4>
                                        {loadingHistory ? (
                                            <div className="flex items-center justify-center py-8">
                                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                            </div>
                                        ) : assignmentHistory.length === 0 ? (
                                            <div className="text-center py-8 text-muted-foreground text-sm border border-dashed rounded-lg">
                                                No assignments yet. Send the first assignment above.
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {assignmentHistory.map((record) => (
                                                    <div key={record.id}
                                                        className={`p-3 rounded-lg border-l-4 ${record.assignment_type === 'initial'
                                                            ? 'bg-blue-50 dark:bg-blue-950/30 border-l-blue-500'
                                                            : 'bg-amber-50 dark:bg-amber-950/30 border-l-amber-500'}`}>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <div className="flex items-center gap-2">
                                                                <Badge variant="outline" className="text-xs">
                                                                    {record.assignment_type === 'initial' ? '🔵 Initial' : '🟡 Follow-up'}
                                                                </Badge>
                                                                <span className="font-medium text-sm">{record.assignee_name}</span>
                                                            </div>
                                                            <span className="text-xs text-muted-foreground">
                                                                {new Date(record.email_sent_at).toLocaleString('en-IN', {
                                                                    day: 'numeric', month: 'short', year: 'numeric',
                                                                    hour: '2-digit', minute: '2-digit'
                                                                })}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground">{record.assignee_email}</p>
                                                        {record.remarks && (
                                                            <p className="text-sm mt-2 p-2 bg-white/50 dark:bg-black/20 rounded">"{record.remarks}"</p>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>
                            </Tabs>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default AdminGrievances;
