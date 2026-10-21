import { Router } from 'express';
import { VendorController } from '../controllers/vendor.controller.js';

import { authenticateToken, requireRole } from '../middleware/auth.js';
import { recordActivity } from '../services/portalActivity.service.js';
import { signalAdminAttentionOnSuccess as signalAttention } from '../services/adminAttention.service.js';

const router = Router();

router.get('/verify', signalAttention, VendorController.verifyVendor);

// Warranty actions
router.post('/warranty/:uid/approve', authenticateToken, requireRole(['vendor']), VendorController.approveWarranty);
router.post('/warranty/:uid/reject', authenticateToken, requireRole(['vendor']), VendorController.rejectWarranty);

// Vendor profile route
router.get('/profile', authenticateToken, requireRole(['vendor']), VendorController.getProfile);

// The portal reporting what is open and in use, for the admin's Activity screens.
// Never fails the portal: a write that does not happen just leaves a gap.
router.post('/activity', authenticateToken, requireRole(['vendor']), async (req: any, res) => {
    try { await recordActivity(String(req.user?.id ?? ''), String(req.body?.kind ?? ''), req.body?.module); }
    catch (e: any) { console.error('[Activity] not recorded:', e?.message); }
    res.status(204).end();
});

// The store's own audit submissions — what it answered, and whether one is
// currently being asked for. Vendor role only; scoped by session.
router.get('/audits', authenticateToken, requireRole(['vendor']), VendorController.getOwnAudits);

// The store's own leads and the auditor's status on each. Vendor role only;
// scoped by session, read-only.
router.get('/leads', authenticateToken, requireRole(['vendor']), VendorController.getOwnLeads);

// Manpower management routes
router.get('/manpower', authenticateToken, requireRole(['vendor', 'admin']), VendorController.getManpower);
router.get('/manpower/:manpowerId/warranties', authenticateToken, requireRole(['vendor', 'admin']), VendorController.getManpowerWarranties);
router.post('/manpower', authenticateToken, requireRole(['vendor', 'admin']), signalAttention, VendorController.addManpower);
router.put('/manpower/:id', authenticateToken, requireRole(['vendor', 'admin']), signalAttention, VendorController.updateManpower);
router.delete('/manpower/:id', authenticateToken, requireRole(['vendor', 'admin']), signalAttention, VendorController.removeManpower);
router.put('/manpower/:id/restore', authenticateToken, requireRole(['vendor', 'admin']), signalAttention, VendorController.restoreManpower);

export default router;