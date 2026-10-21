import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Trash2 } from "lucide-react";
import { CLUB_ICONS, CLUB_COLORS, ClubIcon, ClubBadge } from "@/components/schemes/ClubBadge";
import type { Club } from "@/lib/schemes";

/**
 * A scheme's clubs: a name, the score it starts at, an icon and a colour.
 * A store is in the highest club its score reaches — stores see the club they
 * are in, never how far the next one is.
 */

const newId = () => `k_${Math.random().toString(36).slice(2, 8)}`;

const STARTER: Omit<Club, "id">[] = [
    { name: "Bronze", min: 0, icon: "medal", color: "bronze", reward: "" },
    { name: "Silver", min: 180, icon: "award", color: "silver", reward: "" },
    { name: "Gold", min: 300, icon: "crown", color: "gold", reward: "" },
];

export function ClubsEditor({ clubs, onChange }: { clubs: Club[]; onChange: (c: Club[]) => void }) {
    const set = (i: number, patch: Partial<Club>) => onChange(clubs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    const sorted = [...clubs].sort((a, b) => a.min - b.min);

    return (
        <div className="space-y-3">
            {clubs.map((c, i) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-600">
                    {/* Icon */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <button type="button" aria-label={`Icon for ${c.name || "this club"}`}
                                className="h-9 w-9 rounded-lg border border-slate-200 bg-white flex items-center justify-center hover:border-orange-300"
                                style={{ color: (CLUB_COLORS[c.color] ?? CLUB_COLORS.slate).swatch }}>
                                <ClubIcon icon={c.icon} className="h-5 w-5" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-2" align="start">
                            <p className="px-1 pb-1.5 text-[11px] font-semibold text-slate-500">Pick an icon</p>
                            <div className="grid grid-cols-6 gap-1">
                                {Object.entries(CLUB_ICONS).map(([key, { label }]) => (
                                    <button key={key} type="button" title={label} aria-label={label} onClick={() => set(i, { icon: key })}
                                        className={`h-10 rounded-md flex items-center justify-center hover:bg-orange-50 ${c.icon === key ? "bg-orange-100 ring-1 ring-orange-300" : ""}`}
                                        style={{ color: (CLUB_COLORS[c.color] ?? CLUB_COLORS.slate).swatch }}>
                                        <ClubIcon icon={key} className="h-5 w-5" />
                                    </button>
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>

                    <Input value={c.name} onChange={e => set(i, { name: e.target.value })} placeholder="Club name, e.g. Silver" aria-label="Club name" className="h-9 w-[170px]" maxLength={40} />
                    from
                    <Input type="number" min={0} value={Number.isFinite(c.min) ? c.min : ""} onChange={e => set(i, { min: Number(e.target.value) })} aria-label="Starts at score" className="h-9 w-24" />
                    points

                    <Input value={c.reward ?? ""} onChange={e => set(i, { reward: e.target.value })} placeholder="Reward, e.g. 4 sets Signature 2 Row"
                        aria-label="Club reward" className="h-9 w-[230px]" maxLength={160} />

                    {/* Colour */}
                    <div className="flex items-center gap-1 ml-1" role="radiogroup" aria-label="Colour">
                        {Object.entries(CLUB_COLORS).map(([key, col]) => (
                            <button key={key} type="button" role="radio" aria-checked={c.color === key} title={col.label} aria-label={col.label}
                                onClick={() => set(i, { color: key })}
                                className={`h-6 w-6 rounded-full border-2 ${c.color === key ? "border-slate-800" : "border-white"} shadow-[0_0_0_1px_rgb(226,232,240)]`}
                                style={{ background: col.swatch }} />
                        ))}
                    </div>

                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-500 ml-auto" aria-label={`Remove ${c.name || "club"}`}
                        onClick={() => onChange(clubs.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ))}

            <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm"
                    onClick={() => {
                        const top = sorted[sorted.length - 1];
                        onChange([...clubs, { id: newId(), name: "", min: top ? top.min + 100 : 0, icon: "award", color: "slate" }]);
                    }}>
                    <Plus className="h-4 w-4 mr-1" /> Add a club
                </Button>
                {!clubs.length && (
                    <Button type="button" variant="outline" size="sm" onClick={() => onChange(STARTER.map(c => ({ ...c, id: newId() })))}>
                        Start with Bronze · Silver · Gold
                    </Button>
                )}
            </div>

            {sorted.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    How stores will see them:
                    {sorted.map(c => (
                        <span key={c.id} className="flex items-center gap-1">
                            <ClubBadge club={{ ...c, name: c.name || "Unnamed" }} />
                            <span className="tabular-nums">{Number.isFinite(c.min) ? `${c.min}+` : ""}</span>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
