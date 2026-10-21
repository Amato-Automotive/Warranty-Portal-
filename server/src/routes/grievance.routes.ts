import { Router, Request, Response, NextFunction } from 'express';
import GrievanceController from '../controllers/grievance.controller.js';
import { GrievanceCategoryController } from '../controllers/grievanceCategory.controller.js';
import { authenticateToken, requirePermission, requireRole } from '../middleware/auth.js';
import { grievanceUpload, attachPublicUrls } from '../config/localUpload.js';
import { signalAdminAttentionOnSuccess as signalAttention } from '../services/adminAttention.service.js';

const router = Router();

export const handleUpload = (req: Request, res: Response, next: NextFunction) => {
    grievanceUpload.array('attachments', 3)(req, res, (err: any) => {
        if (err) {
            console.error('Grievance upload error:', err);
            return res.status(400).json({
                success: false,
                error: err.message || 'File upload failed'
            });
        }
        attachPublicUrls(req, res, next);
    });
};

// Customer routes
router.post('/', authenticateToken, requireRole('customer'), signalAttention, handleUpload, GrievanceController.submitGrievance);
router.get('/', authenticateToken, requireRole('customer'), GrievanceController.getMyGrievances);
router.put('/:id/rating', authenticateToken, requireRole('customer'), GrievanceController.addRating);

// Vendor routes
router.get('/vendor', authenticateToken, requireRole('vendor'), GrievanceController.getVendorGrievances);

// Franchise grievance routes (for vendors to submit their own grievances)
// Admins may file here on a store's behalf by passing franchiseId; the
// controller rejects that field for a vendor session, so a vendor can still
// only ever file for itself.
router.post('/franchise', authenticateToken, requireRole(['vendor', 'admin']), signalAttention, handleUpload, GrievanceController.submitFranchiseGrievance);
router.get('/franchise/submitted', authenticateToken, requireRole('vendor'), GrievanceController.getFranchiseSubmittedGrievances);

// Categories — managed by an admin, so adding one no longer needs a deploy.
// The read route is open to any signed-in user because the franchise form
// needs the list to render its options.
router.get('/categories', authenticateToken, GrievanceCategoryController.list);
router.post('/categories', authenticateToken, requireRole('admin'), requirePermission('grievances', 'write'), GrievanceCategoryController.create);
router.put('/categories/:id', authenticateToken, requireRole('admin'), requirePermission('grievances', 'write'), GrievanceCategoryController.update);
router.delete('/categories/:id', authenticateToken, requireRole('admin'), requirePermission('grievances', 'write'), GrievanceCategoryController.remove);

// Admin routes
router.get('/admin', authenticateToken, requireRole('admin'), requirePermission('grievances', 'read'), GrievanceController.getAllGrievances);

// Shared routes (Vendor/Admin)
router.get('/:id', authenticateToken, GrievanceController.getGrievanceById);
router.put('/:id/status', authenticateToken, requireRole(['vendor', 'admin']), requirePermission('grievances', 'write'), signalAttention, GrievanceController.updateStatus);
router.put('/:id/assign', authenticateToken, requireRole('admin'), requirePermission('grievances', 'write'), GrievanceController.assignGrievance);
router.put('/:id/admin-update', authenticateToken, requireRole('admin'), requirePermission('grievances', 'write'), signalAttention, GrievanceController.adminUpdateGrievance);
router.put('/:id/remarks', authenticateToken, requireRole(['vendor', 'admin']), requirePermission('grievances', 'write'), GrievanceController.addRemarks);
router.post('/:id/send-assignment-email', authenticateToken, requireRole('admin'), requirePermission('grievances', 'write'), GrievanceController.sendAssignmentEmail);
router.get('/:id/remarks', authenticateToken, GrievanceController.getRemarks);
router.get('/:id/assignments', authenticateToken, requireRole('admin'), requirePermission('grievances', 'read'), GrievanceController.getAssignmentHistory);

export default router;
