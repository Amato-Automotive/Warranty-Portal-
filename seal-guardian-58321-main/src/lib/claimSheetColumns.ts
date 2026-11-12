/**
 * The plant's claim sheet: which columns it has and in what order. The order is
 * the plant team's to set; it decides both what the sheet shows and what the
 * copy buttons paste, so a copied row lands in their own spreadsheet in the same
 * order. Pure, so it is tested directly.
 */
export const CLAIM_COLUMNS = [
    { key: "sno", label: "S.No." },
    { key: "status", label: "Status" },
    { key: "claim_no", label: "Claim no." },
    { key: "date", label: "Date" },
    { key: "depot", label: "Depot" },
    { key: "store", label: "Store" },
    { key: "customer", label: "Customer" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "design", label: "Design" },
    { key: "material", label: "Material" },
    { key: "car", label: "Car" },
    { key: "major_colour", label: "Major colour" },
    { key: "minor_colour", label: "Minor colour" },
    { key: "component", label: "Component" },
    { key: "remarks", label: "Remarks" },
    { key: "issue", label: "Issue" },
    { key: "decision", label: "Decision" },
    { key: "alteration_no", label: "Alteration no." },
    { key: "dispatch_date", label: "Dispatch date" },
    { key: "docket", label: "Docket no." },
    { key: "courier", label: "Courier / Transporter" },
] as const;

export type ClaimColumnKey = (typeof CLAIM_COLUMNS)[number]["key"];

/** The order the sheet had before the plant set one. */
export const DEFAULT_CLAIM_COLUMNS: ClaimColumnKey[] = CLAIM_COLUMNS.map(c => c.key);

const KNOWN = new Set<string>(DEFAULT_CLAIM_COLUMNS);

export const labelOfColumn = (key: string): string => CLAIM_COLUMNS.find(c => c.key === key)?.label ?? key;

/**
 * The columns to show, in order, from what was saved (a JSON list of keys).
 * Unknown or repeated keys are dropped; a list that is missing, unreadable or
 * leaves nothing is the default, so the sheet is never empty. A column left out
 * of a saved list stays hidden: that is how the plant switches one off.
 */
export function parseClaimColumns(value: unknown): ClaimColumnKey[] {
    try {
        const raw = typeof value === "string" ? JSON.parse(value) : value;
        if (!Array.isArray(raw)) return [...DEFAULT_CLAIM_COLUMNS];
        const seen = new Set<string>();
        const keys: ClaimColumnKey[] = [];
        for (const k of raw) {
            const key = String(k);
            if (!KNOWN.has(key) || seen.has(key)) continue;
            seen.add(key);
            keys.push(key as ClaimColumnKey);
        }
        return keys.length ? keys : [...DEFAULT_CLAIM_COLUMNS];
    } catch {
        return [...DEFAULT_CLAIM_COLUMNS];
    }
}

/** Move the column at `index` one place up (-1) or down (+1); the list is returned unchanged at either end. */
export function moveColumn<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
    const to = index + by;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
    const next = [...list];
    [next[index], next[to]] = [next[to], next[index]];
    return next;
}
