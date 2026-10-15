import { Request, Response, NextFunction } from 'express';
import db from '../config/database.js';
import { getIO } from '../socket.js';

/**
 * The numbers on the admin sidebar: how much work is waiting that nobody has
 * picked up yet.
 *
 * These are counts of state, not of unread notifications. A notification is
 * per admin and goes quiet once read, even if nobody acted on it; a grievance
 * still `submitted` or a POSM request still `open` is waiting whoever looks,
 * and stops counting the moment someone moves it on.
 */
export interface AttentionCounts {
    grievances?: number;
    posm?: number;
    franchises?: number;
    manpower?: number;
    /** ASM expense claims waiting for a decision. */
    asmExpenses?: number;
}

type Perms = Record<string, { read: boolean; write: boolean }> | undefined;

const canRead = (user: { isSuperAdmin?: boolean; permissions?: Perms }, module: string) =>
    !!user.isSuperAdmin || !!user.permissions?.[module]?.read;

/** Counts for the modules this admin can open; anything else is left out. */
export async function getAttentionCounts(user: { isSuperAdmin?: boolean; permissions?: Perms }): Promise<AttentionCounts> {
    const counts: AttentionCounts = {};

    if (canRead(user, 'grievances')) {
        const [rows]: any = await db.execute(
            "SELECT COUNT(*) AS n FROM grievances WHERE status = 'submitted'"
        );
        counts.grievances = Number(rows[0]?.n || 0);
    }

    if (canRead(user, 'posm')) {
        // Only requests nobody has touched since submission. Once an admin
        // moves one on — Pending included — it is being handled and drops out.
        const [rows]: any = await db.execute(
            "SELECT COUNT(*) AS n FROM posm_requests WHERE status = 'open'"
        );
        counts.posm = Number(rows[0]?.n || 0);
    }

    // Both screens sit under the `vendors` permission.
    if (canRead(user, 'vendors')) {
        // The Franchises screen's "Pending" tab: never reviewed. A rejection
        // stamps verified_at, so rejected stores don't count.
        // Same shape as getAllVendors (vendor-role profiles, verification
        // LEFT JOINed), so an account missing its verification row still
        // counts, exactly as the screen lists it under Pending.
        const [f]: any = await db.execute(
            `SELECT COUNT(*) AS n
             FROM profiles p
             JOIN user_roles ur ON ur.user_id = p.id AND ur.role = 'vendor'
             LEFT JOIN vendor_verification vv ON vv.user_id = p.id
             WHERE COALESCE(vv.is_verified, 0) = 0 AND vv.verified_at IS NULL`
        );
        counts.franchises = Number(f[0]?.n || 0);

        // The Manpower screen's "Pending" tab (active, not yet approved — a
        // restore lands here too) plus its "Removal Requests" tab.
        //
        // Joined exactly as getAllManpower is, verified stores only: that
        // screen hides a rejected store's staff, and a pending store's staff
        // appear there only once the store is approved (until then the store
        // itself is in the franchises count). Without this join the badge
        // read 8 while the screen showed 3.
        const [m]: any = await db.execute(
            `SELECT COUNT(*) AS n
             FROM manpower m
             JOIN vendor_details vd ON vd.id = m.vendor_id
             JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1
             WHERE (m.is_active = 1 AND m.is_approved = 0)
                OR (m.request_status = 'pending' AND m.request_type = 'remove')`
        );
        counts.manpower = Number(m[0]?.n || 0);
    }

    if (canRead(user, 'asm_expenses')) {
        try {
            const [rows]: any = await db.execute(
                "SELECT COUNT(*) AS n FROM asm_expense_claims WHERE status = 'submitted'"
            );
            counts.asmExpenses = Number(rows[0]?.n || 0);
        } catch {
            // Table not created yet (first boot of this release) — no badge.
        }
    }

    return counts;
}

/**
 * Tell every connected admin the counts may have changed. The event carries no
 * numbers — each admin re-fetches, so an admin without POSM access never
 * receives the POSM figure.
 */
export function signalAdminAttention(): void {
    try {
        getIO().to('role_admin').emit('admin:attention');
    } catch {
        // Socket.io not initialised (scripts, tests). The sidebar also polls.
    }
}

/**
 * Route middleware: signal once the handler has answered with success. Put it
 * on any route that creates a grievance / POSM request or can change its
 * status, rather than threading a call through each controller's branches.
 */
export const signalAdminAttentionOnSuccess = (_req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) signalAdminAttention();
    });
    next();
};
