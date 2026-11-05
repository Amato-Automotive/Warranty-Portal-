import { Router, Request, Response, NextFunction } from 'express';
import Forms from '../controllers/franchiseForms.controller.js';
import { authenticateToken, requirePermission, requireRole } from '../middleware/auth.js';
import { feedbackUpload, attachPublicUrls } from '../config/localUpload.js';

const router = Router();
const read = [authenticateToken, requireRole('admin'), requirePermission('feedback', 'read')];
const write = [authenticateToken, requireRole('admin'), requirePermission('feedback', 'write')];
const upload = (req: Request, res: Response, next: NextFunction) => feedbackUpload.any()(req, res, (err: any) => { if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' }); attachPublicUrls(req, res, next); });
const banner = (req: Request, res: Response, next: NextFunction) => feedbackUpload.single('banner')(req, res, (err: any) => { if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' }); attachPublicUrls(req, res, next); });

router.get('/admin', ...read, Forms.listAdmin.bind(Forms));
router.get('/admin/stores', ...read, Forms.stores.bind(Forms));
router.get('/admin/:id', ...read, Forms.getAdmin.bind(Forms));
router.post('/admin', ...write, Forms.create.bind(Forms));
router.put('/admin/:id', ...write, Forms.saveAdmin.bind(Forms));
router.post('/admin/banner', ...write, banner, Forms.banner.bind(Forms));
router.post('/admin/:id/publish', ...write, Forms.publish.bind(Forms));
router.delete('/admin/:id', ...write, Forms.remove.bind(Forms));
router.get('/admin/:id/responses', ...read, Forms.responses.bind(Forms));

router.get('/', authenticateToken, requireRole('vendor'), Forms.current.bind(Forms));
router.post('/:id', authenticateToken, requireRole('vendor'), upload, Forms.submit.bind(Forms));
export default router;
