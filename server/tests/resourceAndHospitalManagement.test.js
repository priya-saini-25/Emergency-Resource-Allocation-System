process.env.NODE_ENV = 'test';
import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Resource from '../src/models/Resource.js';
import Hospital from '../src/models/Hospital.js';
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

describe('Resource and Hospital Management Endpoints (Phases 5.8 & 5.9)', () => {
  const operatorUser = {
    _id: '507f191e810c19729de860ea',
    role: 'OPERATOR',
    email: 'operator@jodhpur-ems.gov.in',
    name: 'Jodhpur Ops',
    isActive: true
  };

  const citizenUser = {
    _id: '507f191e810c19729de860eb',
    role: 'CITIZEN',
    email: 'citizen@example.com',
    name: 'Citizen Jane',
    isActive: true
  };

  const operatorToken = generateToken({
    id: operatorUser._id,
    role: operatorUser.role,
    email: operatorUser.email,
    name: operatorUser.name
  });

  const citizenToken = generateToken({
    id: citizenUser._id,
    role: citizenUser.role,
    email: citizenUser.email,
    name: citizenUser.name
  });

  let origUserFindById;

  before(() => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });
    origUserFindById = User.findById;
    User.findById = (id) => {
      const idStr = String(id);
      if (idStr === operatorUser._id) {
        return Promise.resolve(operatorUser);
      }
      if (idStr === citizenUser._id) {
        return Promise.resolve(citizenUser);
      }
      return Promise.resolve(null);
    };
  });

  after(() => {
    __setConnectionStateOverride(null);
    User.findById = origUserFindById;
  });

  describe('Resource Management API (GET /api/resources)', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const { req, res, waitForResponse } = createMockHttp('GET', '/api/resources');
      app(req, res);
      const result = await waitForResponse();
      assert.strictEqual(result.statusCode, 401);
      assert.strictEqual(result.body.success, false);
    });

    it('should reject CITIZEN role with 403 Forbidden', async () => {
      const { req, res, waitForResponse } = createMockHttp('GET', '/api/resources', {}, {
        authorization: `Bearer ${citizenToken}`
      });
      app(req, res);
      const result = await waitForResponse();
      assert.strictEqual(result.statusCode, 403);
      assert.strictEqual(result.body.success, false);
    });

    it('should allow OPERATOR and list resources with pagination', async () => {
      const origFind = Resource.find;
      const origCount = Resource.countDocuments;

      const mockResources = [
        {
          _id: '507f1f77bcf86cd799439001',
          resourceId: 101,
          name: 'Ambulance 101',
          resourceType: 'AMBULANCE',
          status: 'AVAILABLE',
          capacity: 2,
          latitude: 26.29,
          longitude: 73.02,
          currentNodeOsmId: 10001,
          stationId: 'Clock Tower Depot',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      Resource.find = () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: () => Promise.resolve(mockResources)
            })
          })
        })
      });

      Resource.countDocuments = () => Promise.resolve(1);

      try {
        const { req, res, waitForResponse } = createMockHttp('GET', '/api/resources?status=AVAILABLE&page=1&limit=10', {}, {
          authorization: `Bearer ${operatorToken}`
        });
        app(req, res);
        const result = await waitForResponse();

        assert.strictEqual(result.statusCode, 200);
        assert.strictEqual(result.body.success, true);
        assert.strictEqual(result.body.data.resources.length, 1);
        assert.strictEqual(result.body.data.pagination.totalCount, 1);
        assert.strictEqual(result.body.data.resources[0].name, 'Ambulance 101');
      } finally {
        Resource.find = origFind;
        Resource.countDocuments = origCount;
      }
    });

    it('should return aggregated resource fleet statistics via GET /api/resources/stats', async () => {
      const origAggregate = Resource.aggregate;
      const origCount = Resource.countDocuments;

      Resource.aggregate = (pipeline) => {
        const groupField = pipeline[0]?.$group?._id;
        if (groupField === '$status') {
          return Promise.resolve([
            { _id: 'AVAILABLE', count: 12 },
            { _id: 'DISPATCHED', count: 3 },
            { _id: 'RESERVED', count: 1 }
          ]);
        }
        return Promise.resolve([
          { _id: 'AMBULANCE', count: 10 },
          { _id: 'FIRE_TRUCK', count: 6 }
        ]);
      };
      Resource.countDocuments = () => Promise.resolve(16);

      try {
        const { req, res, waitForResponse } = createMockHttp('GET', '/api/resources/stats', {}, {
          authorization: `Bearer ${operatorToken}`
        });
        app(req, res);
        const result = await waitForResponse();

        assert.strictEqual(result.statusCode, 200);
        assert.strictEqual(result.body.success, true);
        assert.strictEqual(result.body.data.totalResources, 16);
        assert.strictEqual(result.body.data.availableCount, 12);
        assert.strictEqual(result.body.data.dispatchedCount, 3);
        assert.strictEqual(result.body.data.reservedCount, 1);
      } finally {
        Resource.aggregate = origAggregate;
        Resource.countDocuments = origCount;
      }
    });

    it('should reject invalid non-numeric or non-positive resource ID with 400', async () => {
      const { req, res, waitForResponse } = createMockHttp('GET', '/api/resources/invalid-id', {}, {
        authorization: `Bearer ${operatorToken}`
      });
      app(req, res);
      const result = await waitForResponse();

      assert.strictEqual(result.statusCode, 400);
      assert.strictEqual(result.body.error.code, 'INVALID_RESOURCE_ID');
    });

    it('should return resource detail with 200 when found', async () => {
      const origFind = Resource.findOne;
      const mockResource = {
        _id: '507f1f77bcf86cd799439001',
        resourceId: 101,
        name: 'Ambulance 101',
        resourceType: 'AMBULANCE',
        status: 'AVAILABLE',
        capacity: 2,
        latitude: 26.29,
        longitude: 73.02,
        currentNodeOsmId: 10001,
        stationId: 'Clock Tower Depot',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      Resource.findOne = () => ({
        lean: () => Promise.resolve(mockResource)
      });

      try {
        const { req, res, waitForResponse } = createMockHttp('GET', '/api/resources/101', {}, {
          authorization: `Bearer ${operatorToken}`
        });
        app(req, res);
        const result = await waitForResponse();

        assert.strictEqual(result.statusCode, 200);
        assert.strictEqual(result.body.success, true);
        assert.strictEqual(result.body.data.resource.resourceId, 101);
      } finally {
        Resource.findOne = origFind;
      }
    });

    it('should return 503 DATABASE_UNAVAILABLE when database is disconnected during resource listing', async () => {
      __setConnectionStateOverride({ connected: false, state: 'disconnected' });
      try {
        const { req, res, waitForResponse } = createMockHttp('GET', '/api/resources', {}, {
          authorization: `Bearer ${operatorToken}`
        });
        app(req, res);
        const result = await waitForResponse();

        assert.strictEqual(result.statusCode, 503);
        assert.strictEqual(result.body.error.code, 'DATABASE_UNAVAILABLE');
      } finally {
        __setConnectionStateOverride({ connected: true, state: 'connected' });
      }
    });

    it('should return 404 if resource is not found via GET /api/resources/:id', async () => {
      const origFind = Resource.findOne;
      Resource.findOne = () => ({
        lean: () => Promise.resolve(null)
      });

      try {
        const { req, res, waitForResponse } = createMockHttp('GET', '/api/resources/999', {}, {
          authorization: `Bearer ${operatorToken}`
        });
        app(req, res);
        const result = await waitForResponse();

        assert.strictEqual(result.statusCode, 404);
        assert.strictEqual(result.body.success, false);
      } finally {
        Resource.findOne = origFind;
      }
    });
  });

  describe('Hospital Network API (GET /api/hospitals)', () => {
    it('should reject CITIZEN with 403 Forbidden', async () => {
      const { req, res, waitForResponse } = createMockHttp('GET', '/api/hospitals', {}, {
        authorization: `Bearer ${citizenToken}`
      });
      app(req, res);
      const result = await waitForResponse();
      assert.strictEqual(result.statusCode, 403);
      assert.strictEqual(result.body.success, false);
    });

    it('should allow OPERATOR and list hospitals with pagination', async () => {
      const origFind = Hospital.find;
      const origCount = Hospital.countDocuments;

      const mockHospitals = [
        {
          _id: '507f1f77bcf86cd799439002',
          hospitalId: 1,
          name: 'AIIMS Jodhpur',
          address: 'Basni Industrial Area Phase-2',
          latitude: 26.248,
          longitude: 73.008,
          status: 'OPERATIONAL',
          icuBeds: { total: 40, available: 12 },
          generalBeds: { total: 150, available: 50 },
          oxygenBeds: { total: 60, available: 23 },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      Hospital.find = () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: () => Promise.resolve(mockHospitals)
            })
          })
        })
      });

      Hospital.countDocuments = () => Promise.resolve(1);

      try {
        const { req, res, waitForResponse } = createMockHttp('GET', '/api/hospitals?page=1&limit=10', {}, {
          authorization: `Bearer ${operatorToken}`
        });
        app(req, res);
        const result = await waitForResponse();

        assert.strictEqual(result.statusCode, 200);
        assert.strictEqual(result.body.success, true);
        assert.strictEqual(result.body.data.hospitals.length, 1);
        assert.strictEqual(result.body.data.pagination.totalCount, 1);
        assert.strictEqual(result.body.data.hospitals[0].name, 'AIIMS Jodhpur');
      } finally {
        Hospital.find = origFind;
        Hospital.countDocuments = origCount;
      }
    });

    it('should return aggregated hospital capacity stats via GET /api/hospitals/stats', async () => {
      const origFind = Hospital.find;
      Hospital.find = () => ({
        lean: () => Promise.resolve([
          {
            _id: '507f1f77bcf86cd799439002',
            hospitalId: 1,
            name: 'AIIMS Jodhpur',
            status: 'OPERATIONAL',
            icuBeds: { total: 40, available: 12 },
            generalBeds: { total: 150, available: 50 },
            oxygenBeds: { total: 60, available: 23 }
          }
        ])
      });

      try {
        const { req, res, waitForResponse } = createMockHttp('GET', '/api/hospitals/stats', {}, {
          authorization: `Bearer ${operatorToken}`
        });
        app(req, res);
        const result = await waitForResponse();

        assert.strictEqual(result.statusCode, 200);
        assert.strictEqual(result.body.success, true);
        assert.strictEqual(result.body.data.totalHospitals, 1);
        assert.strictEqual(result.body.data.totalBeds, 250);
        assert.strictEqual(result.body.data.availableBeds, 85);
        assert.strictEqual(result.body.data.bedsByCategory.icu.total, 40);
        assert.strictEqual(result.body.data.bedsByCategory.icu.available, 12);
      } finally {
        Hospital.find = origFind;
      }
    });

    it('should reject invalid non-numeric or non-positive hospital ID with 400', async () => {
      const { req, res, waitForResponse } = createMockHttp('GET', '/api/hospitals/not-a-number', {}, {
        authorization: `Bearer ${operatorToken}`
      });
      app(req, res);
      const result = await waitForResponse();

      assert.strictEqual(result.statusCode, 400);
      assert.strictEqual(result.body.error.code, 'INVALID_HOSPITAL_ID');
    });

    it('should return hospital detail with 200 when found', async () => {
      const origFind = Hospital.findOne;
      const mockHospital = {
        _id: '507f1f77bcf86cd799439002',
        hospitalId: 1,
        name: 'AIIMS Jodhpur',
        address: 'Basni Phase-2',
        latitude: 26.248,
        longitude: 73.008,
        status: 'OPERATIONAL',
        icuBeds: { total: 40, available: 12 },
        generalBeds: { total: 150, available: 50 },
        oxygenBeds: { total: 60, available: 23 },
        createdAt: new Date(),
        updatedAt: new Date()
      };
      Hospital.findOne = () => ({
        lean: () => Promise.resolve(mockHospital)
      });

      try {
        const { req, res, waitForResponse } = createMockHttp('GET', '/api/hospitals/1', {}, {
          authorization: `Bearer ${operatorToken}`
        });
        app(req, res);
        const result = await waitForResponse();

        assert.strictEqual(result.statusCode, 200);
        assert.strictEqual(result.body.success, true);
        assert.strictEqual(result.body.data.hospital.hospitalId, 1);
        assert.strictEqual(result.body.data.hospital.totalBeds, 250);
      } finally {
        Hospital.findOne = origFind;
      }
    });

    it('should return 503 DATABASE_UNAVAILABLE when database is disconnected during hospital listing', async () => {
      __setConnectionStateOverride({ connected: false, state: 'disconnected' });
      try {
        const { req, res, waitForResponse } = createMockHttp('GET', '/api/hospitals', {}, {
          authorization: `Bearer ${operatorToken}`
        });
        app(req, res);
        const result = await waitForResponse();

        assert.strictEqual(result.statusCode, 503);
        assert.strictEqual(result.body.error.code, 'DATABASE_UNAVAILABLE');
      } finally {
        __setConnectionStateOverride({ connected: true, state: 'connected' });
      }
    });

    it('should return 404 if hospital is not found via GET /api/hospitals/:id', async () => {
      const origFind = Hospital.findOne;
      Hospital.findOne = () => ({
        lean: () => Promise.resolve(null)
      });

      try {
        const { req, res, waitForResponse } = createMockHttp('GET', '/api/hospitals/999', {}, {
          authorization: `Bearer ${operatorToken}`
        });
        app(req, res);
        const result = await waitForResponse();

        assert.strictEqual(result.statusCode, 404);
        assert.strictEqual(result.body.success, false);
      } finally {
        Hospital.findOne = origFind;
      }
    });
  });
});
