import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

const { Schema } = mongoose;

export const BATCH_STATUSES = ['SUCCESS', 'PARTIAL', 'PARTIAL_SUCCESS', 'FAILED', 'RECOMMENDED'];
export const RECOMMENDATION_STATUSES = ['RECOMMENDED', 'FAILED'];
export const CONFIRMATION_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'PARTIALLY_RESOLVED', 'COMPLETED'];

const dispatchRecordSchema = new Schema(
  {
    batchId: {
      type: String,
      required: [true, 'Batch ID is required'],
      unique: true,
      trim: true
    },
    requestId: {
      type: String,
      trim: true,
      default: ''
    },
    evaluatedAt: {
      type: Date,
      default: Date.now
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    recommendationStatus: {
      type: String,
      enum: {
        values: RECOMMENDATION_STATUSES,
        message: '{VALUE} is not a valid recommendation status'
      },
      default: 'RECOMMENDED'
    },
    batchStatus: {
      type: String,
      enum: {
        values: BATCH_STATUSES,
        message: '{VALUE} is not a valid batch status'
      },
      default: 'SUCCESS'
    },
    batchStatusMessage: {
      type: String,
      trim: true,
      default: ''
    },
    totalIncidents: {
      type: Number,
      required: true,
      min: 0
    },
    fullyAllocatedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    partiallyAllocatedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    unallocatedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    includedIncidentIds: [
      {
        type: Number,
        required: true
      }
    ],
    priorityExecutionOrder: [
      {
        type: Number
      }
    ],
    incidentResults: [
      {
        incidentId: { type: Number, required: true },
        priorityScore: { type: Number },
        priorityTier: { type: String },
        triageRank: { type: Number },
        allocationStatus: { type: String },
        summaryNotes: { type: String, default: '' },
        assignedResources: [
          {
            resourceId: { type: Number },
            resourceType: { type: String },
            snappedNodeOsmId: { type: Number, default: 0 },
            estimatedArrivalSeconds: { type: Number },
            distanceMeters: { type: Number },
            routePolyline: { type: String, default: '' }
          }
        ],
        resourceShortages: [
          {
            resourceType: { type: String },
            requestedQuantity: { type: Number, default: 0 },
            allocatedQuantity: { type: Number, default: 0 },
            shortageQuantity: { type: Number, default: 0 }
          }
        ],
        recommendedHospital: {
          hospitalId: { type: Number, default: null },
          hospitalName: { type: String, default: '' },
          suitability: { type: String, default: '' },
          hospitalNodeOsmId: { type: Number, default: 0 },
          estimatedTransportSeconds: { type: Number, default: null },
          distanceMeters: { type: Number, default: null },
          routePolyline: { type: String, default: '' },
          allocatedIcuBeds: { type: Number, default: 0 },
          allocatedGeneralBeds: { type: Number, default: 0 },
          allocatedOxygenBeds: { type: Number, default: 0 }
        },
        hospitalShortages: {
          icuBedShortage: { type: Number, default: 0 },
          generalBedShortage: { type: Number, default: 0 },
          oxygenBedShortage: { type: Number, default: 0 }
        }
      }
    ],
    summary: {
      totalIncidentsReceived: { type: Number, default: 0 },
      validIncidents: { type: Number, default: 0 },
      invalidIncidents: { type: Number, default: 0 },
      fullyAllocatedIncidents: { type: Number, default: 0 },
      partiallyAllocatedIncidents: { type: Number, default: 0 },
      unallocatedIncidents: { type: Number, default: 0 },
      totalUniqueResourcesRecommended: { type: Number, default: 0 },
      totalHospitalRecommendations: { type: Number, default: 0 },
      resourceConflictsPrevented: { type: Number, default: 0 },
      hospitalCapacityConflictsPrevented: { type: Number, default: 0 },
      remainingAvailableResources: { type: Number, default: 0 },
      remainingAvailableIcuBeds: { type: Number, default: 0 },
      remainingAvailableGeneralBeds: { type: Number, default: 0 },
      remainingAvailableOxygenBeds: { type: Number, default: 0 }
    },
    engineMetadata: {
      totalExecutionTimeMs: { type: Number, default: 0 },
      priorityScoringTimeMs: { type: Number, default: 0 },
      resourceOrchestrationTimeMs: { type: Number, default: 0 },
      hospitalOrchestrationTimeMs: { type: Number, default: 0 },
      totalPipelineTimeMs: { type: Number, default: 0 }
    },
    engineTelemetry: {
      engineExecutionTimeUs: { type: Number, default: 0 },
      processWallClockMs: { type: Number, default: 0 },
      dijkstraCalls: { type: Number, default: 0 },
      multiTargetCalls: { type: Number, default: 0 },
      protocolVersion: { type: String, default: '1.0' }
    },
    // Phase 4.5 Dispatch Execution Metadata
    dispatchId: {
      type: String,
      trim: true,
      default: () => `DISPATCH-${Date.now()}-${randomUUID().slice(0, 8)}`
    },
    confirmationStatus: {
      type: String,
      enum: {
        values: CONFIRMATION_STATUSES,
        message: '{VALUE} is not a valid confirmation status'
      },
      default: 'PENDING'
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: undefined
    },
    confirmedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    confirmedAt: {
      type: Date,
      default: null
    },
    dispatchedAt: {
      type: Date,
      default: null
    },
    executionFailureReason: {
      type: String,
      trim: true,
      default: null
    },
    confirmationNotes: {
      type: String,
      trim: true,
      default: ''
    },
    resourceReservations: [
      {
        resourceId: { type: Number, required: true },
        resourceType: { type: String, required: true },
        status: { type: String, enum: ['RESERVED', 'DISPATCHED', 'ON_SCENE'], default: 'DISPATCHED' },
        assignedIncidentId: { type: Number, required: true },
        reservedAt: { type: Date, default: Date.now },
        dispatchedAt: { type: Date, default: null },
        arrivedAt: { type: Date, default: null },
        arrivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        verificationMethod: { type: String, enum: ['RADIO', 'PHONE', 'MANUAL', null], default: null },
        arrivalNotes: { type: String, default: '' },
        isReleased: { type: Boolean, default: false },
        releasedAt: { type: Date, default: null }
      }
    ],
    hospitalReservations: [
      {
        hospitalId: { type: Number, required: true },
        hospitalName: { type: String, default: '' },
        assignedIncidentId: { type: Number, required: true },
        reservedIcuBeds: { type: Number, default: 0 },
        reservedGeneralBeds: { type: Number, default: 0 },
        reservedOxygenBeds: { type: Number, default: 0 },
        reservedAt: { type: Date, default: Date.now },
        isReleased: { type: Boolean, default: false },
        releasedAt: { type: Date, default: null },
        releasedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
      }
    ],
    // Phase 4.6 Incident-Specific Operational Lifecycle Tracking
    incidentTracking: [
      {
        incidentId: { type: Number, required: true },
        status: { type: String, enum: ['DISPATCHED', 'ON_SCENE', 'RESOLVED'], default: 'DISPATCHED' },
        arrivedAt: { type: Date, default: null },
        resolvedAt: { type: Date, default: null },
        resolutionNotes: { type: String, trim: true, default: '' }
      }
    ],
    completedAt: {
      type: Date,
      default: null
    },
    associatedIncidentIds: [
      {
        type: Number
      }
    ],
    confirmationAuditTrail: [
      {
        action: { type: String, required: true },
        performedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        performedAt: { type: Date, default: Date.now },
        notes: { type: String, default: '' },
        failureReason: { type: String, default: null }
      }
    ]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

dispatchRecordSchema.index({ batchId: 1 }, { unique: true });
dispatchRecordSchema.index(
  { dispatchId: 1 },
  { unique: true, partialFilterExpression: { dispatchId: { $type: 'string' } } }
);
dispatchRecordSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
dispatchRecordSchema.index({ confirmationStatus: 1, confirmedAt: -1 });
dispatchRecordSchema.index({ evaluatedAt: -1 });
dispatchRecordSchema.index({ recommendationStatus: 1, evaluatedAt: -1 });
dispatchRecordSchema.index({ requestedBy: 1, evaluatedAt: -1 });
dispatchRecordSchema.index({ includedIncidentIds: 1 });
dispatchRecordSchema.index({ associatedIncidentIds: 1 });

export const DispatchRecord = mongoose.model('DispatchRecord', dispatchRecordSchema);
export default DispatchRecord;
