import { useState, useEffect, useMemo } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import {
    Loader2, Plus, Trash2, Search, Phone, Mail, UserRound, RefreshCw, Power, Inbox, Copy, KeyRound, Store
} from "lucide-react";

/**
 * ASM Management — the ASMs themselves.
 *
 * Adding an ASM here also gives them a login: the hidden /asm/login page, OTP
 * on WhatsApp to this number. Switching one off logs them out. The areas they
 * cover are still set under Lead Management, which is where routing lives.
 * Their expense claims are a separate screen, ASM Expenses, run by HR.
 * Which stores an ASM looks after is set on each franchise's own screen; the
 * Stores button here only lists them.
 */

interface Asm {
    id: string;
    name: string;
    phone_number: string;
    email: string | null;
    is_active: number;
    profile_id: string | null;
    area_count: number;
    lead_count: number;
    store_count: number;
}

interface AsmStore {
    vendor_details_id: string;
    store_name: string;
    store_code: string | null;
    city: string | null;
    state: string | null;
    contact_name: string | null;
    phone_number: string | null;
    is_franchise: boolean;
    is_distributor: boolean;
    is_verified: boolean;
    is_active: boolean;
}

interface AsmLead {
    id: string;
    created_at: string;
    source: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    product: string | null;
    car_model: string | null;
    state: string | null;
    raw_area: string | null;
    matched_area: string | null;
    status: string;
}

const LEAD_STATUS: Record<string, { label: string; tone: string }> = {
    sent: { label: "Sent", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    failed: { label: "Failed", tone: "bg-rose-50 text-rose-700 border-rose-200" },
    unmatched: { label: "Unmatched", tone: "bg-amber-50 text-amber-700 border-amber-200" },
    throttled: { label: "Throttled", tone: "bg-slate-100 text-slate-500 border-slate-200" },
    duplicate: { label: "Repeat", tone: "bg-slate-100 text-slate-500 border-slate-200" },
};

const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

const loginUrl = () => `${window.location.origin}/asm/login`;

export const AdminAsmManagement = () => {
    const { toast } = useToast();
    const { hasPermission, user } = useAuth();
    const canEdit = !!user?.isSuperAdmin || hasPermission("asms", "write");

    const [asms, setAsms] = useState<Asm[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);

    // Add / edit
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Asm | null>(null);
    const [form, setForm] = useState({ name: "", phone_number: "", email: "" });
    const [saving, setSaving] = useState(false);

    // One ASM's leads
    const [leadsFor, setLeadsFor] = useState<Asm | null>(null);
    const [leads, setLeads] = useState<AsmLead[]>([]);
    const [leadsLoading, setLeadsLoading] = useState(false);

    // One ASM's stores
    const [storesFor, setStoresFor] = useState<Asm | null>(null);
    const [stores, setStores] = useState<AsmStore[]>([]);
    const [storesLoading, setStoresLoading] = useState(false);

    const fetchAll = async (silent = false) => {
        if (silent) setRefreshing(true);
        else setLoading(true);
        try {
            const res = await api.get("/asm");
            if (res.data.success) setAsms(res.data.asms || []);
        } catch (error) {
            toast({ title: "Could not load ASMs", description: getErrorMessage(error, "Please try again"), variant: "destructive" });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!leadsFor) return;
        let cancelled = false;
        setLeadsLoading(true);
        setLeads([]);
        api.get(`/asm/${leadsFor.id}/leads`)
            .then(res => { if (!cancelled) setLeads(res.data.leads || []); })
            .catch(error => {
                if (!cancelled) toast({ title: "Could not load leads", description: getErrorMessage(error, ""), variant: "destructive" });
            })
            .finally(() => { if (!cancelled) setLeadsLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leadsFor]);

    useEffect(() => {
        if (!storesFor) return;
        let cancelled = false;
        setStoresLoading(true);
        setStores([]);
        api.get(`/asm/${storesFor.id}/stores`)
            .then(res => { if (!cancelled) setStores(res.data.stores || []); })
            .catch(error => {
                if (!cancelled) toast({ title: "Could not load stores", description: getErrorMessage(error, ""), variant: "destructive" });
            })
            .finally(() => { if (!cancelled) setStoresLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storesFor]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return asms;
        return asms.filter(a =>
            a.name.toLowerCase().includes(q) ||
            a.phone_number.includes(q) ||
            (a.email || "").toLowerCase().includes(q)
        );
    }, [asms, search]);

    const openAdd = () => {
        setEditing(null);
        setForm({ name: "", phone_number: "", email: "" });
        setDialogOpen(true);
    };

    const openEdit = (asm: Asm) => {
        setEditing(asm);
        setForm({ name: asm.name, phone_number: asm.phone_number, email: asm.email || "" });
        setDialogOpen(true);
    };

    const save = async () => {
        if (!form.name.trim() || !form.phone_number.trim() || !form.email.trim()) {
            toast({ title: "Name, WhatsApp number and email are required", variant: "destructive" });
            return;
        }
        setSaving(true);
        try {
            if (editing) {
                await api.put(`/asm/${editing.id}`, form);
                toast({ title: "ASM updated" });
            } else {
                await api.post("/asm", form);
                toast({ title: "ASM added", description: "They can now log in with this number." });
            }
            setDialogOpen(false);
            fetchAll(true);
        } catch (error) {
            toast({
                title: editing ? "Update failed" : "Could not add ASM",
                description: getErrorMessage(error, "Please try again"),
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (asm: Asm) => {
        setBusyId(asm.id);
        try {
            await api.put(`/asm/${asm.id}`, { is_active: !asm.is_active });
            toast({
                title: asm.is_active ? "ASM deactivated" : "ASM activated",
                description: asm.is_active
                    ? "They are logged out, and enquiries for their areas will queue as unmatched until reassigned."
                    : undefined,
            });
            fetchAll(true);
        } catch (error) {
            toast({ title: "Update failed", description: getErrorMessage(error, ""), variant: "destructive" });
        } finally {
            setBusyId(null);
        }
    };

    const remove = async (asm: Asm) => {
        if (!window.confirm(
            `Remove ${asm.name}?\n\nTheir login is deleted` +
            (asm.area_count ? `, and their ${asm.area_count} area${asm.area_count > 1 ? "s" : ""} become unassigned — enquiries from there will queue as unmatched until someone else covers them.` : ".") +
            (Number(asm.store_count) ? `\n\nTheir ${asm.store_count} store${Number(asm.store_count) > 1 ? "s go" : " goes"} back to having no ASM.` : "") +
            "\n\nTheir past leads are kept."
        )) return;
        setBusyId(asm.id);
        try {
            await api.delete(`/asm/${asm.id}`);
            toast({ title: "ASM removed" });
            fetchAll(true);
        } catch (error) {
            toast({ title: "Could not remove", description: getErrorMessage(error, ""), variant: "destructive" });
        } finally {
            setBusyId(null);
        }
    };

    const copyLoginLink = async () => {
        try {
            await navigator.clipboard.writeText(loginUrl());
            toast({ title: "Login link copied", description: loginUrl() });
        } catch {
            toast({ title: "Login link", description: loginUrl() });
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

    const withLogin = asms.filter(a => a.profile_id).length;

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-500">
                    Your ASMs, their logins and their leads. Areas they cover are set under Leads.
                </p>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={copyLoginLink}>
                        <Copy className="h-4 w-4 mr-1.5" /> ASM login link
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => fetchAll(true)} disabled={refreshing}>
                        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                    </Button>
                    {canEdit && (
                        <Button size="sm" onClick={openAdd} className="bg-orange-500 hover:bg-orange-600">
                            <Plus className="h-4 w-4 mr-1.5" /> Add ASM
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {[
                    { label: "ASMs", value: asms.length, icon: UserRound, color: "text-slate-700" },
                    { label: "Active", value: asms.filter(a => a.is_active).length, icon: Power, color: "text-emerald-600" },
                    { label: "Can log in", value: withLogin, icon: KeyRound, color: "text-blue-600" },
                    { label: "Stores assigned", value: asms.reduce((n, a) => n + Number(a.store_count || 0), 0).toLocaleString(), icon: Store, color: "text-violet-600" },
                    { label: "Leads routed", value: asms.reduce((n, a) => n + Number(a.lead_count || 0), 0).toLocaleString(), icon: Inbox, color: "text-orange-600" },
                ].map(s => (
                    <Card key={s.label} className="border-orange-100">
                        <CardContent className="p-4 flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center">
                                <s.icon className={`h-5 w-5 ${s.color}`} />
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{s.label}</p>
                                <p className={`text-xl font-black tabular-nums ${s.color}`}>{s.value}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name, number or email…"
                    className="pl-9 h-9 text-sm"
                />
            </div>

            {visible.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-orange-200 bg-white/40 p-12 text-center">
                    <UserRound className="h-8 w-8 text-orange-500 opacity-80 mx-auto mb-4" />
                    <h3 className="text-lg font-black tracking-tight text-slate-800 uppercase mb-2">
                        {search ? "No ASM matches that" : "No ASMs yet"}
                    </h3>
                    <p className="text-sm text-slate-500 max-w-md mx-auto">
                        {search ? "Try a different name, number or email." : "Add an ASM to give them a login and start routing enquiries to them."}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {visible.map(asm => (
                        <Card key={asm.id} className="rounded-2xl border-orange-100 shadow-sm">
                            <CardContent className="p-5">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-black text-slate-800">{asm.name}</p>
                                            {!asm.is_active && (
                                                <Badge variant="outline" className="text-[10px] font-black uppercase bg-slate-100 text-slate-500">Inactive</Badge>
                                            )}
                                            {asm.profile_id ? (
                                                <Badge variant="outline" className="text-[10px] font-black uppercase bg-blue-50 text-blue-700 border-blue-200 gap-1">
                                                    <KeyRound className="h-3 w-3" /> Login
                                                </Badge>
                                            ) : (
                                                <Badge
                                                    variant="outline"
                                                    className="text-[10px] font-black uppercase bg-amber-50 text-amber-700 border-amber-200"
                                                    title="Add an email to give this ASM a login"
                                                >
                                                    No login yet
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-500">
                                            <span className="flex items-center gap-1 font-mono"><Phone className="h-3 w-3" /> {asm.phone_number}</span>
                                            {asm.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {asm.email}</span>}
                                            <span>·</span>
                                            <span className="tabular-nums">{asm.area_count} area{Number(asm.area_count) === 1 ? "" : "s"}</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setStoresFor(asm)}>
                                            <Store className="h-3.5 w-3.5 mr-1" /> Stores
                                            <span className="ml-1 tabular-nums text-slate-400">{asm.store_count ?? 0}</span>
                                        </Button>
                                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setLeadsFor(asm)}>
                                            <Inbox className="h-3.5 w-3.5 mr-1" /> Leads
                                            <span className="ml-1 tabular-nums text-slate-400">{asm.lead_count}</span>
                                        </Button>
                                        {canEdit && (
                                            <>
                                                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openEdit(asm)}>
                                                    {asm.profile_id ? "Edit" : "Add login"}
                                                </Button>
                                                <Button
                                                    size="sm" variant="outline" className="h-8 w-8 p-0"
                                                    title={asm.is_active ? "Deactivate (logs them out)" : "Activate"}
                                                    disabled={busyId === asm.id}
                                                    onClick={() => toggleActive(asm)}
                                                >
                                                    {busyId === asm.id
                                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        : <Power className={`h-3.5 w-3.5 ${asm.is_active ? "text-emerald-600" : "text-slate-400"}`} />}
                                                </Button>
                                                <Button
                                                    size="sm" variant="outline"
                                                    className="h-8 w-8 p-0 text-rose-600 border-rose-200 hover:bg-rose-50"
                                                    title="Remove"
                                                    disabled={busyId === asm.id}
                                                    onClick={() => remove(asm)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Add / edit */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editing ? (editing.profile_id ? "Edit ASM" : "Give ASM a login") : "Add ASM"}</DialogTitle>
                        <DialogDescription>
                            Enquiries and the login code both go to this WhatsApp number. The number and email
                            must not already belong to a franchise, customer or admin account.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="asm-name">Name *</Label>
                            <Input id="asm-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Rahul Sharma" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="asm-phone">WhatsApp number *</Label>
                            <Input
                                id="asm-phone"
                                value={form.phone_number}
                                onChange={e => setForm({ ...form, phone_number: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                                placeholder="9876543210"
                                className="font-mono"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="asm-email">Email *</Label>
                            <Input id="asm-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                        </div>
                        <p className="text-xs text-slate-500">
                            They log in at <span className="font-mono">{loginUrl()}</span>
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={save} disabled={saving} className="bg-orange-500 hover:bg-orange-600">
                            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            {editing ? "Save" : "Add ASM"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* One ASM's stores */}
            <Dialog open={!!storesFor} onOpenChange={open => { if (!open) setStoresFor(null); }}>
                <DialogContent className="max-w-3xl grid-cols-1 [&>*]:min-w-0">
                    <DialogHeader>
                        <DialogTitle>Stores under {storesFor?.name}</DialogTitle>
                        <DialogDescription>
                            To move a store to another ASM, open it under Franchises or Distributors and change its ASM there.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200">
                        {storesLoading ? (
                            <div className="flex items-center justify-center py-12 text-slate-400">
                                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                            </div>
                        ) : stores.length === 0 ? (
                            <p className="text-sm text-slate-400 px-4 py-8 text-center">No stores assigned to this ASM yet.</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                    <tr>
                                        <th className="text-left px-3 py-2">Store</th>
                                        <th className="text-left px-3 py-2">Location</th>
                                        <th className="text-left px-3 py-2">Owner</th>
                                        <th className="text-left px-3 py-2">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {stores.map(st => (
                                        <tr key={st.vendor_details_id} className="align-top">
                                            <td className="px-3 py-2">
                                                <p className="font-semibold text-slate-800">{st.store_name}</p>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    {st.store_code && <span className="text-xs font-mono text-slate-500">{st.store_code}</span>}
                                                    {st.is_distributor && (
                                                        <Badge variant="outline" className="text-[9px] font-black uppercase bg-violet-50 text-violet-700 border-violet-200">Distributor</Badge>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-slate-600">{[st.city, st.state].filter(Boolean).join(", ") || "—"}</td>
                                            <td className="px-3 py-2">
                                                <p className="text-slate-700">{st.contact_name || "—"}</p>
                                                <p className="text-xs font-mono text-slate-500">{st.phone_number}</p>
                                            </td>
                                            <td className="px-3 py-2">
                                                {!st.is_verified ? (
                                                    <Badge variant="outline" className="text-[10px] font-black uppercase bg-amber-50 text-amber-700 border-amber-200">Not approved</Badge>
                                                ) : st.is_active ? (
                                                    <Badge variant="outline" className="text-[10px] font-black uppercase bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-[10px] font-black uppercase bg-slate-100 text-slate-500">Inactive</Badge>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setStoresFor(null)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* One ASM's leads */}
            <Dialog open={!!leadsFor} onOpenChange={open => { if (!open) setLeadsFor(null); }}>
                <DialogContent className="max-w-3xl grid-cols-1 [&>*]:min-w-0">
                    <DialogHeader>
                        <DialogTitle>Leads routed to {leadsFor?.name}</DialogTitle>
                        <DialogDescription>
                            Newest first, up to the last 500. Follow-up notes and stores are in Leads.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200">
                        {leadsLoading ? (
                            <div className="flex items-center justify-center py-12 text-slate-400">
                                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                            </div>
                        ) : leads.length === 0 ? (
                            <p className="text-sm text-slate-400 px-4 py-8 text-center">No leads routed to this ASM yet.</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                    <tr>
                                        <th className="text-left px-3 py-2">When</th>
                                        <th className="text-left px-3 py-2">Customer</th>
                                        <th className="text-left px-3 py-2">Area</th>
                                        <th className="text-left px-3 py-2">Product</th>
                                        <th className="text-left px-3 py-2">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {leads.map(l => {
                                        const st = LEAD_STATUS[l.status] ?? { label: l.status, tone: "bg-slate-100 text-slate-500 border-slate-200" };
                                        return (
                                            <tr key={l.id} className="align-top">
                                                <td className="px-3 py-2 whitespace-nowrap text-slate-500">{formatWhen(l.created_at)}</td>
                                                <td className="px-3 py-2">
                                                    <p className="font-semibold text-slate-800">{l.customer_name || "—"}</p>
                                                    <p className="text-xs font-mono text-slate-500">{l.customer_phone}</p>
                                                </td>
                                                <td className="px-3 py-2 text-slate-600">{l.matched_area || l.raw_area || l.state || "—"}</td>
                                                <td className="px-3 py-2 text-slate-600">
                                                    {[l.product, l.car_model].filter(Boolean).join(" · ") || "—"}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <Badge variant="outline" className={`text-[10px] font-black uppercase ${st.tone}`}>{st.label}</Badge>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setLeadsFor(null)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
