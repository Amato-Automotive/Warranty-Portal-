import { useEffect, useState } from "react";
import { MessageSquareHeart } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";

interface Reminder { every: "login" | "day"; title: string; message: string; button: string }

/* When the reminder was last shown, so "once a day" waits for tomorrow and
   "every login" waits for the next sign-in. Kept in the browser only. */
const DAY_KEY = "feedback.reminder.shownOn";
const SESSION_KEY = "feedback.reminder.shownThisLogin";
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

const alreadyShown = (every: Reminder["every"]) => {
    try {
        return every === "day" ? localStorage.getItem(DAY_KEY) === todayIst() : sessionStorage.getItem(SESSION_KEY) === "1";
    } catch { return false; }
};
const markShown = () => {
    try { localStorage.setItem(DAY_KEY, todayIst()); sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* not kept */ }
};

/**
 * The monthly feedback reminder for a store that has not filled it. What it
 * says, between which days, and how often are the admin's (Review & Feedback
 * → Reminder); the server decides whether it is due. It waits for any other
 * pop-up on the page to close first.
 */
export function FeedbackReminder({ onFill }: { onFill: () => void }) {
    const [reminder, setReminder] = useState<Reminder | null>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        let alive = true;
        api.get("/feedback/current").then(r => {
            const rem: Reminder | null = r.data.data?.reminder ?? null;
            if (alive && rem && !alreadyShown(rem.every)) setReminder(rem);
        }).catch(() => { /* no reminder */ });
        return () => { alive = false; };
    }, []);

    // Open once no other dialog is on screen.
    useEffect(() => {
        if (!reminder) return;
        const t = window.setInterval(() => {
            if (!document.querySelector('[role="dialog"]')) {
                window.clearInterval(t);
                markShown();
                setOpen(true);
            }
        }, 1500);
        return () => window.clearInterval(t);
    }, [reminder]);

    if (!reminder) return null;
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-w-md rounded-3xl p-0 overflow-hidden">
                <div className="bg-gradient-to-br from-orange-50 to-amber-50 px-6 pt-7 pb-5 text-center">
                    <div className="mx-auto h-14 w-14 rounded-2xl bg-white grid place-items-center shadow-sm mb-3">
                        <MessageSquareHeart className="h-7 w-7 text-orange-500" />
                    </div>
                    <DialogTitle className="text-lg font-bold text-slate-800">{reminder.title}</DialogTitle>
                    <DialogDescription className="text-sm text-slate-600 mt-1.5 whitespace-pre-line">{reminder.message}</DialogDescription>
                </div>
                <div className="flex gap-2 p-4">
                    <Button variant="ghost" className="flex-1" onClick={() => setOpen(false)}>Later</Button>
                    <Button className="flex-1 bg-orange-500 hover:bg-orange-600 text-white rounded-xl" onClick={() => { setOpen(false); onFill(); }}>{reminder.button}</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
