import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { isPhoto, isVideo } from "@/lib/claims";

/** A file to show; with its claim, it is saved through the API as a real download. */
export interface ViewItem { url: string; label: string; claimId?: number }

const nameOf = (it: ViewItem, i: number) => {
    const ext = it.url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? 'jpg';
    return `${(it.label || `file-${i + 1}`).replace(/[^\w-]+/g, '-').toLowerCase()}.${ext}`;
};

/** Saves a file to the computer; where it cannot be fetched, opens it to save by hand. */
export async function downloadFile(it: ViewItem, i = 0) {
    try {
        let blob: Blob;
        if (it.claimId) {
            blob = (await api.get(`/claims/${it.claimId}/file`, { params: { u: it.url }, responseType: 'blob' })).data;
        } else {
            const r = await fetch(it.url);
            if (!r.ok) throw new Error(String(r.status));
            blob = await r.blob();
        }
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href; a.download = nameOf(it, i);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 2000);
    } catch {
        window.open(it.url, '_blank', 'noopener');
    }
}

/** Every file in a set, one after another. */
export async function downloadAll(items: ViewItem[]) {
    for (let i = 0; i < items.length; i++) {
        await downloadFile(items[i], i);
        await new Promise(r => setTimeout(r, 300));
    }
}

/** A "Download all" button for a set of photos. */
export const DownloadAll = ({ items }: { items: ViewItem[] }) => {
    const [busy, setBusy] = useState(false);
    if (!items.length) return null;
    return (
        <Button type="button" variant="outline" disabled={busy} className="h-9 rounded-lg text-xs font-bold"
            onClick={async () => { setBusy(true); await downloadAll(items); setBusy(false); }}>
            <Download className="h-4 w-4 mr-1" />Download all ({items.length})
        </Button>
    );
};

/** A photo, video or file opened large, with zoom, rotate, next and previous, and download. */
export const PhotoViewer = ({ items, start, onClose }: { items: ViewItem[]; start: number; onClose: () => void }) => {
    const [i, setI] = useState(start);
    const [zoom, setZoom] = useState(1);
    const [turn, setTurn] = useState(0);
    useEffect(() => { setZoom(1); setTurn(0); }, [i]);
    const it = items[i];
    if (!it) return null;
    const go = (d: number) => setI(x => (x + d + items.length) % items.length);
    const tool = "h-10 w-10 rounded-lg bg-white/10 text-white hover:bg-white/20 flex items-center justify-center disabled:opacity-40";

    return (
        <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
            <DialogContent className="flex h-[92vh] w-[96vw] max-w-6xl flex-col gap-0 overflow-hidden border-0 bg-gray-950 p-0 text-white sm:rounded-2xl [&>button]:text-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3 pr-14">
                    <DialogTitle className="text-sm font-bold text-white">{it.label} <span className="font-normal text-white/60">· {i + 1} of {items.length}</span></DialogTitle>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {isPhoto(it.url) && <>
                            <button type="button" className={tool} aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}><ZoomOut className="h-5 w-5" /></button>
                            <span className="w-12 text-center text-xs tabular-nums text-white/70">{Math.round(zoom * 100)}%</span>
                            <button type="button" className={tool} aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}><ZoomIn className="h-5 w-5" /></button>
                            <button type="button" className={tool} aria-label="Rotate left" onClick={() => setTurn(t => t - 90)}><RotateCcw className="h-5 w-5" /></button>
                            <button type="button" className={tool} aria-label="Rotate right" onClick={() => setTurn(t => t + 90)}><RotateCw className="h-5 w-5" /></button>
                            <button type="button" className="h-10 rounded-lg bg-white/10 px-3 text-xs font-bold hover:bg-white/20" onClick={() => { setZoom(1); setTurn(0); }}>Reset</button>
                        </>}
                        <button type="button" className="flex h-10 items-center gap-1.5 rounded-lg bg-orange-600 px-3 text-xs font-bold hover:bg-orange-700" onClick={() => downloadFile(it, i)}>
                            <Download className="h-4 w-4" />Download
                        </button>
                    </div>
                </div>

                <div className="relative flex-1 overflow-auto">
                    <div className="flex min-h-full min-w-full items-center justify-center p-4">
                        {isPhoto(it.url) ? (
                            <img src={it.url} alt={it.label} draggable={false}
                                style={{ transform: `rotate(${turn}deg) scale(${zoom})`, transition: 'transform .2s ease' }}
                                className="max-h-[75vh] max-w-full select-none object-contain" />
                        ) : isVideo(it.url) ? (
                            <video src={it.url} controls className="max-h-[75vh] max-w-full" />
                        ) : (
                            <a href={it.url} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-2 rounded-xl bg-white/10 px-8 py-6 text-sm font-bold text-white no-underline">
                                <FileText className="h-10 w-10" />Open the file
                            </a>
                        )}
                    </div>
                    {items.length > 1 && <>
                        <button type="button" aria-label="Previous" onClick={() => go(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center"><ChevronLeft className="h-6 w-6" /></button>
                        <button type="button" aria-label="Next" onClick={() => go(1)} className="absolute right-3 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center"><ChevronRight className="h-6 w-6" /></button>
                    </>}
                </div>

                {items.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto border-t border-white/10 p-3">
                        {items.map((x, j) => (
                            <button key={x.url} type="button" onClick={() => setI(j)} aria-label={x.label}
                                className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${j === i ? 'border-orange-500' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                                {isPhoto(x.url) ? <img src={x.url} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center bg-white/10 text-[10px] font-bold">{isVideo(x.url) ? 'Video' : 'File'}</span>}
                            </button>
                        ))}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
