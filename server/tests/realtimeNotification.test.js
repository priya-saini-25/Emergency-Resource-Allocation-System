process.env.NODE_ENV = 'test';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import { generateToken } from '../src/utils/jwt.js';
import { __setConnectionStateOverride } from '../src/config/database.js';
import {
  registerSSEClient,
  removeClient,
  emitControlRoomNotification,
  getActiveClientCount,
  __resetNotificationClients
} from '../src/services/realtimeNotificationService.js';

function createMockResponse() {
  const writtenData = [];
  let headers = {};
  let statusCode = 200;
  let isClosed = false;
  const closeListeners = [];

  const res = {
    writeHead(code, hdrs) {
      statusCode = code;
      headers = { ...headers, ...hdrs };
      return this;
    },
    setHeader(name, val) {
      headers[name.toLowerCase()] = val;
      return this;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
    write(chunk) {
      writtenData.push(chunk.toString());
      return true;
    },
    end() {
      isClosed = true;
      for (const fn of closeListeners) fn();
      return this;
    },
    on(event, fn) {
      if (event === 'close') closeListeners.push(fn);
      return this;
    },
    flushHeaders() {},
    // Test inspection getters
    _getWrittenData: () => writtenData,
    _getHeaders: () => headers,
    _getStatusCode: () => statusCode,
    _triggerClose() {
      isClosed = true;
      for (const fn of closeListeners) fn();
    }
  };

  return res;
}

function createMockHttp(method, url, body = {}, headers = {}) {
  const parsedUrl = new URL(url, 'http://localhost');
  const query = {};
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    query[key] = value;
  }

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
    query
  };

  let resolveResponse;
  const promise = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  let resolveHeaders;
  const headersPromise = new Promise((resolve) => {
    resolveHeaders = resolve;
  });

  const writtenChunks = [];
  const res = {
    statusCode: 200,
    headersSent: false,
    _headers: {},
    writeHead(code, hdrs) {
      this.statusCode = code;
      this.headersSent = true;
      this._headers = { ...this._headers, ...hdrs };
      resolveHeaders({ statusCode: this.statusCode, headers: this._headers });
      return this;
    },
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
    write(chunk) {
      writtenChunks.push(chunk.toString());
      return true;
    },
    json(data) {
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: data, headers: this._headers });
      return this;
    },
    send(data) {
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: data, headers: this._headers });
      return this;
    },
    end() {
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: writtenChunks.join(''), headers: this._headers });
    },
    on() { return this; },
    flushHeaders() {}
  };

  return { req, res, waitForResponse: () => promise, waitForHeaders: () => headersPromise, writtenChunks };
}

describe('Phase 8.4 — Real-Time In-App Notification System Tests', () => {
  const citizenUser = {
    _id: '507f1f77bcf86cd799439001',
    id: '507f1f77bcf86cd799439001',
    name: 'Citizen Alice',
    email: 'alice@example.com',
    role: 'CITIZEN',
    isActive: true
  };

  const operatorUser = {
    _id: '507f1f77bcf86cd799439088',
    id: '507f1f77bcf86cd799439088',
    name: 'Operator Dan',
    email: 'operator@jodhpur.emergency.gov.in',
    role: 'OPERATOR',
    isActive: true
  };

  const tokenCitizen = generateToken(citizenUser);
  const tokenOperator = generateToken(operatorUser);

  beforeEach(() => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });
    __resetNotificationClients();
  });

  afterEach(() => {
    __setConnectionStateOverride(null);
    __resetNotificationClients();
  });

  describe('1. SSE Stream Service Unit Tests', () => {
    it('should configure text/event-stream headers and send CONNECTED handshake', () => {
      const mockRes = createMockResponse();
      const clientId = registerSSEClient('user-1', 'OPERATOR', mockRes);

      assert.ok(clientId.startsWith('sse-'));
      assert.equal(getActiveClientCount(), 1);

      const headers = mockRes._getHeaders();
      assert.equal(headers['Content-Type'], 'text/event-stream');
      assert.equal(headers['Cache-Control'], 'no-cache, no-transform');
      assert.equal(headers['Connection'], 'keep-alive');

      const data = mockRes._getWrittenData();
      assert.ok(data.length > 0);
      assert.ok(data[0].includes('CONNECTED'));
      assert.ok(data[0].includes('Real-time notification stream established'));
    });

    it('should broadcast NEW_EMERGENCY_REPORT event only to OPERATOR and ADMIN', () => {
      const resOperator = createMockResponse();
      const resAdmin = createMockResponse();

      registerSSEClient('op-1', 'OPERATOR', resOperator);
      registerSSEClient('admin-1', 'ADMIN', resAdmin);

      const payload = {
        incidentId: 1001,
        category: 'FIRE',
        severity: 4,
        location: { latitude: 26.29, longitude: 73.02, locationName: 'Paota' },
        reportedAt: new Date().toISOString()
      };

      const count = emitControlRoomNotification('NEW_EMERGENCY_REPORT', payload);
      assert.equal(count, 2);

      const opData = resOperator._getWrittenData();
      const lastOpMsg = opData[opData.length - 1];
      assert.ok(lastOpMsg.includes('NEW_EMERGENCY_REPORT'));
      assert.ok(lastOpMsg.includes('1001'));
      assert.ok(lastOpMsg.includes('Paota'));

      const adminData = resAdmin._getWrittenData();
      const lastAdminMsg = adminData[adminData.length - 1];
      assert.ok(lastAdminMsg.includes('NEW_EMERGENCY_REPORT'));
    });

    it('should sanitize broadcast payload and never leak reporter personal phone numbers', () => {
      const resOperator = createMockResponse();
      registerSSEClient('op-1', 'OPERATOR', resOperator);

      const safePayload = {
        incidentId: 1002,
        category: 'MEDICAL_EMERGENCY',
        severity: 5,
        location: { latitude: 26.28, longitude: 73.01, locationName: 'Sojati Gate' },
        reportedAt: new Date().toISOString()
      };

      emitControlRoomNotification('NEW_EMERGENCY_REPORT', safePayload);

      const opData = resOperator._getWrittenData();
      const msg = opData[opData.length - 1];
      assert.ok(!msg.includes('reporterPhone'));
      assert.ok(!msg.includes('callerContact'));
      assert.ok(!msg.includes('alternatePhone'));
    });

    it('should clean up client on disconnect', () => {
      const mockRes = createMockResponse();
      const clientId = registerSSEClient('op-1', 'OPERATOR', mockRes);
      assert.equal(getActiveClientCount(), 1);

      mockRes._triggerClose();
      assert.equal(getActiveClientCount(), 0);
    });
  });

  describe('2. Notification Stream HTTP API Contracts & RBAC', () => {
    it('GET /api/notifications/stream should reject unauthenticated requests with 401', async () => {
      const { req, res, waitForResponse } = createMockHttp('GET', '/api/notifications/stream');
      app(req, res);
      const result = await waitForResponse();

      assert.equal(result.statusCode, 401);
      assert.equal(result.body.success, false);
      assert.equal(result.body.error.code, 'UNAUTHORIZED');
    });

    it('GET /api/notifications/stream should reject CITIZEN with 403 Forbidden', async () => {
      const origUserFind = User.findById;
      User.findById = async () => citizenUser;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/notifications/stream',
          {},
          { authorization: `Bearer ${tokenCitizen}` }
        );
        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 403);
        assert.equal(result.body.success, false);
        assert.equal(result.body.error.code, 'FORBIDDEN');
      } finally {
        User.findById = origUserFind;
      }
    });

    it('GET /api/notifications/stream should establish SSE stream for OPERATOR using Bearer header', async () => {
      const origUserFind = User.findById;
      User.findById = async () => operatorUser;

      try {
        const { req, res, waitForHeaders, writtenChunks } = createMockHttp(
          'GET',
          '/api/notifications/stream',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );
        app(req, res);
        const headerResult = await waitForHeaders();

        assert.equal(headerResult.statusCode, 200);
        assert.equal(headerResult.headers['Content-Type'], 'text/event-stream');
        assert.ok(writtenChunks.length > 0);
        assert.ok(writtenChunks[0].includes('CONNECTED'));
      } finally {
        User.findById = origUserFind;
      }
    });

    it('GET /api/notifications/stream should support query token (?token=...) for browser EventSource', async () => {
      const origUserFind = User.findById;
      User.findById = async () => operatorUser;

      try {
        const { req, res, waitForHeaders, writtenChunks } = createMockHttp(
          'GET',
          `/api/notifications/stream?token=${tokenOperator}`
        );
        app(req, res);
        const headerResult = await waitForHeaders();

        assert.equal(headerResult.statusCode, 200);
        assert.equal(headerResult.headers['Content-Type'], 'text/event-stream');
        assert.ok(writtenChunks.length > 0);
        assert.ok(writtenChunks[0].includes('CONNECTED'));
      } finally {
        User.findById = origUserFind;
      }
    });
  });

  describe('3. Citizen Emergency Submission Triggers Operator Real-Time Notification', () => {
    it('should emit NEW_EMERGENCY_REPORT to active operators upon successful citizen report', async () => {
      const origUserFind = User.findById;
      const origIncidentCreate = Incident.create;

      User.findById = async () => citizenUser;

      // Register an operator SSE client
      const operatorRes = createMockResponse();
      registerSSEClient(operatorUser.id, 'OPERATOR', operatorRes);
      assert.equal(getActiveClientCount(), 1);

      Incident.create = async (doc) => ({
        ...doc,
        _id: '674000000000000000000001'
      });

      try {
        const reportPayload = {
          category: 'FIRE',
          severity: 4,
          description: 'Factory fire near Basni Industrial Area',
          location: {
            latitude: 26.2415,
            longitude: 73.0185
          },
          address: 'Basni Phase 2, Jodhpur',
          landmark: 'Near Overbridge',
          reporterName: 'Alice',
          reporterPhone: '+919876543210'
        };

        const { req, res, waitForResponse } = createMockHttp(
          'POST',
          '/api/incidents',
          reportPayload,
          { authorization: `Bearer ${tokenCitizen}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 201);
        assert.equal(result.body.success, true);
        const newIncidentId = result.body.data.incident.incidentId;
        assert.ok(newIncidentId);

        // Verify the operator received the SSE notification
        const writtenData = operatorRes._getWrittenData();
        assert.ok(writtenData.length >= 2, 'Should receive handshake + emergency event');
        const eventChunk = writtenData[writtenData.length - 1];
        assert.ok(eventChunk.includes('NEW_EMERGENCY_REPORT'));
        assert.ok(eventChunk.includes(String(newIncidentId)));
        assert.ok(eventChunk.includes('FIRE'));

        // Ensure reporter personal phone is NOT in the real-time popup payload
        assert.ok(!eventChunk.includes('+919876543210'), 'Reporter phone must be excluded from real-time popup payload');
      } finally {
        User.findById = origUserFind;
        Incident.create = origIncidentCreate;
      }
    });
  });
});
