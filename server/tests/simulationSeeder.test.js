process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Hospital from '../src/models/Hospital.js';
import Resource from '../src/models/Resource.js';
import {
  bootstrapSimulationData,
  SIMULATED_HOSPITALS,
  SIMULATED_RESOURCES
} from '../src/utils/bootstrapSimulationData.js';

describe('Jodhpur Simulation Data Seeder Unit & Idempotency Tests', () => {
  it('should seed 3 simulated hospitals and 15 simulated resources on an empty database', async () => {
    const createdHospitals = [];
    const createdResources = [];

    const origHospFindOne = Hospital.findOne;
    const origHospCreate = Hospital.create;
    const origResFindOne = Resource.findOne;
    const origResCreate = Resource.create;

    Hospital.findOne = async () => null;
    Hospital.create = async (doc) => {
      createdHospitals.push(doc);
      return doc;
    };

    Resource.findOne = async () => null;
    Resource.create = async (doc) => {
      createdResources.push(doc);
      return doc;
    };

    try {
      const stats = await bootstrapSimulationData();

      assert.equal(stats.hospitalsCreated, 3, 'Should create exactly 3 hospitals');
      assert.equal(stats.hospitalsSkipped, 0, 'Should skip 0 hospitals on clean run');
      assert.equal(stats.resourcesCreated, 15, 'Should create exactly 15 resources');
      assert.equal(stats.resourcesSkipped, 0, 'Should skip 0 resources on clean run');

      assert.equal(createdHospitals.length, 3);
      assert.equal(createdResources.length, 15);

      // Verify all created hospitals have status OPERATIONAL and simulation tag
      for (const h of createdHospitals) {
        assert.equal(h.status, 'OPERATIONAL');
        assert.ok(h.name.includes('(Simulation)'));
      }

      // Verify all created resources have status AVAILABLE and simulation tag
      for (const r of createdResources) {
        assert.equal(r.status, 'AVAILABLE');
        assert.ok(r.name.includes('(Simulation)'));
      }
    } finally {
      Hospital.findOne = origHospFindOne;
      Hospital.create = origHospCreate;
      Resource.findOne = origResFindOne;
      Resource.create = origResCreate;
    }
  });

  it('should be strictly idempotent and skip creating duplicates when records already exist', async () => {
    const createdHospitals = [];
    const createdResources = [];

    const origHospFindOne = Hospital.findOne;
    const origHospCreate = Hospital.create;
    const origResFindOne = Resource.findOne;
    const origResCreate = Resource.create;

    // Simulate all records already existing
    Hospital.findOne = async ({ hospitalId }) => ({ hospitalId, name: `Existing-${hospitalId}`, status: 'OPERATIONAL' });
    Hospital.create = async (doc) => {
      createdHospitals.push(doc);
      return doc;
    };

    Resource.findOne = async ({ resourceId }) => ({ resourceId, name: `Existing-${resourceId}`, status: 'AVAILABLE' });
    Resource.create = async (doc) => {
      createdResources.push(doc);
      return doc;
    };

    try {
      const stats = await bootstrapSimulationData();

      assert.equal(stats.hospitalsCreated, 0, 'Should create 0 hospitals');
      assert.equal(stats.hospitalsSkipped, 3, 'Should skip all 3 existing hospitals');
      assert.equal(stats.resourcesCreated, 0, 'Should create 0 resources');
      assert.equal(stats.resourcesSkipped, 15, 'Should skip all 15 existing resources');

      assert.equal(createdHospitals.length, 0, 'No hospital creations should be invoked');
      assert.equal(createdResources.length, 0, 'No resource creations should be invoked');
    } finally {
      Hospital.findOne = origHospFindOne;
      Hospital.create = origHospCreate;
      Resource.findOne = origResFindOne;
      Resource.create = origResCreate;
    }
  });

  it('should recover partially populated database without overwriting existing records or duplicating', async () => {
    const createdHospitals = [];
    const createdResources = [];

    const origHospFindOne = Hospital.findOne;
    const origHospCreate = Hospital.create;
    const origResFindOne = Resource.findOne;
    const origResCreate = Resource.create;

    // Simulate 1 existing hospital (701) and 5 existing resources (101, 102, 103, 201, 202)
    const existingHospitalIds = new Set([701]);
    const existingResourceIds = new Set([101, 102, 103, 201, 202]);

    Hospital.findOne = async ({ hospitalId }) => {
      if (existingHospitalIds.has(hospitalId)) {
        return { hospitalId, status: 'OPERATIONAL', customField: 'preserved' };
      }
      return null;
    };
    Hospital.create = async (doc) => {
      createdHospitals.push(doc);
      return doc;
    };

    Resource.findOne = async ({ resourceId }) => {
      if (existingResourceIds.has(resourceId)) {
        return { resourceId, status: 'DISPATCHED', customNote: 'on active mission' };
      }
      return null;
    };
    Resource.create = async (doc) => {
      createdResources.push(doc);
      return doc;
    };

    try {
      const stats = await bootstrapSimulationData();

      assert.equal(stats.hospitalsCreated, 2, 'Should create the 2 missing hospitals');
      assert.equal(stats.hospitalsSkipped, 1, 'Should skip the 1 existing hospital');
      assert.equal(stats.resourcesCreated, 10, 'Should create the 10 missing resources');
      assert.equal(stats.resourcesSkipped, 5, 'Should skip the 5 existing resources');

      // Verify the IDs of created records
      assert.ok(createdHospitals.some((h) => h.hospitalId === 702));
      assert.ok(createdHospitals.some((h) => h.hospitalId === 703));
      assert.ok(!createdHospitals.some((h) => h.hospitalId === 701));

      assert.ok(!createdResources.some((r) => existingResourceIds.has(r.resourceId)));
    } finally {
      Hospital.findOne = origHospFindOne;
      Hospital.create = origHospCreate;
      Resource.findOne = origResFindOne;
      Resource.create = origResCreate;
    }
  });

  it('should preserve existing custom status or operational modifications on re-run', async () => {
    const origResFindOne = Resource.findOne;
    const origResCreate = Resource.create;
    const origHospFindOne = Hospital.findOne;
    const origHospCreate = Hospital.create;

    let modifiedResourceFound = false;

    // Hospital 701 has custom available beds, Resource 101 is OUT_OF_SERVICE
    Hospital.findOne = async ({ hospitalId }) => {
      return {
        hospitalId,
        status: 'TEMPORARILY_UNAVAILABLE',
        capacity: { general: { total: 100, available: 0 } }
      };
    };
    Hospital.create = async () => {
      throw new Error('Should not call create for existing hospital');
    };

    Resource.findOne = async ({ resourceId }) => {
      if (resourceId === 101) {
        modifiedResourceFound = true;
        return { resourceId, status: 'OUT_OF_SERVICE', customTag: 'under maintenance' };
      }
      return { resourceId, status: 'AVAILABLE' };
    };
    Resource.create = async () => {
      throw new Error('Should not call create for existing resource');
    };

    try {
      const stats = await bootstrapSimulationData();
      assert.equal(stats.resourcesSkipped, 15);
      assert.equal(stats.hospitalsSkipped, 3);
      assert.equal(modifiedResourceFound, true);
    } finally {
      Resource.findOne = origResFindOne;
      Resource.create = origResCreate;
      Hospital.findOne = origHospFindOne;
      Hospital.create = origHospCreate;
    }
  });
});
