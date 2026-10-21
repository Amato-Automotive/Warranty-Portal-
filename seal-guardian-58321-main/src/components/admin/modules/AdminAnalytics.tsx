import { useState, useEffect, useMemo, useRef } from 'react';
import api from '@/lib/api';
import {
    ShieldCheck, MessageSquare, Package, Box, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { AdminModule } from '../layout/AdminSidebar';

// Modular Components
import { StatsCard, StoreIcon } from '../analytics/StatsCard';
import { TrendSection } from '../analytics/TrendSection';
import { ProductDistributionSection } from '../analytics/ProductDistributionSection';
import { GeographicSection } from '../analytics/GeographicSection';
import { FranchiseLeaderboard } from '../analytics/FranchiseLeaderboard';
import { FraudAnalysisSection } from '../analytics/FraudAnalysisSection';
import { FraudAnalysisModal } from '../analytics/FraudAnalysisModal';
import { LeadCharts, type LeadChartsData } from '../analytics/LeadCharts';

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const YEARS = ["2024", "2025", "2026"];

const LINE_CONFIG = [
    { id: 'total', name: 'Total Registrations', color: '#64748b' },
    { id: 'approved', name: 'Approved', color: '#10b981' },
    { id: 'pending_admin', name: 'Pending Admin', color: '#f59e0b' },
    { id: 'pending_vendor', name: 'Pending Vendor', color: '#3b82f6' },
    { id: 'rejected', name: 'Rejected', color: '#ef4444' }
];

export const AdminAnalytics = ({ onNavigate }: { onNavigate: (module: AdminModule) => void }) => {
    const [summary, setSummary] = useState<any>(null);
    /* The Lead Management charts. Null until loaded; stays null for an admin
       without access to leads, and the section is simply not shown. */
    const [leadCharts, setLeadCharts] = useState<LeadChartsData | null>(null);
    useEffect(() => {
        api.get('/asm/leads/list', { params: { charts_only: '1' } })
            .then(res => { if (res.data?.success && res.data.charts) setLeadCharts(res.data.charts); })
            .catch(() => { /* no leads permission, or offline: the rest of the page stands */ });
    }, []);
    const [timeSeries, setTimeSeries] = useState<any>(null);
    const [products, setProducts] = useState<any[]>([]);
    const [franchises, setFranchises] = useState<any[]>([]);
    const [fraudData, setFraudData] = useState<any>(null);
    const [selectedView, setSelectedView] = useState<string | null>('franchise');
    const [visibleLines, setVisibleLines] = useState<string[]>(['total', 'approved', 'pending_admin', 'pending_vendor', 'rejected']);

    // Trend Section Filters
    const [trendPeriod, setTrendPeriod] = useState<string>('year');
    const [trendYear, setTrendYear] = useState<string>(new Date().getFullYear().toString());
    const [trendMonth, setTrendMonth] = useState<string>((new Date().getMonth() + 1).toString());
    const [trendStart, setTrendStart] = useState<string>(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]);
    const [trendEnd, setTrendEnd] = useState<string>(new Date().toISOString().split('T')[0]);

    // Product Section Filters
    const [prodPeriod, setProdPeriod] = useState<string>('year');
    const [prodYear, setProdYear] = useState<string>(new Date().getFullYear().toString());
    const [prodMonth, setProdMonth] = useState<string>((new Date().getMonth() + 1).toString());
    const [prodStart, setProdStart] = useState<string>(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]);
    const [prodEnd, setProdEnd] = useState<string>(new Date().toISOString().split('T')[0]);

    // Geographic Section Filters
    const [geoPeriod, setGeoPeriod] = useState<string>('year');
    const [geoMetric, setGeoMetric] = useState<'warranty' | 'grievance' | 'posm' | 'product'>('warranty');
    const [geoYear, setGeoYear] = useState<string>(new Date().getFullYear().toString());
    const [geoMonth, setGeoMonth] = useState<string>((new Date().getMonth() + 1).toString());
    const [geoStart, setGeoStart] = useState<string>(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]);
    const [geoEnd, setGeoEnd] = useState<string>(new Date().toISOString().split('T')[0]);
    const [selectedState, setSelectedState] = useState<string | null>(null);
    const [expandedItem, setExpandedItem] = useState<string | null>(null);
    const [geoData, setGeoData] = useState<any[]>([]);
    const [geoLoading, setGeoLoading] = useState(false);

    // Fraud Filters
    const [fraudFlag, setFraudFlag] = useState('all');
    const [fraudLoading, setFraudLoading] = useState(false);
    const [selectedFranchise, setSelectedFranchise] = useState<string | null>(null);
    const [drilldownData, setDrilldownData] = useState<any>(null);
    const [drilldownLoading, setDrilldownLoading] = useState(false);

    const [trendLoading, setTrendLoading] = useState(false);
    const [prodLoading, setProdLoading] = useState(false);
    const lastTrendRequest = useRef('');
    const lastFraudRequest = useRef('');
    const lastProductRequest = useRef('');
    const lastGeoRequest = useRef('');

    // By store id: stores share names, so a name would merge their figures.
    const fetchFranchiseDrilldown = async (storeId: string, name: string) => {
        setSelectedFranchise(name);
        setDrilldownData(null);
        setDrilldownLoading(true);
        try {
            const response = await api.get(`/admin/analytics/fraud/franchise/${encodeURIComponent(storeId)}`);
            if (response.data.success) {
                setDrilldownData(response.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch fraud drilldown:', error);
        } finally {
            setDrilldownLoading(false);
        }
    };

    const trendTotals = useMemo(() => {
        if (!timeSeries?.totals) return { total: 0, approved: 0, pending_admin: 0, pending_vendor: 0, rejected: 0 };
        return {
            total: Number(timeSeries.totals.total || 0),
            approved: Number(timeSeries.totals.approved || 0),
            pending_admin: Number(timeSeries.totals.pending_admin || 0),
            pending_vendor: Number(timeSeries.totals.pending_vendor || 0),
            rejected: Number(timeSeries.totals.rejected || 0)
        };
    }, [timeSeries]);

    const toggleLine = (line: string) => {
        setVisibleLines(prev =>
            prev.includes(line) ? prev.filter(l => l !== line) : [...prev, line]
        );
    };

    const fetchTrendData = async () => {
        try {
            setTrendLoading(true);
            const params = new URLSearchParams({
                period: trendPeriod,
                year: trendYear,
                month: trendMonth,
                startDate: trendStart,
                endDate: trendEnd
            });

            const [sumRes, timeRes, franRes] = await Promise.all([
                api.get(`/admin/analytics/summary?${params}`),
                api.get(`/admin/analytics/time-series?${params}`),
                api.get(`/admin/analytics/franchises?${params}`)
            ]);

            if (sumRes.data.success) setSummary(sumRes.data.data);
            if (timeRes.data.success) setTimeSeries(timeRes.data.data);
            if (franRes.data.success) setFranchises(franRes.data.data);
        } catch (error) {
            console.error('Fetch trend error:', error);
        } finally {
            setTrendLoading(false);
        }
    };

    const fetchFraudData = async () => {
        try {
            setFraudLoading(true);
            const params = new URLSearchParams({
                period: trendPeriod,
                year: trendYear,
                month: trendMonth,
                startDate: trendStart,
                endDate: trendEnd,
                flag: fraudFlag
            });

            const res = await api.get(`/admin/analytics/fraud?${params}`);
            if (res.data.success) setFraudData(res.data.data);
        } catch (error) {
            console.error('Fetch fraud error:', error);
        } finally {
            setFraudLoading(false);
        }
    };

    const fetchProdData = async () => {
        try {
            setProdLoading(true);
            const params = new URLSearchParams({
                period: prodPeriod,
                year: prodYear,
                month: prodMonth,
                startDate: prodStart,
                endDate: prodEnd
            });

            const prodRes = await api.get(`/admin/analytics/products?${params}`);
            if (prodRes.data.success) setProducts(prodRes.data.data);
        } catch (error) {
            console.error('Fetch products error:', error);
        } finally {
            setProdLoading(false);
        }
    };

    const fetchGeoData = async () => {
        try {
            setGeoLoading(true);
            const params = new URLSearchParams({
                period: geoPeriod,
                year: geoYear,
                month: geoMonth,
                startDate: geoStart,
                endDate: geoEnd
            });
            if (selectedState) params.append('state', selectedState);

            const res = await api.get(`/admin/analytics/geographic?${params}`);
            if (res.data.success) setGeoData(res.data.data);
        } catch (error) {
            console.error('Fetch geo error:', error);
        } finally {
            setGeoLoading(false);
        }
    };

    useEffect(() => {
        const requestKey = [trendPeriod, trendYear, trendMonth, trendStart, trendEnd].join('|');
        if (lastTrendRequest.current === requestKey) return;
        lastTrendRequest.current = requestKey;
        fetchTrendData();
    }, [trendPeriod, trendYear, trendMonth, trendStart, trendEnd]);

    useEffect(() => {
        const requestKey = [trendPeriod, trendYear, trendMonth, trendStart, trendEnd, fraudFlag].join('|');
        if (lastFraudRequest.current === requestKey) return;
        lastFraudRequest.current = requestKey;
        fetchFraudData();
    }, [trendPeriod, trendYear, trendMonth, trendStart, trendEnd, fraudFlag]);

    useEffect(() => {
        const requestKey = [prodPeriod, prodYear, prodMonth, prodStart, prodEnd].join('|');
        if (lastProductRequest.current === requestKey) return;
        lastProductRequest.current = requestKey;
        fetchProdData();
    }, [prodPeriod, prodYear, prodMonth, prodStart, prodEnd]);

    useEffect(() => {
        const requestKey = [geoPeriod, geoYear, geoMonth, geoStart, geoEnd, selectedState || ''].join('|');
        if (lastGeoRequest.current === requestKey) return;
        lastGeoRequest.current = requestKey;
        fetchGeoData();
    }, [geoPeriod, geoYear, geoMonth, geoStart, geoEnd, selectedState]);

    const getViewDetails = () => {
        switch (selectedView) {
            case 'franchise':
                return [
                    { label: 'Approved', value: summary?.franchise?.approved, color: 'text-emerald-500' },
                    { label: 'Pending', value: summary?.franchise?.pending, color: 'text-amber-500' },
                    { label: 'Rejected', value: summary?.franchise?.disapproved, color: 'text-rose-500' },
                    { label: 'In Warranty', value: summary?.participation?.warranty_participation, color: 'text-blue-500' },
                    { label: 'In Complaint', value: summary?.participation?.grievance_participation, color: 'text-red-500' },
                    { label: 'In POSM', value: summary?.participation?.posm_participation, color: 'text-purple-500' }
                ];
            case 'warranty':
                return [
                    { label: 'Validated', value: summary?.warranty?.validated, color: 'text-emerald-500' },
                    { label: 'Pending Admin', value: summary?.warranty?.pending_admin, color: 'text-amber-500' },
                    { label: 'Pending Vendor', value: summary?.warranty?.pending_vendor, color: 'text-blue-500' },
                    { label: 'Rejected', value: summary?.warranty?.rejected, color: 'text-rose-500' }
                ];
            case 'grievance':
                return [
                    { label: 'Submitted', value: summary?.grievance?.submitted, color: 'text-blue-500' },
                    { label: 'In Progress', value: summary?.grievance?.in_progress, color: 'text-amber-500' },
                    { label: 'Resolved', value: summary?.grievance?.resolved, color: 'text-emerald-500' },
                    { label: 'Rejected', value: summary?.grievance?.rejected, color: 'text-rose-500' },
                    { label: 'Participating', value: summary?.participation?.grievance_participation, color: 'text-red-500' },
                    { label: 'Total Tickets', value: summary?.grievance?.total, color: 'text-slate-600' }
                ];
            case 'posm':
                return [
                    { label: 'Open', value: summary?.posm?.open, color: 'text-blue-500' },
                    { label: 'Processing', value: summary?.posm?.processing, color: 'text-amber-500' },
                    { label: 'Shipped/Deliv.', value: summary?.posm?.shipped, color: 'text-emerald-500' },
                    { label: 'Closed/Rej.', value: summary?.posm?.closed, color: 'text-rose-500' },
                    { label: 'Participating', value: summary?.participation?.posm_participation, color: 'text-purple-500' },
                    { label: 'Total Requests', value: summary?.posm?.total, color: 'text-slate-600' }
                ];
            default:
                return [];
        }
    };

    if (!summary) {
        return (
            <div className="p-8 space-y-8 bg-[#fafafa] min-h-screen">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} className="h-32 rounded-[32px] bg-slate-100" />
                    ))}
                </div>
                <Skeleton className="h-[500px] rounded-[40px] bg-slate-100" />
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-20">
            <div className="flex justify-between items-center bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">Analytics Command Center</h1>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Strategic Performance & Fraud Monitoring</p>
                </div>
            </div>
            {/* Top Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard
                    title="Total Franchises"
                    value={summary?.franchise?.total}
                    icon={StoreIcon}
                    trend="+12%"
                    trendUp={true}
                    isActive={selectedView === 'franchise'}
                    onClick={() => setSelectedView('franchise')}
                />
                <StatsCard
                    title="Warranty Management"
                    value={summary?.warranty?.total}
                    icon={ShieldCheck}
                    trend="84%"
                    isActive={selectedView === 'warranty'}
                    onClick={() => setSelectedView('warranty')}
                />
                <StatsCard
                    title="Complaint Rate"
                    value={summary?.grievance?.total}
                    icon={MessageSquare}
                    trend="-5%"
                    trendUp={false}
                    isActive={selectedView === 'grievance'}
                    onClick={() => setSelectedView('grievance')}
                />
                <StatsCard
                    title="POSM Requests"
                    value={summary?.posm?.total}
                    icon={Package}
                    trend="+18%"
                    trendUp={true}
                    isActive={selectedView === 'posm'}
                    onClick={() => setSelectedView('posm')}
                />
            </div>

            {/* Drill-down Detail Section */}
            {selectedView && (
                <div className="animate-in-slide-up">
                    <Card className="rounded-[32px] border-orange-100 bg-orange-50/20 shadow-sm overflow-hidden">
                        <CardContent className="p-6">
                            <div className="flex flex-wrap gap-8 justify-between">
                                {getViewDetails().map((item, idx) => (
                                    <div key={idx} className="flex flex-col min-w-[120px]">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{item.label}</span>
                                        <span className={`text-2xl font-black ${item.color || 'text-slate-800'}`}>{item.value || 0}</span>
                                    </div>
                                ))}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="ml-auto self-center text-slate-400 hover:text-orange-500"
                                    onClick={() => onNavigate(
                                        selectedView === 'franchise' ? 'vendors' :
                                            selectedView === 'warranty' ? 'warranties' :
                                                selectedView === 'grievance' ? 'grievances' : 'posm' as any
                                    )}
                                >
                                    View Detailed List
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {leadCharts && (
                <Card className="rounded-[32px] border-slate-100 shadow-sm">
                    <CardContent className="p-6 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-black text-slate-800">Leads</h2>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Every enquiry, all channels, all time</p>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => onNavigate('leads' as AdminModule)}>
                                Open Lead Management
                            </Button>
                        </div>
                        <LeadCharts data={leadCharts} collapsible={false} />
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 gap-8">
                <TrendSection
                    trendPeriod={trendPeriod} setTrendPeriod={setTrendPeriod}
                    trendYear={trendYear} setTrendYear={setTrendYear}
                    trendMonth={trendMonth} setTrendMonth={setTrendMonth}
                    trendStart={trendStart} setTrendStart={setTrendStart}
                    trendEnd={trendEnd} setTrendEnd={setTrendEnd}
                    trendLoading={trendLoading}
                    timeSeries={timeSeries}
                    trendTotals={trendTotals}
                    visibleLines={visibleLines}
                    toggleLine={toggleLine}
                    setVisibleLines={setVisibleLines}
                    lineConfig={LINE_CONFIG}
                    years={YEARS}
                    months={MONTHS}
                />

                <ProductDistributionSection
                    prodLoading={prodLoading}
                    prodPeriod={prodPeriod} setProdPeriod={setProdPeriod}
                    prodYear={prodYear} setProdYear={setProdYear}
                    prodMonth={prodMonth} setProdMonth={setProdMonth}
                    prodStart={prodStart} setProdStart={setProdStart}
                    prodEnd={prodEnd} setProdEnd={setProdEnd}
                    products={products}
                    years={YEARS}
                    months={MONTHS}
                />

                <GeographicSection
                    geoLoading={geoLoading}
                    geoPeriod={geoPeriod} setGeoPeriod={setGeoPeriod}
                    geoYear={geoYear} setGeoYear={setGeoYear}
                    geoMonth={geoMonth} setGeoMonth={setGeoMonth}
                    geoStart={geoStart} setGeoStart={setGeoStart}
                    geoEnd={geoEnd} setGeoEnd={setGeoEnd}
                    geoMetric={geoMetric} setGeoMetric={setGeoMetric}
                    geoData={geoData}
                    selectedState={selectedState} setSelectedState={setSelectedState}
                    expandedItem={expandedItem} setExpandedItem={setExpandedItem}
                    years={YEARS}
                    months={MONTHS}
                />
            </div>

            <div className="space-y-8">
                <FranchiseLeaderboard 
                    franchises={franchises} 
                />
                
                <FraudAnalysisSection
                    fraudData={fraudData}
                    fraudFlag={fraudFlag}
                    setFraudFlag={setFraudFlag}
                    fetchFranchiseDrilldown={fetchFranchiseDrilldown}
                />
            </div>

            <FraudAnalysisModal
                selectedFranchise={selectedFranchise}
                onClose={() => setSelectedFranchise(null)}
                drilldownLoading={drilldownLoading}
                drilldownData={drilldownData}
            />
        </div>
    );
};
