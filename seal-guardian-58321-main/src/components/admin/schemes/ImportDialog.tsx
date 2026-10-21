import { useState } from "react";
import * as XLSX from "xlsx";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, FileSpreadsheet, AlertTriangle, Download } from "lucide-react";
import { formatDay, type Scheme } from "@/lib/schemes";

/**
 * Past months from an Excel or CSV sheet: one row per product on an invoice
 * — store code (or name), date, series, quantity, invoice number. The columns
 * are matched by their headings (and can be corrected), the server checks every
 * row, and nothing is saved until the preview is approved. A store-day-invoice
 * already imported is skipped, so sending the same sheet twice is safe.
 */

type Col = "store" | "date" | "product" | "qty" | "invoice";
const COLS: { key: Col; label: string; required: boolean; guess: RegExp }[] = [
    { key: "store", label: "Store code or name", required: true, guess: /store|franchise|dealer|code|party/i },
    { key: "date", label: "Date", required: true, guess: /date|day/i },
    { key: "product", label: "Series / product", required: true, guess: /series|product|item|model|design/i },
    { key: "qty", label: "Quantity", required: true, guess: /qty|quantity|sets|units|pcs|nos/i },
    { key: "invoice", label: "Invoice number", required: false, guess: /invoice|bill|inv/i },
];

interface Preview {
    entries: { store_id: string; store_name: string; day: string; invoice: string | null; lines: { name: string; qty: number; subtotal: number }[]; points: number; rows: number[]; duplicate: boolean }[];
    problems: { row: number; message: string }[];
}

export function ImportDialog({ open, scheme, onClose, onDone }: {
    open: boolean; scheme: Scheme; onClose: () => void; onDone: () => void;
}) {
    const { toast } = useToast();
    const [sheet, setSheet] = useState<{ name: string; headers: string[]; rows: unknown[][] } | null>(null);
    const [map, setMap] = useState<Record<Col, string>>({ store: "", date: "", product: "", qty: "", invoice: "" });
    const [preview, setPreview] = useState<Preview | null>(null);
    const [busy, setBusy] = useState<"read" | "check" | "import" | null>(null);

    const reset = () => { setSheet(null); setPreview(null); setMap({ store: "", date: "", product: "", qty: "", invoice: "" }); };

    const readFile = async (file: File) => {
        setBusy("read"); setPreview(null);
        try {
            const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
            /* The heading row: the first with at least three filled cells. */
            const h = grid.findIndex(r => r.filter(c => String(c ?? "").trim()).length >= 3);
            if (h < 0) throw new Error("No heading row found");
            const headers = grid[h].map(c => String(c ?? "").trim());
            /* Each row keeps its Excel row number (grid index + 1), so a problem names the row the admin sees. */
            const rows = grid.map((r, i) => [i + 1, ...r] as unknown[])
                .slice(h + 1)
                .filter(r => r.slice(1).some(c => String(c ?? "").trim()));
            const guessed = { store: "", date: "", product: "", qty: "", invoice: "" } as Record<Col, string>;
            for (const c of COLS) guessed[c.key] = headers.find(x => x && c.guess.test(x) && !Object.values(guessed).includes(x)) ?? "";
            setMap(guessed);
            setSheet({ name: file.name, headers, rows });
        } catch (e: any) {
            toast({ title: "Could not read the sheet", description: e?.message || "Use an Excel or CSV file", variant: "destructive" });
        } finally { setBusy(null); }
    };

    const rowsFor = () => {
        if (!sheet) return [];
        const idx = (k: Col) => sheet.headers.indexOf(map[k]);
        return sheet.rows.map(r => {
            const [rowNo, ...cells] = r as [number, ...unknown[]];
            const get = (k: Col) => (idx(k) >= 0 ? cells[idx(k)] : "");
            return { row: rowNo, store: String(get("store") ?? "").trim(), date: get("date"), product: String(get("product") ?? "").trim(), qty: get("qty"), invoice: String(get("invoice") ?? "").trim() };
        });
    };

    const send = async (dryRun: boolean) => {
        setBusy(dryRun ? "check" : "import");
        try {
            const r = await api.post(`/schemes/admin/${scheme.id}/import`, { rows: rowsFor(), dry_run: dryRun });
            if (dryRun) { setPreview(r.data); return; }
            toast({
                title: `${r.data.added} entr${r.data.added === 1 ? "y" : "ies"} imported`,
                description: [r.data.skipped ? `${r.data.skipped} already imported, skipped` : "", r.data.problems?.length ? `${r.data.problems.length} rows not used` : ""].filter(Boolean).join(" · ") || undefined,
            });
            reset(); onDone();
        } catch (e) {
            toast({ title: dryRun ? "Could not check the sheet" : "Could not import", description: getErrorMessage(e, "Try again"), variant: "destructive" });
        } finally { setBusy(null); }
    };

    const missing = COLS.filter(c => c.required && !map[c.key]);
    const fresh = preview?.entries.filter(e => !e.duplicate) ?? [];
    const template = () => {
        const ws = XLSX.utils.aoa_to_sheet([["Store code", "Date", "Series", "Quantity", "Invoice no"], ["AF-101", "15-07-2026", "Signature Series", 4, "INV-1021"]]);
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Entries");
        XLSX.writeFile(wb, "scheme-import-template.xlsx");
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!o && !busy) { reset(); onClose(); } }}>
            <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Import past entries</DialogTitle>
                    <DialogDescription>One row per product on an invoice. Entries are approved and dated on their invoice date.</DialogDescription>
                </DialogHeader>

                {!sheet ? (
                    <div className="space-y-3">
                        <label className="flex flex-col items-center gap-2 cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 p-8 text-sm text-slate-600 hover:border-orange-300">
                            {busy === "read" ? <Loader2 className="h-8 w-8 animate-spin text-orange-500" /> : <FileSpreadsheet className="h-8 w-8 text-emerald-600" />}
                            Choose an Excel or CSV file
                            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
                        </label>
                        <p className="text-xs text-slate-500">
                            Columns: <b>Store code</b> (or store name), <b>Date</b>, <b>Series</b>, <b>Quantity</b>, and <b>Invoice no</b> (optional).
                            Series names must match this scheme's products — "Amaze" and "Amaze Series" both work.
                        </p>
                        <Button type="button" variant="outline" size="sm" onClick={template}><Download className="h-4 w-4 mr-1" /> Download a template</Button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-700"><b>{sheet.name}</b> · {sheet.rows.length} rows
                            <button type="button" className="ml-2 text-xs text-orange-600 hover:underline" onClick={reset}>Choose another file</button></p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {COLS.map(c => (
                                <label key={c.key} className="flex items-center justify-between gap-2 text-xs text-slate-700">
                                    <span className="font-semibold">{c.label}{c.required && <span className="text-rose-500"> *</span>}</span>
                                    <Select value={map[c.key] || "__none"} onValueChange={v => { setMap(m => ({ ...m, [c.key]: v === "__none" ? "" : v })); setPreview(null); }}>
                                        <SelectTrigger className="h-8 w-[200px]" aria-label={c.label}><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none">— none —</SelectItem>
                                            {sheet.headers.filter(Boolean).map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </label>
                            ))}
                        </div>

                        {preview && (
                            <div className="space-y-2">
                                <p className="text-sm text-slate-700">
                                    <b className="tabular-nums">{fresh.length}</b> entr{fresh.length === 1 ? "y" : "ies"} to add · <b className="tabular-nums">{fresh.reduce((n, e) => n + e.points, 0)}</b> points
                                    {preview.entries.length - fresh.length > 0 && <> · {preview.entries.length - fresh.length} already imported (skipped)</>}
                                </p>
                                {preview.problems.length > 0 && (
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 max-h-40 overflow-auto">
                                        <p className="font-semibold flex items-center gap-1.5 mb-1"><AlertTriangle className="h-3.5 w-3.5" /> {preview.problems.length} row{preview.problems.length === 1 ? "" : "s"} can't be used</p>
                                        <ul className="space-y-0.5">{preview.problems.map(p => <li key={p.row}>Row {p.row}: {p.message}</li>)}</ul>
                                    </div>
                                )}
                                <div className="rounded-xl border border-slate-200 max-h-64 overflow-auto">
                                    <table className="w-full text-xs">
                                        <thead className="sticky top-0 bg-slate-50 text-slate-700"><tr>
                                            <th className="px-2 py-1.5 text-left">Store</th><th className="px-2 py-1.5 text-left">Date</th>
                                            <th className="px-2 py-1.5 text-left">Invoice</th><th className="px-2 py-1.5 text-left">Products</th><th className="px-2 py-1.5 text-right">Points</th>
                                        </tr></thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {preview.entries.map((e, i) => (
                                                <tr key={i} className={e.duplicate ? "text-slate-400" : ""}>
                                                    <td className="px-2 py-1.5">{e.store_name}</td>
                                                    <td className="px-2 py-1.5 whitespace-nowrap">{formatDay(e.day)}</td>
                                                    <td className="px-2 py-1.5">{e.invoice ?? "—"}</td>
                                                    <td className="px-2 py-1.5">{e.lines.map(l => `${l.name} × ${l.qty}`).join(", ")}{e.duplicate ? " · already imported" : ""}</td>
                                                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{e.points}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => { reset(); onClose(); }} disabled={Boolean(busy)}>Cancel</Button>
                    {sheet && (
                        <Button variant="outline" onClick={() => send(true)} disabled={Boolean(busy) || missing.length > 0}
                            title={missing.length ? `Match: ${missing.map(m => m.label).join(", ")}` : undefined}>
                            {busy === "check" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Check sheet
                        </Button>
                    )}
                    {preview && (
                        <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => send(false)} disabled={Boolean(busy) || !fresh.length}>
                            {busy === "import" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Import {fresh.length} entr{fresh.length === 1 ? "y" : "ies"}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
