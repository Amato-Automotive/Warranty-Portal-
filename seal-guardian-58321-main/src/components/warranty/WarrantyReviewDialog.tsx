import { useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, FileText, Loader2, Pencil } from "lucide-react";

/**
 * "Is this all correct?" — shown when a warranty form passes its checks, before
 * anything is sent. Modify closes it and leaves the form exactly as it was,
 * every field and photo still filled; Submit sends it. Shared by the seat cover
 * and PPF forms, wherever they are used.
 */

export interface ReviewSection {
    title: string;
    /** Label and value; an empty value shows as "—". */
    rows: [string, string | null | undefined][];
    /** Go back to the part of the form this came from. */
    onEdit?: () => void;
}

export interface ReviewPhoto {
    label: string;
    /** A newly picked file, or the URL of one already on record (editing). */
    file?: File | null;
    url?: string | null;
}

interface Props {
    open: boolean;
    sections: ReviewSection[];
    photos?: ReviewPhoto[];
    loading?: boolean;
    onModify: () => void;
    onConfirm: () => void;
}

export function WarrantyReviewDialog({ open, sections, photos = [], loading, onModify, onConfirm }: Props) {
    // Previews of the picked files, released when the dialog closes or the files change.
    const previews = useMemo(
        () => photos.map(p => ({
            ...p,
            src: p.file ? URL.createObjectURL(p.file) : p.url ?? null,
            isPdf: p.file ? p.file.type === "application/pdf" : /\.pdf($|\?)/i.test(p.url ?? ""),
        })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [open, ...photos.map(p => p.file ?? p.url)],
    );
    useEffect(() => () => previews.forEach(p => p.file && p.src && URL.revokeObjectURL(p.src)), [previews]);

    return (
        <Dialog open={open} onOpenChange={o => { if (!o && !loading) onModify(); }}>
            <DialogContent className="max-w-2xl w-[95vw] max-h-[92vh] p-0 sm:p-0 gap-0 overflow-hidden flex flex-col rounded-2xl">
                <DialogHeader className="px-5 sm:px-6 pt-5 pb-3 text-left space-y-1 border-b border-slate-100">
                    <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Check your details
                    </DialogTitle>
                    <DialogDescription className="text-sm text-slate-500">
                        Make sure everything below is correct. If anything is wrong, tap <b>Modify</b> to go back — nothing you filled is lost.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
                    {sections.map(s => (
                        <section key={s.title} className="rounded-xl border border-slate-200 overflow-hidden">
                            <div className="flex items-center justify-between gap-2 bg-slate-50 px-4 py-2">
                                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">{s.title}</h3>
                                {s.onEdit && (
                                    <button type="button" onClick={s.onEdit} disabled={loading}
                                        className="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1 disabled:opacity-50">
                                        <Pencil className="h-3 w-3" /> Edit
                                    </button>
                                )}
                            </div>
                            <dl className="divide-y divide-slate-100">
                                {s.rows.map(([label, value]) => (
                                    <div key={label} className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-4 px-4 py-2.5">
                                        <dt className="text-xs text-slate-500 sm:w-40 shrink-0">{label}</dt>
                                        <dd className="text-sm font-semibold text-slate-900 break-words min-w-0">
                                            {value && String(value).trim() ? value : <span className="text-slate-300 font-normal">—</span>}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    ))}

                    {previews.length > 0 && (
                        <section className="rounded-xl border border-slate-200 overflow-hidden">
                            <div className="bg-slate-50 px-4 py-2">
                                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Photos</h3>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3">
                                {previews.map(p => (
                                    <figure key={p.label} className="min-w-0">
                                        <div className="aspect-[4/3] rounded-lg border border-slate-200 bg-slate-50 overflow-hidden grid place-items-center">
                                            {!p.src ? (
                                                <span className="text-[11px] text-slate-400 px-2 text-center">Not added</span>
                                            ) : p.isPdf ? (
                                                <span className="flex flex-col items-center gap-1 text-slate-500 px-2 text-center">
                                                    <FileText className="h-7 w-7" />
                                                    <span className="text-[10px] truncate max-w-full">{p.file?.name ?? "PDF"}</span>
                                                </span>
                                            ) : (
                                                <img src={p.src} alt={p.label} className="h-full w-full object-cover" />
                                            )}
                                        </div>
                                        <figcaption className="mt-1 text-[11px] font-medium text-slate-600 truncate">{p.label}</figcaption>
                                    </figure>
                                ))}
                            </div>
                        </section>
                    )}
                </div>

                <DialogFooter className="px-5 sm:px-6 py-3 border-t border-slate-100 bg-white flex-row gap-2 sm:justify-between">
                    <Button type="button" variant="outline" onClick={onModify} disabled={loading} className="flex-1 sm:flex-none h-11 rounded-xl font-bold">
                        <ArrowLeft className="h-4 w-4 mr-1.5" /> Modify
                    </Button>
                    <Button type="button" onClick={onConfirm} disabled={loading}
                        className="flex-1 sm:flex-none h-11 rounded-xl font-bold bg-orange-500 hover:bg-orange-600 text-white">
                        {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                        {loading ? "Submitting…" : "Submit"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
