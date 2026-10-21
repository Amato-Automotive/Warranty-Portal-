import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { compressImage } from "@/lib/imageCompression";
import { cn } from "@/lib/utils";
import api, { getErrorMessage } from "@/lib/api";
import { Camera, Check, Loader2, Lock, LogOut, Trash2 } from "lucide-react";

/**
 * The ASM's own profile. They can fix the spelling of their name and set a
 * photo; the WhatsApp number (their login) and the email stay with head office.
 */

export interface AsmProfileData {
    id: string;
    name: string;
    phone_number: string | null;
    email: string | null;
    photo_url: string | null;
}

/** Mirrors cleanAsmName on the server. */
const NAME_RE = /^\p{L}[\p{L}\p{M} .'-]*$/u;
const tidyName = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
const nameProblem = (s: string) => {
    const n = tidyName(s);
    if (n.length < 2) return "Enter your name";
    if (n.length > 60) return "Keep it under 60 characters";
    if (!NAME_RE.test(n)) return "Letters only — spaces, dots, apostrophes and hyphens are fine";
    return null;
};

const initials = (name: string) =>
    name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";

/** The ASM's photo, or their initials on orange. */
export const AsmAvatar = ({ name, photoUrl, className }: { name: string; photoUrl?: string | null; className?: string }) =>
    photoUrl ? (
        <img src={photoUrl} alt={name} className={cn("object-cover bg-orange-50", className)} />
    ) : (
        <div className={cn("flex items-center justify-center bg-orange-500/10 text-orange-600 border border-orange-500/20 font-black", className)}>
            {initials(name)}
        </div>
    );

export const AsmProfile = ({ profile, onChange, onSignOut }: {
    profile: AsmProfileData | null;
    /** Called after a save so the sidebar and greeting follow. */
    onChange: (p: AsmProfileData) => void;
    onSignOut: () => void;
}) => {
    const { toast } = useToast();
    const fileRef = useRef<HTMLInputElement>(null);
    // null until they type, so the box shows the saved name.
    const [draft, setDraft] = useState<string | null>(null);
    const [savingName, setSavingName] = useState(false);
    const [photoBusy, setPhotoBusy] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);

    if (!profile) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
            </div>
        );
    }

    const value = draft ?? profile.name;
    const unchanged = tidyName(value) === profile.name;
    const problem = unchanged ? null : nameProblem(value);

    const saveName = async () => {
        if (problem || unchanged) return;
        setSavingName(true);
        try {
            const res = await api.put("/asm-portal/profile", { name: tidyName(value) });
            onChange({ ...profile, name: res.data.name });
            setDraft(null);
            toast({ title: "Name updated" });
        } catch (err) {
            toast({ title: "Could not save", description: getErrorMessage(err, "Please try again."), variant: "destructive" });
        } finally {
            setSavingName(false);
        }
    };

    const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = e.target.files?.[0];
        e.target.value = "";
        if (!picked) return;
        if (!/^image\/(jpeg|png|webp)$/.test(picked.type)) {
            toast({ title: "Use a JPG, PNG or WebP photo", variant: "destructive" });
            return;
        }
        setPhotoBusy(true);
        try {
            const file = await compressImage(picked, { maxWidth: 800, maxHeight: 800, maxSizeKB: 300 });
            const form = new FormData();
            form.append("photo", file);
            const res = await api.post("/asm-portal/profile/photo", form, { headers: { "Content-Type": "multipart/form-data" } });
            onChange({ ...profile, photo_url: res.data.photo_url });
            toast({ title: "Photo updated" });
        } catch (err) {
            toast({ title: "Could not upload", description: getErrorMessage(err, "Please try again."), variant: "destructive" });
        } finally {
            setPhotoBusy(false);
        }
    };

    const removePhoto = async () => {
        setConfirmRemove(false);
        setPhotoBusy(true);
        try {
            await api.delete("/asm-portal/profile/photo");
            onChange({ ...profile, photo_url: null });
        } catch (err) {
            toast({ title: "Could not remove", description: getErrorMessage(err, "Please try again."), variant: "destructive" });
        } finally {
            setPhotoBusy(false);
        }
    };

    const lockedField = (label: string, v: string | null) => (
        <div className="space-y-1.5">
            <label className="text-sm font-bold text-slate-700">{label}</label>
            <div className="h-11 rounded-xl border border-slate-200 bg-slate-100 px-3 flex items-center gap-2 text-slate-500">
                <span className="flex-1 min-w-0 truncate">{v || "—"}</span>
                <Lock className="h-4 w-4 shrink-0" aria-label="Cannot be changed" />
            </div>
        </div>
    );

    return (
        <div className="max-w-2xl space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Photo */}
            <div className="rounded-[32px] border border-orange-100 bg-white p-6 md:p-8">
                <div className="flex flex-col sm:flex-row items-center gap-5">
                    <div className="relative shrink-0">
                        <AsmAvatar name={profile.name} photoUrl={profile.photo_url} className="h-24 w-24 rounded-3xl text-2xl" />
                        {photoBusy && (
                            <div className="absolute inset-0 rounded-3xl bg-white/70 flex items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
                            </div>
                        )}
                        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pickPhoto} />
                    </div>
                    <div className="flex-1 min-w-0 text-center sm:text-left">
                        <p className="text-xl font-black text-slate-900 tracking-tight break-words">{profile.name}</p>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-500 mt-0.5">Area Sales Manager</p>
                        <div className="mt-3 flex flex-wrap gap-2 justify-center sm:justify-start">
                            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={photoBusy} className="rounded-xl border-orange-200 text-orange-700 hover:bg-orange-50">
                                <Camera className="h-4 w-4 mr-1.5" /> {profile.photo_url ? "Change photo" : "Add photo"}
                            </Button>
                            {profile.photo_url && (
                                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)} disabled={photoBusy} className="rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50">
                                    <Trash2 className="h-4 w-4 mr-1.5" /> Remove
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Details: the name is a normal field; number and email are locked */}
            <div className="rounded-[32px] border border-orange-100 bg-white p-6 md:p-8 space-y-5">
                <h3 className="text-base font-black text-slate-800">Your details</h3>

                <div className="space-y-1.5">
                    <label htmlFor="asm-name" className="text-sm font-bold text-slate-700">Name</label>
                    <div className="flex gap-2">
                        <Input
                            id="asm-name"
                            value={value}
                            maxLength={80}
                            onChange={e => setDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") saveName(); }}
                            className="h-11 rounded-xl text-base bg-white border-slate-300 focus-visible:ring-orange-400"
                            aria-invalid={!!problem}
                        />
                        <Button onClick={saveName} disabled={unchanged || !!problem || savingName} className="h-11 rounded-xl bg-orange-500 hover:bg-orange-600 px-5 shrink-0">
                            {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4 mr-1.5" /> Save</>}
                        </Button>
                    </div>
                    {problem
                        ? <p className="text-xs text-rose-600">{problem}</p>
                        : <p className="text-xs text-slate-500">If your name is spelt wrong, correct it here and press Save.</p>}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    {lockedField("WhatsApp number", profile.phone_number)}
                    {lockedField("Email", profile.email)}
                </div>
                <p className="text-xs text-slate-500">
                    Your number and email can only be changed by head office — your login code comes to this number.
                </p>
            </div>

            {/* On phones the sidebar is hidden, so signing out lives here too. */}
            <Button
                variant="outline"
                onClick={onSignOut}
                className="md:hidden w-full h-12 rounded-2xl border-rose-200 text-rose-600 hover:bg-rose-50 font-bold"
            >
                <LogOut className="h-4 w-4 mr-2" /> Sign out
            </Button>

            <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
                <AlertDialogContent className="rounded-3xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove your photo?</AlertDialogTitle>
                        <AlertDialogDescription>Your initials will show instead. You can add a photo again any time.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-xl">Keep it</AlertDialogCancel>
                        <AlertDialogAction onClick={removePhoto} className="rounded-xl bg-rose-600 hover:bg-rose-700">Remove</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
