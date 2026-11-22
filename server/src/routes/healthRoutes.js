import { Router } from 'express';
import { getHealth, getEngineHealth } from '../controllers/healthController.js';

const router = Router();

// GET /api/health - Global service health & component telemetry
router.get('/', getHealth);

// GET /api/health/engine - Detailed C++ Decision Engine diagnostics
router.get('/engine', getEngineHealth);

export default router;

