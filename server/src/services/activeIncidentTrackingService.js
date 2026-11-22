import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import Incident, { EMERGENCY_CATEGORIES } from '../models/Incident.js';
import Resource from '../models/Resource.js';
import Hospital from '../models/Hospital.js';
import DispatchRecord from '../models/DispatchRecord.js';
import { withTransaction } from './dispatchExecutionService.js';
import { getConnectionStatus } from '../config/database.js';

/**
 * Custom error class for incident tracking business rule violations.
 */
export class IncidentTrackingError extends Error {
  constructor(message, code, details = null, statusCode = 400) {
    super(message);
    this.name = 'IncidentTrackingError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

/**
 * Validates a numeric incident ID parameter.
 * Returns parsed integer or throws IncidentTrackingError.
 */
function validateNumericIncidentId(val) {
  if (val === undefined || val === null || val === '') {
    throw new IncidentTrackingError(
      'Incident ID parameter is required',
      'MISSING_INCIDENT_ID',
      null,
      400
    );
  }
  const num = Number(val);
  if (!Number.isInteger(num) || num < 1) {
    throw new IncidentTrackingError(
      `Invalid incident ID: ${val}. Must be a positive integer.`,
      'INVALID_INCIDENT_ID',
      { incidentId: val },
      400
    );
  }
  return num;
}

/**
 * Marks an incident (or an individual assigned resource) as arrived on scene (DISPATCHED -> ON_SCENE).
 * Supports individual per-resource arrival tracking and verification methods (RADIO, PHONE, MANUAL).
 *
 * @param {number|string} incidentId - The incident to mark arrived
 * @param {object} operatorUser - Authenticated operator/admin user
 * @param {object} [options] - Options (resourceId, verificationMethod, notes, arrivalNotes, sessionOverride)
 * @returns {Promise<object>} Updated incident and dispatch metadata
 */
export async function markSceneArrival(incidentId, operatorUser, options = {}) {
  const cleanId = validateNumericIncidentId(incidentId);

  if (!options.sessionOverride) {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      throw new IncidentTrackingError(
        'Service is temporarily unavailable. Database is disconnected.',
        'DATABASE_UNAVAILABLE',
        null,
        503
      );
    }
  }

  // Pre-check incident state
  const existingIncident = await Incident.findOne({ incidentId: cleanId });
  if (!existingIncident) {
    throw new IncidentTrackingError(
      `Incident ID ${cleanId} was not found in database`,
      'INCIDENT_NOT_FOUND',
      { incidentId: cleanId },
      404
    );
  }

  if (!existingIncident.dispatchId && !existingIncident.dispatchedBatchId) {
    throw new IncidentTrackingError(
      `Incident ${cleanId} does not belong to a confirmed dispatch record`,
      'DISPATCH_NOT_CONFIRMED',
      { incidentId: cleanId },
      409
    );
  }

  const rawNotes = options.notes || options.arrivalNotes || '';
  const cleanNotes = typeof rawNotes === 'string' ? rawNotes.trim() : '';

  if (cleanNotes.length > 1000) {
    throw new IncidentTrackingError(
      'Arrival notes cannot exceed 1000 characters',
      'NOTES_TOO_LONG',
      null,
      400
    );
  }

  const validMethods = ['RADIO', 'PHONE', 'MANUAL'];
  const rawMethod = options.verificationMethod ? String(options.verificationMethod).trim().toUpperCase() : 'MANUAL';
  if (!validMethods.includes(rawMethod)) {
    throw new IncidentTrackingError(
      `Invalid verification method '${options.verificationMethod}'. Must be one of: ${validMethods.join(', ')}`,
      'INVALID_VERIFICATION_METHOD',
      { allowed: validMethods },
      400
    );
  }

  const isIndividualResourceArrival = options.resourceId !== undefined && options.resourceId !== null && options.resourceId !== '';
  let cleanResId = null;

  if (isIndividualResourceArrival) {
    cleanResId = Number(options.resourceId);
    if (!Number.isInteger(cleanResId) || cleanResId < 1) {
      throw new IncidentTrackingError(
        `Invalid resource ID: ${options.resourceId}. Must be a positive integer.`,
        'INVALID_RESOURCE_ID',
        { resourceId: options.resourceId },
        400
      );
    }

    if (!existingIncident.assignedResourceIds || !existingIncident.assignedResourceIds.includes(cleanResId)) {
      throw new IncidentTrackingError(
        `Resource ID ${cleanResId} is not assigned to Incident ${cleanId}.`,
        'RESOURCE_NOT_ASSIGNED_TO_INCIDENT',
        { incidentId: cleanId, resourceId: cleanResId, assignedResourceIds: existingIncident.assignedResourceIds },
        400
      );
    }

    // Individual arrival requires the incident to be DISPATCHED or ON_SCENE
    if (existingIncident.status !== 'DISPATCHED' && existingIncident.status !== 'ON_SCENE') {
      if (existingIncident.status === 'RESOLVED') {
        throw new IncidentTrackingError(
          `Incident ${cleanId} is already RESOLVED. Cannot mark scene arrival.`,
          'INCIDENT_STATE_CONFLICT',
          { incidentId: cleanId, currentStatus: existingIncident.status },
          409
        );
      }
      throw new IncidentTrackingError(
        `Incident ${cleanId} cannot record resource arrival because its status is '${existingIncident.status}'. Only DISPATCHED or ON_SCENE incidents can have resource arrivals recorded.`,
        'INCIDENT_STATE_CONFLICT',
        { incidentId: cleanId, currentStatus: existingIncident.status, requiredStatus: 'DISPATCHED or ON_SCENE' },
        409
      );
    }

    // Check if this specific resource is already marked ON_SCENE
    const existingResArrival = (existingIncident.assignedResourceArrivals || []).find(
      (r) => r.resourceId === cleanResId
    );
    if (existingResArrival && existingResArrival.status === 'ON_SCENE') {
      throw new IncidentTrackingError(
        `Resource ID ${cleanResId} is already marked ON_SCENE for Incident ${cleanId}.`,
        'RESOURCE_ALREADY_ON_SCENE',
        { incidentId: cleanId, resourceId: cleanResId },
        409
      );
    }
  } else {
    // Legacy / batch arrival for entire incident
    if (existingIncident.status !== 'DISPATCHED') {
      if (existingIncident.status === 'ON_SCENE') {
        throw new IncidentTrackingError(
          `Incident ${cleanId} is already marked ON_SCENE.`,
          'INCIDENT_STATE_CONFLICT',
          { incidentId: cleanId, currentStatus: existingIncident.status },
          409
        );
      }
      if (existingIncident.status === 'RESOLVED') {
        throw new IncidentTrackingError(
          `Incident ${cleanId} is already RESOLVED. Cannot mark scene arrival.`,
          'INCIDENT_STATE_CONFLICT',
          { incidentId: cleanId, currentStatus: existingIncident.status },
          409
        );
      }
      throw new IncidentTrackingError(
        `Incident ${cleanId} cannot transition to ON_SCENE because its current status is '${existingIncident.status}'. Only DISPATCHED incidents can transition to ON_SCENE.`,
        'INCIDENT_STATE_CONFLICT',
        { incidentId: cleanId, currentStatus: existingIncident.status, requiredStatus: 'DISPATCHED' },
        409
      );
    }
  }

  const now = new Date();

  return withTransaction(async (session) => {
    let updatedIncident = null;

    if (isIndividualResourceArrival) {
      // 1. Build updated assignedResourceArrivals array
      const currentArrivals = existingIncident.assignedResourceArrivals && existingIncident.assignedResourceArrivals.length > 0
        ? existingIncident.assignedResourceArrivals.map((ra) => ({
            resourceId: ra.resourceId,
            resourceType: ra.resourceType,
            incidentId: ra.incidentId,
            status: ra.status,
            dispatchedAt: ra.dispatchedAt || existingIncident.dispatchedAt,
            arrivedAt: ra.arrivedAt || null,
            arrivedBy: ra.arrivedBy || null,
            verificationMethod: ra.verificationMethod || null,
            notes: ra.notes || ''
          }))
        : (existingIncident.assignedResourceIds || []).map((vId) => ({
            resourceId: vId,
            resourceType: 'FLEET',
            incidentId: cleanId,
            status: 'DISPATCHED',
            dispatchedAt: existingIncident.dispatchedAt,
            arrivedAt: null,
            arrivedBy: null,
            verificationMethod: null,
            notes: ''
          }));

      let targetEntry = currentArrivals.find((r) => r.resourceId === cleanResId);
      if (!targetEntry) {
        targetEntry = {
          resourceId: cleanResId,
          resourceType: 'FLEET',
          incidentId: cleanId,
          status: 'ON_SCENE',
          dispatchedAt: existingIncident.dispatchedAt,
          arrivedAt: now,
          arrivedBy: operatorUser ? operatorUser._id : null,
          verificationMethod: rawMethod,
          notes: cleanNotes
        };
        currentArrivals.push(targetEntry);
      } else {
        targetEntry.status = 'ON_SCENE';
        targetEntry.arrivedAt = now;
        targetEntry.arrivedBy = operatorUser ? operatorUser._id : null;
        targetEntry.verificationMethod = rawMethod;
        targetEntry.notes = cleanNotes;
      }

      // First arriving resource transitions overall incident from DISPATCHED to ON_SCENE
      const nextIncidentStatus = 'ON_SCENE';
      const incidentArrivedAt = existingIncident.arrivedAt || now;
      const incidentArrivedBy = existingIncident.arrivedBy || (operatorUser ? operatorUser._id : null);

      updatedIncident = await Incident.findOneAndUpdate(
        { incidentId: cleanId },
        {
          $set: {
            status: nextIncidentStatus,
            arrivedAt: incidentArrivedAt,
            arrivedBy: incidentArrivedBy,
            arrivalVerificationMethod: rawMethod,
            arrivalNotes: cleanNotes,
            assignedResourceArrivals: currentArrivals
          },
          $push: {
            auditHistory: {
              action: 'ON_SCENE',
              performedBy: operatorUser ? operatorUser._id : null,
              performedAt: now,
              previousStatus: existingIncident.status,
              newStatus: nextIncidentStatus,
              notes: cleanNotes
                ? `Resource #${cleanResId} marked ON_SCENE (${rawMethod}) - ${cleanNotes}`
                : `Resource #${cleanResId} marked ON_SCENE (${rawMethod})`
            }
          }
        },
        { session, new: true }
      );

      // Update Resource collection document for this specific vehicle if available
      try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
          await Resource.findOneAndUpdate(
            { resourceId: cleanResId, assignedIncidentId: cleanId },
            {
              $set: {
                arrivedAt: now,
                arrivedBy: operatorUser ? operatorUser._id : null,
                verificationMethod: rawMethod,
                arrivalNotes: cleanNotes
              }
            },
            { session }
          );
        }
      } catch {
        // Non-blocking in mock environments
      }
    } else {
      // Legacy whole-incident arrival: mark all assigned resources as ON_SCENE
      const allArrivals = (existingIncident.assignedResourceIds || []).map((vId) => ({
        resourceId: vId,
        resourceType: 'FLEET',
        incidentId: cleanId,
        status: 'ON_SCENE',
        dispatchedAt: existingIncident.dispatchedAt,
        arrivedAt: now,
        arrivedBy: operatorUser ? operatorUser._id : null,
        verificationMethod: rawMethod,
        notes: cleanNotes
      }));

      updatedIncident = await Incident.findOneAndUpdate(
        {
          incidentId: cleanId,
          status: 'DISPATCHED' // Atomic conditional invariant
        },
        {
          $set: {
            status: 'ON_SCENE',
            arrivedAt: now,
            arrivedBy: operatorUser ? operatorUser._id : null,
            arrivalVerificationMethod: rawMethod,
            arrivalNotes: cleanNotes,
            assignedResourceArrivals: allArrivals
          },
          $push: {
            auditHistory: {
              action: 'ON_SCENE',
              performedBy: operatorUser ? operatorUser._id : null,
              performedAt: now,
              previousStatus: 'DISPATCHED',
              newStatus: 'ON_SCENE',
              notes: cleanNotes || 'Emergency response units arrived on scene'
            }
          }
        },
        { session, new: true }
      );

      if (!updatedIncident) {
        throw new IncidentTrackingError(
          `Incident ${cleanId} could not be updated to ON_SCENE. State conflict detected during transaction.`,
          'INCIDENT_STATE_CONFLICT',
          { incidentId: cleanId },
          409
        );
      }
    }

    if (!updatedIncident) {
      throw new IncidentTrackingError(
        `Incident ${cleanId} could not be updated to ON_SCENE. State conflict detected during transaction.`,
        'INCIDENT_STATE_CONFLICT',
        { incidentId: cleanId },
        409
      );
    }

    // 2. Update tracking in associated DispatchRecord
    let dispatchRecord = null;
    const dispatchQuery = [];
    if (updatedIncident.dispatchId) dispatchQuery.push({ dispatchId: updatedIncident.dispatchId });
    if (updatedIncident.dispatchedBatchId) dispatchQuery.push({ batchId: updatedIncident.dispatchedBatchId });

    if (dispatchQuery.length > 0) {
      dispatchRecord = await DispatchRecord.findOne({ $or: dispatchQuery }).session(session);

      if (dispatchRecord) {
        if (!dispatchRecord.incidentTracking) {
          dispatchRecord.incidentTracking = [];
        }

        let trackEntry = dispatchRecord.incidentTracking.find((t) => t.incidentId === cleanId);
        if (!trackEntry) {
          trackEntry = {
            incidentId: cleanId,
            status: 'ON_SCENE',
            arrivedAt: now,
            resolvedAt: null,
            resolutionNotes: ''
          };
          dispatchRecord.incidentTracking.push(trackEntry);
        } else {
          trackEntry.status = 'ON_SCENE';
          trackEntry.arrivedAt = now;
        }

        // Update resourceReservations status inside dispatchRecord
        if (dispatchRecord.resourceReservations && dispatchRecord.resourceReservations.length > 0) {
          dispatchRecord.resourceReservations.forEach((rr) => {
            if (rr.assignedIncidentId === cleanId) {
              if (isIndividualResourceArrival) {
                if (rr.resourceId === cleanResId) {
                  rr.status = 'ON_SCENE';
                  rr.arrivedAt = now;
                  rr.arrivedBy = operatorUser ? operatorUser._id : null;
                  rr.verificationMethod = rawMethod;
                  rr.arrivalNotes = cleanNotes;
                }
              } else {
                rr.status = 'ON_SCENE';
                rr.arrivedAt = now;
                rr.arrivedBy = operatorUser ? operatorUser._id : null;
                rr.verificationMethod = rawMethod;
                rr.arrivalNotes = cleanNotes;
              }
            }
          });
        }

        dispatchRecord.confirmationAuditTrail.push({
          action: isIndividualResourceArrival ? 'RESOURCE_ARRIVAL' : 'SCENE_ARRIVAL',
          performedBy: operatorUser ? operatorUser._id : null,
          performedAt: now,
          notes: isIndividualResourceArrival
            ? `Resource #${cleanResId} marked ON_SCENE via ${rawMethod}`
            : `Incident ${cleanId} marked ON_SCENE`
        });

        await dispatchRecord.save({ session });
      }
    }

    let hospitalMap = null;
    if (updatedIncident.assignedHospitalId) {
      if (dispatchRecord?.hospitalReservations?.length) {
        const matchingHosp = dispatchRecord.hospitalReservations.find(
          (hr) => hr.hospitalId === updatedIncident.assignedHospitalId
        );
        if (matchingHosp) {
          hospitalMap = new Map([[matchingHosp.hospitalId, { hospitalId: matchingHosp.hospitalId, name: matchingHosp.hospitalName }]]);
        }
      }
      if (!hospitalMap && (mongoose.connection.readyState === 1 || Hospital.findOne !== mongoose.Model.findOne)) {
        try {
          const query = Hospital.findOne({ hospitalId: updatedIncident.assignedHospitalId });
          if (query && typeof query.session === 'function') query.session(session);
          if (query && typeof query.select === 'function') query.select('hospitalId name');
          const h = query && typeof query.lean === 'function' ? await query.lean() : await query;
          if (h) {
            hospitalMap = new Map([[h.hospitalId, h]]);
          }
        } catch (err) {
          console.warn('[MarkArrival] Failed to load hospital:', err.message);
        }
      }
    }

    return {
      incident: formatIncidentTrackingResponse(updatedIncident, hospitalMap),
      dispatchId: updatedIncident.dispatchId || null,
      dispatchedBatchId: updatedIncident.dispatchedBatchId || null,
      resourceArrival: isIndividualResourceArrival
        ? (updatedIncident.assignedResourceArrivals || []).find((r) => r.resourceId === cleanResId)
        : null
    };
  }, options);
}

/**
 * Resolves an active incident (ON_SCENE -> RESOLVED).
 * Atomically releases assigned resources back to AVAILABLE and restores reserved hospital bed capacity.
 *
 * @param {number|string} incidentId - The incident to resolve
 * @param {object} operatorUser - Authenticated operator/admin user
 * @param {object} [options] - Options (resolutionNotes, sessionOverride)
 * @returns {Promise<object>} Resolved incident summary, released resources, and restored hospital capacities
 */
export async function resolveIncident(incidentId, operatorUser, options = {}) {
  const cleanId = validateNumericIncidentId(incidentId);

  if (!options.sessionOverride) {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      throw new IncidentTrackingError(
        'Service is temporarily unavailable. Database is disconnected.',
        'DATABASE_UNAVAILABLE',
        null,
        503
      );
    }
  }

  // Pre-check incident state
  const existingIncident = await Incident.findOne({ incidentId: cleanId });
  if (!existingIncident) {
    throw new IncidentTrackingError(
      `Incident ID ${cleanId} was not found in database`,
      'INCIDENT_NOT_FOUND',
      { incidentId: cleanId },
      404
    );
  }

  if (existingIncident.status !== 'ON_SCENE') {
    if (existingIncident.status === 'RESOLVED') {
      throw new IncidentTrackingError(
        `Incident ${cleanId} is already RESOLVED.`,
        'INCIDENT_ALREADY_RESOLVED',
        { incidentId: cleanId, resolvedAt: existingIncident.resolvedAt },
        409
      );
    }
    if (existingIncident.status === 'DISPATCHED') {
      throw new IncidentTrackingError(
        `Incident ${cleanId} cannot transition directly from DISPATCHED to RESOLVED. Emergency units must first arrive ON_SCENE.`,
        'INCIDENT_STATE_CONFLICT',
        { incidentId: cleanId, currentStatus: existingIncident.status, requiredStatus: 'ON_SCENE' },
        409
      );
    }
    if (existingIncident.status === 'VERIFIED') {
      throw new IncidentTrackingError(
        `Incident ${cleanId} cannot transition directly from VERIFIED to RESOLVED. It must first be dispatched and arrive on scene.`,
        'INCIDENT_STATE_CONFLICT',
        { incidentId: cleanId, currentStatus: existingIncident.status, requiredStatus: 'ON_SCENE' },
        409
      );
    }
    throw new IncidentTrackingError(
      `Incident ${cleanId} cannot transition to RESOLVED because its current status is '${existingIncident.status}'. Only ON_SCENE incidents can be resolved.`,
      'INCIDENT_STATE_CONFLICT',
      { incidentId: cleanId, currentStatus: existingIncident.status, requiredStatus: 'ON_SCENE' },
      409
    );
  }

  const rawNotes = options.resolutionNotes || '';
  const cleanNotes = typeof rawNotes === 'string' ? rawNotes.trim() : '';

  if (cleanNotes.length > 1000) {
    throw new IncidentTrackingError(
      'Resolution notes cannot exceed 1000 characters',
      'INVALID_RESOLUTION_NOTES',
      { length: cleanNotes.length, maxLength: 1000 },
      400
    );
  }

  const now = new Date();

  return withTransaction(async (session) => {
    // 1. Atomic transition of Incident to RESOLVED
    const updatedIncident = await Incident.findOneAndUpdate(
      {
        incidentId: cleanId,
        status: 'ON_SCENE' // Atomic conditional invariant
      },
      {
        $set: {
          status: 'RESOLVED',
          resolvedAt: now,
          resolvedBy: operatorUser ? operatorUser._id : null,
          resolutionNotes: cleanNotes
        },
        $push: {
          auditHistory: {
            action: 'RESOLVED',
            performedBy: operatorUser ? operatorUser._id : null,
            performedAt: now,
            previousStatus: 'ON_SCENE',
            newStatus: 'RESOLVED',
            notes: cleanNotes || 'Incident resolved and assigned resources released'
          }
        }
      },
      { session, new: true }
    );

    if (!updatedIncident) {
      throw new IncidentTrackingError(
        `Incident ${cleanId} could not be updated to RESOLVED. State conflict detected during transaction.`,
        'INCIDENT_STATE_CONFLICT',
        { incidentId: cleanId },
        409
      );
    }

    // 2. Safe Resource Release: DISPATCHED -> AVAILABLE
    // Identify only resources genuinely associated with this incident
    const assignedResourceIds = updatedIncident.assignedResourceIds || [];
    const releasedResources = [];

    for (const resId of assignedResourceIds) {
      const releasedRes = await Resource.findOneAndUpdate(
        {
          resourceId: resId,
          assignedIncidentId: cleanId, // Strictly associate with this incident
          status: 'DISPATCHED'          // Only release if DISPATCHED
        },
        {
          $set: {
            status: 'AVAILABLE',
            assignedIncidentId: null,
            assignedBatchId: null,
            assignedDispatchId: null,
            reservedAt: null,
            dispatchedAt: null,
            arrivedAt: null,
            arrivedBy: null,
            verificationMethod: null,
            arrivalNotes: ''
          }
        },
        { session, new: true }
      );

      if (releasedRes) {
        releasedResources.push({
          resourceId: releasedRes.resourceId,
          resourceType: releasedRes.resourceType,
          status: 'AVAILABLE',
          releasedAt: now
        });
      }
    }

    // 3. Hospital Capacity Release
    const releasedHospitalCapacities = [];
    let dispatchRecord = null;
    const dispatchQuery = [];
    if (updatedIncident.dispatchId) dispatchQuery.push({ dispatchId: updatedIncident.dispatchId });
    if (updatedIncident.dispatchedBatchId) dispatchQuery.push({ batchId: updatedIncident.dispatchedBatchId });

    if (dispatchQuery.length > 0) {
      dispatchRecord = await DispatchRecord.findOne({ $or: dispatchQuery }).session(session);

      if (dispatchRecord) {
        const reservations = dispatchRecord.hospitalReservations || [];

        for (const r of reservations) {
          // Release only capacity actually reserved for this incident that has not been released yet
          if (r.assignedIncidentId === cleanId && !r.isReleased) {
            const needsIcu = (r.reservedIcuBeds || 0) > 0;
            const needsGen = (r.reservedGeneralBeds || 0) > 0;
            const needsOxy = (r.reservedOxygenBeds || 0) > 0;

            if (needsIcu || needsGen || needsOxy) {
              const hosp = await Hospital.findOne({ hospitalId: r.hospitalId }).session(session);

              if (hosp) {
                const incFields = {};

                if (needsIcu && hosp.icuBeds) {
                  const maxRestore = Math.max(0, (hosp.icuBeds.total || 0) - (hosp.icuBeds.available || 0));
                  const toRestore = Math.min(r.reservedIcuBeds, maxRestore);
                  if (toRestore > 0) incFields['icuBeds.available'] = toRestore;
                }

                if (needsGen && hosp.generalBeds) {
                  const maxRestore = Math.max(0, (hosp.generalBeds.total || 0) - (hosp.generalBeds.available || 0));
                  const toRestore = Math.min(r.reservedGeneralBeds, maxRestore);
                  if (toRestore > 0) incFields['generalBeds.available'] = toRestore;
                }

                if (needsOxy && hosp.oxygenBeds) {
                  const maxRestore = Math.max(0, (hosp.oxygenBeds.total || 0) - (hosp.oxygenBeds.available || 0));
                  const toRestore = Math.min(r.reservedOxygenBeds, maxRestore);
                  if (toRestore > 0) incFields['oxygenBeds.available'] = toRestore;
                }

                if (Object.keys(incFields).length > 0) {
                  await Hospital.findOneAndUpdate(
                    { hospitalId: r.hospitalId },
                    { $inc: incFields },
                    { session, new: true }
                  );
                }

                releasedHospitalCapacities.push({
                  hospitalId: r.hospitalId,
                  hospitalName: r.hospitalName,
                  restoredIcuBeds: incFields['icuBeds.available'] || 0,
                  restoredGeneralBeds: incFields['generalBeds.available'] || 0,
                  restoredOxygenBeds: incFields['oxygenBeds.available'] || 0,
                  releasedAt: now
                });
              }
            }

            // Mark reservation as released idempotently
            r.isReleased = true;
            r.releasedAt = now;
            r.releasedBy = operatorUser ? operatorUser._id : null;
          }
        }

        // Mark resource reservations as released in dispatch ledger
        for (const rr of dispatchRecord.resourceReservations || []) {
          if (rr.assignedIncidentId === cleanId && !rr.isReleased) {
            rr.isReleased = true;
            rr.releasedAt = now;
          }
        }

        // Update incident-specific tracking in dispatch record
        if (!dispatchRecord.incidentTracking) {
          dispatchRecord.incidentTracking = [];
        }

        let trackEntry = dispatchRecord.incidentTracking.find((t) => t.incidentId === cleanId);
        if (!trackEntry) {
          dispatchRecord.incidentTracking.push({
            incidentId: cleanId,
            status: 'RESOLVED',
            arrivedAt: updatedIncident.arrivedAt || null,
            resolvedAt: now,
            resolutionNotes: cleanNotes
          });
        } else {
          trackEntry.status = 'RESOLVED';
          trackEntry.resolvedAt = now;
          trackEntry.resolutionNotes = cleanNotes;
        }

        // Multi-Incident Completion Strategy:
        // Check if all incidents in this dispatch are now RESOLVED
        const allAssociatedIds = dispatchRecord.associatedIncidentIds || dispatchRecord.includedIncidentIds || [];
        const remainingUnresolved = await Incident.countDocuments({
          incidentId: { $in: allAssociatedIds, $ne: cleanId },
          status: { $ne: 'RESOLVED' }
        }).session(session);

        if (remainingUnresolved === 0) {
          dispatchRecord.confirmationStatus = 'COMPLETED';
          dispatchRecord.completedAt = now;
        } else {
          dispatchRecord.confirmationStatus = 'PARTIALLY_RESOLVED';
        }

        dispatchRecord.confirmationAuditTrail.push({
          action: 'INCIDENT_RESOLVED',
          performedBy: operatorUser ? operatorUser._id : null,
          performedAt: now,
          notes: `Incident ${cleanId} resolved: ${cleanNotes || 'Completed'}`
        });

        await dispatchRecord.save({ session });
      }
    }

    let hospitalMap = null;
    if (updatedIncident.assignedHospitalId) {
      if (dispatchRecord?.hospitalReservations?.length) {
        const matchingHosp = dispatchRecord.hospitalReservations.find(
          (hr) => hr.hospitalId === updatedIncident.assignedHospitalId
        );
        if (matchingHosp) {
          hospitalMap = new Map([[matchingHosp.hospitalId, { hospitalId: matchingHosp.hospitalId, name: matchingHosp.hospitalName }]]);
        }
      }
      if (!hospitalMap && (mongoose.connection.readyState === 1 || Hospital.findOne !== mongoose.Model.findOne)) {
        try {
          const query = Hospital.findOne({ hospitalId: updatedIncident.assignedHospitalId });
          if (query && typeof query.session === 'function') query.session(session);
          if (query && typeof query.select === 'function') query.select('hospitalId name');
          const h = query && typeof query.lean === 'function' ? await query.lean() : await query;
          if (h) {
            hospitalMap = new Map([[h.hospitalId, h]]);
          }
        } catch (err) {
          console.warn('[ResolveIncident] Failed to load hospital:', err.message);
        }
      }
    }

    return {
      incident: formatIncidentTrackingResponse(updatedIncident, hospitalMap),
      releasedResources,
      releasedHospitalCapacities,
      dispatchSummary: dispatchRecord
        ? {
            dispatchId: dispatchRecord.dispatchId,
            batchId: dispatchRecord.batchId,
            confirmationStatus: dispatchRecord.confirmationStatus,
            completedAt: dispatchRecord.completedAt || null
          }
        : null
    };
  }, options);
}

/**
 * Retrieves active dispatched and on-scene incidents for control room monitoring.
 *
 * @param {object} query - Express query params (status, category, severity, page, limit, sortBy, sortOrder)
 * @returns {Promise<{ incidents: object[], pagination: object }>}
 */
export async function getActiveIncidents(query = {}) {
  const dbStatus = getConnectionStatus();
  if (!dbStatus.connected) {
    throw new IncidentTrackingError(
      'Service is temporarily unavailable. Database is disconnected.',
      'DATABASE_UNAVAILABLE',
      null,
      503
    );
  }

  const filter = {};

  if (query.status) {
    const s = String(query.status).trim().toUpperCase();
    if (!['DISPATCHED', 'ON_SCENE'].includes(s)) {
      throw new IncidentTrackingError(
        `Invalid active status filter '${query.status}'. Must be DISPATCHED or ON_SCENE.`,
        'INVALID_STATUS_FILTER',
        { allowed: ['DISPATCHED', 'ON_SCENE'] },
        400
      );
    }
    filter.status = s;
  } else {
    filter.status = { $in: ['DISPATCHED', 'ON_SCENE'] };
  }

  if (query.category) {
    const cat = String(query.category).trim().toUpperCase();
    if (!EMERGENCY_CATEGORIES.includes(cat)) {
      throw new IncidentTrackingError(
        `Invalid emergency category filter: ${query.category}. Must be one of: ${EMERGENCY_CATEGORIES.join(', ')}`,
        'INVALID_CATEGORY_FILTER',
        { allowed: EMERGENCY_CATEGORIES },
        400
      );
    }
    filter.category = cat;
  }

  if (query.severity !== undefined && query.severity !== '') {
    const sev = Number(query.severity);
    if (!Number.isInteger(sev) || sev < 1 || sev > 5) {
      throw new IncidentTrackingError(
        `Invalid severity filter: ${query.severity}. Must be an integer between 1 and 5.`,
        'INVALID_SEVERITY_FILTER',
        null,
        400
      );
    }
    filter.severity = sev;
  }

  const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10) || 20));
  const skip = (page - 1) * limit;

  const allowedSortFields = ['reportedAt', 'dispatchedAt', 'arrivedAt', 'severity', 'createdAt'];
  const sortBy = allowedSortFields.includes(query.sortBy) ? query.sortBy : 'reportedAt';
  const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

  const [totalCount, incidents] = await Promise.all([
    Incident.countDocuments(filter),
    Incident.find(filter)
      .populate('reportedBy', 'name email role')
      .populate('verifiedBy', 'name email role')
      .populate('arrivedBy', 'name email role')
      .populate('resolvedBy', 'name email role')
      .sort({ [sortBy]: sortOrder, incidentId: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean()
  ]);

  // Bulk query for unique assigned hospital IDs rather than an N+1 query pattern
  const hospitalIds = [
    ...new Set(
      incidents
        .map((inc) => inc.assignedHospitalId)
        .filter((id) => id !== null && id !== undefined && id > 0)
    )
  ];

  const hospitalMap = new Map();
  if (hospitalIds.length > 0 && (mongoose.connection.readyState === 1 || Hospital.find !== mongoose.Model.find)) {
    try {
      const hospitals = await Hospital.find({ hospitalId: { $in: hospitalIds } })
        .select('hospitalId name')
        .lean();
      for (const h of hospitals) {
        hospitalMap.set(h.hospitalId, h);
      }
    } catch (err) {
      console.warn('[ActiveIncidents] Failed to query hospitals for active incidents:', err.message);
    }
  }

  return {
    incidents: incidents.map((inc) => formatIncidentTrackingResponse(inc, hospitalMap)),
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
 * Records a manual reporter call attempt for an incident.
 * Does NOT alter incident verification status or lifecycle state.
 *
 * @param {number|string} incidentId - The incident
 * @param {object} operatorUser - Authenticated operator/admin user
 * @param {object} payload - Call attempt payload ({ outcome, notes, phoneCalled })
 * @returns {Promise<object>} Created attempt and updated metadata
 */
export async function recordCallAttempt(incidentId, operatorUser, payload = {}, options = {}) {
  const cleanId = validateNumericIncidentId(incidentId);

  if (!options.sessionOverride && !options.skipDbCheck) {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      throw new IncidentTrackingError(
        'Service is temporarily unavailable. Database is disconnected.',
        'DATABASE_UNAVAILABLE',
        null,
        503
      );
    }
  }

  const existingIncident = await Incident.findOne({ incidentId: cleanId });
  if (!existingIncident) {
    throw new IncidentTrackingError(
      `Incident ID ${cleanId} was not found in database`,
      'INCIDENT_NOT_FOUND',
      { incidentId: cleanId },
      404
    );
  }

  const validOutcomes = ['ANSWERED', 'NO_ANSWER', 'BUSY', 'UNREACHABLE', 'INVALID_NUMBER'];
  const rawOutcome = payload.outcome ? String(payload.outcome).trim().toUpperCase() : '';
  if (!validOutcomes.includes(rawOutcome)) {
    throw new IncidentTrackingError(
      `Invalid call outcome: '${payload.outcome}'. Must be one of: ${validOutcomes.join(', ')}`,
      'INVALID_CALL_OUTCOME',
      { allowed: validOutcomes },
      400
    );
  }

  const rawNotes = payload.notes || '';
  const cleanNotes = typeof rawNotes === 'string' ? rawNotes.trim() : '';
  if (cleanNotes.length > 1000) {
    throw new IncidentTrackingError(
      'Call notes cannot exceed 1000 characters',
      'NOTES_TOO_LONG',
      null,
      400
    );
  }

  const phoneCalled = payload.phoneCalled || existingIncident.reporterPhone || '';
  const now = new Date();

  const attemptEntry = {
    attemptId: `CALL-${Date.now()}-${randomUUID().slice(0, 8)}`,
    incidentId: cleanId,
    performedBy: operatorUser ? operatorUser._id : null,
    attemptedAt: now,
    phoneCalled,
    outcome: rawOutcome,
    notes: cleanNotes
  };

  const updatedIncident = await Incident.findOneAndUpdate(
    { incidentId: cleanId },
    {
      $push: {
        callAttempts: attemptEntry,
        auditHistory: {
          action: existingIncident.status,
          performedBy: operatorUser ? operatorUser._id : null,
          performedAt: now,
          previousStatus: existingIncident.status,
          newStatus: existingIncident.status,
          notes: `Manual call attempt recorded: ${rawOutcome}${cleanNotes ? ` - ${cleanNotes}` : ''}`
        }
      }
    },
    { new: true }
  ).populate('callAttempts.performedBy', 'name email role');

  return {
    callAttempt: {
      ...attemptEntry,
      performedBy: operatorUser
        ? {
            id: operatorUser._id ? operatorUser._id.toString() : operatorUser.id,
            name: operatorUser.name,
            email: operatorUser.email,
            role: operatorUser.role
          }
        : null
    },
    totalCallAttempts: updatedIncident.callAttempts.length,
    incidentId: cleanId,
    incidentStatus: updatedIncident.status // Preserved unchanged!
  };
}

/**
 * Retrieves all manual call attempts recorded for an incident.
 *
 * @param {number|string} incidentId - The incident
 * @returns {Promise<object>} List of call attempts
 */
export async function getCallAttempts(incidentId) {
  const cleanId = validateNumericIncidentId(incidentId);

  const existingIncident = await Incident.findOne({ incidentId: cleanId })
    .populate('callAttempts.performedBy', 'name email role')
    .lean();

  if (!existingIncident) {
    throw new IncidentTrackingError(
      `Incident ID ${cleanId} was not found in database`,
      'INCIDENT_NOT_FOUND',
      { incidentId: cleanId },
      404
    );
  }

  return {
    incidentId: cleanId,
    callAttempts: (existingIncident.callAttempts || []).map((c) => ({
      attemptId: c.attemptId,
      incidentId: c.incidentId,
      attemptedAt: c.attemptedAt,
      phoneCalled: c.phoneCalled,
      outcome: c.outcome,
      notes: c.notes || '',
      performedBy: c.performedBy
        ? {
            id: c.performedBy._id ? c.performedBy._id.toString() : c.performedBy.toString(),
            name: c.performedBy.name || 'Operator',
            email: c.performedBy.email || '',
            role: c.performedBy.role || 'OPERATOR'
          }
        : null
    }))
  };
}

/**
 * Formats an incident document for consistent tracking API responses.
 *
 * @param {object} inc - Incident document or lean object
 * @param {Map|object} [hospitalMap] - Optional map of hospitalId -> hospital
 * @returns {object} Formatted incident object
 */
export function formatIncidentTrackingResponse(inc, hospitalMap = null) {
  const resourceArrivals = (inc.assignedResourceArrivals || []).map((ra) => ({
    resourceId: ra.resourceId,
    resourceType: ra.resourceType,
    incidentId: ra.incidentId,
    status: ra.status,
    dispatchedAt: ra.dispatchedAt,
    arrivedAt: ra.arrivedAt,
    arrivedBy: ra.arrivedBy ? (ra.arrivedBy.name || (ra.arrivedBy._id ? ra.arrivedBy._id.toString() : ra.arrivedBy.toString())) : null,
    verificationMethod: ra.verificationMethod || null,
    notes: ra.notes || ''
  }));

  const allOnScene = resourceArrivals.length > 0
    ? resourceArrivals.every((r) => r.status === 'ON_SCENE')
    : inc.status === 'ON_SCENE';

  const onSceneCount = resourceArrivals.length > 0
    ? resourceArrivals.filter((r) => r.status === 'ON_SCENE').length
    : (inc.status === 'ON_SCENE' ? (inc.assignedResourceIds?.length || 0) : 0);

  const totalAssigned = inc.assignedResourceIds ? inc.assignedResourceIds.length : resourceArrivals.length;

  let assignedHospital = null;
  if (inc.assignedHospitalId) {
    let hosp = null;
    if (hospitalMap instanceof Map) {
      hosp = hospitalMap.get(inc.assignedHospitalId);
    } else if (hospitalMap && typeof hospitalMap === 'object') {
      if (hospitalMap.hospitalId === inc.assignedHospitalId) {
        hosp = hospitalMap;
      } else if (hospitalMap[inc.assignedHospitalId]) {
        hosp = hospitalMap[inc.assignedHospitalId];
      }
    }
    if (hosp) {
      assignedHospital = {
        hospitalId: hosp.hospitalId,
        hospitalName: hosp.name || hosp.hospitalName || ''
      };
    }
  }

  return {
    incidentId: inc.incidentId,
    category: inc.category,
    subcategory: inc.subcategory || '',
    severity: inc.severity,
    victimCount: inc.victimCount,
    status: inc.status,
    description: inc.description || '',
    location: {
      latitude: inc.latitude,
      longitude: inc.longitude
    },
    reportedAt: inc.reportedAt || inc.createdAt,
    verifiedAt: inc.verifiedAt || null,
    dispatchedAt: inc.dispatchedAt || null,
    arrivedAt: inc.arrivedAt || null,
    arrivedBy: inc.arrivedBy ? (inc.arrivedBy.name || (inc.arrivedBy._id ? inc.arrivedBy._id.toString() : inc.arrivedBy.toString())) : null,
    arrivalVerificationMethod: inc.arrivalVerificationMethod || null,
    arrivalNotes: inc.arrivalNotes || '',
    resolvedAt: inc.resolvedAt || null,
    resolutionNotes: inc.resolutionNotes || '',
    dispatchId: inc.dispatchId || null,
    dispatchedBatchId: inc.dispatchedBatchId || null,
    assignedResourceIds: inc.assignedResourceIds || [],
    assignedResourceArrivals: resourceArrivals,
    assignedResources: resourceArrivals.length > 0
      ? resourceArrivals
      : (inc.assignedResourceIds || []).map((id) => ({
          resourceId: id,
          resourceType: 'FLEET',
          status: inc.status === 'ON_SCENE' ? 'ON_SCENE' : 'DISPATCHED'
        })),
    allResourcesOnScene: allOnScene,
    onSceneResourceCount: onSceneCount,
    totalAssignedResourceCount: totalAssigned,
    assignedHospitalId: inc.assignedHospitalId || null,
    assignedHospital,
    callAttempts: (inc.callAttempts || []).map((c) => ({
      attemptId: c.attemptId,
      incidentId: c.incidentId,
      attemptedAt: c.attemptedAt,
      phoneCalled: c.phoneCalled,
      outcome: c.outcome,
      notes: c.notes || '',
      performedBy: c.performedBy ? (c.performedBy.name || (c.performedBy._id ? c.performedBy._id.toString() : c.performedBy.toString())) : null
    })),
    auditHistory: (inc.auditHistory || []).map((a) => ({
      action: a.action,
      performedAt: a.performedAt,
      previousStatus: a.previousStatus,
      newStatus: a.newStatus,
      notes: a.notes || undefined
    }))
  };
}

export default {
  markSceneArrival,
  resolveIncident,
  recordCallAttempt,
  getCallAttempts,
  getActiveIncidents,
  formatIncidentTrackingResponse,
  IncidentTrackingError
};
