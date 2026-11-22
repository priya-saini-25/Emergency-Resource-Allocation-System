import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

// Load environment variables from process cwd or fallback to server/.env
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Fallback relative paths resolved relative to project root
const DEFAULT_ENGINE_BIN = path.resolve(PROJECT_ROOT, 'cpp_engine/bin/engine.exe');
const DEFAULT_DATA_DIR = path.resolve(PROJECT_ROOT, 'cpp_engine/data');
const DEFAULT_BOUNDARY_FILE = path.resolve(PROJECT_ROOT, 'cpp_engine/data/jodhpur_boundary.geojson');

function resolveAppPath(inputPath, defaultPath) {
  if (!inputPath) return defaultPath;
  if (path.isAbsolute(inputPath) && fs.existsSync(inputPath)) return inputPath;
  const fromCwd = path.resolve(inputPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromServer = path.resolve(__dirname, '../../', inputPath);
  if (fs.existsSync(fromServer)) return fromServer;
  const fromRoot = path.resolve(PROJECT_ROOT, inputPath);
  if (fs.existsSync(fromRoot)) return fromRoot;
  return fromCwd;
}

/**
 * Validates and normalizes environment variables for the Emergency Resource Allocation Backend.
 */
function parseEnv() {
  const port = parseInt(process.env.PORT || '5000', 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`[CONFIG_ERROR] Invalid PORT specified: ${process.env.PORT}. Must be between 1 and 65535.`);
  }

  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
  const allowedEnvs = ['development', 'production', 'test'];
  if (!allowedEnvs.includes(nodeEnv)) {
    throw new Error(`[CONFIG_ERROR] Invalid NODE_ENV: ${process.env.NODE_ENV}. Must be one of: ${allowedEnvs.join(', ')}`);
  }

  const timeoutMs = parseInt(process.env.CPP_ENGINE_TIMEOUT_MS || process.env.CPP_TIMEOUT_MS || '10000', 10);
  if (isNaN(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`[CONFIG_ERROR] Invalid CPP_TIMEOUT_MS: must be a positive integer.`);
  }

  const maxBufferBytes = parseInt(process.env.CPP_MAX_BUFFER_BYTES || `${10 * 1024 * 1024}`, 10);
  if (isNaN(maxBufferBytes) || maxBufferBytes <= 0) {
    throw new Error(`[CONFIG_ERROR] Invalid CPP_MAX_BUFFER_BYTES: must be a positive integer.`);
  }

  const maxBatchSize = parseInt(process.env.CPP_MAX_BATCH_SIZE || '25', 10);
  if (isNaN(maxBatchSize) || maxBatchSize <= 0) {
    throw new Error(`[CONFIG_ERROR] Invalid CPP_MAX_BATCH_SIZE: must be a positive integer.`);
  }

  // Authentication configuration
  const jwtSecret = process.env.JWT_SECRET || 'emergency_jodhpur_dev_secret_key_2026_academic_simulation';
  if (nodeEnv === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
    throw new Error('[CONFIG_ERROR] In production, JWT_SECRET must be explicitly provided and at least 32 characters long.');
  }

  const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
  const bcryptSaltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
  if (isNaN(bcryptSaltRounds) || bcryptSaltRounds < 4 || bcryptSaltRounds > 31) {
    throw new Error('[CONFIG_ERROR] Invalid BCRYPT_SALT_ROUNDS: must be an integer between 4 and 31.');
  }

  const enginePath = resolveAppPath(process.env.CPP_ENGINE_PATH || process.env.CPP_ENGINE_BIN_PATH, DEFAULT_ENGINE_BIN);
  const dataDir = resolveAppPath(process.env.CPP_DATA_DIR, DEFAULT_DATA_DIR);
  const boundaryPath = resolveAppPath(process.env.JODHPUR_BOUNDARY_PATH, DEFAULT_BOUNDARY_FILE);

  return {
    PORT: port,
    NODE_ENV: nodeEnv,
    API_PREFIX: process.env.API_PREFIX || '/api',
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/emergency_response_jodhpur',
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: jwtExpiresIn,
    BCRYPT_SALT_ROUNDS: bcryptSaltRounds,
    CPP_ENGINE_PATH: enginePath,
    CPP_DATA_DIR: dataDir,
    CPP_TIMEOUT_MS: timeoutMs,
    CPP_MAX_BUFFER_BYTES: maxBufferBytes,
    CPP_MAX_BATCH_SIZE: maxBatchSize,
    CPP_EXTRA_PATH: process.env.CPP_EXTRA_PATH || 'C:\\msys64\\ucrt64\\bin',
    JODHPUR_BOUNDARY_PATH: boundaryPath,
    CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
    JODHPUR_CENTER: {
      lat: parseFloat(process.env.JODHPUR_CENTER_LAT || '26.2918'),
      lng: parseFloat(process.env.JODHPUR_CENTER_LNG || '73.0168')
    },
    // Privileged bootstrap credentials (for idempotent initial provisioning)
    ADMIN_INITIAL_EMAIL: process.env.ADMIN_INITIAL_EMAIL || 'admin@jodhpur.emergency.gov.in',
    ADMIN_INITIAL_PASSWORD: process.env.ADMIN_INITIAL_PASSWORD || 'AdminJodhpur2026!',
    OPERATOR_INITIAL_EMAIL: process.env.OPERATOR_INITIAL_EMAIL || 'operator@jodhpur.emergency.gov.in',
    OPERATOR_INITIAL_PASSWORD: process.env.OPERATOR_INITIAL_PASSWORD || 'OperatorJodhpur2026!'
  };
}

export const env = parseEnv();
export default env;
