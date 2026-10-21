import { Router, Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import fs from 'fs';
import { SchemeController } from '../controllers/scheme.controller.js';
import { authenticateToken, requirePermission, requireRole } from '../middleware/auth.js';
import { schemeUpload, attachPublicUrls } from '../config/localUpload.js';

const router = Router();

/* Files arrive under their field's id; which ones a scheme accepts, and in
   what formats, is checked by the controller against the scheme itself.
   Each file's SHA-256 is taken as it arrived, so the same invoice sent again
   can be recognised whatever it is named. */
const entryFiles = (req: Request, res: Response, next: NextFunction) => {
    schemeUpload.any()(req, res, async (err: any) => {
        if (err) return res.status(400).json({ success: false, error: err.message || 'File upload failed' });
        for (const f of ((req as any).files ?? []) as any[]) {
            try { f.sha256 = createHash('sha256').update(await fs.promises.readFile(f.path)).digest('hex'); }
            catch { /* unreadable: no fingerprint, the file is still kept */ }
        }
        attachPublicUrls(req, res, next);
    });
};
const bannerFile = (req: Request, res: Response, next: NextFunction) => {
    schemeUpload.single('banner')(req, res, (err: any) => {
        if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' });
        attachPublicUrls(req, res, next);
    });
};

const read = [authenticateToken, requireRole('admin'), requirePermission('schemes', 'read')];
const write = [authenticateToken, requireRole('admin'), requirePermission('schemes', 'write')];

// Admin: build and run schemes.
router.get('/admin', ...read, SchemeController.adminList);
router.get('/admin/stores', ...read, SchemeController.adminStores);
router.get('/admin/products', ...read, SchemeController.adminProducts);
router.post('/admin/banner', ...write, bannerFile, SchemeController.adminBanner);
router.put('/admin/entries/:entryId', ...write, SchemeController.adminReview);
router.get('/admin/:id', ...read, SchemeController.adminGet);
router.post('/admin', ...write, SchemeController.adminSave);
router.put('/admin/:id', ...write, SchemeController.adminSave);
router.post('/admin/:id/publish', ...write, SchemeController.adminPublish);
router.post('/admin/:id/end', ...write, SchemeController.adminEnd);
router.post('/admin/:id/copy', ...write, SchemeController.adminCopy);
router.delete('/admin/:id', ...write, SchemeController.adminDelete);
router.post('/admin/:id/adjust', ...write, SchemeController.adminAdjust);
router.post('/admin/:id/entries', ...write, entryFiles, SchemeController.adminAddEntry);
router.post('/admin/:id/import', ...write, SchemeController.adminImport);
router.get('/admin/:id/sell-through', ...read, SchemeController.adminSellThrough);
router.put('/admin/:id/payouts/:storeId', ...write, SchemeController.adminPayout);

// Franchise: see, join and enter schemes. Scoped to the signed-in store.
const store = [authenticateToken, requireRole('vendor')];
router.get('/', ...store, SchemeController.storeList);
router.get('/:id', ...store, SchemeController.storeGet);
router.post('/:id/join', ...store, SchemeController.storeJoin);
router.post('/:id/entries', ...store, entryFiles, SchemeController.storeSubmit);

export default router;
