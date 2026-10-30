import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pick many franchise stores to map to a distributor. Stores already mapped to
 * it, and stores whose brand it does not carry, are listed but cannot be
 * picked, with the reason; search narrows the list, and "Select all shown"
 * takes every store that can be picked in it.
 */

export interface PickableFranchise { user_id: string; store_name: string; city: string; state: string; brand?: string }

export function FranchiseMultiPicker({ franchises, mappedIds, distributorBrand, value, onChange }: {
    franchises: PickableFranchise[]; mappedIds: Set<string>; distributorBrand: string; value: string[]; onChange: (ids: string[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const [find, setFind] = useState("");
    const picked = new Set(value);

    /* Why a store cannot be picked, or null. */
    const blocked = (f: PickableFranchise) => {
        if (mappedIds.has(f.user_id)) return "Already mapped";
        const b = f.brand || "AF";
        if (!(distributorBrand === "AFAC" || b === "AFAC" || b === distributorBrand)) return `${b} store`;
        return null;
    };
    const needle = find.trim().toLowerCase();
    const shown = useMemo(() => franchises
        .filter(f => !needle || [f.store_name, f.city, f.state].some(x => String(x ?? "").toLowerCase().includes(needle)))
        .sort((a, b) => Number(Boolean(blocked(a))) - Number(Boolean(blocked(b))) || a.store_name.localeCompare(b.store_name)),
        [franchises, needle, mappedIds, distributorBrand]);
    const pickable = shown.filter(f => !blocked(f));
    const toggle = (id: string) => onChange(picked.has(id) ? value.filter(x => x !== id) : [...value, id]);
    const names = new Map(franchises.map(f => [f.user_id, f.store_name]));

    return (
        <div className="space-y-2">
            <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setFind(""); }}>
                <PopoverTrigger asChild>
                    <button type="button" className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-orange-100 bg-white px-3 text-left text-xs font-bold text-slate-700">
                        <span className="truncate">{value.length ? `${value.length} store${value.length === 1 ? "" : "s"} selected` : "-- Select franchise stores --"}</span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(92vw,420px)] p-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input autoFocus value={find} onChange={e => setFind(e.target.value)} placeholder="Search by name, city or state" className="h-10 pl-9" aria-label="Search franchises" />
                    </div>
                    <div className="mt-2 flex items-center justify-between px-1 text-xs">
                        <button type="button" disabled={!pickable.length} onClick={() => onChange([...new Set([...value, ...pickable.map(f => f.user_id)])])}
                            className="font-bold text-orange-600 hover:underline disabled:text-slate-300">Select all shown ({pickable.length})</button>
                        {value.length > 0 && <button type="button" onClick={() => onChange([])} className="font-bold text-slate-500 hover:underline">Clear</button>}
                    </div>
                    <div className="mt-1 max-h-72 overflow-y-auto">
                        {shown.map(f => {
                            const why = blocked(f);
                            return (
                                <label key={f.user_id} className={cn("flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-1.5", why ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-slate-50")}>
                                    <Checkbox checked={!why && picked.has(f.user_id)} disabled={Boolean(why)} onCheckedChange={() => toggle(f.user_id)} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-semibold text-slate-800">{f.store_name}</span>
                                        <span className="block truncate text-[11px] text-slate-500">{[f.city, f.state].filter(Boolean).join(", ")}</span>
                                    </span>
                                    {why && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{why}</span>}
                                </label>
                            );
                        })}
                        {!shown.length && <p className="px-2 py-3 text-sm text-slate-500">No franchise found.</p>}
                    </div>
                </PopoverContent>
            </Popover>
            {value.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {value.slice(0, 8).map(id => (
                        <span key={id} className="flex items-center gap-1 rounded-full bg-orange-50 py-0.5 pl-2.5 pr-1 text-[11px] font-bold text-orange-800">
                            {names.get(id) ?? id}
                            <button type="button" aria-label={`Remove ${names.get(id) ?? id}`} onClick={() => toggle(id)} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-orange-100"><X className="h-3 w-3" /></button>
                        </span>
                    ))}
                    {value.length > 8 && <span className="px-1 text-[11px] font-bold text-slate-500">+{value.length - 8} more</span>}
                </div>
            )}
        </div>
    );
}
