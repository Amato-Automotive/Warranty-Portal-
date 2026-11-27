import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, ChevronRight, Info, Loader2, Package } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ExportButton, exportToExcel } from "./Common";

/**
 * POSM on the Analytics page: what has gone out, what the plant has open and
 * for how long, how fast orders turn round, the item mix, and the risks to
 * act on. Every tile, bar and risk opens the stores or lines behind it.
 *
 * Colours (validated categorical slots 1-3, all pairs): Noida office blue,
 * Ludhiana orange, Jaipur aqua; status colours only on risks, always with an
 * icon and a label; the ageing buckets are one blue ramp, light to dark.
 */

const SOURCE_COLOR: Record<string, string> = { "Noida office": "#257de0", "Plant - Ludhiana depot": "#f47230", "Plant - Jaipur depot": "#00b894" };
const SOURCE_LABEL: Record<string, string> = { "Noida office": "Noida office", "Plant - Ludhiana depot": "Ludhiana depot", "Plant - Jaipur depot": "Jaipur depot" };
const AGE_COLOR = ["#84b9f3", "#519ced", "#257de0", "#1b64be", "#0e3d7e"];
const SEVERITY = {
    critical: { color: "#dc3c3d", bg: "bg-red-50", text: "text-red-700", label: "Critical", Icon: AlertOctagon },
    serious: { color: "#f18a59", bg: "bg-orange-50", text: "text-orange-800", label: "Serious", Icon: AlertTriangle },
    warning: { color: "#fbb315", bg: "bg-amber-50", text: "text-amber-800", label: "Watch", Icon: Info },
} as const;
const GRID = "#e7e7e7", INK2 = "#666666";

type Risk = { key: string; label: string; severity: keyof typeof SEVERITY; count: number; unit: "stores" | "lines"; why: string; action: string };
type Data = {
    today: string;
    tiles: Record<string, number>;
    risks: Risk[];
    monthly: Record<string, number | string>[];
    pipeline: Record<string, number | string>[];
    ageing: { bucket: string; lines: number }[];
    turnaround: { source: string; lines: number; median: number | null; p90: number | null }[];
    items: { item: string; qty: number; stores: number }[];
    sources: string[];
};
type DrillQuery = Record<string, string>;

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
const fmt = (n: number) => n.toLocaleString("en-IN");

/** The stores or lines behind a click, in a table with an export. */
function DrillDialog({ q, onClose, onOpenPosm }: { q: DrillQuery; onClose: () => void; onOpenPosm: () => void }) {
    const { toast } = useToast();
    const [d, setD] = useState<{ title: string; type: "stores" | "lines"; rows: any[]; total: number } | null>(null);
    useEffect(() => {
        api.get("/posm/admin/analytics/drill", { params: q }).then(r => setD(r.data))
            .catch(e => { toast({ title: "Could not load the details", description: getErrorMessage(e, "Try again"), variant: "destructive" }); onClose(); });
    }, [q, toast, onClose]);
    const cols: [string, string][] = d?.type === "stores"
        ? [["store", "Store"], ["code", "Code"], ["place", "City / state"], ["frp", "FRP sent / limit"], ["jackets", "Jackets sent / limit"], ["detail", "Why it is here"]]
        : [["store", "Store"], ["source", "From"], ["item", "Item"], ["qty", "Qty"], ["status", "Status"], ["asked", "Asked"], ["expected", "Expected"], ["dispatched", "Dispatched"], ["detail", "Note"]];
    return (
        <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
            <DialogContent className="max-h-[90vh] max-w-[calc(100%-1.5rem)] overflow-hidden rounded-2xl sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle className="pr-8 text-lg font-black">{d?.title ?? "Loading…"}</DialogTitle>
                    <DialogDescription>{d ? `${fmt(d.total)} ${d.type}${d.total > d.rows.length ? `, first ${d.rows.length} shown` : ""}` : ""}</DialogDescription>
                </DialogHeader>
                {!d ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div> : (
                    <div className="space-y-3">
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={onOpenPosm}>Open POSM Dispatch</Button>
                            <ExportButton onClick={() => exportToExcel(d.rows.map(r => Object.fromEntries(cols.map(([k, h]) => [h, r[k] ?? ""]))), `POSM_${d.title.replace(/[^A-Za-z0-9]+/g, "_")}`)} />
                        </div>
                        <div className="max-h-[62vh] overflow-auto rounded-xl border border-slate-200">
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr>{cols.map(([, h]) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                                <tbody className="divide-y divide-slate-100">
                                    {d.rows.map((r, i) => (
                                        <tr key={r.id ?? r.store_id ?? i}>{cols.map(([k]) => <td key={k} className={cn("px-3 py-1.5 align-top", k === "store" && "font-semibold text-slate-900", k === "qty" && "text-right tabular-nums")}>{r[k] ?? ""}</td>)}</tr>
                                    ))}
                                    {!d.rows.length && <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-slate-500">Nothing here.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function Tile({ label, value, note, tone, onClick }: { label: string; value: string; note?: string; tone?: string; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="group rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:border-orange-200 hover:shadow-md">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
            <p className={cn("mt-1 text-2xl font-black tabular-nums text-slate-800", tone)}>{value}</p>
            {note && <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>}
            <span className="mt-1 inline-flex items-center text-[10px] font-bold text-orange-600 opacity-0 transition group-hover:opacity-100">See the list <ChevronRight className="h-3 w-3" /></span>
        </button>
    );
}

const ChartCard = ({ title, explain, children }: { title: string; explain: string; children: React.ReactNode }) => (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="text-sm font-black text-slate-800">{title}</p>
        <p className="mb-3 text-[11px] text-slate-500">{explain}</p>
        {children}
    </div>
);

export function PosmAnalyticsSection({ onOpenPosm }: { onOpenPosm: () => void }) {
    const { toast } = useToast();
    const [d, setD] = useState<Data | null>(null);
    const [drill, setDrill] = useState<DrillQuery | null>(null);
    useEffect(() => {
        api.get("/posm/admin/analytics").then(r => setD(r.data))
            .catch(e => { toast({ title: "Could not load POSM analytics", description: getErrorMessage(e, "Try again"), variant: "destructive" }); });
    }, [toast]);
    const monthly = useMemo(() => (d?.monthly ?? []).map(m => ({ ...m, label: monthLabel(String(m.month)) })), [d]);
    const items = useMemo(() => (d?.items ?? []).slice(0, 12), [d]);

    if (!d) return (
        <Card className="rounded-[40px] border-slate-100 shadow-sm"><CardContent className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></CardContent></Card>
    );
    const t = d.tiles;
    const open = (q: DrillQuery) => setDrill(q);

    return (
        <Card className="overflow-hidden rounded-[40px] border-slate-100 shadow-sm">
            <CardHeader className="border-b border-slate-100 p-8">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-xl font-black uppercase tracking-tighter text-slate-800"><Package className="h-5 w-5 text-orange-500" />POSM Intelligence</CardTitle>
                        <CardDescription className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Material sent to stores from the Noida office and the plant · click anything to see the list</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={onOpenPosm}>Open POSM Dispatch</Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-6 p-6 sm:p-8">
                {/* Headline numbers */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <Tile label="Stores served" value={fmt(t.stores_served)} note={`${fmt(t.items_sent)} items in ${fmt(t.lines_sent)} lines`} onClick={() => open({ kind: "tile", key: "stores_served" })} />
                    <Tile label="Sent this month" value={fmt(t.sent_this_month)} note={`items · last month ${fmt(t.sent_last_month)}`} onClick={() => open({ kind: "tile", key: "sent_this_month" })} />
                    <Tile label="Open at the plant" value={fmt(t.plant_open)} note="FRP / jackets not yet dispatched" onClick={() => open({ kind: "tile", key: "plant_open" })} />
                    <Tile label="Overdue at the plant" value={fmt(t.plant_overdue)} tone={t.plant_overdue ? "text-red-600" : undefined} note="past the expected date" onClick={() => open({ kind: "tile", key: "plant_overdue" })} />
                    <Tile label="Requests to approve" value={fmt(t.requests_waiting)} note={`${fmt(t.requests_wip)} approved / WIP`} onClick={onOpenPosm} />
                    <Tile label="Stores over limit" value={fmt(t.stores_over)} tone={t.stores_over ? "text-red-600" : undefined} note="FRP 2 · jackets 20" onClick={() => open({ kind: "tile", key: "stores_over" })} />
                </div>

                {/* Risks */}
                <div className="space-y-2">
                    <p className="text-sm font-black text-slate-800">Risks and flags</p>
                    <div className="grid gap-2 md:grid-cols-2">
                        {d.risks.map(r => {
                            const s = SEVERITY[r.severity];
                            return (
                                <button key={r.key} type="button" disabled={!r.count} onClick={() => open({ kind: "risk", key: r.key })}
                                    className={cn("flex items-start gap-3 rounded-2xl border p-3 text-left transition", r.count ? "border-slate-100 bg-white hover:border-orange-200 hover:shadow-sm" : "border-slate-100 bg-slate-50/60 opacity-60")}>
                                    <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", s.bg)} aria-hidden><s.Icon className="h-4 w-4" style={{ color: s.color }} /></span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-bold text-slate-900">{r.label}</span>
                                            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-black uppercase", s.bg, s.text)}>{s.label}</span>
                                        </span>
                                        <span className="block text-xs text-slate-600">{r.why}</span>
                                        {r.count > 0 && <span className="block text-[11px] font-semibold text-slate-500">What to do: {r.action}</span>}
                                    </span>
                                    <span className="text-right">
                                        <span className="block text-xl font-black tabular-nums text-slate-800">{fmt(r.count)}</span>
                                        <span className="block text-[10px] font-bold uppercase text-slate-400">{r.unit}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                    <ChartCard title="Dispatches each month" explain="Lines sent (one item to one store) by where they were sent from. Click a bar for its lines.">
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={monthly} margin={{ top: 4, right: 8, left: -12, bottom: 0 }} barCategoryGap="18%">
                                    <CartesianGrid vertical={false} stroke={GRID} />
                                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK2 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: INK2 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} formatter={(v: number, name: string) => [`${fmt(v)} lines`, SOURCE_LABEL[String(name).replace(" lines", "")] ?? name]} />
                                    <Legend formatter={(v: string) => <span style={{ color: INK2 }}>{SOURCE_LABEL[String(v).replace(" lines", "")] ?? v}</span>} wrapperStyle={{ fontSize: 11 }} />
                                    {d.sources.map((s, i) => (
                                        <Bar isAnimationActive={false} key={s} dataKey={`${s} lines`} name={`${s} lines`} stackId="m" fill={SOURCE_COLOR[s]} stroke="#ffffff" strokeWidth={2}
                                            radius={i === d.sources.length - 1 ? [4, 4, 0, 0] : 0} cursor="pointer"
                                            onClick={(row: any) => open({ kind: "month", month: String(row.month), source: s })} />
                                    ))}
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </ChartCard>

                    <ChartCard title="What the plant has open, by step" explain="FRP and jacket lines not yet dispatched, per depot. Click a bar for the lines.">
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={d.pipeline} layout="vertical" margin={{ top: 4, right: 12, left: 24, bottom: 0 }} barCategoryGap="22%">
                                    <CartesianGrid horizontal={false} stroke={GRID} />
                                    <XAxis type="number" tick={{ fontSize: 11, fill: INK2 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <YAxis type="category" dataKey="status" tick={{ fontSize: 11, fill: INK2 }} axisLine={false} tickLine={false} width={96} />
                                    <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} formatter={(v: number, name: string) => [`${fmt(v)} lines`, SOURCE_LABEL[name] ?? name]} />
                                    <Legend formatter={(v: string) => <span style={{ color: INK2 }}>{SOURCE_LABEL[v] ?? v}</span>} wrapperStyle={{ fontSize: 11 }} />
                                    {["Plant - Ludhiana depot", "Plant - Jaipur depot"].map((s, i) => (
                                        <Bar isAnimationActive={false} key={s} dataKey={s} stackId="p" fill={SOURCE_COLOR[s]} stroke="#ffffff" strokeWidth={2} radius={i === 1 ? [0, 4, 4, 0] : 0} cursor="pointer"
                                            onClick={(row: any) => open({ kind: "status", status: String(row.status), source: s })} />
                                    ))}
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </ChartCard>

                    <ChartCard title="How long open plant orders have waited" explain="Days since the order was placed, for lines not yet dispatched. Darker is older. Click a bar for the lines, oldest first.">
                        <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={d.ageing.map(a => ({ ...a, label: `${a.bucket} days` }))} margin={{ top: 4, right: 8, left: -12, bottom: 0 }} barCategoryGap="22%">
                                    <CartesianGrid vertical={false} stroke={GRID} />
                                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK2 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: INK2 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} formatter={(v: number) => [`${fmt(v)} lines`, "Waiting"]} />
                                    <Bar isAnimationActive={false} dataKey="lines" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(row: any) => open({ kind: "age", bucket: String(row.bucket) })}
                                        shape={(p: any) => <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={4} fill={AGE_COLOR[p.index] ?? AGE_COLOR[4]} />} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            {d.turnaround.map(x => (
                                <div key={x.source} className="rounded-xl bg-slate-50 px-3 py-2">
                                    <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SOURCE_COLOR[x.source] }} />{SOURCE_LABEL[x.source]}: asked → dispatched</p>
                                    <p className="text-sm text-slate-800"><b className="tabular-nums">{x.median ?? "—"}</b> days typical · <b className="tabular-nums">{x.p90 ?? "—"}</b> days for the slowest 1 in 10</p>
                                    <p className="text-[10px] text-slate-400">last 6 months, {fmt(x.lines)} lines</p>
                                </div>
                            ))}
                        </div>
                    </ChartCard>

                    <ChartCard title="Which items reach the most stores" explain="Stores that have received each item. Quantities are in the tooltip (visiting cards go out in hundreds). Click a bar for the stores.">
                        <div style={{ height: Math.max(220, items.length * 26) }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={[...items].sort((a, b) => b.stores - a.stores)} layout="vertical" margin={{ top: 4, right: 12, left: 24, bottom: 0 }} barCategoryGap="20%">
                                    <CartesianGrid horizontal={false} stroke={GRID} />
                                    <XAxis type="number" tick={{ fontSize: 11, fill: INK2 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <YAxis type="category" dataKey="item" tick={{ fontSize: 11, fill: INK2 }} axisLine={false} tickLine={false} width={130} />
                                    <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} formatter={(v: number, _n: string, p: any) => [`${fmt(v)} stores · ${fmt(p.payload.qty)} sent`, p.payload.item]} />
                                    <Bar isAnimationActive={false} dataKey="stores" fill="#257de0" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(row: any) => open({ kind: "item", item: String(row.item) })} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </ChartCard>
                </div>
            </CardContent>
            {drill && <DrillDialog q={drill} onClose={() => setDrill(null)} onOpenPosm={() => { setDrill(null); onOpenPosm(); }} />}
        </Card>
    );
}
