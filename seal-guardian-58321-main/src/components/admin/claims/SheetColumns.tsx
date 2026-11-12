import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { CLAIM_COLUMNS, DEFAULT_CLAIM_COLUMNS, labelOfColumn, moveColumn, parseClaimColumns, type ClaimColumnKey } from "@/lib/claimSheetColumns";

const SETTING = "claim_sheet_columns";

/** The plant's column order, read fresh whenever `refresh` changes; the original order until one is saved. */
export function useClaimSheetColumns(refresh?: unknown): [ClaimColumnKey[], (next: ClaimColumnKey[]) => void] {
    const [columns, setColumns] = useState<ClaimColumnKey[]>([...DEFAULT_CLAIM_COLUMNS]);
    useEffect(() => {
        let alive = true;
        api.get(`/settings/public/${SETTING}`).then(r => { if (alive) setColumns(parseClaimColumns(r.data?.value)); }).catch(() => {});
        return () => { alive = false; };
    }, [refresh]);
    return [columns, setColumns];
}

/**
 * Sets which columns the claim sheet has and in what order. The same order is
 * what the copy buttons paste, so a row copied from here lands in the plant's
 * own spreadsheet column for column.
 */
export const SheetColumns = ({ open, current, onClose, onSaved }: {
    open: boolean; current: ClaimColumnKey[]; onClose: () => void; onSaved: (next: ClaimColumnKey[]) => void;
}) => {
    const { toast } = useToast();
    /* Every column: the shown ones first in their order, then the hidden ones. */
    const full = (shown: ClaimColumnKey[]) => [...shown, ...CLAIM_COLUMNS.map(c => c.key).filter(k => !shown.includes(k))];
    const [order, setOrder] = useState<ClaimColumnKey[]>(full(current));
    const [shown, setShown] = useState<Set<ClaimColumnKey>>(new Set(current));
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setOrder(full(current));
        setShown(new Set(current));
    }, [open]);

    const toggle = (k: ClaimColumnKey) => setShown(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
    const chosen = order.filter(k => shown.has(k));

    const save = async (next: ClaimColumnKey[]) => {
        if (!next.length) return toast({ variant: "destructive", title: "Keep at least one column" });
        setSaving(true);
        try {
            await api.put(`/settings/admin/${SETTING}`, { value: JSON.stringify(next) });
            onSaved(next);
            toast({ title: "Sheet columns saved", description: "The sheet and the copy buttons follow this order." });
            onClose();
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Only someone with claims edit access can change this.") });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
            <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-2xl p-5">
                <DialogTitle className="text-lg font-extrabold text-gray-900">Sheet columns and copy order</DialogTitle>
                <p className="text-sm text-gray-600">Tick the columns the sheet should have and put them in the order the plant wants. Copy row and Copy sheet paste in this same order.</p>
                <ol className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                    {order.map((k, i) => {
                        const on = shown.has(k);
                        return (
                            <li key={k} className="flex items-center gap-2 px-3 py-1.5">
                                <input type="checkbox" checked={on} onChange={() => toggle(k)} aria-label={`Show ${labelOfColumn(k)}`} className="h-4 w-4 accent-orange-700" />
                                <span className={`min-w-0 flex-1 text-sm ${on ? "font-semibold text-gray-900" : "text-gray-400"}`}>
                                    {on && <span className="mr-2 inline-block w-5 text-right text-xs tabular-nums text-gray-400">{chosen.indexOf(k) + 1}</span>}
                                    {labelOfColumn(k)}
                                </span>
                                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={i === 0} aria-label={`Move ${labelOfColumn(k)} up`}
                                    onClick={() => setOrder(moveColumn(order, i, -1))}><ArrowUp className="h-4 w-4" /></Button>
                                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={i === order.length - 1} aria-label={`Move ${labelOfColumn(k)} down`}
                                    onClick={() => setOrder(moveColumn(order, i, 1))}><ArrowDown className="h-4 w-4" /></Button>
                            </li>
                        );
                    })}
                </ol>
                <div className="flex flex-wrap justify-between gap-2">
                    <Button type="button" variant="outline" disabled={saving} className="h-11 rounded-xl"
                        onClick={() => { setOrder(full(DEFAULT_CLAIM_COLUMNS)); setShown(new Set(DEFAULT_CLAIM_COLUMNS)); }}>
                        Original order
                    </Button>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" disabled={saving} onClick={onClose} className="h-11 rounded-xl">Cancel</Button>
                        <Button type="button" disabled={saving} onClick={() => save(chosen)} className="h-11 rounded-xl bg-orange-700 font-bold hover:bg-orange-800">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
