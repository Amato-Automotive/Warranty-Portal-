import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Gift, Loader2, Plus, Search, Trash2, RefreshCw, CalendarDays, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SchemeEditor } from "../schemes/SchemeEditor";
import { SchemeDetail } from "../schemes/SchemeDetail";
import { CATEGORY_LABEL, STATE_META, formatDay, type Scheme, type SchemeState } from "@/lib/schemes";

/**
 * Offers & Schemes for the admin: every scheme by where it stands, with
 * create, edit, copy, publish, end and delete. Opening one shows its overview,
 * the review queue, the leaderboard and payouts (SchemeDetail).
 */

type Listed = Scheme & { participants: number; pending: number; entries: number; approved_points: number; daily: Record<string, number> };
const TABS: SchemeState[] = ["live", "upcoming", "draft", "closed"];

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString("en-IN");

/** Entries per day over the last 30 days, as a small line. */
function Sparkline({ daily }: { daily: Record<string, number> }) {
    const today = istToday();
    const pts = Array.from({ length: 30 }, (_, i) => daily[addDays(today, i - 29)] ?? 0);
    const max = Math.max(1, ...pts);
    const total = pts.reduce((a, b) => a + b, 0);
    const w = 120, h = 28;
    const path = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i / 29) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
    return (
        <div className="flex items-center gap-2" title={`${total} entries in the last 30 days`}>
            <svg width={w} height={h} className="overflow-visible" aria-hidden>
                <path d={`${path} L${w},${h} L0,${h} Z`} fill="#fed7aa" opacity={0.45} />
                <path d={path} fill="none" stroke="#ea580c" strokeWidth={1.5} strokeLinejoin="round" />
            </svg>
            <span className="text-xs text-slate-500 whitespace-nowrap"><b className="tabular-nums text-slate-700">{total}</b> in 30 days</span>
        </div>
    );
}

function Kpi({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "warn"; hint?: string }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone === "warn" ? "text-amber-600" : "text-slate-900")}>{value}</p>
            {hint && <p className="text-xs text-slate-500">{hint}</p>}
        </div>
    );
}

export const AdminSchemes = () => {
    const { toast } = useToast();
    const [schemes, setSchemes] = useState<Listed[] | null>(null);
    const [tab, setTab] = useState<SchemeState>("live");
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<{ open: boolean; scheme: Scheme | null }>({ open: false, scheme: null });
    const [openId, setOpenId] = useState<string | null>(null);
    const [toReview, setToReview] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(() => {
        return api.get("/schemes/admin")
            .then(r => setSchemes(r.data.schemes || []))
            .catch(e => {
                setSchemes([]);
                toast({ title: "Could not load schemes", description: getErrorMessage(e, "Try again"), variant: "destructive" });
            });
    }, [toast]);
    useEffect(() => { load(); }, [load]);

    const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t, (schemes ?? []).filter(s => s.state === t).length])), [schemes]);
    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (schemes ?? []).filter(s => s.state === tab && (!q || s.title.toLowerCase().includes(q)));
    }, [schemes, tab, search]);
    /* Across the schemes running now. */
    const totals = useMemo(() => {
        const live = (schemes ?? []).filter(s => s.state === "live");
        return {
            live: live.length,
            pending: (schemes ?? []).reduce((n, s) => n + (s.pending || 0), 0),
            joined: live.reduce((n, s) => n + s.participants, 0),
            points: live.reduce((n, s) => n + (s.approved_points || 0), 0),
        };
    }, [schemes]);

    /* Open on the tab that has something, the first time the list arrives. */
    useEffect(() => {
        if (schemes && !schemes.some(s => s.state === tab)) {
            const first = TABS.find(t => schemes.some(s => s.state === t));
            if (first) setTab(first);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [schemes === null]);

    const remove = async (s: Listed) => {
        setConfirmDelete(null);
        try {
            await api.delete(`/schemes/admin/${s.id}`);
            toast({ title: "Scheme deleted", description: "Entries stores sent are kept in the records." });
            load();
        } catch (e) {
            toast({ title: "Could not delete", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        }
    };

    const editor = (
        <SchemeEditor
            open={editing.open}
            scheme={editing.scheme}
            onClose={() => setEditing({ open: false, scheme: null })}
            onSaved={s => { setEditing({ open: false, scheme: null }); load(); setOpenId(s.id); }}
        />
    );

    if (openId) {
        return (
            <>
                <SchemeDetail key={openId} id={openId} startOnReview={toReview} onBack={() => { setOpenId(null); setToReview(false); load(); }}
                    onEdit={s => setEditing({ open: true, scheme: s })} onChanged={load} />
                {editor}
            </>
        );
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">Offers &amp; Schemes</h2>
                    <p className="text-sm text-slate-500 mt-1">Create schemes for franchises, review what they submit, and track who earned what.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" disabled={refreshing} aria-label="Refresh" title="Refresh"
                        onClick={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }}>
                        <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                    </Button>
                    <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setEditing({ open: true, scheme: null })}>
                        <Plus className="h-4 w-4 mr-1.5" /> New scheme
                    </Button>
                </div>
            </div>

            {schemes && schemes.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Kpi label="Live schemes" value={totals.live} />
                    <Kpi label="Waiting for review" value={fmt(totals.pending)} tone={totals.pending ? "warn" : undefined} hint="Across all schemes" />
                    <Kpi label="Stores joined" value={fmt(totals.joined)} hint="In live schemes" />
                    <Kpi label="Points approved" value={fmt(totals.points)} hint="In live schemes" />
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm font-medium">
                    {TABS.map(t => (
                        <button key={t} type="button" onClick={() => setTab(t)}
                            className={cn("px-3 py-1.5 rounded-md", tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
                            {STATE_META[t].label} <span className="tabular-nums text-slate-400">{counts[t] ?? 0}</span>
                        </button>
                    ))}
                </div>
                <div className="relative w-full sm:w-64">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search schemes" className="pl-8" />
                </div>
            </div>

            {schemes === null ? (
                <div className="flex items-center justify-center min-h-[240px] gap-2 text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /> Loading schemes…</div>
            ) : !shown.length ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
                    <div className="h-14 w-14 bg-orange-50 rounded-xl flex items-center justify-center mx-auto mb-4">
                        <Gift className="h-7 w-7 text-orange-500" />
                    </div>
                    <p className="text-lg font-semibold text-slate-800">No {STATE_META[tab].label.toLowerCase()} schemes</p>
                    <p className="text-sm text-slate-500 mt-1">
                        {schemes.length ? "Try another tab." : "Create your first scheme — stores see it once it's published."}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {shown.map(s => (
                        <div key={s.id} role="button" tabIndex={0}
                            onClick={e => { if (!(e.target as HTMLElement).closest("button")) setOpenId(s.id); }}
                            onKeyDown={e => { if (e.key === "Enter" && e.target === e.currentTarget) setOpenId(s.id); }}
                            className="group rounded-xl border border-slate-200 bg-white overflow-hidden hover:border-orange-300 hover:shadow-md transition-all cursor-pointer flex">
                            <div className="w-20 sm:w-28 shrink-0 bg-slate-100">
                                {s.banner_url ? <img src={s.banner_url} alt="" className="h-full w-full object-cover object-top" />
                                    : <div className="h-full w-full flex items-center justify-center bg-orange-50"><Gift className="h-7 w-7 text-orange-300" /></div>}
                            </div>
                            <div className="flex-1 min-w-0 p-4 flex flex-col gap-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="font-bold text-slate-900 group-hover:text-orange-700 truncate">{s.title}</p>
                                        <p className="text-sm text-slate-500 flex flex-wrap items-center gap-x-2">
                                            <span>{CATEGORY_LABEL[s.category]}</span>
                                            <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{formatDay(s.starts_on)} – {formatDay(s.ends_on)}</span>
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", STATE_META[s.state].tone)}>{STATE_META[s.state].label}</span>
                                        {confirmDelete === s.id ? (
                                            <span className="flex items-center gap-1 ml-1">
                                                <Button size="sm" variant="destructive" onClick={() => remove(s)}>Delete</Button>
                                                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>No</Button>
                                            </span>
                                        ) : (
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-rose-600" aria-label="Delete scheme"
                                                onClick={() => setConfirmDelete(s.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                                        <span><b className="tabular-nums text-slate-900">{fmt(s.participants)}</b> <span className="text-slate-500">joined</span></span>
                                        <span><b className="tabular-nums text-slate-900">{fmt(s.entries)}</b> <span className="text-slate-500">entries</span></span>
                                        {s.score_rule.mode !== "none" && <span><b className="tabular-nums text-slate-900">{fmt(s.approved_points || 0)}</b> <span className="text-slate-500">pts approved</span></span>}
                                        {s.state !== "draft" && <Sparkline daily={s.daily ?? {}} />}
                                    </div>
                                    {s.pending > 0 ? (
                                        <Button size="sm" variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100" onClick={() => { setToReview(true); setOpenId(s.id); }}>
                                            Review {s.pending} <ArrowRight className="h-4 w-4 ml-1" />
                                        </Button>
                                    ) : <span className="text-xs text-slate-400">Nothing to review</span>}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {editor}
        </div>
    );
};
