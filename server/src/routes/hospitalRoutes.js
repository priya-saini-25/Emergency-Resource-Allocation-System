import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import {
  listHospitals,
  getHospitalStats,
  getHospitalById
} from '../controllers/hospitalController.js';

const router = Router();

// OPERATOR & ADMIN only
router.use(authenticate, authorizeRoles('OPERATOR', 'ADMIN'));

router.get('/stats', getHospitalStats);
router.get('/', listHospitals);
router.get('/:hospitalId', getHospitalById);

export default router;

