process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import { generateToken } from '../src/utils/jwt.js';
import { __setConnectionStateOverride } from '../src/config/database.js';

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

describe('Phase 4.3 — Control Room Incident Verification & Management', () => {
  const citizenA = {
    _id: '507f1f77bcf86cd799439001',
    id: '507f1f77bcf86cd799439001',
    name: 'Citizen Alice',
    email: 'alice@example.com',
    role: 'CITIZEN',
    isActive: true
  };

  const citizenB = {
    _id: '507f1f77bcf86cd799439002',
    id: '507f1f77bcf86cd799439002',
    name: 'Citizen Bob',
    email: 'bob@example.com',
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

  const adminUser = {
    _id: '507f1f77bcf86cd799439099',
    id: '507f1f77bcf86cd799439099',
    name: 'Admin Eve',
    email: 'admin@jodhpur.emergency.gov.in',
    role: 'ADMIN',
    isActive: true
  };

  const tokenCitizenA = generateToken(citizenA);
  const tokenCitizenB = generateToken(citizenB);
  const tokenOperator = generateToken(operatorUser);
  const tokenAdmin = generateToken(adminUser);

  describe('Incident Detail API (GET /api/incidents/:incidentId)', () => {
    it('should allow OPERATOR to view complete incident detail including audit history', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      const origFindOne = Incident.findOne;

      User.findById = async () => operatorUser;
      Incident.findOne = () => ({
        populate: function () { return this; },
        then: function (resolve) {
          resolve({
            incidentId: 1001,
            category: 'ROAD_ACCIDENT',
            severity: 4,
            victimCount: 2,
            status: 'REPORTED',
            description: 'Major collision near Paota circle',
            latitude: 26.2918,
            longitude: 73.0168,
            reportedBy: { _id: citizenA._id, name: citizenA.name, email: citizenA.email },
            reportedAt: new Date(),
            auditHistory: [
              {
                action: 'REPORTED',
                performedBy: { _id: citizenA._id, name: citizenA.name, role: 'CITIZEN' },
                performedAt: new Date(),
                previousStatus: null,
                newStatus: 'REPORTED'
              }
            ]
          });
        }
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/1001',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.incident.incidentId, 1001);
        assert.ok(result.body.data.incident.reportedBy);
        assert.equal(result.body.data.incident.reportedBy.name, 'Citizen Alice');
        assert.ok(Array.isArray(result.body.data.incident.auditHistory));
        assert.equal(result.body.data.incident.auditHistory[0].action, 'REPORTED');
      } finally {
        User.findById = origFindById;
        Incident.findOne = origFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('should allow the owner citizen to view their own incident report details', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      const origFindOne = Incident.findOne;

      User.findById = async () => citizenA;
      Incident.findOne = () => ({
        populate: function () { return this; },
        then: function (resolve) {
          resolve({
            incidentId: 1001,
            category: 'ROAD_ACCIDENT',
            severity: 4,
            victimCount: 2,
            status: 'REPORTED',
            description: 'Major collision near Paota circle',
            latitude: 26.2918,
            longitude: 73.0168,
            reportedBy: { _id: citizenA._id, name: citizenA.name, email: citizenA.email },
            reportedAt: new Date()
          });
        }
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/1001',
          {},
          { authorization: `Bearer ${tokenCitizenA}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.incident.incidentId, 1001);
      } finally {
        User.findById = origFindById;
        Incident.findOne = origFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('should deny a citizen from viewing another citizen incident report with 403 Forbidden', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      const origFindOne = Incident.findOne;

      // Caller is Citizen B, but incident was reported by Citizen A
      User.findById = async () => citizenB;
      Incident.findOne = () => ({
        populate: function () { return this; },
        then: function (resolve) {
          resolve({
            incidentId: 1001,
            category: 'ROAD_ACCIDENT',
            severity: 4,
            reportedBy: { _id: citizenA._id, name: citizenA.name, email: citizenA.email }
          });
        }
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/1001',
          {},
          { authorization: `Bearer ${tokenCitizenB}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 403);
        assert.equal(result.body.success, false);
        assert.equal(result.body.error.code, 'FORBIDDEN');
      } finally {
        User.findById = origFindById;
        Incident.findOne = origFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('should return 400 for non-numeric or invalid incident ID parameter', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      User.findById = async () => operatorUser;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/not-a-number',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.error.code, 'INVALID_INCIDENT_ID');
      } finally {
        User.findById = origFindById;
        __setConnectionStateOverride(null);
      }
    });

    it('should return 404 if incident does not exist', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      const origFindOne = Incident.findOne;

      User.findById = async () => operatorUser;
      Incident.findOne = () => ({
        populate: function () { return this; },
        then: function (resolve) { resolve(null); }
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/999999',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 404);
        assert.equal(result.body.error.code, 'INCIDENT_NOT_FOUND');
      } finally {
        User.findById = origFindById;
        Incident.findOne = origFindOne;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('Incident Verification (PATCH /api/incidents/:incidentId/verify)', () => {
    it('should allow OPERATOR to verify a REPORTED incident and record audit entry', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      let capturedUpdateQuery = null;
      let capturedUpdateDoc = null;
      const origFindById = User.findById;
      const origFindOneAndUpdate = Incident.findOneAndUpdate;

      User.findById = async () => operatorUser;
      Incident.findOneAndUpdate = (query, doc) => {
        capturedUpdateQuery = query;
        capturedUpdateDoc = doc;
        return {
          populate: function () { return this; },
          then: function (resolve) {
            resolve({
              incidentId: 1001,
              status: 'VERIFIED',
              category: 'ROAD_ACCIDENT',
              severity: 4,
              victimCount: 2,
              verifiedAt: new Date(),
              verifiedBy: { _id: operatorUser._id, name: operatorUser.name, email: operatorUser.email },
              verificationNotes: 'Caller confirmed exact location near AIIMS Pali Road.'
            });
          }
        };
      };

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'PATCH',
          '/api/incidents/1001/verify',
          {
            verificationNotes: 'Caller confirmed exact location near AIIMS Pali Road.'
          },
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.incident.status, 'VERIFIED');
        assert.equal(result.body.data.incident.verificationNotes, 'Caller confirmed exact location near AIIMS Pali Road.');

        // Verify atomic conditional update query enforces status: 'REPORTED'
        assert.equal(capturedUpdateQuery.incidentId, 1001);
        assert.equal(capturedUpdateQuery.status, 'REPORTED');
        assert.equal(capturedUpdateDoc.$set.status, 'VERIFIED');
        assert.equal(capturedUpdateDoc.$set.verifiedBy, operatorUser._id);
        assert.equal(capturedUpdateDoc.$push.auditHistory.action, 'VERIFIED');
      } finally {
        User.findById = origFindById;
        Incident.findOneAndUpdate = origFindOneAndUpdate;
        __setConnectionStateOverride(null);
      }
    });

    it('should reject verification by a CITIZEN with 403 Forbidden', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      User.findById = async () => citizenA;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'PATCH',
          '/api/incidents/1001/verify',
          { verificationNotes: 'Citizen trying to self-verify' },
          { authorization: `Bearer ${tokenCitizenA}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 403);
        assert.equal(result.body.error.code, 'FORBIDDEN');
      } finally {
        User.findById = origFindById;
        __setConnectionStateOverride(null);
      }
    });

    it('should return 409 Conflict if incident is already VERIFIED or REJECTED (State Conflict)', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      const origFindOneAndUpdate = Incident.findOneAndUpdate;
      const origFindOne = Incident.findOne;

      User.findById = async () => operatorUser;
      // findOneAndUpdate fails because status is NOT 'REPORTED'
      Incident.findOneAndUpdate = () => ({
        populate: function () { return this; },
        then: function (resolve) { resolve(null); }
      });
      // Existing incident is already VERIFIED
      Incident.findOne = async () => ({
        incidentId: 1001,
        status: 'VERIFIED'
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'PATCH',
          '/api/incidents/1001/verify',
          { verificationNotes: 'Second operator attempt' },
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 409);
        assert.equal(result.body.success, false);
        assert.equal(result.body.error.code, 'INCIDENT_STATE_CONFLICT');
        assert.equal(result.body.error.currentStatus, 'VERIFIED');
      } finally {
        User.findById = origFindById;
        Incident.findOneAndUpdate = origFindOneAndUpdate;
        Incident.findOne = origFindOne;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('Incident Rejection (PATCH /api/incidents/:incidentId/reject)', () => {
    it('should allow OPERATOR to reject an invalid/duplicate REPORTED incident', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      let capturedUpdateQuery = null;
      let capturedUpdateDoc = null;
      const origFindById = User.findById;
      const origFindOneAndUpdate = Incident.findOneAndUpdate;

      User.findById = async () => operatorUser;
      Incident.findOneAndUpdate = (query, doc) => {
        capturedUpdateQuery = query;
        capturedUpdateDoc = doc;
        return {
          populate: function () { return this; },
          then: function (resolve) {
            resolve({
              incidentId: 1002,
              status: 'REJECTED',
              category: 'FIRE',
              severity: 2,
              rejectedAt: new Date(),
              rejectedBy: { _id: operatorUser._id, name: operatorUser.name, email: operatorUser.email },
              rejectionReason: 'Duplicate emergency call for already addressed incident.'
            });
          }
        };
      };

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'PATCH',
          '/api/incidents/1002/reject',
          {
            rejectionReason: 'Duplicate emergency call for already addressed incident.'
          },
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.incident.status, 'REJECTED');
        assert.equal(result.body.data.incident.rejectionReason, 'Duplicate emergency call for already addressed incident.');

        assert.equal(capturedUpdateQuery.incidentId, 1002);
        assert.equal(capturedUpdateQuery.status, 'REPORTED');
        assert.equal(capturedUpdateDoc.$set.status, 'REJECTED');
        assert.equal(capturedUpdateDoc.$set.rejectedBy, operatorUser._id);
        assert.equal(capturedUpdateDoc.$push.auditHistory.action, 'REJECTED');
      } finally {
        User.findById = origFindById;
        Incident.findOneAndUpdate = origFindOneAndUpdate;
        __setConnectionStateOverride(null);
      }
    });

    it('should reject rejection request if rejectionReason is missing or too short', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      User.findById = async () => operatorUser;

      try {
        // Missing reason
        const { req: req1, res: res1, waitForResponse: wait1 } = createMockHttp(
          'PATCH',
          '/api/incidents/1002/reject',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );
        app(req1, res1);
        const resMissing = await wait1();
        assert.equal(resMissing.statusCode, 400);
        assert.equal(resMissing.body.error.code, 'INVALID_REJECTION_REASON');

        // Reason too short (< 3 chars)
        const { req: req2, res: res2, waitForResponse: wait2 } = createMockHttp(
          'PATCH',
          '/api/incidents/1002/reject',
          { rejectionReason: 'No' },
          { authorization: `Bearer ${tokenOperator}` }
        );
        app(req2, res2);
        const resShort = await wait2();
        assert.equal(resShort.statusCode, 400);
        assert.equal(resShort.body.error.code, 'INVALID_REJECTION_REASON');
      } finally {
        User.findById = origFindById;
        __setConnectionStateOverride(null);
      }
    });

    it('should reject rejection attempt by CITIZEN with 403 Forbidden', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      User.findById = async () => citizenA;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'PATCH',
          '/api/incidents/1002/reject',
          { rejectionReason: 'Citizen trying to cancel/reject' },
          { authorization: `Bearer ${tokenCitizenA}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 403);
        assert.equal(result.body.error.code, 'FORBIDDEN');
      } finally {
        User.findById = origFindById;
        __setConnectionStateOverride(null);
      }
    });

    it('should return 409 Conflict if trying to reject an already REJECTED or VERIFIED incident', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      const origFindOneAndUpdate = Incident.findOneAndUpdate;
      const origFindOne = Incident.findOne;

      User.findById = async () => operatorUser;
      Incident.findOneAndUpdate = () => ({
        populate: function () { return this; },
        then: function (resolve) { resolve(null); }
      });
      Incident.findOne = async () => ({
        incidentId: 1002,
        status: 'REJECTED'
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'PATCH',
          '/api/incidents/1002/reject',
          { rejectionReason: 'Second rejection attempt' },
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 409);
        assert.equal(result.body.error.code, 'INCIDENT_STATE_CONFLICT');
        assert.equal(result.body.error.currentStatus, 'REJECTED');
      } finally {
        User.findById = origFindById;
        Incident.findOneAndUpdate = origFindOneAndUpdate;
        Incident.findOne = origFindOne;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('Operator Incident Registry Enhanced Filtering (GET /api/incidents)', () => {
    it('should support severity, date range, and incidentId filtering', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      let capturedQuery = null;
      const origFindById = User.findById;
      const origCount = Incident.countDocuments;
      const origFind = Incident.find;

      User.findById = async () => operatorUser;
      Incident.countDocuments = async (q) => {
        capturedQuery = q;
        return 1;
      };
      Incident.find = () => ({
        populate: function () { return this; },
        sort: function () { return this; },
        skip: function () { return this; },
        limit: function () { return this; },
        lean: async () => [
          {
            incidentId: 1001,
            category: 'FIRE',
            severity: 5,
            status: 'REPORTED',
            createdAt: new Date('2026-11-18T00:00:00.000Z')
          }
        ]
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents?severity=5&incidentId=1001&startDate=2026-11-17T00:00:00.000Z&endDate=2026-11-19T00:00:00.000Z',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(capturedQuery.severity, 5);
        assert.equal(capturedQuery.incidentId, 1001);
        assert.ok(capturedQuery.createdAt.$gte instanceof Date);
        assert.ok(capturedQuery.createdAt.$lte instanceof Date);
      } finally {
        User.findById = origFindById;
        Incident.countDocuments = origCount;
        Incident.find = origFind;
        __setConnectionStateOverride(null);
      }
    });

    it('should reject invalid severity filter (< 1 or > 5) with 400', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      User.findById = async () => operatorUser;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents?severity=9',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.error.code, 'INVALID_SEVERITY_FILTER');
      } finally {
        User.findById = origFindById;
        __setConnectionStateOverride(null);
      }
    });

    it('should reject invalid date format with 400 INVALID_DATE_FILTER', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      User.findById = async () => operatorUser;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents?startDate=not-a-date',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.error.code, 'INVALID_DATE_FILTER');
      } finally {
        User.findById = origFindById;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('Citizen Status Visibility (GET /api/incidents/my)', () => {
    it('should expose verification and rejection details on own incidents for citizens', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origFindById = User.findById;
      const origCount = Incident.countDocuments;
      const origFind = Incident.find;

      User.findById = async () => citizenA;
      Incident.countDocuments = async () => 2;
      Incident.find = () => ({
        sort: function () { return this; },
        skip: function () { return this; },
        limit: function () { return this; },
        lean: async () => [
          {
            incidentId: 1001,
            category: 'MEDICAL',
            severity: 4,
            status: 'VERIFIED',
            verifiedAt: new Date('2026-11-18T01:00:00.000Z'),
            verificationNotes: 'Dispatched proxy unit',
            reportedAt: new Date()
          },
          {
            incidentId: 1002,
            category: 'FIRE',
            severity: 1,
            status: 'REJECTED',
            rejectedAt: new Date('2026-11-18T01:05:00.000Z'),
            rejectionReason: 'False alarm / duplicate report',
            reportedAt: new Date()
          }
        ]
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/my',
          {},
          { authorization: `Bearer ${tokenCitizenA}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.incidents.length, 2);

        const verifiedInc = result.body.data.incidents.find((i) => i.incidentId === 1001);
        assert.equal(verifiedInc.status, 'VERIFIED');
        assert.ok(verifiedInc.verifiedAt);
        assert.equal(verifiedInc.verificationNotes, 'Dispatched proxy unit');

        const rejectedInc = result.body.data.incidents.find((i) => i.incidentId === 1002);
        assert.equal(rejectedInc.status, 'REJECTED');
        assert.ok(rejectedInc.rejectedAt);
        assert.equal(rejectedInc.rejectionReason, 'False alarm / duplicate report');
      } finally {
        User.findById = origFindById;
        Incident.countDocuments = origCount;
        Incident.find = origFind;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('Security Check: Database-Backed Role Verification', () => {
    it('should use current database role even if token carries an outdated role', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      // Generate token where payload says role is ADMIN
      const tokenWithOldRole = generateToken({ _id: 'user-downgraded', role: 'ADMIN' });

      const origFindById = User.findById;
      // Database record has been downgraded to CITIZEN
      User.findById = async () => ({
        _id: 'user-downgraded',
        id: 'user-downgraded',
        role: 'CITIZEN', // Live DB says CITIZEN
        isActive: true
      });

      try {
        // Attempt to call OPERATOR/ADMIN verify endpoint with token that says ADMIN in payload
        const { req, res, waitForResponse } = createMockHttp(
          'PATCH',
          '/api/incidents/1001/verify',
          { verificationNotes: 'Should fail because DB role is CITIZEN' },
          { authorization: `Bearer ${tokenWithOldRole}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 403, 'Must reject because database role is CITIZEN');
        assert.equal(result.body.error.code, 'FORBIDDEN');
      } finally {
        User.findById = origFindById;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('Control Room Dashboard Global Aggregation (GET /api/incidents/stats)', () => {
    it('should return 200 with global aggregate counts for OPERATOR role', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });
      const opToken = generateToken({ _id: operatorUser._id, role: 'OPERATOR' });

      const origAggregate = Incident.aggregate;
      const origFindById = User.findById;

      User.findById = async () => operatorUser;
      Incident.aggregate = async (pipeline) => {
        assert.ok(Array.isArray(pipeline), 'Aggregation pipeline must be an array');
        assert.deepEqual(pipeline[0], { $group: { _id: '$status', count: { $sum: 1 } } });
        return [
          { _id: 'REPORTED', count: 4 },
          { _id: 'VERIFIED', count: 10 },
          { _id: 'ALLOCATED', count: 2 },
          { _id: 'DISPATCHED', count: 3 },
          { _id: 'ON_SCENE', count: 1 },
          { _id: 'RESOLVED', count: 15 },
          { _id: 'REJECTED', count: 6 },
        ];
      };

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/stats',
          {},
          { authorization: `Bearer ${opToken}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.totalIncidents, 41);
        assert.equal(result.body.data.pendingReported, 4);
        assert.equal(result.body.data.verifiedCount, 10);
        assert.equal(result.body.data.rejectedCount, 6);
        assert.equal(result.body.data.activeIncidents, 20); // 4 + 10 + 2 + 3 + 1
      } finally {
        Incident.aggregate = origAggregate;
        User.findById = origFindById;
        __setConnectionStateOverride(null);
      }
    });

    it('should reject CITIZEN role from accessing global statistics with 403 Forbidden', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });
      const citizenToken = generateToken({ _id: citizenA._id, role: 'CITIZEN' });

      const origFindById = User.findById;
      User.findById = async () => citizenA;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/stats',
          {},
          { authorization: `Bearer ${citizenToken}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 403);
        assert.equal(result.body.error.code, 'FORBIDDEN');
      } finally {
        User.findById = origFindById;
        __setConnectionStateOverride(null);
      }
    });

    it('should return 503 DATABASE_UNAVAILABLE when database is disconnected during stats retrieval', async () => {
      __setConnectionStateOverride({ connected: false, state: 'disconnected' });
      const opToken = generateToken({ _id: operatorUser._id, role: 'OPERATOR' });

      const origFindById = User.findById;
      User.findById = async () => operatorUser;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/incidents/stats',
          {},
          { authorization: `Bearer ${opToken}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 503);
        assert.equal(result.body.error.code, 'DATABASE_UNAVAILABLE');
      } finally {
        User.findById = origFindById;
        __setConnectionStateOverride(null);
      }
    });

    it('should use atomic conditional update without transaction for single incident verification', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });
      const opToken = generateToken({ _id: operatorUser._id, role: 'OPERATOR' });

      const origFindById = User.findById;
      const origFindOneAndUpdate = Incident.findOneAndUpdate;

      User.findById = async () => operatorUser;

      let capturedQuery = null;
      Incident.findOneAndUpdate = (query, update, options) => {
        capturedQuery = query;
        return {
          populate: function () { return this; },
          then: function (resolve) {
            resolve({
              incidentId: 1001,
              status: 'VERIFIED',
              category: 'FIRE',
              severity: 4,
              victimCount: 1,
              verifiedAt: new Date(),
              verificationNotes: 'Atomic check',
              reportedBy: { _id: citizenA._id, name: citizenA.name, email: citizenA.email },
              verifiedBy: { _id: operatorUser._id, name: operatorUser.name, email: operatorUser.email },
            });
          }
        };
      };

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'PATCH',
          '/api/incidents/1001/verify',
          { verificationNotes: 'Atomic check' },
          { authorization: `Bearer ${opToken}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        // Verify the exact atomic conditional predicate
        assert.deepEqual(capturedQuery, { incidentId: 1001, status: 'REPORTED' });
      } finally {
        User.findById = origFindById;
        Incident.findOneAndUpdate = origFindOneAndUpdate;
        __setConnectionStateOverride(null);
      }
    });
  });
});

