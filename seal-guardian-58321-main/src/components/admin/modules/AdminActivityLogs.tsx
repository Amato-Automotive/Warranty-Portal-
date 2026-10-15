import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Eye, Store, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import api from "@/lib/api";
import { formatToIST } from "@/lib/utils";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";

/** Labels for the fields a franchise / admin identity edit can change. */
const IDENTITY_FIELD_LABELS: Record<string, string> = {
    contact_name: 'Contact name',
    email: 'Email',
    phone: 'Phone',
    phone_number: 'Phone',
    store_name: 'Store name',
    address: 'Address',
    city: 'City',
    state: 'State',
    pincode: 'Pincode',
    gst_number: 'GST',
    area_head_name: 'Area head',
    asm: 'ASM',
    store_code: 'Store code',
    latitude: 'Latitude',
    longitude: 'Longitude',
};

export const AdminActivityLogs = () => {
    const { user } = useAuth();
    const { toast } = useToast();

    const [activityLogs, setActivityLogs] = useState<any[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);

    // Search & Sort State
    const [logSearch, setLogSearch] = useState('');
    const [logSortField, setLogSortField] = useState<'created_at' | 'action_type' | 'admin_name'>('created_at');
    const [logSortOrder, setLogSortOrder] = useState<'asc' | 'desc'>('desc');
    const [logDateFrom, setLogDateFrom] = useState('');
    const [logDateTo, setLogDateTo] = useState('');

    // The entry whose full history is open, and what was loaded for it.
    const [detailLog, setDetailLog] = useState<any | null>(null);
    const [timeline, setTimeline] = useState<any[]>([]);
    const [loadingDetail, setLoadingDetail] = useState(false);

    // Pagination State — totals come from the server, not the array length.
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const itemsPerPage = 20;

    /*
     * Every filter goes to the server.
     *
     * The list used to fetch the newest hundred entries once and then search,
     * filter and paginate that array. With twelve thousand entries in the log
     * that meant 99% of it was unreachable — asking for April returned nothing,
     * because April had never been fetched.
     */
    useEffect(() => {
        const t = setTimeout(() => fetchActivityLogs(), logSearch ? 350 : 0);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, logSearch, logDateFrom, logDateTo, logSortField, logSortOrder]);

    const fetchActivityLogs = async () => {
        setLoadingLogs(true);
        try {
            const params: Record<string, string> = {
                page: String(currentPage),
                limit: String(itemsPerPage),
                sortField: logSortField,
                sortOrder: logSortOrder,
            };
            if (logSearch.trim()) params.search = logSearch.trim();
            if (logDateFrom) params.dateFrom = logDateFrom;
            if (logDateTo) params.dateTo = logDateTo;

            const response = await api.get("/admin/activity-logs", { params });
            if (response.data.success) {
                setActivityLogs(response.data.logs);
                setTotalCount(response.data.pagination?.totalCount || 0);
                setTotalPages(response.data.pagination?.totalPages || 1);
            }
        } catch (error) {
            console.error("Failed to fetch activity logs:", error);
            toast({
                title: "Error",
                description: "Failed to fetch activity logs",
                variant: "destructive"
            });
        } finally {
            setLoadingLogs(false);
        }
    };

    /*
     * Open one entry's full history.
     *
     * The row itself is already in hand, so it is shown immediately and the
     * timeline fills in behind it — a log of a busy warranty can carry a dozen
     * entries, and waiting on that to show what was already on screen would be
     * a step backwards.
     */
    const openDetail = async (log: any) => {
        setDetailLog(log);
        setTimeline([]);
        setLoadingDetail(true);
        try {
            const res = await api.get(`/admin/activity-logs/${log.id}`);
            if (res.data.success) {
                setDetailLog(res.data.log);
                setTimeline(res.data.timeline || []);
            }
        } catch (error) {
            toast({
                title: "Could not load the history",
                description: "The entry is still shown, but its related activity could not be fetched.",
                variant: "destructive"
            });
        } finally {
            setLoadingDetail(false);
        }
    };

    /**
     * Date and time as two lines, for the narrow first column.
     *
     * `formatToIST` returns one string, which wrapped mid-value here and left
     * "am" stranded on its own line. Splitting them deliberately reads better
     * than a wider column would, and scanning a column of times is easier when
     * they are aligned under each other.
     */
    const formatStamp = (value: string) => {
        const d = new Date(
            typeof value === "string" && !value.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(value)
                ? value.replace(" ", "T") + "Z"
                : value
        );
        if (isNaN(d.getTime())) return { date: "—", time: "" };
        return {
            date: d.toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
            }),
            time: d.toLocaleTimeString("en-IN", {
                hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
            }),
        };
    };

    /** Guarded — one malformed blob should not take the page down. */
    const parseDetails = (raw: any): Record<string, any> | null => {
        try {
            return typeof raw === 'string' ? JSON.parse(raw || 'null') : raw ?? null;
        } catch {
            return null;
        }
    };

    /*
     * The name to print for a changed field.
     *
     * A seat cover carries a UID; PPF carries a manufacturer serial. Edits were
     * logged as "Serial Number" for both until today, so the label is corrected
     * on display rather than by rewriting history.
     */
    const fieldLabel = (field: string, productType?: string | null): string =>
        field === "Serial Number" && productType === "seat-cover"
            ? "UID"
            : field.replace(/_/g, " ");

    /*
     * A one-line summary of what an action actually did.
     *
     * At component scope so the detail dialog and each timeline entry show the
     * same sentence as the row they came from — nobody should have to read a
     * raw details object to learn what the row already told them.
     */
    const getActionDetails = (log: any) => {
        const details = parseDetails(log.details);
        if (!details) return null;

        /*
         * The warranty actions, which are most of the log by volume and
         * previously showed nothing at all — ten thousand rows reading only
         * "WARRANTY APPROVED" with no hint of whose warranty or why.
         */
        if (log.action_type?.startsWith('WARRANTY_') && log.action_type !== 'WARRANTY_UPDATED') {
            const bits = [details.customer_name, details.product_type].filter(Boolean);
            if (!bits.length && !details.rejection_reason) return null;
            return (
                <div className="text-xs text-slate-500 mt-1">
                    {bits.join(' · ')}
                    {details.rejection_reason && (
                        <span className="block text-red-500 italic mt-0.5">
                            "{details.rejection_reason}"
                        </span>
                    )}
                </div>
            );
        }
        if (log.action_type === 'VENDOR_REJECTED' && details.rejection_reason) {
            return (
                <div className="text-xs text-red-500 italic mt-1">"{details.rejection_reason}"</div>
            );
        }
        if (log.action_type === 'MANPOWER_APPROVED' || log.action_type === 'MANPOWER_DELETED') {
            const bits = [details.manpower_id, details.store_name].filter(Boolean);
            return bits.length
                ? <div className="text-xs text-slate-500 mt-1">{bits.join(' · ')}</div>
                : null;
        }
        if (log.action_type === 'CUSTOMER_MOBILE_LIMIT_UPDATED') {
            return (
                <div className="text-xs text-slate-500 mt-1">
                    Limit: <span className="font-medium">{details.allowed_registrations}</span>
                    {details.used_registrations !== undefined && ` (${details.used_registrations} used)`}
                    {details.reason && (
                        <span className="block text-slate-400 italic mt-0.5">"{details.reason}"</span>
                    )}
                </div>
            );
        }
        if (log.action_type?.includes('DISTRIBUTOR') && details.distributor_name) {
            return (
                <div className="text-xs text-slate-500 mt-1">
                    {log.action_type.includes('UNMAPPED') ? 'Unmapped from' : 'Mapped to'}:{' '}
                    <span className="font-medium">{details.distributor_name}</span>
                </div>
            );
        }
        if (log.action_type === 'STORE_CODE_UPDATED' && details.store_code) {
            return <div className="text-xs text-slate-500 mt-1 font-mono">{details.store_code}</div>;
        }
        if (log.action_type === 'GRIEVANCE_STATUS_UPDATED') {
            return <div className="text-xs text-slate-500 mt-1">Status: <span className="font-medium">{details.newStatus}</span></div>;
        }
        if (log.action_type === 'GRIEVANCE_ASSIGNED') {
            if (!details.assignedTo) return <div className="text-xs text-slate-500 mt-1">Unassigned</div>;
            return <div className="text-xs text-slate-500 mt-1">Assigned to: <span className="font-medium">{details.assignedTo}</span></div>;
        }
        if (log.action_type === 'GRIEVANCE_REMARK_ADDED') {
            return <div className="text-xs text-slate-500 mt-1 italic">"{details.remarks?.substring(0, 30)}{details.remarks?.length > 30 ? '...' : ''}"</div>;
        }
        if (log.action_type === 'GRIEVANCE_UPDATED') {
            const updates = [];
            if (details.status) updates.push(`Status: ${details.status}`);
            if (details.hasRemarks) updates.push('Added Remarks');
            if (details.hasNotes) updates.push('Added Internal Notes');
            return <div className="text-xs text-slate-500 mt-1">{updates.join(', ') || 'Updated details'}</div>;
        }
        if (log.action_type === 'SYSTEM_SETTING_UPDATED') {
            return <div className="text-xs text-slate-500 mt-1">Value updated</div>;
        }
        if (log.action_type === 'BROADCAST_SENT') {
            return <div className="text-xs text-slate-500 mt-1">To: {details.targetRole}</div>;
        }
        if (log.action_type === 'WARRANTY_UPDATED' && details.changes && Object.keys(details.changes).length > 0) {
            return (
                <div className="mt-1.5 space-y-0.5">
                    {Object.entries(details.changes).map(([field, val]: [string, any]) => (
                        <div key={field} className="text-xs flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-slate-600 capitalize">
                                {fieldLabel(field, log.target_product_type)}:
                            </span>
                            <span className="line-through text-red-400">{String(val.before ?? '—')}</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-green-600 font-medium">{String(val.after ?? '—')}</span>
                        </div>
                    ))}
                </div>
            );
        }
        // Franchise profile, store code, map pin and admin contact edits log
        // { field: { from, to } } — under details.changes, or at the top level
        // for ADMIN_CONTACT_UPDATED. Older rows carry no change set and fall
        // through to the plain row.
        const identityChanges = details.changes
            ?? (log.action_type === 'ADMIN_CONTACT_UPDATED' ? details : null);
        if (identityChanges && typeof identityChanges === 'object') {
            const rows = Object.entries(identityChanges).filter(([, v]: [string, any]) => v && 'from' in v && 'to' in v);
            if (rows.length === 0) {
                return details.changes
                    ? <div className="text-xs text-slate-400 mt-1">Saved with no changes</div>
                    : null;
            }
            return (
                <div className="mt-1.5 space-y-0.5">
                    {rows.map(([field, val]: [string, any]) => (
                        <div key={field} className="text-xs flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-slate-600">{IDENTITY_FIELD_LABELS[field] || field}:</span>
                            <span className="line-through text-red-400">{String(val.from ?? '—')}</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-green-600 font-medium">{String(val.to ?? '—')}</span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    // The server returns exactly the page being shown, already filtered
    // and sorted, so these are the rows to render.
    const paginatedLogs = activityLogs;
    const filteredLogs = activityLogs;

    // A changed filter means the current page number no longer means anything.
    useEffect(() => {
        setCurrentPage(1);
    }, [logSearch, logDateFrom, logDateTo, logSortField, logSortOrder]);

    return (
        <div className="space-y-6">
            {/* Search & Sort Controls */}
            <div className="flex flex-col xl:flex-row gap-4 justify-between xl:items-center">
                <div className="flex flex-col sm:flex-row gap-4 flex-1">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search by admin, action, target..."
                            className="w-full pl-10 pr-4 py-2 rounded-md border border-orange-100 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                            value={logSearch}
                            onChange={(e) => setLogSearch(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2 bg-white border border-orange-100 rounded-md px-2 py-1.5 sm:py-0">
                        <span className="text-xs text-slate-400 whitespace-nowrap">Date:</span>
                        <input
                            type="date"
                            className="text-xs border-none focus:ring-0 text-slate-600 p-0 bg-transparent"
                            value={logDateFrom}
                            onChange={e => setLogDateFrom(e.target.value)}
                        />
                        <span className="text-xs text-slate-400">-</span>
                        <input
                            type="date"
                            className="text-xs border-none focus:ring-0 text-slate-600 p-0 bg-transparent"
                            value={logDateTo}
                            onChange={e => setLogDateTo(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                    <select
                        className="px-3 py-2 rounded-md border border-orange-100 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                        value={logSortField}
                        onChange={(e) => setLogSortField(e.target.value as any)}
                    >
                        <option value="created_at">Sort by Date</option>
                        <option value="action_type">Sort by Action</option>
                        <option value="admin_name">Sort by Admin</option>
                    </select>
                    <Button
                        variant="outline"
                        size="sm"
                        className="border-orange-100 hover:bg-orange-50"
                        onClick={() => setLogSortOrder(logSortOrder === 'asc' ? 'desc' : 'asc')}
                    >
                        {logSortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}
                    </Button>
                </div>
            </div>

            <Card className="border-orange-100 shadow-sm">
                <CardHeader className="bg-orange-50/30 border-b border-orange-50 pb-4">
                    <CardTitle className="text-lg font-bold text-slate-800">System Activity Logs</CardTitle>
                    <CardDescription>
                        Audit trail of all administrative actions performed in the system.
                        {totalCount > 0 && (
                            <span className="block mt-0.5 text-slate-400">
                                {totalCount.toLocaleString("en-IN")}{" "}
                                {logSearch || logDateFrom || logDateTo ? "matching entries" : "entries"}
                                {totalPages > 1 && ` · page ${currentPage} of ${totalPages}`}
                            </span>
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {loadingLogs ? (
                        <div className="text-center py-12">
                            <Loader2 className="h-8 w-8 text-orange-400 animate-spin mx-auto mb-2" />
                            <p className="text-sm text-slate-500">Loading activity logs...</p>
                        </div>
                    ) : filteredLogs.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">No activity logs found matching your criteria.</div>
                    ) : (
                        <div className="relative w-full overflow-auto">
                            <table className="w-full text-sm text-left table-fixed">
                                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                                    {/* Widths are set explicitly: left to itself the
                                        browser gave Store more room than it needed
                                        and squeezed Action until its badge wrapped
                                        onto three lines. */}
                                    <tr>
                                        <th className="px-4 py-3 w-[140px] text-left font-semibold">Date &amp; Time</th>
                                        <th className="px-4 py-3 w-[200px] text-left font-semibold">Admin</th>
                                        <th className="px-4 py-3 w-[280px] text-left font-semibold">Action</th>
                                        <th className="px-4 py-3 w-[190px] text-left font-semibold">Store</th>
                                        <th className="px-4 py-3 text-left font-semibold">Target</th>
                                        <th className="px-2 py-3 w-[52px]"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                    {paginatedLogs.map((log: any) => (
                                            <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="px-4 py-3 align-top whitespace-nowrap">
                                                    <div className="text-slate-700">{formatStamp(log.created_at).date}</div>
                                                    <div className="text-xs text-slate-400">{formatStamp(log.created_at).time}</div>
                                                </td>
                                                <td className="px-4 py-3 align-top">
                                                    <div className="font-medium text-slate-900 truncate">{log.admin_name || 'Unknown'}</div>
                                                    <div className="text-xs text-slate-400 truncate">{log.admin_email}</div>
                                                </td>
                                                <td className="px-4 py-3 align-top">
                                                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${log.action_type.includes('APPROVED') || log.action_type.includes('CREATED')
                                                        ? 'bg-green-100 text-green-700'
                                                        : log.action_type.includes('REJECTED')
                                                            ? 'bg-red-100 text-red-700'
                                                            : log.action_type.includes('DELETED')
                                                                ? 'bg-gray-100 text-gray-700'
                                                                : 'bg-blue-100 text-blue-700'
                                                        } whitespace-nowrap`}>
                                                        {log.action_type.replace(/_/g, ' ')}
                                                    </span>
                                                    {getActionDetails(log)}
                                                </td>
                                                <td className="px-4 py-3 align-top">
                                                    {log.store_name ? (
                                                        <>
                                                            <div className="text-slate-700 font-medium truncate" title={log.store_name}>
                                                                {log.store_name}
                                                            </div>
                                                            {log.store_code && (
                                                                <div className="text-xs text-slate-400 font-mono">{log.store_code}</div>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <span className="text-slate-300">—</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 align-top">
                                                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                                        {log.target_type}
                                                    </div>
                                                    <div className="text-slate-700 truncate" title={log.target_name || log.target_id || ''}>
                                                        {log.target_name || log.target_id || '—'}
                                                    </div>
                                                </td>
                                                <td className="px-2 py-3 align-top">
                                                    <Button
                                                        variant="ghost" size="icon"
                                                        onClick={() => openDetail(log)}
                                                        title="View full activity"
                                                        aria-label="View full activity"
                                                        className="h-8 w-8 text-slate-400 hover:text-orange-600"
                                                    >
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                </td>
                                            </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Pagination */}
            {totalPages > 1 && (
                <Pagination className="mt-4">
                    <PaginationContent>
                        <PaginationItem>
                            <PaginationPrevious
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                aria-disabled={currentPage === 1}
                                className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            />
                        </PaginationItem>

                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                            .filter(page => {
                                return page === 1 ||
                                    page === totalPages ||
                                    Math.abs(page - currentPage) <= 1;
                            })
                            .map((page, index, array) => {
                                if (index > 0 && array[index - 1] !== page - 1) {
                                    return (
                                        <div key={`ellipsis-${page}`} className="flex items-center">
                                            <PaginationEllipsis />
                                            <PaginationItem>
                                                <PaginationLink
                                                    isActive={currentPage === page}
                                                    onClick={() => setCurrentPage(page)}
                                                    className="cursor-pointer"
                                                >
                                                    {page}
                                                </PaginationLink>
                                            </PaginationItem>
                                        </div>
                                    );
                                }

                                return (
                                    <PaginationItem key={page}>
                                        <PaginationLink
                                            isActive={currentPage === page}
                                            onClick={() => setCurrentPage(page)}
                                            className="cursor-pointer"
                                        >
                                            {page}
                                        </PaginationLink>
                                    </PaginationItem>
                                );
                            })}

                        <PaginationItem>
                            <PaginationNext
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                aria-disabled={currentPage === totalPages}
                                className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            />
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>
            )}

            {/* One entry in full, and every action taken on the same target. */}
            <Dialog open={Boolean(detailLog)} onOpenChange={(open) => !open && setDetailLog(null)}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {detailLog?.action_type?.replace(/_/g, " ")}
                        </DialogTitle>
                        <DialogDescription>
                            {detailLog?.target_type}
                            {detailLog?.target_name ? ` · ${detailLog.target_name}` : ""}
                        </DialogDescription>
                    </DialogHeader>

                    {detailLog && (
                        <div className="space-y-4">
                            {/* The same summary the list row shows — what was
                                actually done, not just the action's name. */}
                            {getActionDetails(detailLog) && (
                                <div className="rounded-xl border border-orange-100 bg-orange-50/50 px-4 py-3 [&_.text-xs]:text-sm [&_.mt-1]:mt-0 [&_.mt-1\.5]:mt-0">
                                    {getActionDetails(detailLog)}
                                </div>
                            )}

                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
                                <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">Admin</span>
                                    <span className="text-slate-800 font-medium text-right">
                                        {detailLog.admin_name || "Unknown"}
                                        {detailLog.admin_email && (
                                            <span className="block text-xs text-slate-400 font-normal">
                                                {detailLog.admin_email}
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">When</span>
                                    <span className="text-slate-800">{formatToIST(detailLog.created_at)}</span>
                                </div>
                                {detailLog.store_name && (
                                    <div className="flex justify-between gap-4">
                                        <span className="text-slate-500 flex items-center gap-1">
                                            <Store className="h-3 w-3" /> Store
                                        </span>
                                        <span className="text-slate-800 text-right">
                                            {detailLog.store_name}
                                            {detailLog.store_code && (
                                                <span className="block text-xs text-slate-400 font-mono">
                                                    {detailLog.store_code}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                )}
                                {detailLog.ip_address && (
                                    <div className="flex justify-between gap-4">
                                        <span className="text-slate-500">IP</span>
                                        <span className="text-slate-600 font-mono text-xs">{detailLog.ip_address}</span>
                                    </div>
                                )}
                            </div>

                            {/* Whatever the action recorded — a rejection reason,
                                an old and new value — rendered as it was stored. */}
                            {detailLog.details && (
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                                        What changed
                                    </p>
                                    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                                        {Object.entries(parseDetails(detailLog.details) || {}).map(([key, value]) => {
                                            /*
                                             * A warranty edit nests its fields under "changes", each as
                                             * {before, after}. Printing that object raw turned the most
                                             * useful row in the dialog into a wall of JSON, while the
                                             * strikethrough summary above it showed the same thing
                                             * legibly. Rendered here as its own rows instead.
                                             */
                                            const isChangeSet = key === "changes" &&
                                                value && typeof value === "object" && !Array.isArray(value);

                                            if (isChangeSet) {
                                                const entries = Object.entries(value as Record<string, any>);
                                                if (!entries.length) return null;
                                                return entries.map(([field, change]) => {
                                                    const before = change?.before ?? null;
                                                    const after = change?.after ?? null;


                                                    /*
                                                     * One input box, two meanings: a seat cover carries a
                                                     * pre-printed UID, PPF a manufacturer serial read off
                                                     * the product. Every edit was logged as "Serial Number"
                                                     * until today, which told an admin somebody had changed
                                                     * a seat cover's serial — a field seat covers do not
                                                     * have. Corrected here rather than by rewriting the
                                                     * stored rows: an audit trail should record what was
                                                     * written, not be edited afterwards.
                                                     */
                                                    const label = fieldLabel(field, detailLog.target_product_type);

                                                    return (
                                                        <div key={`${key}.${field}`} className="px-3 py-2 text-sm">
                                                            <span className="text-slate-500 capitalize">
                                                                {label}
                                                            </span>
                                                            <div className="flex items-center gap-2 flex-wrap mt-0.5">
                                                                <span className="line-through text-rose-400 break-all">
                                                                    {before === null || before === "" ? "—" : String(before)}
                                                                </span>
                                                                <span className="text-slate-300">→</span>
                                                                <span className="text-emerald-600 font-medium break-all">
                                                                    {after === null || after === "" ? "—" : String(after)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                });
                                            }

                                            return (
                                                <div key={key} className="flex justify-between gap-4 px-3 py-2 text-sm">
                                                    <span className="text-slate-500 capitalize">
                                                        {key.replace(/_/g, " ")}
                                                    </span>
                                                    <span className="text-slate-800 text-right break-all max-w-[60%]">
                                                        {value === null || value === ""
                                                            ? "—"
                                                            : typeof value === "object"
                                                                ? JSON.stringify(value)
                                                                : String(value)}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                                    <Clock className="h-3 w-3" />
                                    History
                                    {timeline.length > 0 && (
                                        <span className="text-slate-300 font-bold">
                                            ({timeline.length})
                                        </span>
                                    )}
                                </p>

                                {loadingDetail ? (
                                    <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
                                        <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
                                    </div>
                                ) : timeline.length <= 1 ? (
                                    <p className="text-sm text-slate-400 py-2">
                                        This is the only action recorded against this target.
                                    </p>
                                ) : (
                                    <ol className="relative border-l border-slate-200 ml-1.5 space-y-4 py-1">
                                        {timeline.map((entry) => {
                                            const isCurrent = entry.id === detailLog.id;
                                            return (
                                                <li key={entry.id} className="ml-5">
                                                    <span
                                                        className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white ${
                                                            isCurrent ? "bg-orange-500" : "bg-slate-300"
                                                        }`}
                                                    />
                                                    <p className={`text-sm ${isCurrent ? "font-bold text-slate-800" : "text-slate-600"}`}>
                                                        {entry.action_type?.replace(/_/g, " ")}
                                                    </p>
                                                    <p className="text-xs text-slate-400">
                                                        {formatToIST(entry.created_at)}
                                                        {entry.admin_name ? ` · ${entry.admin_name}` : ""}
                                                    </p>
                                                    {/* What that step did — a rejection
                                                        reason, a changed field — so the
                                                        history reads as events, not labels. */}
                                                    {getActionDetails(entry)}
                                                </li>
                                            );
                                        })}
                                    </ol>
                                )}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};
