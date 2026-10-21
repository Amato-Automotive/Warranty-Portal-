import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Check, X, Plus, Trash2, ChevronUp, ChevronDown, ChevronRight, ExternalLink, FileText, ZoomIn, ZoomOut, Inbox, Loader2,
    PanelLeftClose, PanelLeftOpen, AlertTriangle, CheckCircle2, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Scheme, EntryFile } from "@/lib/schemes";
import type { AdminEntry } from "./adminTypes";

/**
 * Reviewing entries one after another: the waiting list on the left (it can
 * be folded away to give the invoice room), the open entry on the right with
 * its files shown in place and, beside them, one card per invoice to read
 * the number and series into. After each decision the next entry opens.
 *
 * Keys (when not typing): A approve, R reject, J or ↓ next, K or ↑ previous.
 */

type Lines = { product_id: string; qty: string }[];
/** One invoice of the entry being read: which files are its pages, its number, and what is on it. */
type Card = { files: number[]; invoice_no: string; lines: Lines };
/** One invoice as sent on approval. */
export type InvoiceOut = { invoice_no: string; files: string[]; lines: { product_id: string; qty: number }[] };
type ReviewOpts = { note?: string; lines?: { product_id: string; qty: number }[]; score?: string; invoice_no?: string; invoices?: InvoiceOut[] };

const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const isImage = (f: EntryFile) => /^(jpe?g|png|webp|gif)$/i.test(f.ext) || /\.(jpe?g|png|webp|gif)$/i.test(f.url);
const isPdf = (f: EntryFile) => /^pdf$/i.test(f.ext) || /\.pdf$/i.test(f.url);
/* The viewer and the cards fill the screen below the scheme's header and filters. */
const PANE_H = "h-[calc(100vh-260px)] min-h-[520px]";

export function ReviewQueue({ scheme, entries, busy, onReview, startId }: {
    scheme: Scheme; entries: AdminEntry[]; busy: string | null;
    /** The entry to open first (sent here from the entries table); otherwise the oldest. */
    startId?: string | null;
    onReview: (e: AdminEntry, status: "approved" | "rejected", opts: ReviewOpts) => Promise<void>;
}) {
    const products = scheme.score_rule.mode === "products" ? scheme.score_rule.products : [];
    const hasScore = scheme.score_rule.mode !== "none";
    /* Oldest first: the store that has waited longest is seen first. */
    const queue = useMemo(() => [...entries].sort((a, b) => a.created_at.localeCompare(b.created_at)), [entries]);
    const [openId, setOpenId] = useState<string | null>(queue.find(e => e.id === startId)?.id ?? queue[0]?.id ?? null);
    const [listOpen, setListOpen] = useState(true);
    const lastIndex = useRef(0);
    const open = queue.find(e => e.id === openId) ?? null;

    /* The open entry left the queue (decided): open the one now in its place. */
    useEffect(() => {
        if (open) { lastIndex.current = queue.indexOf(open); return; }
        setOpenId(queue[Math.min(lastIndex.current, queue.length - 1)]?.id ?? null);
    }, [queue, open]);

    const step = (by: number) => {
        if (!queue.length) return;
        const i = open ? queue.indexOf(open) : -1;
        const next = queue[Math.max(0, Math.min(queue.length - 1, i + by))];
        if (next) setOpenId(next.id);
    };

    if (!queue.length) {
        return (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
                <Inbox className="h-9 w-9 text-slate-300 mx-auto mb-2" />
                <p className="font-medium text-slate-700">Nothing waiting</p>
                <p className="text-sm text-slate-500 mt-0.5">Every entry that matches these filters has been reviewed.</p>
            </div>
        );
    }

    const fileCount = (e: AdminEntry) => Object.values(e.files).flat().length;
    return (
        <div className={cn("grid grid-cols-1 gap-4 items-start", listOpen && "lg:grid-cols-[250px_minmax(0,1fr)]")}>
            {listOpen && (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden lg:sticky lg:top-4">
                    <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 bg-slate-50">
                        <p className="text-sm font-semibold text-slate-800">Waiting <span className="tabular-nums text-slate-500">({queue.length})</span></p>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500" onClick={() => setListOpen(false)} aria-label="Hide the list" title="Hide the list — more room for the invoice">
                            <PanelLeftClose className="h-4 w-4" />
                        </Button>
                    </div>
                    <ul className="max-h-[calc(100vh-320px)] min-h-[200px] overflow-y-auto divide-y divide-slate-100">
                        {queue.map(e => (
                            <li key={e.id}>
                                <button type="button" onClick={() => setOpenId(e.id)}
                                    className={cn("w-full text-left px-3 py-2.5 border-l-[3px] transition-colors",
                                        e.id === openId ? "border-orange-500 bg-orange-50" : "border-transparent hover:bg-slate-50")}>
                                    <div className="flex items-baseline justify-between gap-2">
                                        <span className="font-medium text-sm text-slate-900 truncate">{e.store_name}</span>
                                        {hasScore && (products.length && !(e.claimed_lines ?? []).length
                                            ? <span className="shrink-0 text-[11px] font-medium text-amber-700">to read</span>
                                            : <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600">{e.score} pts</span>)}
                                    </div>
                                    <div className="flex items-baseline justify-between gap-2 text-xs text-slate-500">
                                        <span className="truncate">{fileCount(e)} file{fileCount(e) === 1 ? "" : "s"} · {e.city || e.state || "—"}</span>
                                        <span className="shrink-0">{when(e.created_at)}</span>
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {open && <EntryPanel key={open.id} e={open} scheme={scheme} products={products} hasScore={hasScore}
                busy={busy === open.id} position={`${queue.indexOf(open) + 1} of ${queue.length}`}
                listOpen={listOpen} onShowList={() => setListOpen(true)}
                onPrev={() => step(-1)} onNext={() => step(1)} onReview={onReview} />}
        </div>
    );
}

function EntryPanel({ e, scheme, products, hasScore, busy, position, listOpen, onShowList, onPrev, onNext, onReview }: {
    e: AdminEntry; scheme: Scheme; products: { id: string; name: string; points: number }[]; hasScore: boolean; busy: boolean; position: string;
    listOpen: boolean; onShowList: () => void;
    onPrev: () => void; onNext: () => void;
    onReview: (e: AdminEntry, status: "approved" | "rejected", opts: ReviewOpts) => Promise<void>;
}) {
    const files = Object.entries(e.files).flatMap(([fid, list]) => list.map(f => ({ ...f, field: scheme.fields.find(x => x.id === fid)?.label ?? fid })));
    const [fileIdx, setFileIdx] = useState(0);
    const [zoom, setZoom] = useState(1);
    const blank = (): Lines => products.length ? [{ product_id: products[0].id, qty: "" }] : [];
    const toLines = (ls: { product_id: string; qty: number }[]): Lines => ls.length ? ls.map(l => ({ product_id: l.product_id, qty: String(l.qty) })) : blank();
    /*
     * One card per invoice. Read again: as it was approved. Otherwise one card
     * per file (two photos of one invoice are put together by the reviewer);
     * what the store claimed goes on the card when there is only one.
     */
    const [cards, setCards] = useState<Card[]>(() => {
        if (e.invoices?.length) {
            return e.invoices.map(inv => ({
                files: inv.files.map(u => files.findIndex(f => f.url === u)).filter(i => i >= 0),
                invoice_no: inv.invoice_no, lines: toLines(inv.lines),
            }));
        }
        const claimed = toLines(e.claimed_lines ?? []);
        if (files.length <= 1) return [{ files: files.length ? [0] : [], invoice_no: e.invoice_no ?? "", lines: claimed }];
        return files.map((_, i) => ({ files: [i], invoice_no: "", lines: blank() }));
    });
    const [active, setActive] = useState(0);
    const [score, setScore] = useState(String(e.score));
    /* The invoice number off the invoice: one invoice is approved once per store. */
    const [invoiceNo, setInvoiceNo] = useState(e.invoice_no ?? "");
    const [rejecting, setRejecting] = useState(false);
    const [note, setNote] = useState("");
    const noteRef = useRef<HTMLInputElement>(null);
    const numberRef = useRef<HTMLInputElement>(null);
    const file = files[fileIdx];

    const pointsOf = (ls: Lines) => ls.reduce((n, l) => n + (Number(l.qty) || 0) * (products.find(p => p.id === l.product_id)?.points ?? 0), 0);
    const filledLines = (c: Card) => c.lines.filter(l => Number(l.qty) > 0).length;
    const total = cards.reduce((n, c) => n + pointsOf(c.lines), 0);
    const claimedTotal = (e.claimed_lines ?? []).reduce((n, l) => n + (Number(l.subtotal) || 0), 0);
    const changed = products.length > 0 && (e.claimed_lines ?? []).length > 0 && total !== claimedTotal;
    const missingNo = cards.findIndex(c => !c.invoice_no.trim());
    const done = cards.filter(c => c.invoice_no.trim() && filledLines(c)).length;
    const canApprove = !busy && (!products.length || (missingNo < 0 && cards.some(c => filledLines(c) > 0)));
    /* The card a file belongs to, for the file strip. */
    const cardOf = (fi: number) => cards.findIndex(c => c.files.includes(fi));

    const setCard = (i: number, f: (c: Card) => Card) => setCards(cs => cs.map((c, j) => j === i ? f(c) : c));
    const setLine = (i: number, li: number, patch: Partial<Lines[number]>) => setCard(i, c => ({ ...c, lines: c.lines.map((l, k) => k === li ? { ...l, ...patch } : l) }));
    const showFile = (fi: number) => { setFileIdx(fi); setZoom(1); };
    const openCard = (i: number) => {
        setActive(i);
        const f = cards[i]?.files[0];
        if (f !== undefined) showFile(f);
        setTimeout(() => numberRef.current?.focus(), 0);
    };
    /* Card `from` is more pages of invoice `into`: its files and lines move there. */
    const merge = (from: number, into: number) => {
        setCards(cs => {
            const filled = (ls: Lines) => ls.filter(l => Number(l.qty) > 0);
            const both = filled([...cs[into].lines, ...cs[from].lines]);
            const next = cs.map((c, j) => j === into ? {
                ...c, files: [...c.files, ...cs[from].files].sort((a, b) => a - b),
                invoice_no: c.invoice_no || cs[from].invoice_no,
                lines: both.length ? both : c.lines,
            } : c);
            return next.filter((_, j) => j !== from);
        });
        setActive(into > from ? into - 1 : into);
    };
    /* A page taken back out of an invoice: it becomes an invoice of its own. */
    const split = (i: number, fileIndex: number) => {
        setCards(cs => [...cs.slice(0, i + 1).map((c, j) => j === i ? { ...c, files: c.files.filter(x => x !== fileIndex) } : c),
            { files: [fileIndex], invoice_no: "", lines: blank() }, ...cs.slice(i + 1)]);
    };

    const approve = () => {
        if (!canApprove) return;
        if (products.length) {
            const invoices: InvoiceOut[] = cards.map(c => ({
                invoice_no: c.invoice_no.trim(), files: c.files.map(i => files[i]?.url).filter(Boolean) as string[],
                lines: c.lines.filter(l => Number(l.qty) > 0).map(l => ({ product_id: l.product_id, qty: Number(l.qty) })),
            }));
            onReview(e, "approved", { invoices });
        } else {
            const inv = { invoice_no: invoiceNo.trim() };
            onReview(e, "approved", hasScore ? { ...inv, score } : inv);
        }
    };
    const reject = () => { if (note.trim() && !busy) onReview(e, "rejected", { note: note.trim() }); };

    /* Keyboard: only when the reviewer isn't typing in a box. */
    useEffect(() => {
        const onKey = (ev: KeyboardEvent) => {
            const t = ev.target as HTMLElement;
            if (t.closest("input, textarea, select, [role=combobox], [role=listbox]") || ev.ctrlKey || ev.metaKey || ev.altKey) return;
            const k = ev.key.toLowerCase();
            if (k === "a") { ev.preventDefault(); approve(); }
            else if (k === "r") { ev.preventDefault(); setRejecting(true); setTimeout(() => noteRef.current?.focus(), 0); }
            else if (k === "j" || ev.key === "ArrowDown") { ev.preventDefault(); onNext(); }
            else if (k === "k" || ev.key === "ArrowUp") { ev.preventDefault(); onPrev(); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    return (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden min-w-0">
            {/* Whose entry, and moving between entries. */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200">
                <div className="flex items-center gap-2 min-w-0">
                    {!listOpen && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-slate-500" onClick={onShowList} aria-label="Show the waiting list" title="Show the waiting list">
                            <PanelLeftOpen className="h-4 w-4" />
                        </Button>
                    )}
                    <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{e.store_name}</p>
                        <p className="text-xs text-slate-500 truncate">
                            {[e.city, e.state].filter(Boolean).join(", ")}{e.city || e.state ? " · " : ""}sent {when(e.created_at)} · {files.length} file{files.length === 1 ? "" : "s"}
                            {e.source !== "store" && <span className="ml-2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{e.source === "import" ? "Imported" : "Added by admin"}</span>}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-500">
                    <span className="tabular-nums mr-1">Entry {position}</span>
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={onPrev} aria-label="Previous entry" title="Previous (K)"><ChevronUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={onNext} aria-label="Next entry" title="Next (J)"><ChevronDown className="h-4 w-4" /></Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
                {/* The files, in place. */}
                <div className={cn("bg-slate-100 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 min-w-0", PANE_H)}>
                    {files.length > 1 && (
                        <div className="flex flex-wrap gap-1 p-2 border-b border-slate-200 bg-white max-h-[96px] overflow-y-auto">
                            {files.map((f, i) => {
                                const ci = cardOf(i);
                                const c = cards[ci];
                                const ready = c && c.invoice_no.trim() && filledLines(c);
                                return (
                                    <button key={f.url} type="button" title={f.name}
                                        onClick={() => { showFile(i); if (ci >= 0) setActive(ci); }}
                                        className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs max-w-[170px]",
                                            i === fileIdx ? "border-orange-400 bg-orange-50 text-orange-800" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
                                        <span className={cn("shrink-0 h-4 min-w-[16px] px-1 rounded text-[10px] font-bold tabular-nums flex items-center justify-center",
                                            ready ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{i + 1}</span>
                                        <span className="truncate">{f.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {!file ? (
                        <div className="flex-1 flex items-center justify-center text-sm text-slate-400">No file with this entry.</div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-white border-b border-slate-200 text-xs text-slate-500">
                                <span className="truncate">
                                    {files.length > 1 && <b className="text-slate-700">File {fileIdx + 1} of {files.length} · </b>}
                                    {file.name}
                                    {cardOf(fileIdx) >= 0 && cards.length > 1 && <span className="text-slate-400"> · invoice {cardOf(fileIdx) + 1}</span>}
                                </span>
                                <span className="flex items-center gap-1 shrink-0">
                                    {files.length > 1 && <>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={fileIdx === 0} onClick={() => showFile(fileIdx - 1)} aria-label="Previous file"><ChevronUp className="h-4 w-4 -rotate-90" /></Button>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={fileIdx === files.length - 1} onClick={() => showFile(fileIdx + 1)} aria-label="Next file"><ChevronDown className="h-4 w-4 -rotate-90" /></Button>
                                    </>}
                                    {isImage(file) && <>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></Button>
                                        <span className="tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom(z => Math.min(3, z + 0.25))} aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
                                    </>}
                                    <a href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-slate-100 text-sky-700"><ExternalLink className="h-3.5 w-3.5" /> Open</a>
                                </span>
                            </div>
                            <div className="flex-1 min-h-0 overflow-auto">
                                {isImage(file) ? (
                                    <img src={file.url} alt={file.name} className="mx-auto origin-top transition-transform" style={{ width: `${zoom * 100}%`, maxWidth: "none" }} />
                                ) : isPdf(file) ? (
                                    <iframe key={file.url} src={`${file.url}#view=FitH`} title={file.name} className="w-full h-full bg-white" />
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center gap-2 py-16 text-sm text-slate-500">
                                        <FileText className="h-8 w-8 text-slate-300" />
                                        This file can't be shown here.
                                        <a href={file.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">Open it in a new tab</a>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* What the store said, the invoices read, and the decision. */}
                <div className={cn("flex flex-col text-sm min-h-0", PANE_H)}>
                    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                        {scheme.fields.filter(f => f.type !== "file" && e.answers[f.id]).length > 0 && (
                            <dl className="space-y-1 text-xs">
                                {scheme.fields.filter(f => f.type !== "file" && e.answers[f.id]).map(f => (
                                    <div key={f.id} className="flex gap-2"><dt className="text-slate-500 shrink-0">{f.label}:</dt><dd className="text-slate-800 font-medium break-words min-w-0">{e.answers[f.id]}</dd></div>
                                ))}
                            </dl>
                        )}

                        {products.length > 0 ? (
                            <>
                                {(e.claimed_lines ?? []).length > 0 ? (
                                    <div className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-xs text-sky-900">
                                        <p className="font-semibold mb-0.5">The store said</p>
                                        {(e.claimed_lines ?? []).map(l => `${l.name} × ${l.qty}`).join(", ")} = <b>{claimedTotal} pts</b>
                                    </div>
                                ) : (
                                    <p className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
                                        Read each invoice: its number, and each series with its quantity. Photos that are pages of one invoice can be put together.
                                    </p>
                                )}

                                <div className="flex items-center justify-between">
                                    <p className="font-semibold text-slate-800">{cards.length === 1 ? "The invoice" : `${cards.length} invoices`}</p>
                                    {cards.length > 1 && <span className="text-xs text-slate-500 tabular-nums">{done} of {cards.length} read</span>}
                                </div>

                                <div className="space-y-1.5">
                                    {cards.map((c, i) => {
                                        const isOpen = i === active;
                                        const ready = c.invoice_no.trim() && filledLines(c);
                                        if (!isOpen) {
                                            /* A closed invoice: one line, what was read from it. */
                                            return (
                                                <button key={i} type="button" onClick={() => openCard(i)}
                                                    className="w-full flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left hover:border-slate-300">
                                                    {ready ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                                                        : c.invoice_no.trim() ? <AlertTriangle className="h-4 w-4 shrink-0 text-slate-300" />
                                                            : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-xs font-semibold text-slate-800 truncate">
                                                            Invoice {i + 1}{c.invoice_no.trim() ? ` · #${c.invoice_no.trim()}` : " · no number yet"}
                                                        </span>
                                                        <span className="block text-[11px] text-slate-500 truncate">
                                                            {c.files.length > 1 ? `${c.files.length} pages · ` : ""}
                                                            {filledLines(c) ? c.lines.filter(l => Number(l.qty) > 0).map(l => `${products.find(p => p.id === l.product_id)?.name ?? "?"} × ${l.qty}`).join(", ") : "nothing read yet"}
                                                        </span>
                                                    </span>
                                                    <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-700">{pointsOf(c.lines)}</span>
                                                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                                                </button>
                                            );
                                        }
                                        /* The open invoice: its pages, number and series. */
                                        return (
                                            <div key={i} className="rounded-lg border border-orange-300 bg-white ring-1 ring-orange-100">
                                                <div className="flex items-center justify-between gap-2 border-b border-orange-100 bg-orange-50/60 px-2.5 py-2">
                                                    <p className="text-xs font-bold text-slate-800">Invoice {i + 1} <span className="font-normal tabular-nums text-slate-500">· {pointsOf(c.lines)} pts</span></p>
                                                    {cards.length > 1 && (
                                                        <Select value="" onValueChange={v => merge(i, Number(v))}>
                                                            <SelectTrigger className="h-7 w-auto gap-1 border-dashed bg-white px-2 text-[11px] text-slate-600" aria-label="This is a page of another invoice">
                                                                <Layers className="h-3 w-3" /><SelectValue placeholder="Page of another invoice" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {cards.map((_, j) => j !== i && <SelectItem key={j} value={String(j)}>Same invoice as invoice {j + 1}{cards[j].invoice_no.trim() ? ` (#${cards[j].invoice_no.trim()})` : ""}</SelectItem>)}
                                                            </SelectContent>
                                                        </Select>
                                                    )}
                                                </div>
                                                <div className="p-2.5 space-y-2">
                                                    {c.files.length > 0 && (
                                                        <div className="flex flex-wrap gap-1">
                                                            {c.files.map(fi => (
                                                                <span key={fi} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] max-w-full",
                                                                    fi === fileIdx ? "border-orange-300 bg-orange-50 text-orange-800" : "border-slate-200 text-slate-600")}>
                                                                    <button type="button" className="truncate" onClick={() => showFile(fi)} title={files[fi]?.name}>{fi + 1}. {files[fi]?.name}</button>
                                                                    {c.files.length > 1 && <button type="button" className="text-slate-400 hover:text-rose-600" title="Not a page of this invoice" aria-label="Take this page out"
                                                                        onClick={() => split(i, fi)}><X className="h-3 w-3" /></button>}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <label className="block">
                                                        <span className="text-[11px] font-medium text-slate-500">Invoice no</span>
                                                        <Input ref={numberRef} className={cn("h-9 mt-0.5", !c.invoice_no.trim() && "border-amber-300")} placeholder="As printed on the invoice"
                                                            value={c.invoice_no} onChange={ev => setCard(i, x => ({ ...x, invoice_no: ev.target.value }))} />
                                                    </label>
                                                    <div>
                                                        <span className="text-[11px] font-medium text-slate-500">Series on this invoice</span>
                                                        <div className="mt-0.5 space-y-1.5">
                                                            {c.lines.map((l, li) => (
                                                                <div key={li} className="grid grid-cols-[minmax(0,1fr)_64px_28px] items-center gap-1.5">
                                                                    <Select value={l.product_id} onValueChange={v => setLine(i, li, { product_id: v })}>
                                                                        <SelectTrigger className="h-9 text-xs min-w-0" aria-label="Series"><SelectValue /></SelectTrigger>
                                                                        <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.points} pts)</SelectItem>)}</SelectContent>
                                                                    </Select>
                                                                    <Input type="number" min={1} className="h-9 text-xs" placeholder="Qty" aria-label="Quantity" value={l.qty}
                                                                        onChange={ev => setLine(i, li, { qty: ev.target.value })} />
                                                                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-rose-600" disabled={c.lines.length === 1}
                                                                        onClick={() => setCard(i, x => ({ ...x, lines: x.lines.filter((_, k) => k !== li) }))} aria-label="Remove line"><Trash2 className="h-3.5 w-3.5" /></Button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-2 pt-0.5">
                                                        <button type="button" className="text-xs font-medium text-sky-700 flex items-center gap-1 hover:underline"
                                                            onClick={() => setCard(i, x => ({ ...x, lines: [...x.lines, { product_id: products[0].id, qty: "" }] }))}><Plus className="h-3 w-3" /> Add series</button>
                                                        {i < cards.length - 1 && (
                                                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCard(i + 1)}>
                                                                Next invoice <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        ) : (
                            <div className="space-y-3">
                                {hasScore && (
                                    <label className="flex items-center gap-2">
                                        <span className="text-slate-600">Score</span>
                                        <Input type="number" min={0} className="h-9 w-24" value={score} onChange={ev => setScore(ev.target.value)} aria-label="Score" />
                                    </label>
                                )}
                                <label className="block space-y-1">
                                    <span className="font-medium text-slate-800">Invoice no <span className="font-normal text-slate-400">— stops the same invoice counting twice</span></span>
                                    <Input className="h-9" placeholder="As printed on the invoice" value={invoiceNo} onChange={ev => setInvoiceNo(ev.target.value)} aria-label="Invoice number" />
                                </label>
                            </div>
                        )}
                    </div>

                    {/* The decision, always in view. */}
                    <div className="border-t border-slate-200 bg-slate-50 p-3 space-y-2">
                        {products.length > 0 && (
                            <div className="flex items-center justify-between">
                                <span className="text-slate-600">{cards.length > 1 ? `All ${cards.length} invoices` : "Total"}</span>
                                <b className="tabular-nums text-slate-900">{total} pts</b>
                            </div>
                        )}
                        {products.length > 0 && missingNo >= 0 && (
                            <p className="text-xs text-amber-700">
                                <button type="button" className="underline" onClick={() => openCard(missingNo)}>Invoice {missingNo + 1}</button> needs its number — it stops the same invoice counting twice.
                            </p>
                        )}
                        {changed && <p className="text-xs text-amber-700">Changed from what the store said ({claimedTotal} pts).</p>}
                        {rejecting ? (
                            <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5">
                                <Input ref={noteRef} autoFocus className="h-9 bg-white" placeholder="Why? The store sees this" value={note}
                                    onChange={ev => setNote(ev.target.value)} onKeyDown={ev => { if (ev.key === "Enter") reject(); if (ev.key === "Escape") setRejecting(false); }} />
                                <div className="flex gap-2">
                                    <Button size="sm" variant="destructive" disabled={!note.trim() || busy} onClick={reject}>Reject entry</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={!canApprove} onClick={approve} title="Approve (A)">
                                    {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
                                    Approve{products.length ? ` · ${total} pts` : ""}
                                </Button>
                                <Button variant="outline" className="text-rose-600 hover:text-rose-700" disabled={busy}
                                    onClick={() => setRejecting(true)} title="Reject (R)"><X className="h-4 w-4 mr-1" /> Reject</Button>
                            </div>
                        )}
                        <p className="text-[11px] text-slate-400">Keys: <b>A</b> approve · <b>R</b> reject · <b>J</b>/<b>↓</b> next · <b>K</b>/<b>↑</b> previous</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
