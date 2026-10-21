import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import api from "@/lib/api";
import { compressImage, isCompressibleImage } from "@/lib/imageCompression";
import { compressVideo, isCompressibleVideo } from "@/lib/videoCompression";
import { cn } from "@/lib/utils";
import { CheckCircle, Loader2, Paperclip, Upload, X } from "lucide-react";

/**
 * The franchise grievance form — one form for everyone who raises a store's
 * grievance: the store itself, an admin on its behalf, and its ASM. Change
 * the form here and all three change; what each sends where is up to the
 * caller (`onSubmit`, with `grievancePayload` to build the body).
 */

/** Matches the server's grievanceUpload limit; a larger file is rejected there. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const SLOTS = 3;

/**
 * Fallback only. Categories are managed by an admin and fetched; this list
 * keeps the form usable if that request fails, rather than offering nothing.
 */
const FALLBACK_CATEGORIES = [
    { value: "seat_cover", label: "Seat Cover" },
    { value: "mats", label: "Mats" },
    { value: "accessories", label: "Accessories" },
    { value: "software_issue", label: "Software/Portal Issue" },
    { value: "ev_ppf", label: "EV & PPF" },
    { value: "other", label: "Other" },
];

export interface GrievanceDraft {
    category: string;
    subject: string;
    description: string;
    files: File[];
}

/**
 * The request body for a draft: multipart only when there are files, JSON
 * otherwise — which avoids multipart/Content-Type trouble for the common case.
 * `extra` adds fields such as the store a grievance is raised for.
 */
export function grievancePayload(d: GrievanceDraft, extra: Record<string, string> = {}): FormData | Record<string, string> {
    const fields: Record<string, string> = { category: d.category, subject: d.subject.trim(), description: d.description.trim(), ...extra };
    if (!d.files.length) return fields;
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    d.files.forEach(f => fd.append("attachments", f));
    return fd;
}

const formatFileSize = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;

export function GrievanceForm({
    onSubmit,
    categoriesUrl = "/grievance/categories?active=true",
    submitLabel = "Submit Complaint",
    footnote,
    disabled,
}: {
    /** Sends the draft; resolves true once it has gone, when the form clears. */
    onSubmit: (draft: GrievanceDraft) => Promise<boolean>;
    /** Where the active categories come from; the ASM portal has its own route. */
    categoriesUrl?: string;
    submitLabel?: string;
    footnote?: string;
    /** E.g. while the admin has not picked a store yet. */
    disabled?: boolean;
}) {
    const { toast } = useToast();
    const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
    const [category, setCategory] = useState("");
    const [subject, setSubject] = useState("");
    const [description, setDescription] = useState("");
    const [files, setFiles] = useState<(File | null)[]>([null, null, null]);
    const [compressing, setCompressing] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Only the active ones — a retired category stays on old grievances but
    // must not be offered again.
    useEffect(() => {
        api.get(categoriesUrl)
            .then(res => {
                const list = (res.data?.categories || []).map((c: { value: string; label: string }) => ({ value: c.value, label: c.label }));
                if (list.length > 0) setCategories(list);
            })
            .catch(() => { /* keep the fallback */ });
    }, [categoriesUrl]);

    const setSlot = (i: number, f: File | null) => setFiles(prev => prev.map((x, j) => (j === i ? f : x)));

    const pickFile = async (e: React.ChangeEvent<HTMLInputElement>, slot: number) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (isCompressibleImage(file)) {
            setCompressing(true);
            try {
                setSlot(slot, await compressImage(file));
            } catch (error) {
                console.error("Compression failed", error);
                setSlot(slot, file);
            } finally {
                setCompressing(false);
            }
            return;
        }

        if (isCompressibleVideo(file)) {
            setCompressing(true);
            try {
                const compressed = await compressVideo(file);
                // Re-encoding runs the clip through in real time, so a video
                // already small enough comes back untouched — say so rather
                // than claiming a compression that did not happen.
                if (compressed.size < file.size) {
                    const saved = Math.round((1 - compressed.size / file.size) * 100);
                    toast({ title: "Video compressed", description: `${formatFileSize(file.size)} → ${formatFileSize(compressed.size)} (${saved}% smaller)` });
                }
                if (compressed.size > MAX_ATTACHMENT_BYTES) {
                    toast({
                        title: "Video too large",
                        description: `Still ${formatFileSize(compressed.size)} after compressing. The limit is ${formatFileSize(MAX_ATTACHMENT_BYTES)} — please trim the clip.`,
                        variant: "destructive",
                    });
                    e.target.value = "";
                    return;
                }
                setSlot(slot, compressed);
            } catch (error) {
                console.error("Video compression failed", error);
                setSlot(slot, file);
            } finally {
                setCompressing(false);
            }
            return;
        }

        // Anything else (a PDF, say) goes straight through, size permitting.
        if (file.size > MAX_ATTACHMENT_BYTES) {
            toast({
                title: "File too large",
                description: `${formatFileSize(file.size)} exceeds the ${formatFileSize(MAX_ATTACHMENT_BYTES)} limit.`,
                variant: "destructive",
            });
            e.target.value = "";
            return;
        }
        setSlot(slot, file);
    };

    const submit = async () => {
        if (!category || !subject.trim() || !description.trim()) {
            toast({ title: "Missing Fields", description: "Please fill in all required fields", variant: "destructive" });
            return;
        }
        setSubmitting(true);
        try {
            const sent = await onSubmit({ category, subject, description, files: files.filter((f): f is File => !!f) });
            if (sent) {
                setCategory("");
                setSubject("");
                setDescription("");
                setFiles([null, null, null]);
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-5">
            {/* Category */}
            <div>
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 block">Category <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {categories.map(cat => (
                        <button
                            key={cat.value}
                            type="button"
                            onClick={() => setCategory(cat.value)}
                            className={cn(
                                "rounded-xl border-2 px-3 py-3 text-xs md:text-sm text-center font-bold transition-all hover:shadow-sm",
                                category === cat.value
                                    ? "border-orange-500 bg-orange-50 text-orange-600 ring-1 ring-orange-500/20"
                                    : "text-slate-600 border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
                            )}
                        >
                            {cat.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Subject */}
            <div>
                <label htmlFor="grievance-subject" className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2 block">Subject <span className="text-red-500">*</span></label>
                <input
                    id="grievance-subject"
                    type="text"
                    className="flex h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50/50 px-4 py-2 text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10 transition-all"
                    placeholder="Brief title of the issue"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                />
            </div>

            {/* Description */}
            <div>
                <label htmlFor="grievance-description" className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2 block">Description <span className="text-red-500">*</span></label>
                <Textarea
                    id="grievance-description"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Detailed description of the issue..."
                    rows={4}
                    className="rounded-2xl border-2 border-slate-100 bg-slate-50/50 px-4 py-3 text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10 transition-all resize-none"
                />
            </div>

            {/* Attachments */}
            <div>
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 block flex items-center gap-2">
                    <Paperclip className="h-4 w-4" />
                    Attachments (Optional - Max {SLOTS}, images or video)
                </label>
                <div className="grid grid-cols-3 gap-3">
                    {files.map((file, i) => (
                        <div key={i} className="relative">
                            <input type="file" id={`grievance-attachment-${i}`} className="hidden" accept="image/*,video/*"
                                onChange={e => pickFile(e, i)} />
                            <label
                                htmlFor={`grievance-attachment-${i}`}
                                className={cn(
                                    "flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-4 h-28 cursor-pointer transition-all",
                                    file ? "border-orange-400 bg-orange-50" : "border-slate-200 hover:border-orange-300 hover:bg-orange-50/30"
                                )}
                            >
                                {file ? (
                                    <>
                                        <CheckCircle className="h-7 w-7 text-orange-500 mb-1" />
                                        <span className="text-[10px] text-orange-600 font-bold truncate max-w-full px-1 text-center">
                                            {file.name.length > 12 ? file.name.substring(0, 12) + "..." : file.name}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <Upload className="h-6 w-6 text-slate-400 mb-1" />
                                        <span className="text-[10px] text-slate-400 font-medium">Upload</span>
                                    </>
                                )}
                            </label>
                            {file && (
                                <button
                                    type="button"
                                    onClick={() => setSlot(i, null)}
                                    aria-label={`Remove ${file.name}`}
                                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg hover:bg-red-600 transition-colors"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="pt-2">
                <Button
                    onClick={submit}
                    disabled={disabled || submitting || compressing}
                    className="w-full h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black uppercase tracking-widest shadow-xl shadow-slate-900/20 transition-all hover:translate-y-[-1px] active:translate-y-[0px]"
                >
                    {submitting || compressing ? (
                        <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {compressing ? "Compressing..." : "Submitting..."}
                        </>
                    ) : submitLabel}
                </Button>
                {footnote && <p className="text-[10px] text-center text-slate-400 mt-3">{footnote}</p>}
            </div>
        </div>
    );
}
