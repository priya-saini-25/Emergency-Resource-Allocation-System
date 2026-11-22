import mongoose from 'mongoose';
import { env } from './env.js';

let isConnected = false;
let connectionStateOverride = null;

/**
 * Test utility to simulate connection states in isolated test environments.
 * @param {object|null} override - Status object override or null to reset to live Mongoose state
 */
export function __setConnectionStateOverride(override) {
  connectionStateOverride = override;
}

/**
 * Returns human-readable connection status object.
 */
export function getConnectionStatus() {
  if (connectionStateOverride !== null) {
    return { ...connectionStateOverride };
  }

  const readyStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
    99: 'uninitialized'
  };

  const stateCode = mongoose.connection.readyState;
  return {
    connected: stateCode === 1,
    state: readyStates[stateCode] || 'unknown',
    readyState: stateCode,
    host: mongoose.connection.host || null,
    port: mongoose.connection.port || null,
    name: mongoose.connection.name || null
  };
}

/**
 * Connect to MongoDB instance using Mongoose.
 * Non-blocking on failure: records error and degraded status without terminating the process.
 *
 * @param {string} [uri] - Optional MongoDB connection URI override
 * @param {object} [options] - Additional Mongoose connection options
 * @returns {Promise<boolean>} True if connected, false if degraded/failed
 */
export async function connectDatabase(uri = env.MONGODB_URI, options = {}) {
  const connectionOptions = {
    serverSelectionTimeoutMS: 10000, // Generous timeout for Atlas TLS handshake
    connectTimeoutMS: 10000,
    ...options
  };

  // Wire up lifecycle listeners once
  if (mongoose.connection.listenerCount('connected') === 0) {
    mongoose.connection.on('connected', () => {
      isConnected = true;
      console.log(`[DATABASE] MongoDB connection established successfully: ${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name}`);
    });

    mongoose.connection.on('error', (err) => {
      isConnected = false;
      console.warn(`[DATABASE_WARNING] MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      console.warn('[DATABASE_WARNING] MongoDB connection disconnected.');
    });

    mongoose.connection.on('reconnected', () => {
      isConnected = true;
      console.log('[DATABASE] MongoDB connection reconnected.');
    });
  }

  try {
    const maskedUri = uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
    console.log(`[DATABASE] Attempting connection to MongoDB at: ${maskedUri}`);
    await mongoose.connect(uri, connectionOptions);
    isConnected = true;
    return true;
  } catch (error) {
    isConnected = false;
    console.warn(`[DATABASE_WARNING] Unable to connect to MongoDB: ${error.message}`);
    console.warn(`[DATABASE_WARNING] Operating in offline/degraded persistence mode. Algorithmic C++ engine remains fully active.`);
    return false;
  }
}

/**
 * Gracefully closes the database connection.
 */
export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    console.log('[DATABASE] MongoDB connection closed gracefully.');
  }
}

export default {
  connectDatabase,
  disconnectDatabase,
  getConnectionStatus,
  __setConnectionStateOverride
};
