import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Loader2, Search } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, downloadCSV } from "@/lib/utils";
import { points, shortDay, stampDay, type AdminMonthDetail, type AdminSellMore, type AdminSellMoreStore } from "@/lib/sellMore";

/**
 * Option 1 for the admin, one month at a time, because points reset every
 * month: each store's category and target for the month, its calculated score,
 * how it stands against the target, and its reward. A store can request only
 * once it reaches the target; the admin can send a reward at any time.
 */

type Row = AdminSellMoreStore["months"][string];
const standing = (m: Row) => (m.target === null ? "unset" : m.calculated >= m.target ? "met" : "below");

function TargetInput({ value, label, disabled, onSave }: { value: number | null; label: string; disabled: boolean; onSave: (v: number | null) => void }) {
    const [text, setText] = useState(value === null ? "" : String(value));
    useEffect(() => { setText(value === null ? "" : String(value)); }, [value]);
    const commit = () => {
        const next = text.trim() === "" ? null : Number(text);
        if (next !== value && (next === null || (Number.isFinite(next) && next > 0))) onSave(next);
        else setText(value === null ? "" : String(value));
    };
    return (
        <Input type="number" min={0} step="0.01" inputMode="decimal" value={text} disabled={disabled} placeholder="Not set" aria-label={label}
            onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
            className="ml-auto h-8 w-24 text-right text-sm" />
    );
}

function StoreMonth({ schemeId, storeId, month, colSpan, version, onReward }: {
    schemeId: string; storeId: string; month: string; colSpan: number; version: number;
    onReward: (status: "sent" | "requested", note: string) => Promise<unknown>;
}) {
    const [m, setM] = useState<AdminMonthDetail | null>(null);
    const [failed, setFailed] = useState(false);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        api.get(`/schemes/admin/${schemeId}/sell-more/stores/${storeId}`)
            .then(r => setM((r.data.months as AdminMonthDetail[]).find(x => x.key === month) ?? null))
            .catch(() => setFailed(true));
    }, [schemeId, storeId, month, version]);
    const go = async (status: "sent" | "requested") => {
        setBusy(true);
        try { await onReward(status, status === "sent" ? note : ""); setNote(""); } finally { setBusy(false); }
    };
    return (
        <tr className="bg-slate-50">
            <td colSpan={colSpan} className="px-4 py-3">
                {failed ? <p className="text-sm text-rose-600">Could not load this store.</p>
                    : !m ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    : (
                        <div className="grid items-start gap-4 lg:grid-cols-3">
                            <div className="rounded-lg border border-slate-200 bg-white">
                                <p className="border-b border-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Reward for {m.label}</p>
                                <div className="space-y-2 p-3">
                                    {m.reward?.status === "sent" ? (
                                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                            <span className="font-semibold text-emerald-700">Sent{m.reward.sent_at ? ` ${stampDay(m.reward.sent_at)}` : ""}{m.reward.note ? `: ${m.reward.note}` : ""}</span>
                                            <button type="button" disabled={busy} onClick={() => go("requested")} className="text-xs text-slate-400 hover:text-orange-600">Undo</button>
                                        </div>
                                    ) : (
                                        <>
                                            {m.reward?.status === "requested" && <p className="text-xs font-semibold text-amber-700">Store asked on {stampDay(m.reward.requested_at)}</p>}
                                            <div className="flex gap-1.5">
                                                <Input value={note} onChange={e => setNote(e.target.value)} placeholder="What was sent" className="h-9 text-sm" aria-label={`What was sent for ${m.label}`} />
                                                <Button size="sm" className="h-9 shrink-0 bg-orange-500 hover:bg-orange-600" disabled={busy} onClick={() => go("sent")}>Mark sent</Button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white">
                                <p className="border-b border-slate-100 px-3 py-2 text-xs font-bold text-slate-700">By series (calculated)</p>
                                <table className="w-full text-xs">
                                    <tbody className="divide-y divide-slate-50">
                                        {m.series.map(s => (
                                            <tr key={s.name}><td className="px-3 py-1.5 text-slate-700">{s.name}</td><td className="px-2 py-1.5 text-right tabular-nums">{s.warranties}</td><td className="px-3 py-1.5 text-right font-bold tabular-nums">{points(s.points)}</td></tr>
                                        ))}
                                        <tr><td className={cn("px-3 py-1.5", m.no_series ? "font-semibold text-amber-700" : "text-slate-400")}>In no series</td><td className={cn("px-2 py-1.5 text-right tabular-nums", m.no_series ? "font-semibold text-amber-700" : "text-slate-400")}>{m.no_series}</td><td className="px-3 py-1.5 text-right tabular-nums text-slate-400">0</td></tr>
                                    </tbody>
                                </table>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white">
                                <p className="border-b border-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Day by day</p>
                                {m.days.length ? (
                                    <table className="w-full text-xs">
                                        <thead><tr className="text-left text-slate-400"><th className="px-3 py-1 font-semibold">Date</th><th className="px-2 py-1 text-right font-semibold">Warranties</th><th className="px-2 py-1 text-right font-semibold">Store sees</th><th className="px-3 py-1 text-right font-semibold">Calculated</th></tr></thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {m.days.map(d => (
                                                <tr key={d.date}>
                                                    <td className="px-3 py-1.5 text-slate-700">{shortDay(d.date)}</td>
                                                    <td className="px-2 py-1.5 text-right tabular-nums">{d.warranties + (d.no_series ?? 0)}</td>
                                                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{points(d.store_points ?? 0)}</td>
                                                    <td className="px-3 py-1.5 text-right font-bold tabular-nums">{points(d.points)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : <p className="px-3 py-2 text-xs text-slate-500">No warranties this month.</p>}
                            </div>
                        </div>
                    )}
            </td>
        </tr>
    );
}

export function SellMoreTab({ schemeId, refreshKey }: { schemeId: string; refreshKey: number }) {
    const { toast } = useToast();
    const [d, setD] = useState<AdminSellMore | null>(null);
    const [month, setMonth] = useState<string | null>(null);
    const [q, setQ] = useState("");
    const [tier, setTier] = useState("all");
    const [target, setTarget] = useState("all");
    const [reward, setReward] = useState("all");
    const [open, setOpen] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    /* Bumped when a score or reward changes, so an open store reloads. */
    const [version, setVersion] = useState(0);

    const load = useCallback(() => api.get(`/schemes/admin/${schemeId}/sell-more`).then(r => {
        setD(r.data);
        setMonth(m => m ?? r.data.months[r.data.months.length - 1]?.key ?? null);
    }).catch(e => toast({ title: "Could not load the stores", description: getErrorMessage(e, "Try again"), variant: "destructive" })), [schemeId, toast]);
    useEffect(() => { load(); }, [load, refreshKey]);

    const stores = useMemo(() => {
        if (!month) return [];
        const term = q.trim().toLowerCase();
        return (d?.stores ?? [])
            .filter(s => {
                const m = s.months[month];
                if (!m) return false;
                if (tier !== "all" && m.tier !== tier) return false;
                if (target !== "all" && standing(m) !== target) return false;
                if (reward === "asked" && m.reward !== "requested") return false;
                if (reward === "sent" && m.reward !== "sent") return false;
                if (reward === "none" && m.reward) return false;
                return !term || [s.store_name, s.store_code, s.city, s.state].some(v => String(v ?? "").toLowerCase().includes(term));
            })
            .sort((a, b) => Number(b.months[month].reward === "requested") - Number(a.months[month].reward === "requested") || b.months[month].calculated - a.months[month].calculated || a.store_name.localeCompare(b.store_name));
    }, [d, month, q, tier, target, reward]);

    if (!d || !month) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;

    const label = d.months.find(m => m.key === month)?.label ?? month;
    const tierName = (id: string | null) => d.tiers.find(t => t.id === id)?.name ?? "";
    const monthTotal = (key: string) => d.stores.reduce((n, s) => n + (s.months[key]?.calculated ?? 0), 0);
    const all = d.stores.map(s => s.months[month]).filter(Boolean);

    const save = async (storeId: string, body: { tier?: string; target?: number | null }) => {
        setBusy(storeId);
        try {
            await api.put(`/schemes/admin/${schemeId}/sell-more/month`, { store_id: storeId, month, ...body });
            await load();
            setVersion(v => v + 1);
            toast({ title: "Saved" });
        } catch (e) {
            toast({ title: "Could not save", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setBusy(null); }
    };

    const setRewardFor = async (storeId: string, status: "sent" | "requested", note: string) => {
        try {
            await api.put(`/schemes/admin/${schemeId}/sell-more/reward`, { store_id: storeId, month, status, note });
            await load();
            setVersion(v => v + 1);
            toast({ title: status === "sent" ? "Marked as sent" : "Undone" });
        } catch (e) {
            toast({ title: "Could not update the reward", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        }
    };

    const exportRows = () => downloadCSV(stores.map(s => {
        const m = s.months[month];
        return {
            "Month": label, "Store": s.store_name, "Code": s.store_code ?? "", "City": s.city ?? "", "State": s.state ?? "", "Brand": s.brand,
            "Category": tierName(m.tier), "Store sees": m.store_points, "Calculated": m.calculated, "Target": m.target ?? "",
            "Against target": m.target ? `${Math.round((m.calculated / m.target) * 100)}%` : "", "Reward": m.reward ?? "", "Warranties with points": m.warranties, "Warranties in no series": m.no_series,
        };
    }), `sell_more_${month}.csv`);

    const colSpan = 9;
    return (
        <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-1">
                {d.months.map(m => (
                    <button key={m.key} type="button" onClick={() => { setMonth(m.key); setOpen(null); }} aria-pressed={m.key === month}
                        className={cn("min-w-32 shrink-0 rounded-xl p-3 text-left", m.key === month ? "border-2 border-orange-500 bg-orange-50" : "border border-slate-200 bg-white hover:border-slate-400")}>
                        <span className="block text-xs font-bold text-slate-500">{m.label}</span>
                        <b className="block text-xl tabular-nums text-slate-900">{points(monthTotal(m.key))}</b>
                        <span className="block text-xs text-slate-500">calculated points</span>
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-4 [&>div]:bg-white [&>div]:px-4 [&>div]:py-3">
                <div><p className="text-xs text-slate-500">Opted Option 1</p><p className="text-2xl font-bold tabular-nums">{d.stores.length}</p></div>
                <div><p className="text-xs text-slate-500">No target set</p><p className={cn("text-2xl font-bold tabular-nums", all.some(m => m.target === null) && "text-amber-700")}>{all.filter(m => m.target === null).length}</p></div>
                <div><p className="text-xs text-slate-500">Reached target</p><p className="text-2xl font-bold tabular-nums">{all.filter(m => standing(m) === "met").length}</p></div>
                <div><p className="text-xs text-slate-500">Asked / sent</p><p className="text-2xl font-bold tabular-nums">{all.filter(m => m.reward === "requested").length} / {all.filter(m => m.reward === "sent").length}</p></div>
            </div>

            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search store, code, city or state" className="h-9 pl-8" aria-label="Search stores" />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Select value={tier} onValueChange={setTier}>
                        <SelectTrigger className="h-9 sm:w-36" aria-label="Category"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All categories</SelectItem>
                            {d.tiers.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={target} onValueChange={setTarget}>
                        <SelectTrigger className="h-9 sm:w-36" aria-label="Target"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All targets</SelectItem>
                            <SelectItem value="unset">Not set</SelectItem>
                            <SelectItem value="met">Reached</SelectItem>
                            <SelectItem value="below">Below target</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={reward} onValueChange={setReward}>
                        <SelectTrigger className="h-9 sm:w-36" aria-label="Reward"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All rewards</SelectItem>
                            <SelectItem value="asked">Store asked</SelectItem>
                            <SelectItem value="sent">Sent</SelectItem>
                            <SelectItem value="none">Not asked</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" className="h-9" onClick={exportRows} disabled={!stores.length}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
                </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[900px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                        <tr>
                            <th className="w-8 px-2 py-2.5" />
                            <th className="px-3 py-2.5 font-semibold">Store</th>
                            <th className="px-3 py-2.5 font-semibold">Category</th>
                            <th className="px-3 py-2.5 text-right font-semibold">Store sees</th>
                            <th className="px-3 py-2.5 text-right font-semibold">Calculated</th>
                            <th className="px-3 py-2.5 text-right font-semibold">Target</th>
                            <th className="px-3 py-2.5 font-semibold">Against target</th>
                            <th className="px-3 py-2.5 font-semibold">Reward</th>
                            <th className="px-3 py-2.5" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {stores.map(s => {
                            const m = s.months[month];
                            const st = standing(m);
                            const toggle = () => setOpen(o => (o === s.store_id ? null : s.store_id));
                            return (
                                <Fragment key={s.store_id}>
                                    <tr className="hover:bg-orange-50/40">
                                        <td className="px-2 py-2">
                                            <button type="button" onClick={toggle} className="rounded p-1 text-slate-400 hover:text-orange-600" aria-label={`Details for ${s.store_name}`} aria-expanded={open === s.store_id}>
                                                {open === s.store_id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                            </button>
                                        </td>
                                        <td className="px-3 py-2">
                                            <p className="font-semibold text-slate-900">{s.store_name}</p>
                                            <p className="text-xs text-slate-500">{[s.store_code, s.city, s.state, s.brand === "AFAC" ? "AF+AC" : s.brand].filter(Boolean).join(" · ")}</p>
                                        </td>
                                        <td className="px-3 py-2">
                                            <Select value={m.tier ?? undefined} onValueChange={v => save(s.store_id, { tier: v })} disabled={busy === s.store_id}>
                                                <SelectTrigger className="h-8 w-28 text-xs" aria-label={`Category for ${s.store_name}`}><SelectValue /></SelectTrigger>
                                                <SelectContent>{d.tiers.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                                            </Select>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{points(m.store_points)}</td>
                                        <td className="px-3 py-2 text-right font-bold tabular-nums">{points(m.calculated)}</td>
                                        <td className="px-3 py-2 text-right"><TargetInput value={m.target} label={`Target for ${s.store_name}`} disabled={busy === s.store_id} onSave={v => save(s.store_id, { target: v })} /></td>
                                        <td className="whitespace-nowrap px-3 py-2">
                                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", st === "met" ? "bg-emerald-100 text-emerald-800" : st === "unset" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600")}>
                                                {st === "unset" ? "Set target" : `${st === "met" ? "Met · " : ""}${Math.round((m.calculated / m.target!) * 100)}%`}
                                            </span>
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2">
                                            {m.reward === "sent" ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">Sent</span>
                                                : m.reward === "requested" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">Store asked</span>
                                                : <span className="text-xs text-slate-400">Not asked</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <Button size="sm" variant={m.reward === "requested" ? "default" : "outline"} className={cn("h-8", m.reward === "requested" && "bg-orange-500 hover:bg-orange-600")} onClick={toggle}>{m.reward === "sent" ? "View" : "Send reward"}</Button>
                                        </td>
                                    </tr>
                                    {open === s.store_id && <StoreMonth schemeId={schemeId} storeId={s.store_id} month={month} colSpan={colSpan} version={version} onReward={(status, note) => setRewardFor(s.store_id, status, note)} />}
                                </Fragment>
                            );
                        })}
                        {!stores.length && <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-500">{d.stores.length ? "No store matches." : "No store has opted yet."}</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
