import { useState, useEffect } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DatePicker } from "@/components/ui/date-picker";
import {
    Loader2, MessageSquare, RefreshCw, AlertTriangle, CheckCircle2, PowerOff, ChevronDown, CalendarRange, X
} from "lucide-react";
import { WarrantyReminderSchedule } from "./WarrantyReminderPanel";
import { Input } from "@/components/ui/input";

interface NotificationWindow {
    startDate: string | null;
    endDate: string | null;
}

interface NotificationTypeRow {
    key: string;
    label: string;
    group: string;
    template: string;
    recipient: string;
    description: string;
    enabled: boolean;
    templateApproved: boolean;
    /** Only present on a type whose registry entry sets supportsDateWindow. */
    supportsDateWindow?: boolean;
    window: NotificationWindow | null;
    stats: {
        total: number;
        failed: number;
        delivered: number;
        lastSent: string | null;
    };
}

/**
 * The two message types that belong to the rejection-reminder feature.
 *
 * They are lifted out of the Warranty group and shown alongside the schedule
 * that drives them. Split across the page it was possible to switch the
 * schedule on while these were off and watch every send be refused — which is
 * exactly what happened on the first catch-up.
 */
const REMINDER_KEYS = ['warranty_reject_reminder_customer', 'warranty_reject_reminder_store'];
const REMINDER_SECTION = 'rejection-reminders';

/** Where a store's rating shows, each on or off, and from how many ratings an average shows. */
function RatingDisplay() {
    const { toast } = useToast();
    const [d, setD] = useState<{ whatsapp: boolean; website: boolean; customers: boolean; franchises: boolean; min_count: number } | null>(null);
    const [min, setMin] = useState("1");
    useEffect(() => {
        api.get("/admin/rating-display").then(r => { setD(r.data.settings); setMin(String(r.data.settings.min_count)); }).catch(() => undefined);
    }, []);
    const save = async (patch: Partial<{ whatsapp: boolean; website: boolean; customers: boolean; franchises: boolean; min_count: number }>) => {
        try {
            const r = await api.put("/admin/rating-display", patch);
            setD(r.data.settings); setMin(String(r.data.settings.min_count));
            toast({ title: "Saved", description: "Takes effect within a minute." });
        } catch (e: any) {
            toast({ title: "Could not save", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        }
    };
    if (!d) return null;
    const row = (label: string, note: string, on: boolean, key: "whatsapp" | "website" | "customers" | "franchises") => (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{label}</p><p className="text-xs text-slate-500">{note}</p></div>
            <Switch checked={on} onCheckedChange={v => save({ [key]: v })} aria-label={label} />
        </div>
    );
    return (
        <div className="space-y-2">
            {row("Show the rating in WhatsApp", "On the store list and on the store details a customer receives. The average only, no count.", d.whatsapp, "whatsapp")}
            {row("Show the rating to customers", "In the top right of the customer page after they scan a store's QR code.", d.customers, "customers")}
            {row("Show the rating to franchises", "Beside the profile icon, for their own store, with a period to pick.", d.franchises, "franchises")}
            {row("Send the rating to the website", "The website's store list gets rating_avg. Off sends none.", d.website, "website")}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="min-w-0"><p className="text-sm font-semibold text-slate-800">Show the average from</p><p className="text-xs text-slate-500">Below this many ratings, no average shows.</p></div>
                <div className="flex items-center gap-2">
                    <Input type="number" min={1} max={100} value={min} onChange={e => setMin(e.target.value)} className="h-9 w-20 text-right" aria-label="Show the average from this many ratings" />
                    <span className="text-sm text-slate-600">ratings</span>
                    <Button size="sm" className="h-9 bg-orange-600 hover:bg-orange-700" disabled={Number(min) === d.min_count || !(Number(min) >= 1)} onClick={() => save({ min_count: Number(min) })}>Save</Button>
                </div>
            </div>
        </div>
    );
}

export const AdminNotificationSettings = () => {
    const { toast } = useToast();
    const [types, setTypes] = useState<NotificationTypeRow[]>([]);
    const [masterEnabled, setMasterEnabled] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [reminderRunning, setReminderRunning] = useState(true);
    // Bumped whenever a toggle changes, so the reminder schedule re-reads its
    // counts instead of showing the state as of page load.
    const [settingsVersion, setSettingsVersion] = useState(0);
    // Keyed by row.key — the pending edit for a window before it is saved, so
    // typing a date doesn't fire a request per keystroke.
    const [windowDrafts, setWindowDrafts] = useState<Record<string, NotificationWindow>>({});
    const [savingWindow, setSavingWindow] = useState<string | null>(null);

    const fetchSettings = async (showToast = false) => {
        try {
            const res = await api.get("/admin/notification-settings");
            setTypes(res.data.types || []);
            setMasterEnabled(Boolean(res.data.masterEnabled));
            if (showToast) {
                setSettingsVersion(v => v + 1);
                toast({ title: "Refreshed" });
            }
        } catch (error: any) {
            toast({
                title: "Could not load settings",
                description: getErrorMessage(error, "Failed to load notification settings"),
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchSettings(); }, []);

    const toggleSection = (id: string) => {
        setOpen(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggle = async (row: NotificationTypeRow, next: boolean) => {
        setSaving(row.key);
        // Optimistic — revert if the save fails.
        setTypes(prev => prev.map(t => t.key === row.key ? { ...t, enabled: next } : t));
        try {
            await api.put("/admin/notification-settings", { updates: { [row.key]: next } });
            setSettingsVersion(v => v + 1);
            toast({
                title: next ? "Messages turned on" : "Messages turned off",
                description: `${row.label} — takes effect within 30 seconds.`
            });
        } catch (error: any) {
            setTypes(prev => prev.map(t => t.key === row.key ? { ...t, enabled: !next } : t));
            toast({
                title: "Could not save",
                description: getErrorMessage(error, "Failed to update setting"),
                variant: "destructive"
            });
        } finally {
            setSaving(null);
        }
    };

    /** The row's saved window, overridden by any unsaved edit in progress. */
    const draftFor = (row: NotificationTypeRow): NotificationWindow =>
        windowDrafts[row.key] ?? row.window ?? { startDate: null, endDate: null };

    const setDraft = (key: string, patch: Partial<NotificationWindow>) =>
        setWindowDrafts(prev => ({
            ...prev,
            [key]: { ...(prev[key] ?? types.find(t => t.key === key)?.window ?? { startDate: null, endDate: null }), ...patch }
        }));

    const saveWindow = async (row: NotificationTypeRow, value: NotificationWindow | null) => {
        setSavingWindow(row.key);
        try {
            const res = await api.put(`/admin/notification-settings/${row.key}/window`, {
                startDate: value?.startDate ?? null,
                endDate: value?.endDate ?? null,
            });
            const saved: NotificationWindow | null = res.data?.windows?.[row.key] ?? null;
            setTypes(prev => prev.map(t => t.key === row.key ? { ...t, window: saved } : t));
            setWindowDrafts(prev => {
                const next = { ...prev };
                delete next[row.key];
                return next;
            });
            toast({
                title: saved ? "Send window saved" : "Send window cleared",
                description: saved
                    ? `${row.label} will only send for warranties registered ${saved.startDate || "any date"} through ${saved.endDate || "any date"}.`
                    : `${row.label} will send regardless of registration date.`
            });
        } catch (error: any) {
            toast({
                title: "Could not save the date range",
                description: getErrorMessage(error, "Failed to update the send window"),
                variant: "destructive"
            });
        } finally {
            setSavingWindow(null);
        }
    };

    const messageRow = (row: NotificationTypeRow) => (
        <div
            key={row.key}
            className={`flex flex-col gap-3 p-3 rounded-xl border transition-colors ${
                row.enabled ? "border-slate-100 bg-white" : "border-slate-100 bg-slate-50/70"
            }`}
        >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className={`font-bold text-sm ${row.enabled ? "text-slate-800" : "text-slate-400"}`}>
                            {row.label}
                        </p>
                        {!row.templateApproved && (
                            <Badge className="bg-rose-100 text-rose-700 border-rose-200 gap-1">
                                <AlertTriangle className="h-3 w-3" /> Template not approved
                            </Badge>
                        )}
                        {row.templateApproved && row.stats.total === 0 && (
                            <Badge variant="secondary" className="bg-slate-100 text-slate-500 border-none">
                                Never sent
                            </Badge>
                        )}
                        {row.supportsDateWindow && row.window && (row.window.startDate || row.window.endDate) && (
                            <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 gap-1">
                                <CalendarRange className="h-3 w-3" />
                                {row.window.startDate || "any date"} → {row.window.endDate || "any date"}
                            </Badge>
                        )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{row.description}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400 mt-1">
                        <span className="font-mono">{row.template}</span>
                        <span>→ {row.recipient}</span>
                        {row.stats.total > 0 && (
                            <span className="tabular-nums">
                                {row.stats.total} sent (30d)
                                {row.stats.failed > 0 && (
                                    <span className="text-rose-500 font-semibold"> · {row.stats.failed} failed</span>
                                )}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-[11px] font-bold uppercase tracking-wider ${
                        row.enabled ? "text-emerald-600" : "text-slate-400"
                    }`}>
                        {row.enabled ? "On" : "Off"}
                    </span>
                    {saving === row.key
                        ? <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                        : <Switch checked={row.enabled} onCheckedChange={v => toggle(row, v)} />}
                </div>
            </div>

            {/* Registration-date send window. Only offered where the server
                registry marks the type as supporting one — a date range means
                nothing for e.g. login OTP. */}
            {row.supportsDateWindow && (() => {
                const draft = draftFor(row);
                const isDirty = windowDrafts[row.key] !== undefined;
                return (
                    <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-end gap-2">
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                                Only send for warranties registered
                            </p>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <DatePicker
                                        value={draft.startDate ?? undefined}
                                        onChange={v => setDraft(row.key, { startDate: v })}
                                        maxDate={draft.endDate ? new Date(draft.endDate) : undefined}
                                        placeholder="Any start"
                                    />
                                </div>
                                <span className="text-slate-400 text-xs font-bold shrink-0">to</span>
                                <div className="flex-1 min-w-0">
                                    <DatePicker
                                        value={draft.endDate ?? undefined}
                                        onChange={v => setDraft(row.key, { endDate: v })}
                                        minDate={draft.startDate ? new Date(draft.startDate) : undefined}
                                        placeholder="Any end"
                                    />
                                </div>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1">
                                Left blank on either side, that side is unbounded. Blank on both means every date.
                            </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            {(draft.startDate || draft.endDate) && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-9 text-slate-400 hover:text-rose-600"
                                    disabled={savingWindow === row.key}
                                    onClick={() => saveWindow(row, null)}
                                >
                                    <X className="h-3.5 w-3.5 mr-1" /> Clear
                                </Button>
                            )}
                            <Button
                                size="sm"
                                className="h-9 bg-orange-600 hover:bg-orange-700"
                                disabled={!isDirty || savingWindow === row.key}
                                onClick={() => saveWindow(row, draft)}
                            >
                                {savingWindow === row.key
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : "Save range"}
                            </Button>
                        </div>
                    </div>
                );
            })()}
        </div>
    );

    /**
     * One collapsible block. The header carries enough state — how many types
     * are on, whether a template is broken, whether a schedule is paused — to
     * be read without expanding, so a fully collapsed page still shows what
     * needs attention.
     */
    const section = (
        id: string,
        label: string,
        rows: NotificationTypeRow[],
        note?: string,
        extra?: React.ReactNode,
        warning?: string
    ) => {
        const isOpen = open.has(id);
        const on = rows.filter(r => r.enabled).length;
        const broken = rows.some(r => !r.templateApproved);

        return (
            <Collapsible key={id} open={isOpen} onOpenChange={() => toggleSection(id)}>
                <Card className="border-orange-100 shadow-sm overflow-hidden">
                    <CollapsibleTrigger asChild>
                        <button
                            type="button"
                            className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50/70 transition-colors"
                        >
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-800">{label}</p>
                                {note && <p className="text-xs text-slate-500 mt-0.5">{note}</p>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {warning && (
                                    <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1">
                                        <AlertTriangle className="h-3 w-3" /> {warning}
                                    </Badge>
                                )}
                                {broken && (
                                    <Badge className="bg-rose-100 text-rose-700 border-rose-200 gap-1">
                                        <AlertTriangle className="h-3 w-3" /> Template
                                    </Badge>
                                )}
                                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 tabular-nums">
                                    {on}/{rows.length} on
                                </span>
                                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                            </div>
                        </button>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                        <CardContent className="space-y-3 pt-0 pb-4">
                            {extra}
                            {rows.map(messageRow)}
                        </CardContent>
                    </CollapsibleContent>
                </Card>
            </Collapsible>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
            </div>
        );
    }

    const reminderRows = types.filter(t => REMINDER_KEYS.includes(t.key));
    const ratingRows = types.filter(t => t.group === "Ratings");
    const otherTypes = types.filter(t => !REMINDER_KEYS.includes(t.key) && t.group !== "Ratings");
    const groups = Array.from(new Set(otherTypes.map(t => t.group)));

    return (
        <div className="space-y-4">
            {/* Master kill-switch state — a per-type toggle means nothing if this is off */}
            {!masterEnabled && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200">
                    <PowerOff className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-rose-800">WhatsApp is switched off globally</p>
                        <p className="text-xs text-rose-700 mt-0.5">
                            No WhatsApp messages are being sent, whatever the switches below say.
                            This is the <code className="font-mono">ENABLE_WHATSAPP</code> server setting and can only be changed on the server.
                        </p>
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-500">
                        <MessageSquare className="h-5 w-5" />
                    </div>
                    <div>
                        <CardTitle className="text-[15px] font-bold leading-tight">WhatsApp Messages</CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                            Turn individual message types on or off. Changes apply within 30 seconds — no deploy needed.
                        </CardDescription>
                    </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => fetchSettings(true)} className="h-9 border-slate-200">
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
                </Button>
            </div>

            {/* The reminder feature as one block: the schedule, and the two
                messages that schedule sends, together. */}
            {reminderRows.length > 0 && section(
                REMINDER_SECTION,
                "Rejection Reminders",
                reminderRows,
                "Chases warranties head office rejected that nobody has corrected.",
                <WarrantyReminderSchedule refreshKey={settingsVersion} onEnabledChange={setReminderRunning} />,
                reminderRunning ? undefined : "Schedule paused"
            )}

            {ratingRows.length > 0 && section(
                "ratings",
                "Store Ratings",
                ratingRows,
                "The rating message, and where a store's rating shows.",
                <RatingDisplay />
            )}

            {groups.map(group => section(
                group,
                group,
                otherTypes.filter(t => t.group === group)
            ))}

            <div className="flex items-start gap-2 text-xs text-slate-400 px-1">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <p>
                    Templates themselves are created and approved in the Interakt dashboard, not here.
                    A message marked <span className="font-semibold text-rose-500">Template not approved</span> will
                    keep failing until it is approved there, even when switched on.
                </p>
            </div>
        </div>
    );
};
