import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { env } from '../src/config/env.js';

describe('Environment Configuration Module', () => {
  it('should expose validated environment defaults', () => {
    assert.equal(typeof env.PORT, 'number');
    assert.ok(env.PORT > 0 && env.PORT < 65536, 'PORT must be a valid port number');

    assert.ok(['development', 'production', 'test'].includes(env.NODE_ENV), 'NODE_ENV must be recognized');
    assert.equal(typeof env.MONGODB_URI, 'string');
    assert.ok(env.MONGODB_URI.startsWith('mongodb://') || env.MONGODB_URI.startsWith('mongodb+srv://'), 'MONGODB_URI must be a mongodb URL');

    assert.equal(typeof env.CPP_TIMEOUT_MS, 'number');
    assert.ok(env.CPP_TIMEOUT_MS > 0, 'CPP_TIMEOUT_MS must be positive');

    assert.equal(typeof env.CPP_MAX_BUFFER_BYTES, 'number');
    assert.ok(env.CPP_MAX_BUFFER_BYTES >= 1024 * 1024, 'CPP_MAX_BUFFER_BYTES must be at least 1MB');
  });

  it('should resolve C++ binary and data paths to absolute filesystem locations', () => {
    assert.ok(path.isAbsolute(env.CPP_ENGINE_PATH), 'CPP_ENGINE_PATH must be absolute');
    assert.ok(path.isAbsolute(env.CPP_DATA_DIR), 'CPP_DATA_DIR must be absolute');
    assert.ok(env.CPP_ENGINE_PATH.endsWith('engine.exe') || env.CPP_ENGINE_PATH.endsWith('engine'), 'Must target engine executable');
  });

  it('should provide default Jodhpur geographical center coordinates', () => {
    assert.ok(Number.isFinite(env.JODHPUR_CENTER.lat), 'Center latitude must be finite');
    assert.ok(Number.isFinite(env.JODHPUR_CENTER.lng), 'Center longitude must be finite');
    assert.ok(env.JODHPUR_CENTER.lat > 26.0 && env.JODHPUR_CENTER.lat < 27.0, 'Latitude must be within Jodhpur regional bounds');
    assert.ok(env.JODHPUR_CENTER.lng > 72.5 && env.JODHPUR_CENTER.lng < 73.5, 'Longitude must be within Jodhpur regional bounds');
  });
});

