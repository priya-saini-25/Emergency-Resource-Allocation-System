import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import {
  listResources,
  getResourceStats,
  getResourceById
} from '../controllers/resourceController.js';

const router = Router();

// OPERATOR & ADMIN only
router.use(authenticate, authorizeRoles('OPERATOR', 'ADMIN'));

router.get('/stats', getResourceStats);
router.get('/', listResources);
router.get('/:resourceId', getResourceById);

export default router;

