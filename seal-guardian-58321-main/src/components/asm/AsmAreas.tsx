import { useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Hash, Landmark, Loader2, Lock, Map as MapIcon, MapPin } from "lucide-react";

/**
 * The places this ASM covers — read-only. Head office sets them under Leads;
 * every enquiry from a pincode inside them comes to this ASM. One row per
 * state, so it stays compact however much is assigned.
 */

interface Area {
    id: string;
    area_label: string;
    kind: "state" | "district" | "pincode" | null;
    state: string | null;
    district: string | null;
    pincode: string | null;
    pincodes: number;
}

const KIND_ICON = { state: Landmark, district: MapIcon, pincode: Hash } as const;

export const AsmAreas = () => {
    const [areas, setAreas] = useState<Area[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        api.get("/asm-portal/areas")
            .then(res => setAreas(res.data.areas || []))
            .catch(e => setError(getErrorMessage(e, "Could not load your areas")))
            .finally(() => setLoading(false));
    }, []);

    const byState = useMemo(() => {
        const map = new Map<string, Area[]>();
        areas.forEach(a => {
            const key = a.state || a.area_label;
            map.set(key, [...(map.get(key) || []), a]);
        });
        return [...map.entries()]
            .map(([state, list]) => ({
                state,
                list,
                whole: list.some(a => a.kind === "state"),
                pincodes: list.reduce((t, a) => t + (a.pincodes || 0), 0),
            }))
            .sort((a, b) => a.state.localeCompare(b.state));
    }, [areas]);

    const totalPincodes = areas.reduce((t, a) => t + (a.pincodes || 0), 0);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                <span className="text-sm font-medium">Loading your areas…</span>
            </div>
        );
    }

    if (error) {
        return <div className="rounded-2xl border border-rose-100 bg-rose-50 p-6 text-center text-sm text-rose-700">{error}</div>;
    }

    return (
        <div className="space-y-5 animate-in fade-in duration-300">
            {/* Summary line */}
            <div className="grid grid-cols-3 gap-3 md:gap-4 max-w-2xl">
                {[
                    { label: "States", value: byState.length },
                    { label: "Areas", value: areas.length },
                    { label: "Pincodes", value: totalPincodes.toLocaleString("en-IN") },
                ].map(s => (
                    <div key={s.label} className="rounded-2xl border border-orange-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{s.label}</p>
                        <p className="text-2xl font-black text-slate-800 tabular-nums leading-tight mt-1">{s.value}</p>
                    </div>
                ))}
            </div>

            <p className="flex items-start gap-2 text-sm text-slate-500 px-1">
                <Lock className="h-3.5 w-3.5 text-orange-500 shrink-0 mt-px" />
                Set by head office. Enquiries from these places come to you — contact head office to change them.
            </p>

            {byState.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-orange-200 bg-white/60 py-12 px-6 text-center">
                    <MapPin className="h-6 w-6 text-orange-400 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-700">No areas assigned yet</p>
                    <p className="text-xs text-slate-500 mt-1">No enquiries are coming to you until head office assigns some.</p>
                </div>
            ) : (
                <ul className="rounded-3xl border border-orange-100 bg-white divide-y divide-slate-100 overflow-hidden shadow-sm">
                    {byState.map((s, i) => (
                        <li
                            key={s.state}
                            style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                            className="px-4 md:px-5 py-4 animate-in fade-in duration-300 fill-mode-both"
                        >
                            <div className="flex items-center gap-3">
                                <span className="h-10 w-10 shrink-0 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                                    <MapPin className="h-5 w-5" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[15px] font-bold text-slate-800 truncate">{s.state}</p>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        {s.whole ? "Entire state" : `${s.list.length} area${s.list.length === 1 ? "" : "s"}`}
                                    </p>
                                </div>
                                <span className="text-sm font-semibold text-slate-500 tabular-nums shrink-0">
                                    {s.pincodes.toLocaleString("en-IN")} pincodes
                                </span>
                            </div>
                            {!s.whole && (
                                <div className="flex flex-wrap gap-2 mt-3 pl-[52px]">
                                    {s.list.map(a => {
                                        const Icon = KIND_ICON[a.kind ?? "district"];
                                        return (
                                            <span
                                                key={a.id}
                                                className={cn("inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600",
                                                    a.kind === "pincode" && "font-mono")}
                                            >
                                                <Icon className="h-3 w-3 text-slate-400" />
                                                {a.kind === "pincode" ? a.pincode : (a.district || a.area_label)}
                                                {a.kind === "district" && a.pincodes > 0 && (
                                                    <span className="text-slate-400 tabular-nums">{a.pincodes}</span>
                                                )}
                                            </span>
                                        );
                                    })}
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
