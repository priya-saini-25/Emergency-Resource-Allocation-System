process.env.NODE_ENV = 'test';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import Hospital from '../src/models/Hospital.js';
import { generateToken } from '../src/utils/jwt.js';
import { __setConnectionStateOverride } from '../src/config/database.js';
import { getActiveIncidents, formatIncidentTrackingResponse } from '../src/services/activeIncidentTrackingService.js';

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

describe('Hospital Assignment Response Contract & Display Fix Tests', () => {
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
  });

  afterEach(() => {
    __setConnectionStateOverride(null);
  });

  function createMockIncident(overrides = {}) {
    return {
      incidentId: 1001,
      category: 'MEDICAL_EMERGENCY',
      subcategory: '',
      severity: 4,
      victimCount: 1,
      status: 'DISPATCHED',
      description: 'Severe medical distress',
      location: { latitude: 26.2906, longitude: 73.0232 },
      address: 'Near Clock Tower, Jodhpur',
      landmark: 'Ghanta Ghar',
      locationType: 'SEARCH_AUTOFILL',
      reportedBy: citizenUser._id,
      reporterName: 'Alice',
      reporterPhone: '+919876543210',
      reportedAt: new Date('2026-11-22T06:00:00.000Z'),
      verifiedAt: new Date('2026-11-22T06:02:00.000Z'),
      dispatchedAt: new Date('2026-11-22T06:04:00.000Z'),
      arrivedAt: null,
      resolvedAt: null,
      dispatchedBatchId: 'BATCH-001',
      dispatchId: 'DISPATCH-001',
      assignedResourceIds: [301],
      assignedHospitalId: 703,
      callAttempts: [],
      auditHistory: [
        { action: 'REPORTED', performedAt: new Date('2026-11-22T06:00:00.000Z') },
        { action: 'DISPATCHED', performedAt: new Date('2026-11-22T06:04:00.000Z') }
      ],
      ...overrides
    };
  }

  // 1. Single Incident with Assigned Hospital returns ID and Name
  it('1. Incident with assigned hospital returns hospital ID and hospitalName in active tracking response', async () => {
    const inc = createMockIncident({ assignedHospitalId: 703 });
    const hospitalMap = new Map();
    hospitalMap.set(703, { hospitalId: 703, name: 'Mahatma Gandhi Hospital (Simulation)' });

    const formatted = formatIncidentTrackingResponse(inc, hospitalMap);

    assert.equal(formatted.assignedHospitalId, 703);
    assert.deepEqual(formatted.assignedHospital, {
      hospitalId: 703,
      hospitalName: 'Mahatma Gandhi Hospital (Simulation)'
    });
  });

  // 2. Incident without Assigned Hospital returns null
  it('2. Incident without assigned hospital returns assignedHospital: null', async () => {
    const inc = createMockIncident({ assignedHospitalId: null });
    const formatted = formatIncidentTrackingResponse(inc, new Map());

    assert.equal(formatted.assignedHospitalId, null);
    assert.equal(formatted.assignedHospital, null);
  });

  // 3. Multiple incidents with different hospitals return correct hospital names in bulk
  it('3. Multiple incidents with different hospitals return correct hospital names in bulk query', async () => {
    const inc1 = createMockIncident({ incidentId: 2001, category: 'MEDICAL_EMERGENCY', assignedHospitalId: 703 });
    const inc2 = createMockIncident({ incidentId: 2002, category: 'FIRE', assignedHospitalId: 702 });
    const inc3 = createMockIncident({ incidentId: 2003, category: 'TRAFFIC', assignedHospitalId: null });

    const origIncFind = Incident.find;
    const origIncCount = Incident.countDocuments;
    const origHospFind = Hospital.find;

    Incident.countDocuments = async () => 3;
    Incident.find = () => ({
      populate: function () { return this; },
      sort: function () { return this; },
      skip: function () { return this; },
      limit: function () { return this; },
      lean: async () => [inc1, inc2, inc3]
    });

    let queriedHospitalIds = null;
    Hospital.find = (query) => {
      queriedHospitalIds = query?.hospitalId?.$in;
      return {
        select: function () { return this; },
        lean: async () => [
          { hospitalId: 703, name: 'Mahatma Gandhi Hospital (Simulation)' },
          { hospitalId: 702, name: 'MDM Hospital Jodhpur (Simulation)' }
        ]
      };
    };

    try {
      const result = await getActiveIncidents(operatorUser, { page: 1, limit: 10 });

      assert.equal(result.incidents.length, 3);
      // Verify inc1 (703)
      assert.equal(result.incidents[0].assignedHospitalId, 703);
      assert.equal(result.incidents[0].assignedHospital.hospitalName, 'Mahatma Gandhi Hospital (Simulation)');

      // Verify inc2 (702)
      assert.equal(result.incidents[1].assignedHospitalId, 702);
      assert.equal(result.incidents[1].assignedHospital.hospitalName, 'MDM Hospital Jodhpur (Simulation)');

      // Verify inc3 (null)
      assert.equal(result.incidents[2].assignedHospitalId, null);
      assert.equal(result.incidents[2].assignedHospital, null);

      // Verify queried hospital IDs
      assert.ok(queriedHospitalIds.includes(703));
      assert.ok(queriedHospitalIds.includes(702));
      assert.equal(queriedHospitalIds.length, 2);
    } finally {
      Incident.find = origIncFind;
      Incident.countDocuments = origIncCount;
      Hospital.find = origHospFind;
    }
  });

  // 4. Multiple incidents assigned to the same hospital return correct names without duplicate queries
  it('4. Multiple incidents assigned to the same hospital deduplicate queried hospital IDs in bulk query', async () => {
    const inc1 = createMockIncident({ incidentId: 3001, assignedHospitalId: 703 });
    const inc2 = createMockIncident({ incidentId: 3002, assignedHospitalId: 703 });
    const inc3 = createMockIncident({ incidentId: 3003, assignedHospitalId: 703 });

    const origIncFind = Incident.find;
    const origIncCount = Incident.countDocuments;
    const origHospFind = Hospital.find;

    Incident.countDocuments = async () => 3;
    Incident.find = () => ({
      populate: function () { return this; },
      sort: function () { return this; },
      skip: function () { return this; },
      limit: function () { return this; },
      lean: async () => [inc1, inc2, inc3]
    });

    let hospFindCallCount = 0;
    let queriedHospitalIds = null;
    Hospital.find = (query) => {
      hospFindCallCount++;
      queriedHospitalIds = query?.hospitalId?.$in;
      return {
        select: function () { return this; },
        lean: async () => [
          { hospitalId: 703, name: 'Mahatma Gandhi Hospital (Simulation)' }
        ]
      };
    };

    try {
      const result = await getActiveIncidents(operatorUser, { page: 1, limit: 10 });

      assert.equal(hospFindCallCount, 1, 'Hospital.find should only be called once');
      assert.deepEqual(queriedHospitalIds, [703], 'Only unique hospital IDs should be queried');
      assert.equal(result.incidents[0].assignedHospital.hospitalName, 'Mahatma Gandhi Hospital (Simulation)');
      assert.equal(result.incidents[1].assignedHospital.hospitalName, 'Mahatma Gandhi Hospital (Simulation)');
      assert.equal(result.incidents[2].assignedHospital.hospitalName, 'Mahatma Gandhi Hospital (Simulation)');
    } finally {
      Incident.find = origIncFind;
      Incident.countDocuments = origIncCount;
      Hospital.find = origHospFind;
    }
  });

  // 5. Missing hospital record returns assignedHospital: null safely
  it('5. Missing hospital record (non-existent hospitalId: 9999) returns assignedHospital: null without crashing', async () => {
    const inc = createMockIncident({ incidentId: 4001, assignedHospitalId: 9999 });

    const origIncFind = Incident.find;
    const origIncCount = Incident.countDocuments;
    const origHospFind = Hospital.find;

    Incident.countDocuments = async () => 1;
    Incident.find = () => ({
      populate: function () { return this; },
      sort: function () { return this; },
      skip: function () { return this; },
      limit: function () { return this; },
      lean: async () => [inc]
    });

    Hospital.find = () => ({
      select: function () { return this; },
      lean: async () => [] // Hospital not found
    });

    try {
      const result = await getActiveIncidents(operatorUser, { page: 1, limit: 10 });
      assert.equal(result.incidents[0].assignedHospitalId, 9999);
      assert.equal(result.incidents[0].assignedHospital, null);
    } finally {
      Incident.find = origIncFind;
      Incident.countDocuments = origIncCount;
      Hospital.find = origHospFind;
    }
  });

  // 6. Existing assignedHospitalId remains available alongside assignedHospital
  it('6. Existing assignedHospitalId remains available alongside assignedHospital for backward compatibility', async () => {
    const inc = createMockIncident({ assignedHospitalId: 701 });
    const hospitalMap = new Map([[701, { hospitalId: 701, name: 'Mathura Das Mathur Hospital' }]]);

    const formatted = formatIncidentTrackingResponse(inc, hospitalMap);
    assert.equal(formatted.assignedHospitalId, 701);
    assert.ok(formatted.assignedHospital);
    assert.equal(formatted.assignedHospital.hospitalId, 701);
    assert.equal(formatted.assignedHospital.hospitalName, 'Mathura Das Mathur Hospital');
  });

  // 7. Citizen-facing response does NOT expose assignedHospital or assignedHospitalId
  it('7. Citizen-facing GET /api/incidents/:id does not expose assignedHospital or assignedHospitalId (RBAC / Privacy)', async () => {
    const rawIncident = createMockIncident({
      incidentId: 5001,
      reportedBy: citizenUser,
      assignedHospitalId: 703
    });

    const origUserFind = User.findById;
    const origIncFindOne = Incident.findOne;

    User.findById = async () => citizenUser;
    Incident.findOne = () => {
      const chain = {
        populate: () => chain,
        lean: () => Promise.resolve(rawIncident),
        then: (resolve, reject) => Promise.resolve(rawIncident).then(resolve, reject)
      };
      return chain;
    };

    try {
      const { req, res, waitForResponse } = createMockHttp(
        'GET',
        '/api/incidents/5001',
        {},
        { authorization: `Bearer ${tokenCitizen}` }
      );

      app(req, res);
      const result = await waitForResponse();

      assert.equal(result.statusCode, 200);
      assert.equal(result.body.success, true);
      const incidentData = result.body.data.incident;

      // Citizen must NOT see assignedHospital or assignedHospitalId
      assert.equal(incidentData.assignedHospitalId, undefined);
      assert.equal(incidentData.assignedHospital, undefined);
    } finally {
      User.findById = origUserFind;
      Incident.findOne = origIncFindOne;
    }
  });

  // 8. Operator-facing GET /api/incidents/:id exposes assignedHospital and assignedHospitalId
  it('8. Operator-facing GET /api/incidents/:id includes populated assignedHospital and assignedHospitalId', async () => {
    const rawIncident = createMockIncident({
      incidentId: 5002,
      reportedBy: citizenUser,
      assignedHospitalId: 703
    });

    const origUserFind = User.findById;
    const origIncFindOne = Incident.findOne;
    const origHospFindOne = Hospital.findOne;

    User.findById = async () => operatorUser;
    Incident.findOne = () => {
      const chain = {
        populate: () => chain,
        lean: () => Promise.resolve(rawIncident),
        then: (resolve, reject) => Promise.resolve(rawIncident).then(resolve, reject)
      };
      return chain;
    };
    Hospital.findOne = () => ({
      select: function () { return this; },
      lean: async () => ({ hospitalId: 703, name: 'Mahatma Gandhi Hospital (Simulation)' })
    });

    try {
      const { req, res, waitForResponse } = createMockHttp(
        'GET',
        '/api/incidents/5002',
        {},
        { authorization: `Bearer ${tokenOperator}` }
      );

      app(req, res);
      const result = await waitForResponse();

      assert.equal(result.statusCode, 200);
      assert.equal(result.body.success, true);
      const incidentData = result.body.data.incident;

      assert.equal(incidentData.assignedHospitalId, 703);
      assert.deepEqual(incidentData.assignedHospital, {
        hospitalId: 703,
        hospitalName: 'Mahatma Gandhi Hospital (Simulation)'
      });
    } finally {
      User.findById = origUserFind;
      Incident.findOne = origIncFindOne;
      Hospital.findOne = origHospFindOne;
    }
  });

  // 9. Operator-facing GET /api/incidents list includes populated assignedHospital in bulk
  it('9. Operator-facing GET /api/incidents list includes populated assignedHospital in bulk query', async () => {
    const inc1 = createMockIncident({ incidentId: 6001, assignedHospitalId: 702 });
    const inc2 = createMockIncident({ incidentId: 6002, assignedHospitalId: 703 });

    const origUserFind = User.findById;
    const origIncFind = Incident.find;
    const origIncCount = Incident.countDocuments;
    const origHospFind = Hospital.find;

    User.findById = async () => operatorUser;
    Incident.countDocuments = async () => 2;
    Incident.find = () => {
      const chain = {
        populate: () => chain,
        sort: () => chain,
        skip: () => chain,
        limit: () => chain,
        lean: () => Promise.resolve([inc1, inc2]),
        then: (resolve, reject) => Promise.resolve([inc1, inc2]).then(resolve, reject)
      };
      return chain;
    };
    Hospital.find = () => ({
      select: function () { return this; },
      lean: async () => [
        { hospitalId: 702, name: 'MDM Hospital Jodhpur (Simulation)' },
        { hospitalId: 703, name: 'Mahatma Gandhi Hospital (Simulation)' }
      ]
    });

    try {
      const { req, res, waitForResponse } = createMockHttp(
        'GET',
        '/api/incidents?page=1&limit=10',
        {},
        { authorization: `Bearer ${tokenOperator}` }
      );

      app(req, res);
      const result = await waitForResponse();

      assert.equal(result.statusCode, 200);
      assert.equal(result.body.success, true);
      const incidents = result.body.data.incidents;
      assert.equal(incidents.length, 2);
      assert.equal(incidents[0].assignedHospital.hospitalName, 'MDM Hospital Jodhpur (Simulation)');
      assert.equal(incidents[1].assignedHospital.hospitalName, 'Mahatma Gandhi Hospital (Simulation)');
    } finally {
      User.findById = origUserFind;
      Incident.find = origIncFind;
      Incident.countDocuments = origIncCount;
      Hospital.find = origHospFind;
    }
  });
});
