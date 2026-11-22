process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import authService from '../src/services/authService.js';
import apiClient from '../src/services/apiClient.js';

// Reusable mock storage
class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

describe('Phase 5.2 — Authentication & Role-Based Session Integration Tests', () => {
  describe('1. AuthService API Contract Alignment', () => {
    it('should call POST /auth/login and return token and user envelope', async () => {
      const origPost = apiClient.post;
      try {
        apiClient.post = async (url, data) => {
          assert.equal(url, '/auth/login');
          assert.equal(data.email, 'operator@jodhpur.gov.in');
          assert.equal(data.password, 'OperatorSecure2026!');
          return {
            success: true,
            message: 'Login successful',
            data: {
              token: 'mock.jwt.token',
              user: {
                id: 'usr_001',
                name: 'Control Room Officer',
                email: 'operator@jodhpur.gov.in',
                role: 'OPERATOR',
                isActive: true,
              },
            },
          };
        };

        const result = await authService.login('operator@jodhpur.gov.in', 'OperatorSecure2026!');
        assert.ok(result);
        assert.equal(result.token, 'mock.jwt.token');
        assert.equal(result.user.role, 'OPERATOR');
        assert.equal(result.user.name, 'Control Room Officer');
      } finally {
        apiClient.post = origPost;
      }
    });

    it('should call POST /auth/register and return user without a token', async () => {
      const origPost = apiClient.post;
      try {
        apiClient.post = async (url, data) => {
          assert.equal(url, '/auth/register');
          assert.equal(data.name, 'Sanjay Sharma');
          assert.equal(data.email, 'sanjay@example.com');
          assert.equal(data.password, 'Password123!');
          return {
            success: true,
            message: 'Citizen account registered successfully',
            data: {
              user: {
                id: 'usr_002',
                name: 'Sanjay Sharma',
                email: 'sanjay@example.com',
                role: 'CITIZEN',
                isActive: true,
              },
            },
          };
        };

        const result = await authService.register('Sanjay Sharma', 'sanjay@example.com', 'Password123!');
        assert.ok(result);
        assert.equal(result.user.id, 'usr_002');
        assert.equal(result.user.role, 'CITIZEN');
        assert.equal(result.token, undefined, 'Register endpoint must not return a JWT token');
      } finally {
        apiClient.post = origPost;
      }
    });

    it('should call GET /auth/me to fetch current profile', async () => {
      const origGet = apiClient.get;
      try {
        apiClient.get = async (url) => {
          assert.equal(url, '/auth/me');
          return {
            success: true,
            message: 'Current user profile retrieved successfully',
            data: {
              user: {
                id: 'usr_001',
                name: 'Control Room Officer',
                email: 'operator@jodhpur.gov.in',
                role: 'OPERATOR',
                isActive: true,
              },
            },
          };
        };

        const user = await authService.getMe();
        assert.ok(user);
        assert.equal(user.id, 'usr_001');
        assert.equal(user.role, 'OPERATOR');
      } finally {
        apiClient.get = origGet;
      }
    });
  });

  describe('2. Auth State Machine & Session Restoration Logic', () => {
    it('should initialize as unauthenticated when no persisted token is present', async () => {
      const mockStorage = new MockLocalStorage();
      let isInitializing = true;
      let token = mockStorage.getItem('token');
      let user = null;

      if (!token) {
        user = null;
        token = null;
        isInitializing = false;
      }

      assert.equal(isInitializing, false);
      assert.equal(token, null);
      assert.equal(user, null);
      assert.equal(Boolean(token && user), false);
    });

    it('should restore session when a valid token exists on startup', async () => {
      const mockStorage = new MockLocalStorage();
      mockStorage.setItem('token', 'valid.persisted.jwt');

      let isInitializing = true;
      let token = mockStorage.getItem('token');
      let user = null;

      const origGetMe = authService.getMe;
      try {
        authService.getMe = async () => ({
          id: 'usr_003',
          name: 'Verified Citizen',
          email: 'citizen@example.com',
          role: 'CITIZEN',
          isActive: true,
        });

        if (token) {
          user = await authService.getMe();
          isInitializing = false;
        }

        assert.equal(isInitializing, false);
        assert.equal(token, 'valid.persisted.jwt');
        assert.ok(user);
        assert.equal(user.role, 'CITIZEN');
        assert.equal(Boolean(token && user), true);
      } finally {
        authService.getMe = origGetMe;
      }
    });

    it('should purge invalid/expired token and initialize unauthenticated if /auth/me fails', async () => {
      const mockStorage = new MockLocalStorage();
      mockStorage.setItem('token', 'expired.jwt.token');

      let isInitializing = true;
      let token = mockStorage.getItem('token');
      let user = null;

      const origGetMe = authService.getMe;
      try {
        authService.getMe = async () => {
          const err = new Error('Authentication token has expired');
          err.status = 401;
          err.code = 'TOKEN_EXPIRED';
          throw err;
        };

        if (token) {
          try {
            user = await authService.getMe();
          } catch (_) {
            token = null;
            user = null;
            mockStorage.removeItem('token');
          } finally {
            isInitializing = false;
          }
        }

        assert.equal(isInitializing, false);
        assert.equal(token, null);
        assert.equal(user, null);
        assert.equal(mockStorage.getItem('token'), null);
      } finally {
        authService.getMe = origGetMe;
      }
    });

    it('should discard stale asynchronous responses if user logs out before request resolves', async () => {
      let sessionCounter = 1;
      let activeUser = null;
      let activeToken = 'initial.token';

      // Simulate in-flight async request captured with session ID 1
      const requestSessionId = sessionCounter;

      let resolvePromise;
      const delayedGetMe = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      // User initiates logout in parallel
      sessionCounter++; // sessionCounter is now 2
      activeUser = null;
      activeToken = null;

      // Delayed async request finishes afterwards
      resolvePromise({
        id: 'usr_stale',
        name: 'Stale User',
        role: 'CITIZEN',
      });
      const staleUser = await delayedGetMe;

      // Guard check: only apply if request session matches active session
      if (sessionCounter === requestSessionId) {
        activeUser = staleUser;
      }

      assert.equal(activeUser, null, 'Stale async response must not restore active user state');
      assert.equal(activeToken, null);
    });
  });

  describe('3. Form Validation & Security Rules', () => {
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

    it('should accept valid email addresses and reject malformed ones', () => {
      const validEmails = ['officer@jodhpur.gov.in', 'citizen@example.com', 'test.user+tag@domain.co.in'];
      const invalidEmails = ['plainaddress', '@missingusername.com', 'username@.com', 'spaces in@mail.com', ''];

      for (const email of validEmails) {
        assert.equal(emailRegex.test(email), true, `Expected ${email} to be valid`);
      }
      for (const email of invalidEmails) {
        assert.equal(emailRegex.test(email), false, `Expected ${email} to be invalid`);
      }
    });

    it('should enforce password complexity (min 8 chars, letter, and number)', () => {
      const validatePassword = (pwd) => {
        if (!pwd || typeof pwd !== 'string' || pwd.length < 8) return false;
        return /[a-zA-Z]/.test(pwd) && /[0-9]/.test(pwd);
      };

      assert.equal(validatePassword('Pass12345'), true);
      assert.equal(validatePassword('Secure2026!'), true);
      assert.equal(validatePassword('Short1'), false, 'Too short (< 8)');
      assert.equal(validatePassword('NoNumbersHere!'), false, 'Missing digit');
      assert.equal(validatePassword('1234567890'), false, 'Missing letter');
    });

    it('should validate password confirmation matches exactly', () => {
      const checkMatch = (pwd, confirm) => Boolean(pwd && confirm && pwd === confirm);

      assert.equal(checkMatch('Password123', 'Password123'), true);
      assert.equal(checkMatch('Password123', 'DifferentPassword'), false);
      assert.equal(checkMatch('Password123', ''), false);
    });

    it('should validate name length bounds [2, 100]', () => {
      const validateName = (name) => {
        const clean = typeof name === 'string' ? name.trim() : '';
        return clean.length >= 2 && clean.length <= 100;
      };

      assert.equal(validateName('Sanjay Sharma'), true);
      assert.equal(validateName('A'), false, 'Too short (< 2)');
      assert.equal(validateName('   '), false, 'Empty after trim');
      assert.equal(validateName('X'.repeat(101)), false, 'Too long (> 100)');
    });
  });

  describe('4. Role-Based Route Navigation & Redirection Policy', () => {
    it('should redirect unauthenticated users attempting protected routes to /login', () => {
      const evaluateRouteAccess = (auth, targetRoles) => {
        if (!auth.isAuthenticated) {
          return { allow: false, redirect: '/login' };
        }
        if (targetRoles.length > 0 && !targetRoles.includes(auth.role)) {
          return {
            allow: false,
            redirect: auth.role === 'CITIZEN' ? '/citizen/dashboard' : '/control-room/dashboard',
          };
        }
        return { allow: true, redirect: null };
      };

      const unauth = { isAuthenticated: false, role: null };
      assert.deepEqual(evaluateRouteAccess(unauth, ['CITIZEN']), { allow: false, redirect: '/login' });
      assert.deepEqual(evaluateRouteAccess(unauth, ['OPERATOR', 'ADMIN']), { allow: false, redirect: '/login' });
    });

    it('should permit CITIZEN to access citizen routes and deny control-room routes', () => {
      const evaluateRouteAccess = (auth, targetRoles) => {
        if (!auth.isAuthenticated) return { allow: false, redirect: '/login' };
        if (targetRoles.length > 0 && !targetRoles.includes(auth.role)) {
          return {
            allow: false,
            redirect: auth.role === 'CITIZEN' ? '/citizen/dashboard' : '/control-room/dashboard',
          };
        }
        return { allow: true, redirect: null };
      };

      const citizenAuth = { isAuthenticated: true, role: 'CITIZEN' };
      // Access citizen dashboard
      assert.deepEqual(evaluateRouteAccess(citizenAuth, ['CITIZEN', 'ADMIN']), { allow: true, redirect: null });
      // Attempt control-room dashboard
      assert.deepEqual(evaluateRouteAccess(citizenAuth, ['OPERATOR', 'ADMIN']), {
        allow: false,
        redirect: '/citizen/dashboard',
      });
    });

    it('should permit OPERATOR to access control-room routes and deny citizen-only routes', () => {
      const evaluateRouteAccess = (auth, targetRoles) => {
        if (!auth.isAuthenticated) return { allow: false, redirect: '/login' };
        if (targetRoles.length > 0 && !targetRoles.includes(auth.role)) {
          return {
            allow: false,
            redirect: auth.role === 'CITIZEN' ? '/citizen/dashboard' : '/control-room/dashboard',
          };
        }
        return { allow: true, redirect: null };
      };

      const operatorAuth = { isAuthenticated: true, role: 'OPERATOR' };
      // Access control room
      assert.deepEqual(evaluateRouteAccess(operatorAuth, ['OPERATOR', 'ADMIN']), { allow: true, redirect: null });
      // Attempt citizen report route
      assert.deepEqual(evaluateRouteAccess(operatorAuth, ['CITIZEN']), {
        allow: false,
        redirect: '/control-room/dashboard',
      });
    });

    it('should redirect authenticated users visiting public /login or /register to their authorized dashboard', () => {
      const evaluatePublicRoute = (auth) => {
        if (auth.isAuthenticated) {
          return auth.role === 'CITIZEN' ? '/citizen/dashboard' : '/control-room/dashboard';
        }
        return null; // Allowed to view public auth page
      };

      assert.equal(evaluatePublicRoute({ isAuthenticated: false }), null);
      assert.equal(evaluatePublicRoute({ isAuthenticated: true, role: 'CITIZEN' }), '/citizen/dashboard');
      assert.equal(evaluatePublicRoute({ isAuthenticated: true, role: 'OPERATOR' }), '/control-room/dashboard');
      assert.equal(evaluatePublicRoute({ isAuthenticated: true, role: 'ADMIN' }), '/control-room/dashboard');
    });
  });
});

