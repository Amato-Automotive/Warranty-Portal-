import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Store, FileCheck, AlertCircle } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const AdminDashboardCharts = lazy(() => import("./AdminDashboardCharts"));

// Vibrant "Flat UI" palette - brighter and cleaner
const COLORS = {
    validated: '#2ecc71', // Emerald - Bright & Clean
    rejected: '#e74c3c', // Alizarin - Vibrant Red
    pending: '#f1c40f', // Sunflower - Rich Yellow
    pending_vendor: '#e67e22', // Carrot - Vivid Orange
    customer: '#3498db', // Peter River - Calm Blue
    franchise: '#9b59b6', // Amethyst - Light Purple
    total: '#d35400', // Pumpkin - Deep Orange
    default: '#95a5a6' // Concrete - Neutral
};

const DashboardChartsSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {[0, 1].map((index) => (
            <Card key={index} className="border-orange-100 shadow-sm h-[350px]">
                <CardHeader className="space-y-3">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-3 w-28" />
                </CardHeader>
                <CardContent className="h-[255px] flex items-end gap-3 px-8">
                    {[42, 68, 53, 82, 61, 75, 48].map((height, barIndex) => (
                        <Skeleton key={barIndex} className="flex-1 rounded-t-md" style={{ height: `${height}%` }} />
                    ))}
                </CardContent>
            </Card>
        ))}
    </div>
);

const DashboardOverviewSkeleton = () => (
    <div className="space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {Array.from({ length: 4 }, (_, index) => (
                <Card key={index} className="border-orange-100 shadow-sm">
                    <CardHeader className="space-y-0 pb-2">
                        <Skeleton className="h-4 w-24" />
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <Skeleton className="h-8 w-16" />
                        <Skeleton className="h-3 w-28" />
                    </CardContent>
                </Card>
            ))}
        </div>
        <DashboardChartsSkeleton />
    </div>
);

export const AdminHome = () => {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null);
    const hasRequestedStats = useRef(false);

    useEffect(() => {
        // React Strict Mode intentionally runs effects twice in development.
        // The overview should still make only one expensive stats request.
        if (hasRequestedStats.current) return;
        hasRequestedStats.current = true;
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            const response = await api.get("/admin/stats");
            if (response.data.success) {
                setStats(response.data.stats);
            }
        } catch (error) {
            console.error("Failed to fetch stats", error);
            toast({
                title: "Stats Fetch Failed",
                description: "Failed to fetch statistics",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <DashboardOverviewSkeleton />;
    }

    if (!stats) return null;

    // Prepare chart data
    const pieData = [
        { name: 'Approved', value: Number(stats.validatedWarranties || 0), color: COLORS.validated },
        { name: 'Action Required', value: Number(stats.rejectedWarranties || 0), color: COLORS.rejected },
        { name: 'Pending (Admin)', value: Number(stats.pendingApprovals || 0), color: COLORS.pending },
        { name: 'Pending (Vendor)', value: Number(stats.pendingVendorApprovals || 0), color: COLORS.pending_vendor },
    ].filter(item => item.value > 0);

    const monthlyData = (stats.monthlyStats || []).map((m: any) => ({
        ...m,
        total: Number(m.total || 0),
        approved: Number(m.approved || 0),
        rejected: Number(m.rejected || 0),
        pending: Number(m.pending_admin || 0) + Number(m.pending_vendor || 0),
    }));

    return (
        <div className="space-y-8">
            {/* Quick Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                <Card className="border-orange-100 shadow-sm hover:shadow-md transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Warranties</CardTitle>
                        <FileCheck className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalWarranties}</div>
                        <p className="text-xs text-muted-foreground mt-1">+{(pieData.find(d => d.name === 'Approved')?.value || 0)} approved</p>
                    </CardContent>
                </Card>
                <Card className="border-orange-100 shadow-sm hover:shadow-md transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Pending Actions</CardTitle>
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{Number(stats.pendingApprovals) + Number(stats.pendingVendorApprovals)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Requires attention</p>
                    </CardContent>
                </Card>
                <Card className="border-orange-100 shadow-sm hover:shadow-md transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Active Franchises</CardTitle>
                        <Store className="h-4 w-4 text-purple-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.activeFranchises}</div>
                        <p className="text-xs text-muted-foreground mt-1">With warranty, POSM, or complaint activity</p>
                    </CardContent>
                </Card>
                <Card className="border-orange-100 shadow-sm hover:shadow-md transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Customers</CardTitle>
                        <Users className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalCustomers}</div>
                        <p className="text-xs text-muted-foreground mt-1">Registered users</p>
                    </CardContent>
                </Card>
            </div>

            <Suspense fallback={<DashboardChartsSkeleton />}>
                <AdminDashboardCharts pieData={pieData} monthlyData={monthlyData} />
            </Suspense>
        </div>
    );
};
