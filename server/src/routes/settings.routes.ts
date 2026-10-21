import express from 'express';
import { getMyECatalogues, getSetting, updateSetting } from '../controllers/settings.controller.js';
import { authenticateToken, requireAnyPermission, requirePermission, requireRole } from '../middleware/auth.js';

const router = express.Router();

/*
 * The keys this router may read or write, and who may write each.
 *
 * `system_settings` also holds operational config — the WhatsApp notification
 * toggles, the rejection-reminder schedule — which have their own permissioned
 * admin endpoints. This router used to take any key: GET returned any row to
 * anyone, and PUT fell through to "terms or content_manager write" for keys it
 * did not recognise, so an admin with only Terms access could switch the paid
 * reminder scheduler on. Unknown keys now 404 in both directions.
 *
 * Adding a new public setting means adding it here.
 */
const SETTING_WRITERS: Record<string, express.RequestHandler> = {
    // Legacy Terms page and Form Content both edit the seat-cover terms.
    terms_conditions: requireAnyPermission(['terms', 'content_manager'], 'write'),

    // Form Content owns form-specific terms/disclaimers/claim process.
    seat_cover_disclaimer: requirePermission('content_manager', 'write'),
    seat_cover_claim_process: requirePermission('content_manager', 'write'),
    ppf_terms_conditions: requirePermission('content_manager', 'write'),
    ppf_disclaimer: requirePermission('content_manager', 'write'),
    ppf_claim_process: requirePermission('content_manager', 'write'),

    // How far back a customer may date a purchase on the QR flow, and how much
    // film a PPF roll holds. Both govern what the warranty form accepts, so
    // they sit with the form content.
    purchase_date_window_days: requireAnyPermission(['content_manager', 'warranties'], 'write'),
    ppf_roll_capacity_sqft: requireAnyPermission(['content_manager', 'warranties'], 'write'),

    ecatalogue_flipbook_url: requirePermission('ecatalogue', 'write'),
    ecatalogue_download_url: requirePermission('ecatalogue', 'write'),
    ecatalogue_ac_flipbook_url: requirePermission('ecatalogue', 'write'),
    ecatalogue_ac_download_url: requirePermission('ecatalogue', 'write'),
};

const isPublicSettingKey = (key: string) =>
    Object.prototype.hasOwnProperty.call(SETTING_WRITERS, key);

const requireKnownSetting: express.RequestHandler = (req, res, next) => {
    if (!isPublicSettingKey(req.params.key)) {
        return res.status(404).json({ success: false, message: 'Setting not found' });
    }
    next();
};

const requireSettingPermission: express.RequestHandler = (req, res, next) =>
    SETTING_WRITERS[req.params.key](req, res, next);

// The signed-in franchise's own e-catalogues, by its brand.
router.get('/ecatalogue/mine', authenticateToken, getMyECatalogues);

// Public route to get settings (like terms)
router.get('/public/:key', requireKnownSetting, getSetting);

router.put('/admin/:key', authenticateToken, requireRole('admin'), requireKnownSetting, requireSettingPermission, updateSetting);

export default router;
