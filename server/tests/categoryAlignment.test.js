process.env.NODE_ENV = 'test';
import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Incident, { EMERGENCY_CATEGORIES } from '../src/models/Incident.js';
import { createIncident, listIncidents } from '../src/controllers/incidentController.js';
import { executeBatchDispatch } from '../src/services/cppEngineService.js';
import { __setConnectionStateOverride } from '../src/config/database.js';

describe('Emergency Category Alignment & Support Audit Tests', () => {
  before(() => {
    __setConnectionStateOverride({ connected: true });
  });

  after(() => {
    __setConnectionStateOverride(null);
  });

  const citizenUser = {
    _id: '507f1f77bcf86cd799439011',
    id: '507f1f77bcf86cd799439011',
    name: 'Citizen Meera',
    email: 'meera@example.com',
    role: 'CITIZEN'
  };

  const operatorUser = {
    _id: '507f1f77bcf86cd799439088',
    id: '507f1f77bcf86cd799439088',
    name: 'Operator Dan',
    email: 'operator@jodhpur.emergency.gov.in',
    role: 'OPERATOR'
  };

  const citizen8Categories = [
    'FIRE',
    'ROAD_ACCIDENT',
    'MEDICAL_EMERGENCY',
    'HAZMAT',
    'STRUCTURAL_COLLAPSE',
    'NATURAL_DISASTER',
    'CIVIL_DISTURBANCE',
    'OTHER'
  ];

  describe('1. Canonical Category Taxonomy & Schema Validation', () => {
    it('should include all 8 Citizen Portal categories plus canonical MEDICAL and INDUSTRIAL in EMERGENCY_CATEGORIES', () => {
      for (const cat of citizen8Categories) {
        assert.ok(
          EMERGENCY_CATEGORIES.includes(cat),
          `EMERGENCY_CATEGORIES must include citizen category: ${cat}`
        );
      }
      assert.ok(EMERGENCY_CATEGORIES.includes('MEDICAL'), 'Must include MEDICAL');
      assert.ok(EMERGENCY_CATEGORIES.includes('INDUSTRIAL'), 'Must include INDUSTRIAL');
    });

    it('should validate and persist an incident for each of the 8 Citizen Portal categories', () => {
      for (const cat of citizen8Categories) {
        const doc = new Incident({
          incidentId: 9000 + citizen8Categories.indexOf(cat),
          category: cat,
          subcategory: 'Subcategory ' + cat,
          severity: 3,
          victimCount: 1,
          latitude: 26.2978,
          longitude: 73.0185
        });

        const validationErr = doc.validateSync();
        assert.equal(validationErr, undefined, `Document for ${cat} must pass Mongoose validation`);
        assert.equal(doc.category, cat);
        assert.equal(doc.subcategory, 'Subcategory ' + cat);
      }
    });

    it('should reject invalid/unrecognized categories with Mongoose validation error', () => {
      const doc = new Incident({
        incidentId: 9999,
        category: 'ALIEN_INVASION',
        severity: 3,
        latitude: 26.2978,
        longitude: 73.0185
      });

      const err = doc.validateSync();
      assert.ok(err, 'Mongoose validation should fail for invalid category');
      assert.ok(err.errors['category'], 'category field should have validation error');
    });

    it('should map MEDICAL_EMERGENCY to MEDICAL in toEngineProtocol()', () => {
      const doc = new Incident({
        incidentId: 9101,
        category: 'MEDICAL_EMERGENCY',
        severity: 4,
        victimCount: 2,
        latitude: 26.2978,
        longitude: 73.0185
      });

      const proto = doc.toEngineProtocol();
      assert.equal(proto.category, 'MEDICAL', 'MEDICAL_EMERGENCY must map to MEDICAL for C++ engine');
      assert.equal(proto.incident_id, 9101);
      assert.equal(proto.severity, 4);
    });

    it('should retain canonical category names in toEngineProtocol() for other categories', () => {
      const doc = new Incident({
        incidentId: 9102,
        category: 'STRUCTURAL_COLLAPSE',
        severity: 5,
        latitude: 26.2978,
        longitude: 73.0185
      });

      const proto = doc.toEngineProtocol();
      assert.equal(proto.category, 'STRUCTURAL_COLLAPSE');
    });
  });

  describe('2. Intake Controller & Filter Consistency', () => {
    it('should accept intake for all 8 citizen categories via createIncident controller', async () => {
      const origCreate = Incident.create;
      try {
        for (const cat of citizen8Categories) {
          let createdPayload = null;
          Incident.create = async (payload) => {
            createdPayload = payload;
            return {
              ...payload,
              _id: '507f1f77bcf86cd799439099'
            };
          };

          const req = {
            user: citizenUser,
            body: {
              category: cat,
              subcategory: 'Sector 4',
              severity: 4,
              victimCount: 2,
              description: `Emergency report for ${cat}`,
              location: {
                latitude: 26.2978,
                longitude: 73.0185
              }
            }
          };

          let statusCode = null;
          let jsonBody = null;
          const res = {
            status(code) {
              statusCode = code;
              return this;
            },
            json(body) {
              jsonBody = body;
              return this;
            }
          };

          await createIncident(req, res, (err) => {
            throw err;
          });

          assert.equal(statusCode, 201, `Status code for ${cat} must be 201`);
          assert.equal(jsonBody.success, true);
          assert.equal(jsonBody.data.incident.category, cat);
          assert.equal(jsonBody.data.incident.subcategory, 'Sector 4');
          assert.equal(createdPayload.category, cat);
        }
      } finally {
        Incident.create = origCreate;
      }
    });

    it('should reject unknown category during intake with 400 and INVALID_CATEGORY', async () => {
      const req = {
        user: citizenUser,
        body: {
          category: 'UNRECOGNIZED_CRISIS',
          severity: 3,
          location: {
            latitude: 26.2978,
            longitude: 73.0185
          }
        }
      };

      let statusCode = null;
      let jsonBody = null;
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(body) {
          jsonBody = body;
          return this;
        }
      };

      await createIncident(req, res, (err) => {
        throw err;
      });

      assert.equal(statusCode, 400);
      assert.equal(jsonBody.success, false);
      assert.equal(jsonBody.error.code, 'INVALID_CATEGORY');
    });

    it('should permit filtering by all valid categories in getIncidents query', async () => {
      const origFind = Incident.find;
      const origCount = Incident.countDocuments;
      try {
        for (const cat of [...citizen8Categories, 'INDUSTRIAL', 'MEDICAL']) {
          let appliedQuery = null;
          Incident.countDocuments = async (q) => {
            appliedQuery = q;
            return 1;
          };
          Incident.find = (q) => ({
            populate() {
              return this;
            },
            sort() {
              return this;
            },
            skip() {
              return this;
            },
            limit() {
              return this;
            },
            lean: async () => [
              {
                incidentId: 101,
                category: cat,
                severity: 3,
                latitude: 26.2978,
                longitude: 73.0185
              }
            ]
          });

          const req = {
            user: operatorUser,
            query: { category: cat }
          };

          let statusCode = 200;
          let jsonBody = null;
          const res = {
            status(code) {
              statusCode = code;
              return this;
            },
            json(body) {
              jsonBody = body;
              return this;
            }
          };

          await listIncidents(req, res, (err) => {
            throw err;
          });

          assert.equal(statusCode, 200);
          assert.equal(jsonBody.success, true);
          assert.equal(appliedQuery.category, cat, `Query should filter by ${cat}`);
        }
      } finally {
        Incident.find = origFind;
        Incident.countDocuments = origCount;
      }
    });

    it('should reject invalid category filter with 400 INVALID_CATEGORY_FILTER', async () => {
      const req = {
        user: operatorUser,
        query: { category: 'NON_EXISTENT_CATEGORY' }
      };

      let statusCode = null;
      let jsonBody = null;
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(body) {
          jsonBody = body;
          return this;
        }
      };

      await listIncidents(req, res, (err) => {
        throw err;
      });

      assert.equal(statusCode, 400);
      assert.equal(jsonBody.error.code, 'INVALID_CATEGORY_FILTER');
    });
  });

  describe('3. C++ Decision Engine Execution Across All Categories', () => {
    // 15 canonical simulated vehicles
    const fleet = [
      { resource_id: 101, resource_type: 'ALS_AMBULANCE', status: 'AVAILABLE', capacity: 2, latitude: 26.2550, longitude: 73.0100 },
      { resource_id: 102, resource_type: 'ALS_AMBULANCE', status: 'AVAILABLE', capacity: 2, latitude: 26.2550, longitude: 73.0100 },
      { resource_id: 103, resource_type: 'BLS_AMBULANCE', status: 'AVAILABLE', capacity: 1, latitude: 26.2550, longitude: 73.0100 },
      { resource_id: 201, resource_type: 'FIRE_ENGINE', status: 'AVAILABLE', capacity: 6, latitude: 26.2300, longitude: 73.0050 },
      { resource_id: 202, resource_type: 'FIRE_ENGINE', status: 'AVAILABLE', capacity: 6, latitude: 26.2300, longitude: 73.0050 },
      { resource_id: 203, resource_type: 'FIRE_TENDER', status: 'AVAILABLE', capacity: 2, latitude: 26.2300, longitude: 73.0050 },
      { resource_id: 204, resource_type: 'RESCUE_VEHICLE', status: 'AVAILABLE', capacity: 4, latitude: 26.2300, longitude: 73.0050 },
      { resource_id: 301, resource_type: 'ALS_AMBULANCE', status: 'AVAILABLE', capacity: 2, latitude: 26.3100, longitude: 73.0450 },
      { resource_id: 302, resource_type: 'BLS_AMBULANCE', status: 'AVAILABLE', capacity: 1, latitude: 26.3100, longitude: 73.0450 },
      { resource_id: 304, resource_type: 'FIRE_ENGINE', status: 'AVAILABLE', capacity: 6, latitude: 26.3100, longitude: 73.0450 },
      { resource_id: 305, resource_type: 'RESCUE_VEHICLE', status: 'AVAILABLE', capacity: 4, latitude: 26.3100, longitude: 73.0450 },
      { resource_id: 401, resource_type: 'ALS_AMBULANCE', status: 'AVAILABLE', capacity: 2, latitude: 26.2750, longitude: 73.0080 },
      { resource_id: 402, resource_type: 'BLS_AMBULANCE', status: 'AVAILABLE', capacity: 1, latitude: 26.2750, longitude: 73.0080 },
      { resource_id: 501, resource_type: 'FIRE_TENDER', status: 'AVAILABLE', capacity: 2, latitude: 26.2920, longitude: 73.0150 },
      { resource_id: 502, resource_type: 'RESCUE_VEHICLE', status: 'AVAILABLE', capacity: 4, latitude: 26.2920, longitude: 73.0150 }
    ];

    const hospitals = [
      {
        hospital_id: 701,
        hospital_name: 'AIIMS Jodhpur',
        latitude: 26.2550,
        longitude: 73.0100,
        status: 'OPERATIONAL',
        capabilities: ['GENERAL_EMERGENCY', 'TRAUMA', 'ICU', 'OXYGEN_SUPPORT', 'BURN_TREATMENT', 'SURGICAL_SUPPORT'],
        icu_beds_total: 20,
        icu_beds_available: 10,
        general_beds_total: 100,
        general_beds_available: 50,
        available_oxygen_beds: 20,
        oxygen_supported_beds_total: 40,
        oxygen_supported_beds_available: 20
      },
      {
        hospital_id: 702,
        hospital_name: 'MDM Hospital',
        latitude: 26.2750,
        longitude: 73.0080,
        status: 'OPERATIONAL',
        capabilities: ['GENERAL_EMERGENCY', 'TRAUMA', 'ICU', 'OXYGEN_SUPPORT', 'SURGICAL_SUPPORT'],
        icu_beds_total: 15,
        icu_beds_available: 8,
        general_beds_total: 80,
        general_beds_available: 40,
        available_oxygen_beds: 15,
        oxygen_supported_beds_total: 30,
        oxygen_supported_beds_available: 15
      },
      {
        hospital_id: 703,
        hospital_name: 'Mahatma Gandhi Hospital',
        latitude: 26.2920,
        longitude: 73.0150,
        status: 'OPERATIONAL',
        capabilities: ['GENERAL_EMERGENCY', 'TRAUMA', 'OXYGEN_SUPPORT', 'BURN_TREATMENT'],
        icu_beds_total: 10,
        icu_beds_available: 5,
        general_beds_total: 60,
        general_beds_available: 30,
        available_oxygen_beds: 10,
        oxygen_supported_beds_total: 25,
        oxygen_supported_beds_available: 10
      }
    ];

    it('should successfully allocate resources and hospitals for supported categories: FIRE, ROAD_ACCIDENT, MEDICAL, STRUCTURAL_COLLAPSE, OTHER', async () => {
      const supportedTestCases = [
        { id: 301, category: 'FIRE' },
        { id: 302, category: 'ROAD_ACCIDENT' },
        { id: 303, category: 'MEDICAL' },
        { id: 304, category: 'STRUCTURAL_COLLAPSE' },
        { id: 305, category: 'OTHER' }
      ];

      for (const tc of supportedTestCases) {
        const payload = {
          batch_id: 3000 + tc.id,
          evaluated_at_ms: Date.now(),
          incidents: [
            {
              incident_id: tc.id,
              category: tc.category,
              severity: 4,
              victim_count: 2,
              created_at_ms: Date.now() - 30000,
              latitude: 26.2978,
              longitude: 73.0185
            }
          ],
          resources: fleet,
          hospitals: hospitals
        };

        const response = await executeBatchDispatch(payload);
        const incRes = response.data.incident_results[0];
        assert.equal(incRes.incident_id, tc.id);
        assert.ok(
          incRes.dispatch_status === 'FULLY_DISPATCHED' || incRes.dispatch_status === 'PARTIALLY_DISPATCHED',
          `Status for ${tc.category} should be fully or partially dispatched, got ${incRes.dispatch_status}`
        );
        assert.ok(
          incRes.resource_allocation.selected_resources.length > 0,
          `${tc.category} must have selected at least 1 compatible resource`
        );
        assert.ok(
          incRes.hospital_matching.status === 'SUITABLE_HOSPITALS_FOUND' || incRes.hospital_matching.suitable_hospitals.length > 0,
          `${tc.category} must find suitable hospitals`
        );
      }
    });

    it('should gracefully handle unsupported specialist categories (HAZMAT, NATURAL_DISASTER, CIVIL_DISTURBANCE) with NO_COMPATIBLE_RESOURCES', async () => {
      const specialistTestCases = [
        { id: 401, category: 'HAZMAT', expectedSnippet: 'HAZMAT' },
        { id: 402, category: 'NATURAL_DISASTER', expectedSnippet: 'flood' },
        { id: 403, category: 'CIVIL_DISTURBANCE', expectedSnippet: 'Law enforcement' }
      ];

      for (const tc of specialistTestCases) {
        const payload = {
          batch_id: 4000 + tc.id,
          evaluated_at_ms: Date.now(),
          incidents: [
            {
              incident_id: tc.id,
              category: tc.category,
              severity: 4,
              victim_count: 2,
              created_at_ms: Date.now() - 30000,
              latitude: 26.2978,
              longitude: 73.0185
            }
          ],
          resources: fleet,
          hospitals: hospitals
        };

        const response = await executeBatchDispatch(payload);
        const incRes = response.data.incident_results[0];
        assert.equal(incRes.incident_id, tc.id);
        assert.equal(
          incRes.resource_allocation.status,
          'NO_COMPATIBLE_RESOURCES',
          `${tc.category} must have NO_COMPATIBLE_RESOURCES status`
        );
        assert.equal(
          incRes.resource_allocation.selected_resources.length,
          0,
          `${tc.category} must have zero allocated fleet resources`
        );
        assert.ok(
          incRes.summary_notes.toLowerCase().includes(tc.expectedSnippet.toLowerCase()),
          `Summary notes for ${tc.category} must mention reason: got "${incRes.summary_notes}"`
        );
      }
    });
  });
});
