import { Router, Request, Response, NextFunction } from 'express';
import FeedbackController from '../controllers/feedback.controller.js';
import { authenticateToken, requirePermission, requireRole } from '../middleware/auth.js';
import { feedbackUpload, attachPublicUrls } from '../config/localUpload.js';

const router = Router();

/* Photos for photo questions, as q_<question id>. */
const handleUpload = (req: Request, res: Response, next: NextFunction) => {
    feedbackUpload.any()(req, res, (err: any) => {
        if (err) return res.status(400).json({ success: false, error: err.code === 'LIMIT_FILE_COUNT' ? 'Too many photos' : (err.message || 'Upload failed') });
        attachPublicUrls(req, res, next);
    });
};

// The franchise's own form, its sending, and its earlier months.
router.get('/current', authenticateToken, requireRole('vendor'), FeedbackController.current);
router.get('/mine', authenticateToken, requireRole('vendor'), FeedbackController.mine);
router.post('/', authenticateToken, requireRole('vendor'), handleUpload, FeedbackController.submit);

// The admin's questions and reminder, and the answers.
router.get('/admin/settings', authenticateToken, requireRole('admin'), requirePermission('feedback', 'read'), FeedbackController.getSettings);
router.put('/admin/settings', authenticateToken, requireRole('admin'), requirePermission('feedback', 'write'), FeedbackController.saveSettings);
router.post('/admin/publish', authenticateToken, requireRole('admin'), requirePermission('feedback', 'write'), FeedbackController.publish);
router.get('/admin/stores', authenticateToken, requireRole('admin'), requirePermission('feedback', 'read'), FeedbackController.stores);
router.get('/admin/responses', authenticateToken, requireRole('admin'), requirePermission('feedback', 'read'), FeedbackController.responses);

export default router;
