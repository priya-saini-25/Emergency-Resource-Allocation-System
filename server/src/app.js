import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import healthRoutes from './routes/healthRoutes.js';
import authRoutes from './routes/authRoutes.js';
import incidentRoutes from './routes/incidentRoutes.js';
import dispatchRoutes from './routes/dispatchRoutes.js';
import resourceRoutes from './routes/resourceRoutes.js';
import hospitalRoutes from './routes/hospitalRoutes.js';
import locationRoutes from './routes/locationRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFound.js';

const app = express();

// Security and CORS middleware
app.use(cors({
  origin: env.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Idempotency-Key', 'idempotency-key']
}));

// Body parser with 10MB limit (matching engine max buffer)
app.use(express.json({ limit: '10mb' }));

// Mount Application Routes
app.use(`${env.API_PREFIX}/health`, healthRoutes);
app.use(`${env.API_PREFIX}/auth`, authRoutes);
app.use(`${env.API_PREFIX}/incidents`, incidentRoutes);
app.use(`${env.API_PREFIX}/dispatch`, dispatchRoutes);
app.use(`${env.API_PREFIX}/resources`, resourceRoutes);
app.use(`${env.API_PREFIX}/hospitals`, hospitalRoutes);
app.use(`${env.API_PREFIX}/location`, locationRoutes);
app.use(`${env.API_PREFIX}/notifications`, notificationRoutes);

// Fallback 404 handler for unmatched routes
app.use(notFoundHandler);

// Centralized error handling middleware
app.use(errorHandler);

export { app };
export default app;
