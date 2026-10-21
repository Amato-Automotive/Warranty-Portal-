import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Save, BookOpen, Download, Link as LinkIcon, ExternalLink, Globe } from "lucide-react";
import api from "@/lib/api";

type Brand = "AF" | "AC";
/* Each brand's catalogue; Autoform keeps the original setting keys. */
const BRANDS: { key: Brand; label: string; stores: string; flipbook: string; download: string }[] = [
    { key: "AF", label: "Autoform", stores: "Autoform stores, and stores with both brands", flipbook: "ecatalogue_flipbook_url", download: "ecatalogue_download_url" },
    { key: "AC", label: "Autocruze", stores: "Autocruze stores, and stores with both brands", flipbook: "ecatalogue_ac_flipbook_url", download: "ecatalogue_ac_download_url" },
];
type Links = Record<Brand, { flipbook: string; download: string }>;

export const AdminECatalogue = () => {
    const { toast } = useToast();
    const [brand, setBrand] = useState<Brand>("AF");
    const [links, setLinks] = useState<Links>({ AF: { flipbook: "", download: "" }, AC: { flipbook: "", download: "" } });
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);
    const b = BRANDS.find(x => x.key === brand)!;
    const flipbookUrl = links[brand].flipbook;
    const downloadUrl = links[brand].download;
    const setFlipbookUrl = (v: string) => setLinks(l => ({ ...l, [brand]: { ...l[brand], flipbook: v } }));
    const setDownloadUrl = (v: string) => setLinks(l => ({ ...l, [brand]: { ...l[brand], download: v } }));

    useEffect(() => {
        const get = (k: string) => api.get(`/settings/public/${k}`).then(r => (r.data.success ? r.data.value ?? "" : "")).catch(() => "");
        Promise.all(BRANDS.flatMap(x => [get(x.flipbook), get(x.download)]))
            .then(([af1, af2, ac1, ac2]) => setLinks({ AF: { flipbook: af1, download: af2 }, AC: { flipbook: ac1, download: ac2 } }))
            .finally(() => setFetching(false));
    }, []);

    const handleSave = async () => {
        if (!flipbookUrl || !downloadUrl) {
            toast({
                title: "Validation Error",
                description: "Both Flipbook URL and Download URL are required.",
                variant: "destructive",
            });
            return;
        }

        setLoading(true);
        try {
            await Promise.all([
                api.put(`/settings/admin/${b.flipbook}`, { value: flipbookUrl }),
                api.put(`/settings/admin/${b.download}`, { value: downloadUrl })
            ]);

            toast({
                title: "Settings Updated",
                description: `The ${b.label} e-catalogue links are updated.`,
                className: "bg-green-50 border-green-200 text-green-900",
            });
        } catch (error) {
            console.error("Failed to save e-catalogue settings", error);
            toast({
                title: "Update Failed",
                description: "Failed to save changes. Please try again.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    if (fetching) {
        return (
            <div className="flex items-center justify-center p-12">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
                    <p className="text-slate-500 font-medium">Loading e-catalogue settings...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-5xl mx-auto p-4 md:p-0">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-black tracking-tight text-slate-900 uppercase">E-Catalogue CMS</h2>
                    <p className="text-slate-500 font-medium">Manage the flipbook and download links for franchises, for each brand.</p>
                </div>
                <Button onClick={handleSave} disabled={loading} className="bg-orange-600 hover:bg-orange-700 h-12 px-8 rounded-xl shadow-lg shadow-orange-200 transition-all active:scale-95">
                    {loading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    Save {b.label}
                </Button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="Brand">
                    {BRANDS.map(x => (
                        <button key={x.key} type="button" role="tab" aria-selected={brand === x.key} onClick={() => setBrand(x.key)}
                            className={`px-5 py-2 rounded-xl text-sm font-bold transition-colors ${brand === x.key ? (x.key === "AF" ? "bg-orange-500 text-white" : "bg-blue-600 text-white") : "text-slate-500 hover:text-slate-800"}`}>
                            {x.label}
                            {!links[x.key].flipbook && <span className="ml-1.5 text-[10px] font-semibold opacity-80">(not set)</span>}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-slate-500">Shown to: <b className="text-slate-700">{b.stores}</b>. Each brand saves on its own.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Flipbook Configuration */}
                <Card className="border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                    <CardHeader className="bg-slate-50/50 border-b border-slate-100">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="p-2 bg-orange-100 rounded-lg text-orange-600">
                                <BookOpen className="h-5 w-5" />
                            </div>
                            <CardTitle className="text-xl font-bold">Flipbook Viewer</CardTitle>
                        </div>
                        <CardDescription className="font-medium">
                            Set the Heyzine flipbook iframe URL to display to franchises.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 uppercase tracking-tighter flex items-center gap-2">
                                <LinkIcon className="h-3 w-3" /> Heyzine Embed URL
                            </label>
                            <Input
                                value={flipbookUrl}
                                onChange={(e) => setFlipbookUrl(e.target.value)}
                                placeholder="https://heyzine.com/flip-book/..."
                                className="h-12 border-slate-200 focus:border-orange-500 rounded-xl"
                            />
                        </div>
                        <div className="p-4 bg-blue-50 border-l-4 border-blue-400 rounded-r-xl">
                            <p className="text-xs text-blue-700 font-medium leading-relaxed">
                                <strong>Tip:</strong> Copy the "Direct link" or the "src" attribute from the Heyzine embed code.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Download Configuration */}
                <Card className="border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                    <CardHeader className="bg-slate-50/50 border-b border-slate-100">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                                <Download className="h-5 w-5" />
                            </div>
                            <CardTitle className="text-xl font-bold">Download Link</CardTitle>
                        </div>
                        <CardDescription className="font-medium">
                            Set the Google Drive or direct download URL for the PDF.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 uppercase tracking-tighter flex items-center gap-2">
                                <Globe className="h-3 w-3" /> Download URL
                            </label>
                            <Input
                                value={downloadUrl}
                                onChange={(e) => setDownloadUrl(e.target.value)}
                                placeholder="https://drive.google.com/..."
                                className="h-12 border-slate-200 focus:border-blue-500 rounded-xl"
                            />
                        </div>
                        <div className="p-4 bg-orange-50 border-l-4 border-orange-400 rounded-r-xl">
                            <p className="text-xs text-orange-700 font-medium leading-relaxed">
                                <strong>Note:</strong> Ensure the link has public access enabled for franchises to download.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Preview Section */}
            <Card className="border-slate-200 shadow-xl overflow-hidden rounded-[32px]">
                <CardHeader className="bg-slate-900 border-b border-slate-800 p-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-slate-800 rounded-xl text-orange-500">
                                <ExternalLink className="h-5 w-5" />
                            </div>
                            <div>
                                <CardTitle className="text-xl font-bold text-white">Live Visual Preview</CardTitle>
                                <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">Real-time Frontend Simulation</p>
                            </div>
                        </div>
                        <div className="hidden sm:flex items-center gap-2">
                            <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Live Sync Enabled</span>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="grid md:grid-cols-1 bg-slate-50 font-mono text-xs">
                        <div className="p-6 md:p-10">
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <p className="text-slate-400 mb-1 uppercase font-black tracking-widest">{b.label} flipbook</p>
                                    <p className="text-[10px] text-slate-500 font-bold break-all opacity-60">{flipbookUrl || "Enter a URL above to see preview"}</p>
                                </div>
                                <div className="flex gap-2">
                                    <div className="h-3 w-3 rounded-full bg-red-400" />
                                    <div className="h-3 w-3 rounded-full bg-amber-400" />
                                    <div className="h-3 w-3 rounded-full bg-emerald-400" />
                                </div>
                            </div>

                            <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-lg" style={{ height: "600px" }}>
                                {flipbookUrl ? (
                                    <iframe
                                        src={flipbookUrl}
                                        className="w-full h-full border-none"
                                        allow="fullscreen"
                                        title="CMS Preview"
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-4">
                                        <BookOpen className="h-12 w-12 opacity-20" />
                                        <p className="font-bold uppercase tracking-widest text-[10px]">Waiting for valid Flipbook URL...</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-6 md:p-10 border-t border-slate-200 bg-white">
                            <p className="text-slate-400 mb-4 uppercase font-black tracking-widest">Download Target</p>
                            <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <div className="h-10 w-10 shrink-0 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center">
                                    <Download className="h-5 w-5" />
                                </div>
                                <p className="text-slate-800 break-all font-bold text-xs">{downloadUrl || "Not configured"}</p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
