import { Router, Request, Response, NextFunction } from 'express';
import POSMController from '../controllers/posm.controller.js';
import { POSMHistoryController } from '../controllers/posmHistory.controller.js';
import { POSMAnalyticsController } from '../controllers/posmAnalytics.controller.js';
import { authenticateToken, requireAnyPermission, requirePermission, requireRole } from '../middleware/auth.js';
import { posmUpload, posmItemUpload, attachPublicUrls } from '../config/localUpload.js';
import { signalAdminAttentionOnSuccess as signalAttention } from '../services/adminAttention.service.js';

const router = Router();

export const handleUpload = (req: Request, res: Response, next: NextFunction) => {
    posmUpload.array('attachments', 5)(req, res, (err: any) => {
        if (err) {
            console.error('POSM upload error:', err);
            return res.status(400).json({
                success: false,
                error: err.message || 'File upload failed'
            });
        }
        attachPublicUrls(req, res, next);
    });
};

/* A request built from items: a file per item line (line_<n>) and the note's own. */
export const handleItemUpload = (req: Request, res: Response, next: NextFunction) => {
    posmItemUpload.any()(req, res, (err: any) => {
        if (err) {
            console.error('POSM item upload error:', err);
            return res.status(400).json({ success: false, error: err.code === 'LIMIT_FILE_COUNT' ? 'Up to 20 files per request' : (err.message || 'File upload failed') });
        }
        attachPublicUrls(req, res, next);
    });
};

// Dispatch history: what has already been sent to each store, limits and approval.
/* Head office (POSM, or the Noida office switch) sees and edits everything; the plant switch opens only the plant's lines. */
const historyRead = [authenticateToken, requireRole('admin'), requireAnyPermission(['posm', 'posm_noida'], 'read')];
const historyWrite = [authenticateToken, requireRole('admin'), requireAnyPermission(['posm', 'posm_noida'], 'write')];
const plantRead = [authenticateToken, requireRole('admin'), requireAnyPermission(['posm', 'posm_noida', 'posm_plant'], 'read')];
const plantWrite = [authenticateToken, requireRole('admin'), requireAnyPermission(['posm', 'posm_plant'], 'write')];
router.get('/admin/history/plant', ...plantRead, POSMHistoryController.plantLines);
router.put('/admin/history/plant/lines/:id', ...plantWrite, POSMHistoryController.plantUpdate);
router.post('/admin/history/plant/orders', ...historyWrite, POSMHistoryController.plantOrder);
router.get('/admin/history/noida', ...historyRead, POSMHistoryController.noidaDispatches);
/* POSM on the Analytics page: open to Analytics users as well as POSM head office. */
const analyticsRead = [authenticateToken, requireRole('admin'), requireAnyPermission(['posm', 'posm_noida', 'analytics'], 'read')];
router.get('/admin/analytics', ...analyticsRead, POSMAnalyticsController.overview);
router.get('/admin/analytics/drill', ...analyticsRead, POSMAnalyticsController.drill);
router.get('/admin/history/sheet-sync', ...plantRead, POSMHistoryController.sheetSyncStatus);
router.post('/admin/history/sheet-sync', ...plantRead, POSMHistoryController.sheetSyncNow);
router.post('/admin/history/noida', ...historyWrite, POSMHistoryController.noidaSave);
router.get('/admin/history/stores', ...historyRead, POSMHistoryController.stores);
router.get('/admin/history/stores/:storeId', ...historyRead, POSMHistoryController.store);
router.put('/admin/history/stores/:storeId/settings', ...historyWrite, POSMHistoryController.saveSettings);
router.get('/admin/history/lines', ...historyRead, POSMHistoryController.lines);
router.get('/admin/history/unlinked', ...historyRead, POSMHistoryController.unlinked);
router.post('/admin/history/link', ...historyWrite, POSMHistoryController.link);
router.put('/admin/history/lines/:id', ...historyWrite, POSMHistoryController.updateLine);
router.delete('/admin/history/lines/:id', ...historyWrite, POSMHistoryController.removeLine);
router.get('/history', authenticateToken, requireRole('vendor'), POSMHistoryController.mine);

// The item lists: stores read them to fill a request; the admin edits them.
router.get('/catalog', authenticateToken, requireRole(['vendor', 'admin']), POSMController.getCatalog);
/* A distributor raising POSM for one of its stores. */
router.get('/distributor/stores', authenticateToken, requireRole('vendor'), POSMController.getDistributorStores);
router.get('/distributor/requests', authenticateToken, requireRole('vendor'), POSMController.getDistributorRequests);
router.get('/distributor/stores/:id/catalog', authenticateToken, requireRole('vendor'), POSMController.getCatalogForDistributor);
router.post('/distributor/stores/:id/items', authenticateToken, requireRole('vendor'), signalAttention, handleItemUpload, POSMController.submitItemsByDistributor);
router.put('/admin/catalog', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), POSMController.saveCatalog);
router.post('/admin/catalog/image', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), handleItemUpload, POSMController.uploadItemImage);

// Admin Routes
router.get('/admin/all', authenticateToken, requireRole('admin'), requirePermission('posm', 'read'), POSMController.getAllRequests);
router.put('/:id/status', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), signalAttention, POSMController.updateRequest);
router.post('/:id/action', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), signalAttention, POSMController.act);
router.post('/:id/lines', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), signalAttention, POSMController.actOnLines);
router.put('/admin/:id/urgent', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), POSMController.setUrgent);
router.put('/:id/history/:index', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), POSMController.editHistoryNote);
// Raise a request on a franchise's behalf — for requirements phoned or emailed
// in. Kept separate from the franchise route below so that one stays session-
// scoped and cannot be pointed at another store.
router.post('/admin/on-behalf', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), signalAttention, handleUpload, POSMController.submitRequestOnBehalf);
router.post('/admin/on-behalf/items', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), signalAttention, handleItemUpload, POSMController.submitItemsOnBehalf);

// Shared/General Routes
router.post('/', authenticateToken, requireRole('vendor'), signalAttention, handleUpload, POSMController.submitRequest);
router.post('/items', authenticateToken, requireRole('vendor'), signalAttention, handleItemUpload, POSMController.submitItems);
router.post('/:id/delivered', authenticateToken, requireRole('vendor'), signalAttention, handleItemUpload, POSMController.confirmDelivery);
router.get('/', authenticateToken, requireRole('vendor'), POSMController.getFranchiseRequests);
router.get('/:id', authenticateToken, POSMController.getTicketDetails);
router.post('/:id/messages', authenticateToken, requireRole(['vendor', 'admin']), requirePermission('posm', 'write'), handleUpload, POSMController.sendMessage);

export default router;
