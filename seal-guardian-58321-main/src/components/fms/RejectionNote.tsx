import { useState } from "react";
import { splitRejectionNote } from "@/lib/rejectionReasons";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

/**
 * The reason on a rejected Buy More invoice. A hand-written reason shows as it
 * is; one of head office's standard messages shows its reason, with the whole
 * message one tap away.
 */
export function RejectionNote({ note, className }: { note: string; className?: string }) {
    const { tr } = useLanguage();
    const [open, setOpen] = useState(false);
    const { isLetter, before, reason, after } = splitRejectionNote(note);
    if (!isLetter) return <p className={cn("whitespace-pre-line break-words", className)}>{note}</p>;
    return (
        <div className={cn("space-y-1", className)}>
            {open && <p className="whitespace-pre-line break-words">{before}</p>}
            {/* The reason itself is the part the reader must not miss. */}
            <p className="whitespace-pre-line break-words rounded-md border-l-4 border-rose-500 bg-rose-100 px-3 py-2 font-semibold text-rose-900">{reason}</p>
            {open && <p className="whitespace-pre-line break-words">{after}</p>}
            <button type="button" className="text-xs font-bold underline" aria-expanded={open} onClick={() => setOpen(o => !o)}>
                {open ? tr("Show less", "कम दिखाएँ") : tr("Read the full message", "पूरा संदेश पढ़ें")}
            </button>
        </div>
    );
}
