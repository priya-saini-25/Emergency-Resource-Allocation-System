process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import User from '../src/models/User.js';
import { generateToken } from '../src/utils/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { __setConnectionStateOverride } from '../src/config/database.js';

function executeAppRequest(method, url, headers = {}, body = null) {
  return new Promise((resolve) => {
    let resolved = false;
    const reqHeaders = { ...headers };
    if (body && !reqHeaders['content-type']) {
      reqHeaders['content-type'] = 'application/json';
    }

    const listeners = {};
    const req = {
      method,
      url,
      headers: reqHeaders,
      on: (event, handler) => {
        listeners[event] = handler;
        return req;
      },
      emit: (event, ...args) => {
        if (listeners[event]) listeners[event](...args);
      }
    };

    const res = {
      statusCode: 200,
      headersSent: false,
      _headers: {},
      setHeader(name, val) {
        this._headers[name.toLowerCase()] = val;
      },
      getHeader(name) {
        return this._headers[name.toLowerCase()];
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        if (resolved) return this;
        resolved = true;
        this.headersSent = true;
        resolve({
          statusCode: this.statusCode,
          headers: this._headers,
          body: data
        });
        return this;
      },
      send(data) {
        if (resolved) return this;
        resolved = true;
        this.headersSent = true;
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: this.statusCode,
          headers: this._headers,
          body: parsed
        });
        return this;
      },
      end() {
        if (resolved) return this;
        resolved = true;
        resolve({
          statusCode: this.statusCode,
          headers: this._headers,
          body: null
        });
        return this;
      }
    };

    app(req, res);

    if (body !== null && listeners['data'] && listeners['end']) {
      const dataStr = typeof body === 'string' ? body : JSON.stringify(body);
      listeners['data'](Buffer.from(dataStr));
      listeners['end']();
    }
  });
}

describe('Phase 4.7 — Backend Integration, Reliability & Security Hardening Tests', () => {
  describe('1. CORS & HTTP Security Headers', () => {
    it('should include Idempotency-Key and idempotency-key in allowed CORS headers for OPTIONS preflight', async () => {
      const res = await executeAppRequest('OPTIONS', '/api/dispatch/recommendations/batch_123/confirm', {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'idempotency-key,content-type,authorization'
      });

      const allowedHeaders = res.headers['access-control-allow-headers'];
      assert.ok(allowedHeaders, 'access-control-allow-headers must be returned on preflight');
      const normalizedHeaders = allowedHeaders.toLowerCase();
      assert.ok(normalizedHeaders.includes('idempotency-key'), 'allowedHeaders must include idempotency-key');
      assert.ok(normalizedHeaders.includes('authorization'), 'allowedHeaders must include authorization');
    });

    it('should allow configured HTTP methods for REST endpoints', async () => {
      const res = await executeAppRequest('OPTIONS', '/api/incidents', {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PATCH'
      });

      const allowedMethods = res.headers['access-control-allow-methods'];
      assert.ok(allowedMethods, 'access-control-allow-methods must be present');
      assert.ok(allowedMethods.includes('PATCH'));
      assert.ok(allowedMethods.includes('POST'));
      assert.ok(allowedMethods.includes('GET'));
    });
  });

  describe('2. Standardized API Envelope & Centralized Error Format', () => {
    it('should format 404 Route Not Found with standardized error envelope and message', async () => {
      const res = await executeAppRequest('GET', '/api/unmapped_nonexistent_endpoint');

      assert.equal(res.statusCode, 404);
      assert.equal(res.body.success, false);
      assert.ok(typeof res.body.message === 'string');
      assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
      assert.equal(res.body.error.status, 404);
      assert.ok(res.body.error.timestamp);
    });

    it('should preserve custom error code and status in errorHandler without clobbering to INTERNAL_SERVER_ERROR', () => {
      const customErr = new Error('Explicit business domain error');
      customErr.statusCode = 422;
      customErr.code = 'UNPROCESSABLE_DISPATCH_ENTITY';
      customErr.details = { conflictId: 'RES-01' };

      let capturedStatus = null;
      let capturedBody = null;
      const mockRes = {
        status(code) {
          capturedStatus = code;
          return this;
        },
        json(payload) {
          capturedBody = payload;
          return this;
        }
      };

      errorHandler(customErr, {}, mockRes, () => {});

      assert.equal(capturedStatus, 422);
      assert.equal(capturedBody.success, false);
      assert.equal(capturedBody.message, 'Explicit business domain error');
      assert.equal(capturedBody.error.code, 'UNPROCESSABLE_DISPATCH_ENTITY');
      assert.equal(capturedBody.error.status, 422);
      assert.deepEqual(capturedBody.error.details, { conflictId: 'RES-01' });
    });

    it('should sanitize 500 error stack traces in production environment', () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const unexpectedErr = new Error('Sensitive internal database connection leak string');
        let capturedBody = null;
        const mockRes = {
          status() { return this; },
          json(payload) {
            capturedBody = payload;
            return this;
          }
        };

        errorHandler(unexpectedErr, {}, mockRes, () => {});

        assert.equal(capturedBody.success, false);
        assert.equal(capturedBody.error.code, 'INTERNAL_SERVER_ERROR');
        assert.equal(capturedBody.error.details, null, 'Stack details must be omitted/null in production');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });

  describe('3. Authentication, Authorization & Security Hardening', () => {
    it('should reject access with malformed Authorization token schemes', async () => {
      const res = await executeAppRequest('GET', '/api/auth/me', {
        authorization: 'Basic dXNlcjpwYXNz'
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'MALFORMED_AUTH_HEADER');
    });

    it('should reject deactivated user accounts even if JWT signature is valid', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      try {
        User.findById = async () => ({
          _id: '507f1f77bcf86cd799439011',
          name: 'Deactivated Operator',
          email: 'deactivated@jodhpur.gov.in',
          role: 'OPERATOR',
          isActive: false
        });

        const token = generateToken({
          _id: '507f1f77bcf86cd799439011',
          email: 'deactivated@jodhpur.gov.in',
          role: 'OPERATOR'
        });

        const res = await executeAppRequest('GET', '/api/incidents/active', {
          authorization: `Bearer ${token}`
        });

        assert.equal(res.statusCode, 401);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error.code, 'ACCOUNT_INACTIVE');
      } finally {
        User.findById = origFindById;
        __setConnectionStateOverride(null);
      }
    });

    it('should strictly mask passwordHash from all user query responses', async () => {
      const user = new User({
        name: 'Control Room Officer',
        email: 'officer@jodhpur.gov.in',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklm',
        role: 'OPERATOR'
      });

      const safe = user.toSafeObject();
      assert.equal(safe.passwordHash, undefined, 'passwordHash must never be present in safe object');
      assert.equal(Object.keys(safe).includes('passwordHash'), false);
    });
  });

  describe('4. Graceful Degradation & Disconnected Database Handling', () => {
    it('should fail fast with 503 DATABASE_UNAVAILABLE when database is disconnected during write', async () => {
      __setConnectionStateOverride({ connected: false, state: 'disconnected' });

      try {
        const token = generateToken({
          _id: '507f1f77bcf86cd799439011',
          email: 'citizen@example.com',
          role: 'CITIZEN'
        });

        const res = await executeAppRequest(
          'POST',
          '/api/incidents',
          { authorization: `Bearer ${token}` },
          {
            category: 'FIRE',
            severity: 3,
            location: { latitude: 26.28, longitude: 73.02 }
          }
        );

        assert.equal(res.statusCode, 503);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error.code, 'DATABASE_UNAVAILABLE');
      } finally {
        __setConnectionStateOverride(null);
      }
    });
  });
});

