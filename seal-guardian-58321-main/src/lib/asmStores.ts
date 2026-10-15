/** A store as the ASM portal's store list and store page receive it. */
export interface AsmStoreSummary {
    vendor_details_id: string;
    store_name: string;
    store_code: string | null;
    store_email: string | null;
    city: string | null;
    state: string | null;
    contact_name: string | null;
    phone_number: string | null;
    email: string | null;
    is_franchise: boolean;
    is_distributor: boolean;
    is_verified: boolean;
    is_active: boolean;
    warranties_total: number;
    warranties_approved: number;
    warranties_pending: number;
    warranties_rejected: number;
    warranties_this_month: number;
    warranties_last_month: number;
    last_warranty_at: string | null;
    posm_open: number;
    posm_oldest_open_at: string | null;
    grievances_open: number;
    grievances_oldest_open_at: string | null;
    /** Warranties per week, oldest first; the last entry is the past seven days. */
    weekly: number[];
}

export const isLive = (s: { is_verified: boolean; is_active: boolean }) => s.is_verified && s.is_active;

/** "Inactive" or "Not approved" — nothing for a live store. */
export const statusNote = (s: { is_verified: boolean; is_active: boolean }) =>
    !s.is_verified ? "Not approved" : !s.is_active ? "Inactive" : null;

const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)) : null);
export const daysSinceWarranty = (s: AsmStoreSummary) => daysSince(s.last_warranty_at);

const days = (n: number) => (n === 0 ? "today" : n === 1 ? "1 day" : `${n} days`);

export type CallReason = { kind: "grievance" | "posm" | "slowing" | "quiet"; text: string; weight: number };

/** A live store with nothing registered for this long is worth a call. */
export const QUIET_DAYS = 30;

/**
 * Why the ASM might ring this store today, most pressing first. Empty when
 * nothing is waiting — the store then sits only in the roster.
 */
export const callReasons = (s: AsmStoreSummary): CallReason[] => {
    const out: CallReason[] = [];
    if (s.grievances_open > 0) {
        const d = daysSince(s.grievances_oldest_open_at) ?? 0;
        out.push({
            kind: "grievance",
            weight: 1000 + d,
            text: s.grievances_open === 1
                ? `Grievance open ${d === 0 ? "since today" : days(d)}`
                : `${s.grievances_open} grievances open, oldest ${days(d)}`,
        });
    }
    if (!isLive(s)) return out;

    const last4 = s.weekly.slice(-4).reduce((a, b) => a + b, 0);
    const prev4 = s.weekly.slice(-8, -4).reduce((a, b) => a + b, 0);
    const quiet = daysSinceWarranty(s);
    if (quiet === null || quiet >= QUIET_DAYS) {
        out.push({ kind: "quiet", weight: 500 + (quiet ?? 365), text: quiet === null ? "No warranties registered yet" : `Nothing registered in ${quiet} days` });
    } else if (prev4 >= 8 && last4 <= prev4 / 2) {
        const drop = Math.round((1 - last4 / prev4) * 100);
        out.push({ kind: "slowing", weight: 400 + drop, text: `Warranties down ${drop}% over the last four weeks` });
    }
    if (s.posm_open > 0) {
        const d = daysSince(s.posm_oldest_open_at) ?? 0;
        out.push({
            kind: "posm",
            weight: 100 + d,
            text: s.posm_open === 1 ? `POSM request waiting ${days(d)}` : `${s.posm_open} POSM requests waiting, oldest ${days(d)}`,
        });
    }
    return out.sort((a, b) => b.weight - a.weight);
};

export const REASON_DOT: Record<CallReason["kind"], string> = {
    grievance: "bg-rose-500",
    slowing: "bg-amber-500",
    quiet: "bg-amber-500",
    posm: "bg-sky-500",
};

const AVATAR = ["bg-orange-500", "bg-sky-600", "bg-violet-500", "bg-emerald-600", "bg-rose-500", "bg-amber-500"];
export const storeAvatar = (seed: string) => AVATAR[[...seed].reduce((t, c) => t + c.charCodeAt(0), 0) % AVATAR.length];

/** Up to two initials from a store name: "CAR BEAUTY - AMRITSAR" → "CB". */
export const storeInitials = (name: string) =>
    name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "S";

export const monthName = (offset: number, style: "short" | "long" = "long") => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return d.toLocaleDateString("en-IN", { month: style });
};

/** Store names arrive in shouting caps; show them as names. */
export const displayName = (name: string) =>
    name === name.toUpperCase()
        ? name.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(Ev|Ppf|Llp|Pvt|Ltd)\b/g, w => w.toUpperCase())
        : name;
