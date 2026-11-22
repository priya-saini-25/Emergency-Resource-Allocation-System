process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import { generateToken } from '../src/utils/jwt.js';
import { __setConnectionStateOverride } from '../src/config/database.js';

function createMockHttp(method, url, body = {}, headers = {}) {
  const req = {
    method,
    url,
    originalUrl: url,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body,
    params: {},
    query: {}
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
    setHeader(name, value) {
      this._headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return this._headers[name.toLowerCase()];
    },
    json(data) {
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: data });
      return this;
    },
    send(data) {
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: data });
      return this;
    },
    end() {
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: null });
    }
  };

  return { req, res, waitForResponse: () => promise };
}

describe('Express Route-Level Integration Tests (App Dispatch)', () => {
  it('POST /api/auth/register should register citizen and return 201', async () => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });

    const origFindOne = User.findOne;
    const origCreate = User.create;

    User.findOne = async () => null;
    User.create = async (doc) => ({
      ...doc,
      _id: '507f1f77bcf86cd799439022',
      toSafeObject: () => ({
        id: '507f1f77bcf86cd799439022',
        name: doc.name,
        email: doc.email,
        role: doc.role,
        isActive: doc.isActive
      })
    });

    try {
      const { req, res, waitForResponse } = createMockHttp('POST', '/api/auth/register', {
        name: 'Express Citizen',
        email: 'express.citizen@example.com',
        password: 'Password123!'
      });

      app(req, res);
      const result = await waitForResponse();

      assert.equal(result.statusCode, 201);
      assert.equal(result.body.success, true);
      assert.equal(result.body.data.user.role, 'CITIZEN');
      assert.equal(result.body.data.user.email, 'express.citizen@example.com');
    } finally {
      User.findOne = origFindOne;
      User.create = origCreate;
      __setConnectionStateOverride(null);
    }
  });

  it('POST /api/auth/login should return signed JWT token on valid credentials', async () => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });

    const origFindOne = User.findOne;
    User.findOne = () => ({
      select: async () => ({
        _id: '507f1f77bcf86cd799439022',
        name: 'Express Citizen',
        email: 'express.citizen@example.com',
        role: 'CITIZEN',
        isActive: true,
        comparePassword: async () => true,
        save: async () => {},
        toSafeObject: () => ({
          id: '507f1f77bcf86cd799439022',
          name: 'Express Citizen',
          email: 'express.citizen@example.com',
          role: 'CITIZEN',
          isActive: true
        })
      })
    });

    try {
      const { req, res, waitForResponse } = createMockHttp('POST', '/api/auth/login', {
        email: 'express.citizen@example.com',
        password: 'Password123!'
      });

      app(req, res);
      const result = await waitForResponse();

      assert.equal(result.statusCode, 200);
      assert.equal(result.body.success, true);
      assert.ok(result.body.data.token, 'Must return JWT token string');
      assert.equal(result.body.data.user.role, 'CITIZEN');
    } finally {
      User.findOne = origFindOne;
      __setConnectionStateOverride(null);
    }
  });

  it('GET /api/auth/me should return safe profile when Bearer token is provided', async () => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });

    const mockUser = {
      _id: '507f1f77bcf86cd799439022',
      id: '507f1f77bcf86cd799439022',
      name: 'Express Citizen',
      email: 'express.citizen@example.com',
      role: 'CITIZEN',
      isActive: true,
      toSafeObject: () => ({
        id: '507f1f77bcf86cd799439022',
        name: 'Express Citizen',
        email: 'express.citizen@example.com',
        role: 'CITIZEN',
        isActive: true
      })
    };

    const token = generateToken(mockUser);

    const origFindById = User.findById;
    User.findById = async () => mockUser;

    try {
      const { req, res, waitForResponse } = createMockHttp(
        'GET',
        '/api/auth/me',
        {},
        { authorization: `Bearer ${token}` }
      );

      app(req, res);
      const result = await waitForResponse();

      assert.equal(result.statusCode, 200);
      assert.equal(result.body.success, true);
      assert.equal(result.body.data.user.id, '507f1f77bcf86cd799439022');
      assert.equal(result.body.data.user.email, 'express.citizen@example.com');
    } finally {
      User.findById = origFindById;
      __setConnectionStateOverride(null);
    }
  });

  it('POST /api/incidents should allow CITIZEN to report emergency in Jodhpur boundary', async () => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });

    const mockCitizen = {
      _id: '507f1f77bcf86cd799439022',
      id: '507f1f77bcf86cd799439022',
      role: 'CITIZEN',
      isActive: true
    };
    const token = generateToken(mockCitizen);

    const origFindById = User.findById;
    const origCreate = Incident.create;

    User.findById = async () => mockCitizen;
    Incident.create = async (doc) => ({
      ...doc,
      _id: '607f1f77bcf86cd799439033'
    });

    try {
      const { req, res, waitForResponse } = createMockHttp(
        'POST',
        '/api/incidents',
        {
          category: 'MEDICAL',
          severity: 5,
          victimCount: 3,
          description: 'Severe cardiac arrest incident in Jodhpur Center',
          location: { latitude: 26.2918, longitude: 73.0168 }
        },
        { authorization: `Bearer ${token}` }
      );

      app(req, res);
      const result = await waitForResponse();

      assert.equal(result.statusCode, 201);
      assert.equal(result.body.success, true);
      assert.equal(result.body.data.incident.category, 'MEDICAL');
      assert.equal(result.body.data.incident.severity, 5);
      assert.equal(result.body.data.incident.status, 'REPORTED');
      assert.equal(result.body.data.incident.reportedBy, mockCitizen.id);
    } finally {
      User.findById = origFindById;
      Incident.create = origCreate;
      __setConnectionStateOverride(null);
    }
  });

  it('POST /api/incidents should reject outside boundary coordinates with 400', async () => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });

    const mockCitizen = {
      _id: '507f1f77bcf86cd799439022',
      id: '507f1f77bcf86cd799439022',
      role: 'CITIZEN',
      isActive: true
    };
    const token = generateToken(mockCitizen);

    const origFindById = User.findById;
    User.findById = async () => mockCitizen;

    try {
      const { req, res, waitForResponse } = createMockHttp(
        'POST',
        '/api/incidents',
        {
          category: 'FIRE',
          severity: 3,
          location: { latitude: 28.0229, longitude: 73.3119 } // Bikaner proxy (outside Jodhpur)
        },
        { authorization: `Bearer ${token}` }
      );

      app(req, res);
      const result = await waitForResponse();

      assert.equal(result.statusCode, 400);
      assert.equal(result.body.success, false);
      assert.equal(result.body.error.code, 'OUTSIDE_SERVICE_AREA');
    } finally {
      User.findById = origFindById;
      __setConnectionStateOverride(null);
    }
  });

  it('GET /api/incidents should deny CITIZEN with 403 Forbidden', async () => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });

    const mockCitizen = {
      _id: '507f1f77bcf86cd799439022',
      id: '507f1f77bcf86cd799439022',
      role: 'CITIZEN',
      isActive: true
    };
    const token = generateToken(mockCitizen);

    const origFindById = User.findById;
    User.findById = async () => mockCitizen;

    try {
      const { req, res, waitForResponse } = createMockHttp(
        'GET',
        '/api/incidents',
        {},
        { authorization: `Bearer ${token}` }
      );

      app(req, res);
      const result = await waitForResponse();

      assert.equal(result.statusCode, 403);
      assert.equal(result.body.success, false);
      assert.equal(result.body.error.code, 'FORBIDDEN');
    } finally {
      User.findById = origFindById;
      __setConnectionStateOverride(null);
    }
  });

  it('GET /api/incidents should allow OPERATOR and return 200', async () => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });

    const mockOperator = {
      _id: '507f1f77bcf86cd799439088',
      id: '507f1f77bcf86cd799439088',
      role: 'OPERATOR',
      isActive: true
    };
    const token = generateToken(mockOperator);

    const origFindById = User.findById;
    const origCount = Incident.countDocuments;
    const origFind = Incident.find;

    User.findById = async () => mockOperator;
    Incident.countDocuments = async () => 1;
    const queryChain = {
      populate() { return this; },
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      lean: async () => [
        {
          incidentId: 887766,
          category: 'ROAD_ACCIDENT',
          severity: 4,
          victimCount: 2,
          status: 'REPORTED',
          latitude: 26.2918,
          longitude: 73.0168,
          reportedBy: { _id: 'user-1', name: 'Citizen Jane', email: 'jane@example.com' },
          reportedAt: new Date()
        }
      ]
    };
    Incident.find = () => queryChain;

    try {
      const { req, res, waitForResponse } = createMockHttp(
        'GET',
        '/api/incidents',
        {},
        { authorization: `Bearer ${token}` }
      );

      app(req, res);
      const result = await waitForResponse();

      assert.equal(result.statusCode, 200);
      assert.equal(result.body.success, true);
      assert.equal(result.body.data.incidents.length, 1);
      assert.equal(result.body.data.incidents[0].incidentId, 887766);
    } finally {
      User.findById = origFindById;
      Incident.countDocuments = origCount;
      Incident.find = origFind;
      __setConnectionStateOverride(null);
    }
  });
});

