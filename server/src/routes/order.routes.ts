import { Router } from 'express';
import { OrderController } from '../controllers/order.controller.js';
import { authenticateToken, requirePermission, requireRole } from '../middleware/auth.js';
import { distributorProductUpload, attachPublicUrls } from '../config/localUpload.js';

/* A distributor's photos of a product, with the reason shown when one is refused. */
const productPhotos = (req: any, res: any, next: any) => {
    // "photos" for the product, "car_<n>" for car row n.
    distributorProductUpload.any()(req, res, (err: any) => {
        if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_COUNT' ? 'Too many photos in one save' : err.code === 'LIMIT_FILE_SIZE' ? 'A photo is over 8 MB' : (err.message || 'Upload failed') });
        attachPublicUrls(req, res, next);
    });
};

const router = Router();

// Public route: token-authorized invoice download (WhatsApp/email "Download Invoice" link).
// No login session — the token (a signed JWT carrying the order id) authorizes the PDF.
// Path-only form (no query string) so WhatsApp dynamic-URL buttons don't mangle it.
router.get('/invoice/:token', OrderController.downloadOrderInvoicePublic);

// Franchise/Vendor routes (authenticated, vendor role required)
router.post('/', authenticateToken, requireRole('vendor'), OrderController.createOrder);
router.get('/my-orders', authenticateToken, requireRole('vendor'), OrderController.getMyOrders);
router.get('/distributor-stock', authenticateToken, requireRole('vendor'), OrderController.getDistributorStock);
router.get('/catalogue', authenticateToken, requireRole('vendor'), OrderController.getFranchiseCatalogue);
router.get('/my-distributors', authenticateToken, requireRole('vendor'), OrderController.getMyDistributors);
router.get('/distributor', authenticateToken, requireRole('vendor'), OrderController.getDistributorDetails);
router.get('/distributor/franchises', authenticateToken, requireRole('vendor'), OrderController.getDistributorFranchises);
router.get('/distributor/inventory', authenticateToken, requireRole('vendor'), OrderController.getOwnInventory);
router.put('/distributor/inventory', authenticateToken, requireRole('vendor'), OrderController.updateOwnStock);
// What a distributor adds to a product: the cars it fits and its own photos.
router.get('/vehicles', authenticateToken, requireRole('vendor'), OrderController.getVehicleList);
router.get('/distributor/products/:productId', authenticateToken, requireRole('vendor'), OrderController.getProductListing);
router.put('/distributor/products/:productId', authenticateToken, requireRole('vendor'), productPhotos, OrderController.saveProductListing);
router.get('/distributor/incoming', authenticateToken, requireRole('vendor'), OrderController.getDistributorIncomingOrders);
router.post('/distributor/incoming/:id/confirm', authenticateToken, requireRole('vendor'), OrderController.confirmDistributorOrder);
router.post('/distributor/incoming/:id/hold', authenticateToken, requireRole('vendor'), OrderController.holdDistributorOrder);
router.post('/distributor/incoming/:id/note', authenticateToken, requireRole('vendor'), OrderController.addDistributorNote);
router.post('/distributor/incoming/:id/cancel', authenticateToken, requireRole('vendor'), OrderController.cancelDistributorOrder);
router.post('/:id/received', authenticateToken, requireRole('vendor'), OrderController.markOrderReceived);

// Decline outgoing orders (admin only)
router.post('/:id/cancel', authenticateToken, requireRole('admin'), requirePermission('order_management', 'write'), OrderController.cancelOrder);

// Order detail routes, shared by admins and vendors. requirePermission lets
// every non-admin straight through and the controllers only narrow the
// 'vendor' case, so without requireRole here any logged-in customer could read
// any order, its invoice and its chat by id — and the ids are sequential.
const orderParty = [authenticateToken, requireRole(['admin', 'vendor'])];

// Chat / Messages routes
router.get('/:id/group', ...orderParty, OrderController.getOrderGroup);
router.get('/:id/messages', ...orderParty, requirePermission('order_management', 'read'), OrderController.getOrderMessages);
router.post('/:id/messages', ...orderParty, requirePermission('order_management', 'write'), OrderController.createOrderMessage);

// Order by ID (Vendor can view their own, Admin can view any)
router.get('/:id', ...orderParty, requirePermission('order_management', 'read'), OrderController.getOrderById);
router.get('/:id/pdf', ...orderParty, requirePermission('order_management', 'read'), OrderController.downloadOrderPDF);

// Admin routes
router.get('/', authenticateToken, requireRole('admin'), requirePermission('order_management', 'read'), OrderController.getAllOrders);
router.put('/:id/status', authenticateToken, requireRole('admin'), requirePermission('order_management', 'write'), OrderController.updateOrderStatus);

export default router;
