import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import { streamNotifications } from '../controllers/notificationController.js';

const router = Router();

/**
 * GET /api/notifications/stream
 * Establishes persistent Server-Sent Events stream for OPERATOR and ADMIN users.
 */
router.get(
  '/stream',
  authenticate,
  authorizeRoles('OPERATOR', 'ADMIN'),
  streamNotifications
);

export default router;
