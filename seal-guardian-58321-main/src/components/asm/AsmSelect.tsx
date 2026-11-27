import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The one dropdown the ASM screens use: a rounded pill with a soft border,
 * opening a rounded list with the chosen item ticked.
 */
export function AsmSelect({ value, onChange, options, label, className }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    label: string;
    className?: string;
}) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger aria-label={label}
                className={cn("h-9 w-auto min-w-0 gap-2 rounded-full border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50/40 focus:ring-2 focus:ring-orange-200 focus:ring-offset-0 data-[state=open]:border-orange-400", className)}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-slate-200 p-1 shadow-lg">
                {options.map(o => (
                    <SelectItem key={o.value} value={o.value}
                        className="cursor-pointer rounded-lg py-2 text-sm text-slate-700 focus:bg-orange-50 focus:text-orange-900 data-[state=checked]:font-semibold data-[state=checked]:text-orange-700">
                        {o.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
