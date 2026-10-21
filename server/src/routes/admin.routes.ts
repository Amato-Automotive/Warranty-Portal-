import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller.js';
import { DiagnosticController } from '../controllers/diagnostic.controller.js';
import { ProductController } from '../controllers/product.controller.js';
import { ImageRepairController } from '../controllers/imageRepair.controller.js';
import { authenticateToken, requireRole, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import { warrantyUpload, attachPublicUrls } from '../config/localUpload.js';
import { signalAdminAttentionOnSuccess as signalAttention } from '../services/adminAttention.service.js';
import type { Request, Response, NextFunction } from 'express';
import { activityOverview, storeActivity, trackingSince } from '../services/portalActivity.service.js';

const router = Router();
const adminAuth = [authenticateToken, requireRole('admin')];

/**
 * Single-image upload for admin photo replacement.
 *
 * Mirrors the warranty routes' wrapper: without it multer's LIMIT_FILE_SIZE
 * surfaces as an unhandled 500 and the client just goes blank.
 */
const handleAdminImageUpload = (req: Request, res: Response, next: NextFunction) => {
    warrantyUpload.any()(req, res, (err: any) => {
        if (err) {
            console.error('[Admin Image Upload] Multer error:', err.code || err.message);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({
                    success: false,
                    error: 'File too large. Maximum allowed size is 5 MB. Please compress the image and try again.'
                });
            }
            return res.status(400).json({ success: false, error: err.message || 'File upload failed' });
        }
        attachPublicUrls(req, res, next);
    });
};

// Dashboard
router.get('/stats', ...adminAuth, requirePermission('overview', 'read'), AdminController.getDashboardStats);

// Vendors (Franchises)
router.get('/vendors', ...adminAuth, requirePermission('vendors', 'read'), AdminController.getAllVendors);
router.get('/vendor-asm-options', ...adminAuth, requireAnyPermission(['vendors', 'distributors'], 'read'), AdminController.getVendorAsmOptions);
router.get('/vendors/:id', ...adminAuth, requirePermission('vendors', 'read'), AdminController.getVendorDetails);

// Franchise & distributor activity: time in the portal and what they did.
router.get('/activity', ...adminAuth, requirePermission('vendors', 'read'), async (req: Request, res: Response) => {
    try {
        const [data, since] = await Promise.all([
            activityOverview({ days: req.query.days, from: req.query.from, to: req.query.to, role: String(req.query.role ?? 'all') }), trackingSince(),
        ]);
        res.json({ success: true, ...data, tracking_since: since });
    } catch (e: any) {
        console.error('[Activity] overview failed:', e?.message);
        res.status(500).json({ error: 'Could not load activity' });
    }
});
router.get('/activity/:vendorId', ...adminAuth, requirePermission('vendors', 'read'), async (req: Request, res: Response) => {
    try {
        const [data, since] = await Promise.all([storeActivity(String(req.params.vendorId), { days: req.query.days, from: req.query.from, to: req.query.to }), trackingSince()]);
        if (!data) return res.status(404).json({ error: 'Store not found' });
        res.json({ success: true, ...data, tracking_since: since });
    } catch (e: any) {
        console.error('[Activity] store failed:', e?.message);
        res.status(500).json({ error: 'Could not load activity' });
    }
});
router.put('/vendors/:id/verification', ...adminAuth, requirePermission('vendors', 'write'), signalAttention, AdminController.updateVendorVerification);
router.put('/vendors/:id/activation', ...adminAuth, requirePermission('vendors', 'write'), AdminController.toggleVendorActivation);
router.put('/vendors/:id/profile', ...adminAuth, requirePermission('vendors', 'write'), AdminController.updateVendorProfile);
router.put('/vendors/:id/coordinates', ...adminAuth, requirePermission('vendors', 'write'), AdminController.updateVendorCoordinates);
router.put('/vendors/:id/store-code', ...adminAuth, requirePermission('vendors', 'write'), AdminController.updateStoreCode);
router.put('/vendors/:id/asm', ...adminAuth, requirePermission('vendors', 'write'), AdminController.updateVendorAsm);
router.put('/vendors/:id/allowed-brands', ...adminAuth, requirePermission('vendors', 'write'), AdminController.updateVendorAllowedBrands);
router.put('/vendors/:id/distributor-status', ...adminAuth, requirePermission('vendors', 'write'), AdminController.updateVendorDistributorStatus);
router.delete('/vendors/:id', ...adminAuth, requirePermission('vendors', 'write'), signalAttention, AdminController.deleteVendor);

// Manpower
router.get('/manpower', ...adminAuth, requirePermission('vendors', 'read'), AdminController.getAllManpower);
router.put('/manpower/:id/approval', ...adminAuth, requirePermission('vendors', 'write'), signalAttention, AdminController.updateManpowerApproval);
router.put('/manpower/:id/removal-review', ...adminAuth, requirePermission('vendors', 'write'), signalAttention, AdminController.reviewManpowerRemoval);
router.delete('/manpower/:id', ...adminAuth, requirePermission('vendors', 'write'), signalAttention, AdminController.deleteManpower);

// WhatsApp notification toggles
router.get('/notification-settings', ...adminAuth, requirePermission('announcements', 'read'), AdminController.getNotificationSettings);
router.put('/notification-settings', ...adminAuth, requirePermission('announcements', 'write'), AdminController.updateNotificationSettings);
router.put('/notification-settings/:key/window', ...adminAuth, requirePermission('announcements', 'write'), AdminController.updateNotificationWindow);

// Warranty rejection reminders. Gated on 'warranties' write rather than
// 'announcements': starting the catch-up messages customers about their own
// warranties, which is warranty work, not a broadcast.
router.get('/warranty-reminders', ...adminAuth, requirePermission('warranties', 'read'), AdminController.getWarrantyReminderSettings);
router.put('/warranty-reminders', ...adminAuth, requirePermission('warranties', 'write'), AdminController.updateWarrantyReminderSettings);
router.post('/warranty-reminders/run-initial', ...adminAuth, requirePermission('warranties', 'write'), AdminController.runInitialWarrantyReminders);
router.get('/warranty-reminders/progress', ...adminAuth, requirePermission('warranties', 'read'), AdminController.getWarrantyReminderProgress);
router.post('/warranty-reminders/test', ...adminAuth, requirePermission('warranties', 'write'), AdminController.testWarrantyReminder);
router.post('/warranty-reminders/abort', ...adminAuth, requirePermission('warranties', 'write'), AdminController.abortWarrantyReminders);

// Distributors
router.get('/distributors', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'read'), AdminController.getAllDistributors);
router.post('/distributors', ...adminAuth, requirePermission('distributors', 'write'), AdminController.createDistributor);
router.get('/distributors/:id/franchises', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'read'), AdminController.getDistributorFranchises);
router.post('/distributors/:id/franchise-assignments', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'write'), AdminController.mapFranchiseToDistributor);
router.delete('/distributors/:id/franchise-assignments/:vendorId', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'write'), AdminController.unmapFranchiseFromDistributor);
router.get('/distributors/:id/categories', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'read'), AdminController.getDistributorAllowedCategories);
router.put('/distributors/:id/categories', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'write'), AdminController.setDistributorAllowedCategories);

// Franchise sourcing
router.get('/franchises/distributor-map', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'read'), AdminController.getFranchiseDistributorMap);
router.get('/franchises/eligible', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'read'), AdminController.getEligibleFranchises);
router.get('/franchises/:vendorId/orders', ...adminAuth, requireAnyPermission(['vendors', 'order_management'], 'read'), AdminController.getFranchiseOrders);
router.get('/franchises/:vendorId/announcements', ...adminAuth, requirePermission('announcements', 'read'), AdminController.getFranchiseAnnouncements);
router.get('/franchises/:vendorId/distributors', ...adminAuth, requirePermission('distributors', 'read'), AdminController.getFranchiseDistributors);
router.get('/franchises/:vendorId/distributors/:distributorId/categories', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'read'), AdminController.getFranchiseDistributorCategories);
router.put('/franchises/:vendorId/distributors/:distributorId/categories', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'write'), AdminController.setFranchiseDistributorCategories);
router.post('/distributors/:id/franchises', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'write'), AdminController.assignDistributorToFranchise);
router.delete('/distributors/:id/franchises/:vendorId', ...adminAuth, requireAnyPermission(['distributors', 'order_management'], 'write'), AdminController.unassignDistributorFromFranchise);

// Store audits (WhatsApp Flow responses)
router.get('/audits', ...adminAuth, requirePermission('audits', 'read'), AdminController.getStoreAudits);
router.post('/audits/call', ...adminAuth, requirePermission('audits', 'write'), AdminController.createCallAudit);
router.put('/audits/:id/review', ...adminAuth, requirePermission('audits', 'write'), AdminController.updateStoreAuditReview);
router.put('/audits/:id/assign', ...adminAuth, requirePermission('audits', 'write'), AdminController.assignStoreAudit);
// Audit rounds — audits repeat, so submissions are grouped and non-responders tracked.
// The admin's own store list, so an audit from a number the portal does not
// hold is still named rather than showing as unmatched.
router.get('/audit-contacts', ...adminAuth, requirePermission('audits', 'read'), AdminController.getAuditContacts);
router.post('/audit-contacts/preview', ...adminAuth, requirePermission('audits', 'write'), AdminController.previewAuditContacts);
router.post('/audit-contacts', ...adminAuth, requirePermission('audits', 'write'), AdminController.uploadAuditContacts);
router.get('/audit-rounds', ...adminAuth, requirePermission('audits', 'read'), AdminController.getAuditRounds);
// The month view: audits repeat within a month, so compliance is counted per
// store per month rather than per campaign.
router.get('/audit-months', ...adminAuth, requirePermission('audits', 'read'), AdminController.getAuditMonths);
router.get('/audit-months/:month', ...adminAuth, requirePermission('audits', 'read'), AdminController.getAuditMonth);
router.patch('/audit-rounds/:id/counted', ...adminAuth, requirePermission('audits', 'write'), AdminController.setRoundCounted);
router.post('/audit-rounds/:id/seed', ...adminAuth, requirePermission('audits', 'write'), AdminController.seedAuditRoundTargets);
router.put('/audit-rounds/:id/close', ...adminAuth, requirePermission('audits', 'write'), AdminController.closeAuditRound);
router.delete('/audit-rounds/:id', ...adminAuth, requirePermission('audits', 'write'), AdminController.deleteAuditRound);
router.delete('/audits/:id', ...adminAuth, requirePermission('audits', 'write'), AdminController.deleteStoreAudit);
router.get('/audit-rounds/:id/targets', ...adminAuth, requirePermission('audits', 'read'), AdminController.getAuditRoundTargets);

// Warranties
router.get('/warranties', ...adminAuth, requirePermission('warranties', 'read'), AdminController.getAllWarranties);
router.get('/warranties/resubmissions', ...adminAuth, requirePermission('warranties', 'read'), AdminController.getResubmissions);
// Where a PPF roll's film went. Declared above /warranties/:id, which would
// otherwise match "ppf-rolls" and look the roll up as a warranty id.
router.get('/warranties/ppf-rolls', ...adminAuth, requirePermission('warranties', 'read'), AdminController.getPPFRolls);
router.get('/warranties/ppf-rolls/:serial', ...adminAuth, requirePermission('warranties', 'read'), AdminController.getPPFRollDetail);
// Issue serial numbers to a store ahead of the rolls being fitted.
router.get('/warranties/ppf-serials/stores', ...adminAuth, requirePermission('warranties', 'read'), AdminController.getStoresForSerials);
router.post('/warranties/ppf-serials/generate', ...adminAuth, requirePermission('warranties', 'write'), AdminController.generatePPFSerials);
// The rolls one warranty drew on, for the reviewer approving it.
router.get('/warranties/:uid/roll-context', ...adminAuth, requirePermission('warranties', 'read'), AdminController.getWarrantyRollContext);
router.post('/warranties/resubmissions/:id/approve', ...adminAuth, requirePermission('warranties', 'write'), AdminController.approveResubmission);
router.post('/warranties/resubmissions/:id/reject', ...adminAuth, requirePermission('warranties', 'write'), AdminController.rejectResubmission);
// The rejection-and-fix chain for one warranty. Declared above /warranties/:id
// for the same reason as roll-context: :id would otherwise swallow it.
router.get('/warranties/:uid/history', ...adminAuth, requirePermission('warranties', 'read'), AdminController.getWarrantyHistory);
// Internal admin-only remarks. Never exposed on a customer or vendor route.
router.get('/warranties/:uid/remarks', ...adminAuth, requirePermission('warranties', 'read'), AdminController.getWarrantyRemarks);
router.post('/warranties/:uid/remarks', ...adminAuth, requirePermission('warranties', 'write'), AdminController.addWarrantyRemark);
router.delete('/warranties/:uid/remarks/:remarkId', ...adminAuth, requirePermission('warranties', 'write'), AdminController.deleteWarrantyRemark);
router.get('/warranties/:id', ...adminAuth, requirePermission('warranties', 'read'), AdminController.getWarrantyById);
router.put('/warranties/:uid/status', ...adminAuth, requirePermission('warranties', 'write'), AdminController.updateWarrantyStatus);
router.put('/warranties/:uid/details', ...adminAuth, requirePermission('warranties', 'write'), AdminController.updateWarrantyDetails);
// Swap one photo or the invoice without resubmitting the whole form.
router.put('/warranties/:uid/photo', ...adminAuth, requirePermission('warranties', 'write'), handleAdminImageUpload, AdminController.replaceWarrantyPhoto);

// Customers
router.get('/customers', ...adminAuth, requirePermission('customers', 'read'), AdminController.getCustomers);
router.get('/customers/mobile-limits/:phone', ...adminAuth, requirePermission('customers', 'read'), AdminController.getCustomerMobileLimit);
router.put('/customers/mobile-limits/:phone', ...adminAuth, requirePermission('customers', 'write'), AdminController.updateCustomerMobileLimit);
router.get('/customers/:email', ...adminAuth, requirePermission('customers', 'read'), AdminController.getCustomerDetails);
router.delete('/customers/:email', ...adminAuth, requirePermission('customers', 'write'), AdminController.deleteCustomer);

// Product management
router.post('/products', ...adminAuth, requirePermission('products', 'write'), ProductController.addProduct);
router.put('/products/:id', ...adminAuth, requirePermission('products', 'write'), ProductController.updateProduct);
router.delete('/products/:id', ...adminAuth, requirePermission('products', 'write'), ProductController.deleteProduct);

// Admin management
router.get('/admins', ...adminAuth, requirePermission('admins', 'read'), AdminController.getAllAdmins);
router.post('/admins', ...adminAuth, requirePermission('admins', 'write'), AdminController.createAdmin);
router.patch('/admins/:id/permissions', ...adminAuth, requirePermission('admins', 'write'), AdminController.updateAdminPermissions);
router.patch('/admins/:id/contact', ...adminAuth, requirePermission('admins', 'write'), AdminController.updateAdminContact);
router.delete('/admins/:id', ...adminAuth, requirePermission('admins', 'write'), AdminController.deleteAdmin);

router.get('/activity-logs', ...adminAuth, requirePermission('activity_logs', 'read'), AdminController.getActivityLogs);
router.get('/activity-logs/:id', ...adminAuth, requirePermission('activity_logs', 'read'), AdminController.getActivityLogDetail);
// Sidebar badges: grievances / POSM requests nobody has picked up yet. Each
// count is included only for modules this admin can read.
router.get('/attention', ...adminAuth, AdminController.getAttentionCounts);
router.get('/diagnostic/vendors', ...adminAuth, AdminController.getDashboardStats);
router.post('/repair-image', ...adminAuth, requirePermission('warranties', 'write'), ImageRepairController.repairOne);

export default router;
