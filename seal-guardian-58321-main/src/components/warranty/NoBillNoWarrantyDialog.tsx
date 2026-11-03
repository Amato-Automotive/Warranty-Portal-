import { useState } from "react";
import { Receipt, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const STYLES = `
@keyframes nb-drop { 0% { opacity: 0; transform: translateY(-22px) scale(.8) rotate(-8deg); } 70% { opacity: 1; transform: translateY(3px) scale(1.04) rotate(2deg); } 100% { opacity: 1; transform: none; } }
@keyframes nb-pop { 0% { opacity: 0; transform: scale(.3); } 70% { opacity: 1; transform: scale(1.2); } 100% { opacity: 1; transform: none; } }
@keyframes nb-strike { to { stroke-dashoffset: 0; } }
@keyframes nb-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-4px) rotate(-2deg); } 75% { transform: translateX(4px) rotate(2deg); } }
@keyframes nb-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes nb-ring { 0% { opacity: .5; transform: scale(.7); } 100% { opacity: 0; transform: scale(1.5); } }
.nb-drop { animation: nb-drop .55s ease-out both; }
.nb-drop-2 { animation: nb-drop .55s ease-out .55s both; }
.nb-pop { animation: nb-pop .4s ease-out .4s both; }
.nb-strike { stroke-dasharray: 100; stroke-dashoffset: 100; animation: nb-strike .3s ease-in .35s forwards; }
.nb-strike-2 { stroke-dasharray: 100; stroke-dashoffset: 100; animation: nb-strike .3s ease-in .9s forwards; }
.nb-shake { animation: nb-shake .3s ease-in-out 1.2s; }
.nb-rise { animation: nb-rise .45s ease-out 1.1s both; }
.nb-rise-2 { animation: nb-rise .45s ease-out 1.3s both; }
.nb-ring { animation: nb-ring 2.4s ease-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .nb-drop, .nb-drop-2, .nb-pop, .nb-shake, .nb-rise, .nb-rise-2, .nb-ring { animation: none; }
  .nb-strike, .nb-strike-2 { animation: none; stroke-dashoffset: 0; }
}
`;

const Tile = ({ icon: Icon, tileClass, strikeClass }: { icon: typeof Receipt; tileClass: string; strikeClass: string }) => (
    <div className={`relative flex h-20 w-20 items-center justify-center rounded-2xl bg-white shadow-lg shadow-rose-200/70 ring-1 ring-rose-100 sm:h-24 sm:w-24 ${tileClass}`}>
        <Icon className="h-10 w-10 text-slate-500 sm:h-12 sm:w-12" strokeWidth={1.6} />
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <line x1="18" y1="18" x2="82" y2="82" pathLength={100} strokeWidth="8" strokeLinecap="round" className={`stroke-rose-600 ${strikeClass}`} />
        </svg>
    </div>
);

const NoticeBody = ({ onClose }: { onClose: () => void }) => {
    // Changing the key restarts the scene when it is tapped.
    const [replay, setReplay] = useState(0);

    return (
        <>
            <style>{STYLES}</style>

            <div
                key={replay}
                aria-hidden="true"
                onClick={() => setReplay((n) => n + 1)}
                className="relative flex cursor-pointer select-none items-center justify-center gap-3 overflow-hidden bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 px-6 pb-7 pt-10 sm:gap-4"
            >
                <span className="nb-ring absolute left-1/2 top-1/2 -ml-24 -mt-24 h-48 w-48 rounded-full border-2 border-rose-200" />
                <Tile icon={Receipt} tileClass="nb-drop" strikeClass="nb-strike" />
                <span className="nb-pop relative text-4xl font-black text-rose-600">=</span>
                <div className="nb-shake">
                    <Tile icon={ShieldCheck} tileClass="nb-drop-2" strikeClass="nb-strike-2" />
                </div>
            </div>

            <div className="space-y-5 bg-white px-5 pb-5 pt-5 sm:px-6 sm:pb-6">
                <DialogTitle className="nb-rise text-center text-[clamp(1.35rem,6.4vw,1.75rem)] font-black leading-tight tracking-tight text-slate-900">
                    No Bill = No Warranty
                </DialogTitle>

                <div className="nb-rise-2">
                    <Button
                        type="button"
                        onClick={onClose}
                        className="h-14 w-full rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 text-base font-black text-white shadow-lg shadow-rose-300 transition-all hover:-translate-y-0.5 hover:from-rose-600 hover:to-red-700 hover:shadow-xl hover:shadow-rose-300 active:translate-y-0 active:scale-[0.98]"
                    >
                        OK
                    </Button>
                </div>
            </div>
        </>
    );
};

/** Shown to a customer before they apply for a warranty: on the store's QR page and in their portal. */
export const NoBillNoWarrantyDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent aria-describedby={undefined} className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-3xl border-0 p-0 sm:max-w-md sm:rounded-3xl sm:p-0">
            <NoticeBody onClose={onClose} />
        </DialogContent>
    </Dialog>
);
