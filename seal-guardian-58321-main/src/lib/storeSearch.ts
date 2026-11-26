/**
 * Finding a store by what someone types, forgiving spelling: store names in
 * the portal are not always spelled the way an invoice or a person spells them
 * ("GAYTRI" for Gayatri, "PITHOUSE" for Pit House). Besides plain "contains",
 * a store matches when its name without vowels, spaces and punctuation
 * contains the typed text reduced the same way.
 */

/* No vowels, no doubled letters: "Gayatri" and "GAYTRI" are both "gytr", "Himmatnagar" and "HIMATNAGAR" both "hmtngr". */
const skeleton = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/[aeiou]/g, "").replace(/(.)\1+/g, "$1");
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether any of `fields` matches `typed`. Empty `typed` matches everything. */
export function storeMatches(typed: string, fields: (string | null | undefined)[]): boolean {
    const term = typed.trim().toLowerCase();
    if (!term) return true;
    const values = fields.filter(Boolean).map(v => String(v));
    if (values.some(v => v.toLowerCase().includes(term))) return true;
    const c = compact(term);
    if (c.length >= 3 && values.some(v => compact(v).includes(c))) return true;
    /* Every word, spelled loosely, somewhere in the store's details. */
    const words = term.split(/\s+/).map(skeleton).filter(w => w.length >= 2);
    if (!words.length) return false;
    const hay = values.map(skeleton).join(" ");
    return words.every(w => hay.includes(w));
}
