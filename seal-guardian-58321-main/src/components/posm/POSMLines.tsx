import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROGRESS, type PosmItem, type PosmLimits, type PosmLine } from "@/lib/posm";
import { PosmArt } from "./posmClipart";

type Limit = PosmLimits & { used_month?: number; used_year?: number };

/** What the store already has against an item's limits, for the admin. */
function usageNote(l?: Limit): string | null {
    if (!l) return null;
    const parts: string[] = [];
    if (l.max_month != null) parts.push(`this month ${l.used_month ?? 0} of ${l.max_month}`);
    if (l.max_year != null) parts.push(`this year ${l.used_year ?? 0} of ${l.max_year}`);
    if (l.max_request != null) parts.push(`max ${l.max_request} per request`);
    return parts.length ? `Already: ${parts.join(" · ")}` : null;
}

/**
 * The items of a request, for the store and the admin alike. With `onDecide`
 * the admin sets each line's quantity to send and approves or rejects it.
 */
export function POSMLines({ lines, items, limits, onDecide, disabled }: {
    lines: PosmLine[];
    items?: PosmItem[];
    limits?: Record<string, Limit>;
    onDecide?: (index: number, patch: Partial<Pick<PosmLine, "approved_qty" | "line_status">>) => void;
    disabled?: boolean;
}) {
    return (
        <div className="grid gap-2">
            {lines.map((l, i) => {
                const it = items?.find(x => x.id === l.item_id);
                const rejected = l.line_status === "rejected";
                const sent = l.approved_qty;
                const note = onDecide ? usageNote(limits?.[l.item_id]) : null;
                return (
                    <div key={i} className={cn("grid grid-cols-[56px_minmax(0,1fr)] sm:grid-cols-[56px_minmax(0,1fr)_auto] gap-3 items-center rounded-2xl border p-3",
                        rejected ? "border-red-100 bg-red-50/40" : "border-gray-100 bg-white")}>
                        <div className="h-12 w-14 rounded-xl bg-orange-50/60 grid place-items-center overflow-hidden relative">
                            <PosmArt clipart={it?.clipart} image={it?.image} className="h-10 w-12" />
                        </div>
                        <div className="min-w-0">
                            <p className="font-bold text-gray-800">{l.item_name}</p>
                            {l.display?.length ? (
                                <p className="text-xs text-gray-500 break-words">
                                    {l.display.map((d, k) => <span key={k}>{k ? " · " : ""}<span className="text-gray-400">{d.label}:</span> {d.value}</span>)}
                                </p>
                            ) : null}
                            {l.files?.length ? (
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                    {l.files.map((u, j) => (
                                        <a key={j} href={u} target="_blank" rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 bg-orange-50 rounded-md px-2 py-0.5 hover:bg-orange-100">
                                            <Paperclip className="h-3 w-3" /> File {j + 1}
                                        </a>
                                    ))}
                                </div>
                            ) : null}
                            {note && <p className="text-[11px] font-semibold text-amber-600 mt-0.5">{note}</p>}
                        </div>
                        <div className="col-span-2 sm:col-span-1 flex items-center justify-end gap-2">
                            {onDecide ? (
                                <>
                                    <span className="text-xs text-gray-400 whitespace-nowrap">{l.qty} asked →</span>
                                    <input type="number" min={0} max={1000} aria-label={`Quantity to send of ${l.item_name}`}
                                        disabled={disabled} value={sent ?? l.qty}
                                        onChange={e => onDecide(i, { approved_qty: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value)) || 0) })}
                                        className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-right tabular-nums disabled:opacity-50" />
                                    <select aria-label={`Decision on ${l.item_name}`} disabled={disabled} value={l.line_status ?? "pending"}
                                        onChange={e => onDecide(i, { line_status: e.target.value as PosmLine["line_status"] })}
                                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white">
                                        <option value="pending">To decide</option>
                                        <option value="approved">Approve</option>
                                        <option value="rejected">Reject</option>
                                    </select>
                                </>
                            ) : rejected ? (
                                <span className="text-xs font-bold text-red-600">Not approved</span>
                            ) : (
                                <div className="text-right tabular-nums">
                                    <p className={cn("text-lg font-black leading-none", sent != null && sent < l.qty ? "text-amber-600" : "text-gray-800")}>{sent ?? l.qty}</p>
                                    <p className="text-[11px] text-gray-400">{sent != null ? `of ${l.qty} asked` : "asked"}</p>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** Where a request stands: Sent → Approved → In production → Dispatched → Delivered. */
export function POSMTracker({ status }: { status: string }) {
    if (status === "rejected") return <p className="text-sm font-bold text-red-600">This request was not approved. See the messages below.</p>;
    const order = PROGRESS.map(p => p.status as string);
    /* The steps reached are green; the next one, what it is waiting for, is orange. */
    const at = status === "closed" ? order.length - 1
        : Math.max(0, order.indexOf(["under_review", "pending"].includes(status) ? "open" : status));
    return (
        <div className="grid grid-cols-5 gap-1.5" aria-label="Progress">
            {PROGRESS.map((p, i) => {
                const done = i <= at, cur = i === at + 1;
                return (
                    <div key={p.status} className="grid gap-1.5 text-center">
                        <span className={cn("h-1.5 rounded-full", done ? "bg-emerald-500" : cur ? "bg-orange-500" : "bg-gray-200")} />
                        <span className={cn("text-[11px] font-bold", done ? "text-emerald-600" : cur ? "text-orange-600" : "text-gray-300")}>{p.label}</span>
                    </div>
                );
            })}
        </div>
    );
}
