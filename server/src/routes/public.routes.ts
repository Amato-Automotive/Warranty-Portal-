import { Router, Request, Response, NextFunction } from 'express';
import { StoreRatingsController } from '../controllers/storeRatings.controller.js';
import { PublicController } from '../controllers/public.controller.js';
import { ProductController } from '../controllers/product.controller.js';
import { warrantyUpload, attachPublicUrls } from '../config/localUpload.js';

const router = Router();

router.get('/stores', PublicController.getStores);
router.get('/stores/code/:code', PublicController.getStoreByCode);  // QR store lookup
router.get('/stores/:vendorDetailsId/rating', StoreRatingsController.forCustomer);
router.get('/stores/:vendorDetailsId/manpower', PublicController.getStoreManpower);
router.get('/products', ProductController.getAllProducts);
router.get('/warranty/check-uniqueness', PublicController.checkUniqueness);
router.get('/warranty/check-uid', PublicController.checkUID);
router.get('/verify-warranty', PublicController.verifyVendorWarranty);
router.get('/reject-warranty', PublicController.rejectVendorWarranty);

/**
 * Multer error-catching middleware for public warranty uploads (QR flow).
 * Same pattern as warranty.routes.ts — prevents unhandled 500 on file size limit.
 */
const handlePublicWarrantyUpload = (req: Request, res: Response, next: NextFunction) => {
    warrantyUpload.any()(req, res, (err: any) => {
        if (err) {
            console.error('[Public Warranty Upload] Multer error:', err.code || err.message);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({
                    success: false,
                    error: 'File too large. Maximum allowed size is 5 MB per file. Please use smaller images or compress them before uploading.'
                });
            }
            return res.status(400).json({
                success: false,
                error: err.message || 'File upload failed'
            });
        }
        attachPublicUrls(req, res, next);
    });
};

// Public warranty submission (QR flow)
router.post('/warranty/submit', handlePublicWarrantyUpload, PublicController.submitPublicWarranty);

export default router;
