import { useState, useEffect } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import {
    Search,
    Users,
    MapPin,
    Phone,
    Mail,
    Building2,
    Trash2,
    Loader2,
    Check,
    Store,
    X,
    ChevronRight,
    ArrowRight,
    Download
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminFranchiseOrdersDialog } from "./AdminFranchiseOrdersDialog";
import { FranchiseMultiPicker } from "./FranchiseMultiPicker";

interface Distributor {
    id: string;
    name: string;
    email: string;
    phone_number: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    created_at: string;
    franchise_count: number;
    allowed_brands?: string;
}

interface Category {
    id: string;
    name: string;
    parentId?: string | null;
}

interface Franchise {
    user_id: string;
    vendor_details_id: string;
    store_name: string;
    store_email: string;
    city: string;
    state: string;
    phone_number?: string;
    distributor_id?: string | null;
    distributor_name?: string | null;
    order_pending_count?: number;
    order_confirmed_count?: number;
    order_declined_count?: number;
    order_total_count?: number;
}

export const AdminOrderManagement = () => {
    const { toast } = useToast();
    
    // States
    const [distributors, setDistributors] = useState<Distributor[]>([]);
    const [selectedDist, setSelectedDist] = useState<Distributor | null>(null);
    const [mappedFranchises, setMappedFranchises] = useState<Franchise[]>([]);
    const [eligibleFranchises, setEligibleFranchises] = useState<Franchise[]>([]);
    const [allCategories, setAllCategories] = useState<Category[]>([]);
    const [allowedCategoryIds, setAllowedCategoryIds] = useState<string[]>([]);
    const [savingCategories, setSavingCategories] = useState(false);
    const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(new Set());
    const [activeBrandTab, setActiveBrandTab] = useState<'AF' | 'AC'>('AF');

    const [loadingDists, setLoadingDists] = useState(true);
    const [loadingFranchises, setLoadingFranchises] = useState(false);
    const [loadingEligible, setLoadingEligible] = useState(false);
    const [loadingCategories, setLoadingCategories] = useState(false);
    
    const [searchQuery, setSearchQuery] = useState("");
    const [franchiseSearchQuery, setFranchiseSearchQuery] = useState("");
    // The stores picked to map to the selected distributor, many at once.
    const [selectedFranchiseIds, setSelectedFranchiseIds] = useState<string[]>([]);
    useEffect(() => { setSelectedFranchiseIds([]); }, [selectedDist?.id]);
    
    // Modals
    const [mappingFranchise, setMappingFranchise] = useState(false);
    const [unmappingFranchiseId, setUnmappingFranchiseId] = useState<string | null>(null);
    const [ordersDialogOpen, setOrdersDialogOpen] = useState(false);
    const [selectedFranchise, setSelectedFranchise] = useState<Franchise | null>(null);
    const [franchiseOrders, setFranchiseOrders] = useState<any[]>([]);
    const [loadingFranchiseOrders, setLoadingFranchiseOrders] = useState(false);

    useEffect(() => {
        fetchDistributors();
        fetchEligibleFranchises();
    }, []);

    useEffect(() => {
        if (selectedDist) {
            const distBrand = selectedDist.allowed_brands || 'AF';
            const initialTab: 'AF' | 'AC' = distBrand === 'AC' ? 'AC' : 'AF';
            setActiveBrandTab(initialTab);
            fetchMappedFranchises(selectedDist.id);
            fetchAllowedCategories(selectedDist.id);
            fetchAllCategories(distBrand === 'AFAC' ? initialTab : distBrand as 'AF' | 'AC');
        } else {
            setMappedFranchises([]);
            setAllowedCategoryIds([]);
            setAllCategories([]);
        }
    }, [selectedDist]);

    // Re-fetch categories when brand tab changes (only relevant for AFAC distributors)
    useEffect(() => {
        if (selectedDist && (selectedDist.allowed_brands || 'AF') === 'AFAC') {
            fetchAllCategories(activeBrandTab);
        }
    }, [activeBrandTab]);

    const fetchDistributors = async () => {
        setLoadingDists(true);
        try {
            const res = await api.get("/admin/distributors");
            if (res.data.success) {
                setDistributors(res.data.distributors);
                // Keep selected distributor reference updated if it exists
                if (selectedDist) {
                    const updated = res.data.distributors.find((d: Distributor) => d.id === selectedDist.id);
                    if (updated) setSelectedDist(updated);
                }
            }
        } catch (err) {
            console.error("Failed to fetch distributors", err);
            toast({
                title: "Error",
                description: "Failed to load distributors list",
                variant: "destructive"
            });
        } finally {
            setLoadingDists(false);
        }
    };

    const fetchMappedFranchises = async (distId: string) => {
        setLoadingFranchises(true);
        try {
            const res = await api.get(`/admin/distributors/${distId}/franchises`);
            if (res.data.success) {
                setMappedFranchises(res.data.franchises);
            }
        } catch (err) {
            console.error("Failed to fetch mapped franchises", err);
            toast({
                title: "Error",
                description: "Failed to load mapped franchises list",
                variant: "destructive"
            });
        } finally {
            setLoadingFranchises(false);
        }
    };

    const fetchEligibleFranchises = async () => {
        setLoadingEligible(true);
        try {
            const res = await api.get("/admin/franchises/eligible");
            if (res.data.success) {
                setEligibleFranchises(res.data.franchises);
            }
        } catch (err) {
            console.error("Failed to fetch eligible franchises", err);
        } finally {
            setLoadingEligible(false);
        }
    };

    const fetchAllCategories = async (brand?: 'AF' | 'AC') => {
        try {
            const params = brand ? `?brand=${brand}` : '';
            const res = await api.get(`/catalog/categories${params}`);
            if (res.data.success) {
                setAllCategories(res.data.categories);
            }
        } catch (err) {
            console.error("Failed to fetch categories", err);
        }
    };

    const fetchAllowedCategories = async (distId: string) => {
        setLoadingCategories(true);
        try {
            const res = await api.get(`/admin/distributors/${distId}/categories`);
            if (res.data.success) {
                setAllowedCategoryIds(res.data.categories.map((c: any) => c.category_id));
            }
        } catch (err) {
            console.error("Failed to fetch allowed categories", err);
            toast({
                title: "Error",
                description: "Failed to load allowed categories",
                variant: "destructive"
            });
        } finally {
            setLoadingCategories(false);
        }
    };

    /* Products sit on the deepest categories and only those are matched, so a
       parent ("Mats") stands for every category under it ("PU/PVC", "TPE"):
       ticking it ticks them all, and only the deepest ones are saved. */
    const leavesUnder = (categoryId: string): string[] => {
        const kids = allCategories.filter(c => (c.parentId ?? null) === categoryId);
        return kids.length ? kids.flatMap(k => leavesUnder(k.id)) : [categoryId];
    };
    const isLeaf = (categoryId: string) => !allCategories.some(c => (c.parentId ?? null) === categoryId);

    const handleToggleCategory = (categoryId: string) => {
        const leaves = leavesUnder(categoryId);
        setAllowedCategoryIds(prev => {
            const allOn = leaves.every(id => prev.includes(id));
            /* A parent saved on its own before sold nothing; it is dropped either way. */
            const rest = prev.filter(id => !leaves.includes(id) && id !== categoryId);
            return allOn ? rest : [...rest, ...leaves];
        });
    };

    const toggleCategoryExpanded = (categoryId: string) => {
        setExpandedCategoryIds(prev => {
            const next = new Set(prev);
            if (next.has(categoryId)) next.delete(categoryId);
            else next.add(categoryId);
            return next;
        });
    };

    // Recursive category tree renderer — the hierarchy can be many levels deep
    // (e.g. Accessories > 4 Wheeler Accessories > Healthy Memory For Comfort > …),
    // so we render every level with its own checkbox + expand/collapse, indenting
    // each level. This lets an admin check a specific deep leaf instead of only a
    // whole top-level branch.
    const getChildCategories = (parentId: string | null) =>
        allCategories
            .filter(c => (c.parentId ?? null) === parentId)
            .sort((a, b) => a.name.localeCompare(b.name));

    const renderCategoryNode = (cat: Category, level: number) => {
        const children = getChildCategories(cat.id);
        const hasChildren = children.length > 0;
        const isExpanded = expandedCategoryIds.has(cat.id);
        const leaves = hasChildren ? leavesUnder(cat.id) : [cat.id];
        const checked = leaves.every(id => allowedCategoryIds.includes(id));
        // How many descendant categories (any depth) are selected — shown as a hint.
        const selectedDesc = hasChildren ? leaves.filter(id => allowedCategoryIds.includes(id)).length : 0;

        return (
            <div key={cat.id} className="rounded-lg">
                <div
                    className="flex items-center gap-2 py-1.5"
                    style={{ paddingLeft: `${level * 18}px` }}
                >
                    {hasChildren ? (
                        <button
                            type="button"
                            onClick={() => toggleCategoryExpanded(cat.id)}
                            className="text-slate-400 hover:text-orange-500 shrink-0"
                        >
                            <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        </button>
                    ) : (
                        <span className="w-4 h-4 shrink-0" />
                    )}
                    <button
                        type="button"
                        onClick={() => handleToggleCategory(cat.id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                            checked
                                ? "bg-orange-500 text-white border-orange-500"
                                : "bg-white text-slate-700 border-slate-200 hover:border-orange-200"
                        }`}
                    >
                        {checked && <Check className="w-3 h-3" />}
                        {cat.name}
                    </button>
                    {hasChildren && (
                        <span className="text-[10px] text-slate-400 font-medium">
                            {selectedDesc > 0 ? `${selectedDesc} of ${leaves.length} selected` : `${children.length} subcategor${children.length === 1 ? 'y' : 'ies'}`}
                        </span>
                    )}
                </div>
                {hasChildren && isExpanded && (
                    <div>
                        {children.map(child => renderCategoryNode(child, level + 1))}
                    </div>
                )}
            </div>
        );
    };

    const handleSaveAllowedCategories = async () => {
        if (!selectedDist) return;
        setSavingCategories(true);
        try {
            const res = await api.put(`/admin/distributors/${selectedDist.id}/categories`, {
                categoryIds: allowedCategoryIds.filter(isLeaf)
            });
            if (res.data.success) {
                toast({
                    title: "Categories Updated",
                    description: res.data.message
                });
            }
        } catch (err: any) {
            console.error("Failed to save allowed categories", err);
            toast({
                title: "Save Failed",
                description: getErrorMessage(err, "Could not update allowed categories"),
                variant: "destructive"
            });
        } finally {
            setSavingCategories(false);
        }
    };

    const fetchFranchiseOrders = async (vendorId: string) => {
        setLoadingFranchiseOrders(true);
        try {
            const res = await api.get(`/admin/franchises/${vendorId}/orders`);
            if (res.data.success) {
                setFranchiseOrders(res.data.orders || []);
            }
        } catch (err) {
            console.error("Failed to fetch franchise orders", err);
            toast({
                title: "Error",
                description: "Failed to load franchise orders",
                variant: "destructive"
            });
        } finally {
            setLoadingFranchiseOrders(false);
        }
    };

    const handleOpenFranchiseOrders = async (franchise: Franchise) => {
        setSelectedFranchise(franchise);
        setOrdersDialogOpen(true);
        setFranchiseOrders([]);
        await fetchFranchiseOrders(franchise.user_id);
    };

    const handleDownloadOrderPdf = async (orderId: string) => {
        try {
            const res = await api.get(`/orders/${orderId}/pdf`, { responseType: 'blob' });
            const blob = new Blob([res.data], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Order-${orderId}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            toast({
                title: "Download Failed",
                description: "Could not download order PDF",
                variant: "destructive"
            });
        }
    };



    const handleMapFranchise = async () => {
        if (!selectedDist || !selectedFranchiseIds.length) {
            toast({
                title: "Error",
                description: "Please select the franchise stores to map.",
                variant: "destructive"
            });
            return;
        }

        setMappingFranchise(true);
        try {
            const res = await api.post(`/admin/distributors/${selectedDist.id}/franchise-assignments`, {
                vendorIds: selectedFranchiseIds
            });

            if (res.data.success) {
                const skipped: { name: string; reason: string }[] = res.data.skipped ?? [];
                toast({
                    title: res.data.added ? "Mapped successfully" : "Nothing mapped",
                    description: [res.data.message, ...skipped.slice(0, 5).map(x => `${x.name}: ${x.reason}`), skipped.length > 5 ? `+${skipped.length - 5} more skipped` : null].filter(Boolean).join("\n"),
                    variant: res.data.added ? undefined : "destructive",
                });
                setSelectedFranchiseIds([]);
                setFranchiseSearchQuery("");
                await fetchMappedFranchises(selectedDist.id);
                await fetchEligibleFranchises();
                await fetchDistributors(); // Update mapped count badges
            }
        } catch (err: any) {
            console.error("Failed to map franchise", err);
            toast({
                title: "Mapping Failed",
                description: getErrorMessage(err, "Could not map franchise"),
                variant: "destructive"
            });
        } finally {
            setMappingFranchise(false);
        }
    };

    const handleUnmapFranchise = async (vendorId: string, storeName: string) => {
        if (!selectedDist) return;
        if (!confirm(`Are you sure you want to remove "${storeName}" from ${selectedDist.name}?`)) return;

        setUnmappingFranchiseId(vendorId);
        try {
            const res = await api.delete(`/admin/distributors/${selectedDist.id}/franchise-assignments/${vendorId}`);

            if (res.data.success) {
                toast({
                    title: "Unmapped successfully",
                    description: res.data.message
                });
                await fetchMappedFranchises(selectedDist.id);
                await fetchEligibleFranchises();
                await fetchDistributors(); // Update mapped count badges
            }
        } catch (err: any) {
            console.error("Failed to unmap franchise", err);
            toast({
                title: "Unmapping Failed",
                description: getErrorMessage(err, "Could not unmap franchise"),
                variant: "destructive"
            });
        } finally {
            setUnmappingFranchiseId(null);
        }
    };

    // Filtered distributors
    const filteredDists = distributors.filter(d => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            d.name.toLowerCase().includes(q) ||
            d.city.toLowerCase().includes(q) ||
            d.state.toLowerCase().includes(q)
        );
    });

    // Available franchises to assign (excluding ones already mapped to THIS distributor;
    // a franchise can be mapped to multiple distributors, so other mappings don't exclude it)
    const mappedFranchiseIds = new Set(mappedFranchises.map(f => f.user_id));
    const availableFranchises = eligibleFranchises.filter(f => {
        if (mappedFranchiseIds.has(f.user_id)) return false;

        if (!franchiseSearchQuery) return true;
        const q = franchiseSearchQuery.toLowerCase();
        return (
            f.store_name.toLowerCase().includes(q) ||
            f.city.toLowerCase().includes(q) ||
            f.state.toLowerCase().includes(q)
        );
    });

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-12rem)]">
            
            {/* LEFT SIDE: DISTRIBUTORS LIST (4 Columns) */}
            <div className="lg:col-span-4 flex flex-col gap-4">
                <Card className="border-orange-100 shadow-sm overflow-hidden flex flex-col h-full">
                    <CardHeader className="bg-orange-50/30 border-b border-orange-50 pb-4">
                        <div>
                            <CardTitle className="text-base font-bold text-slate-800">Distributors</CardTitle>
                            <CardDescription className="text-xs">Select a distributor to map hierarchy</CardDescription>
                        </div>
                    </CardHeader>
                    
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <Input
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search distributors..."
                                className="pl-9 bg-white border-orange-100 focus-visible:ring-orange-500 h-9 rounded-xl text-xs"
                            />
                        </div>
                    </div>

                    <CardContent className="p-0 overflow-y-auto flex-1 max-h-[500px] lg:max-h-[600px] divide-y divide-slate-50">
                        {loadingDists ? (
                            <div className="flex justify-center items-center py-20">
                                <Loader2 className="h-6 w-6 text-orange-500 animate-spin" />
                            </div>
                        ) : filteredDists.length === 0 ? (
                            <div className="text-center py-16 text-slate-400">
                                <Building2 className="h-10 w-10 mx-auto mb-3 opacity-20" />
                                <p className="text-xs">No distributors found</p>
                            </div>
                        ) : (
                            filteredDists.map(dist => {
                                const isSelected = selectedDist?.id === dist.id;
                                return (
                                    <div
                                        key={dist.id}
                                        onClick={() => setSelectedDist(dist)}
                                        className={`flex items-center justify-between p-4 cursor-pointer transition-all duration-300 ${
                                            isSelected 
                                                ? "bg-orange-50/80 border-l-4 border-l-orange-500" 
                                                : "hover:bg-slate-50/50"
                                        }`}
                                    >
                                        <div className="min-w-0">
                                            <p className={`text-xs font-black truncate ${isSelected ? "text-orange-600" : "text-slate-800"}`}>
                                                {dist.name}
                                            </p>
                                            <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                                                <MapPin className="w-3 h-3 shrink-0" />
                                                {dist.city}, {dist.state}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge className={`rounded-xl text-[9px] font-bold ${
                                                isSelected 
                                                    ? "bg-orange-500 text-white" 
                                                    : "bg-slate-100 text-slate-600 border-none"
                                            }`}>
                                                {dist.franchise_count} Mapped
                                            </Badge>
                                            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${
                                                isSelected ? "text-orange-500 translate-x-0.5" : "text-slate-300"
                                            }`} />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* RIGHT SIDE: HIERARCHY MANAGER (8 Columns) */}
            <div className="lg:col-span-8">
                {!selectedDist ? (
                    <div className="bg-white border border-orange-100 border-dashed rounded-3xl p-12 text-center h-full flex flex-col justify-center items-center shadow-sm">
                        <Building2 className="w-16 h-16 text-orange-200 mb-4 opacity-70" />
                        <h3 className="font-black text-slate-800 text-base">Hierarchy Mappings</h3>
                        <p className="text-slate-400 text-xs mt-1.5 max-w-sm">
                            Select a distributor from the left panel to configure its franchise network, add assignments, and unmap active stores.
                        </p>
                        <ArrowRight className="w-6 h-6 text-orange-400 animate-pulse mt-4 hidden lg:block" />
                    </div>
                ) : (
                    <Card className="border-orange-100 shadow-sm overflow-hidden h-full flex flex-col">
                        <CardHeader className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white pb-5 relative">
                            <div className="absolute right-4 top-4 bg-orange-500/20 text-orange-300 border border-orange-500/30 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full">
                                Distributor Profile
                            </div>
                            
                            <h2 className="text-lg font-black tracking-tight">{selectedDist.name}</h2>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 text-xs text-slate-300">
                                <div className="flex items-center gap-2">
                                    <Mail className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                                    <span className="truncate">{selectedDist.email}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Phone className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                                    <span>{selectedDist.phone_number}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                                    <span className="truncate">{selectedDist.address ? `${selectedDist.address}, ` : ''}{selectedDist.city}, {selectedDist.state}</span>
                                </div>
                            </div>
                        </CardHeader>

                        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-xs font-black text-slate-600 uppercase tracking-wider">Allowed Product Categories</h3>
                                    {/* Brand badge */}
                                    {(selectedDist.allowed_brands || 'AF') === 'AFAC' ? (
                                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">AFAC</span>
                                    ) : (selectedDist.allowed_brands || 'AF') === 'AC' ? (
                                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">AC</span>
                                    ) : (
                                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">AF</span>
                                    )}
                                </div>
                                <Button
                                    onClick={handleSaveAllowedCategories}
                                    disabled={savingCategories || loadingCategories}
                                    size="sm"
                                    className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl h-8 px-4 font-black text-[11px]"
                                >
                                    {savingCategories ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                                    Save Categories
                                </Button>
                            </div>

                            {/* Brand tabs — only visible for AFAC distributors */}
                            {(selectedDist.allowed_brands || 'AF') === 'AFAC' && (
                                <div className="flex gap-1 mb-3 p-1 bg-slate-100 rounded-xl w-fit">
                                    {(['AF', 'AC'] as const).map(b => (
                                        <button
                                            key={b}
                                            onClick={() => setActiveBrandTab(b)}
                                            className={`text-[11px] font-bold px-4 py-1.5 rounded-lg transition-all ${
                                                activeBrandTab === b
                                                    ? b === 'AF'
                                                        ? 'bg-orange-500 text-white shadow-sm'
                                                        : 'bg-blue-500 text-white shadow-sm'
                                                    : 'text-slate-500 hover:text-slate-700'
                                            }`}
                                        >
                                            {b === 'AF' ? 'Autoform (AF)' : 'Autocruze (AC)'}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <p className="text-[11px] text-slate-400 mb-3">
                                {(selectedDist.allowed_brands || 'AF') === 'AFAC'
                                    ? `Showing ${activeBrandTab === 'AF' ? 'Autoform (AF)' : 'Autocruze (AC)'} categories. Switch tab to configure the other brand.`
                                    : 'This distributor can only sell & stock products from the categories checked below.'
                                }
                            </p>
                            {loadingCategories ? (
                                <div className="flex justify-center items-center py-6">
                                    <Loader2 className="h-5 w-5 text-orange-500 animate-spin" />
                                </div>
                            ) : allCategories.length === 0 ? (
                                <p className="text-xs text-slate-400">No categories found in the catalog yet.</p>
                            ) : (
                                <div className="space-y-0.5 max-h-96 overflow-y-auto pr-1 border border-slate-100 rounded-xl bg-white p-2">
                                    {getChildCategories(null).map(root => renderCategoryNode(root, 0))}
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                            <h3 className="text-xs font-black text-slate-600 uppercase tracking-wider mb-3">Map Franchise to Network</h3>
                            
                            <div className="flex flex-col sm:flex-row gap-3">
                                <div className="flex-1">
                                    <FranchiseMultiPicker
                                        franchises={eligibleFranchises as any}
                                        mappedIds={mappedFranchiseIds}
                                        distributorBrand={selectedDist.allowed_brands || 'AF'}
                                        value={selectedFranchiseIds}
                                        onChange={setSelectedFranchiseIds}
                                    />
                                </div>
                                
                                <Button
                                    onClick={handleMapFranchise}
                                    disabled={mappingFranchise || !selectedFranchiseIds.length}
                                    className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl h-10 px-6 font-black text-xs shrink-0"
                                >
                                    {mappingFranchise ? (
                                        <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                                    ) : (
                                        <Check className="w-4 h-4 mr-1.5" />
                                    )}
                                    {selectedFranchiseIds.length > 1 ? `Map ${selectedFranchiseIds.length} Franchises` : 'Map Franchise'}
                                </Button>
                            </div>
                        </div>

                        <div className="flex-1 p-6 flex flex-col">
                            <h3 className="text-xs font-black text-slate-600 uppercase tracking-wider mb-3">
                                Mapped Franchises ({mappedFranchises.length})
                            </h3>

                            <div className="flex-1 overflow-x-auto border border-slate-100 rounded-2xl bg-white shadow-sm">
                                {loadingFranchises ? (
                                    <div className="flex justify-center items-center py-20">
                                        <Loader2 className="h-6 w-6 text-orange-500 animate-spin" />
                                    </div>
                                ) : mappedFranchises.length === 0 ? (
                                    <div className="text-center py-16 text-slate-400 flex flex-col justify-center items-center">
                                        <Store className="h-12 w-12 mb-3 opacity-20" />
                                        <p className="text-sm font-bold">No franchises assigned yet</p>
                                        <p className="text-xs mt-1">Use the mapper dropdown above to assign stores to this distributor.</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-xs text-left border-collapse">
                                        <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider">
                                            <tr>
                                                <th className="px-5 py-3.5">Store Details</th>
                                                <th className="px-5 py-3.5">City & Region</th>
                                                <th className="px-5 py-3.5">Contact Email</th>
                                                <th className="px-5 py-3.5 text-center">Orders</th>
                                                <th className="px-5 py-3.5 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {mappedFranchises.map(franchise => (
                                            <tr
                                                key={franchise.user_id}
                                                className="hover:bg-slate-50/50 transition-colors"
                                            >
                                                    <td
                                                        className="px-5 py-3.5 font-bold text-slate-800 cursor-pointer"
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => handleOpenFranchiseOrders(franchise)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                handleOpenFranchiseOrders(franchise);
                                                            }
                                                        }}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <Store className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                            {franchise.store_name}
                                                        </div>
                                                    </td>
                                                    <td
                                                        className="px-5 py-3.5 text-slate-600 cursor-pointer"
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => handleOpenFranchiseOrders(franchise)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                handleOpenFranchiseOrders(franchise);
                                                            }
                                                        }}
                                                    >
                                                        {franchise.city}, {franchise.state}
                                                    </td>
                                                    <td
                                                        className="px-5 py-3.5 text-slate-600 font-mono cursor-pointer"
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => handleOpenFranchiseOrders(franchise)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                handleOpenFranchiseOrders(franchise);
                                                            }
                                                        }}
                                                    >
                                                        {franchise.store_email}
                                                    </td>
                                                    <td
                                                        className="px-5 py-3.5 cursor-pointer"
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => handleOpenFranchiseOrders(franchise)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                handleOpenFranchiseOrders(franchise);
                                                            }
                                                        }}
                                                    >
                                                        <div className="max-w-full overflow-x-auto">
                                                            <div className="flex flex-nowrap justify-center gap-2 whitespace-nowrap min-w-max">
                                                                <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200 whitespace-nowrap">
                                                                {franchise.order_confirmed_count || 0} Confirmed
                                                                </Badge>
                                                                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200 whitespace-nowrap">
                                                                {franchise.order_pending_count || 0} Pending
                                                                </Badge>
                                                                <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-red-200 whitespace-nowrap">
                                                                {franchise.order_declined_count || 0} Declined
                                                                </Badge>
                                                                <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200 whitespace-nowrap">
                                                                {franchise.order_total_count || 0} Total
                                                                </Badge>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            disabled={unmappingFranchiseId === franchise.user_id}
                                                            onClick={() => handleUnmapFranchise(franchise.user_id, franchise.store_name)}
                                                            className="h-8 w-8 rounded-xl text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                                                            title="Unmap Franchise"
                                                        >
                                                            {unmappingFranchiseId === franchise.user_id ? (
                                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                            ) : (
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            )}
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </Card>
                )}
            </div>
            <AdminFranchiseOrdersDialog
                open={ordersDialogOpen}
                onOpenChange={setOrdersDialogOpen}
                franchise={selectedFranchise}
                orders={franchiseOrders}
                loading={loadingFranchiseOrders}
                onDownloadPdf={handleDownloadOrderPdf}
            />


        </div>
    );
};

