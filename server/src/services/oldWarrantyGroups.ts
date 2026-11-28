/**
 * Old (pre-portal) warranties come in groups: every row written with the same
 * store name and store email in the old portal. A group is placed on one
 * portal store (its rows get that store_id), marked as having no store in the
 * portal, or left open. Placing or moving a group moves all its rows.
 */

/** The rows of a group: the name as written, and the email (no email = blank or missing). */
export const GROUP_MATCH = `TRIM(store_name) <=> ? AND (LOWER(TRIM(store_email)) <=> ? OR (? IS NULL AND (store_email IS NULL OR TRIM(store_email) = '')))`;
export const groupArgs = (g: { store_name: string | null; store_email: string | null }) =>
    [g.store_name, g.store_email ? g.store_email.toLowerCase() : null, g.store_email || null];

export type GroupState = 'placed' | 'no_store' | 'open';

/** "Apr 2023 – Mar 2026" from YYYY-MM keys. */
export function periodText(first: string | null, last: string | null): string {
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mon = (k: string | null) => (k && /^\d{4}-\d{2}/.test(k) ? `${M.at(Number(k.slice(5, 7)) - 1)} ${k.slice(0, 4)}` : '');
    if (!first && !last) return '';
    return first === last || !last ? mon(first) : `${mon(first)} – ${mon(last)}`;
}
