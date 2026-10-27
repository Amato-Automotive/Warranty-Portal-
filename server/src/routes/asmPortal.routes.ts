import { Router, Request, Response, NextFunction } from 'express';
import { authenticateAnySession, requireRole } from '../middleware/auth.js';
import { asmExpenseUpload, asmPhotoUpload, attachPublicUrls } from '../config/localUpload.js';
import { AsmExpenseController } from '../controllers/asmExpense.controller.js';
import { AsmPortalController } from '../controllers/asmPortal.controller.js';
import { signalAdminAttentionOnSuccess } from '../services/adminAttention.service.js';
import POSMController from '../controllers/posm.controller.js';
import GrievanceController from '../controllers/grievance.controller.js';
import { GrievanceCategoryController } from '../controllers/grievanceCategory.controller.js';
import { handleUpload as posmNoteUpload, handleItemUpload as posmItemUpload } from './posm.routes.js';
import { handleUpload as grievanceUpload } from './grievance.routes.js';

/**
 * The ASM portal's own API. ASM sessions are refused everywhere else
 * (authenticateToken), so everything an ASM does goes through here.
 */
const router = Router();
const asmOnly = [authenticateAnySession, requireRole('asm')];

const billUpload = (req: Request, res: Response, next: NextFunction) => {
    asmExpenseUpload.fields([
        { name: 'onward_ticket', maxCount: 1 },
        { name: 'return_ticket', maxCount: 1 },
        { name: 'hotel_bill', maxCount: 1 },
    ])(req, res, (err: any) => {
        if (err) {
            const tooBig = err?.code === 'LIMIT_FILE_SIZE';
            return res.status(400).json({ error: tooBig ? 'Each bill must be under 10 MB' : (err.message || 'File upload failed') });
        }
        attachPublicUrls(req, res, next);
    });
};

router.get('/summary', ...asmOnly, AsmPortalController.summary);
router.get('/leads', ...asmOnly, AsmPortalController.leads);
router.get('/areas', ...asmOnly, AsmPortalController.areas);
router.get('/stores', ...asmOnly, AsmPortalController.stores);
router.get('/stores/:id', ...asmOnly, AsmPortalController.storeDetail);

const photoUpload = (req: Request, res: Response, next: NextFunction) => {
    asmPhotoUpload.single('photo')(req, res, (err: any) => {
        if (err) {
            const tooBig = err?.code === 'LIMIT_FILE_SIZE';
            return res.status(400).json({ error: tooBig ? 'The photo must be under 5 MB' : (err.message || 'Upload failed') });
        }
        attachPublicUrls(req, res, next);
    });
};

// The ASM edits their name and photo only; number and email are head office's.
router.get('/profile', ...asmOnly, AsmPortalController.profile);
router.put('/profile', ...asmOnly, AsmPortalController.updateName);
router.post('/profile/photo', ...asmOnly, photoUpload, AsmPortalController.setPhoto);
router.delete('/profile/photo', ...asmOnly, AsmPortalController.removePhoto);

/*
 * POSM requests and grievances for the ASM's own stores: raised on the
 * store's behalf, read, and replied to. The same controllers as the store's
 * and head office's routes; each checks the store is under this ASM. A new
 * one raises the admin badges, as one from the store does.
 */
router.get('/stores/:id/posm-catalog', ...asmOnly, POSMController.getCatalogForAsm);
router.post('/stores/:id/posm', ...asmOnly, signalAdminAttentionOnSuccess, posmItemUpload, POSMController.submitItemsByAsm);
router.get('/posm/:id', ...asmOnly, POSMController.getTicketDetails);
router.post('/posm/:id/messages', ...asmOnly, posmNoteUpload, POSMController.sendMessage);

router.get('/grievance-categories', ...asmOnly, GrievanceCategoryController.listForForm);
router.post('/stores/:id/grievances', ...asmOnly, signalAdminAttentionOnSuccess, grievanceUpload,
    (req: Request, _res: Response, next: NextFunction) => { req.body.franchiseId = req.params.id; next(); },
    GrievanceController.submitFranchiseGrievance);
router.get('/grievances/:id', ...asmOnly, GrievanceController.getGrievanceById);
router.get('/grievances/:id/remarks', ...asmOnly, GrievanceController.getRemarks);
router.post('/grievances/:id/remarks', ...asmOnly, GrievanceController.addRemarks);

router.get('/expenses', ...asmOnly, AsmExpenseController.listMine);
router.get('/expenses/budget', ...asmOnly, AsmExpenseController.myBudget);
// A new claim raises the ASM Management badge for admins.
router.post('/expenses', ...asmOnly, signalAdminAttentionOnSuccess, billUpload, AsmExpenseController.submit);

export default router;
