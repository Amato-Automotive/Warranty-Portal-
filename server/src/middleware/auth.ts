import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import db from '../config/database.js';

dotenv.config();

export type ModulePermissions = Record<string, { read: boolean; write: boolean }>;

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    name: string;
    isSuperAdmin?: boolean;
    permissions?: ModulePermissions;
  };
}

const SESSION_ROLES = new Set(['admin', 'vendor', 'customer', 'asm']);

/**
 * A valid signature is not enough to be a session.
 *
 * JWT_SECRET also signs single-purpose action tokens — the invoice-download
 * link in the WhatsApp button (`{ purpose: 'invoice', orderId }`) and the
 * franchise verify/reject link in email (`{ warrantyId, vendorEmail }`). Those
 * links are handed to franchises and get forwarded, so presenting one as
 * `auth_token` used to produce a `req.user` with no id and no role. Every
 * handler that scopes by `role === 'customer'` / `role === 'vendor'` then
 * matched neither branch and applied no filter at all — an invoice link read
 * the whole warranty table.
 *
 * Session tokens now carry `typ: 'session'`. The id/role check is what makes
 * this safe *today*: action tokens have neither, so they are rejected before
 * the 30-day cookies issued without a `typ` have expired.
 */
export const isSessionToken = (decoded: any): boolean => {
  if (!decoded || typeof decoded !== 'object') return false;
  if (decoded.typ !== undefined && decoded.typ !== 'session') return false;
  return typeof decoded.id === 'string' && decoded.id.length > 0
    && typeof decoded.role === 'string' && SESSION_ROLES.has(decoded.role);
};

/**
 * A valid session token is not a live account either.
 *
 * A JWT is a snapshot taken at login, and vendor cookies last 30 days. Without
 * a look at the database, deactivating a store, un-verifying it, deleting an
 * admin or narrowing their permissions changed nothing until that snapshot
 * expired — the store kept ordering and approving warranties, and the admin
 * kept every module they had at login.
 *
 * So every authenticated request resolves the account's current state: the
 * role must still be held, a vendor must still be verified and active, and an
 * admin's permissions are read fresh rather than trusted from the token.
 * Cached per user for a minute so it costs one query per active user per
 * minute, not one per request; the admin screens that change these call
 * invalidateSessionState() so their effect is immediate on this process.
 */
export interface SessionState {
  active: boolean;
  isSuperAdmin?: boolean;
  permissions?: ModulePermissions;
}

const SESSION_STATE_TTL_MS = 60 * 1000;
const SESSION_STATE_CACHE_MAX = 5000;
const sessionStateCache = new Map<string, { state: SessionState; expires: number }>();

export const invalidateSessionState = (userId: string) => {
  sessionStateCache.delete(userId);
};

const isTruthyFlag = (v: any) => v === 1 || v === true || v === '1';

async function loadSessionState(userId: string, role: string): Promise<SessionState> {
  const [roles]: any = await db.execute(
    'SELECT 1 FROM user_roles WHERE user_id = ? AND role = ? LIMIT 1',
    [userId, role]
  );
  if (roles.length === 0) return { active: false };

  if (role === 'vendor') {
    const [rows]: any = await db.execute(
      'SELECT is_verified, is_active FROM vendor_verification WHERE user_id = ?',
      [userId]
    );
    const active = rows.length > 0 && isTruthyFlag(rows[0].is_verified) && isTruthyFlag(rows[0].is_active);
    return { active };
  }

  if (role === 'admin') {
    const [rows]: any = await db.execute(
      'SELECT is_super_admin, permissions FROM admin_permissions WHERE admin_id = ?',
      [userId]
    );
    // An admin with no permissions row is what login issues too: signed in,
    // no modules.
    if (rows.length === 0) return { active: true, isSuperAdmin: false, permissions: {} };
    const raw = rows[0].permissions;
    let permissions: ModulePermissions = {};
    try {
      permissions = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    } catch {
      permissions = {};
    }
    return { active: true, isSuperAdmin: isTruthyFlag(rows[0].is_super_admin), permissions };
  }

  // An ASM is live while the admin's ASM list says so. The asms row is the
  // record admins manage; the profile only exists so they can log in.
  if (role === 'asm') {
    const [rows]: any = await db.execute(
      'SELECT is_active FROM asms WHERE profile_id = ?',
      [userId]
    );
    return { active: rows.length > 0 && isTruthyFlag(rows[0].is_active) };
  }

  return { active: true };
}

export async function getSessionState(userId: string, role: string): Promise<SessionState> {
  const cached = sessionStateCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.state;

  const state = await loadSessionState(userId, role);
  if (sessionStateCache.size >= SESSION_STATE_CACHE_MAX) sessionStateCache.clear();
  sessionStateCache.set(userId, { state, expires: Date.now() + SESSION_STATE_TTL_MS });
  return state;
}

/**
 * ASM sessions are fenced off from the rest of the API.
 *
 * Most routes were written for three roles, and several gate on
 * requirePermission alone — which waves every non-admin through — or treat
 * "not admin, not vendor" as a customer. Rather than audit every one of them
 * for a fourth role, authenticateToken refuses an ASM outright. The few routes
 * an ASM needs (/auth/me, the ASM portal) use authenticateAnySession and then
 * requireRole('asm').
 */
const authenticate = (allowAsm: boolean) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  // SBP-006: Read token from HttpOnly cookie first, then fall back to Authorization header
  const cookieToken = req.cookies?.auth_token;
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1];
  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as any;
  } catch (error) {
    // Clear invalid cookie if present
    if (cookieToken) {
      res.clearCookie('auth_token', { path: '/' });
    }
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  if (!isSessionToken(decoded)) {
    if (cookieToken) {
      res.clearCookie('auth_token', { path: '/' });
    }
    return res.status(401).json({ error: 'Access token required' });
  }

  let state: SessionState;
  try {
    state = await getSessionState(decoded.id, decoded.role);
  } catch (error) {
    // The account could not be checked, which is not the same as the account
    // being gone — keep the cookie and let the client retry.
    console.error('[auth] Session state lookup failed:', error);
    return res.status(503).json({ error: 'Service temporarily unavailable. Please retry.' });
  }

  if (!state.active) {
    if (cookieToken) {
      res.clearCookie('auth_token', { path: '/' });
    }
    return res.status(401).json({ error: 'This account is no longer active.', code: 'ACCOUNT_INACTIVE' });
  }

  if (decoded.role === 'asm' && !allowAsm) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  req.user = decoded.role === 'admin'
    ? { ...decoded, isSuperAdmin: state.isSuperAdmin, permissions: state.permissions }
    : decoded;
  next();
};

export const authenticateToken = authenticate(false);
export const authenticateAnySession = authenticate(true);

export const requireRole = (roles: string | string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

/**
 * requirePermission — granular RBAC middleware.
 * Super Admin bypasses all checks.
 * Non-admin roles (vendor, customer) are skipped — they are controlled by requireRole.
 * Regular admins must have the specified action (read/write) for the module.
 * The 'admins' module is Super Admin only.
 */
export const requirePermission = (module: string, action: 'read' | 'write') => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Non-admin roles (vendor, customer) are not subject to module permissions
    if (user.role !== 'admin') {
      return next();
    }

    // Super admin has unrestricted access
    if (user.isSuperAdmin) {
      return next();
    }

    // 'admins' module is Super Admin only
    if (module === 'admins') {
      return res.status(403).json({ error: 'Super Admin access required' });
    }

    const perm = user.permissions?.[module];
    if (!perm || !perm[action]) {
      return res.status(403).json({
        error: `You do not have ${action === 'write' ? 'edit' : action} access to this module`
      });
    }

    next();
  };
};

/**
 * Permit an admin who has access to any one of the listed modules. This keeps
 * shared supporting APIs usable without granting an unrelated parent module.
 */
export const requireAnyPermission = (modules: string[], action: 'read' | 'write') => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (user.role !== 'admin' || user.isSuperAdmin) {
      return next();
    }

    if (modules.some(module => user.permissions?.[module]?.[action])) {
      return next();
    }

    return res.status(403).json({
      error: `You do not have ${action === 'write' ? 'edit' : action} access to this module`
    });
  };
};
