import { cn } from "@/lib/utils";

/**
 * Both brands side by side, in white, for the pages everyone sees before we
 * know their store (login, registration). Smaller on a phone, so both fit.
 */
export const BrandLockup = ({ className }: { className?: string }) => (
    <div className={cn("flex items-center justify-center gap-3 sm:gap-5", className)}>
        <img src="/autoform-logo.png" alt="Autoform"
            className="h-9 sm:h-14 w-auto max-w-[42%] object-contain brightness-0 invert drop-shadow-lg" />
        <span aria-hidden className="h-9 sm:h-12 w-px shrink-0 bg-white/40" />
        <img src="/autocruze-logo.png" alt="AutoCruze"
            className="h-8 sm:h-12 w-auto max-w-[46%] object-contain brightness-0 invert drop-shadow-lg" />
    </div>
);
