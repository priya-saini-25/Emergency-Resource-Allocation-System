import http from 'http';
import app from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { bootstrapPrivilegedUsers } from './utils/bootstrapAdmin.js';
import { bootstrapSimulationData } from './utils/bootstrapSimulationData.js';

let server = null;

/**
 * Initializes database, provisions initial accounts, and starts Express HTTP server.
 */
async function startServer() {
  console.log('================================================================');
  console.log(' Emergency Resource Allocation & Response Management System');
  console.log(' Backend Service (Jodhpur Urban Service Area Simulation)');
  console.log('================================================================');
  console.log(`[STARTUP] Environment: ${env.NODE_ENV}`);
  console.log(`[STARTUP] Configured Port: ${env.PORT}`);
  console.log(`[STARTUP] C++ Engine Path: ${env.CPP_ENGINE_PATH}`);
  console.log(`[STARTUP] C++ Data Directory: ${env.CPP_DATA_DIR}`);

  // Connect to database (non-blocking in case local DB is unavailable)
  const isDbConnected = await connectDatabase();

  if (isDbConnected) {
    try {
      await bootstrapPrivilegedUsers();
    } catch (bootstrapErr) {
      console.warn(`[BOOTSTRAP_WARNING] Failed to bootstrap privileged users: ${bootstrapErr.message}`);
    }

    try {
      await bootstrapSimulationData();
    } catch (simSeedErr) {
      console.warn(`[BOOTSTRAP_WARNING] Failed to seed simulation data: ${simSeedErr.message}`);
    }
  }

  server = http.createServer(app);

  server.listen(env.PORT, () => {
    console.log(`[SERVER] HTTP Server active and listening at http://localhost:${env.PORT}`);
    console.log(`[SERVER] Health endpoint: http://localhost:${env.PORT}${env.API_PREFIX}/health`);
    console.log(`[SERVER] Engine diagnostic: http://localhost:${env.PORT}${env.API_PREFIX}/health/engine`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal) => {
    console.log(`\n[SHUTDOWN] Received ${signal}. Initiating graceful server termination...`);
    if (server) {
      server.close(() => {
        console.log('[SHUTDOWN] HTTP server connections closed.');
      });
    }

    try {
      await disconnectDatabase();
    } catch (err) {
      console.error(`[SHUTDOWN_ERROR] Error closing database connection: ${err.message}`);
    }

    console.log('[SHUTDOWN] Backend process finished cleanly.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Start only if executed directly
startServer().catch((err) => {
  console.error(`[FATAL_STARTUP_ERROR] ${err.stack || err.message}`);
  process.exit(1);
});

export { server };
export default server;
