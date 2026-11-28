import { Router } from 'express';
import { OldWarrantiesController } from '../controllers/old-warranties.controller.js';
import { authenticateToken, requireRole, requirePermission } from '../middleware/auth.js';
import { OldWarrantyPlacementController as Placement } from '../controllers/oldWarrantyPlacement.controller.js';

const router = Router();

// All routes require admin auth + old_warranties read permission
router.use(authenticateToken, requireRole('admin'), requirePermission('old_warranties', 'read'));

// Get seat cover warranties with search and pagination
router.get('/seatcovers', OldWarrantiesController.getSeatCoverWarranties);

// Get filter options
router.get('/seatcovers/warranty-types', OldWarrantiesController.getWarrantyTypes);
router.get('/seatcovers/store-names', OldWarrantiesController.getStoreNames);

// Get dashboard stats
router.get('/seatcovers/stats', OldWarrantiesController.getStats);

// Export to CSV
router.get('/seatcovers/export', OldWarrantiesController.exportCSV);

// Which store each old store name went to; placing or moving one needs edit rights.
router.get('/placement/summary', Placement.summary);
router.get('/placement/stores', Placement.stores);
router.get('/placement/stores/:id', Placement.store);
router.get('/placement/groups', Placement.groups);
router.post('/placement/groups/:id/place', requirePermission('old_warranties', 'write'), Placement.place);

export default router;
