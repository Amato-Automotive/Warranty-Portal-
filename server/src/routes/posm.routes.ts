import { Router, Request, Response, NextFunction } from 'express';
import POSMController from '../controllers/posm.controller.js';
import { authenticateToken, requirePermission, requireRole } from '../middleware/auth.js';
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

// The item lists: stores read them to fill a request; the admin edits them.
router.get('/catalog', authenticateToken, requireRole(['vendor', 'admin']), POSMController.getCatalog);
router.put('/admin/catalog', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), POSMController.saveCatalog);
router.post('/admin/catalog/image', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), handleItemUpload, POSMController.uploadItemImage);

// Admin Routes
router.get('/admin/all', authenticateToken, requireRole('admin'), requirePermission('posm', 'read'), POSMController.getAllRequests);
router.put('/:id/status', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), signalAttention, POSMController.updateRequest);
router.post('/:id/action', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), signalAttention, POSMController.act);
router.post('/:id/lines', authenticateToken, requireRole('admin'), requirePermission('posm', 'write'), signalAttention, POSMController.actOnLines);
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
