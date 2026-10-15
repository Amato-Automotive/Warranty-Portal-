import { Router, type RequestHandler } from 'express';
import { AsmController } from '../controllers/asm.controller.js';
import { authenticateToken, requireRole, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import { AsmExpenseController } from '../controllers/asmExpense.controller.js';
import { signalAdminAttentionOnSuccess } from '../services/adminAttention.service.js';

const router = Router();
const adminAuth = [authenticateToken, requireRole('admin')];

/**
 * POST /api/asm/route-enquiry
 *
 * Called by the Interakt workflow, not by a logged-in user, so there is no
 * session to check — it is guarded by a shared secret instead. Kept separate
 * from the admin routes below for that reason.
 */
const workflowSecret: RequestHandler = (req, res, next) => {
    const expected = process.env.ASM_WEBHOOK_SECRET;
    // Unset in development so the endpoint can be exercised locally; in
    // production a missing secret means the route is effectively open, so it
    // is logged loudly rather than failing silently.
    if (!expected) {
        console.warn(`[ASM] ASM_WEBHOOK_SECRET is not set — ${req.path} is unauthenticated`);
        return next();
    }
    const given = req.headers['x-asm-secret'] || req.query.secret;
    if (given !== expected) {
        // Logged, never the value: a workflow edit that dropped the header
        // otherwise looks exactly like a customer getting no reply.
        console.warn(`[ASM] ${req.path} refused: secret ${given ? 'wrong' : 'missing'} (from ${req.ip})`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

router.post('/route-enquiry', workflowSecret, AsmController.routeEnquiryWebhook);

/**
 * POST /api/asm/store-enquiry
 *
 * The store locator: the workflow posts the customer's pincode and stops, and
 * the stores go back to them from here. Same secret as /route-enquiry.
 */
router.post('/store-enquiry', workflowSecret, AsmController.storeEnquiryWebhook);

/*
 * Literal paths are declared before '/:id', or Express would match
 * "known-areas" and "leads" as an ASM id and 404 on a lookup that never
 * should have run.
 */
router.get('/known-areas', ...adminAuth, requirePermission('leads', 'read'), AsmController.knownAreas);
// States, districts and pincodes to give an ASM, from the pincode directory.
router.get('/area-search', ...adminAuth, requirePermission('leads', 'read'), AsmController.searchAreas);
router.get('/leads/list', ...adminAuth, requirePermission('leads', 'read'), AsmController.listLeads);
router.post('/leads', ...adminAuth, requirePermission('leads', 'write'), AsmController.createLead);
router.put('/leads/:id', ...adminAuth, requirePermission('leads', 'write'), AsmController.updateLead);
// Stores for a typed area, for the add form — before a lead exists to key on.
router.get('/stores-for-area', ...adminAuth, requirePermission('leads', 'read'), AsmController.storesForEnquiry);
// Nearest stores to a pincode, by distance — the store-locator lookup.
router.get('/stores-near', ...adminAuth, requirePermission('leads', 'read'), AsmController.storesNearPincode);
router.get('/locator-settings', ...adminAuth, requirePermission('leads', 'read'), AsmController.getLocatorSettings);
router.put('/locator-settings', ...adminAuth, requirePermission('leads', 'write'), AsmController.updateLocatorSettings);
router.get('/leads/:id/stores', ...adminAuth, requirePermission('leads', 'read'), AsmController.leadStores);
router.get('/leads/:id/messages', ...adminAuth, requirePermission('leads', 'read'), AsmController.leadMessages);
router.post('/leads/:id/send-store', ...adminAuth, requirePermission('leads', 'write'), AsmController.sendLeadStore);
router.post('/areas', ...adminAuth, requirePermission('leads', 'write'), AsmController.addArea);
router.delete('/areas/:id', ...adminAuth, requirePermission('leads', 'write'), AsmController.removeArea);

// ── Admin: ASM expense claims ───────────────────────────────────────────────
// Their own permission (`asm_expenses`, the ASM Expenses screen): HR decides
// and pays claims; ASM Management (`asms`) stays with the main admin.
router.get('/expenses', ...adminAuth, requirePermission('asm_expenses', 'read'), AsmExpenseController.adminList);
router.put('/expenses/:id/decision', ...adminAuth, requirePermission('asm_expenses', 'write'), signalAdminAttentionOnSuccess, AsmExpenseController.decide);
router.put('/expenses/:id/paid', ...adminAuth, requirePermission('asm_expenses', 'write'), AsmExpenseController.markPaid);

// ── Admin: ASMs ─────────────────────────────────────────────────────────────
// ASMs are managed from ASM Management (`asms`). The list is also what Lead
// Management's Areas tab draws on, so either permission can read it.
router.get('/', ...adminAuth, requireAnyPermission(['asms', 'leads'], 'read'), AsmController.listAsms);
router.post('/', ...adminAuth, requirePermission('asms', 'write'), AsmController.createAsm);
router.get('/:id/leads', ...adminAuth, requirePermission('asms', 'read'), AsmController.asmLeads);
router.put('/:id', ...adminAuth, requirePermission('asms', 'write'), AsmController.updateAsm);
router.delete('/:id', ...adminAuth, requirePermission('asms', 'write'), AsmController.deleteAsm);

export default router;
