import { Router, Request, Response, NextFunction } from 'express';
import { WarrantyController } from '../controllers/warranty.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import { warrantyUpload, attachPublicUrls } from '../config/localUpload.js';
import { preparePdfs } from '../services/pdfInvoice.js';

const router = Router();
/* The invoice may be a PDF: checked and shrunk before it is kept. */
const invoicePdf = preparePdfs((_req, file) => file.fieldname === 'invoiceFile');

/**
 * Multer error-catching middleware for warranty uploads.
 * Without this wrapper, multer's LIMIT_FILE_SIZE error propagates as an
 * unhandled 500, causing a white screen on the client.
 */
const handleWarrantyUpload = (req: Request, res: Response, next: NextFunction) => {
    warrantyUpload.any()(req, res, (err: any) => {
        if (err) {
            console.error('[Warranty Upload] Multer error:', err.code || err.message);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({
                    success: false,
                    error: 'File too large. Maximum allowed size is 10 MB per file. Please use a smaller file.'
                });
            }
            return res.status(400).json({
                success: false,
                error: err.message || 'File upload failed'
            });
        }
        invoicePdf(req, res, () => attachPublicUrls(req, res, next));
    });
};

// Use upload.any() to handle multiple files with different field names
router.post('/submit', authenticateToken, handleWarrantyUpload, WarrantyController.submitWarranty);
router.get('/', authenticateToken, WarrantyController.getWarranties);
router.get('/stats', authenticateToken, WarrantyController.getDashboardStats);
router.get('/:uid', authenticateToken, WarrantyController.getWarrantyById);
router.put('/:uid', authenticateToken, handleWarrantyUpload, WarrantyController.updateWarranty);

export default router;