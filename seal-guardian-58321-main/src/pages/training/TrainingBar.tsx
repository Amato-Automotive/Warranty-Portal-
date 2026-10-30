import { useEffect, useState } from "react";
import { GraduationCap, RotateCcw, LogOut, Store, Warehouse } from "lucide-react";
import { TRAINING_EXIT_KEY, isAdmitted } from "@/training/flag";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

/* Fixed for the tab, like the sandbox's own mode (mockApi reads the same
   address when it loads); the dashboard may later move to a page without it. */
const distributor = new URLSearchParams(window.location.search).get("as") === "distributor";

/**
 * The bar over every page of a training tab, once TrainingPage has let the
 * person in: which store they are practising as, Start over, and Exit. It also
 * stops Call / WhatsApp / email links — the sample numbers look real (the
 * forms insist on it), so none of them may actually open.
 */
const TrainingBar = () => {
    const [shown, setShown] = useState(isAdmitted);
    const { toast } = useToast();

    useEffect(() => {
        const show = () => setShown(true);
        window.addEventListener("training:admitted", show);
        // Let in before this listened (the page's effect can run first).
        if (isAdmitted()) show();
        return () => window.removeEventListener("training:admitted", show);
    }, []);

    useEffect(() => {
        const stop = (e: MouseEvent) => {
            const a = (e.target as HTMLElement).closest?.("a");
            const href = a?.getAttribute("href") ?? "";
            if (!/^(tel:|mailto:|sms:|whatsapp:)|wa\.me\//i.test(href)) return;
            e.preventDefault();
            e.stopPropagation();
            toast({ title: "Not placed in training", description: "Calls and messages don't go out from the training store." });
        };
        document.addEventListener("click", stop, true);
        return () => document.removeEventListener("click", stop, true);
    }, [toast]);

    if (!shown) return null;

    const exit = () => {
        window.close();
        // Not opened by a script (or the browser refused): go back instead.
        setTimeout(() => window.location.assign(sessionStorage.getItem(TRAINING_EXIT_KEY) || "/"), 150);
    };
    const switchTo = (as: "franchise" | "distributor") => window.location.assign(as === "distributor" ? "/training?as=distributor" : "/training");

    return (
        <div role="region" aria-label="Training mode"
            className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50/95 py-1 pl-3 pr-1 shadow-lg backdrop-blur text-xs sm:text-sm max-w-[calc(100vw-16px)]">
            <GraduationCap className="h-4 w-4 shrink-0 text-amber-700" />
            <span className="font-semibold text-amber-900 whitespace-nowrap">Training</span>
            <span className="hidden md:inline text-amber-800 whitespace-nowrap">· nothing here is real or sent to anyone</span>
            <div className="ml-1 inline-flex rounded-full bg-white/80 p-0.5 border border-amber-200">
                {([["franchise", "Franchise", Store], ["distributor", "Distributor", Warehouse]] as const).map(([key, label, Icon]) => {
                    const on = (key === "distributor") === distributor;
                    return (
                        <button key={key} type="button" aria-pressed={on} onClick={() => !on && switchTo(key)}
                            className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium", on ? "bg-amber-500 text-white" : "text-amber-900 hover:bg-amber-100")}>
                            <Icon className="h-3.5 w-3.5" /><span className="hidden sm:inline">{label}</span>
                        </button>
                    );
                })}
            </div>
            {/* Back to the start, as the mode it is in: a reload of /training rebuilds the store. */}
            <button type="button" onClick={() => switchTo(distributor ? "distributor" : "franchise")} title="Start over with a fresh store"
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-amber-900 hover:bg-amber-100">
                <RotateCcw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Start over</span>
            </button>
            <button type="button" onClick={exit}
                className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-700">
                <LogOut className="h-3.5 w-3.5" /><span className="hidden sm:inline">Exit</span>
            </button>
        </div>
    );
};

export default TrainingBar;
