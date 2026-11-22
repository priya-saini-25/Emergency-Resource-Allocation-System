import express from 'express';
import { searchLocation } from '../controllers/locationController.js';

const router = express.Router();

// GET /api/location/search?q=<place-name>
router.get('/search', searchLocation);

export default router;
