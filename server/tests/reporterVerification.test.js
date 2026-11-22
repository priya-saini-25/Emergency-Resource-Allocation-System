process.env.NODE_ENV = 'test';
import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Incident, { VERIFICATION_OUTCOMES } from '../src/models/Incident.js';
import {
  createIncident,
  getIncidentById,
  verifyIncident,
  rejectIncident,
} from '../src/controllers/incidentController.js';
import { validateAndNormalizeIndianPhone, maskPhoneNumber } from '../src/utils/phoneUtils.js';
import { __setConnectionStateOverride } from '../src/config/database.js';

describe('Phase 8.1 — Citizen Reporter Contact & Operator Verification Workflow Tests', () => {
  before(() => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });
  });

  after(() => {
    __setConnectionStateOverride(null);
  });

  const citizenUser = {
    _id: '507f1f77bcf86cd799439011',
    id: '507f1f77bcf86cd799439011',
    name: 'Citizen Meera',
    email: 'meera@example.com',
    role: 'CITIZEN',
  };

  const otherCitizenUser = {
    _id: '507f1f77bcf86cd799439022',
    id: '507f1f77bcf86cd799439022',
    name: 'Citizen Rajesh',
    email: 'rajesh@example.com',
    role: 'CITIZEN',
  };

  const operatorUser = {
    _id: '507f1f77bcf86cd799439088',
    id: '507f1f77bcf86cd799439088',
    name: 'Operator Dan',
    email: 'operator@jodhpur.emergency.gov.in',
    role: 'OPERATOR',
  };

  // Helper to mock express req/res
  function mockReqRes(reqOptions = {}) {
    const req = {
      body: {},
      params: {},
      query: {},
      user: citizenUser,
      ...reqOptions,
    };

    let statusCode = 200;
    let responseData = null;

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    return {
      req,
      res,
      getStatus: () => statusCode,
      getData: () => responseData,
    };
  }

  // Chainable mock for Mongoose queries with populate()
  function mockChainable(result) {
    const obj = {
      populate() {
        return obj;
      },
      sort() {
        return obj;
      },
      skip() {
        return obj;
      },
      limit() {
        return obj;
      },
      lean() {
        return obj;
      },
      then(resolve, reject) {
        return Promise.resolve(result).then(resolve, reject);
      },
      catch(reject) {
        return Promise.resolve(result).catch(reject);
      },
    };
    return obj;
  }

  // 1. Phone Number Validation & Normalization Utility
  describe('1. Phone Number Validation & Normalization Utility', () => {
    it('should validate and normalize standard 10-digit Indian numbers starting with 6, 7, 8, or 9', () => {
      const validNumbers = [
        '9876543210',
        '8765432109',
        '7654321098',
        '6543210987',
      ];
      for (const num of validNumbers) {
        const res = validateAndNormalizeIndianPhone(num, true);
        assert.equal(res.isValid, true);
        assert.equal(res.normalized, `+91${num}`);
        assert.equal(res.error, null);
      }
    });

    it('should strip spaces, hyphens, parentheses, and dots and normalize correctly', () => {
      const formattedInputs = [
        '+91 98765 43210',
        '+91-98765-43210',
        '(98765) 43210',
        '98765.43210',
        '09876543210',
        '919876543210',
      ];
      for (const input of formattedInputs) {
        const res = validateAndNormalizeIndianPhone(input, true);
        assert.equal(res.isValid, true);
        assert.equal(res.normalized, '+919876543210');
      }
    });

    it('should reject numbers with non-Indian country codes (+1, +44, etc.)', () => {
      const international = ['+14155552671', '+447911123456', '+819012345678'];
      for (const num of international) {
        const res = validateAndNormalizeIndianPhone(num, true);
        assert.equal(res.isValid, false);
        assert.ok(res.error.includes('+91'));
      }
    });

    it('should reject numbers starting with invalid digits (0-5) or having invalid lengths', () => {
      const invalidNumbers = [
        '5876543210', // starts with 5
        '1234567890', // starts with 1
        '987654321',  // 9 digits
        '98765432100', // 11 digits
        'abcdefghij', // letters
      ];
      for (const num of invalidNumbers) {
        const res = validateAndNormalizeIndianPhone(num, true);
        assert.equal(res.isValid, false);
        assert.ok(res.error);
      }
    });

    it('should mask phone numbers for privacy display keeping only last 4 digits', () => {
      assert.equal(maskPhoneNumber('+919876543210'), '+91 ******3210');
      assert.equal(maskPhoneNumber('9876543210'), '+91 ******3210');
      assert.equal(maskPhoneNumber(''), '');
      assert.equal(maskPhoneNumber(null), '');
    });
  });

  // 2. Incident Intake Reporter Information Validation
  describe('2. Incident Intake Reporter Information Validation', () => {
    let origCreate;

    before(() => {
      origCreate = Incident.create;
    });

    after(() => {
      Incident.create = origCreate;
    });

    it('should accept valid reporterName and reporterPhone and store them normalized', async () => {
      let savedDoc = null;
      Incident.create = async (doc) => {
        savedDoc = doc;
        return {
          ...doc,
          _id: '607f1f77bcf86cd799439099',
        };
      };

      const { req, res, getStatus, getData } = mockReqRes({
        user: citizenUser,
        body: {
          category: 'FIRE',
          severity: 4,
          victimCount: 2,
          description: 'Structure fire visible near Sojati Gate',
          locationName: 'Sojati Gate, Jodhpur',
          reporterName: 'Sunita Sharma',
          reporterPhone: '9876543210',
          alternatePhone: '+91 8765432109',
          location: { latitude: 26.2978, longitude: 73.0185 },
        },
      });

      await createIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 201);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.data.incident.reporterName, 'Sunita Sharma');
      assert.equal(data.data.incident.reporterPhone, '+919876543210');
      assert.equal(savedDoc.reporterPhone, '+919876543210');
      assert.equal(savedDoc.alternatePhone, '+918765432109');
    });

    it('should reject malformed reporter phone with 400 and INVALID_PHONE_NUMBER', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        user: citizenUser,
        body: {
          category: 'FIRE',
          severity: 3,
          description: 'Small trash fire',
          reporterName: 'Sunita Sharma',
          reporterPhone: '12345', // malformed
          location: { latitude: 26.2978, longitude: 73.0185 },
        },
      });

      await createIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 400);
      const data = getData();
      assert.equal(data.error.code, 'INVALID_PHONE_NUMBER');
    });

    it('should reject explicitly empty reporter phone with 400 and MISSING_REPORTER_PHONE', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        user: citizenUser,
        body: {
          category: 'FIRE',
          severity: 3,
          description: 'Small trash fire',
          reporterName: 'Sunita Sharma',
          reporterPhone: '', // explicitly empty
          location: { latitude: 26.2978, longitude: 73.0185 },
        },
      });

      await createIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 400);
      const data = getData();
      assert.equal(data.error.code, 'MISSING_REPORTER_PHONE');
    });

    it('should reject invalid reporter name shorter than 2 chars with 400 and INVALID_REPORTER_NAME', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        user: citizenUser,
        body: {
          category: 'FIRE',
          severity: 3,
          description: 'Small trash fire',
          reporterName: 'A', // too short
          reporterPhone: '9876543210',
          location: { latitude: 26.2978, longitude: 73.0185 },
        },
      });

      await createIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 400);
      const data = getData();
      assert.equal(data.error.code, 'INVALID_REPORTER_NAME');
    });

    it('should preserve backward compatibility when reporterPhone and reporterName are omitted by legacy callers', async () => {
      let savedDoc = null;
      Incident.create = async (doc) => {
        savedDoc = doc;
        return {
          ...doc,
          _id: '607f1f77bcf86cd799439099',
        };
      };

      const { req, res, getStatus, getData } = mockReqRes({
        user: citizenUser,
        body: {
          category: 'FIRE',
          severity: 3,
          victimCount: 0,
          description: 'Legacy automated test report',
          location: { latitude: 26.2978, longitude: 73.0185 },
        },
      });

      await createIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 201);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.data.incident.reporterName, 'Citizen Meera'); // falls back to req.user.name
      assert.equal(data.data.incident.reporterPhone, '');
      assert.equal(savedDoc.reporterName, 'Citizen Meera');
      assert.equal(savedDoc.reporterPhone, '');
    });
  });

  // 3. C++ Decision Engine JSON Protocol Invariance
  describe('3. C++ Decision Engine JSON Protocol Invariance', () => {
    it('toEngineProtocol() must strictly exclude reporterName, reporterPhone, alternatePhone, and verificationHistory', () => {
      const incident = new Incident({
        incidentId: 17950910249991,
        category: 'FIRE',
        severity: 4,
        victimCount: 3,
        latitude: 26.2978,
        longitude: 73.0185,
        locationName: 'Sojati Gate, Jodhpur',
        reporterName: 'Sunita Sharma',
        reporterPhone: '+919876543210',
        alternatePhone: '+918765432109',
        latestVerificationOutcome: 'CONFIRMED',
        verificationHistory: [
          {
            outcome: 'CONFIRMED',
            performedBy: operatorUser._id,
            performedAt: new Date(),
            notes: 'Spoke with Sunita on phone; structure fire verified',
          },
        ],
      });

      const protocolPayload = incident.toEngineProtocol();

      // Verify algorithmic fields are present
      assert.equal(protocolPayload.incident_id, 17950910249991);
      assert.equal(protocolPayload.category, 'FIRE');
      assert.equal(protocolPayload.severity, 4);
      assert.equal(protocolPayload.victim_count, 3);
      assert.equal(protocolPayload.latitude, 26.2978);
      assert.equal(protocolPayload.longitude, 73.0185);

      // Verify reporter info & verification history are NEVER serialized for C++ engine
      assert.equal(protocolPayload.reporterName, undefined);
      assert.equal(protocolPayload.reporterPhone, undefined);
      assert.equal(protocolPayload.alternatePhone, undefined);
      assert.equal(protocolPayload.verificationHistory, undefined);
      assert.equal(protocolPayload.latestVerificationOutcome, undefined);
      assert.equal(protocolPayload.notes, undefined);
    });
  });

  // 4. Privacy & Role-Based Authorization on Incident Detail
  describe('4. Privacy & Role-Based Authorization on Incident Detail', () => {
    const mockIncidentDoc = {
      incidentId: 17950910249988,
      category: 'ROAD_ACCIDENT',
      severity: 3,
      victimCount: 1,
      status: 'REPORTED',
      description: 'Two-vehicle collision near Paota circle',
      locationName: 'Paota Circle, Jodhpur',
      latitude: 26.2978,
      longitude: 73.0185,
      reporterName: 'Meera Citizen',
      reporterPhone: '+919876543210',
      alternatePhone: '+918765432109',
      reportedBy: {
        _id: citizenUser._id,
        name: citizenUser.name,
        email: citizenUser.email,
      },
      reportedAt: new Date(),
      createdAt: new Date(),
      verificationHistory: [],
    };

    let origFindOne;

    before(() => {
      origFindOne = Incident.findOne;
      Incident.findOne = (query) => {
        if (query.incidentId === 17950910249988) {
          return mockChainable(mockIncidentDoc);
        }
        return mockChainable(null);
      };
    });

    after(() => {
      Incident.findOne = origFindOne;
    });

    it('should expose reporter phone, alternate phone, and verification outcome to OPERATOR', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        user: operatorUser,
        params: { incidentId: '17950910249988' },
      });

      await getIncidentById(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.data.incident.reporterName, 'Meera Citizen');
      assert.equal(data.data.incident.reporterPhone, '+919876543210');
      assert.equal(data.data.incident.alternatePhone, '+918765432109');
    });

    it('should expose reporterName but strictly sanitize reporterPhone and alternatePhone for CITIZEN owner', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        user: citizenUser,
        params: { incidentId: '17950910249988' },
      });

      await getIncidentById(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.data.incident.reporterName, 'Meera Citizen');
      assert.equal(data.data.incident.reporterPhone, undefined);
      assert.equal(data.data.incident.alternatePhone, undefined);
      assert.equal(data.data.incident.verificationHistory, undefined);
    });

    it('should reject access by unprivileged other citizen with 403 Forbidden', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        user: otherCitizenUser,
        params: { incidentId: '17950910249988' },
      });

      await getIncidentById(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 403);
      assert.equal(getData().error.code, 'FORBIDDEN');
    });
  });

  // 5. Structured Verification Outcomes & Concurrency Safety
  describe('5. Structured Verification Outcomes & Concurrency Safety', () => {
    let origFindOneAndUpdate;
    let origFindOne;
    let currentIncident;

    before(() => {
      origFindOneAndUpdate = Incident.findOneAndUpdate;
      origFindOne = Incident.findOne;
    });

    after(() => {
      Incident.findOneAndUpdate = origFindOneAndUpdate;
      Incident.findOne = origFindOne;
    });

    function setupIncident(status = 'REPORTED') {
      currentIncident = {
        incidentId: 17950910249977,
        category: 'FIRE',
        severity: 4,
        victimCount: 0,
        status,
        description: 'Warehouse fire',
        reporterName: 'Meera Citizen',
        reporterPhone: '+919876543210',
        latitude: 26.2978,
        longitude: 73.0185,
        reportedBy: { _id: citizenUser._id, name: citizenUser.name, email: citizenUser.email },
        reportedAt: new Date(),
        latestVerificationOutcome: null,
        duplicateOfIncidentId: null,
        verificationHistory: [],
      };

      Incident.findOne = (filter) => {
        if (filter.incidentId === currentIncident.incidentId) {
          return mockChainable(currentIncident);
        }
        return mockChainable(null);
      };

      Incident.findOneAndUpdate = (filter, update) => {
        if (filter.incidentId === currentIncident.incidentId && filter.status === currentIncident.status) {
          // Apply $set
          if (update.$set) {
            Object.assign(currentIncident, update.$set);
          }
          // Apply $push
          if (update.$push) {
            for (const key of Object.keys(update.$push)) {
              if (!currentIncident[key]) currentIncident[key] = [];
              currentIncident[key].push(update.$push[key]);
            }
          }
          return mockChainable(currentIncident);
        }
        return mockChainable(null);
      };
    }

    it('CONFIRMED outcome should transition REPORTED -> VERIFIED, record notes, and append verificationHistory', async () => {
      setupIncident('REPORTED');
      const { req, res, getStatus, getData } = mockReqRes({
        user: operatorUser,
        params: { incidentId: '17950910249977' },
        body: {
          outcome: 'CONFIRMED',
          verificationNotes: 'Called reporter; confirmed industrial fire with heavy smoke',
        },
      });

      await verifyIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.data.incident.status, 'VERIFIED');
      assert.equal(data.data.incident.latestVerificationOutcome, 'CONFIRMED');
      assert.equal(data.data.incident.verificationHistory.length, 1);
      assert.equal(data.data.incident.verificationHistory[0].outcome, 'CONFIRMED');
      assert.equal(data.data.incident.verificationHistory[0].resultingStatus, 'VERIFIED');
    });

    it('UNABLE_TO_CONTACT outcome should append to verificationHistory but retain REPORTED status (not false alarm)', async () => {
      setupIncident('REPORTED');
      const { req, res, getStatus, getData } = mockReqRes({
        user: operatorUser,
        params: { incidentId: '17950910249977' },
        body: {
          outcome: 'UNABLE_TO_CONTACT',
          verificationNotes: 'Called twice at 9876543210; no answer / phone switched off',
          proceedWithDispatch: false,
        },
      });

      await verifyIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.data.incident.status, 'REPORTED'); // Status remains REPORTED!
      assert.equal(data.data.incident.latestVerificationOutcome, 'UNABLE_TO_CONTACT');
      assert.equal(data.data.incident.verificationHistory[0].outcome, 'UNABLE_TO_CONTACT');
      assert.equal(data.data.incident.verificationHistory[0].resultingStatus, 'REPORTED');
    });

    it('UNABLE_TO_CONTACT with proceedWithDispatch: true should transition to VERIFIED with dispatch override', async () => {
      setupIncident('REPORTED');
      const { req, res, getStatus, getData } = mockReqRes({
        user: operatorUser,
        params: { incidentId: '17950910249977' },
        body: {
          outcome: 'UNABLE_TO_CONTACT',
          verificationNotes: 'Reporter phone unreachable, but verified via CCTV camera 4',
          proceedWithDispatch: true,
        },
      });

      await verifyIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.data.incident.status, 'VERIFIED'); // Dispatched despite uncontactable!
      assert.equal(data.data.incident.latestVerificationOutcome, 'UNABLE_TO_CONTACT');
      assert.equal(data.data.incident.verificationHistory[0].resultingStatus, 'VERIFIED');
    });

    it('INFORMATION_REQUIRED outcome should record inquiry notes and retain REPORTED status', async () => {
      setupIncident('REPORTED');
      const { req, res, getStatus, getData } = mockReqRes({
        user: operatorUser,
        params: { incidentId: '17950910249977' },
        body: {
          outcome: 'INFORMATION_REQUIRED',
          verificationNotes: 'Requested caller to confirm whether anyone is trapped on upper floor',
        },
      });

      await verifyIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.data.incident.status, 'REPORTED');
      assert.equal(data.data.incident.latestVerificationOutcome, 'INFORMATION_REQUIRED');
      assert.equal(data.data.incident.verificationHistory[0].outcome, 'INFORMATION_REQUIRED');
    });

    it('REJECTED outcome should require reason and transition REPORTED -> REJECTED', async () => {
      setupIncident('REPORTED');
      const { req, res, getStatus, getData } = mockReqRes({
        user: operatorUser,
        params: { incidentId: '17950910249977' },
        body: {
          outcome: 'REJECTED',
          notes: 'Prank call confirmed on callback; no emergency at specified address',
        },
      });

      await verifyIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.data.incident.status, 'REJECTED');
      assert.equal(data.data.incident.latestVerificationOutcome, 'REJECTED');
      assert.equal(data.data.incident.verificationHistory[0].outcome, 'REJECTED');
      assert.equal(data.data.incident.verificationHistory[0].resultingStatus, 'REJECTED');
    });

    it('DUPLICATE outcome should transition to REJECTED and record primary incident ID', async () => {
      setupIncident('REPORTED');
      const primaryId = 17950910240001;
      const { req, res, getStatus, getData } = mockReqRes({
        user: operatorUser,
        params: { incidentId: '17950910249977' },
        body: {
          outcome: 'DUPLICATE',
          duplicateOfIncidentId: primaryId,
          verificationNotes: 'Second caller for the same warehouse fire',
        },
      });

      await verifyIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.data.incident.status, 'REJECTED');
      assert.equal(data.data.incident.latestVerificationOutcome, 'DUPLICATE');
      assert.equal(data.data.incident.duplicateOfIncidentId, primaryId);
      assert.equal(data.data.incident.verificationHistory[0].relatedIncidentId, primaryId);
    });

    it('should reject DUPLICATE if duplicateOfIncidentId is missing or equal to own ID', async () => {
      setupIncident('REPORTED');
      // 1. Missing
      const { req: req1, res: res1, getStatus: getStatus1 } = mockReqRes({
        user: operatorUser,
        params: { incidentId: '17950910249977' },
        body: { outcome: 'DUPLICATE' },
      });
      await verifyIncident(req1, res1, (err) => { throw err; });
      assert.equal(getStatus1(), 400);

      // 2. Self duplicate
      const { req: req2, res: res2, getStatus: getStatus2 } = mockReqRes({
        user: operatorUser,
        params: { incidentId: '17950910249977' },
        body: { outcome: 'DUPLICATE', duplicateOfIncidentId: 17950910249977 },
      });
      await verifyIncident(req2, res2, (err) => { throw err; });
      assert.equal(getStatus2(), 400);
    });

    it('should enforce concurrency safety with 409 INCIDENT_STATE_CONFLICT on already VERIFIED incident', async () => {
      setupIncident('VERIFIED'); // Already verified!
      const { req, res, getStatus, getData } = mockReqRes({
        user: operatorUser,
        params: { incidentId: '17950910249977' },
        body: { outcome: 'CONFIRMED', verificationNotes: 'Second verification attempt' },
      });

      await verifyIncident(req, res, (err) => { throw err; });
      assert.equal(getStatus(), 409);
      assert.equal(getData().error.code, 'INCIDENT_STATE_CONFLICT');
    });
  });
});
