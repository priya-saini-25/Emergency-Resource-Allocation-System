process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Incident from '../src/models/Incident.js';
import Resource from '../src/models/Resource.js';
import Hospital from '../src/models/Hospital.js';
import DispatchRecord from '../src/models/DispatchRecord.js';
import {
  confirmDispatch,
  DispatchConfirmationError
} from '../src/services/dispatchExecutionService.js';
import { __setConnectionStateOverride } from '../src/config/database.js';

function createMockSession() {
  return {
    hasStarted: false,
    hasCommitted: false,
    hasAborted: false,
    hasEnded: false,
    startTransaction() {
      this.hasStarted = true;
    },
    async commitTransaction() {
      this.hasCommitted = true;
    },
    async abortTransaction() {
      this.hasAborted = true;
    },
    async endSession() {
      this.hasEnded = true;
    }
  };
}

describe('Dispatch Execution Integrity & Failed Batch Blocking Tests', () => {
  const operatorUser = {
    _id: '507f1f77bcf86cd799439088',
    id: '507f1f77bcf86cd799439088',
    name: 'Operator Dan',
    email: 'operator@jodhpur.emergency.gov.in',
    role: 'OPERATOR',
    isActive: true
  };

  it('should reject confirmation with CANNOT_CONFIRM_FAILED_BATCH (409) when batchStatus is FAILED', async () => {
    const origFindOne = DispatchRecord.findOne;
    DispatchRecord.findOne = async () => ({
      batchId: 'BATCH-FAILED-001',
      batchStatus: 'FAILED',
      recommendationStatus: 'FAILED',
      confirmationStatus: 'PENDING',
      batchStatusMessage: 'Zero resources allocated by C++ engine',
      incidentResults: [
        {
          incidentId: 2001,
          allocationStatus: 'NO_RESOURCES_AVAILABLE',
          assignedResources: []
        }
      ]
    });

    try {
      await assert.rejects(
        async () => {
          await confirmDispatch('BATCH-FAILED-001', {}, operatorUser);
        },
        (err) => {
          assert.ok(err instanceof DispatchConfirmationError);
          assert.equal(err.code, 'CANNOT_CONFIRM_FAILED_BATCH');
          assert.equal(err.statusCode, 409);
          assert.ok(err.message.includes('algorithmic evaluation failed'));
          return true;
        }
      );
    } finally {
      DispatchRecord.findOne = origFindOne;
    }
  });

  it('should reject confirmation with CANNOT_CONFIRM_FAILED_BATCH (409) when recommendationStatus is FAILED', async () => {
    const origFindOne = DispatchRecord.findOne;
    DispatchRecord.findOne = async () => ({
      batchId: 'BATCH-FAILED-002',
      batchStatus: 'SUCCESS',
      recommendationStatus: 'FAILED',
      confirmationStatus: 'PENDING',
      batchStatusMessage: 'Engine execution status failed',
      incidentResults: [
        {
          incidentId: 2002,
          allocationStatus: 'FULLY_ALLOCATED',
          assignedResources: [{ resourceId: 101, resourceType: 'ALS_AMBULANCE' }]
        }
      ]
    });

    try {
      await assert.rejects(
        async () => {
          await confirmDispatch('BATCH-FAILED-002', {}, operatorUser);
        },
        (err) => {
          assert.ok(err instanceof DispatchConfirmationError);
          assert.equal(err.code, 'CANNOT_CONFIRM_FAILED_BATCH');
          assert.equal(err.statusCode, 409);
          return true;
        }
      );
    } finally {
      DispatchRecord.findOne = origFindOne;
    }
  });

  it('should reject confirmation with CANNOT_DISPATCH_EMPTY_FLEET (409) when total assigned vehicles is 0', async () => {
    const origFindOne = DispatchRecord.findOne;
    const origIncFind = Incident.find;

    DispatchRecord.findOne = async () => ({
      batchId: 'BATCH-EMPTY-003',
      batchStatus: 'SUCCESS',
      recommendationStatus: 'RECOMMENDED',
      confirmationStatus: 'PENDING',
      includedIncidentIds: [2003],
      incidentResults: [
        {
          incidentId: 2003,
          allocationStatus: 'PARTIALLY_ALLOCATED',
          assignedResources: []
        }
      ]
    });
    Incident.find = async () => [{ incidentId: 2003, status: 'VERIFIED' }];

    try {
      await assert.rejects(
        async () => {
          await confirmDispatch('BATCH-EMPTY-003', {}, operatorUser);
        },
        (err) => {
          assert.ok(err instanceof DispatchConfirmationError);
          assert.equal(err.code, 'CANNOT_DISPATCH_EMPTY_FLEET');
          assert.equal(err.statusCode, 409);
          assert.ok(err.message.includes('zero assigned vehicles'));
          return true;
        }
      );
    } finally {
      DispatchRecord.findOne = origFindOne;
      Incident.find = origIncFind;
    }
  });

  it('should reject confirmation with CANNOT_CONFIRM_FAILED_BATCH (409) when incident allocationStatus is NO_RESOURCES_AVAILABLE', async () => {
    const origFindOne = DispatchRecord.findOne;
    const origIncFind = Incident.find;

    DispatchRecord.findOne = async () => ({
      batchId: 'BATCH-NO-RES-004',
      batchStatus: 'SUCCESS',
      recommendationStatus: 'RECOMMENDED',
      confirmationStatus: 'PENDING',
      includedIncidentIds: [2004],
      incidentResults: [
        {
          incidentId: 2004,
          allocationStatus: 'NO_RESOURCES_AVAILABLE',
          assignedResources: [{ resourceId: 101, resourceType: 'ALS_AMBULANCE' }]
        }
      ]
    });
    Incident.find = async () => [{ incidentId: 2004, status: 'VERIFIED' }];

    try {
      await assert.rejects(
        async () => {
          await confirmDispatch('BATCH-NO-RES-004', {}, operatorUser);
        },
        (err) => {
          assert.ok(err instanceof DispatchConfirmationError);
          assert.equal(err.code, 'CANNOT_CONFIRM_FAILED_BATCH');
          assert.equal(err.statusCode, 409);
          assert.ok(err.message.includes('NO_RESOURCES_AVAILABLE'));
          return true;
        }
      );
    } finally {
      DispatchRecord.findOne = origFindOne;
      Incident.find = origIncFind;
    }
  });

  it('should reject confirmation with CANNOT_CONFIRM_FAILED_BATCH (409) when incident allocationStatus is NO_COMPATIBLE_RESOURCES', async () => {
    const origFindOne = DispatchRecord.findOne;
    const origIncFind = Incident.find;

    DispatchRecord.findOne = async () => ({
      batchId: 'BATCH-NO-COMPAT-005',
      batchStatus: 'SUCCESS',
      recommendationStatus: 'RECOMMENDED',
      confirmationStatus: 'PENDING',
      includedIncidentIds: [2005],
      incidentResults: [
        {
          incidentId: 2005,
          allocationStatus: 'NO_COMPATIBLE_RESOURCES',
          assignedResources: [{ resourceId: 101, resourceType: 'ALS_AMBULANCE' }]
        }
      ]
    });
    Incident.find = async () => [{ incidentId: 2005, status: 'VERIFIED' }];

    try {
      await assert.rejects(
        async () => {
          await confirmDispatch('BATCH-NO-COMPAT-005', {}, operatorUser);
        },
        (err) => {
          assert.ok(err instanceof DispatchConfirmationError);
          assert.equal(err.code, 'CANNOT_CONFIRM_FAILED_BATCH');
          assert.equal(err.statusCode, 409);
          assert.ok(err.message.includes('NO_COMPATIBLE_RESOURCES'));
          return true;
        }
      );
    } finally {
      DispatchRecord.findOne = origFindOne;
      Incident.find = origIncFind;
    }
  });

  it('should never update incident to DISPATCHED when assigned vehicles is empty', async () => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });

    let incidentUpdatedToDispatched = false;
    const origIncUpdateOne = Incident.updateOne;
    const origIncFind = Incident.find;
    const origRecFind = DispatchRecord.findOne;

    Incident.find = async () => [{ incidentId: 2006, status: 'VERIFIED' }];
    Incident.updateOne = async (filter, update) => {
      if (update?.$set?.status === 'DISPATCHED') {
        incidentUpdatedToDispatched = true;
      }
      return { matchedCount: 1, modifiedCount: 1 };
    };

    DispatchRecord.findOne = async () => ({
      batchId: 'BATCH-EMPTY-VEH-006',
      batchStatus: 'SUCCESS',
      recommendationStatus: 'RECOMMENDED',
      confirmationStatus: 'PENDING',
      includedIncidentIds: [2006],
      incidentResults: [
        {
          incidentId: 2006,
          allocationStatus: 'FULLY_ALLOCATED',
          assignedResources: []
        }
      ]
    });

    try {
      await assert.rejects(
        async () => {
          await confirmDispatch('BATCH-EMPTY-VEH-006', {}, operatorUser);
        },
        (err) => {
          assert.equal(err.code, 'CANNOT_DISPATCH_EMPTY_FLEET');
          return true;
        }
      );

      // Verify invariant: incident was never updated to DISPATCHED
      assert.equal(incidentUpdatedToDispatched, false, 'Incident must never be marked DISPATCHED with 0 vehicles');
    } finally {
      Incident.updateOne = origIncUpdateOne;
      Incident.find = origIncFind;
      DispatchRecord.findOne = origRecFind;
      __setConnectionStateOverride(null);
    }
  });

  it('should successfully confirm dispatch for valid batch with compatible resources', async () => {
    __setConnectionStateOverride({ connected: true, state: 'connected' });

    const mockSession = createMockSession();
    let incidentUpdated = false;
    let resourceUpdated = false;
    let hospitalUpdated = false;

    const origRecFind = DispatchRecord.findOne;
    const origIncFind = Incident.find;
    const origIncFindOneAndUpdate = Incident.findOneAndUpdate;
    const origResFindOneAndUpdate = Resource.findOneAndUpdate;
    const origHospFindOneAndUpdate = Hospital.findOneAndUpdate;

    DispatchRecord.findOne = async (q) => {
      if (q && q.idempotencyKey) return null;
      return {
        batchId: 'BATCH-VALID-007',
        batchStatus: 'SUCCESS',
        recommendationStatus: 'RECOMMENDED',
        confirmationStatus: 'PENDING',
        includedIncidentIds: [3001],
        totalIncidents: 1,
        incidentResults: [
          {
            incidentId: 3001,
            allocationStatus: 'FULLY_ALLOCATED',
            assignedResources: [{ resourceId: 101, resourceType: 'ALS_AMBULANCE' }],
            resourceShortages: [],
            recommendedHospital: {
              hospitalId: 701,
              hospitalName: 'AIIMS Jodhpur (Simulation)',
              allocatedIcuBeds: 0,
              allocatedGeneralBeds: 1
            }
          }
        ],
        confirmationAuditTrail: [],
        save: async function () { return this; }
      };
    };

    Incident.find = async () => [{
      incidentId: 3001,
      status: 'VERIFIED',
      location: { latitude: 26.29, longitude: 73.02 },
      category: 'MEDICAL',
      severity: 3
    }];

    Incident.findOneAndUpdate = async (query, update) => {
      if (update?.$set?.status === 'DISPATCHED') {
        incidentUpdated = true;
        assert.deepEqual(update.$set.assignedResourceIds, [101]);
      }
      return { incidentId: 3001, status: 'DISPATCHED' };
    };

    Resource.findOneAndUpdate = async (query, update) => {
      if (update?.$set?.status === 'DISPATCHED') {
        resourceUpdated = true;
      }
      return { resourceId: 101, status: 'DISPATCHED', resourceType: 'ALS_AMBULANCE' };
    };

    Hospital.findOneAndUpdate = async (query, update) => {
      if (update?.$inc) {
        hospitalUpdated = true;
      }
      return { hospitalId: 701, status: 'OPERATIONAL' };
    };

    try {
      const result = await confirmDispatch(
        'BATCH-VALID-007',
        { confirmationNotes: 'Valid dispatch verification', sessionOverride: mockSession },
        operatorUser
      );

      assert.ok(result);
      assert.equal(result.confirmationStatus, 'CONFIRMED');
      assert.equal(incidentUpdated, true, 'Incident should be transitioned to DISPATCHED');
      assert.equal(resourceUpdated, true, 'Resource should be transitioned to DISPATCHED');
      assert.equal(hospitalUpdated, true, 'Hospital capacity should be decremented');
      assert.equal(mockSession.hasCommitted, true, 'Mock session should be committed');
    } finally {
      DispatchRecord.findOne = origRecFind;
      Incident.find = origIncFind;
      Incident.findOneAndUpdate = origIncFindOneAndUpdate;
      Resource.findOneAndUpdate = origResFindOneAndUpdate;
      Hospital.findOneAndUpdate = origHospFindOneAndUpdate;
      __setConnectionStateOverride(null);
    }
  });
});
