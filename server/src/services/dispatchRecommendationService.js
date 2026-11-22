import { randomUUID } from 'crypto';
import Incident from '../models/Incident.js';
import Resource from '../models/Resource.js';
import Hospital from '../models/Hospital.js';
import DispatchRecord from '../models/DispatchRecord.js';
import cppEngineService from './cppEngineService.js';
import { getConnectionStatus } from '../config/database.js';
import env from '../config/env.js';

/**
 * Custom error for recommendation validation and eligibility violations.
 */
export class RecommendationValidationError extends Error {
  constructor(message, code, details = null, statusCode = 400) {
    super(message);
    this.name = 'RecommendationValidationError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

/**
 * Custom error for invalid or corrupt C++ engine responses.
 */
export class EngineResponseValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'EngineResponseValidationError';
    this.code = 'UPSTREAM_ENGINE_INVALID_RESPONSE';
    this.details = details;
    this.statusCode = 502;
  }
}

/**
 * Validates the recommendation request body.
 *
 * @param {object} body - Express request body
 * @returns {{ incidentIds: number[]|null, selectAllVerified: boolean }}
 */
export function validateRecommendationRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new RecommendationValidationError(
      'Request body must be a JSON object',
      'INVALID_REQUEST_BODY'
    );
  }

  // Reject unauthorized client injection of authoritative inventory or assignments
  if (body.resources !== undefined || body.hospitals !== undefined) {
    throw new RecommendationValidationError(
      'Client cannot supply resource or hospital inventories. These are loaded authoritatively from the database.',
      'UNAUTHORIZED_INVENTORY_INJECTION'
    );
  }

  if (body.priorityScores !== undefined || body.assignments !== undefined) {
    throw new RecommendationValidationError(
      'Client cannot supply priority scores or dispatch assignments. These are computed authoritatively by the C++ engine.',
      'UNAUTHORIZED_ASSIGNMENT_INJECTION'
    );
  }

  const selectAllVerified = Boolean(body.selectAllVerified || body.allVerified);
  let incidentIds = null;

  if (body.incidentIds !== undefined) {
    if (!Array.isArray(body.incidentIds)) {
      throw new RecommendationValidationError(
        'incidentIds must be an array of positive integers',
        'INVALID_INCIDENT_IDS'
      );
    }

    if (body.incidentIds.length === 0) {
      throw new RecommendationValidationError(
        'incidentIds array must not be empty',
        'EMPTY_INCIDENT_BATCH'
      );
    }

    if (body.incidentIds.length > env.CPP_MAX_BATCH_SIZE) {
      throw new RecommendationValidationError(
        `Batch size exceeds maximum allowed limit of ${env.CPP_MAX_BATCH_SIZE} incidents`,
        'BATCH_SIZE_EXCEEDED',
        { requestedSize: body.incidentIds.length, maxBatchSize: env.CPP_MAX_BATCH_SIZE }
      );
    }

    const seen = new Set();
    const sanitizedIds = [];

    for (let i = 0; i < body.incidentIds.length; i++) {
      const raw = body.incidentIds[i];
      const num = Number(raw);
      if (!Number.isInteger(num) || num <= 0) {
        throw new RecommendationValidationError(
          `Invalid incident ID at index ${i}: '${raw}'. Must be a positive integer.`,
          'INVALID_INCIDENT_ID',
          { index: i, value: raw }
        );
      }
      if (seen.has(num)) {
        throw new RecommendationValidationError(
          `Duplicate incident ID detected in batch: ${num}`,
          'DUPLICATE_INCIDENT_IDS',
          { duplicateId: num }
        );
      }
      seen.add(num);
      sanitizedIds.push(num);
    }

    incidentIds = sanitizedIds;
  } else if (!selectAllVerified) {
    throw new RecommendationValidationError(
      "Either 'incidentIds' array or 'selectAllVerified: true' must be specified",
      'MISSING_INCIDENT_SELECTION'
    );
  }

  return { incidentIds, selectAllVerified };
}

/**
 * Loads and validates eligible VERIFIED incidents from MongoDB.
 *
 * @param {number[]|null} incidentIds
 * @param {boolean} selectAllVerified
 * @returns {Promise<Incident[]>}
 */
export async function loadVerifiedIncidents(incidentIds, selectAllVerified) {
  if (incidentIds && incidentIds.length > 0) {
    const incidents = await Incident.find({ incidentId: { $in: incidentIds } });

    // 1. Verify existence of all requested IDs
    const foundMap = new Map();
    for (const inc of incidents) {
      foundMap.set(inc.incidentId, inc);
    }

    const missingIds = incidentIds.filter((id) => !foundMap.has(id));
    if (missingIds.length > 0) {
      throw new RecommendationValidationError(
        `Requested incident(s) not found: ${missingIds.join(', ')}`,
        'INCIDENT_NOT_FOUND',
        { missingIds },
        404
      );
    }

    // 2. Verify every incident has status 'VERIFIED'
    const ineligible = [];
    for (const id of incidentIds) {
      const inc = foundMap.get(id);
      if (inc.status !== 'VERIFIED') {
        ineligible.push({ incidentId: id, currentStatus: inc.status, requiredStatus: 'VERIFIED' });
      }
    }

    if (ineligible.length > 0) {
      const first = ineligible[0];
      throw new RecommendationValidationError(
        `Incident ${first.incidentId} is not eligible for dispatch recommendations (current status: '${first.currentStatus}', required: 'VERIFIED').`,
        'INELIGIBLE_INCIDENT',
        { ineligible },
        409
      );
    }

    // Preserve the exact input ordering
    return incidentIds.map((id) => foundMap.get(id));
  }

  if (selectAllVerified) {
    const incidents = await Incident.find({ status: 'VERIFIED' })
      .sort({ createdAt: 1 })
      .limit(env.CPP_MAX_BATCH_SIZE);

    if (incidents.length === 0) {
      throw new RecommendationValidationError(
        'No VERIFIED incidents are currently awaiting dispatch recommendations',
        'NO_VERIFIED_INCIDENTS',
        null,
        400
      );
    }

    return incidents;
  }

  throw new RecommendationValidationError(
    'No valid incident selection criteria provided',
    'INVALID_INCIDENT_SELECTION'
  );
}

/**
 * Loads available resources from MongoDB and serializes them for the C++ protocol.
 *
 * @returns {Promise<object[]>}
 */
export async function loadAvailableResources() {
  const resources = await Resource.find({ status: 'AVAILABLE' });

  const validProtocols = [];
  for (const r of resources) {
    if (
      r.latitude !== undefined &&
      r.longitude !== undefined &&
      Number.isFinite(r.latitude) &&
      Number.isFinite(r.longitude)
    ) {
      validProtocols.push(
        typeof r.toEngineProtocol === 'function'
          ? r.toEngineProtocol()
          : {
              resource_id: r.resourceId,
              resource_type: r.resourceType,
              status: 'AVAILABLE',
              capacity: r.capacity || 1,
              latitude: r.latitude,
              longitude: r.longitude,
              current_node_osm_id: r.currentNodeOsmId || 0
            }
      );
    }
  }

  return validProtocols;
}

/**
 * Loads operational hospitals from MongoDB and serializes them for the C++ protocol.
 *
 * @returns {Promise<object[]>}
 */
export async function loadOperationalHospitals() {
  const hospitals = await Hospital.find({ status: 'OPERATIONAL' });

  const validProtocols = [];
  for (const h of hospitals) {
    if (
      h.latitude !== undefined &&
      h.longitude !== undefined &&
      Number.isFinite(h.latitude) &&
      Number.isFinite(h.longitude)
    ) {
      validProtocols.push(
        typeof h.toEngineProtocol === 'function'
          ? h.toEngineProtocol()
          : {
              hospital_id: h.hospitalId,
              hospital_name: h.name,
              status: 'OPERATIONAL',
              capabilities: h.capabilities || [],
              icu_beds_total: h.icuBeds?.total || 0,
              icu_beds_available: h.icuBeds?.available || 0,
              available_icu_beds: h.icuBeds?.available || 0,
              general_beds_total: h.generalBeds?.total || 0,
              general_beds_available: h.generalBeds?.available || 0,
              available_general_beds: h.generalBeds?.available || 0,
              oxygen_beds_total: h.oxygenBeds?.total || 0,
              oxygen_beds_available: h.oxygenBeds?.available || 0,
              available_oxygen_beds: h.oxygenBeds?.available || 0,
              oxygen_supported_beds_available: h.oxygenBeds?.available || 0,
              latitude: h.latitude,
              longitude: h.longitude,
              node_osm_id: h.nodeOsmId || 0
            }
      );
    }
  }

  return validProtocols;
}

/**
 * Validates the C++ engine response for protocol compliance, structural integrity, and mutual exclusivity.
 *
 * @param {object} response - The parsed JSON response from the C++ engine
 * @param {string} expectedRequestId - The correlation request ID sent
 * @param {number[]} requestedIncidentIds - Array of incident IDs sent
 * @param {object[]} inputResources - The snapshot of available resources sent
 * @param {object[]} inputHospitals - The snapshot of operational hospitals sent
 */
export function validateEngineResponse(
  response,
  expectedRequestId,
  requestedIncidentIds,
  inputResources,
  inputHospitals
) {
  if (!response || typeof response !== 'object') {
    throw new EngineResponseValidationError('C++ engine returned empty or non-object response');
  }

  if (response.protocol_version !== '1.0') {
    throw new EngineResponseValidationError(
      `C++ engine returned unsupported protocol version: '${response.protocol_version}'. Expected '1.0'.`,
      { version: response.protocol_version }
    );
  }

  if (response.request_id !== expectedRequestId) {
    throw new EngineResponseValidationError(
      `C++ engine response request_id mismatch: received '${response.request_id}', expected '${expectedRequestId}'.`,
      { received: response.request_id, expected: expectedRequestId }
    );
  }

  if (response.operation !== 'dispatch_batch') {
    throw new EngineResponseValidationError(
      `C++ engine returned unexpected operation: '${response.operation}'. Expected 'dispatch_batch'.`
    );
  }

  if (!response.data || typeof response.data !== 'object') {
    throw new EngineResponseValidationError('C++ engine response missing valid data payload');
  }

  const { incident_results } = response.data;
  if (!Array.isArray(incident_results)) {
    throw new EngineResponseValidationError(
      'C++ engine response missing incident_results array'
    );
  }

  // Check completeness: every requested incident must have an identifiable result
  const resultMap = new Map();
  for (const ir of incident_results) {
    if (!ir || typeof ir !== 'object' || ir.incident_id === undefined) {
      throw new EngineResponseValidationError('Malformed incident result in engine response');
    }
    if (resultMap.has(ir.incident_id)) {
      throw new EngineResponseValidationError(
        `Duplicate incident result emitted by engine: incident ID ${ir.incident_id}`,
        { incidentId: ir.incident_id }
      );
    }
    resultMap.set(ir.incident_id, ir);
  }

  for (const id of requestedIncidentIds) {
    if (!resultMap.has(id)) {
      throw new EngineResponseValidationError(
        `C++ engine response missing result for requested incident ID: ${id}`,
        { missingIncidentId: id }
      );
    }
  }

  // Validate resource and hospital references, finite numbers, and no duplicate vehicle assignments
  const inputResourceIds = new Set(inputResources.map((r) => r.resource_id));
  const inputHospitalIds = new Set(inputHospitals.map((h) => h.hospital_id));
  const assignedVehicleIds = new Set();

  for (const ir of incident_results) {
    // Validate priority score and tier
    if (!ir.priority || typeof ir.priority !== 'object') {
      throw new EngineResponseValidationError(
        `Incident ${ir.incident_id} missing priority structure in engine response`
      );
    }

    const pScore = ir.priority.total_priority_score;
    if (pScore !== null && pScore !== undefined && (!Number.isFinite(pScore) || pScore < 0)) {
      throw new EngineResponseValidationError(
        `Incident ${ir.incident_id} has invalid non-finite priority score: ${pScore}`
      );
    }

    // Validate resource allocation
    if (ir.resource_allocation && Array.isArray(ir.resource_allocation.selected_resources)) {
      for (const res of ir.resource_allocation.selected_resources) {
        if (!inputResourceIds.has(res.resource_id)) {
          throw new EngineResponseValidationError(
            `Engine recommended unknown resource ID ${res.resource_id} not provided in input snapshot`,
            { resourceId: res.resource_id }
          );
        }

        // Mutual exclusivity invariant: each vehicle can only be recommended once per batch
        if (assignedVehicleIds.has(res.resource_id)) {
          throw new EngineResponseValidationError(
            `Vehicle conflict detected: resource ID ${res.resource_id} was assigned to multiple incidents in batch`,
            { resourceId: res.resource_id }
          );
        }
        assignedVehicleIds.add(res.resource_id);

        if (
          res.road_distance_meters !== null &&
          res.road_distance_meters !== undefined &&
          (!Number.isFinite(res.road_distance_meters) || res.road_distance_meters < 0)
        ) {
          throw new EngineResponseValidationError(
            `Invalid negative or non-finite distance for resource ${res.resource_id}: ${res.road_distance_meters}`
          );
        }

        if (
          res.estimated_eta_seconds !== null &&
          res.estimated_eta_seconds !== undefined &&
          (!Number.isFinite(res.estimated_eta_seconds) || res.estimated_eta_seconds < 0)
        ) {
          throw new EngineResponseValidationError(
            `Invalid negative or non-finite ETA for resource ${res.resource_id}: ${res.estimated_eta_seconds}`
          );
        }
      }
    }

    // Validate hospital matching
    if (ir.hospital_matching) {
      const recHospId = ir.hospital_matching.recommended_hospital_id;
      if (recHospId !== null && recHospId !== undefined) {
        if (!inputHospitalIds.has(recHospId)) {
          throw new EngineResponseValidationError(
            `Engine recommended unknown hospital ID ${recHospId} not provided in input snapshot`,
            { hospitalId: recHospId }
          );
        }
      }
    }
  }
}

/**
 * Persists an authoritative dispatch recommendation snapshot into MongoDB.
 *
 * @param {object} engineResponse - Validated C++ engine response
 * @param {object} initiatingUser - Authenticated operator/admin user
 * @param {Incident[]} incidents - List of included Mongoose incidents
 * @param {string} requestId - Correlation request ID
 * @param {string} batchId - Unique batch ID
 * @returns {Promise<DispatchRecord>}
 */
export async function persistRecommendationSnapshot(
  engineResponse,
  initiatingUser,
  incidents,
  requestId,
  batchId
) {
  const data = engineResponse.data || {};
  const incidentResultsRaw = data.incident_results || [];

  // Map engine output to Mongoose DispatchRecord schema
  const mappedIncidentResults = incidentResultsRaw.map((ir) => {
    const rAlloc = ir.resource_allocation || {};
    const hMatch = ir.hospital_matching || {};
    const selectedHosp = hMatch.selected_hospital || null;

    const assignedResources = (rAlloc.selected_resources || []).map((sr) => ({
      resourceId: sr.resource_id,
      resourceType: sr.resource_type,
      snappedNodeOsmId: sr.snapped_node_osm_id || 0,
      estimatedArrivalSeconds: Number.isFinite(sr.estimated_eta_seconds) ? sr.estimated_eta_seconds : null,
      distanceMeters: Number.isFinite(sr.road_distance_meters) ? sr.road_distance_meters : null,
      routePolyline: sr.encoded_polyline || ''
    }));

    const resourceShortages = (rAlloc.requirements_summary || [])
      .filter((rs) => (rs.shortage_quantity || 0) > 0)
      .map((rs) => ({
        resourceType: rs.resource_type,
        requestedQuantity: rs.requested_quantity || 0,
        allocatedQuantity: rs.allocated_quantity || 0,
        shortageQuantity: rs.shortage_quantity || 0
      }));

    let recommendedHospital = null;
    if (hMatch.recommended_hospital_id) {
      const rth = hMatch.route_to_hospital || {};
      recommendedHospital = {
        hospitalId: hMatch.recommended_hospital_id,
        hospitalName: hMatch.recommended_hospital_name || (selectedHosp ? selectedHosp.hospital_name : ''),
        suitability: selectedHosp ? selectedHosp.suitability : 'FULL_MATCH',
        hospitalNodeOsmId: selectedHosp ? selectedHosp.hospital_node_osm_id : 0,
        estimatedTransportSeconds: selectedHosp && Number.isFinite(selectedHosp.simulated_eta_seconds)
          ? selectedHosp.simulated_eta_seconds
          : null,
        distanceMeters: selectedHosp && Number.isFinite(selectedHosp.road_distance_meters)
          ? selectedHosp.road_distance_meters
          : null,
        routePolyline: rth.encoded_polyline || '',
        allocatedIcuBeds: 0,
        allocatedGeneralBeds: 0,
        allocatedOxygenBeds: 0
      };
    }

    return {
      incidentId: ir.incident_id,
      priorityScore: ir.priority ? ir.priority.total_priority_score : 0,
      priorityTier: ir.priority ? ir.priority.tier : 'MEDIUM',
      triageRank: ir.processing_order || 1,
      allocationStatus: rAlloc.status || 'UNALLOCATED',
      summaryNotes: ir.summary_notes || '',
      assignedResources,
      resourceShortages,
      recommendedHospital,
      hospitalShortages: {
        icuBedShortage: 0,
        generalBedShortage: 0,
        oxygenBedShortage: 0
      }
    };
  });

  const dispatchId = `DISPATCH-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const record = new DispatchRecord({
    dispatchId,
    batchId,
    requestId,
    evaluatedAt: new Date(),
    requestedBy: initiatingUser ? initiatingUser._id : null,
    recommendationStatus: data.batch_status === 'FAILED' ? 'FAILED' : 'RECOMMENDED',
    batchStatus: data.batch_status || 'SUCCESS',
    batchStatusMessage: data.batch_status_message || '',
    totalIncidents: incidents.length,
    fullyAllocatedCount: data.fully_allocated_incidents || 0,
    partiallyAllocatedCount: data.partially_allocated_incidents || 0,
    unallocatedCount: data.unallocated_incidents || 0,
    includedIncidentIds: incidents.map((inc) => inc.incidentId),
    priorityExecutionOrder: incidentResultsRaw.map((ir) => ir.incident_id),
    incidentResults: mappedIncidentResults,
    summary: data.summary || {
      totalIncidentsReceived: data.total_incidents_received || incidents.length,
      validIncidents: data.valid_incidents || incidents.length,
      invalidIncidents: data.invalid_incidents || 0,
      fullyAllocatedIncidents: data.fully_allocated_incidents || 0,
      partiallyAllocatedIncidents: data.partially_allocated_incidents || 0,
      unallocatedIncidents: data.unallocated_incidents || 0,
      totalUniqueResourcesRecommended: data.total_unique_resources_recommended || 0,
      totalHospitalRecommendations: data.total_hospital_recommendations || 0,
      resourceConflictsPrevented: data.resource_conflicts_prevented || 0,
      hospitalCapacityConflictsPrevented: data.hospital_capacity_conflicts_prevented || 0,
      remainingAvailableResources: data.remaining_available_resources || 0,
      remainingAvailableIcuBeds: data.remaining_available_icu_beds || 0,
      remainingAvailableGeneralBeds: data.remaining_available_general_beds || 0,
      remainingAvailableOxygenBeds: data.remaining_available_oxygen_beds || 0
    },
    engineMetadata: engineResponse.metadata || {
      totalExecutionTimeMs: 0,
      priorityScoringTimeMs: 0,
      resourceOrchestrationTimeMs: 0,
      hospitalOrchestrationTimeMs: 0,
      totalPipelineTimeMs: 0
    },
    engineTelemetry: engineResponse.telemetry || {
      engineExecutionTimeUs: 0,
      processWallClockMs: 0,
      dijkstraCalls: 0,
      multiTargetCalls: 0,
      protocolVersion: '1.0'
    }
  });

  await record.save();
  return record;
}

/**
 * Main orchestration entrypoint: generates, validates, and persists dispatch recommendations.
 *
 * @param {object} requestBody - Body containing incidentIds or selectAllVerified
 * @param {object} user - Authenticated user initiating the recommendation
 * @returns {Promise<object>} The persisted recommendation snapshot formatted for client delivery
 */
export async function generateDispatchRecommendations(requestBody, user) {
  const dbStatus = getConnectionStatus();
  if (!dbStatus.connected) {
    throw new RecommendationValidationError(
      'Dispatch recommendation service is temporarily unavailable. Database is disconnected.',
      'DATABASE_UNAVAILABLE',
      null,
      503
    );
  }

  // 1. Validate request body parameters
  const { incidentIds, selectAllVerified } = validateRecommendationRequest(requestBody);

  // 2. Load eligible VERIFIED incidents
  const incidents = await loadVerifiedIncidents(incidentIds, selectAllVerified);

  // 3. Load available resources and operational hospitals in consistent snapshot
  const [resources, hospitals] = await Promise.all([
    loadAvailableResources(),
    loadOperationalHospitals()
  ]);

  const requestId = randomUUID();
  const batchId = `BATCH-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const evaluatedAtMs = Date.now();

  // 4. Build C++ Protocol v1.0 payload
  const batchPayload = {
    batch_id: Math.abs(parseInt(Date.now().toString().slice(-9), 10)) || 1,
    evaluated_at_ms: evaluatedAtMs,
    incidents: incidents.map((inc) =>
      typeof inc.toEngineProtocol === 'function' ? inc.toEngineProtocol() : { incident_id: inc.incidentId }
    ),
    resources,
    hospitals
  };

  // 5. Execute optimization batch via C++ decision engine subprocess bridge
  const engineResponse = await cppEngineService.executeBatchDispatch(batchPayload, {
    requestId,
    timeoutMs: env.CPP_TIMEOUT_MS
  });

  // 6. Validate engine response
  const requestedIncidentIds = incidents.map((inc) => inc.incidentId);
  validateEngineResponse(
    engineResponse,
    requestId,
    requestedIncidentIds,
    resources,
    hospitals
  );

  // 7. Persist recommendation snapshot
  const savedRecord = await persistRecommendationSnapshot(
    engineResponse,
    user,
    incidents,
    requestId,
    batchId
  );

  return {
    dispatchId: savedRecord.dispatchId,
    batchId: savedRecord.batchId,
    requestId: savedRecord.requestId,
    evaluatedAt: savedRecord.evaluatedAt,
    recommendationStatus: savedRecord.recommendationStatus,
    batchStatus: savedRecord.batchStatus,
    batchStatusMessage: savedRecord.batchStatusMessage,
    totalIncidents: savedRecord.totalIncidents,
    fullyAllocatedCount: savedRecord.fullyAllocatedCount,
    partiallyAllocatedCount: savedRecord.partiallyAllocatedCount,
    unallocatedCount: savedRecord.unallocatedCount,
    includedIncidentIds: savedRecord.includedIncidentIds,
    priorityExecutionOrder: savedRecord.priorityExecutionOrder,
    incidentResults: savedRecord.incidentResults,
    summary: savedRecord.summary,
    engineMetadata: savedRecord.engineMetadata,
    engineTelemetry: savedRecord.engineTelemetry
  };
}

/**
 * Retrieves a historical recommendation snapshot by batch ID.
 *
 * @param {string} batchId
 * @returns {Promise<DispatchRecord|null>}
 */
export async function getRecommendationByBatchId(batchId) {
  const dbStatus = getConnectionStatus();
  if (!dbStatus.connected) {
    throw new RecommendationValidationError(
      'Dispatch service is temporarily unavailable. Database is disconnected.',
      'DATABASE_UNAVAILABLE',
      null,
      503
    );
  }

  if (!batchId || typeof batchId !== 'string') {
    throw new RecommendationValidationError(
      'Invalid batch ID format',
      'INVALID_BATCH_ID',
      null,
      400
    );
  }

  const record = await DispatchRecord.findOne({ batchId: batchId.trim() })
    .populate('requestedBy', 'name email role')
    .lean();

  return record;
}

/**
 * Lists historical recommendations with filtering and pagination.
 *
 * @param {object} query - Express req.query
 * @returns {Promise<{ recommendations: object[], pagination: object }>}
 */
export async function listRecommendations(query = {}) {
  const dbStatus = getConnectionStatus();
  if (!dbStatus.connected) {
    throw new RecommendationValidationError(
      'Dispatch service is temporarily unavailable. Database is disconnected.',
      'DATABASE_UNAVAILABLE',
      null,
      503
    );
  }

  const filter = {};

  if (query.status) {
    filter.recommendationStatus = query.status.toUpperCase();
  }

  if (query.batchStatus) {
    filter.batchStatus = query.batchStatus.toUpperCase();
  }

  if (query.incidentId !== undefined && query.incidentId !== '') {
    const incId = Number(query.incidentId);
    if (!Number.isInteger(incId) || incId <= 0) {
      throw new RecommendationValidationError(
        'Invalid incidentId filter. Must be a positive integer.',
        'INVALID_INCIDENT_ID_FILTER',
        null,
        400
      );
    }
    filter.includedIncidentIds = incId;
  }

  const startDateRaw = query.startDate || query.from;
  const endDateRaw = query.endDate || query.to;

  if (startDateRaw || endDateRaw) {
    filter.evaluatedAt = {};
    if (startDateRaw) {
      const s = new Date(startDateRaw);
      if (isNaN(s.getTime())) {
        throw new RecommendationValidationError(
          `Invalid startDate format: ${startDateRaw}. Expected valid ISO date.`,
          'INVALID_DATE_FILTER',
          null,
          400
        );
      }
      filter.evaluatedAt.$gte = s;
    }
    if (endDateRaw) {
      const e = new Date(endDateRaw);
      if (isNaN(e.getTime())) {
        throw new RecommendationValidationError(
          `Invalid endDate format: ${endDateRaw}. Expected valid ISO date.`,
          'INVALID_DATE_FILTER',
          null,
          400
        );
      }
      filter.evaluatedAt.$lte = e;
    }
  }

  const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10) || 20));
  const skip = (page - 1) * limit;

  const allowedSortFields = ['evaluatedAt', 'totalIncidents', 'createdAt'];
  const sortBy = allowedSortFields.includes(query.sortBy) ? query.sortBy : 'evaluatedAt';
  const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

  const [totalCount, records] = await Promise.all([
    DispatchRecord.countDocuments(filter),
    DispatchRecord.find(filter)
      .populate('requestedBy', 'name email role')
      .sort({ [sortBy]: sortOrder, _id: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean()
  ]);

  return {
    recommendations: records,
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

export default {
  validateRecommendationRequest,
  loadVerifiedIncidents,
  loadAvailableResources,
  loadOperationalHospitals,
  validateEngineResponse,
  persistRecommendationSnapshot,
  generateDispatchRecommendations,
  getRecommendationByBatchId,
  listRecommendations,
  RecommendationValidationError,
  EngineResponseValidationError
};
