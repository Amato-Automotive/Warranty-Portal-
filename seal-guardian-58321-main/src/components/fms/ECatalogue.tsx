import { Download, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import api from "@/lib/api";

type Brand = "AF" | "AC";
interface Catalogue { brand: Brand; flipbook_url: string; download_url: string }

const LABEL: Record<Brand, string> = { AF: "Autoform", AC: "Autocruze" };

/* Autoform's links as they were before the admin set any. */
const AF_FALLBACK = {
    flipbook_url: "https://heyzine.com/flip-book/7343bc407b4662d5.html",
    download_url: "https://drive.google.com/uc?export=download&id=1wBnJ1pVpjYAXir7VW8mbKc6V2-vzqGRs",
};

/**
 * The store's e-catalogue: its own brand's, and a switch between the two
 * for a store that carries both. The server decides which it may see.
 */
const ECatalogue = () => {
    const [cats, setCats] = useState<Catalogue[]>([]);
    const [brand, setBrand] = useState<Brand>("AF");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get("/settings/ecatalogue/mine")
            .then(r => {
                const list: Catalogue[] = (r.data.data || []).map((c: Catalogue) => c.brand === "AF"
                    ? { ...c, flipbook_url: c.flipbook_url || AF_FALLBACK.flipbook_url, download_url: c.download_url || AF_FALLBACK.download_url }
                    : c);
                setCats(list);
                if (list[0]) setBrand(list[0].brand);
            })
            .catch(error => {
                console.error("Failed to fetch e-catalogue links", error);
                setCats([{ brand: "AF", ...AF_FALLBACK }]);
            })
            .finally(() => setLoading(false));
    }, []);

    const cur = cats.find(c => c.brand === brand);

    return (
        <div className="space-y-6">
            {/* Header with Download Button */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center text-orange-600">
                        <BookOpen className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-black text-slate-800 uppercase tracking-tight">E-Catalogue{cur && cats.length === 1 ? ` · ${LABEL[cur.brand]}` : ""}</h2>
                        <p className="text-xs text-slate-400 font-medium">Browse our complete product catalogue digitally</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {cats.length > 1 && (
                        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1" role="tablist" aria-label="Brand">
                            {cats.map(c => (
                                <button key={c.brand} type="button" role="tab" aria-selected={brand === c.brand} onClick={() => setBrand(c.brand)}
                                    className={`px-4 h-8 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${brand === c.brand ? (c.brand === "AF" ? "bg-orange-500 text-white" : "bg-blue-600 text-white") : "text-slate-500 hover:text-slate-800"}`}>
                                    {LABEL[c.brand]}
                                </button>
                            ))}
                        </div>
                    )}
                    <Button
                        onClick={() => cur?.download_url && window.open(cur.download_url, "_blank")}
                        disabled={!cur?.download_url}
                        className="relative z-10 bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-5 h-10 font-bold text-xs uppercase tracking-wider shadow-md shadow-orange-200 transition-all duration-300 hover:shadow-lg hover:shadow-orange-300"
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Download
                    </Button>
                </div>
            </div>

            {/* Flipbook Iframe Container */}
            <div className="relative rounded-[32px] overflow-hidden border-2 border-orange-100 bg-white shadow-2xl shadow-orange-100/50 group">
                <div className="flex-1 w-full bg-slate-50 relative group transition-all duration-500" style={{ height: "75vh", minHeight: "600px" }}>
                    {loading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/90 backdrop-blur-md z-10">
                            <div className="flex flex-col items-center gap-6">
                                <div className="relative">
                                    <div className="h-16 w-16 animate-spin rounded-full border-4 border-orange-100 border-t-orange-500" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <BookOpen className="h-6 w-6 text-orange-500 animate-pulse" />
                                    </div>
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                    <p className="text-sm font-black text-slate-800 uppercase tracking-widest">Synchronizing Catalogue</p>
                                    <p className="text-[10px] font-bold text-orange-500 uppercase tracking-tighter">Please wait a moment...</p>
                                </div>
                            </div>
                        </div>
                    ) : cur?.flipbook_url ? (
                        <iframe
                            key={cur.brand}
                            src={cur.flipbook_url}
                            className="w-full h-full border-none shadow-inner"
                            allow="fullscreen"
                            title={`${LABEL[cur.brand]} E-Catalogue`}
                        />
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
                            <BookOpen className="h-12 w-12 text-slate-200" />
                            <p className="text-sm font-bold text-slate-600">The {cur ? LABEL[cur.brand] : ""} e-catalogue is coming soon.</p>
                            <p className="text-xs text-slate-400">It will show here as soon as it's added.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Hint */}
            <p className="text-center text-[11px] text-slate-400 font-medium">
                Tip: Use the arrows or swipe to flip through pages. Click the fullscreen icon for a better reading experience.
            </p>
        </div>
    );
};

export default ECatalogue;
