import { v4 as uuidv4 } from 'uuid';

/**
 * The login account behind an ASM.
 *
 * An ASM is managed as a row in `asms` — that is what lead routing reads and
 * what admins edit. Logging in needs a real account as well: a `profiles` row
 * with the `asm` role, linked from `asms.profile_id`. This keeps the two in
 * step, so the ASM screen stays the only place an admin touches.
 *
 * profiles holds one account per mobile number and per email, system-wide. An
 * ASM whose number already belongs to a franchise, customer or admin cannot
 * also have an ASM login, and is told so rather than quietly sharing one.
 */

type Conn = { execute: (sql: string, params?: any[]) => Promise<any> };

/** A 10-digit Indian mobile from whatever was typed, or null. */
export const normalizeAsmMobile = (raw: unknown): string | null => {
    let d = String(raw ?? '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return /^[6-9]\d{9}$/.test(d) ? d : null;
};

export const normalizeAsmEmail = (raw: unknown): string | null => {
    const e = String(raw ?? '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
};

/**
 * A person's name as they would write it, or null: 2–60 characters of
 * letters (any script), spaces, dots, apostrophes and hyphens, with runs of
 * spaces collapsed. Case is kept — the point is to let them fix the spelling.
 */
export const cleanAsmName = (raw: unknown): string | null => {
    const n = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
    if (n.length < 2 || n.length > 60) return null;
    return /^\p{L}[\p{L}\p{M} .'-]*$/u.test(n) ? n : null;
};

/** Refused with a message meant for the admin. */
export class AsmAccountError extends Error {}

const HOLDER: Record<string, string> = {
    vendor: 'a franchise',
    customer: 'a customer',
    admin: 'an admin',
    asm: 'another ASM',
};

async function assertNoClash(conn: Conn, phone: string, email: string, exceptProfileId: string | null) {
    const [rows]: any = await conn.execute(
        `SELECT p.phone_number, ur.role
           FROM profiles p
           LEFT JOIN user_roles ur ON ur.user_id = p.id
          WHERE (p.phone_number = ? OR p.email = ?) AND p.id <> ?
          LIMIT 1`,
        [phone, email, exceptProfileId ?? '']
    );
    if (!rows.length) return;
    const what = rows[0].phone_number === phone ? 'WhatsApp number' : 'email';
    const who = HOLDER[rows[0].role] ?? 'another';
    throw new AsmAccountError(
        `That ${what} already belongs to ${who} account on the portal. An ASM needs a number and email of their own to log in.`
    );
}

/**
 * Create the ASM's login account, or bring an existing one in line with the
 * ASM's current name, number and email. Run inside the caller's transaction.
 * Returns the profile id.
 */
export async function syncAsmAccount(
    conn: Conn,
    asm: { id: string; name: string; phone: string; email: string; profileId: string | null }
): Promise<string> {
    await assertNoClash(conn, asm.phone, asm.email, asm.profileId);

    if (asm.profileId) {
        const [result]: any = await conn.execute(
            'UPDATE profiles SET name = ?, email = ?, phone_number = ? WHERE id = ?',
            [asm.name, asm.email, asm.phone, asm.profileId]
        );
        // affectedRows counts matched rows, changed or not; 0 means the account
        // was deleted out from under the ASM — make them a new one below.
        if (result.affectedRows > 0) return asm.profileId;
    }

    const profileId = uuidv4();
    await conn.execute(
        'INSERT INTO profiles (id, name, email, phone_number) VALUES (?, ?, ?, ?)',
        [profileId, asm.name, asm.email, asm.phone]
    );
    await conn.execute(
        "INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, 'asm')",
        [uuidv4(), profileId]
    );
    await conn.execute('UPDATE asms SET profile_id = ? WHERE id = ?', [profileId, asm.id]);
    return profileId;
}
