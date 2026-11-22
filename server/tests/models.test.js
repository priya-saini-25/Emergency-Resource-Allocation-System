import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Resource, { RESOURCE_TYPES, RESOURCE_STATUSES } from '../src/models/Resource.js';
import Hospital, { HOSPITAL_STATUSES, HOSPITAL_CAPABILITIES } from '../src/models/Hospital.js';
import Incident, { EMERGENCY_CATEGORIES, INCIDENT_STATUSES, PRIORITY_TIERS } from '../src/models/Incident.js';
import DispatchRecord, { BATCH_STATUSES } from '../src/models/DispatchRecord.js';

describe('Mongoose Models & Schema Constraints', () => {
  describe('Resource Model', () => {
    it('should validate a properly structured resource document', async () => {
      const validResource = new Resource({
        resourceId: 101,
        name: 'ALS Unit 1',
        resourceType: 'ALS_AMBULANCE',
        status: 'AVAILABLE',
        capacity: 1,
        latitude: 26.2918,
        longitude: 73.0168
      });

      await validResource.validate();
      assert.equal(validResource.resourceType, 'ALS_AMBULANCE');
      assert.equal(validResource.status, 'AVAILABLE');
    });

    it('should reject invalid resource types not aligned with C++ enums', async () => {
      const invalidResource = new Resource({
        resourceId: 102,
        resourceType: 'SPACE_SHUTTLE',
        latitude: 26.29,
        longitude: 73.01
      });

      await assert.rejects(async () => {
        await invalidResource.validate();
      }, (err) => {
        assert.ok(err.errors.resourceType);
        return true;
      });
    });

    it('should reject coordinates outside geographical ranges', async () => {
      const badLatResource = new Resource({
        resourceId: 103,
        resourceType: 'BLS_AMBULANCE',
        latitude: 95.0, // Invalid > 90
        longitude: 73.01
      });

      await assert.rejects(async () => {
        await badLatResource.validate();
      }, (err) => {
        assert.ok(err.errors.latitude);
        return true;
      });
    });

    it('should transform to valid C++ engine protocol object', () => {
      const resource = new Resource({
        resourceId: 501,
        resourceType: 'FIRE_ENGINE',
        status: 'AVAILABLE',
        capacity: 2,
        latitude: 26.295,
        longitude: 73.02,
        currentNodeOsmId: 123456
      });

      const proto = resource.toEngineProtocol();
      assert.equal(proto.resource_id, 501);
      assert.equal(proto.resource_type, 'FIRE_ENGINE');
      assert.equal(proto.status, 'AVAILABLE');
      assert.equal(proto.capacity, 2);
      assert.equal(proto.latitude, 26.295);
      assert.equal(proto.longitude, 73.02);
      assert.equal(proto.current_node_osm_id, 123456);
    });
  });

  describe('Hospital Model', () => {
    it('should validate a valid hospital document with bed categories', async () => {
      const hospital = new Hospital({
        hospitalId: 801,
        name: 'AIIMS Jodhpur Proxy Hospital',
        status: 'OPERATIONAL',
        capabilities: ['TRAUMA', 'ICU', 'GENERAL_EMERGENCY'],
        icuBeds: { total: 20, available: 5 },
        generalBeds: { total: 100, available: 40 },
        oxygenBeds: { total: 30, available: 15 },
        latitude: 26.255,
        longitude: 73.005
      });

      await hospital.validate();
    });

    it('should reject hospital if available beds exceed total beds', async () => {
      const invalidHospital = new Hospital({
        hospitalId: 802,
        name: 'Invalid Beds Hospital',
        status: 'OPERATIONAL',
        icuBeds: { total: 10, available: 15 }, // available > total
        latitude: 26.25,
        longitude: 73.0
      });

      await assert.rejects(async () => {
        await invalidHospital.validate();
      }, (err) => {
        assert.ok(err.errors['icuBeds.available']);
        return true;
      });
    });

    it('should reject invalid capability strings', async () => {
      const badCapHospital = new Hospital({
        hospitalId: 803,
        name: 'Unknown Capability Hospital',
        capabilities: ['ASTRONOMY_WARD'],
        latitude: 26.25,
        longitude: 73.0
      });

      await assert.rejects(async () => {
        await badCapHospital.validate();
      }, (err) => {
        assert.ok(err.errors['capabilities.0']);
        return true;
      });
    });

    it('should serialize to C++ hospital protocol format', () => {
      const hospital = new Hospital({
        hospitalId: 901,
        name: 'MDM Hospital Proxy',
        status: 'OPERATIONAL',
        capabilities: ['TRAUMA', 'ICU'],
        icuBeds: { total: 15, available: 4 },
        generalBeds: { total: 80, available: 25 },
        oxygenBeds: { total: 20, available: 10 },
        latitude: 26.28,
        longitude: 73.02,
        nodeOsmId: 887766
      });

      const proto = hospital.toEngineProtocol();
      assert.equal(proto.hospital_id, 901);
      assert.equal(proto.hospital_name, 'MDM Hospital Proxy');
      assert.equal(proto.status, 'OPERATIONAL');
      assert.deepEqual(proto.capabilities, ['TRAUMA', 'ICU']);
      assert.equal(proto.icu_beds_total, 15);
      assert.equal(proto.icu_beds_available, 4);
      assert.equal(proto.node_osm_id, 887766);
    });
  });

  describe('Incident Model', () => {
    it('should validate a valid emergency incident document', async () => {
      const incident = new Incident({
        incidentId: 1001,
        category: 'ROAD_ACCIDENT',
        severity: 4,
        victimCount: 3,
        latitude: 26.2918,
        longitude: 73.0168
      });

      await incident.validate();
      assert.equal(incident.status, 'REPORTED');
      assert.equal(incident.priorityTier, 'UNKNOWN');
    });

    it('should reject incident severity less than 1 or greater than 5', async () => {
      const badSeverityLow = new Incident({
        incidentId: 1002,
        category: 'MEDICAL',
        severity: 0,
        latitude: 26.29,
        longitude: 73.01
      });
      await assert.rejects(async () => { await badSeverityLow.validate(); });

      const badSeverityHigh = new Incident({
        incidentId: 1003,
        category: 'MEDICAL',
        severity: 6,
        latitude: 26.29,
        longitude: 73.01
      });
      await assert.rejects(async () => { await badSeverityHigh.validate(); });
    });

    it('should reject negative victim count', async () => {
      const badVictims = new Incident({
        incidentId: 1004,
        category: 'FIRE',
        severity: 3,
        victimCount: -1,
        latitude: 26.29,
        longitude: 73.01
      });
      await assert.rejects(async () => { await badVictims.validate(); });
    });

    it('should serialize to C++ incident protocol format', () => {
      const incident = new Incident({
        incidentId: 2001,
        category: 'FIRE',
        severity: 5,
        victimCount: 4,
        latitude: 26.2918,
        longitude: 73.0168,
        incidentNodeOsmId: 998877,
        resourceDemands: [{ type: 'FIRE_ENGINE', quantity: 2 }]
      });

      const proto = incident.toEngineProtocol();
      assert.equal(proto.incident_id, 2001);
      assert.equal(proto.category, 'FIRE');
      assert.equal(proto.severity, 5);
      assert.equal(proto.victim_count, 4);
      assert.equal(proto.incident_node_osm_id, 998877);
      assert.equal(proto.resource_demands.length, 1);
      assert.equal(proto.resource_demands[0].type, 'FIRE_ENGINE');
      assert.equal(proto.resource_demands[0].quantity, 2);
    });
  });

  describe('DispatchRecord Model', () => {
    it('should validate a complete dispatch record document', async () => {
      const record = new DispatchRecord({
        batchId: 'batch-20261118-001',
        requestId: 'req-abc-123',
        batchStatus: 'SUCCESS',
        totalIncidents: 2,
        fullyAllocatedCount: 2,
        partiallyAllocatedCount: 0,
        unallocatedCount: 0,
        incidentResults: [
          {
            incidentId: 101,
            priorityScore: 82.5,
            priorityTier: 'CRITICAL',
            allocationStatus: 'ALLOCATED'
          }
        ],
        engineTelemetry: {
          engineExecutionTimeUs: 4500,
          processWallClockMs: 25,
          protocolVersion: '1.0'
        }
      });

      await record.validate();
    });
  });
});
