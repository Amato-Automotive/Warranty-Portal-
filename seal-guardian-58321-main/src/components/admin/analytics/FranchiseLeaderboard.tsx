import { TrendingUp, MapPin, ChevronRight, MessageSquare, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingOverlay, EmptyState, ExportButton, exportToExcel } from './Common';
import { cn } from '@/lib/utils';

interface FranchiseLeaderboardProps {
    franchises: any[];
}

export const FranchiseLeaderboard = ({ franchises }: FranchiseLeaderboardProps) => {
    return (
        <Card className="rounded-[40px] border-slate-100 shadow-[0_20px_60px_rgba(0,0,0,0.03)] overflow-hidden">
            <CardHeader className="p-8 border-b border-slate-50 bg-white/50 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-orange-500" />
                            Franchise Participation Leaderboard
                        </CardTitle>
                        <CardDescription className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mt-1">Real-time performance across all service modules</CardDescription>
                    </div>
                    <div className="flex items-center gap-4">
                        <ExportButton 
                            onClick={() => exportToExcel(
                                franchises?.map(f => ({
                                    "Franchise Name": f.store_name,
                                    "City": f.city,
                                    "State": f.state,
                                    "Total Registrations": f.total_registrations,
                                    "Approved Warranties": f.warranty_count,
                                    "Complaints": f.grievance_count,
                                    "POSM Requests": f.posm_count,
                                    "Status": f.is_verified ? "Approved" : f.verified_at ? "Rejected" : "Pending"
                                })) || [], 
                                `Franchise_Leaderboard_${new Date().toISOString().split('T')[0]}`
                            )} 
                        />
                        <div className="h-10 w-10 rounded-2xl bg-slate-50 flex items-center justify-center border border-slate-100">
                            <ChevronRight className="h-5 w-5 text-slate-300" />
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="max-h-[500px] overflow-y-auto custom-scrollbar relative">
                    <table className="w-full border-collapse">
                        <thead className="sticky top-0 z-20 bg-white/95 backdrop-blur-md shadow-sm">
                            <tr className="bg-slate-50/50">
                                <th className="py-5 px-8 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Franchise Intelligence</th>
                                <th className="py-5 px-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Warranty Flow</th>
                                <th className="py-5 px-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Complaints</th>
                                <th className="py-5 px-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">POSM Velocity</th>
                                <th className="py-5 px-8 text-right text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {franchises?.map((f, i) => (
                                <tr key={f.id} className="hover:bg-slate-50/80 transition-colors group">
                                    <td className="py-5 px-8">
                                        <div className="flex items-center gap-4">
                                            <div className="h-10 w-10 rounded-2xl bg-white shadow-sm border border-slate-100 flex items-center justify-center text-[11px] font-black text-slate-400 group-hover:text-orange-500 group-hover:border-orange-100 transition-all">
                                                {i + 1}
                                            </div>
                                            <div>
                                                <p className="text-sm font-black text-slate-800">{f.store_name}</p>
                                                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                                                    <MapPin className="h-3 w-3" />
                                                    {f.city}, {f.state}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-5 px-8">
                                        <div className="flex flex-col items-center">
                                            <span className="text-sm font-black text-slate-800">{f.total_registrations}</span>
                                            <div className="flex items-center gap-1 mt-1">
                                                <div className="h-1 w-12 bg-slate-100 rounded-full overflow-hidden">
                                                    <div 
                                                        className="h-full bg-emerald-500 rounded-full" 
                                                        style={{ width: `${(f.warranty_count / (f.total_registrations || 1)) * 100}%` }}
                                                    />
                                                </div>
                                                <span className="text-[9px] font-black text-emerald-600">{f.warranty_count} Appr.</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-5 px-8 text-center">
                                        <div className="inline-flex items-center px-3 py-1 rounded-full bg-rose-50 text-rose-600 text-[11px] font-black border border-rose-100">
                                            <MessageSquare className="h-3 w-3 mr-1.5 opacity-50" />
                                            {f.grievance_count || 0}
                                        </div>
                                    </td>
                                    <td className="py-5 px-8 text-center">
                                        <div className="inline-flex items-center px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[11px] font-black border border-amber-100">
                                            <Package className="h-3 w-3 mr-1.5 opacity-50" />
                                            {f.posm_count || 0}
                                        </div>
                                    </td>
                                    <td className="py-5 px-8 text-right">
                                        <div className="flex items-center justify-end">
                                            {f.is_verified ? (
                                                <Badge className="bg-emerald-50 text-emerald-600 hover:bg-emerald-50 border-emerald-100 text-[10px] font-black uppercase px-2 py-0.5">Approved</Badge>
                                            ) : f.verified_at ? (
                                                <Badge className="bg-rose-50 text-rose-600 hover:bg-rose-50 border-rose-100 text-[10px] font-black uppercase px-2 py-0.5">Rejected</Badge>
                                            ) : (
                                                <Badge className="bg-amber-50 text-amber-600 hover:bg-amber-50 border-amber-100 text-[10px] font-black uppercase px-2 py-0.5">Pending</Badge>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
};
