import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import {
  createRecommendation,
  getRecommendation,
  listRecommendations
} from '../controllers/dispatchController.js';
import {
  confirmDispatchController,
  getDispatchByIdController,
  listDispatchesController
} from '../controllers/dispatchExecutionController.js';

const router = Router();

// All dispatch endpoints are restricted to OPERATOR and ADMIN roles
router.use(authenticate, authorizeRoles('OPERATOR', 'ADMIN'));

// --- Recommendation Endpoints ---
// 1. Confirm dispatch execution for a recommendation batch
router.post('/recommendations/:batchId/confirm', confirmDispatchController);

// 2. Retrieve recommendation snapshot by batch ID
router.get('/recommendations/:batchId', getRecommendation);

// 3. Generate batch dispatch recommendations
router.post('/recommendations', createRecommendation);

// 4. List historical recommendation snapshots
router.get('/recommendations', listRecommendations);

// --- Confirmed Dispatch Endpoints ---
// 5. Retrieve confirmed dispatch operation by dispatchId or batchId
router.get('/:dispatchId', getDispatchByIdController);

// 6. List confirmed dispatch operations
router.get('/', listDispatchesController);

export default router;
