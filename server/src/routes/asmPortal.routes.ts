import { Router, Request, Response, NextFunction } from 'express';
import { authenticateAnySession, requireRole } from '../middleware/auth.js';
import { asmExpenseUpload, attachPublicUrls } from '../config/localUpload.js';
import { AsmExpenseController } from '../controllers/asmExpense.controller.js';
import { AsmPortalController } from '../controllers/asmPortal.controller.js';
import { signalAdminAttentionOnSuccess } from '../services/adminAttention.service.js';

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

router.get('/expenses', ...asmOnly, AsmExpenseController.listMine);
// A new claim raises the ASM Management badge for admins.
router.post('/expenses', ...asmOnly, signalAdminAttentionOnSuccess, billUpload, AsmExpenseController.submit);

export default router;
