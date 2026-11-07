import { matchInvoiceDetailed, type ReaderProduct } from "./invoiceReader";
import { seriesOfProduct } from "./productSeries";

/**
 * Option 2 (Buy More Get More): what the invoice reader found, as sets of each
 * kind. Only Velora, Doble, Signature and Emporio matter to the premium mix;
 * every other seat cover counts towards "any 12". Pure, so it is tested directly.
 */

export const SET_KINDS = ["velora", "doble", "signature", "emporio", "other"] as const;
export type SetKind = (typeof SET_KINDS)[number];
export type Sets = Record<SetKind, number>;
export const noSets = (): Sets => ({ velora: 0, doble: 0, signature: 0, emporio: 0, other: 0 });

/** Which kind a product is: the team's series list first, else the premium word named last ("Signature Swed Doble" is Doble), else other. */
export function kindOf(name: string): SetKind {
    const given = seriesOfProduct(name);
    if (given !== undefined) return (SET_KINDS as readonly string[]).includes(given) && given !== "other" ? (given as SetKind) : "other";
    const n = String(name ?? "").toLowerCase();
    let kind: SetKind = "other", at = -1;
    for (const k of ["velora", "doble", "signature", "emporio"] as const) {
        const i = n.lastIndexOf(k);
        if (i > at) { at = i; kind = k; }
    }
    return kind;
}

export interface ReadSets { sets: Sets; check: SetKind[]; from: string[]; /* goods-table rows that could not be counted */ missed: string[] }

/** The sets on an invoice's text. `names` are the seat cover products to look for. */
export function readSets(text: string, names: string[]): ReadSets {
    const all = [...new Set(["Velora", "Doble", "Signature", "Emporio", "Amaze", "Sportz", ...names].map(n => n.trim()).filter(Boolean))];
    const products: ReaderProduct[] = all.map(name => ({ id: name, name, points: 0 }));
    const sets = noSets();
    const check = new Set<SetKind>();
    const from: string[] = [];
    const found = matchInvoiceDetailed(text, products, true);
    for (const line of found.lines) {
        const kind = line.word ? (line.word as SetKind) : kindOf(line.product_id);
        sets[kind] += line.qty;
        if (line.confidence === "check") check.add(kind);
        from.push(line.from);
    }
    return { sets, check: [...check], from, missed: found.missed };
}
