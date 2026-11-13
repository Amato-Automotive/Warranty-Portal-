/**
 * Seven admin screens used to share another screen's permission. Each now has
 * its own switch in Admin Access. An admin who could open the shared screen
 * keeps the same access to the new one, so nobody loses a screen on the day
 * this ships; Super Admin can then narrow it per admin.
 */

export type Perm = { read: boolean; write: boolean };
export type Perms = Record<string, Perm>;

/** New key -> the keys whose access it starts from (any one of them being on is enough). */
export const SCREEN_PERMISSION_PARENTS: Record<string, string[]> = {
    portal_activity: ['vendors'],
    manpower: ['vendors'],
    whatsapp_settings: ['announcements'],
    store_ratings: ['feedback'],
    franchise_forms: ['feedback'],
    ppf_rolls: ['warranties'],
    sourcing_map: ['distributors', 'order_management'],
};

/** The permissions with every missing new key filled in from its parents. `changed` is false when nothing was missing. */
export function withScreenPermissions(perms: Perms): { perms: Perms; changed: boolean } {
    const out: Perms = { ...perms };
    let changed = false;
    for (const [key, parents] of Object.entries(SCREEN_PERMISSION_PARENTS)) {
        if (out[key]) continue;
        out[key] = {
            read: parents.some(p => perms[p]?.read === true),
            write: parents.some(p => perms[p]?.write === true),
        };
        changed = true;
    }
    return { perms: out, changed };
}
