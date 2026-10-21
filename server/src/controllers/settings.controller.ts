import { Request, Response } from 'express';
import pool from '../config/database.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { clearPurchaseDateWindowCache } from '../services/purchaseDateWindow.service.js';
import { clearRollCapacityCache } from '../services/ppfRoll.service.js';

export const getSetting = async (req: Request, res: Response) => {
    try {
        const { key } = req.params;
        const [rows] = await pool.query(
            'SELECT setting_value FROM system_settings WHERE setting_key = ?',
            [key]
        );

        if ((rows as any[]).length === 0) {
            return res.status(404).json({ success: false, message: 'Setting not found' });
        }

        res.json({ success: true, value: (rows as any[])[0].setting_value });
    } catch (error) {
        console.error('Error fetching setting:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

/**
 * The e-catalogue URLs are rendered as a link and an embedded frame on the
 * franchise dashboard, so a `javascript:` value would run script in every
 * franchise's session. Only http(s) — or empty, to clear it — is accepted.
 */
const validateSettingValue = (key: string, value: unknown): string | null => {
    if (typeof value !== 'string') return 'value must be a string';
    if (key.startsWith('ecatalogue_')) {
        const v = value.trim();
        if (v === '') return null;
        try {
            const u = new URL(v);
            if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'URL must start with http:// or https://';
        } catch {
            return 'Not a valid URL';
        }
    }
    if (key === 'purchase_date_window_days' && !/^\d{1,4}$/.test(value.trim())) {
        return 'Purchase date window must be a whole number of days';
    }
    // Same bounds getRollCapacitySqft() accepts — anything outside them is
    // silently replaced by the default there, so refuse it here instead.
    if (key === 'ppf_roll_capacity_sqft') {
        const n = Number(value.trim());
        if (value.trim() === '' || !Number.isFinite(n) || n <= 0 || n > 100_000) {
            return 'Roll capacity must be a number of square feet between 0 and 100,000';
        }
    }
    return null;
};

/** Each brand's e-catalogue settings: Autoform keeps the original keys. */
export const ECATALOGUE_KEYS = {
    AF: { flipbook: 'ecatalogue_flipbook_url', download: 'ecatalogue_download_url' },
    AC: { flipbook: 'ecatalogue_ac_flipbook_url', download: 'ecatalogue_ac_download_url' },
} as const;

/** The brands a franchise carries ('AF', 'AC', 'AFAC'; none set means AF). */
export const brandsOf = (allowed: unknown): ('AF' | 'AC')[] => {
    const b = String(allowed || 'AF').toUpperCase();
    const out: ('AF' | 'AC')[] = [];
    if (b.includes('AF')) out.push('AF');
    if (b.includes('AC')) out.push('AC');
    return out.length ? out : ['AF'];
};

/**
 * The e-catalogues this franchise may see: its own brand's, or both for
 * an AF + AC store. GET /api/settings/ecatalogue/mine
 */
export const getMyECatalogues = async (req: Request, res: Response) => {
    try {
        // @ts-ignore
        const userId = req.user?.id;
        const [vd]: any = await pool.query('SELECT allowed_brands FROM vendor_details WHERE user_id = ? LIMIT 1', [userId]);
        const brands = brandsOf(vd[0]?.allowed_brands);
        const keys = brands.flatMap(b => [ECATALOGUE_KEYS[b].flipbook, ECATALOGUE_KEYS[b].download]);
        const [rows]: any = await pool.query('SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?)', [keys]);
        const val = (k: string) => String(rows.find((r: any) => r.setting_key === k)?.setting_value ?? '').trim();
        res.json({
            success: true,
            data: brands.map(b => ({ brand: b, flipbook_url: val(ECATALOGUE_KEYS[b].flipbook), download_url: val(ECATALOGUE_KEYS[b].download) })),
        });
    } catch (error) {
        console.error('Error fetching e-catalogues:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

export const updateSetting = async (req: Request, res: Response) => {
    try {
        const { key } = req.params;
        const { value } = req.body;
        // @ts-ignore
        const user = req.user; // Assuming auth middleware attaches user

        const invalid = validateSettingValue(key, value);
        if (invalid) {
            return res.status(400).json({ success: false, message: invalid });
        }

        const [result] = await pool.query(
            `INSERT INTO system_settings (setting_key, setting_value, updated_by) 
       VALUES (?, ?, ?) 
       ON DUPLICATE KEY UPDATE setting_value = ?, updated_by = ?`,
            [key, value, user?.email || 'admin', value, user?.email || 'admin']
        );

        // Both are cached for 30s to keep submissions cheap; drop the cache here
        // so an admin's change applies to the very next registration.
        if (key === 'purchase_date_window_days') clearPurchaseDateWindowCache();
        if (key === 'ppf_roll_capacity_sqft') clearRollCapacityCache();

        res.json({ success: true, message: 'Setting updated successfully' });

        // Log activity if user is admin
        if (user) {
            // Fetch admin details if not fully populated in req.user (middleware dependent)
            // But assuming req.user has id, name, email from auth middleware
            await ActivityLogService.log({
                adminId: user.id,
                adminName: user.name,
                adminEmail: user.email,
                actionType: 'SYSTEM_SETTING_UPDATED',
                targetType: 'SYSTEM_SETTING',
                targetId: key,
                targetName: key,
                details: { newValue: value },
                ipAddress: req.ip || req.socket?.remoteAddress
            });
        }
    } catch (error) {
        console.error('Error updating setting:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
