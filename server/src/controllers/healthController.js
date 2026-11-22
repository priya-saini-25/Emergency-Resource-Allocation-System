import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { getConnectionStatus } from '../config/database.js';
import { checkEngineHealth } from '../services/cppEngineService.js';

/**
 * Global health check endpoint.
 * Evaluates Express runtime, MongoDB database connection, and C++ engine responsiveness.
 */
export async function getHealth(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    const engineStatus = await checkEngineHealth();

    const isDatabaseOk = dbStatus.connected;
    const isEngineOk = engineStatus.status === 'healthy';

    let overallStatus = 'healthy';
    if (!isDatabaseOk && !isEngineOk) {
      overallStatus = 'critical';
    } else if (!isDatabaseOk || !isEngineOk) {
      overallStatus = 'degraded';
    }

    res.status(overallStatus === 'critical' ? 503 : 200).json({
      success: true,
      data: {
        status: overallStatus,
        service: 'Emergency Resource Allocation & Response Management System',
        region: 'Jodhpur Urban Service Area, Rajasthan (Academic Simulation)',
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString(),
        uptimeSeconds: parseFloat(process.uptime().toFixed(2)),
        memoryUsageMb: {
          rss: parseFloat((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
          heapUsed: parseFloat((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)),
          heapTotal: parseFloat((process.memoryUsage().heapTotal / (1024 * 1024)).toFixed(2))
        },
        components: {
          database: {
            status: dbStatus.connected ? 'connected' : 'disconnected',
            state: dbStatus.state,
            host: dbStatus.host,
            name: dbStatus.name
          },
          cppEngine: {
            status: engineStatus.status,
            protocolVersion: engineStatus.versionInfo?.protocol_version || 'unknown',
            engineName: engineStatus.versionInfo?.engine || 'unknown',
            probeLatencyMs: engineStatus.wallClockMs || null,
            error: engineStatus.error || null
          }
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Dedicated C++ Decision Engine diagnostic endpoint.
 */
export async function getEngineHealth(req, res, next) {
  try {
    const engineHealth = await checkEngineHealth();

    // Verify datasets on disk
    const requiredDatasets = [
      'jodhpur_graph.json',
      'jodhpur_roads.geojson',
      'jodhpur_boundary.geojson',
      'road_network_metadata.json'
    ];

    const datasetChecks = requiredDatasets.map((filename) => {
      const fullPath = path.join(env.CPP_DATA_DIR, filename);
      const exists = fs.existsSync(fullPath);
      let sizeBytes = null;
      if (exists) {
        try {
          sizeBytes = fs.statSync(fullPath).size;
        } catch (_) {}
      }
      return {
        file: filename,
        path: fullPath,
        exists,
        sizeBytes
      };
    });

    const allDatasetsPresent = datasetChecks.every((d) => d.exists);

    res.status(engineHealth.status === 'healthy' && allDatasetsPresent ? 200 : 503).json({
      success: engineHealth.status === 'healthy' && allDatasetsPresent,
      data: {
        engine: engineHealth,
        dataDirectory: {
          path: env.CPP_DATA_DIR,
          allDatasetsPresent,
          datasets: datasetChecks
        },
        executable: {
          path: env.CPP_ENGINE_PATH,
          exists: fs.existsSync(env.CPP_ENGINE_PATH)
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

export default {
  getHealth,
  getEngineHealth
};

