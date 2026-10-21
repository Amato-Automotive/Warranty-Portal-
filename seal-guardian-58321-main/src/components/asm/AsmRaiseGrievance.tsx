import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GrievanceForm, grievancePayload, type GrievanceDraft } from "@/components/grievance/GrievanceForm";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";

/**
 * The ASM raises a grievance for one of their stores, on the store's own form.
 * It is filed as the store's franchise grievance (same categories, same
 * auto-assignment to the category's desk), marked as raised by the ASM.
 */
export const AsmRaiseGrievance = ({ storeId, storeName, open, onOpenChange, onRaised }: {
    storeId: string;
    storeName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRaised: () => void;
}) => {
    const { toast } = useToast();

    const submit = async (draft: GrievanceDraft) => {
        try {
            const r = await api.post(`/asm-portal/stores/${storeId}/grievances`, grievancePayload(draft));
            toast({ title: `Grievance raised — ${r.data?.data?.ticketId ?? ""}`.trim(), description: r.data?.message });
            onOpenChange(false);
            onRaised();
            return true;
        } catch (e) {
            toast({ title: "Could not raise the grievance", description: getErrorMessage(e, "Please try again."), variant: "destructive" });
            return false;
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 border-0 rounded-[30px] shadow-2xl bg-white">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100 bg-slate-50/50">
                    <DialogTitle className="text-xl font-black text-slate-800">Raise a grievance for {storeName}</DialogTitle>
                    <DialogDescription className="text-slate-500">
                        Filed as the store's grievance and sent to the right team, marked as raised by you. The store is told.
                    </DialogDescription>
                </DialogHeader>
                <div className="p-6">
                    {/* Mounted only while open, so each opening starts blank. */}
                    {open && <GrievanceForm onSubmit={submit} categoriesUrl="/asm-portal/grievance-categories" submitLabel="Raise grievance" />}
                </div>
            </DialogContent>
        </Dialog>
    );
};
