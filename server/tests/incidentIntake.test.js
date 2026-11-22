process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Incident from '../src/models/Incident.js';
import { createIncident, getMyIncidents, listIncidents } from '../src/controllers/incidentController.js';
import { __setConnectionStateOverride } from '../src/config/database.js';

function createMockHttp(body = {}, query = {}, user = null) {
  const req = {
    body,
    query,
    headers: {},
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

describe('Citizen Emergency Incident Intake & View Tests', () => {
  const citizenUser = {
    _id: '507f1f77bcf86cd799439011',
    id: '507f1f77bcf86cd799439011',
    name: 'Citizen Jane',
    role: 'CITIZEN'
  };

  describe('createIncident Controller Validation', () => {
    it('should reject invalid emergency categories with 400 INVALID_CATEGORY', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          {
            category: 'UNKNOWN_DISASTER',
            severity: 3,
            location: { latitude: 26.2918, longitude: 73.0168 }
          },
          {},
          citizenUser
        );

        await createIncident(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.success, false);
        assert.equal(result.body.error.code, 'INVALID_CATEGORY');
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should reject invalid severity below 1 or above 5 with 400 INVALID_SEVERITY', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        // Severity 0 (< 1)
        const { req: reqLow, res: resLow, waitForResponse: waitLow } = createMockHttp(
          {
            category: 'MEDICAL',
            severity: 0,
            location: { latitude: 26.2918, longitude: 73.0168 }
          },
          {},
          citizenUser
        );
        await createIncident(reqLow, resLow, () => {});
        const resLowResult = await waitLow();
        assert.equal(resLowResult.statusCode, 400);
        assert.equal(resLowResult.body.error.code, 'INVALID_SEVERITY');

        // Severity 6 (> 5)
        const { req: reqHigh, res: resHigh, waitForResponse: waitHigh } = createMockHttp(
          {
            category: 'MEDICAL',
            severity: 6,
            location: { latitude: 26.2918, longitude: 73.0168 }
          },
          {},
          citizenUser
        );
        await createIncident(reqHigh, resHigh, () => {});
        const resHighResult = await waitHigh();
        assert.equal(resHighResult.statusCode, 400);
        assert.equal(resHighResult.body.error.code, 'INVALID_SEVERITY');
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should reject negative victim count with 400 INVALID_VICTIM_COUNT', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          {
            category: 'ROAD_ACCIDENT',
            severity: 3,
            victimCount: -5,
            location: { latitude: 26.2918, longitude: 73.0168 }
          },
          {},
          citizenUser
        );

        await createIncident(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.error.code, 'INVALID_VICTIM_COUNT');
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should reject missing coordinates with 400 MISSING_COORDINATES', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          {
            category: 'FIRE',
            severity: 4
            // location omitted
          },
          {},
          citizenUser
        );

        await createIncident(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.error.code, 'MISSING_COORDINATES');
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should reject locations outside Jodhpur Urban Service Area with 400 OUTSIDE_SERVICE_AREA', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        // Jaipur coordinates (far outside Jodhpur boundary)
        const { req, res, waitForResponse } = createMockHttp(
          {
            category: 'MEDICAL',
            severity: 4,
            victimCount: 1,
            location: { latitude: 26.9124, longitude: 75.7873 }
          },
          {},
          citizenUser
        );

        await createIncident(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.success, false);
        assert.equal(result.body.error.code, 'OUTSIDE_SERVICE_AREA');
        assert.ok(result.body.message.includes('outside the Jodhpur Urban Service Area boundary'));
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should successfully accept and persist a valid emergency incident inside Jodhpur boundary', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      let createdDoc = null;
      const origCreate = Incident.create;
      Incident.create = async (doc) => {
        createdDoc = doc;
        return {
          ...doc,
          _id: '607f1f77bcf86cd799439099'
        };
      };

      try {
        const { req, res, waitForResponse } = createMockHttp(
          {
            category: 'ROAD_ACCIDENT',
            severity: 4,
            victimCount: 2,
            description: 'Two vehicle collision on Pali Road near AIIMS',
            location: { latitude: 26.2550, longitude: 73.0050 }
          },
          {},
          citizenUser
        );

        await createIncident(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 201);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.incident.category, 'ROAD_ACCIDENT');
        assert.equal(result.body.data.incident.severity, 4);
        assert.equal(result.body.data.incident.victimCount, 2);
        assert.equal(result.body.data.incident.status, 'REPORTED', 'Must initialize strictly to REPORTED');
        assert.equal(result.body.data.incident.reportedBy, citizenUser.id);
        assert.equal(createdDoc.status, 'REPORTED');
        assert.equal(createdDoc.latitude, 26.2550);
        assert.equal(createdDoc.longitude, 73.0050);
      } finally {
        Incident.create = origCreate;
        __setConnectionStateOverride(null);
      }
    });

    it('should return 503 DATABASE_UNAVAILABLE when database is offline during incident submission', async () => {
      __setConnectionStateOverride({ connected: false, state: 'disconnected' });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          {
            category: 'FIRE',
            severity: 3,
            location: { latitude: 26.2918, longitude: 73.0168 }
          },
          {},
          citizenUser
        );

        await createIncident(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 503);
        assert.equal(result.body.error.code, 'DATABASE_UNAVAILABLE');
      } finally {
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('Citizen Incident History Filtering', () => {
    it('should strictly query incidents belonging to the authenticated citizen', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      let capturedQuery = null;
      const origCount = Incident.countDocuments;
      const origFind = Incident.find;

      Incident.countDocuments = async (query) => {
        capturedQuery = query;
        return 1;
      };

      Incident.find = (query) => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: async () => [
                {
                  incidentId: 991122,
                  category: 'MEDICAL',
                  severity: 3,
                  victimCount: 1,
                  status: 'REPORTED',
                  description: 'Citizen medical report',
                  latitude: 26.2918,
                  longitude: 73.0168,
                  reportedAt: new Date()
                }
              ]
            })
          })
        })
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          {},
          { page: '1', limit: '10' },
          citizenUser
        );

        await getMyIncidents(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.incidents.length, 1);
        assert.equal(capturedQuery.reportedBy, citizenUser._id, 'Query must be constrained to req.user._id');
      } finally {
        Incident.countDocuments = origCount;
        Incident.find = origFind;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('Operator Incident Listing Filtering', () => {
    it('should reject invalid category filter with 400 INVALID_CATEGORY_FILTER', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          {},
          { category: 'NON_EXISTENT_CATEGORY' },
          { id: 'op-1', role: 'OPERATOR' }
        );

        await listIncidents(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.error.code, 'INVALID_CATEGORY_FILTER');
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should reject invalid status filter with 400 INVALID_STATUS_FILTER', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          {},
          { status: 'MAGICAL_STATUS' },
          { id: 'op-1', role: 'OPERATOR' }
        );

        await listIncidents(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 400);
        assert.equal(result.body.error.code, 'INVALID_STATUS_FILTER');
      } finally {
        __setConnectionStateOverride(null);
      }
    });

    it('should return 503 when listing incidents while database is disconnected', async () => {
      __setConnectionStateOverride({ connected: false, state: 'disconnected' });

      try {
        const { req, res, waitForResponse } = createMockHttp({}, {}, { id: 'op-1', role: 'OPERATOR' });

        await listIncidents(req, res, () => {});
        const result = await waitForResponse();

        assert.equal(result.statusCode, 503);
        assert.equal(result.body.error.code, 'DATABASE_UNAVAILABLE');
      } finally {
        __setConnectionStateOverride(null);
      }
    });
  });
});
