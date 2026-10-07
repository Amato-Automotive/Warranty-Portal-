import { useState, useEffect, useMemo } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminLeadsList } from "./AdminLeadsList";
import { AdminStoreLocator } from "./AdminStoreLocator";
import {
    Loader2, Plus, Search, MapPin, Phone, UserRound,
    RefreshCw, X, AlertTriangle, Inbox, Store as StoreIcon
} from "lucide-react";

/**
 * ASMs and the areas they cover.
 *
 * This is the routing table behind lead forwarding. An ASM is given places
 * from the pincode directory — a state, a district, or a single pincode — and
 * every pincode inside them is theirs. One place belongs to exactly one ASM
 * (the database enforces it), and a smaller place beats a bigger one, so a
 * state can be split. This screen's job is to make that visible and easy to
 * correct.
 */

interface Asm {
    id: string;
    name: string;
    phone_number: string;
    email: string | null;
    is_active: number;
    area_count: number;
    lead_count: number;
}

interface Area {
    id: string;
    asm_id: string;
    area_key: string;
    area_label: string;
    state: string | null;
    kind: "state" | "district" | "pincode" | null;
    district: string | null;
    pincode: string | null;
    /** Pincodes this area covers. */
    pincodes: number;
}

/** A place from the pincode directory that can be given to an ASM. */
interface Place {
    key: string;
    kind: "state" | "district" | "pincode";
    state: string;
    district?: string | null;
    pincode?: string | null;
    label: string;
    pincodes: number;
    taken_by: string | null;
}

const KIND_GROUP: Record<Place["kind"], string> = { state: "States", district: "Districts", pincode: "Pincode" };

export const AdminLeadManagement = () => {
    const { toast } = useToast();
    const [asms, setAsms] = useState<Asm[]>([]);
    const [areas, setAreas] = useState<Area[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState("");

    // Assign an area
    const [areaTarget, setAreaTarget] = useState<Asm | null>(null);
    const [areaInput, setAreaInput] = useState("");
    const [addingArea, setAddingArea] = useState<string | null>(null);
    const [places, setPlaces] = useState<Place[]>([]);
    const [searchingPlaces, setSearchingPlaces] = useState(false);

    const fetchAll = async (silent = false) => {
        silent ? setRefreshing(true) : setLoading(true);
        try {
            const res = await api.get("/asm");
            if (res.data.success) {
                setAsms(res.data.asms || []);
                setAreas(res.data.areas || []);
            }
        } catch (error: any) {
            toast({
                title: "Could not load ASMs",
                description: getErrorMessage(error, "Please try again"),
                variant: "destructive",
            });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const areasByAsm = useMemo(() => {
        const map: Record<string, Area[]> = {};
        areas.forEach(a => { (map[a.asm_id] ||= []).push(a); });
        return map;
    }, [areas]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return asms;
        return asms.filter(a =>
            a.name.toLowerCase().includes(q) ||
            a.phone_number.includes(q) ||
            (areasByAsm[a.id] || []).some(ar => ar.area_label.toLowerCase().includes(q))
        );
    }, [asms, search, areasByAsm]);

    /*
     * Places matching what is typed — states, districts, or a pincode — from
     * the pincode directory. Debounced; an empty box lists the states.
     */
    useEffect(() => {
        if (!areaTarget) return;
        let cancelled = false;
        setSearchingPlaces(true);
        const t = setTimeout(() => {
            api.get("/asm/area-search", { params: { q: areaInput.trim() } })
                .then(res => { if (!cancelled && res.data.success) setPlaces(res.data.places || []); })
                .catch(() => { if (!cancelled) setPlaces([]); })
                .finally(() => { if (!cancelled) setSearchingPlaces(false); });
        }, 250);
        return () => { cancelled = true; clearTimeout(t); };
    }, [areaInput, areaTarget, areas]);

    const addArea = async (place: Place) => {
        if (!areaTarget) return;
        setAddingArea(place.key);
        try {
            await api.post("/asm/areas", {
                asm_id: areaTarget.id,
                kind: place.kind,
                state: place.state,
                district: place.district,
                pincode: place.pincode,
            });
            toast({
                title: `${place.label} assigned to ${areaTarget.name}`,
                description: `${place.pincodes.toLocaleString()} pincode${place.pincodes === 1 ? "" : "s"}`,
            });
            setAreaInput("");
            fetchAll(true);
        } catch (error: any) {
            // The API names the ASM already covering it — far more useful than
            // "duplicate entry".
            toast({
                title: "Could not assign",
                description: getErrorMessage(error, "Please try again"),
                variant: "destructive",
            });
        } finally {
            setAddingArea(null);
        }
    };

    const removeArea = async (area: Area) => {
        try {
            await api.delete(`/asm/areas/${area.id}`);
            toast({ title: `${area.area_label} unassigned` });
            fetchAll(true);
        } catch (error: any) {
            toast({ title: "Could not remove", description: getErrorMessage(error, ""), variant: "destructive" });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px] gap-3 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                <span className="text-sm font-medium">Loading ASMs…</span>
            </div>
        );
    }

    const pincodesAssigned = areas.reduce((sum, a) => sum + (a.pincodes || 0), 0);

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-2xl font-black tracking-tight text-slate-800 uppercase">Lead Management</h2>
                <p className="text-sm text-slate-500 mt-1">
                    Enquiries received, and the ASMs and areas they are routed by.
                </p>
            </div>

            <Tabs defaultValue="enquiries" className="space-y-5">
                <TabsList className="bg-slate-100 rounded-xl p-1">
                    <TabsTrigger value="enquiries" className="rounded-lg text-xs font-black uppercase gap-1.5">
                        <Inbox className="h-3.5 w-3.5" /> Enquiries
                    </TabsTrigger>
                    <TabsTrigger value="asms" className="rounded-lg text-xs font-black uppercase gap-1.5">
                        <UserRound className="h-3.5 w-3.5" /> Areas
                    </TabsTrigger>
                    <TabsTrigger value="locator" className="rounded-lg text-xs font-black uppercase gap-1.5">
                        <StoreIcon className="h-3.5 w-3.5" /> Store Locator
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="enquiries" className="space-y-5 mt-0">
                    <AdminLeadsList />
                </TabsContent>

                <TabsContent value="asms" className="space-y-5 mt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-500">
                    The areas each ASM covers. To add, edit or switch off an ASM, use ASM Management.
                </p>
                <Button variant="outline" size="sm" onClick={() => fetchAll(true)} disabled={refreshing}>
                    <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                </Button>
            </div>

            {/* Coverage at a glance — an area nobody covers is the thing that
                silently loses enquiries, so it leads. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                    { label: "ASMs", value: asms.length, tone: "text-slate-800" },
                    { label: "Active", value: asms.filter(a => a.is_active).length, tone: "text-emerald-600" },
                    { label: "Areas covered", value: areas.length, tone: "text-blue-600" },
                    { label: "Pincodes assigned", value: pincodesAssigned.toLocaleString(), tone: "text-slate-800" },
                ].map(s => (
                    <div key={s.label} className="rounded-2xl border border-slate-100 bg-white p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{s.label}</p>
                        <p className={`text-2xl font-black tabular-nums mt-0.5 ${s.tone}`}>{s.value}</p>
                    </div>
                ))}
            </div>

            <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name, number or area…"
                    className="pl-9 h-10 rounded-xl"
                />
            </div>

            {visible.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-orange-200 bg-white/40 p-12 text-center">
                    <div className="h-16 w-16 bg-orange-50 rounded-3xl flex items-center justify-center mx-auto mb-5 border border-orange-100">
                        <UserRound className="h-7 w-7 text-orange-500 opacity-80" />
                    </div>
                    <h3 className="text-lg font-black tracking-tight text-slate-800 uppercase mb-2">
                        {search ? "No ASM matches that" : "No ASMs yet"}
                    </h3>
                    <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
                        {search
                            ? "Try a different name, number or area."
                            : "Add ASMs in ASM Management, then assign the areas they cover here. Enquiries from those areas will then reach them on WhatsApp."}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {visible.map(asm => {
                        const myAreas = areasByAsm[asm.id] || [];
                        return (
                            <Card key={asm.id} className="rounded-3xl border-slate-100 overflow-hidden">
                                <CardContent className="p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-black text-slate-800">{asm.name}</p>
                                                {!asm.is_active && (
                                                    <Badge variant="outline" className="text-[10px] font-black uppercase bg-slate-100 text-slate-500">
                                                        Inactive
                                                    </Badge>
                                                )}
                                                {myAreas.length === 0 && (
                                                    <Badge variant="outline" className="text-[10px] font-black uppercase bg-amber-50 text-amber-700 border-amber-200">
                                                        No areas
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-500">
                                                <span className="flex items-center gap-1 font-mono">
                                                    <Phone className="h-3 w-3" /> {asm.phone_number}
                                                </span>
                                                {asm.email && <span>{asm.email}</span>}
                                                <span>·</span>
                                                <span className="tabular-nums">{asm.lead_count} enquir{asm.lead_count === 1 ? "y" : "ies"}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <Button
                                                size="sm" variant="outline"
                                                className="h-8 text-xs"
                                                onClick={() => { setAreaTarget(asm); setAreaInput(""); }}
                                            >
                                                <MapPin className="h-3.5 w-3.5 mr-1" /> Areas
                                            </Button>
                                        </div>
                                    </div>

                                    {myAreas.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-slate-100">
                                            {myAreas.map(area => (
                                                <span
                                                    key={area.id}
                                                    className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg pl-2.5 pr-1 py-1 text-xs font-semibold text-slate-700"
                                                >
                                                    {area.area_label}
                                                    {area.kind && (
                                                        <span className="text-[10px] font-medium text-slate-400 tabular-nums">
                                                            {area.pincodes.toLocaleString()}
                                                        </span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => removeArea(area)}
                                                        title={`Unassign ${area.area_label}`}
                                                        className="h-4 w-4 rounded grid place-items-center text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

                </TabsContent>

                <TabsContent value="locator" className="space-y-5 mt-0">
                    <AdminStoreLocator />
                </TabsContent>
            </Tabs>

            {/* Assign areas */}
            <Dialog open={!!areaTarget} onOpenChange={open => { if (!open) setAreaTarget(null); }}>
                {/*
                  * grid-cols-1 + min-w-0: the dialog is a CSS grid, and without
                  * them one long row sizes the column past the dialog's edge —
                  * the list and the description spilled out to the right.
                  */}
                <DialogContent className="max-w-lg grid-cols-1 [&>*]:min-w-0">
                    <DialogHeader>
                        <DialogTitle>Areas for {areaTarget?.name}</DialogTitle>
                        <DialogDescription>
                            Every pincode inside the places you add goes to this ASM. A smaller place
                            held by someone else takes priority.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-1">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                value={areaInput}
                                onChange={e => setAreaInput(e.target.value)}
                                placeholder="Search a state, district or pincode"
                                className="pl-9 h-10 rounded-xl"
                                autoFocus
                            />
                            {searchingPlaces && (
                                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
                            )}
                        </div>

                        <div className="rounded-xl border border-slate-200 max-h-72 overflow-y-auto overflow-x-hidden">
                            {places.length === 0 ? (
                                <p className="text-sm text-slate-400 px-4 py-3">
                                    {searchingPlaces ? "Searching…" : "No state, district or pincode matches that."}
                                </p>
                            ) : (["state", "district", "pincode"] as const).map(kind => {
                                const group = places.filter(pl => pl.kind === kind);
                                if (!group.length) return null;
                                return (
                                    <div key={kind}>
                                        <p className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm border-b border-slate-100 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                            {KIND_GROUP[kind]}
                                        </p>
                                        <div className="divide-y divide-slate-100">
                                            {group.map(place => {
                                                const mine = place.taken_by === areaTarget?.name;
                                                const taken = Boolean(place.taken_by);
                                                return (
                                                    <div key={place.key} className="flex items-center gap-3 px-4 py-2.5">
                                                        <div className="min-w-0 flex-1">
                                                            <p className={`text-sm font-semibold truncate ${taken ? "text-slate-400" : "text-slate-800"}`}>
                                                                {place.label}
                                                            </p>
                                                            <p className="text-[11px] text-slate-400 truncate">
                                                                {place.pincodes.toLocaleString()} pincode{place.pincodes === 1 ? "" : "s"}
                                                                {taken && !mine && <> · with {place.taken_by}</>}
                                                            </p>
                                                        </div>
                                                        {taken ? (
                                                            <span className={`shrink-0 text-[11px] font-bold rounded-lg px-2.5 py-1 ${mine ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                                                {mine ? "Added" : "Taken"}
                                                            </span>
                                                        ) : (
                                                            <Button
                                                                type="button" size="sm" variant="outline"
                                                                disabled={addingArea !== null}
                                                                onClick={() => addArea(place)}
                                                                className="shrink-0 h-8 rounded-lg border-orange-200 text-orange-600 hover:bg-orange-50 hover:text-orange-700 font-bold"
                                                            >
                                                                {addingArea === place.key
                                                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                    : <><Plus className="h-3.5 w-3.5 mr-1" />Add</>}
                                                            </Button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                                Currently covering ({(areasByAsm[areaTarget?.id || ""] || []).length})
                            </p>
                            {(areasByAsm[areaTarget?.id || ""] || []).length === 0 ? (
                                <p className="text-sm text-slate-400 italic flex items-center gap-1.5">
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                    No areas yet — they will not receive any enquiries.
                                </p>
                            ) : (
                                <div className="flex flex-wrap gap-1.5">
                                    {(areasByAsm[areaTarget?.id || ""] || []).map(area => (
                                        <span
                                            key={area.id}
                                            className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg pl-2.5 pr-1 py-1 text-xs font-semibold text-slate-700"
                                        >
                                            {area.area_label}
                                            {area.kind && (
                                                <span className="text-[10px] font-medium text-slate-400 tabular-nums">
                                                    {area.pincodes.toLocaleString()}
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => removeArea(area)}
                                                className="h-4 w-4 rounded grid place-items-center text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAreaTarget(null)}>Done</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
