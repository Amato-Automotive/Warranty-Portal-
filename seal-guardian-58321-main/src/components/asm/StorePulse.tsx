import { cn } from "@/lib/utils";

/**
 * A store's warranties week by week, oldest on the left; the last bar is the
 * past seven days. Scaled to the store's own busiest week — so the shape says
 * whether it is speeding up or slowing down — but never below `floor`, so a
 * store doing one a week doesn't look as busy as one doing thirty.
 */
export const StorePulse = ({ weekly, size = "sm", floor = 6, muted = false, className }: {
    weekly: number[];
    size?: "sm" | "lg";
    floor?: number;
    muted?: boolean;
    className?: string;
}) => {
    const max = Math.max(floor, ...weekly);
    const label = `Warranties per week, last ${weekly.length} weeks: ${weekly.join(", ")}`;
    return (
        <div
            role="img"
            aria-label={label}
            title={size === "sm" ? label : undefined}
            className={cn("flex items-end", size === "sm" ? "h-7 gap-[3px]" : "h-28 gap-1.5", className)}
        >
            {weekly.map((n, i) => {
                const last = i === weekly.length - 1;
                return (
                    <div key={i} className="flex-1 h-full flex flex-col justify-end group relative">
                        {size === "lg" && n > 0 && (
                            <span className={cn("text-[10px] tabular-nums text-center mb-1", last ? "font-bold text-orange-700" : "text-slate-400")}>{n}</span>
                        )}
                        <div
                            className={cn(
                                "w-full rounded-[2px]",
                                n === 0 ? "bg-slate-200" : muted ? "bg-slate-300" : last ? "bg-orange-500" : "bg-slate-400/70"
                            )}
                            style={{ height: n === 0 ? 2 : `${Math.max(10, (n / max) * (size === "lg" ? 82 : 100))}%` }}
                        />
                    </div>
                );
            })}
        </div>
    );
};
