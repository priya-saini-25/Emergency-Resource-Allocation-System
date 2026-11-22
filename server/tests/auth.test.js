process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import User from '../src/models/User.js';
import { generateToken, verifyToken } from '../src/utils/jwt.js';
import { register, login, getMe } from '../src/controllers/authController.js';
import { __setConnectionStateOverride } from '../src/config/database.js';

function createMockHttp(body = {}, headers = {}) {
  const req = {
    body,
    headers,
    user: null,
    userId: null
  };

  let resolveResponse;
  const promise = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  const res = {
    statusCode: 200,
    headersSent: false,
    _headers: {},
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

describe('Authentication & User Model Unit Tests', () => {
  describe('User Model & Password Hashing', () => {
    it('should securely hash plaintext passwords using bcrypt', async () => {
      const plaintext = 'SecurePassword123!';
      const hash = await User.hashPassword(plaintext);

      assert.ok(hash && typeof hash === 'string');
      assert.notEqual(hash, plaintext, 'Hash must not equal plaintext');
      assert.ok(hash.startsWith('$2'), 'Bcrypt hash must start with $2');

      const user = new User({
        name: 'Test Citizen',
        email: 'citizen@example.com',
        passwordHash: hash,
        role: 'CITIZEN'
      });

      const isMatch = await user.comparePassword(plaintext);
      assert.equal(isMatch, true, 'comparePassword must return true for correct password');

      const isBadMatch = await user.comparePassword('WrongPassword999!');
      assert.equal(isBadMatch, false, 'comparePassword must return false for wrong password');
    });

    it('should exclude passwordHash from toSafeObject and toJSON output', async () => {
      const hash = await User.hashPassword('Pass12345!');
      const user = new User({
        name: 'Safe User',
        email: 'safe@example.com',
        passwordHash: hash,
        role: 'CITIZEN'
      });

      const safe = user.toSafeObject();
      assert.equal(safe.passwordHash, undefined, 'passwordHash must be omitted from safe object');
      assert.equal(safe.name, 'Safe User');
      assert.equal(safe.email, 'safe@example.com');
      assert.equal(safe.role, 'CITIZEN');

      const json = user.toJSON();
      assert.equal(json.passwordHash, undefined, 'passwordHash must be omitted from toJSON');
      assert.equal(json.__v, undefined);
    });

    it('should validate email format and reject invalid emails', async () => {
      const badEmailUser = new User({
        name: 'Bad Email',
        email: 'not-an-email',
        passwordHash: 'dummyhash123',
        role: 'CITIZEN'
      });

      await assert.rejects(async () => {
        await badEmailUser.validate();
      }, (err) => {
        assert.ok(err.errors.email);
        return true;
      });
    });

    it('should reject invalid user roles', async () => {
      const badRoleUser = new User({
        name: 'Bad Role',
        email: 'role@example.com',
        passwordHash: 'dummyhash123',
        role: 'SUPER_USER' // Not in ['CITIZEN', 'OPERATOR', 'ADMIN']
      });

      await assert.rejects(async () => {
        await badRoleUser.validate();
      }, (err) => {
        assert.ok(err.errors.role);
        return true;
      });
    });
  });

  describe('JWT Generation & Verification', () => {
    it('should generate and verify valid JWT tokens containing user claims', () => {
      const mockUser = {
        _id: '507f1f77bcf86cd799439011',
        role: 'CITIZEN'
      };

      const token = generateToken(mockUser);
      assert.ok(token && typeof token === 'string');

      const decoded = verifyToken(token);
      assert.equal(decoded.id, '507f1f77bcf86cd799439011');
      assert.equal(decoded.role, 'CITIZEN');
      assert.ok(decoded.exp > decoded.iat, 'Token must have future expiration');
    });

    it('should reject malformed or tampered tokens', () => {
      assert.throws(() => {
        verifyToken('invalid.token.string');
      });

      assert.throws(() => {
        verifyToken('');
      });
    });
  });

  describe('Registration Controller Validation', () => {
    it('should reject registration requests with missing or short names', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        const { req, res, waitForResponse } = createMockHttp({
          name: 'A', // Too short (< 2)
          email: 'citizen@example.com',
          password: 'Password123'
        });

        await register(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.success, false);
        assert.equal(result.body.error.code, 'INVALID_NAME');
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should reject registration requests with invalid email syntax', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        const { req, res, waitForResponse } = createMockHttp({
          name: 'Valid Name',
          email: 'invalid-email-format',
          password: 'Password123'
        });

        await register(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.success, false);
        assert.equal(result.body.error.code, 'INVALID_EMAIL');
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should reject registration requests with weak passwords', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        // Password too short (< 8)
        const { req: req1, res: res1, waitForResponse: wait1 } = createMockHttp({
          name: 'Valid Name',
          email: 'test@example.com',
          password: 'Pass1'
        });
        await register(req1, res1, () => {});
        const resShort = await wait1();
        assert.equal(resShort.statusCode, 400);
        assert.equal(resShort.body.error.code, 'WEAK_PASSWORD');

        // Password only letters (no number)
        const { req: req2, res: res2, waitForResponse: wait2 } = createMockHttp({
          name: 'Valid Name',
          email: 'test@example.com',
          password: 'OnlyLettersPassword'
        });
        await register(req2, res2, () => {});
        const resLetters = await wait2();
        assert.equal(resLetters.statusCode, 400);
        assert.equal(resLetters.body.error.code, 'WEAK_PASSWORD');
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should return 503 when registering while database is disconnected', async () => {
      __setConnectionStateOverride({ connected: false, state: 'disconnected' });

      try {
        const { req, res, waitForResponse } = createMockHttp({
          name: 'Valid Name',
          email: 'test@example.com',
          password: 'Password123'
        });

        await register(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 503);
        assert.equal(result.body.success, false);
        assert.equal(result.body.error.code, 'DATABASE_UNAVAILABLE');
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should register a valid citizen user and ignore public role escalation attempts', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      let createdUserDoc = null;
      const origFindOne = User.findOne;
      const origCreate = User.create;

      User.findOne = async () => null; // Email does not exist yet
      User.create = async (doc) => {
        createdUserDoc = doc;
        return {
          ...doc,
          _id: '507f1f77bcf86cd799439011',
          toSafeObject: () => ({
            id: '507f1f77bcf86cd799439011',
            name: doc.name,
            email: doc.email,
            role: doc.role,
            isActive: doc.isActive
          })
        };
      };

      try {
        const { req, res, waitForResponse } = createMockHttp({
          name: 'Honest Citizen',
          email: 'honest.citizen@example.com',
          password: 'Password123!',
          role: 'ADMIN' // Malicious public attempt to register as ADMIN!
        });

        await register(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 201);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.user.role, 'CITIZEN', 'Public registration MUST always result in CITIZEN role!');
        assert.equal(createdUserDoc.role, 'CITIZEN', 'Stored document must have CITIZEN role');
      } finally {
        User.findOne = origFindOne;
        User.create = origCreate;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('Login Controller Validation', () => {
    it('should reject login requests with missing email or password', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        const { req, res, waitForResponse } = createMockHttp({
          email: 'test@example.com'
          // password omitted
        });

        await login(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.success, false);
        assert.equal(result.body.error.code, 'MISSING_CREDENTIALS');
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should return 401 generic INVALID_CREDENTIALS for unknown email', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindOne = User.findOne;
      User.findOne = () => ({
        select: async () => null // User not found
      });

      try {
        const { req, res, waitForResponse } = createMockHttp({
          email: 'unknown@example.com',
          password: 'Password123!'
        });

        await login(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 401);
        assert.equal(result.body.error.code, 'INVALID_CREDENTIALS');
      } finally {
        User.findOne = origFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('should return 403 ACCOUNT_DEACTIVATED if account is inactive', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindOne = User.findOne;
      User.findOne = () => ({
        select: async () => ({
          email: 'inactive@example.com',
          isActive: false,
          comparePassword: async () => true // Password matches, but inactive
        })
      });

      try {
        const { req, res, waitForResponse } = createMockHttp({
          email: 'inactive@example.com',
          password: 'Password123!'
        });

        await login(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 403);
        assert.equal(result.body.error.code, 'ACCOUNT_DEACTIVATED');
      } finally {
        User.findOne = origFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('should return 503 when logging in while database is disconnected', async () => {
      __setConnectionStateOverride({ connected: false, state: 'disconnected' });

      try {
        const { req, res, waitForResponse } = createMockHttp({
          email: 'test@example.com',
          password: 'Password123'
        });

        await login(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 503);
        assert.equal(result.body.success, false);
        assert.equal(result.body.error.code, 'DATABASE_UNAVAILABLE');
      } finally {
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('Current User Profile Controller', () => {
    it('should return safe user profile for authenticated user', async () => {
      const { req, res, waitForResponse } = createMockHttp();
      req.user = new User({
        name: 'Active Citizen',
        email: 'active@example.com',
        passwordHash: 'dummyhash',
        role: 'CITIZEN',
        isActive: true
      });

      await getMe(req, res, () => {});
      const result = await waitForResponse();

      assert.equal(result.statusCode, 200);
      assert.equal(result.body.success, true);
      assert.equal(result.body.data.user.name, 'Active Citizen');
      assert.equal(result.body.data.user.email, 'active@example.com');
      assert.equal(result.body.data.user.role, 'CITIZEN');
      assert.equal(result.body.data.user.passwordHash, undefined);
    });
  });
});
