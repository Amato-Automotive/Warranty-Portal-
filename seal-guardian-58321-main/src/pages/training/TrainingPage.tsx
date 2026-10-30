import { useEffect, useState } from "react";
import axios from "axios";
import { GraduationCap, Loader2 } from "lucide-react";
import FranchiseDashboard from "@/pages/FranchiseDashboard";
import { API_URL } from "@/lib/api";
import { TRAINING, TRAINING_EXIT_KEY, admit } from "@/training/flag";

type Who = "checking" | "admin" | "asm" | "none";

/**
 * The franchise dashboard in training mode (see training/flag.ts): the real
 * screens on a made-up store, for ASMs to learn and admins to demo. Opened in
 * its own tab from the ASM portal or the admin panel.
 *
 * Only an ASM or an admin gets in. Their real session is checked here with a
 * separate client, the one call this page makes to the server; everything
 * inside answers from the browser. The training bar (TrainingBar) sits over
 * every page of the tab once they are in, not just this one: the dashboard
 * can lead elsewhere, e.g. to /thank-you after a correction.
 */
const TrainingPage = () => {
    const [who, setWho] = useState<Who>("checking");

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
                admit();
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

    return <FranchiseDashboard />;
};

export default TrainingPage;
