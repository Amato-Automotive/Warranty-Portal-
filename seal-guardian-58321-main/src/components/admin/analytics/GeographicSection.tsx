import { MapPin, ShieldCheck, Box, MessageSquare, Package, X, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { ModernSelect } from './ModernSelect';
import { LoadingOverlay, EmptyState, ExportButton, exportToExcel } from './Common';
import { cn } from '@/lib/utils';

interface GeographicSectionProps {
    geoLoading: boolean;
    geoPeriod: string;
    setGeoPeriod: (val: string) => void;
    geoYear: string;
    setGeoYear: (val: string) => void;
    geoMonth: string;
    setGeoMonth: (val: string) => void;
    geoStart: string;
    setGeoStart: (val: string) => void;
    geoEnd: string;
    setGeoEnd: (val: string) => void;
    geoMetric: 'warranty' | 'grievance' | 'posm' | 'product';
    setGeoMetric: (val: any) => void;
    geoData: any[];
    selectedState: string | null;
    setSelectedState: (val: string | null) => void;
    expandedItem: string | null;
    setExpandedItem: (val: string | null) => void;
    years: string[];
    months: string[];
}

const GEO_COLORS = [
    '#6366f1', // Indigo
    '#0ea5e9', // Sky
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#f43f5e', // Rose
    '#8b5cf6', // Violet
];

export const GeographicSection = ({
    geoLoading,
    geoPeriod, setGeoPeriod,
    geoYear, setGeoYear,
    geoMonth, setGeoMonth,
    geoStart, setGeoStart,
    geoEnd, setGeoEnd,
    geoMetric, setGeoMetric,
    geoData,
    selectedState, setSelectedState,
    expandedItem, setExpandedItem,
    years,
    months
}: GeographicSectionProps) => {
    return (
        <Card className="rounded-[40px] border-none bg-white shadow-[0_20px_50px_rgba(0,0,0,0.04)] overflow-hidden relative group">
            {geoLoading && <LoadingOverlay />}
            <CardHeader className="p-8 space-y-6 border-b border-slate-50 relative z-10">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="h-14 w-14 rounded-[22px] bg-emerald-50 flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform duration-500">
                            <MapPin className="h-7 w-7 text-emerald-600" />
                        </div>
                        <div className="space-y-1">
                            <CardTitle className="text-3xl font-black text-slate-800 uppercase tracking-tighter">Geographic Impact</CardTitle>
                            <CardDescription className="text-emerald-600/60 text-[11px] font-bold uppercase tracking-[0.2em]">Regional penetration & market share</CardDescription>
                        </div>
                    </div>

                    <div className="flex items-center gap-1 bg-slate-100 p-1.5 rounded-[22px] border border-slate-200/50 w-fit self-end md:self-auto shadow-sm">
                        {['all', 'year', 'month', 'week', 'custom'].map((p) => (
                            <button
                                key={p}
                                onClick={() => setGeoPeriod(p)}
                                className={cn(
                                    "px-6 py-2 rounded-[18px] text-[10px] font-black uppercase tracking-[0.1em] transition-all duration-300",
                                    geoPeriod === p
                                        ? "bg-white text-slate-900 shadow-md border border-slate-200/20"
                                        : "text-slate-400 hover:text-slate-600"
                                )}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 pt-2">
                    <div className="flex items-center gap-3">
                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Temporal Filter:</span>
                        <div className="flex items-center gap-2">
                            {geoPeriod === 'custom' ? (
                                <div className="flex items-center gap-2 bg-white p-1 rounded-2xl border border-slate-100 shadow-sm">
                                    <input
                                        type="date"
                                        value={geoStart}
                                        onChange={(e) => setGeoStart(e.target.value)}
                                        className="bg-transparent px-3 py-1.5 text-[11px] font-black text-slate-700 outline-none cursor-pointer"
                                    />
                                    <div className="h-4 w-px bg-slate-200" />
                                    <input
                                        type="date"
                                        value={geoEnd}
                                        onChange={(e) => setGeoEnd(e.target.value)}
                                        className="bg-transparent px-3 py-1.5 text-[11px] font-black text-slate-700 outline-none cursor-pointer"
                                    />
                                </div>
                            ) : (geoPeriod === 'year' || geoPeriod === 'month') ? (
                                <div className="flex items-center gap-2">
                                    <ModernSelect
                                        value={geoYear}
                                        onChange={setGeoYear}
                                        options={years.map(y => ({ value: y, label: y }))}
                                    />
                                    {geoPeriod === 'month' && (
                                        <ModernSelect
                                            value={geoMonth}
                                            onChange={setGeoMonth}
                                            options={months.map((m, i) => ({ value: (i + 1).toString(), label: m }))}
                                        />
                                    )}
                                </div>
                            ) : (
                                <div className="px-5 py-2.5 bg-slate-50 border border-slate-100 rounded-[20px] text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
                                    {geoPeriod === 'all' ? 'Universal History' : 'Rolling Window'}
                                </div>
                            )}
                        </div>

                        {selectedState && (
                            <button
                                onClick={() => setSelectedState(null)}
                                className="flex items-center gap-2 px-5 py-2 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
                            >
                                <X className="h-3 w-3" />
                                National View
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Metric:</span>
                        <div className="flex items-center gap-1 bg-slate-50 p-1.5 rounded-[18px] border border-slate-200/30 shadow-inner">
                            {[
                                { id: 'warranty', label: 'Warranty', icon: ShieldCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                                { id: 'product', label: 'Products', icon: Box, color: 'text-blue-600', bg: 'bg-blue-50' },
                                { id: 'grievance', label: 'Complaint', icon: MessageSquare, color: 'text-rose-600', bg: 'bg-rose-50' },
                                { id: 'posm', label: 'POSM', icon: Package, color: 'text-amber-600', bg: 'bg-amber-50' }
                            ].map((m) => (
                                <button
                                    key={m.id}
                                    onClick={() => setGeoMetric(m.id as any)}
                                    className={cn(
                                        "flex items-center gap-2 px-5 py-2 rounded-[14px] text-[10px] font-black uppercase tracking-tight transition-all duration-300",
                                        geoMetric === m.id
                                            ? `${m.bg} ${m.color} shadow-sm border border-slate-200/30 scale-105`
                                            : "text-slate-400 hover:text-slate-600 hover:bg-white"
                                    )}
                                >
                                    <m.icon className="h-3.5 w-3.5" />
                                    {m.label}
                                </button>
                            ))}
                        </div>


                        <ExportButton 
                            onClick={() => exportToExcel(
                                geoData?.map(d => ({
                                    Location: d.label,
                                    [geoMetric.toUpperCase()]: geoMetric === 'warranty' ? (d.warranty?.total_warranties || 0) :
                                                              geoMetric === 'product' ? (d.product?.total_products || 0) :
                                                              geoMetric === 'grievance' ? (d.grievance?.total_grievances || 0) :
                                                              (d.posm?.total_posm || 0)
                                })) || [], 
                                `Geographic_Impact_${geoMetric}_${geoPeriod}_${new Date().toISOString().split('T')[0]}`
                            )} 
                        />
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-0 min-h-[500px] relative">
                {!geoLoading && geoData.length === 0 ? (
                    <div className="p-20">
                        <EmptyState message={`No ${geoMetric} trajectory found`} />
                    </div>
                ) : (
                    <div className="p-8 space-y-10">
                        <div className="max-h-[500px] overflow-y-auto pr-4 custom-scrollbar">
                            <div style={{ height: `${Math.max(400, geoData.length * 50)}px`, width: '100%' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        layout="vertical"
                                        data={geoData
                                            .map(d => ({
                                                name: d.label,
                                                value: geoMetric === 'warranty' ? (d.warranty?.total_warranties || 0) :
                                                    geoMetric === 'product' ? (d.product?.total_products || 0) :
                                                        geoMetric === 'grievance' ? (d.grievance?.total_grievances || 0) :
                                                            (d.posm?.total_posm || 0),
                                                fullData: d
                                            }))
                                            .sort((a, b) => b.value - a.value)
                                        }
                                        margin={{ left: 20, right: 60, top: 20, bottom: 20 }}
                                    >
                                        <defs>
                                            {GEO_COLORS.map((color, i) => (
                                                <linearGradient key={i} id={`geoGradient-${i}`} x1="0" y1="0" x2="1" y2="0">
                                                    <stop offset="0%" stopColor={color} stopOpacity={0.8} />
                                                    <stop offset="100%" stopColor={color} stopOpacity={1} />
                                                </linearGradient>
                                            ))}
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                        <XAxis type="number" hide />
                                        <YAxis
                                            type="category"
                                            dataKey="name"
                                            width={120}
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#64748b', fontSize: 11, fontWeight: 900 }}
                                        />
                                        <Tooltip
                                            cursor={{ fill: '#f8fafc', radius: 10 }}
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    const data = payload[0].payload;
                                                    return (
                                                        <div className="bg-slate-900 text-white p-5 rounded-[24px] shadow-2xl border border-slate-800 scale-95 animate-in fade-in zoom-in duration-300">
                                                            <div className="flex items-center gap-3 mb-3">
                                                                <div className="h-8 w-8 rounded-xl bg-white/10 flex items-center justify-center">
                                                                    <MapPin className="h-4 w-4 text-emerald-400" />
                                                                </div>
                                                                <div>
                                                                    <p className="text-[10px] font-black uppercase tracking-widest text-white/40">{selectedState ? 'CITY HUB' : 'STATE REGION'}</p>
                                                                    <p className="text-base font-black tracking-tight">{data.name}</p>
                                                                </div>
                                                            </div>
                                                            <div className="h-px bg-white/10 my-4" />
                                                            <div className="flex items-center justify-between gap-8">
                                                                <div className="flex flex-col">
                                                                    <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Active {geoMetric}</span>
                                                                    <span className="text-2xl font-black text-emerald-400">{data.value}</span>
                                                                </div>
                                                                {!selectedState && (
                                                                    <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-black text-emerald-400 uppercase tracking-tighter">
                                                                        Drill-down Available
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <Bar
                                            dataKey="value"
                                            radius={[0, 12, 12, 0]}
                                            barSize={24}
                                            className="cursor-pointer"
                                            onClick={(data: any) => {
                                                if (data && data.name && !selectedState) {
                                                    setSelectedState(data.name);
                                                }
                                            }}
                                        >
                                            {geoData.map((_, index) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={`url(#geoGradient-${index % GEO_COLORS.length})`}
                                                    className="hover:opacity-80 transition-opacity duration-300 shadow-lg"
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-4 custom-scrollbar">
                            <div className="flex items-center px-8 py-4 bg-slate-900 rounded-[24px] mb-4 shadow-xl shadow-slate-200/50 sticky top-0 z-10">
                                <div className="flex-1 flex flex-col">
                                    <span className="text-[11px] font-black uppercase text-white tracking-[0.2em]">
                                        {selectedState ? `CITY DRILL-DOWN: ${selectedState}` : 'NATIONAL PERFORMANCE'}
                                    </span>
                                    <span className="text-white text-[10px] font-bold opacity-60">High-Fidelity Regional Ranking</span>
                                </div>
                            </div>

                            {geoData.sort((a, b) => {
                                const valA = geoMetric === 'warranty' ? (a.warranty?.total_warranties || 0) :
                                    geoMetric === 'product' ? (a.product?.total_products || 0) :
                                        geoMetric === 'grievance' ? (a.grievance?.total_grievances || 0) :
                                            (a.posm?.total_posm || 0);
                                const valB = geoMetric === 'warranty' ? (b.warranty?.total_warranties || 0) :
                                    geoMetric === 'product' ? (b.product?.total_products || 0) :
                                        geoMetric === 'grievance' ? (b.grievance?.total_grievances || 0) :
                                            (b.posm?.total_posm || 0);
                                return valB - valA;
                            }).map((item, idx) => {
                                const total = item.warranty?.total_warranties || 0;
                                const val = geoMetric === 'warranty' ? total :
                                    geoMetric === 'product' ? (item.product?.total_products || 0) :
                                        geoMetric === 'grievance' ? (item.grievance?.total_grievances || 0) :
                                            (item.posm?.total_posm || 0);

                                const isExpanded = expandedItem === item.label;

                                return (
                                    <div key={idx} className="space-y-2">
                                        <div
                                            onClick={() => {
                                                if (!selectedState) {
                                                    setSelectedState(item.label);
                                                } else {
                                                    setExpandedItem(isExpanded ? null : item.label);
                                                }
                                            }}
                                            className={cn(
                                                "flex items-center px-8 py-4 rounded-[28px] border border-slate-100/50 bg-white hover:bg-slate-50 hover:border-slate-200 transition-all duration-500 group relative overflow-hidden cursor-pointer",
                                                isExpanded ? "border-blue-200 bg-blue-50/30" : ""
                                            )}
                                        >
                                            <div className="flex-1 flex items-center gap-5">
                                                <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center text-[10px] font-black text-slate-400 group-hover:bg-slate-900 group-hover:text-white transition-all duration-500 shadow-sm border border-slate-100">
                                                    #{idx + 1}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-slate-900 tracking-tight">{item.label}</span>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{val} {geoMetric === 'product' ? 'Sales' : geoMetric}</span>
                                                        {item.product?.mix && geoMetric === 'product' && !isExpanded && (
                                                            <div className="flex gap-1.5 flex-wrap">
                                                                {item.product.mix.slice(0, 3).map((m: any, i: number) => (
                                                                    <span key={i} className="text-[8px] font-black px-2 py-0.5 bg-slate-50 text-slate-500 rounded-full border border-slate-100">
                                                                        {m.name}: {m.count}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-12 pr-6">
                                                <div className="flex flex-col items-end">
                                                    <span className={cn("text-sm font-black",
                                                        geoMetric === 'warranty' ? "text-emerald-600" :
                                                            geoMetric === 'product' ? "text-blue-600" :
                                                                geoMetric === 'grievance' ? "text-rose-600" : "text-amber-600")}>
                                                        {val}
                                                    </span>
                                                    <span className="text-[8px] font-black uppercase text-slate-300 tracking-tighter">
                                                        {geoMetric === 'warranty' ? 'Warranties' : geoMetric === 'product' ? 'Total Sales' : geoMetric === 'grievance' ? 'Complaints' : 'POSM Requests'}
                                                    </span>
                                                </div>

                                                {selectedState ? (
                                                    <ChevronRight className={cn("h-4 w-4 text-slate-200 transition-all", isExpanded ? "rotate-90 text-blue-500" : "")} />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4 text-slate-200 group-hover:text-slate-900 transition-all" />
                                                )}
                                            </div>
                                        </div>

                                        {isExpanded && geoMetric === 'product' && item.product?.mix && (
                                            <div className="mx-8 p-6 bg-slate-900 rounded-[24px] shadow-inner animate-in slide-in-from-top-2 duration-300">
                                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                                    {item.product.mix.map((m: any, i: number) => (
                                                        <div key={i} className="flex flex-col p-3 rounded-xl bg-white/5 border border-white/10">
                                                            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">{m.name}</span>
                                                            <span className="text-xl font-black text-white">{m.count} <span className="text-[10px] opacity-40">units</span></span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
