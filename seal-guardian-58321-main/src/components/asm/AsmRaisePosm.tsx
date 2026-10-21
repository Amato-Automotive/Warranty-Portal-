import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { POSMShop, requestForm } from "@/components/posm/POSMShop";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import type { Brand, PosmItem, Usage } from "@/lib/posm";
import { Loader2 } from "lucide-react";

/**
 * The ASM orders POSM for one of their stores: the store's own item cards,
 * brands and limits, exactly as the store would see them. The request is the
 * store's; the store is told the ASM raised it.
 */
export const AsmRaisePosm = ({ storeId, storeName, open, onOpenChange, onRaised }: {
    storeId: string;
    storeName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRaised: () => void;
}) => {
    const { toast } = useToast();
    const [shop, setShop] = useState<{ items: PosmItem[]; brands: Brand[]; usage: Usage } | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!open) return;
        setShop(null);
        setError("");
        api.get(`/asm-portal/stores/${storeId}/posm-catalog`)
            .then(res => {
                const d = res.data.data;
                setShop({ items: d.catalog.items, brands: d.brands, usage: d.usage });
            })
            .catch(e => setError(getErrorMessage(e, "Could not load the POSM items")));
    }, [open, storeId]);

    const send = async (lines: Parameters<typeof requestForm>[0], note: string) => {
        try {
            const r = await api.post(`/asm-portal/stores/${storeId}/posm`, requestForm(lines, note),
                { headers: { "Content-Type": "multipart/form-data" } });
            toast({ title: `Request raised — ${r.data?.data?.ticketId ?? ""}`.trim(), description: r.data?.message });
            onOpenChange(false);
            onRaised();
            return true;
        } catch (e) {
            toast({ title: "Could not raise the request", description: getErrorMessage(e, "Please try again."), variant: "destructive" });
            return false;
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-6xl max-h-[92vh] flex flex-col p-0 gap-0">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
                    <DialogTitle className="text-base">Raise POSM for {storeName}</DialogTitle>
                    <DialogDescription className="text-xs">
                        The store's own items and limits. It goes to head office as the store's request, marked as raised by you.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
                    {error
                        ? <p className="text-sm text-rose-600 text-center py-10">{error}</p>
                        : shop
                            ? <POSMShop items={shop.items} brands={shop.brands} usage={shop.usage} onSend={send} sendLabel="Raise request" forStore={storeName} />
                            : <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>}
                </div>
            </DialogContent>
        </Dialog>
    );
};
