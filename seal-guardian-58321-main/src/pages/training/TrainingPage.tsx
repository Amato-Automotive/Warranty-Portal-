import { useEffect, useState } from "react";
import axios from "axios";
import { GraduationCap, RotateCcw, LogOut, Loader2, Store, Warehouse } from "lucide-react";
import FranchiseDashboard from "@/pages/FranchiseDashboard";
import { API_URL } from "@/lib/api";
import { TRAINING, TRAINING_EXIT_KEY } from "@/training/flag";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type Who = "checking" | "admin" | "asm" | "none";

/**
 * The franchise dashboard in training mode (see training/flag.ts): the real
 * screens on a made-up store, for ASMs to learn and admins to demo. Opened in
 * its own tab from the ASM portal or the admin panel.
 *
 * Only an ASM or an admin gets in. Their real session is checked here with a
 * separate client, the one call this page makes to the server; everything
 * inside answers from the browser.
 */
const TrainingPage = () => {
    const [who, setWho] = useState<Who>("checking");
    const distributor = new URLSearchParams(window.location.search).get("as") === "distributor";
    const { toast } = useToast();

    // The sample numbers look real (the forms insist on it), so no Call,
    // WhatsApp or email link may actually open from the training store.
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

    useEffect(() => {
        // Reached by in-app navigation: the live adapter is still in place, so
        // load the page properly before anything renders.
        if (!TRAINING) { window.location.reload(); return; }
        document.title = "Training · Franchise portal";
        const real = axios.create({ baseURL: API_URL, withCredentials: true });
        real.get("/auth/me")
            .then(r => r.data?.user?.role === "admin" ? "admin" as const : Promise.reject())
            .catch(() => real.get("/asm-portal/profile").then(() => "asm" as const))
            .then(role => {
                sessionStorage.setItem(TRAINING_EXIT_KEY, role === "admin" ? "/dashboard/admin" : "/asm");
                setWho(role);
            })
            .catch(() => setWho("none"));
    }, []);

    if (who === "checking") {
        return (
            <div className="h-screen flex items-center justify-center gap-3 text-slate-500 bg-[#fffaf5]">
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" /> Opening the training store…
            </div>
        );
    }

    if (who === "none") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#fffaf5] px-4">
                <div className="max-w-sm w-full rounded-2xl border border-orange-100 bg-white p-6 text-center shadow-sm">
                    <GraduationCap className="h-10 w-10 mx-auto text-orange-500" />
                    <h1 className="mt-3 text-lg font-bold text-slate-900">Training store</h1>
                    <p className="mt-1 text-sm text-slate-500">This is for area sales managers and head office. Sign in first, then open it again from your portal.</p>
                    {/* Plain links: a full page load leaves training mode behind. */}
                    <div className="mt-5 grid gap-2">
                        <a href="/asm/login" className="rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600">ASM sign in</a>
                        <a href="/login?role=admin" className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Head office sign in</a>
                    </div>
                </div>
            </div>
        );
    }

    const exit = () => {
        window.close();
        // Not opened by a script (or the browser refused): go back instead.
        setTimeout(() => window.location.assign(sessionStorage.getItem(TRAINING_EXIT_KEY) || "/"), 150);
    };
    const switchTo = (as: "franchise" | "distributor") => window.location.assign(as === "distributor" ? "/training?as=distributor" : "/training");

    return (
        <>
            <FranchiseDashboard />
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
                <button type="button" onClick={() => window.location.reload()} title="Start over with a fresh store"
                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-amber-900 hover:bg-amber-100">
                    <RotateCcw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Start over</span>
                </button>
                <button type="button" onClick={exit}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-700">
                    <LogOut className="h-3.5 w-3.5" /><span className="hidden sm:inline">Exit</span>
                </button>
            </div>
        </>
    );
};

export default TrainingPage;
