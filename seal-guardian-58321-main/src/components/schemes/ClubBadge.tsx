import {
    Award, Medal, Trophy, Crown, Gem, Star, Shield, ShieldCheck, Flame, Rocket, Zap, Sparkles,
    Target, Heart, ThumbsUp, Car, Gift, Diamond, Sun, Mountain, Anchor, Leaf, BadgeCheck, CircleDollarSign,
    type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Clubs: the icon set an admin picks from, the colours, and the badge every
 * screen shows a club with. A club is stored by icon and colour name, so the
 * set can grow without touching saved schemes; an unknown name falls back to
 * the Award icon and the slate colour.
 */

export const CLUB_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
    award: { icon: Award, label: "Award" },
    medal: { icon: Medal, label: "Medal" },
    trophy: { icon: Trophy, label: "Trophy" },
    crown: { icon: Crown, label: "Crown" },
    gem: { icon: Gem, label: "Gem" },
    diamond: { icon: Diamond, label: "Diamond" },
    star: { icon: Star, label: "Star" },
    sparkles: { icon: Sparkles, label: "Sparkles" },
    "badge-check": { icon: BadgeCheck, label: "Verified" },
    shield: { icon: Shield, label: "Shield" },
    "shield-check": { icon: ShieldCheck, label: "Shield tick" },
    flame: { icon: Flame, label: "Flame" },
    rocket: { icon: Rocket, label: "Rocket" },
    zap: { icon: Zap, label: "Lightning" },
    target: { icon: Target, label: "Target" },
    mountain: { icon: Mountain, label: "Peak" },
    sun: { icon: Sun, label: "Sun" },
    anchor: { icon: Anchor, label: "Anchor" },
    leaf: { icon: Leaf, label: "Leaf" },
    heart: { icon: Heart, label: "Heart" },
    "thumbs-up": { icon: ThumbsUp, label: "Thumbs up" },
    car: { icon: Car, label: "Car" },
    gift: { icon: Gift, label: "Gift" },
    coin: { icon: CircleDollarSign, label: "Coin" },
};

/* Each colour: the badge's background, border and text, and a swatch. */
export const CLUB_COLORS: Record<string, { label: string; badge: string; swatch: string }> = {
    bronze: { label: "Bronze", badge: "bg-orange-50 text-orange-800 border-orange-200", swatch: "#b45309" },
    silver: { label: "Silver", badge: "bg-slate-100 text-slate-700 border-slate-300", swatch: "#94a3b8" },
    gold: { label: "Gold", badge: "bg-amber-50 text-amber-800 border-amber-300", swatch: "#d97706" },
    platinum: { label: "Platinum", badge: "bg-cyan-50 text-cyan-800 border-cyan-200", swatch: "#0891b2" },
    diamond: { label: "Diamond", badge: "bg-sky-50 text-sky-800 border-sky-200", swatch: "#0284c7" },
    emerald: { label: "Emerald", badge: "bg-emerald-50 text-emerald-800 border-emerald-200", swatch: "#047857" },
    ruby: { label: "Ruby", badge: "bg-rose-50 text-rose-800 border-rose-200", swatch: "#e11d48" },
    violet: { label: "Violet", badge: "bg-violet-50 text-violet-800 border-violet-200", swatch: "#7c3aed" },
    slate: { label: "Grey", badge: "bg-slate-50 text-slate-700 border-slate-200", swatch: "#475569" },
};

export interface ClubLike { name: string; icon: string; color: string }

export function ClubIcon({ icon, className }: { icon: string; className?: string }) {
    const Icon = (CLUB_ICONS[icon] ?? CLUB_ICONS.award).icon;
    return <Icon className={className} aria-hidden />;
}

/** A club as a pill: its icon and name, in its colour. */
export function ClubBadge({ club, size = "sm", className }: { club: ClubLike; size?: "sm" | "lg"; className?: string }) {
    const c = CLUB_COLORS[club.color] ?? CLUB_COLORS.slate;
    return (
        <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full border font-bold",
            size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]",
            c.badge, className,
        )}>
            <ClubIcon icon={club.icon} className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />
            {club.name}
        </span>
    );
}
