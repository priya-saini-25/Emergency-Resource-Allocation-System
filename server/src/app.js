import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Core Middleware
app.use(cors());
app.use(express.json());

// Health Check Endpoint (Phase 1 Requirement)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ONLINE',
    service: 'Emergency Resource Allocation & Response Management API',
    region: 'Jodhpur City, Rajasthan (Simulation)',
    phase: 'Phase 1 - Initialization',
    timestamp: new Date().toISOString(),
    uptime: `${process.uptime().toFixed(2)} seconds`
  });
});

// 404 & Error Handling Middlewares
app.use(notFoundHandler);
app.use(errorHandler);

// Start Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[BACKEND] Emergency Management Server running on port ${PORT}`);
    console.log(`[BACKEND] Health endpoint available at http://localhost:${PORT}/api/health`);
  });
}

export default app;
