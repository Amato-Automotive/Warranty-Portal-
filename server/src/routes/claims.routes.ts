import { Router, Request, Response, NextFunction } from 'express';
import ClaimsController from '../controllers/claims.controller.js';
import ClaimSheetController from '../controllers/claimSheet.controller.js';
import { authenticateToken, requirePermission, requireRole } from '../middleware/auth.js';
import { claimUpload, attachPublicUrls } from '../config/localUpload.js';
import { signalAdminAttentionOnSuccess as signalAttention } from '../services/adminAttention.service.js';

const router = Router();

/* The problem's photos and video as media; the store's and fitting photos as photos. */
const handleUpload = (req: Request, res: Response, next: NextFunction) => {
    claimUpload.any()(req, res, (err: any) => {
        if (err) {
            console.error('Claim upload error:', err);
            return res.status(400).json({ success: false, error: err.code === 'LIMIT_FILE_COUNT' ? 'Up to 12 files' : err.code === 'LIMIT_FILE_SIZE' ? 'A file is over 60 MB' : (err.message || 'File upload failed') });
        }
        attachPublicUrls(req, res, next);
    });
};

router.get('/meta', authenticateToken, ClaimsController.meta);

// The customer's own warranties and claims.
router.get('/mine', authenticateToken, requireRole('customer'), ClaimsController.mine);
router.post('/', authenticateToken, requireRole('customer'), handleUpload, ClaimsController.raise);

// The store: its claims (and a distributor's stores'), finding a warranty, raising one at the counter.
router.get('/store', authenticateToken, requireRole('vendor'), ClaimsController.storeList);
router.get('/store/warranties', authenticateToken, requireRole('vendor'), ClaimsController.storeWarranties);
router.get('/store/search', authenticateToken, requireRole('vendor'), ClaimsController.storeSearch);
router.post('/store', authenticateToken, requireRole('vendor'), signalAttention, handleUpload, ClaimsController.storeRaise);

// The plant: everyone with Warranty Claims read sees every claim; the steps
// each person may take come from their claims_* rights (see whoOf).
// The production sheets claims come from, and who sees their claims.
const sheetRead = [authenticateToken, requireRole('admin'), requirePermission('claims', 'read')];
const sheetWrite = [authenticateToken, requireRole('admin'), requirePermission('claims', 'write')];
router.get('/admin/sheets', ...sheetRead, ClaimSheetController.list);
router.post('/admin/sheets', ...sheetWrite, ClaimSheetController.add);
router.put('/admin/sheets/seen', ...sheetWrite, ClaimSheetController.setSeen);
router.put('/admin/sheets/:id', ...sheetWrite, ClaimSheetController.update);
router.delete('/admin/sheets/:id', ...sheetWrite, ClaimSheetController.remove);
router.post('/admin/sheets/:id/sync', ...sheetWrite, ClaimSheetController.sync);
router.get('/admin/all', authenticateToken, requireRole('admin'), requirePermission('claims', 'read'), ClaimsController.adminList);

// A step by whoever is on the claim; claimFlow decides who may take which.
router.get('/:id/file', authenticateToken, requirePermission('claims', 'read'), ClaimsController.file);
router.get('/:id', authenticateToken, requirePermission('claims', 'read'), ClaimsController.detail);
router.post('/:id/action', authenticateToken, requirePermission('claims', 'read'), signalAttention, handleUpload, ClaimsController.act);

export default router;
