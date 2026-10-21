import { useState, useEffect, useCallback } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Loader2, Plus, Trash2, Pencil, Mail, Package, Box, Wrench, Monitor, Zap,
    HelpCircle, Car, Truck, Shield, Wallet, Users, Store, GripVertical
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Manage grievance categories.
 *
 * A category used to live in five places in the code — the column enum, the
 * franchise form, the admin labels, the badge styling, and the table deciding
 * who receives it. Adding one meant a deploy, and forgetting the routing entry
 * sent grievances silently to the wrong desk. They are data now.
 */

const ICONS: Record<string, any> = {
    Package, Box, Wrench, Monitor, Zap, HelpCircle, Car, Truck, Shield, Wallet, Users, Store,
};

const COLORS = [
    "blue", "emerald", "amber", "fuchsia", "teal", "slate",
    "rose", "violet", "indigo", "orange", "cyan", "lime",
];

/** Tailwind needs literal class names, so the palette is spelled out. */
const SWATCH: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    fuchsia: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
    teal: "bg-teal-50 text-teal-700 border-teal-200",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
    lime: "bg-lime-50 text-lime-700 border-lime-200",
};

interface Category {
    id: string;
    value: string;
    label: string;
    assignee_name: string | null;
    assignee_email: string | null;
    department: string | null;
    color: string;
    icon: string;
    sort_order: number;
    is_active: number;
    grievance_count: number;
}

interface Props {
    open: boolean;
    onClose: () => void;
    onChanged: () => void;
}

const blank = {
    label: "", assignee_name: "", assignee_email: "",
    color: "slate", icon: "HelpCircle", is_active: true,
};

export const GrievanceCategoryManager = ({ open, onClose, onChanged }: Props) => {
    const { toast } = useToast();
    const [rows, setRows] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const [form, setForm] = useState({ ...blank });
    const [adding, setAdding] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get("/grievance/categories");
            setRows(res.data.categories || []);
        } catch (error: any) {
            toast({
                title: "Could not load categories",
                description: getErrorMessage(error, "Try reopening"),
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { if (open) { load(); setEditing(null); setAdding(false); } }, [open, load]);

    const startAdd = () => { setForm({ ...blank }); setAdding(true); setEditing(null); };
    const startEdit = (c: Category) => {
        setForm({
            label: c.label,
            assignee_name: c.assignee_name || "",
            assignee_email: c.assignee_email || "",
            color: c.color,
            icon: c.icon,
            is_active: c.is_active === 1,
        });
        setEditing(c.id);
        setAdding(false);
    };

    const save = async () => {
        if (!form.label.trim()) return;
        setSaving(true);
        try {
            if (adding) {
                await api.post("/grievance/categories", form);
                toast({ title: `"${form.label}" added` });
            } else if (editing) {
                await api.put(`/grievance/categories/${editing}`, form);
                toast({ title: "Category updated" });
            }
            setAdding(false); setEditing(null);
            await load();
            onChanged();
        } catch (error: any) {
            toast({
                title: "Could not save",
                description: getErrorMessage(error, "Failed to save the category"),
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const remove = async (c: Category) => {
        setSaving(true);
        try {
            const res = await api.delete(`/grievance/categories/${c.id}`);
            toast({
                title: res.data?.deactivated ? "Category turned off" : "Category deleted",
                description: res.data?.message,
            });
            await load();
            onChanged();
        } catch (error: any) {
            toast({
                title: "Could not remove",
                description: getErrorMessage(error, "Failed"),
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (c: Category) => {
        try {
            await api.put(`/grievance/categories/${c.id}`, { is_active: c.is_active !== 1 });
            await load();
            onChanged();
        } catch (error: any) {
            toast({ title: "Could not change", description: getErrorMessage(error, "Failed"), variant: "destructive" });
        }
    };

    const editorOpen = adding || editing !== null;

    return (
        <Dialog open={open} onOpenChange={v => { if (!v && !saving) onClose(); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
                    <DialogTitle className="text-base">Complaint categories</DialogTitle>
                    <DialogDescription className="text-xs">
                        What a store can pick, and who each one goes to. Changes take effect
                        immediately — no deploy needed.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-3">
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
                        </div>
                    ) : (
                        <>
                            {rows.map(c => {
                                const Icon = ICONS[c.icon] || HelpCircle;
                                const isEditing = editing === c.id;
                                return (
                                    <div key={c.id} className={cn(
                                        "rounded-2xl border p-4 transition-colors",
                                        isEditing ? "border-orange-200 bg-orange-50/30" : "border-slate-100",
                                        c.is_active !== 1 && !isEditing && "opacity-60"
                                    )}>
                                        {!isEditing ? (
                                            <div className="flex items-center gap-3">
                                                <GripVertical className="h-4 w-4 text-slate-200 shrink-0" />
                                                <span className={cn(
                                                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold shrink-0",
                                                    SWATCH[c.color] || SWATCH.slate
                                                )}>
                                                    <Icon className="h-3.5 w-3.5" />
                                                    {c.label}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[11px] text-slate-500 truncate flex items-center gap-1">
                                                        <Mail className="h-3 w-3 shrink-0" />
                                                        {c.assignee_name || "Unassigned"}
                                                        {c.assignee_email ? ` · ${c.assignee_email}` : ""}
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 mt-0.5">
                                                        <span className="font-mono">{c.value}</span>
                                                        {" · "}
                                                        {c.grievance_count} grievance{c.grievance_count === 1 ? "" : "s"}
                                                    </p>
                                                </div>
                                                <Switch
                                                    checked={c.is_active === 1}
                                                    onCheckedChange={() => toggleActive(c)}
                                                    title={c.is_active === 1 ? "Stores can pick this" : "Hidden from stores"}
                                                />
                                                <Button variant="ghost" size="icon" onClick={() => startEdit(c)}
                                                    className="h-8 w-8 shrink-0 text-slate-400 hover:text-orange-600">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => remove(c)} disabled={saving}
                                                    title={c.grievance_count > 0 ? "In use — will be turned off instead" : "Delete"}
                                                    className="h-8 w-8 shrink-0 text-slate-400 hover:text-red-600">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <Editor form={form} setForm={setForm} onSave={save} onCancel={() => setEditing(null)} saving={saving} valueSlug={c.value} />
                                        )}
                                    </div>
                                );
                            })}

                            {adding && (
                                <div className="rounded-2xl border border-orange-200 bg-orange-50/30 p-4">
                                    <Editor form={form} setForm={setForm} onSave={save} onCancel={() => setAdding(false)} saving={saving} />
                                </div>
                            )}
                        </>
                    )}
                </div>

                <DialogFooter className="px-6 py-4 border-t border-slate-100 shrink-0 sm:justify-between">
                    <Button variant="outline" onClick={startAdd} disabled={editorOpen || loading}
                        className="border-slate-200 gap-1.5">
                        <Plus className="h-3.5 w-3.5" /> Add category
                    </Button>
                    <Button variant="outline" onClick={onClose} disabled={saving} className="border-slate-200">
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const Editor = ({ form, setForm, onSave, onCancel, saving, valueSlug }: any) => (
    <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
            <div>
                <label className="text-[11px] font-bold text-slate-500">Name shown to stores</label>
                <Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })}
                    placeholder="e.g. EV & PPF" className="h-9 text-sm mt-1" autoFocus />
                {valueSlug && (
                    // The stored value is what every existing grievance references,
                    // so it is fixed once created.
                    <p className="text-[10px] text-slate-400 mt-1">
                        id <span className="font-mono">{valueSlug}</span> — cannot change
                    </p>
                )}
            </div>
            <div>
                <label className="text-[11px] font-bold text-slate-500">Goes to</label>
                <Input value={form.assignee_name} onChange={e => setForm({ ...form, assignee_name: e.target.value })}
                    placeholder="e.g. Gaurish Sharma" className="h-9 text-sm mt-1" />
            </div>
        </div>

        <div>
            <label className="text-[11px] font-bold text-slate-500">Their email</label>
            <Input type="email" value={form.assignee_email}
                onChange={e => setForm({ ...form, assignee_email: e.target.value })}
                placeholder="name@autoformindia.com" className="h-9 text-sm mt-1" />
            <p className="text-[10px] text-slate-400 mt-1">
                Every complaint in this category is auto-assigned and emailed here.
            </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
            <div>
                <label className="text-[11px] font-bold text-slate-500">Colour</label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {COLORS.map(c => (
                        <button key={c} onClick={() => setForm({ ...form, color: c })}
                            title={c}
                            className={cn("h-7 w-7 rounded-lg border-2 transition-all",
                                SWATCH[c],
                                form.color === c ? "ring-2 ring-orange-400 ring-offset-1" : "")} />
                    ))}
                </div>
            </div>
            <div>
                <label className="text-[11px] font-bold text-slate-500">Icon</label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {Object.entries(ICONS).map(([name, Ico]) => (
                        <button key={name} onClick={() => setForm({ ...form, icon: name })}
                            title={name}
                            className={cn("h-7 w-7 rounded-lg border flex items-center justify-center transition-all",
                                form.icon === name
                                    ? "border-orange-300 bg-orange-50 text-orange-600"
                                    : "border-slate-200 text-slate-400 hover:border-slate-300")}>
                            <Ico className="h-3.5 w-3.5" />
                        </button>
                    ))}
                </div>
            </div>
        </div>

        <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-600">
                <Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} />
                Stores can pick this
            </label>
            <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onCancel} disabled={saving} className="border-slate-200">
                    Cancel
                </Button>
                <Button size="sm" onClick={onSave} disabled={!form.label.trim() || saving}
                    className="bg-orange-600 hover:bg-orange-700">
                    {saving && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
                    Save
                </Button>
            </div>
        </div>
    </div>
);
