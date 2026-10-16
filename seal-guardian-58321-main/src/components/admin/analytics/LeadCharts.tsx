import { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useLeadOptions, DEFAULT_LEAD_OPTIONS, TONE_HEX, type LeadOptions } from "@/lib/leadOptions";

/**
 * Leads at a glance: per day by channel, product, where they went, states,
 * ASMs and stores, and the review. Shown above the tiles in Lead Management
 * (where a click filters the list) and on the Analytics page (read-only).
 *
 * The numbers come from the server with the list, over the same filtered
 * leads, so a chart and the table never disagree.
 *
 * Colours follow the entity, never its rank, and match the tiles. The channel
 * set was checked with the dataviz validator for colour-blind separation
 * (WhatsApp and Instagram were indistinguishable to deutan vision before).
 */

export interface Named { key: string; label: string; count: number }
export interface LeadChartsData {
    total: number;
    /* A channel the server does not send counts as 0. */
    by_day: Array<{ day: string; other: number } & Record<string, number | string>>;
    product: Named[];
    went_to: Named[];
    states: Named[];
    asms: Named[];
    stores: Named[];
    review: Named[];
}

export type ChartPick =
    | { kind: "day"; value: string }
    | { kind: "channel" | "product" | "went_to" | "state" | "asm" | "store" | "review"; value: string };

/* What is filtered now, so the matching bar or slice reads as selected. */
export interface ChartActive {
    channel?: string; product?: string; went_to?: string; state?: string;
    asm?: string; store?: string; review?: string; day?: string;
}

/* The channels and their colours are the admin's (Lead settings). */
type Channel = { key: string; label: string; color: string };
const channelsOf = (o: LeadOptions): Channel[] => o.channels.map(c => ({ key: c.value, label: c.label, color: TONE_HEX[c.tone] }));
const totalOf = (channels: Channel[], d: LeadChartsData["by_day"][number]) => channels.reduce((n, c) => n + (Number(d[c.key]) || 0), d.other);

const PRODUCT_COLOR: Record<string, string> = {
    "Seat Covers": "#ea580c", Mats: "#7c3aed", Accessories: "#0284c7", none: "#cbd5e1",
};

const WENT_TO_LABEL: Record<string, string> = {
    store: "Store", asm: "ASM", distributor: "Distributor", support: "Customer support", none: "Not forwarded yet",
};


/* Buckets that stand for "we don't know yet" read lighter than real answers. */
const MISSING = new Set(["none", "pending", "__others"]);

const HIDE_KEY = "leadCharts.hidden";

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const shortDay = (day: string) => new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function Panel({ title, note, children, action }: { title: string; note?: string; children: React.ReactNode; action?: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-slate-100 bg-white p-4 min-w-0 flex flex-col">
            <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-800">{title}</p>
                    {note && <p className="text-[11px] text-slate-400 mt-0.5">{note}</p>}
                </div>
                {action}
            </div>
            {children}
        </div>
    );
}

/* A ranked list as thin horizontal bars, each row its own label and number.
   HTML rather than an SVG chart: the names are long and need to wrap, and
   every row is a button when the chart filters the list. */
function BarList({ items, labelOf, active, onPick, empty }: {
    items: Named[]; labelOf?: (n: Named) => string; active?: string;
    onPick?: (key: string) => void; empty: string;
}) {
    const shown = items.filter(i => i.count > 0);
    const max = Math.max(1, ...shown.map(i => i.count));
    const total = shown.reduce((n, i) => n + i.count, 0);
    if (!shown.length) return <p className="text-xs text-slate-400 py-6 text-center">{empty}</p>;
    return (
        <ul className="space-y-1.5">
            {shown.map(i => {
                const label = labelOf ? labelOf(i) : i.label;
                const pickable = onPick && i.key !== "__others";
                const selected = active === i.key;
                const pct = Math.round((i.count / (total || 1)) * 100);
                const body = (
                    <>
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className={`truncate ${selected ? "font-bold text-slate-900" : MISSING.has(i.key) ? "text-slate-500" : "text-slate-700"}`} title={label}>
                                {label}
                            </span>
                            <span className="tabular-nums font-semibold text-slate-800 shrink-0">{i.count}</span>
                        </div>
                        <div className="h-1.5 mt-1 rounded-full bg-slate-100 overflow-hidden">
                            <div
                                className="h-full rounded-full"
                                style={{
                                    width: `${Math.max(2, (i.count / max) * 100)}%`,
                                    background: selected ? "#ea580c" : MISSING.has(i.key) ? "#cbd5e1" : "#475569",
                                }}
                            />
                        </div>
                    </>
                );
                return (
                    <li key={i.key} title={`${label}: ${i.count} (${pct}%)`}>
                        {pickable ? (
                            <button type="button" onClick={() => onPick!(i.key)}
                                className={`w-full text-left rounded-md px-1.5 py-1 -mx-1.5 hover:bg-slate-50 ${selected ? "bg-orange-50" : ""}`}>
                                {body}
                            </button>
                        ) : <div className="px-0 py-1">{body}</div>}
                    </li>
                );
            })}
        </ul>
    );
}

export function LeadCharts(props: Parameters<typeof LeadChartsView>[0]) {
    const opts = useLeadOptions();
    return <LeadChartsView {...props} lists={opts} />;
}

function LeadChartsView({ data, onPick, active = {}, collapsible = true, lists = DEFAULT_LEAD_OPTIONS }: {
    lists?: LeadOptions;
    data: LeadChartsData; onPick?: (pick: ChartPick) => void; active?: ChartActive; collapsible?: boolean;
}) {
    const CHANNELS = channelsOf(lists);
    const dayTotal = (d: LeadChartsData["by_day"][number]) => totalOf(CHANNELS, d);
    const REVIEW_LABEL: Record<string, string> = { pending: "Not reviewed", ...Object.fromEntries(lists.outcomes.map(o => [o.value, o.label])) };
    const [range, setRange] = useState<"7" | "30" | "all">("30");
    const [topOf, setTopOf] = useState<"asm" | "store">("asm");
    const [hidden, setHidden] = useState<boolean>(() => {
        try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
    });
    const toggle = () => {
        setHidden(h => {
            try { localStorage.setItem(HIDE_KEY, h ? "0" : "1"); } catch { /* storage blocked: still toggles */ }
            return !h;
        });
    };

    /* Every day in the range, zeros included — a quiet day is information. */
    const days = useMemo(() => {
        const byDay = new Map(data.by_day.map(d => [d.day, d]));
        const last = istToday();
        const first = range === "all"
            ? (data.by_day[0]?.day ?? last)
            : addDays(last, -(Number(range) - 1));
        const out: LeadChartsData["by_day"] = [];
        for (let d = first; d <= last && out.length < 400; d = addDays(d, 1)) {
            out.push(byDay.get(d) ?? { day: d, other: 0 });
        }
        return out;
    }, [data.by_day, range]);
    const inRange = days.reduce((n, d) => n + dayTotal(d), 0);
    const channelTotals = CHANNELS.map(c => ({ ...c, count: days.reduce((n, d) => n + (Number(d[c.key]) || 0), 0) }));
    const hasOther = days.some(d => d.other > 0);

    const products = data.product.filter(p => p.count > 0);
    const known = (list: Named[]) => list.filter(i => !MISSING.has(i.key)).reduce((n, i) => n + i.count, 0);

    const header = (
        <div className="flex items-center justify-between gap-3">
            <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-800">Leads at a glance</p>
                <p className="text-[11px] text-slate-400">
                    {data.total} lead{data.total === 1 ? "" : "s"}{onPick ? " · follows the filters · click a bar to filter" : ""}
                </p>
            </div>
            {collapsible && (
                <button type="button" onClick={toggle}
                    className="text-xs font-semibold text-slate-500 hover:text-orange-600 flex items-center gap-1">
                    {hidden ? <>Show charts <ChevronDown className="h-3.5 w-3.5" /></> : <>Hide charts <ChevronUp className="h-3.5 w-3.5" /></>}
                </button>
            )}
        </div>
    );

    if (collapsible && hidden) return <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">{header}</div>;

    return (
        <div className="space-y-2.5">
            {header}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                {/* Per day, stacked by channel. */}
                <div className="lg:col-span-2 min-w-0">
                    <Panel
                        title="Leads per day"
                        note={`${inRange} in ${range === "all" ? "all time" : `the last ${range} days`}`}
                        action={
                            <div className="flex rounded-lg border border-slate-200 p-0.5 text-[11px] font-semibold shrink-0">
                                {(["7", "30", "all"] as const).map(r => (
                                    <button key={r} type="button" onClick={() => setRange(r)}
                                        className={`px-2 py-0.5 rounded-md ${range === r ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-800"}`}>
                                        {r === "all" ? "All" : `${r}d`}
                                    </button>
                                ))}
                            </div>
                        }
                    >
                        <div className="h-[190px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={days} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap="20%"
                                    onClick={(e: any) => { const d = e?.activePayload?.[0]?.payload?.day; if (d && onPick) onPick({ kind: "day", value: d }); }}>
                                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                                    <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                                        interval="preserveStartEnd" minTickGap={16} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40} />
                                    <Tooltip
                                        cursor={{ fill: "#f8fafc" }}
                                        content={({ active: on, payload }) => {
                                            if (!on || !payload?.length) return null;
                                            const d = payload[0].payload as LeadChartsData["by_day"][number];
                                            const sum = dayTotal(d);
                                            return (
                                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm text-xs">
                                                    <p className="font-bold text-slate-800 mb-1">{shortDay(d.day)} · {sum}</p>
                                                    {CHANNELS.filter(c => d[c.key]).map(c => (
                                                        <p key={c.key} className="flex items-center gap-1.5 text-slate-600">
                                                            <span className="h-2 w-2 rounded-sm" style={{ background: c.color }} />{c.label} {d[c.key]}
                                                        </p>
                                                    ))}
                                                    {d.other > 0 && <p className="text-slate-600">Other {d.other}</p>}
                                                    {onPick && <p className="text-[10px] text-slate-400 mt-1">Click to see this day</p>}
                                                </div>
                                            );
                                        }}
                                    />
                                    {CHANNELS.map((c, i) => (
                                        <Bar key={c.key} dataKey={c.key} stackId="d" fill={c.color} stroke="#fff" strokeWidth={1}
                                            radius={i === CHANNELS.length - 1 && !hasOther ? [4, 4, 0, 0] : 0}
                                            cursor={onPick ? "pointer" : undefined} maxBarSize={28} />
                                    ))}
                                    {hasOther && <Bar dataKey="other" stackId="d" fill="#94a3b8" stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} />}
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        {/* The legend, with each channel's count in the range. */}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                            {channelTotals.map(c => {
                                const selected = active.channel === c.key;
                                const Tag = onPick ? "button" : "span";
                                return (
                                    <Tag key={c.key} {...(onPick ? { type: "button", onClick: () => onPick({ kind: "channel", value: c.key }) } : {})}
                                        className={`flex items-center gap-1.5 text-xs rounded px-1 ${selected ? "bg-orange-50 font-bold text-slate-900" : "text-slate-600"} ${onPick ? "hover:bg-slate-50" : ""}`}>
                                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
                                        {c.label} <span className="tabular-nums font-semibold text-slate-800">{c.count}</span>
                                    </Tag>
                                );
                            })}
                        </div>
                    </Panel>
                </div>

                {/* Product: a ring with the total in the middle. */}
                <Panel title="Product" note={`${known(data.product)} of ${data.total} named one`}>
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="relative h-[130px] w-[130px] shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={products.length ? products : [{ key: "empty", label: "", count: 1 }]} dataKey="count" nameKey="label"
                                        innerRadius={40} outerRadius={60} paddingAngle={products.length > 1 ? 2 : 0} stroke="#fff" strokeWidth={2}
                                        onClick={(p: any) => onPick && p?.key && p.key !== "empty" && onPick({ kind: "product", value: p.key })}
                                        cursor={onPick ? "pointer" : undefined} isAnimationActive={false}>
                                        {(products.length ? products : [{ key: "empty" }]).map((p: any) => (
                                            <Cell key={p.key} fill={p.key === "empty" ? "#f1f5f9" : PRODUCT_COLOR[p.key] ?? "#94a3b8"}
                                                opacity={active.product && active.product !== p.key ? 0.35 : 1} />
                                        ))}
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <span className="text-xl font-black text-slate-800 tabular-nums">{data.total}</span>
                                <span className="text-[10px] text-slate-400">leads</span>
                            </div>
                        </div>
                        <ul className="space-y-1 min-w-0 flex-1">
                            {data.product.map(p => {
                                const selected = active.product === p.key;
                                const Row = onPick ? "button" : "div";
                                return (
                                    <li key={p.key}>
                                        <Row {...(onPick ? { type: "button", onClick: () => onPick({ kind: "product", value: p.key }) } : {})}
                                            className={`w-full flex items-center justify-between gap-2 text-xs rounded px-1 py-0.5 ${selected ? "bg-orange-50 font-bold" : ""} ${onPick ? "hover:bg-slate-50" : ""}`}>
                                            <span className="flex items-center gap-1.5 min-w-0 text-slate-700">
                                                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: PRODUCT_COLOR[p.key] }} />
                                                <span className="truncate">{p.label}</span>
                                            </span>
                                            <span className="tabular-nums font-semibold text-slate-800">{p.count}</span>
                                        </Row>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </Panel>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
                <Panel title="Where it went" note="A lead sent to two kinds counts under both">
                    <BarList items={data.went_to} labelOf={n => WENT_TO_LABEL[n.key] ?? n.label} active={active.went_to}
                        onPick={onPick && (k => onPick({ kind: "went_to", value: k }))} empty="No leads" />
                </Panel>
                <Panel title="Top states" note={`${known(data.states)} of ${data.total} with a state`}>
                    <BarList items={data.states} active={active.state}
                        onPick={onPick && (k => onPick({ kind: "state", value: k }))} empty="No leads" />
                </Panel>
                <Panel
                    title={topOf === "asm" ? "Top ASMs" : "Top stores"}
                    note={`${known(topOf === "asm" ? data.asms : data.stores)} lead${known(topOf === "asm" ? data.asms : data.stores) === 1 ? "" : "s"} with ${topOf === "asm" ? "an ASM" : "a store"}`}
                    action={
                        <div className="flex rounded-lg border border-slate-200 p-0.5 text-[11px] font-semibold shrink-0">
                            {(["asm", "store"] as const).map(t => (
                                <button key={t} type="button" onClick={() => setTopOf(t)}
                                    className={`px-2 py-0.5 rounded-md ${topOf === t ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-800"}`}>
                                    {t === "asm" ? "ASM" : "Store"}
                                </button>
                            ))}
                        </div>
                    }
                >
                    <BarList items={topOf === "asm" ? data.asms : data.stores}
                        active={topOf === "asm" ? active.asm : active.store}
                        onPick={onPick && (k => onPick({ kind: topOf, value: k }))}
                        empty={topOf === "asm" ? "No lead has an ASM yet" : "No lead has a store yet"} />
                </Panel>
                <Panel title="Review" note={`${known(data.review)} of ${data.total} reviewed`}>
                    <BarList items={data.review} labelOf={n => REVIEW_LABEL[n.key] ?? n.label} active={active.review}
                        onPick={onPick && (k => onPick({ kind: "review", value: k }))} empty="No leads" />
                </Panel>
            </div>
        </div>
    );
}
