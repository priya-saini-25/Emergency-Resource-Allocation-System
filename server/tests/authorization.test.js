process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, authorizeRoles } from '../src/middleware/auth.js';
import { generateToken } from '../src/utils/jwt.js';

function createMockHttp(headers = {}, user = null) {
  const req = {
    headers,
    user,
    userId: user ? (user._id ? user._id.toString() : user.id) : null
  };

  let resolveResponse;
  const promise = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  const res = {
    statusCode: 200,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: data });
      return this;
    }
  };

  return { req, res, waitForResponse: () => promise };
}

describe('Authentication & Role-Based Authorization Middleware', () => {
  describe('authenticate Middleware', () => {
    it('should reject requests missing the Authorization header with 401', async () => {
      const { req, res, waitForResponse } = createMockHttp({});
      let nextCalled = false;

      await authenticate(req, res, () => { nextCalled = true; });
      const result = await waitForResponse();

      assert.equal(nextCalled, false);
      assert.equal(result.statusCode, 401);
      assert.equal(result.body.error.code, 'UNAUTHORIZED');
    });

    it('should reject malformed Authorization headers not following "Bearer <token>"', async () => {
      const malformedHeaders = [
        'Basic dXNlcjpwYXNz',
        'Bearer',
        'Bearer token1 token2',
        'Token xyz123'
      ];

      for (const header of malformedHeaders) {
        const { req, res, waitForResponse } = createMockHttp({ authorization: header });
        let nextCalled = false;

        await authenticate(req, res, () => { nextCalled = true; });
        const result = await waitForResponse();

        assert.equal(nextCalled, false);
        assert.equal(result.statusCode, 401);
        assert.equal(result.body.error.code, 'MALFORMED_AUTH_HEADER');
      }
    });

    it('should reject invalid or tampered JWT signatures with 401', async () => {
      const { req, res, waitForResponse } = createMockHttp({
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tampered.signature'
      });
      let nextCalled = false;

      await authenticate(req, res, () => { nextCalled = true; });
      const result = await waitForResponse();

      assert.equal(nextCalled, false);
      assert.equal(result.statusCode, 401);
      assert.equal(result.body.error.code, 'INVALID_TOKEN');
    });
  });

  describe('authorizeRoles Middleware', () => {
    it('should allow access if authenticated user matches authorized role', () => {
      const operatorUser = { id: 'user-1', role: 'OPERATOR' };
      const { req, res } = createMockHttp({}, operatorUser);
      let nextCalled = false;

      const middleware = authorizeRoles('OPERATOR', 'ADMIN');
      middleware(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, true, 'Next must be called when role matches');
      assert.equal(res.headersSent, false);
    });

    it('should deny CITIZEN access to OPERATOR or ADMIN endpoints with 403 Forbidden', async () => {
      const citizenUser = { id: 'citizen-1', role: 'CITIZEN' };
      const { req, res, waitForResponse } = createMockHttp({}, citizenUser);
      let nextCalled = false;

      const middleware = authorizeRoles('OPERATOR', 'ADMIN');
      middleware(req, res, () => { nextCalled = true; });
      const result = await waitForResponse();

      assert.equal(nextCalled, false);
      assert.equal(result.statusCode, 403);
      assert.equal(result.body.success, false);
      assert.equal(result.body.error.code, 'FORBIDDEN');
      assert.deepEqual(result.body.error.requiredRoles, ['OPERATOR', 'ADMIN']);
      assert.equal(result.body.error.currentRole, 'CITIZEN');
    });

    it('should deny OPERATOR access to ADMIN-only endpoints with 403 Forbidden', async () => {
      const operatorUser = { id: 'op-1', role: 'OPERATOR' };
      const { req, res, waitForResponse } = createMockHttp({}, operatorUser);
      let nextCalled = false;

      const middleware = authorizeRoles('ADMIN');
      middleware(req, res, () => { nextCalled = true; });
      const result = await waitForResponse();

      assert.equal(nextCalled, false);
      assert.equal(result.statusCode, 403);
      assert.equal(result.body.error.code, 'FORBIDDEN');
      assert.deepEqual(result.body.error.requiredRoles, ['ADMIN']);
    });

    it('should allow ADMIN access to all authorized endpoints', () => {
      const adminUser = { id: 'admin-1', role: 'ADMIN' };
      const { req, res } = createMockHttp({}, adminUser);
      let nextCalled = false;

      const middleware = authorizeRoles('OPERATOR', 'ADMIN');
      middleware(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, true);
    });

    it('should return 401 if req.user is missing when authorizeRoles executes', async () => {
      const { req, res, waitForResponse } = createMockHttp({}, null);
      let nextCalled = false;

      const middleware = authorizeRoles('CITIZEN');
      middleware(req, res, () => { nextCalled = true; });
      const result = await waitForResponse();

      assert.equal(nextCalled, false);
      assert.equal(result.statusCode, 401);
      assert.equal(result.body.error.code, 'UNAUTHORIZED');
    });
  });
});

