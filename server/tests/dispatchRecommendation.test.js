process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Incident from '../src/models/Incident.js';
import Resource from '../src/models/Resource.js';
import Hospital from '../src/models/Hospital.js';
import DispatchRecord from '../src/models/DispatchRecord.js';
import { generateToken } from '../src/utils/jwt.js';
import { __setConnectionStateOverride } from '../src/config/database.js';
import cppEngineService, {
  EngineValidationError,
  EngineTimeoutError,
  EngineExecutionError
} from '../src/services/cppEngineService.js';
import dispatchService, {
  validateRecommendationRequest,
  validateEngineResponse,
  RecommendationValidationError,
  EngineResponseValidationError
} from '../src/services/dispatchRecommendationService.js';

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

describe('Phase 4.4 — C++ Decision Engine Integration & Dispatch Recommendation API', () => {
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

  const adminUser = {
    _id: '507f1f77bcf86cd799439099',
    id: '507f1f77bcf86cd799439099',
    name: 'Admin Eve',
    email: 'admin@jodhpur.emergency.gov.in',
    role: 'ADMIN',
    isActive: true
  };

  const tokenCitizen = generateToken(citizenUser);
  const tokenOperator = generateToken(operatorUser);
  const tokenAdmin = generateToken(adminUser);

  // Sample valid mock data
  const sampleIncident1001 = {
    _id: '507f1f77bcf86cd799439101',
    incidentId: 1001,
    category: 'FIRE',
    severity: 4,
    victimCount: 2,
    status: 'VERIFIED',
    latitude: 26.2918,
    longitude: 73.0168,
    reportedAt: new Date('2026-11-18T00:00:00.000Z'),
    toEngineProtocol: () => ({
      incident_id: 1001,
      category: 'FIRE',
      severity: 4,
      victim_count: 2,
      created_at_ms: 1700000000000,
      latitude: 26.2918,
      longitude: 73.0168,
      incident_node_osm_id: 0
    })
  };

  const sampleIncident1002 = {
    _id: '507f1f77bcf86cd799439102',
    incidentId: 1002,
    category: 'MEDICAL',
    severity: 5,
    victimCount: 3,
    status: 'VERIFIED',
    latitude: 26.2800,
    longitude: 73.0200,
    reportedAt: new Date('2026-11-18T00:05:00.000Z'),
    toEngineProtocol: () => ({
      incident_id: 1002,
      category: 'MEDICAL',
      severity: 5,
      victim_count: 3,
      created_at_ms: 1700000300000,
      latitude: 26.2800,
      longitude: 73.0200,
      incident_node_osm_id: 0
    })
  };

  const sampleResource501 = {
    resourceId: 501,
    resourceType: 'FIRE_ENGINE',
    status: 'AVAILABLE',
    latitude: 26.2950,
    longitude: 73.0150,
    currentNodeOsmId: 101,
    toEngineProtocol: () => ({
      resource_id: 501,
      resource_type: 'FIRE_ENGINE',
      status: 'AVAILABLE',
      capacity: 1,
      latitude: 26.2950,
      longitude: 73.0150,
      current_node_osm_id: 101
    })
  };

  const sampleResource502 = {
    resourceId: 502,
    resourceType: 'ALS_AMBULANCE',
    status: 'AVAILABLE',
    latitude: 26.2850,
    longitude: 73.0210,
    currentNodeOsmId: 102,
    toEngineProtocol: () => ({
      resource_id: 502,
      resource_type: 'ALS_AMBULANCE',
      status: 'AVAILABLE',
      capacity: 1,
      latitude: 26.2850,
      longitude: 73.0210,
      current_node_osm_id: 102
    })
  };

  const sampleHospital701 = {
    hospitalId: 701,
    name: 'MDM Hospital Jodhpur',
    status: 'OPERATIONAL',
    latitude: 26.2750,
    longitude: 73.0180,
    icuBeds: { total: 10, available: 5 },
    generalBeds: { total: 50, available: 20 },
    oxygenBeds: { total: 20, available: 10 },
    capabilities: ['GENERAL_EMERGENCY', 'TRAUMA', 'ICU'],
    nodeOsmId: 201,
    toEngineProtocol: () => ({
      hospital_id: 701,
      hospital_name: 'MDM Hospital Jodhpur',
      status: 'OPERATIONAL',
      capabilities: ['GENERAL_EMERGENCY', 'TRAUMA', 'ICU'],
      icu_beds_total: 10,
      icu_beds_available: 5,
      general_beds_total: 50,
      general_beds_available: 20,
      oxygen_beds_total: 20,
      oxygen_beds_available: 10,
      latitude: 26.2750,
      longitude: 73.0180,
      node_osm_id: 201
    })
  };

  describe('1. Request Validation & Eligibility Rules', () => {
    it('should reject empty incidentIds array with 400 EMPTY_INCIDENT_BATCH', () => {
      assert.throws(
        () => validateRecommendationRequest({ incidentIds: [] }),
        (err) => err.code === 'EMPTY_INCIDENT_BATCH' && err.statusCode === 400
      );
    });

    it('should reject duplicate incident IDs with 400 DUPLICATE_INCIDENT_IDS', () => {
      assert.throws(
        () => validateRecommendationRequest({ incidentIds: [1001, 1002, 1001] }),
        (err) => err.code === 'DUPLICATE_INCIDENT_IDS' && err.statusCode === 400
      );
    });

    it('should reject non-integer or negative incident IDs with 400 INVALID_INCIDENT_ID', () => {
      assert.throws(
        () => validateRecommendationRequest({ incidentIds: [1001, 'invalid'] }),
        (err) => err.code === 'INVALID_INCIDENT_ID' && err.statusCode === 400
      );
      assert.throws(
        () => validateRecommendationRequest({ incidentIds: [-5] }),
        (err) => err.code === 'INVALID_INCIDENT_ID' && err.statusCode === 400
      );
    });

    it('should reject requests exceeding max batch size with 400 BATCH_SIZE_EXCEEDED', () => {
      const largeBatch = Array.from({ length: 30 }, (_, i) => i + 1);
      assert.throws(
        () => validateRecommendationRequest({ incidentIds: largeBatch }),
        (err) => err.code === 'BATCH_SIZE_EXCEEDED' && err.statusCode === 400
      );
    });

    it('should reject unauthorized client injection of resource or hospital inventories', () => {
      assert.throws(
        () => validateRecommendationRequest({ incidentIds: [1001], resources: [{ id: 1 }] }),
        (err) => err.code === 'UNAUTHORIZED_INVENTORY_INJECTION' && err.statusCode === 400
      );
      assert.throws(
        () => validateRecommendationRequest({ incidentIds: [1001], hospitals: [{ id: 1 }] }),
        (err) => err.code === 'UNAUTHORIZED_INVENTORY_INJECTION' && err.statusCode === 400
      );
    });

    it('should reject unauthorized client injection of priority scores or assignments', () => {
      assert.throws(
        () => validateRecommendationRequest({ incidentIds: [1001], priorityScores: { 1001: 99 } }),
        (err) => err.code === 'UNAUTHORIZED_ASSIGNMENT_INJECTION' && err.statusCode === 400
      );
    });
  });

  describe('2. Incident Lifecycle Eligibility Checks', () => {
    it('should reject recommendation if requested incident does not exist with 404 INCIDENT_NOT_FOUND', async () => {
      const origFind = Incident.find;
      Incident.find = async () => [];

      try {
        await assert.rejects(
          async () => {
            await dispatchService.loadVerifiedIncidents([9999], false);
          },
          (err) => err.code === 'INCIDENT_NOT_FOUND' && err.statusCode === 404
        );
      } finally {
        Incident.find = origFind;
      }
    });

    it('should reject recommendation if incident is still in REPORTED status with 409 INELIGIBLE_INCIDENT', async () => {
      const origFind = Incident.find;
      Incident.find = async () => [
        { incidentId: 1001, status: 'REPORTED' }
      ];

      try {
        await assert.rejects(
          async () => {
            await dispatchService.loadVerifiedIncidents([1001], false);
          },
          (err) => err.code === 'INELIGIBLE_INCIDENT' && err.statusCode === 409
        );
      } finally {
        Incident.find = origFind;
      }
    });

    it('should reject recommendation if incident is REJECTED or CANCELLED with 409 INELIGIBLE_INCIDENT', async () => {
      const origFind = Incident.find;
      Incident.find = async () => [
        { incidentId: 1001, status: 'REJECTED' }
      ];

      try {
        await assert.rejects(
          async () => {
            await dispatchService.loadVerifiedIncidents([1001], false);
          },
          (err) => err.code === 'INELIGIBLE_INCIDENT' && err.statusCode === 409
        );
      } finally {
        Incident.find = origFind;
      }
    });
  });

  describe('3. Database Snapshot Loading & State Filtering', () => {
    it('should load only AVAILABLE resources and exclude RESERVED/DISPATCHED/OUT_OF_SERVICE', async () => {
      const origFind = Resource.find;
      let capturedQuery = null;
      Resource.find = async (q) => {
        capturedQuery = q;
        return [sampleResource501, sampleResource502];
      };

      try {
        const resources = await dispatchService.loadAvailableResources();
        assert.equal(capturedQuery.status, 'AVAILABLE');
        assert.equal(resources.length, 2);
        assert.equal(resources[0].resource_id, 501);
      } finally {
        Resource.find = origFind;
      }
    });

    it('should load only OPERATIONAL hospitals and exclude CLOSED/TEMPORARILY_UNAVAILABLE', async () => {
      const origFind = Hospital.find;
      let capturedQuery = null;
      Hospital.find = async (q) => {
        capturedQuery = q;
        return [sampleHospital701];
      };

      try {
        const hospitals = await dispatchService.loadOperationalHospitals();
        assert.equal(capturedQuery.status, 'OPERATIONAL');
        assert.equal(hospitals.length, 1);
        assert.equal(hospitals[0].hospital_id, 701);
      } finally {
        Hospital.find = origFind;
      }
    });
  });

  describe('4. C++ Engine Response Validation & Invariants', () => {
    const validEngineResponse = {
      status: 'success',
      protocol_version: '1.0',
      request_id: 'REQ-1234',
      operation: 'dispatch_batch',
      success: true,
      data: {
        batch_id: 1,
        batch_status: 'SUCCESS',
        total_incidents_received: 1,
        valid_incidents: 1,
        invalid_incidents: 0,
        fully_allocated_incidents: 1,
        partially_allocated_incidents: 0,
        unallocated_incidents: 0,
        total_unique_resources_recommended: 1,
        total_hospital_recommendations: 1,
        incident_results: [
          {
            incident_id: 1001,
            processing_order: 1,
            dispatch_status: 'FULLY_ALLOCATED',
            priority: {
              total_priority_score: 85.5,
              tier: 'CRITICAL',
              severity: 4,
              victim_count: 2
            },
            resource_allocation: {
              status: 'SUCCESS',
              selected_resources: [
                {
                  resource_id: 501,
                  resource_type: 'FIRE_ENGINE',
                  snapped_node_osm_id: 101,
                  road_distance_meters: 1200.5,
                  estimated_eta_seconds: 144.0
                }
              ]
            },
            hospital_matching: {
              status: 'SUCCESS',
              recommended_hospital_id: 701,
              recommended_hospital_name: 'MDM Hospital Jodhpur',
              selected_hospital: {
                hospital_id: 701,
                hospital_name: 'MDM Hospital Jodhpur',
                suitability: 'FULL_MATCH',
                road_distance_meters: 2500.0,
                simulated_eta_seconds: 300.0
              }
            }
          }
        ]
      }
    };

    it('should validate a compliant C++ engine response without errors', () => {
      assert.doesNotThrow(() => {
        validateEngineResponse(
          validEngineResponse,
          'REQ-1234',
          [1001],
          [{ resource_id: 501 }],
          [{ hospital_id: 701 }]
        );
      });
    });

    it('should reject response with mismatched request_id correlation', () => {
      assert.throws(
        () => {
          validateEngineResponse(
            validEngineResponse,
            'REQ-DIFFERENT',
            [1001],
            [{ resource_id: 501 }],
            [{ hospital_id: 701 }]
          );
        },
        (err) => err instanceof EngineResponseValidationError && err.message.includes('request_id mismatch')
      );
    });

    it('should reject response if requested incident result is missing', () => {
      assert.throws(
        () => {
          validateEngineResponse(
            validEngineResponse,
            'REQ-1234',
            [1001, 1002], // 1002 missing from engine result
            [{ resource_id: 501 }],
            [{ hospital_id: 701 }]
          );
        },
        (err) => err instanceof EngineResponseValidationError && err.message.includes('missing result')
      );
    });

    it('should reject response if engine recommends unknown resource not in input snapshot', () => {
      assert.throws(
        () => {
          validateEngineResponse(
            validEngineResponse,
            'REQ-1234',
            [1001],
            [{ resource_id: 999 }], // 501 was recommended but 999 was passed
            [{ hospital_id: 701 }]
          );
        },
        (err) => err instanceof EngineResponseValidationError && err.message.includes('unknown resource')
      );
    });

    it('should reject response if the same vehicle is recommended for multiple incidents (Mutual Exclusivity Violation)', () => {
      const conflictingResponse = JSON.parse(JSON.stringify(validEngineResponse));
      conflictingResponse.data.incident_results.push({
        incident_id: 1002,
        processing_order: 2,
        dispatch_status: 'FULLY_ALLOCATED',
        priority: { total_priority_score: 70.0, tier: 'HIGH' },
        resource_allocation: {
          status: 'SUCCESS',
          selected_resources: [
            {
              resource_id: 501, // 501 reused! Conflict!
              resource_type: 'FIRE_ENGINE',
              road_distance_meters: 1500,
              estimated_eta_seconds: 180
            }
          ]
        }
      });

      assert.throws(
        () => {
          validateEngineResponse(
            conflictingResponse,
            'REQ-1234',
            [1001, 1002],
            [{ resource_id: 501 }],
            [{ hospital_id: 701 }]
          );
        },
        (err) => err instanceof EngineResponseValidationError && err.message.includes('Vehicle conflict detected')
      );
    });

    it('should reject response if priority score is negative or non-finite', () => {
      const corruptPriResponse = JSON.parse(JSON.stringify(validEngineResponse));
      corruptPriResponse.data.incident_results[0].priority.total_priority_score = -10.5;

      assert.throws(
        () => {
          validateEngineResponse(
            corruptPriResponse,
            'REQ-1234',
            [1001],
            [{ resource_id: 501 }],
            [{ hospital_id: 701 }]
          );
        },
        (err) => err instanceof EngineResponseValidationError && err.message.includes('invalid non-finite priority score')
      );
    });
  });

  describe('5. Recommendation API Endpoints (POST, GET by ID, GET list)', () => {
    it('POST /api/dispatch/recommendations should allow OPERATOR and return 201 with recommendation snapshot', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origIncFind = Incident.find;
      const origResFind = Resource.find;
      const origHospFind = Hospital.find;
      const origExecBatch = cppEngineService.executeBatchDispatch;
      const origRecordSave = DispatchRecord.prototype.save;

      User.findById = async () => operatorUser;
      Incident.find = async () => [sampleIncident1001];
      Resource.find = async () => [sampleResource501];
      Hospital.find = async () => [sampleHospital701];

      origRecordSave;
      DispatchRecord.prototype.save = async function () {
        return this;
      };

      cppEngineService.executeBatchDispatch = async (payload, opts) => ({
        status: 'success',
        protocol_version: '1.0',
        request_id: opts.requestId,
        operation: 'dispatch_batch',
        success: true,
        data: {
          batch_id: 1,
          batch_status: 'SUCCESS',
          total_incidents_received: 1,
          valid_incidents: 1,
          invalid_incidents: 0,
          fully_allocated_incidents: 1,
          partially_allocated_incidents: 0,
          unallocated_incidents: 0,
          total_unique_resources_recommended: 1,
          total_hospital_recommendations: 1,
          incident_results: [
            {
              incident_id: 1001,
              processing_order: 1,
              dispatch_status: 'FULLY_ALLOCATED',
              priority: {
                total_priority_score: 85.5,
                tier: 'CRITICAL',
                severity: 4,
                victim_count: 2
              },
              resource_allocation: {
                status: 'SUCCESS',
                selected_resources: [
                  {
                    resource_id: 501,
                    resource_type: 'FIRE_ENGINE',
                    road_distance_meters: 1200.5,
                    estimated_eta_seconds: 144.0
                  }
                ]
              },
              hospital_matching: {
                status: 'SUCCESS',
                recommended_hospital_id: 701,
                recommended_hospital_name: 'MDM Hospital Jodhpur'
              }
            }
          ]
        }
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'POST',
          '/api/dispatch/recommendations',
          { incidentIds: [1001] },
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 201);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.recommendation.totalIncidents, 1);
        assert.equal(result.body.data.recommendation.recommendationStatus, 'RECOMMENDED');
        assert.equal(result.body.data.recommendation.incidentResults[0].incidentId, 1001);
        assert.equal(result.body.data.recommendation.incidentResults[0].priorityTier, 'CRITICAL');
      } finally {
        User.findById = origUserFind;
        Incident.find = origIncFind;
        Resource.find = origResFind;
        Hospital.find = origHospFind;
        cppEngineService.executeBatchDispatch = origExecBatch;
        DispatchRecord.prototype.save = origRecordSave;
        __setConnectionStateOverride(null);
      }
    });

    it('POST /api/dispatch/recommendations should deny CITIZEN with 403 Forbidden', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      User.findById = async () => citizenUser;

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'POST',
          '/api/dispatch/recommendations',
          { incidentIds: [1001] },
          { authorization: `Bearer ${tokenCitizen}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 403);
        assert.equal(result.body.error.code, 'FORBIDDEN');
      } finally {
        User.findById = origUserFind;
        __setConnectionStateOverride(null);
      }
    });

    it('GET /api/dispatch/recommendations/:batchId should return stored snapshot from MongoDB', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origFindOne = DispatchRecord.findOne;

      User.findById = async () => operatorUser;
      DispatchRecord.findOne = () => ({
        populate: function () {
          return this;
        },
        lean: async () => ({
          batchId: 'BATCH-20261118-TEST',
          requestId: 'REQ-SNAPSHOT-01',
          recommendationStatus: 'RECOMMENDED',
          totalIncidents: 1,
          includedIncidentIds: [1001],
          incidentResults: [
            {
              incidentId: 1001,
              priorityScore: 88.0,
              priorityTier: 'CRITICAL',
              allocationStatus: 'SUCCESS'
            }
          ]
        })
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/dispatch/recommendations/BATCH-20261118-TEST',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.recommendation.batchId, 'BATCH-20261118-TEST');
        assert.equal(result.body.data.recommendation.incidentResults[0].priorityScore, 88.0);
      } finally {
        User.findById = origUserFind;
        DispatchRecord.findOne = origFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('GET /api/dispatch/recommendations/:batchId should return 404 BATCH_NOT_FOUND if batch does not exist', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origFindOne = DispatchRecord.findOne;

      User.findById = async () => operatorUser;
      DispatchRecord.findOne = () => ({
        populate: function () {
          return this;
        },
        lean: async () => null
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/dispatch/recommendations/BATCH-NON-EXISTENT',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 404);
        assert.equal(result.body.error.code, 'BATCH_NOT_FOUND');
      } finally {
        User.findById = origUserFind;
        DispatchRecord.findOne = origFindOne;
        __setConnectionStateOverride(null);
      }
    });

    it('GET /api/dispatch/recommendations should return paginated list of recommendations for OPERATOR', async () => {
      __setConnectionStateOverride({ connected: true, state: 'connected' });

      const origUserFind = User.findById;
      const origCount = DispatchRecord.countDocuments;
      const origFind = DispatchRecord.find;

      User.findById = async () => operatorUser;
      DispatchRecord.countDocuments = async () => 1;
      DispatchRecord.find = () => ({
        populate: function () { return this; },
        sort: function () { return this; },
        skip: function () { return this; },
        limit: function () { return this; },
        lean: async () => [
          {
            batchId: 'BATCH-20261118-001',
            totalIncidents: 2,
            recommendationStatus: 'RECOMMENDED',
            evaluatedAt: new Date('2026-11-18T00:00:00.000Z')
          }
        ]
      });

      try {
        const { req, res, waitForResponse } = createMockHttp(
          'GET',
          '/api/dispatch/recommendations?page=1&limit=10',
          {},
          { authorization: `Bearer ${tokenOperator}` }
        );

        app(req, res);
        const result = await waitForResponse();

        assert.equal(result.statusCode, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.recommendations.length, 1);
        assert.equal(result.body.data.pagination.totalCount, 1);
      } finally {
        User.findById = origUserFind;
        DispatchRecord.countDocuments = origCount;
        DispatchRecord.find = origFind;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('6. Non-Mutation Guarantees', () => {
    it('generating recommendations should NOT mutate incident status, resource status, or hospital capacities', async () => {
      // Create local deep copies
      const incidentCopy = { ...sampleIncident1001, status: 'VERIFIED' };
      const resourceCopy = { ...sampleResource501, status: 'AVAILABLE' };
      const hospitalCopy = { ...sampleHospital701, icuBeds: { total: 10, available: 5 } };

      const origIncFind = Incident.find;
      const origResFind = Resource.find;
      const origHospFind = Hospital.find;
      const origExecBatch = cppEngineService.executeBatchDispatch;
      const origRecordSave = DispatchRecord.prototype.save;

      Incident.find = async () => [incidentCopy];
      Resource.find = async () => [resourceCopy];
      Hospital.find = async () => [hospitalCopy];
      DispatchRecord.prototype.save = async function () { return this; };

      __setConnectionStateOverride({ connected: true, state: 'connected' });

      cppEngineService.executeBatchDispatch = async (p, opts) => ({
        status: 'success',
        protocol_version: '1.0',
        request_id: opts.requestId,
        operation: 'dispatch_batch',
        success: true,
        data: {
          batch_id: 1,
          batch_status: 'SUCCESS',
          total_incidents_received: 1,
          incident_results: [
            {
              incident_id: 1001,
              processing_order: 1,
              priority: { total_priority_score: 80.0, tier: 'CRITICAL' },
              resource_allocation: {
                selected_resources: [{ resource_id: 501, road_distance_meters: 1000, estimated_eta_seconds: 120 }]
              },
              hospital_matching: {
                recommended_hospital_id: 701
              }
            }
          ]
        }
      });

      try {
        await dispatchService.generateDispatchRecommendations({ incidentIds: [1001] }, operatorUser);

        // Assert strictly unchanged
        assert.equal(incidentCopy.status, 'VERIFIED'); // Not changed to ALLOCATED
        assert.equal(resourceCopy.status, 'AVAILABLE'); // Not changed to RESERVED or DISPATCHED
        assert.equal(hospitalCopy.icuBeds.available, 5); // Bed count not decremented
      } finally {
        Incident.find = origIncFind;
        Resource.find = origResFind;
        Hospital.find = origHospFind;
        cppEngineService.executeBatchDispatch = origExecBatch;
        DispatchRecord.prototype.save = origRecordSave;
        __setConnectionStateOverride(null);
      }
    });
  });

  describe('7. Real Compiled C++ Decision Engine End-to-End Integration', () => {
    it('should invoke the actual compiled C++ executable and obtain verified dispatch recommendations', async () => {
      // Authentic test using real executable on genuine Jodhpur data
      const incident = new Incident({
        incidentId: 8001,
        category: 'FIRE',
        severity: 4,
        victimCount: 2,
        status: 'VERIFIED',
        latitude: 26.2918,
        longitude: 73.0168
      });

      const resource = new Resource({
        resourceId: 8501,
        resourceType: 'FIRE_ENGINE',
        status: 'AVAILABLE',
        latitude: 26.2950,
        longitude: 73.0150
      });

      const hospital = new Hospital({
        hospitalId: 8701,
        name: 'MDM Hospital Simulation',
        status: 'OPERATIONAL',
        latitude: 26.2750,
        longitude: 73.0180,
        icuBeds: { total: 10, available: 5 },
        generalBeds: { total: 50, available: 20 },
        oxygenBeds: { total: 20, available: 10 },
        capabilities: ['GENERAL_EMERGENCY', 'TRAUMA', 'ICU', 'BURN_TREATMENT', 'OXYGEN_SUPPORT']
      });

      const origIncFind = Incident.find;
      const origResFind = Resource.find;
      const origHospFind = Hospital.find;
      const origRecordSave = DispatchRecord.prototype.save;

      Incident.find = async () => [incident];
      Resource.find = async () => [resource];
      Hospital.find = async () => [hospital];
      DispatchRecord.prototype.save = async function () { return this; };

      __setConnectionStateOverride({ connected: true, state: 'connected' });

      try {
        const recommendation = await dispatchService.generateDispatchRecommendations(
          { incidentIds: [8001] },
          operatorUser
        );

        assert.ok(recommendation);
        assert.equal(recommendation.totalIncidents, 1);
        assert.equal(recommendation.recommendationStatus, 'RECOMMENDED');
        assert.equal(recommendation.incidentResults.length, 1);

        const incRes = recommendation.incidentResults[0];
        assert.equal(incRes.incidentId, 8001);
        assert.ok(incRes.priorityScore > 0);
        assert.ok(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(incRes.priorityTier));
        assert.equal(incRes.assignedResources.length, 1);
        assert.equal(incRes.assignedResources[0].resourceId, 8501);
        assert.ok(incRes.assignedResources[0].distanceMeters > 0);
        assert.ok(incRes.assignedResources[0].estimatedArrivalSeconds > 0);
        assert.equal(incRes.recommendedHospital.hospitalId, 8701);
        assert.ok(incRes.recommendedHospital.distanceMeters > 0);
      } finally {
        Incident.find = origIncFind;
        Resource.find = origResFind;
        Hospital.find = origHospFind;
        DispatchRecord.prototype.save = origRecordSave;
        __setConnectionStateOverride(null);
      }
    });
  });
});
