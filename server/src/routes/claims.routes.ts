import { Router, Request, Response, NextFunction } from 'express';
import ClaimsController from '../controllers/claims.controller.js';
import { authenticateToken, requirePermission, requireRole } from '../middleware/auth.js';
import { claimUpload, attachPublicUrls } from '../config/localUpload.js';
import { signalAdminAttentionOnSuccess as signalAttention } from '../services/adminAttention.service.js';

const router = Router();

/* The problem's photos and video as media, inspection and fitting photos as photos. */
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

// The store: its claims, finding a customer's warranty, raising one at the counter.
router.get('/store', authenticateToken, requireRole('vendor'), ClaimsController.storeList);
router.get('/store/search', authenticateToken, requireRole('vendor'), ClaimsController.storeSearch);
router.post('/store', authenticateToken, requireRole('vendor'), signalAttention, handleUpload, ClaimsController.storeRaise);
router.post('/:id/old-part', authenticateToken, requireRole('vendor'), signalAttention, handleUpload, ClaimsController.oldPart);

// Head office.
router.get('/admin/all', authenticateToken, requireRole('admin'), requirePermission('claims', 'read'), ClaimsController.adminList);

// A step by whoever is on the claim; claimFlow decides who may take which.
router.get('/:id', authenticateToken, requirePermission('claims', 'read'), ClaimsController.detail);
router.post('/:id/action', authenticateToken, requirePermission('claims', 'write'), signalAttention, handleUpload, ClaimsController.act);

export default router;
