import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import Incident from '../models/Incident.js';
import Resource from '../models/Resource.js';
import Hospital from '../models/Hospital.js';
import DispatchRecord from '../models/DispatchRecord.js';
import { getConnectionStatus } from '../config/database.js';

/**
 * Custom error class for dispatch confirmation business rule violations.
 */
export class DispatchConfirmationError extends Error {
  constructor(message, code, details = null, statusCode = 400) {
    super(message);
    this.name = 'DispatchConfirmationError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

/**
 * Helper to execute an operational unit of work inside a managed Mongoose transaction.
 * Falls back with clear diagnostic error if deployment topology does not support transactions.
 *
 * @param {Function} workFn - Async function taking (session)
 * @param {object} [options] - Options (sessionOverride)
 * @returns {Promise<any>}
 */
export async function withTransaction(workFn, options = {}) {
  if (options.sessionOverride) {
    const session = options.sessionOverride;
    let txStarted = false;
    try {
      if (typeof session.startTransaction === 'function') {
        session.startTransaction();
        txStarted = true;
      }
      const result = await workFn(session);
      if (typeof session.commitTransaction === 'function') {
        await session.commitTransaction();
      }
      return result;
    } catch (workErr) {
      if (txStarted && typeof session.abortTransaction === 'function') {
        try {
          await session.abortTransaction();
        } catch (_) {}
      }
      throw workErr;
    }
  }

  const dbStatus = getConnectionStatus();
  if (!dbStatus.connected) {
    throw new DispatchConfirmationError(
      'Dispatch service is temporarily unavailable. Database is disconnected.',
      'DATABASE_UNAVAILABLE',
      null,
      503
    );
  }

  let session = null;
  try {
    session = await mongoose.startSession();
  } catch (sessErr) {
    throw new DispatchConfirmationError(
      `Unable to initialize database session: ${sessErr.message}`,
      'SESSION_INITIALIZATION_FAILED',
      { originalError: sessErr.message },
      503
    );
  }

  let transactionStarted = false;
  try {
    session.startTransaction();
    transactionStarted = true;
  } catch (txStartErr) {
    await session.endSession();
    throw new DispatchConfirmationError(
      `MongoDB transactions require a replica set or mongos cluster deployment: ${txStartErr.message}`,
      'TRANSACTION_UNAVAILABLE',
      { originalError: txStartErr.message },
      503
    );
  }

  try {
    const result = await workFn(session);
    await session.commitTransaction();
    return result;
  } catch (workErr) {
    if (transactionStarted) {
      try {
        await session.abortTransaction();
      } catch (_) {
        // Abort failed, let original error take precedence
      }
    }
    throw workErr;
  } finally {
    try {
      await session.endSession();
    } catch (_) {}
  }
}

/**
 * Main business workflow: Confirms a Phase 4.4 recommendation batch, atomically reserves resources
 * and hospital capacities, updates incident statuses to DISPATCHED, and records execution audit history.
 *
 * @param {string} batchId - Unique batch ID of the recommendation
 * @param {object} options - Confirmation parameters (idempotencyKey, allowPartialDispatch, confirmationNotes, sessionOverride)
 * @param {object} operatorUser - Authenticated operator/admin user
 * @returns {Promise<object>} Confirmed dispatch snapshot
 */
export async function confirmDispatch(batchId, options = {}, operatorUser) {
  if (!batchId || typeof batchId !== 'string') {
    throw new DispatchConfirmationError(
      'Batch ID must be a non-empty string',
      'INVALID_BATCH_ID',
      null,
      400
    );
  }

  const cleanBatchId = batchId.trim();
  const rawIdempotencyKey = options.idempotencyKey || null;
  const cleanIdempotencyKey = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : null;
  const allowPartialDispatch = Boolean(options.allowPartialDispatch);
  const confirmationNotes = typeof options.confirmationNotes === 'string' ? options.confirmationNotes.trim() : '';

  // 1. Idempotency Key Pre-check
  if (cleanIdempotencyKey) {
    const existingKeyRecord = await DispatchRecord.findOne({ idempotencyKey: cleanIdempotencyKey });
    if (existingKeyRecord) {
      if (existingKeyRecord.batchId === cleanBatchId && existingKeyRecord.confirmationStatus === 'CONFIRMED') {
        // Idempotent replay: return existing confirmed dispatch
        return formatDispatchResponse(existingKeyRecord, true);
      }
      throw new DispatchConfirmationError(
        `Idempotency key '${cleanIdempotencyKey}' has already been consumed for another operation.`,
        'IDEMPOTENCY_KEY_COLLISION',
        { existingBatchId: existingKeyRecord.batchId },
        409
      );
    }
  }

  // 2. Load Stored Recommendation Snapshot
  const recommendation = await DispatchRecord.findOne({ batchId: cleanBatchId });
  if (!recommendation) {
    throw new DispatchConfirmationError(
      `Recommendation batch '${cleanBatchId}' not found`,
      'BATCH_NOT_FOUND',
      { batchId: cleanBatchId },
      404
    );
  }

  // 3. Check Stale or Duplicate Confirmation
  if (recommendation.confirmationStatus === 'CONFIRMED') {
    if (cleanIdempotencyKey && recommendation.idempotencyKey === cleanIdempotencyKey) {
      return formatDispatchResponse(recommendation, true);
    }
    throw new DispatchConfirmationError(
      `Recommendation batch '${cleanBatchId}' has already been confirmed and dispatched.`,
      'BATCH_ALREADY_CONFIRMED',
      {
        batchId: cleanBatchId,
        dispatchId: recommendation.dispatchId,
        confirmedAt: recommendation.confirmedAt
      },
      409
    );
  }

  if (recommendation.batchStatus === 'FAILED' || recommendation.recommendationStatus === 'FAILED') {
    throw new DispatchConfirmationError(
      `Cannot confirm recommendation batch '${cleanBatchId}' because algorithmic evaluation failed.`,
      'CANNOT_CONFIRM_FAILED_BATCH',
      { failureReason: recommendation.batchStatusMessage || 'Batch optimization failed' },
      409
    );
  }

  // 4. Validate Incidents State & Eligibility
  const includedIncidentIds = recommendation.includedIncidentIds || [];
  if (includedIncidentIds.length === 0) {
    throw new DispatchConfirmationError(
      'Recommendation batch contains no associated incident IDs',
      'EMPTY_BATCH_INCIDENTS',
      null,
      400
    );
  }

  const existingIncidents = await Incident.find({ incidentId: { $in: includedIncidentIds } });
  const incidentMap = new Map();
  for (const inc of existingIncidents) {
    incidentMap.set(inc.incidentId, inc);
  }

  const missingIncidents = includedIncidentIds.filter((id) => !incidentMap.has(id));
  if (missingIncidents.length > 0) {
    throw new DispatchConfirmationError(
      `Associated incident(s) no longer exist in database: ${missingIncidents.join(', ')}`,
      'INCIDENT_NOT_FOUND',
      { missingIncidents },
      404
    );
  }

  const ineligibleIncidents = [];
  for (const id of includedIncidentIds) {
    const inc = incidentMap.get(id);
    if (inc.status !== 'VERIFIED') {
      ineligibleIncidents.push({ incidentId: id, currentStatus: inc.status, requiredStatus: 'VERIFIED' });
    }
  }

  if (ineligibleIncidents.length > 0) {
    const first = ineligibleIncidents[0];
    throw new DispatchConfirmationError(
      `Incident ${first.incidentId} cannot be dispatched because its status is '${first.currentStatus}'. Only VERIFIED incidents can be dispatched.`,
      'INCIDENT_STATE_CONFLICT',
      { ineligibleIncidents },
      409
    );
  }

  // 5. Evaluate Allocation Status, Empty Fleet Guards & Partial Allocation Policy
  const incidentResults = recommendation.incidentResults || [];
  const incidentsWithShortages = [];
  let totalAssignedVehicles = 0;

  for (const ir of incidentResults) {
    const assignedVehicles = ir.assignedResources || [];
    totalAssignedVehicles += assignedVehicles.length;

    // Invariant: Allocation status must be either FULLY_ALLOCATED or PARTIALLY_ALLOCATED (or mock aliases SUCCESS/PARTIAL)
    const validAllocationStatuses = ['FULLY_ALLOCATED', 'PARTIALLY_ALLOCATED', 'SUCCESS', 'PARTIAL'];
    if (ir.allocationStatus && !validAllocationStatuses.includes(ir.allocationStatus)) {
      throw new DispatchConfirmationError(
        `Incident ${ir.incidentId} cannot be confirmed for dispatch because its allocation status is '${ir.allocationStatus}'. Only FULLY_ALLOCATED or PARTIALLY_ALLOCATED incidents can be dispatched.`,
        'CANNOT_CONFIRM_FAILED_BATCH',
        { incidentId: ir.incidentId, allocationStatus: ir.allocationStatus },
        409
      );
    }

    // Invariant: Individual incident cannot be dispatched with zero assigned vehicles
    if (assignedVehicles.length === 0) {
      throw new DispatchConfirmationError(
        `Incident ${ir.incidentId} has zero assigned vehicles and cannot be dispatched.`,
        'CANNOT_DISPATCH_EMPTY_FLEET',
        { incidentId: ir.incidentId },
        409
      );
    }

    const shortages = ir.resourceShortages || [];
    const hasUnmetDemands = shortages.some((s) => (s.shortageQuantity || 0) > 0);
    const isPartiallyAllocated = ir.allocationStatus === 'PARTIALLY_ALLOCATED';

    if (hasUnmetDemands || isPartiallyAllocated) {
      incidentsWithShortages.push({
        incidentId: ir.incidentId,
        allocationStatus: ir.allocationStatus,
        shortages
      });
    }
  }

  // Invariant: Reject dispatch if zero vehicles were allocated across the entire recommendation batch
  if (totalAssignedVehicles === 0) {
    throw new DispatchConfirmationError(
      `Cannot confirm recommendation batch '${cleanBatchId}' because zero vehicles were allocated across the batch.`,
      'CANNOT_DISPATCH_EMPTY_FLEET',
      { batchId: cleanBatchId, totalAssignedVehicles: 0 },
      409
    );
  }

  if (incidentsWithShortages.length > 0 && !allowPartialDispatch) {
    throw new DispatchConfirmationError(
      `Batch contains ${incidentsWithShortages.length} incident(s) with unmet resource demands. Confirm with allowPartialDispatch: true to dispatch available units.`,
      'INCOMPLETE_ALLOCATION_SHORTAGE',
      { incidentsWithShortages },
      409
    );
  }

  // 6. Gather Resources and Hospital Capacity Demands
  const resourceAssignments = []; // { resourceId, resourceType, targetIncidentId }
  const hospitalDemands = new Map(); // hospitalId -> { icuBeds, generalBeds, oxygenBeds, targetIncidentIds: [] }

  for (const ir of incidentResults) {
    for (const sr of ir.assignedResources || []) {
      resourceAssignments.push({
        resourceId: sr.resourceId,
        resourceType: sr.resourceType,
        targetIncidentId: ir.incidentId
      });
    }

    const recHosp = ir.recommendedHospital;
    if (recHosp && recHosp.hospitalId) {
      const hId = recHosp.hospitalId;
      if (!hospitalDemands.has(hId)) {
        hospitalDemands.set(hId, {
          hospitalId: hId,
          hospitalName: recHosp.hospitalName || '',
          icuBeds: 0,
          generalBeds: 0,
          oxygenBeds: 0,
          targetIncidentIds: []
        });
      }
      const hEntry = hospitalDemands.get(hId);
      hEntry.icuBeds += recHosp.allocatedIcuBeds || 0;
      hEntry.generalBeds += recHosp.allocatedGeneralBeds || 0;
      hEntry.oxygenBeds += recHosp.allocatedOxygenBeds || 0;
      hEntry.targetIncidentIds.push(ir.incidentId);
    }
  }

  const dispatchId = recommendation.dispatchId || `DISPATCH-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const now = new Date();

  // 7. Execute Atomic Transactions with Full Rollback
  return withTransaction(async (session) => {
    // A. Reserve and Dispatch Each Fleet Vehicle: AVAILABLE -> RESERVED -> DISPATCHED
    const committedResourceReservations = [];

    for (const alloc of resourceAssignments) {
      // Step A1: Transition from AVAILABLE to RESERVED (enforcing availability invariant)
      const reservedRes = await Resource.findOneAndUpdate(
        {
          resourceId: alloc.resourceId,
          status: 'AVAILABLE'
        },
        {
          $set: {
            status: 'RESERVED',
            assignedIncidentId: alloc.targetIncidentId,
            assignedBatchId: cleanBatchId,
            assignedDispatchId: dispatchId,
            reservedAt: now
          }
        },
        { session, new: true }
      );

      if (!reservedRes) {
        // Find current state to generate clear error
        const currentRes = await Resource.findOne({ resourceId: alloc.resourceId }).session(session);
        if (!currentRes) {
          throw new DispatchConfirmationError(
            `Resource ID ${alloc.resourceId} was not found in database`,
            'RESOURCE_NOT_FOUND',
            { resourceId: alloc.resourceId },
            404
          );
        }

        throw new DispatchConfirmationError(
          `Resource ID ${alloc.resourceId} (${currentRes.resourceType}) is no longer available (current status: '${currentRes.status}'). Dispatch aborted.`,
          'RESOURCE_ALREADY_COMMITTED',
          {
            resourceId: alloc.resourceId,
            currentStatus: currentRes.status,
            assignedIncidentId: currentRes.assignedIncidentId
          },
          409
        );
      }

      // Step A2: Transition from RESERVED to DISPATCHED within the same active transaction
      const dispatchedRes = await Resource.findOneAndUpdate(
        {
          resourceId: alloc.resourceId,
          status: 'RESERVED'
        },
        {
          $set: {
            status: 'DISPATCHED',
            dispatchedAt: now
          }
        },
        { session, new: true }
      );

      committedResourceReservations.push({
        resourceId: (dispatchedRes || reservedRes).resourceId,
        resourceType: (dispatchedRes || reservedRes).resourceType,
        status: 'DISPATCHED',
        assignedIncidentId: alloc.targetIncidentId,
        reservedAt: now,
        dispatchedAt: now
      });
    }

    // B. Reserve Hospital Capacities (Conditional Update enforcing OPERATIONAL and non-negative capacity)
    const committedHospitalReservations = [];

    for (const [hId, demand] of hospitalDemands.entries()) {
      const query = {
        hospitalId: hId,
        status: 'OPERATIONAL'
      };

      const update = {};
      const incFields = {};

      if (demand.icuBeds > 0) {
        query['icuBeds.available'] = { $gte: demand.icuBeds };
        incFields['icuBeds.available'] = -demand.icuBeds;
      }
      if (demand.generalBeds > 0) {
        query['generalBeds.available'] = { $gte: demand.generalBeds };
        incFields['generalBeds.available'] = -demand.generalBeds;
      }
      if (demand.oxygenBeds > 0) {
        query['oxygenBeds.available'] = { $gte: demand.oxygenBeds };
        incFields['oxygenBeds.available'] = -demand.oxygenBeds;
      }

      let updatedHosp = null;

      if (Object.keys(incFields).length > 0) {
        update.$inc = incFields;
        updatedHosp = await Hospital.findOneAndUpdate(query, update, { session, new: true });
      } else {
        // Just verify hospital is OPERATIONAL if 0 beds consumed
        updatedHosp = await Hospital.findOne(query).session(session);
      }

      if (!updatedHosp) {
        const currentHosp = await Hospital.findOne({ hospitalId: hId }).session(session);
        if (!currentHosp) {
          throw new DispatchConfirmationError(
            `Hospital ID ${hId} was not found in database`,
            'HOSPITAL_NOT_FOUND',
            { hospitalId: hId },
            404
          );
        }

        if (currentHosp.status !== 'OPERATIONAL') {
          throw new DispatchConfirmationError(
            `Hospital '${currentHosp.name}' is currently '${currentHosp.status}'. Only OPERATIONAL hospitals can receive emergency patients.`,
            'HOSPITAL_UNAVAILABLE',
            { hospitalId: hId, currentStatus: currentHosp.status },
            409
          );
        }

        throw new DispatchConfirmationError(
          `Hospital '${currentHosp.name}' does not have sufficient available bed capacity for dispatch reservation.`,
          'HOSPITAL_CAPACITY_INSUFFICIENT',
          {
            hospitalId: hId,
            demands: { icu: demand.icuBeds, general: demand.generalBeds, oxygen: demand.oxygenBeds },
            currentAvailable: {
              icu: currentHosp.icuBeds?.available || 0,
              general: currentHosp.generalBeds?.available || 0,
              oxygen: currentHosp.oxygenBeds?.available || 0
            }
          },
          409
        );
      }

      for (const incId of demand.targetIncidentIds) {
        committedHospitalReservations.push({
          hospitalId: hId,
          hospitalName: updatedHosp.name,
          assignedIncidentId: incId,
          reservedIcuBeds: demand.icuBeds,
          reservedGeneralBeds: demand.generalBeds,
          reservedOxygenBeds: demand.oxygenBeds,
          reservedAt: now
        });
      }
    }

    // C. Transition Incident States: VERIFIED -> ALLOCATED -> DISPATCHED
    for (const incId of includedIncidentIds) {
      const assignedVehicles = resourceAssignments
        .filter((ra) => ra.targetIncidentId === incId)
        .map((ra) => ra.resourceId);

      // Invariant: Never update an incident to DISPATCHED without valid assigned resources
      if (assignedVehicles.length === 0) {
        throw new DispatchConfirmationError(
          `Incident ${incId} has no assigned vehicles and cannot be transitioned to DISPATCHED.`,
          'CANNOT_DISPATCH_EMPTY_FLEET',
          { incidentId: incId },
          409
        );
      }

      const assignedHosp = committedHospitalReservations.find((hr) => hr.assignedIncidentId === incId);

      const initialArrivals = assignedVehicles.map((vId) => {
        const rRecord = committedResourceReservations.find((cr) => cr.resourceId === vId);
        return {
          resourceId: vId,
          resourceType: rRecord ? rRecord.resourceType : 'UNKNOWN',
          incidentId: incId,
          status: 'DISPATCHED',
          dispatchedAt: now,
          arrivedAt: null,
          arrivedBy: null,
          verificationMethod: null,
          notes: ''
        };
      });

      const updatedInc = await Incident.findOneAndUpdate(
        {
          incidentId: incId,
          status: 'VERIFIED'
        },
        {
          $set: {
            status: 'DISPATCHED',
            dispatchedAt: now,
            dispatchedBy: operatorUser ? operatorUser._id : null,
            dispatchedBatchId: cleanBatchId,
            dispatchId,
            assignedResourceIds: assignedVehicles,
            assignedResourceArrivals: initialArrivals,
            assignedHospitalId: assignedHosp ? assignedHosp.hospitalId : null
          },
          $push: {
            auditHistory: {
              $each: [
                {
                  action: 'ALLOCATED',
                  performedBy: operatorUser ? operatorUser._id : null,
                  performedAt: now,
                  previousStatus: 'VERIFIED',
                  newStatus: 'ALLOCATED',
                  notes: `Allocated via recommendation batch ${cleanBatchId}`
                },
                {
                  action: 'DISPATCHED',
                  performedBy: operatorUser ? operatorUser._id : null,
                  performedAt: now,
                  previousStatus: 'ALLOCATED',
                  newStatus: 'DISPATCHED',
                  notes: confirmationNotes || 'Operator confirmed simulated dispatch execution'
                }
              ]
            }
          }
        },
        { session, new: true }
      );

      if (!updatedInc) {
        throw new DispatchConfirmationError(
          `Incident ${incId} could not be updated to DISPATCHED. State conflict detected during transaction.`,
          'INCIDENT_STATE_CONFLICT',
          { incidentId: incId },
          409
        );
      }
    }

    // D. Update DispatchRecord to CONFIRMED
    recommendation.dispatchId = dispatchId;
    recommendation.confirmationStatus = 'CONFIRMED';
    recommendation.idempotencyKey = cleanIdempotencyKey;
    recommendation.confirmedBy = operatorUser ? operatorUser._id : null;
    recommendation.confirmedAt = now;
    recommendation.dispatchedAt = now;
    recommendation.confirmationNotes = confirmationNotes;
    recommendation.resourceReservations = committedResourceReservations;
    recommendation.hospitalReservations = committedHospitalReservations;
    recommendation.associatedIncidentIds = includedIncidentIds;
    recommendation.incidentTracking = includedIncidentIds.map((incId) => ({
      incidentId: incId,
      status: 'DISPATCHED',
      arrivedAt: null,
      resolvedAt: null,
      resolutionNotes: ''
    }));
    recommendation.confirmationAuditTrail.push({
      action: 'DISPATCH_CONFIRMED',
      performedBy: operatorUser ? operatorUser._id : null,
      performedAt: now,
      notes: confirmationNotes || 'Operator confirmed simulated dispatch execution'
    });

    await recommendation.save({ session });

    return formatDispatchResponse(recommendation, false);
  }, options);
}

/**
 * Retrieves a confirmed dispatch record by dispatchId or batchId.
 *
 * @param {string} identifier - dispatchId (e.g. DISPATCH-...) or batchId (e.g. BATCH-...)
 * @returns {Promise<object|null>}
 */
export async function getDispatchById(identifier) {
  const dbStatus = getConnectionStatus();
  if (!dbStatus.connected) {
    throw new DispatchConfirmationError(
      'Dispatch service is temporarily unavailable. Database is disconnected.',
      'DATABASE_UNAVAILABLE',
      null,
      503
    );
  }

  if (!identifier || typeof identifier !== 'string') {
    throw new DispatchConfirmationError(
      'Invalid dispatch identifier',
      'INVALID_IDENTIFIER',
      null,
      400
    );
  }

  const cleanId = identifier.trim();

  const record = await DispatchRecord.findOne({
    $or: [{ dispatchId: cleanId }, { batchId: cleanId }]
  })
    .populate('confirmedBy', 'name email role')
    .populate('requestedBy', 'name email role')
    .lean();

  if (!record) {
    return null;
  }

  return formatDispatchResponse(record, false);
}

/**
 * Lists confirmed dispatch operations with pagination, sorting, and filters.
 *
 * @param {object} query - Express query params
 * @returns {Promise<{ dispatches: object[], pagination: object }>}
 */
export async function listDispatches(query = {}) {
  const dbStatus = getConnectionStatus();
  if (!dbStatus.connected) {
    throw new DispatchConfirmationError(
      'Dispatch service is temporarily unavailable. Database is disconnected.',
      'DATABASE_UNAVAILABLE',
      null,
      503
    );
  }

  const filter = {};

  if (query.status) {
    filter.confirmationStatus = query.status.toUpperCase();
  } else {
    // Default to CONFIRMED dispatches when listing dispatches
    filter.confirmationStatus = 'CONFIRMED';
  }

  if (query.incidentId !== undefined && query.incidentId !== '') {
    const incId = Number(query.incidentId);
    if (!Number.isInteger(incId) || incId <= 0) {
      throw new DispatchConfirmationError(
        'Invalid incidentId filter. Must be a positive integer.',
        'INVALID_INCIDENT_ID_FILTER',
        null,
        400
      );
    }
    filter.associatedIncidentIds = incId;
  }

  const startDateRaw = query.startDate || query.from;
  const endDateRaw = query.endDate || query.to;

  if (startDateRaw || endDateRaw) {
    filter.confirmedAt = {};
    if (startDateRaw) {
      const s = new Date(startDateRaw);
      if (isNaN(s.getTime())) {
        throw new DispatchConfirmationError(
          `Invalid startDate format: ${startDateRaw}. Expected valid ISO date.`,
          'INVALID_DATE_FILTER',
          null,
          400
        );
      }
      filter.confirmedAt.$gte = s;
    }
    if (endDateRaw) {
      const e = new Date(endDateRaw);
      if (isNaN(e.getTime())) {
        throw new DispatchConfirmationError(
          `Invalid endDate format: ${endDateRaw}. Expected valid ISO date.`,
          'INVALID_DATE_FILTER',
          null,
          400
        );
      }
      filter.confirmedAt.$lte = e;
    }
  }

  const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10) || 20));
  const skip = (page - 1) * limit;

  const allowedSortFields = ['confirmedAt', 'evaluatedAt', 'createdAt'];
  const sortBy = allowedSortFields.includes(query.sortBy) ? query.sortBy : 'confirmedAt';
  const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

  const [totalCount, records] = await Promise.all([
    DispatchRecord.countDocuments(filter),
    DispatchRecord.find(filter)
      .populate('confirmedBy', 'name email role')
      .populate('requestedBy', 'name email role')
      .sort({ [sortBy]: sortOrder, _id: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean()
  ]);

  return {
    dispatches: records.map((r) => formatDispatchResponse(r, false)),
    pagination: {
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit) || 1,
      hasNextPage: page * limit < totalCount,
      hasPrevPage: page > 1
    }
  };
}

/**
 * Sanitizes and formats a DispatchRecord for API responses.
 *
 * @param {object} record - Mongoose document or lean object
 * @param {boolean} isIdempotentReplay - Whether this response is an idempotent replay
 * @returns {object}
 */
function formatDispatchResponse(record, isIdempotentReplay = false) {
  return {
    dispatchId: record.dispatchId || null,
    batchId: record.batchId,
    confirmationStatus: record.confirmationStatus,
    isIdempotentReplay,
    confirmedAt: record.confirmedAt || null,
    dispatchedAt: record.dispatchedAt || null,
    confirmedBy: record.confirmedBy
      ? typeof record.confirmedBy === 'object' && record.confirmedBy.name
        ? {
            id: record.confirmedBy._id ? record.confirmedBy._id.toString() : record.confirmedBy.id,
            name: record.confirmedBy.name,
            email: record.confirmedBy.email,
            role: record.confirmedBy.role
          }
        : record.confirmedBy.toString()
      : null,
    confirmationNotes: record.confirmationNotes || '',
    associatedIncidentIds: record.associatedIncidentIds || record.includedIncidentIds || [],
    resourceReservations: record.resourceReservations || [],
    hospitalReservations: record.hospitalReservations || [],
    recommendationSummary: {
      totalIncidents: record.totalIncidents,
      fullyAllocatedCount: record.fullyAllocatedCount,
      partiallyAllocatedCount: record.partiallyAllocatedCount,
      unallocatedCount: record.unallocatedCount
    },
    auditTrail: record.confirmationAuditTrail || []
  };
}

export default {
  confirmDispatch,
  getDispatchById,
  listDispatches,
  withTransaction,
  DispatchConfirmationError
};

