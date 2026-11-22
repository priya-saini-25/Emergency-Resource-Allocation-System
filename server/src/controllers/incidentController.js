import mongoose from 'mongoose';
import Incident, {
  EMERGENCY_CATEGORIES,
  INCIDENT_STATUSES,
  VERIFICATION_OUTCOMES
} from '../models/Incident.js';
import Hospital from '../models/Hospital.js';
import { isInsideJodhpurBoundary } from '../services/geographicService.js';
import { getConnectionStatus } from '../config/database.js';
import { validateAndNormalizeIndianPhone } from '../utils/phoneUtils.js';
import {
  markSceneArrival,
  resolveIncident as executeResolveIncident,
  getActiveIncidents as fetchActiveIncidents,
  recordCallAttempt as executeRecordCallAttempt,
  getCallAttempts as executeGetCallAttempts,
  IncidentTrackingError
} from '../services/activeIncidentTrackingService.js';
import { emitControlRoomNotification } from '../services/realtimeNotificationService.js';

/**
 * Generates a unique positive integer incident ID based on high-resolution timestamp.
 */
function generateIncidentId() {
  const hrTime = process.hrtime();
  const base = Math.floor(Date.now() / 1000) * 10000;
  const offset = Math.floor((hrTime[1] / 1000000) * 10);
  const rand = Math.floor(Math.random() * 10);
  return base + offset + rand;
}

/**
 * Validates a numeric incident ID parameter.
 * Returns the parsed integer if valid, or null if invalid.
 */
function parseNumericIncidentId(val) {
  if (val === undefined || val === null || val === '') return null;
  const num = Number(val);
  if (!Number.isInteger(num) || num < 1) return null;
  return num;
}

/**
 * Citizen Emergency Incident Intake (POST /api/incidents).
 * Submits an initial incident report. Strictly restricted to CITIZEN role.
 */
export async function createIncident(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Incident submission is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const body = req.body || {};
    const { category, subcategory, severity, victimCount, description } = body;

    // Extract coordinates and optional place name from location object or top-level properties
    let lat = null;
    let lng = null;
    let locationName = '';

    if (body.location && typeof body.location === 'object') {
      lat = body.location.latitude;
      lng = body.location.longitude;
      if (typeof body.location.locationName === 'string') {
        locationName = body.location.locationName.trim().slice(0, 200);
      } else if (typeof body.location.name === 'string') {
        locationName = body.location.name.trim().slice(0, 200);
      }
    } else {
      lat = body.latitude;
      lng = body.longitude;
    }

    if (!locationName && typeof body.locationName === 'string') {
      locationName = body.locationName.trim().slice(0, 200);
    }

    // 1. Validate Category
    if (!category || typeof category !== 'string' || !EMERGENCY_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Invalid emergency category. Must be one of: ${EMERGENCY_CATEGORIES.join(', ')}`,
        error: { code: 'INVALID_CATEGORY', allowedCategories: EMERGENCY_CATEGORIES }
      });
    }

    // 2. Validate Severity (Integer 1 to 5)
    const sevNum = Number(severity);
    if (!Number.isInteger(sevNum) || sevNum < 1 || sevNum > 5) {
      return res.status(400).json({
        success: false,
        message: 'Severity must be an integer between 1 and 5',
        error: { code: 'INVALID_SEVERITY', value: severity }
      });
    }

    // 3. Validate Victim Count (Non-negative integer)
    let victims = 0;
    if (victimCount !== undefined && victimCount !== null) {
      victims = Number(victimCount);
      if (!Number.isInteger(victims) || victims < 0) {
        return res.status(400).json({
          success: false,
          message: 'Victim count must be a non-negative integer',
          error: { code: 'INVALID_VICTIM_COUNT', value: victimCount }
        });
      }
    }

    // 4. Validate Coordinates
    if (lat === undefined || lat === null || lng === undefined || lng === null) {
      return res.status(400).json({
        success: false,
        message: 'Incident location coordinates (latitude and longitude) are required',
        error: { code: 'MISSING_COORDINATES' }
      });
    }

    const latNum = Number(lat);
    const lngNum = Number(lng);

    if (
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < -90.0 ||
      latNum > 90.0 ||
      lngNum < -180.0 ||
      lngNum > 180.0
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinate values. Latitude must be in [-90, 90] and longitude in [-180, 180].',
        error: { code: 'INVALID_COORDINATES', coordinates: { latitude: lat, longitude: lng } }
      });
    }

    // 5. Geographic Boundary Validation (Ray-Casting Point-in-Polygon)
    const isInside = isInsideJodhpurBoundary(latNum, lngNum);
    if (!isInside) {
      return res.status(400).json({
        success: false,
        message: 'Incident location falls outside the Jodhpur Urban Service Area boundary',
        error: {
          code: 'OUTSIDE_SERVICE_AREA',
          coordinates: { latitude: latNum, longitude: lngNum }
        }
      });
    }

    // 6. Validate Reporter Information
    let cleanReporterName = req.user?.name || '';
    if (body.reporterName !== undefined && body.reporterName !== null) {
      if (typeof body.reporterName !== 'string' || body.reporterName.trim().length < 2 || body.reporterName.trim().length > 100) {
        return res.status(400).json({
          success: false,
          message: 'Reporter name must be between 2 and 100 characters',
          error: { code: 'INVALID_REPORTER_NAME' }
        });
      }
      cleanReporterName = body.reporterName.trim();
    }

    let cleanReporterPhone = '';
    if (body.reporterPhone !== undefined && body.reporterPhone !== null && body.reporterPhone !== '') {
      const phoneValidation = validateAndNormalizeIndianPhone(body.reporterPhone, true);
      if (!phoneValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: phoneValidation.error || 'Invalid Indian mobile number',
          error: { code: 'INVALID_PHONE_NUMBER', details: phoneValidation.error }
        });
      }
      cleanReporterPhone = phoneValidation.normalized;
    } else if (body.reporterPhone === '') {
      return res.status(400).json({
        success: false,
        message: 'Reporter mobile number is required',
        error: { code: 'MISSING_REPORTER_PHONE' }
      });
    }

    let cleanAlternatePhone = '';
    if (body.alternatePhone !== undefined && body.alternatePhone !== null && String(body.alternatePhone).trim() !== '') {
      const altValidation = validateAndNormalizeIndianPhone(body.alternatePhone, false);
      if (!altValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: altValidation.error || 'Invalid alternate mobile number',
          error: { code: 'INVALID_ALTERNATE_PHONE', details: altValidation.error }
        });
      }
      cleanAlternatePhone = altValidation.normalized;
    }

    // 7. Validate Description Length
    const cleanDesc = typeof description === 'string' ? description.trim() : '';
    if (cleanDesc.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Description cannot exceed 1000 characters',
        error: { code: 'DESCRIPTION_TOO_LONG' }
      });
    }

    // 8. Persist Incident with Initial Status REPORTED and Initial Audit Entry
    const incidentId = generateIncidentId();
    const now = new Date();

    const incident = await Incident.create({
      incidentId,
      category,
      subcategory: typeof subcategory === 'string' ? subcategory.trim() : '',
      severity: sevNum,
      victimCount: victims,
      description: cleanDesc,
      reporterName: cleanReporterName,
      reporterPhone: cleanReporterPhone,
      alternatePhone: cleanAlternatePhone,
      callerContact: cleanReporterPhone,
      locationName: locationName || '',
      latitude: latNum,
      longitude: lngNum,
      status: 'REPORTED',
      reportedBy: req.user._id,
      reportedAt: now,
      auditHistory: [
        {
          action: 'REPORTED',
          performedBy: req.user._id,
          performedAt: now,
          notes: 'Citizen initial report submission',
          previousStatus: null,
          newStatus: 'REPORTED'
        }
      ]
    });

    // Real-time operator notification broadcast (Phase 8.4)
    try {
      emitControlRoomNotification('NEW_EMERGENCY_REPORT', {
        incidentId: incident.incidentId,
        category: incident.category,
        subcategory: incident.subcategory,
        severity: incident.severity,
        victimCount: incident.victimCount,
        location: {
          latitude: incident.latitude,
          longitude: incident.longitude,
          locationName: incident.locationName || ''
        },
        address: incident.address || '',
        landmark: incident.landmark || '',
        reportedAt: incident.reportedAt
      });
    } catch (notifErr) {
      console.warn('[Notification] Failed to broadcast new emergency report:', notifErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Emergency incident reported successfully',
      data: {
        incident: {
          incidentId: incident.incidentId,
          category: incident.category,
          subcategory: incident.subcategory,
          severity: incident.severity,
          victimCount: incident.victimCount,
          status: incident.status,
          description: incident.description,
          reporterName: incident.reporterName,
          reporterPhone: incident.reporterPhone,
          locationName: incident.locationName || '',
          location: {
            latitude: incident.latitude,
            longitude: incident.longitude,
            locationName: incident.locationName || ''
          },
          reportedAt: incident.reportedAt,
          reportedBy: req.user._id.toString()
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Incident Detail View (GET /api/incidents/:incidentId).
 * Accessible by OPERATOR, ADMIN, or the citizen who reported the incident.
 */
export async function getIncidentById(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Incident detail is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const idNum = parseNumericIncidentId(req.params.incidentId);
    if (!idNum) {
      return res.status(400).json({
        success: false,
        message: 'Invalid incident ID. Must be a positive integer.',
        error: { code: 'INVALID_INCIDENT_ID', value: req.params.incidentId }
      });
    }

    const incident = await Incident.findOne({ incidentId: idNum })
      .populate('reportedBy', 'name email')
      .populate('verifiedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('verificationHistory.performedBy', 'name email role')
      .populate('callAttempts.performedBy', 'name email role')
      .populate('assignedResourceArrivals.arrivedBy', 'name email role')
      .populate('auditHistory.performedBy', 'name email role');

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident with ID ${idNum} not found`,
        error: { code: 'INCIDENT_NOT_FOUND', incidentId: idNum }
      });
    }

    // Authorization & Ownership Verification
    const isControlRoom = req.user.role === 'OPERATOR' || req.user.role === 'ADMIN';
    const reporterId = incident.reportedBy ? (incident.reportedBy._id ? incident.reportedBy._id.toString() : incident.reportedBy.toString()) : null;
    const callerId = req.user._id.toString();

    if (!isControlRoom && reporterId !== callerId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. You do not have permission to view this incident.',
        error: { code: 'FORBIDDEN' }
      });
    }

    // Build Response Object
    const baseData = {
      incidentId: incident.incidentId,
      category: incident.category,
      subcategory: incident.subcategory || '',
      severity: incident.severity,
      victimCount: incident.victimCount,
      status: incident.status,
      description: incident.description,
      reporterName: incident.reporterName || (incident.reportedBy ? incident.reportedBy.name : ''),
      locationName: incident.locationName || '',
      location: {
        latitude: incident.latitude,
        longitude: incident.longitude,
        locationName: incident.locationName || ''
      },
      reportedAt: incident.reportedAt,
      dispatchedAt: incident.dispatchedAt || null,
      arrivedAt: incident.arrivedAt || null,
      resolvedAt: incident.resolvedAt || null,
      createdAt: incident.createdAt
    };

    if (incident.status === 'VERIFIED') {
      baseData.verifiedAt = incident.verifiedAt;
      baseData.verificationNotes = incident.verificationNotes;
    }

    if (incident.status === 'REJECTED') {
      baseData.rejectedAt = incident.rejectedAt;
      baseData.rejectionReason = incident.rejectionReason;
    }

    // Citizen-safe status history progression
    const safeStatusHistory = [];
    if (incident.reportedAt) safeStatusHistory.push({ status: 'REPORTED', timestamp: incident.reportedAt });
    if (incident.verifiedAt) safeStatusHistory.push({ status: 'VERIFIED', timestamp: incident.verifiedAt });
    if (incident.dispatchedAt) safeStatusHistory.push({ status: 'DISPATCHED', timestamp: incident.dispatchedAt });
    if (incident.arrivedAt) safeStatusHistory.push({ status: 'ON_SCENE', timestamp: incident.arrivedAt });
    if (incident.resolvedAt) safeStatusHistory.push({ status: 'RESOLVED', timestamp: incident.resolvedAt });
    if (incident.rejectedAt) safeStatusHistory.push({ status: 'REJECTED', timestamp: incident.rejectedAt });
    baseData.statusHistory = safeStatusHistory;

    if (isControlRoom) {
      // Full Control Room Surveillance View - includes reporter contact and verification history
      baseData.reporterPhone = incident.reporterPhone || '';
      baseData.alternatePhone = incident.alternatePhone || '';
      baseData.latestVerificationOutcome = incident.latestVerificationOutcome || null;
      baseData.duplicateOfIncidentId = incident.duplicateOfIncidentId || null;
      baseData.verificationHistory = (incident.verificationHistory || []).map((v) => ({
        outcome: v.outcome,
        performedBy: v.performedBy
          ? { id: v.performedBy._id ? v.performedBy._id.toString() : v.performedBy, name: v.performedBy.name, role: v.performedBy.role }
          : null,
        performedAt: v.performedAt,
        notes: v.notes || '',
        relatedIncidentId: v.relatedIncidentId || null,
        previousStatus: v.previousStatus,
        resultingStatus: v.resultingStatus
      }));
      baseData.reportedBy = incident.reportedBy
        ? { id: incident.reportedBy._id.toString(), name: incident.reportedBy.name, email: incident.reportedBy.email }
        : null;
      baseData.verifiedBy = incident.verifiedBy
        ? { id: incident.verifiedBy._id.toString(), name: incident.verifiedBy.name, email: incident.verifiedBy.email }
        : null;
      baseData.rejectedBy = incident.rejectedBy
        ? { id: incident.rejectedBy._id.toString(), name: incident.rejectedBy.name, email: incident.rejectedBy.email }
        : null;
      baseData.dispatchedBy = incident.dispatchedBy
        ? { id: incident.dispatchedBy._id ? incident.dispatchedBy._id.toString() : incident.dispatchedBy }
        : null;
      baseData.arrivedBy = incident.arrivedBy
        ? { id: incident.arrivedBy._id ? incident.arrivedBy._id.toString() : incident.arrivedBy }
        : null;
      baseData.resolvedBy = incident.resolvedBy
        ? { id: incident.resolvedBy._id ? incident.resolvedBy._id.toString() : incident.resolvedBy }
        : null;
      baseData.dispatchId = incident.dispatchId || null;
      baseData.dispatchedBatchId = incident.dispatchedBatchId || null;
      baseData.assignedResourceIds = incident.assignedResourceIds || [];
      baseData.assignedHospitalId = incident.assignedHospitalId || null;

      let assignedHospital = null;
      if (incident.assignedHospitalId && (mongoose.connection.readyState === 1 || Hospital.findOne !== mongoose.Model.findOne)) {
        try {
          const h = await Hospital.findOne({ hospitalId: incident.assignedHospitalId })
            .select('hospitalId name')
            .lean();
          if (h) {
            assignedHospital = {
              hospitalId: h.hospitalId,
              hospitalName: h.name
            };
          }
        } catch (err) {
          console.warn('[GetIncidentById] Failed to query hospital:', err.message);
        }
      }
      baseData.assignedHospital = assignedHospital;

      baseData.arrivalVerificationMethod = incident.arrivalVerificationMethod || null;
      baseData.arrivalNotes = incident.arrivalNotes || '';
      baseData.callAttempts = (incident.callAttempts || []).map((c) => ({
        attemptId: c.attemptId,
        incidentId: c.incidentId,
        attemptedAt: c.attemptedAt,
        phoneCalled: c.phoneCalled,
        outcome: c.outcome,
        notes: c.notes || '',
        performedBy: c.performedBy
          ? { id: c.performedBy._id ? c.performedBy._id.toString() : c.performedBy, name: c.performedBy.name, role: c.performedBy.role }
          : null
      }));
      baseData.assignedResourceArrivals = (incident.assignedResourceArrivals || []).map((ra) => ({
        resourceId: ra.resourceId,
        resourceType: ra.resourceType,
        incidentId: ra.incidentId,
        status: ra.status,
        dispatchedAt: ra.dispatchedAt,
        arrivedAt: ra.arrivedAt,
        arrivedBy: ra.arrivedBy
          ? { id: ra.arrivedBy._id ? ra.arrivedBy._id.toString() : ra.arrivedBy, name: ra.arrivedBy.name, role: ra.arrivedBy.role }
          : null,
        verificationMethod: ra.verificationMethod || null,
        notes: ra.notes || ''
      }));
      baseData.allResourcesOnScene = incident.assignedResourceArrivals && incident.assignedResourceArrivals.length > 0
        ? incident.assignedResourceArrivals.every((ra) => ra.status === 'ON_SCENE')
        : incident.status === 'ON_SCENE';
      baseData.onSceneResourceCount = incident.assignedResourceArrivals
        ? incident.assignedResourceArrivals.filter((ra) => ra.status === 'ON_SCENE').length
        : (incident.status === 'ON_SCENE' ? (incident.assignedResourceIds?.length || 0) : 0);
      baseData.totalAssignedResourceCount = incident.assignedResourceIds ? incident.assignedResourceIds.length : 0;
      baseData.resolutionNotes = incident.resolutionNotes || '';
      baseData.priorityScore = incident.priorityScore;
      baseData.priorityTier = incident.priorityTier;
      baseData.auditHistory = (incident.auditHistory || []).map((a) => ({
        action: a.action,
        performedBy: a.performedBy
          ? { id: a.performedBy._id ? a.performedBy._id.toString() : a.performedBy, name: a.performedBy.name, role: a.performedBy.role }
          : null,
        performedAt: a.performedAt,
        notes: a.notes || undefined,
        reason: a.reason || undefined,
        previousStatus: a.previousStatus,
        newStatus: a.newStatus
      }));
    }

    return res.status(200).json({
      success: true,
      message: 'Incident details retrieved successfully',
      data: {
        incident: baseData
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Control-Room Incident Verification (PATCH /api/incidents/:incidentId/verify).
 * Restricted to OPERATOR and ADMIN roles.
 * Concurrency protected: atomic conditional update enforces current status is REPORTED.
 */
export async function verifyIncident(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Incident verification is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const idNum = parseNumericIncidentId(req.params.incidentId);
    if (!idNum) {
      return res.status(400).json({
        success: false,
        message: 'Invalid incident ID. Must be a positive integer.',
        error: { code: 'INVALID_INCIDENT_ID', value: req.params.incidentId }
      });
    }

    const rawNotes = req.body ? (req.body.verificationNotes !== undefined ? req.body.verificationNotes : req.body.notes) : '';
    if (rawNotes !== undefined && rawNotes !== null && typeof rawNotes !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Verification notes must be a string',
        error: { code: 'INVALID_VERIFICATION_NOTES' }
      });
    }

    const cleanNotes = typeof rawNotes === 'string' ? rawNotes.trim() : '';
    if (cleanNotes.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Verification notes cannot exceed 1000 characters',
        error: { code: 'VERIFICATION_NOTES_TOO_LONG' }
      });
    }

    const outcome = req.body && req.body.outcome ? String(req.body.outcome).toUpperCase().trim() : 'CONFIRMED';
    if (!VERIFICATION_OUTCOMES.includes(outcome)) {
      return res.status(400).json({
        success: false,
        message: `Invalid verification outcome '${outcome}'. Allowed values: ${VERIFICATION_OUTCOMES.join(', ')}`,
        error: { code: 'INVALID_VERIFICATION_OUTCOME', allowedOutcomes: VERIFICATION_OUTCOMES }
      });
    }

    let duplicateOfIncidentId = null;
    if (outcome === 'DUPLICATE') {
      const rawDupId = req.body.duplicateOfIncidentId || req.body.relatedIncidentId;
      duplicateOfIncidentId = parseNumericIncidentId(rawDupId);
      if (!duplicateOfIncidentId) {
        return res.status(400).json({
          success: false,
          message: 'A valid numeric duplicateOfIncidentId is required when marking an incident as duplicate',
          error: { code: 'MISSING_DUPLICATE_INCIDENT_ID' }
        });
      }
      if (duplicateOfIncidentId === idNum) {
        return res.status(400).json({
          success: false,
          message: 'An incident cannot be marked as a duplicate of itself',
          error: { code: 'INVALID_DUPLICATE_INCIDENT_ID' }
        });
      }
    }

    if (outcome === 'REJECTED') {
      if (!cleanNotes || cleanNotes.length < 3) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason is required (minimum 3 characters) when outcome is REJECTED',
          error: { code: 'INVALID_REJECTION_REASON' }
        });
      }
    }

    const now = new Date();

    // Determine target updates based on outcome
    let updateDoc = {};
    let resultingStatus = 'REPORTED';

    if (outcome === 'CONFIRMED') {
      resultingStatus = 'VERIFIED';
      updateDoc = {
        $set: {
          status: 'VERIFIED',
          verifiedBy: req.user._id,
          verifiedAt: now,
          verificationNotes: cleanNotes,
          latestVerificationOutcome: 'CONFIRMED'
        },
        $push: {
          verificationHistory: {
            outcome: 'CONFIRMED',
            performedBy: req.user._id,
            performedAt: now,
            notes: cleanNotes,
            previousStatus: 'REPORTED',
            resultingStatus: 'VERIFIED'
          },
          auditHistory: {
            action: 'VERIFIED',
            performedBy: req.user._id,
            performedAt: now,
            notes: cleanNotes,
            previousStatus: 'REPORTED',
            newStatus: 'VERIFIED'
          }
        }
      };
    } else if (outcome === 'UNABLE_TO_CONTACT') {
      const proceedWithDispatch = Boolean(req.body.proceedWithDispatch);
      resultingStatus = proceedWithDispatch ? 'VERIFIED' : 'REPORTED';

      const setFields = {
        latestVerificationOutcome: 'UNABLE_TO_CONTACT'
      };
      if (proceedWithDispatch) {
        setFields.status = 'VERIFIED';
        setFields.verifiedBy = req.user._id;
        setFields.verifiedAt = now;
        setFields.verificationNotes = cleanNotes;
      }

      const auditNotes = proceedWithDispatch
        ? `Reporter unreachable, but confirmed through alternate assessment / dispatched in parallel: ${cleanNotes}`.trim()
        : `Reporter unreachable on verification attempt: ${cleanNotes || 'Call unanswered'}`.trim();

      updateDoc = {
        $set: setFields,
        $push: {
          verificationHistory: {
            outcome: 'UNABLE_TO_CONTACT',
            performedBy: req.user._id,
            performedAt: now,
            notes: cleanNotes,
            previousStatus: 'REPORTED',
            resultingStatus
          },
          auditHistory: {
            action: resultingStatus === 'VERIFIED' ? 'VERIFIED' : 'REPORTED',
            performedBy: req.user._id,
            performedAt: now,
            notes: auditNotes,
            previousStatus: 'REPORTED',
            newStatus: resultingStatus
          }
        }
      };
    } else if (outcome === 'INFORMATION_REQUIRED') {
      resultingStatus = 'REPORTED';
      updateDoc = {
        $set: {
          latestVerificationOutcome: 'INFORMATION_REQUIRED'
        },
        $push: {
          verificationHistory: {
            outcome: 'INFORMATION_REQUIRED',
            performedBy: req.user._id,
            performedAt: now,
            notes: cleanNotes,
            previousStatus: 'REPORTED',
            resultingStatus: 'REPORTED'
          },
          auditHistory: {
            action: 'REPORTED',
            performedBy: req.user._id,
            performedAt: now,
            notes: `Additional information required: ${cleanNotes}`.trim(),
            previousStatus: 'REPORTED',
            newStatus: 'REPORTED'
          }
        }
      };
    } else if (outcome === 'REJECTED') {
      resultingStatus = 'REJECTED';
      updateDoc = {
        $set: {
          status: 'REJECTED',
          rejectedBy: req.user._id,
          rejectedAt: now,
          rejectionReason: cleanNotes,
          latestVerificationOutcome: 'REJECTED'
        },
        $push: {
          verificationHistory: {
            outcome: 'REJECTED',
            performedBy: req.user._id,
            performedAt: now,
            notes: cleanNotes,
            previousStatus: 'REPORTED',
            resultingStatus: 'REJECTED'
          },
          auditHistory: {
            action: 'REJECTED',
            performedBy: req.user._id,
            performedAt: now,
            reason: cleanNotes,
            previousStatus: 'REPORTED',
            newStatus: 'REJECTED'
          }
        }
      };
    } else if (outcome === 'DUPLICATE') {
      resultingStatus = 'REJECTED';
      const duplicateReason = `Duplicate of Incident #${duplicateOfIncidentId}${cleanNotes ? ': ' + cleanNotes : ''}`;
      updateDoc = {
        $set: {
          status: 'REJECTED',
          rejectedBy: req.user._id,
          rejectedAt: now,
          rejectionReason: duplicateReason,
          duplicateOfIncidentId,
          latestVerificationOutcome: 'DUPLICATE'
        },
        $push: {
          verificationHistory: {
            outcome: 'DUPLICATE',
            performedBy: req.user._id,
            performedAt: now,
            notes: cleanNotes,
            relatedIncidentId: duplicateOfIncidentId,
            previousStatus: 'REPORTED',
            resultingStatus: 'REJECTED'
          },
          auditHistory: {
            action: 'REJECTED',
            performedBy: req.user._id,
            performedAt: now,
            reason: duplicateReason,
            previousStatus: 'REPORTED',
            newStatus: 'REJECTED'
          }
        }
      };
    }

    // Atomic conditional update ensures concurrency safety
    const updated = await Incident.findOneAndUpdate(
      {
        incidentId: idNum,
        status: 'REPORTED'
      },
      updateDoc,
      {
        new: true
      }
    )
      .populate('reportedBy', 'name email')
      .populate('verifiedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('verificationHistory.performedBy', 'name email');

    if (!updated) {
      // Check if incident does not exist OR had an invalid transition status
      const existing = await Incident.findOne({ incidentId: idNum });
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: `Incident with ID ${idNum} not found`,
          error: { code: 'INCIDENT_NOT_FOUND', incidentId: idNum }
        });
      }

      return res.status(409).json({
        success: false,
        message: `Cannot record verification for incident with status '${existing.status}'. Only incidents in REPORTED status can be verified.`,
        error: {
          code: 'INCIDENT_STATE_CONFLICT',
          incidentId: idNum,
          currentStatus: existing.status,
          requiredStatus: 'REPORTED'
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: outcome === 'CONFIRMED'
        ? 'Incident verified successfully'
        : `Verification outcome '${outcome}' recorded successfully`,
      data: {
        incident: {
          incidentId: updated.incidentId,
          category: updated.category,
          severity: updated.severity,
          victimCount: updated.victimCount,
          status: updated.status,
          description: updated.description,
          location: {
            latitude: updated.latitude,
            longitude: updated.longitude
          },
          reportedAt: updated.reportedAt,
          verifiedAt: updated.verifiedAt,
          verifiedBy: updated.verifiedBy
            ? {
                id: updated.verifiedBy._id ? updated.verifiedBy._id.toString() : updated.verifiedBy.toString(),
                name: updated.verifiedBy.name || 'Operator',
                email: updated.verifiedBy.email || ''
              }
            : null,
          verificationNotes: updated.verificationNotes,
          latestVerificationOutcome: updated.latestVerificationOutcome,
          duplicateOfIncidentId: updated.duplicateOfIncidentId,
          verificationHistory: updated.verificationHistory
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Control-Room Incident Rejection (PATCH /api/incidents/:incidentId/reject).
 * Restricted to OPERATOR and ADMIN roles.
 * Concurrency protected: atomic conditional update enforces current status is REPORTED.
 */
export async function rejectIncident(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Incident rejection is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const idNum = parseNumericIncidentId(req.params.incidentId);
    if (!idNum) {
      return res.status(400).json({
        success: false,
        message: 'Invalid incident ID. Must be a positive integer.',
        error: { code: 'INVALID_INCIDENT_ID', value: req.params.incidentId }
      });
    }

    const rawReason = req.body ? req.body.rejectionReason : null;
    if (!rawReason || typeof rawReason !== 'string' || rawReason.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required and must be at least 3 characters long',
        error: { code: 'INVALID_REJECTION_REASON' }
      });
    }

    const cleanReason = rawReason.trim();
    if (cleanReason.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason cannot exceed 1000 characters',
        error: { code: 'REJECTION_REASON_TOO_LONG' }
      });
    }

    const now = new Date();

    // Atomic conditional update ensures concurrency safety
    const updated = await Incident.findOneAndUpdate(
      {
        incidentId: idNum,
        status: 'REPORTED'
      },
      {
        $set: {
          status: 'REJECTED',
          rejectedBy: req.user._id,
          rejectedAt: now,
          rejectionReason: cleanReason,
          latestVerificationOutcome: 'REJECTED'
        },
        $push: {
          verificationHistory: {
            outcome: 'REJECTED',
            performedBy: req.user._id,
            performedAt: now,
            notes: cleanReason,
            previousStatus: 'REPORTED',
            resultingStatus: 'REJECTED'
          },
          auditHistory: {
            action: 'REJECTED',
            performedBy: req.user._id,
            performedAt: now,
            reason: cleanReason,
            previousStatus: 'REPORTED',
            newStatus: 'REJECTED'
          }
        }
      },
      {
        new: true
      }
    )
      .populate('reportedBy', 'name email')
      .populate('rejectedBy', 'name email');

    if (!updated) {
      // Check if incident does not exist OR had an invalid transition status
      const existing = await Incident.findOne({ incidentId: idNum });
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: `Incident with ID ${idNum} not found`,
          error: { code: 'INCIDENT_NOT_FOUND', incidentId: idNum }
        });
      }

      return res.status(409).json({
        success: false,
        message: `Cannot reject incident with status '${existing.status}'. Only incidents in REPORTED status can be rejected.`,
        error: {
          code: 'INCIDENT_STATE_CONFLICT',
          incidentId: idNum,
          currentStatus: existing.status,
          requiredStatus: 'REPORTED'
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Incident rejected successfully',
      data: {
        incident: {
          incidentId: updated.incidentId,
          category: updated.category,
          severity: updated.severity,
          victimCount: updated.victimCount,
          status: updated.status,
          description: updated.description,
          location: {
            latitude: updated.latitude,
            longitude: updated.longitude
          },
          reportedAt: updated.reportedAt,
          rejectedAt: updated.rejectedAt,
          rejectedBy: updated.rejectedBy
            ? { id: updated.rejectedBy._id.toString(), name: updated.rejectedBy.name, email: updated.rejectedBy.email }
            : null,
          rejectionReason: updated.rejectionReason
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Citizen Incident History (GET /api/incidents/my).
 * Returns only reports submitted by the authenticated citizen with status and verification visibility.
 */
export async function getMyIncidents(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Incident history is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    // Parse pagination parameters
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10) || 10));
    const skip = (page - 1) * limit;

    // Query strictly restricted to authenticated user's ID
    const query = { reportedBy: req.user._id };

    const [totalCount, incidents] = await Promise.all([
      Incident.countDocuments(query),
      Incident.find(query)
        .sort({ createdAt: -1, incidentId: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    const formattedIncidents = incidents.map((inc) => {
      const item = {
        incidentId: inc.incidentId,
        category: inc.category,
        subcategory: inc.subcategory || '',
        severity: inc.severity,
        victimCount: inc.victimCount,
        status: inc.status,
        description: inc.description,
        locationName: inc.locationName || '',
        location: {
          latitude: inc.latitude,
          longitude: inc.longitude,
          locationName: inc.locationName || ''
        },
        priorityScore: inc.priorityScore,
        priorityTier: inc.priorityTier,
        reportedAt: inc.reportedAt,
        dispatchedAt: inc.dispatchedAt || null,
        arrivedAt: inc.arrivedAt || null,
        resolvedAt: inc.resolvedAt || null,
        createdAt: inc.createdAt
      };

      if (inc.status === 'VERIFIED') {
        item.verifiedAt = inc.verifiedAt;
        item.verificationNotes = inc.verificationNotes || '';
      }

      if (inc.status === 'REJECTED') {
        item.rejectedAt = inc.rejectedAt;
        item.rejectionReason = inc.rejectionReason || '';
      }

      return item;
    });

    return res.status(200).json({
      success: true,
      message: 'Citizen incident history retrieved successfully',
      data: {
        incidents: formattedIncidents,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit) || 1
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Operator Incident Registry View (GET /api/incidents).
 * Returns paginated incident list with multi-parameter filtering for OPERATOR and ADMIN roles.
 */
export async function listIncidents(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Incident list is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const query = {};

    // 1. Category Filter
    if (req.query.category) {
      if (!EMERGENCY_CATEGORIES.includes(req.query.category)) {
        return res.status(400).json({
          success: false,
          message: `Invalid category filter: ${req.query.category}`,
          error: { code: 'INVALID_CATEGORY_FILTER', allowedCategories: EMERGENCY_CATEGORIES }
        });
      }
      query.category = req.query.category;
    }

    // 2. Status Filter
    if (req.query.status) {
      if (!INCIDENT_STATUSES.includes(req.query.status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status filter: ${req.query.status}`,
          error: { code: 'INVALID_STATUS_FILTER', allowedStatuses: INCIDENT_STATUSES }
        });
      }
      query.status = req.query.status;
    }

    // 3. Severity Filter
    if (req.query.severity !== undefined && req.query.severity !== null && req.query.severity !== '') {
      const sev = Number(req.query.severity);
      if (!Number.isInteger(sev) || sev < 1 || sev > 5) {
        return res.status(400).json({
          success: false,
          message: `Invalid severity filter: ${req.query.severity}. Must be an integer between 1 and 5.`,
          error: { code: 'INVALID_SEVERITY_FILTER', value: req.query.severity }
        });
      }
      query.severity = sev;
    }

    // 4. Incident ID Exact Search
    if (req.query.incidentId !== undefined && req.query.incidentId !== null && req.query.incidentId !== '') {
      const searchId = parseNumericIncidentId(req.query.incidentId);
      if (!searchId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid incidentId filter. Must be a positive integer.',
          error: { code: 'INVALID_INCIDENT_ID_FILTER', value: req.query.incidentId }
        });
      }
      query.incidentId = searchId;
    }

    // 5. Date Range Filters (createdAt / reportedAt)
    const startDateRaw = req.query.startDate || req.query.from;
    const endDateRaw = req.query.endDate || req.query.to;

    if (startDateRaw || endDateRaw) {
      query.createdAt = {};
      if (startDateRaw) {
        const startParsed = new Date(startDateRaw);
        if (isNaN(startParsed.getTime())) {
          return res.status(400).json({
            success: false,
            message: `Invalid startDate format: ${startDateRaw}. Expected valid ISO date.`,
            error: { code: 'INVALID_DATE_FILTER', field: 'startDate' }
          });
        }
        query.createdAt.$gte = startParsed;
      }
      if (endDateRaw) {
        const endParsed = new Date(endDateRaw);
        if (isNaN(endParsed.getTime())) {
          return res.status(400).json({
            success: false,
            message: `Invalid endDate format: ${endDateRaw}. Expected valid ISO date.`,
            error: { code: 'INVALID_DATE_FILTER', field: 'endDate' }
          });
        }
        query.createdAt.$lte = endParsed;
      }
    }

    // 6. Pagination Validation
    const pageParam = req.query.page;
    const limitParam = req.query.limit;

    if (pageParam !== undefined && pageParam !== null && pageParam !== '') {
      const p = Number(pageParam);
      if (!Number.isInteger(p) || p < 1) {
        return res.status(400).json({
          success: false,
          message: `Invalid page parameter: ${pageParam}. Must be a positive integer.`,
          error: { code: 'INVALID_PAGINATION', field: 'page' }
        });
      }
    }

    if (limitParam !== undefined && limitParam !== null && limitParam !== '') {
      const l = Number(limitParam);
      if (!Number.isInteger(l) || l < 1 || l > 100) {
        return res.status(400).json({
          success: false,
          message: `Invalid limit parameter: ${limitParam}. Must be an integer between 1 and 100.`,
          error: { code: 'INVALID_PAGINATION', field: 'limit' }
        });
      }
    }

    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    const skip = (page - 1) * limit;

    // 7. Deterministic Sorting
    const allowedSortFields = ['createdAt', 'severity', 'incidentId', 'reportedAt'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sortObj = { [sortBy]: sortOrder, incidentId: sortOrder };

    const [totalCount, incidents] = await Promise.all([
      Incident.countDocuments(query),
      Incident.find(query)
        .populate('reportedBy', 'name email')
        .populate('verifiedBy', 'name email')
        .populate('rejectedBy', 'name email')
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    // Bulk query for unique assigned hospital IDs
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
        console.warn('[ListIncidents] Failed to query hospitals:', err.message);
      }
    }

    const formattedIncidents = incidents.map((inc) => ({
      incidentId: inc.incidentId,
      category: inc.category,
      subcategory: inc.subcategory || '',
      severity: inc.severity,
      victimCount: inc.victimCount,
      status: inc.status,
      description: inc.description,
      locationName: inc.locationName || '',
      location: {
        latitude: inc.latitude,
        longitude: inc.longitude,
        locationName: inc.locationName || ''
      },
      priorityScore: inc.priorityScore,
      priorityTier: inc.priorityTier,
      reporterName: inc.reporterName || (inc.reportedBy ? inc.reportedBy.name : ''),
      reporterPhone: inc.reporterPhone || '',
      latestVerificationOutcome: inc.latestVerificationOutcome || null,
      duplicateOfIncidentId: inc.duplicateOfIncidentId || null,
      assignedHospitalId: inc.assignedHospitalId || null,
      assignedHospital: inc.assignedHospitalId && hospitalMap.has(inc.assignedHospitalId)
        ? {
            hospitalId: hospitalMap.get(inc.assignedHospitalId).hospitalId,
            hospitalName: hospitalMap.get(inc.assignedHospitalId).name
          }
        : null,
      reportedBy: inc.reportedBy
        ? { id: inc.reportedBy._id ? inc.reportedBy._id.toString() : inc.reportedBy, name: inc.reportedBy.name, email: inc.reportedBy.email }
        : null,
      verifiedBy: inc.verifiedBy
        ? { id: inc.verifiedBy._id ? inc.verifiedBy._id.toString() : inc.verifiedBy, name: inc.verifiedBy.name, email: inc.verifiedBy.email }
        : null,
      verifiedAt: inc.verifiedAt || null,
      verificationNotes: inc.verificationNotes || '',
      rejectedBy: inc.rejectedBy
        ? { id: inc.rejectedBy._id ? inc.rejectedBy._id.toString() : inc.rejectedBy, name: inc.rejectedBy.name, email: inc.rejectedBy.email }
        : null,
      rejectedAt: inc.rejectedAt || null,
      rejectionReason: inc.rejectionReason || '',
      reportedAt: inc.reportedAt,
      createdAt: inc.createdAt
    }));

    return res.status(200).json({
      success: true,
      message: 'Incident registry retrieved successfully',
      data: {
        incidents: formattedIncidents,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit) || 1
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Get incident statistics using MongoDB aggregation (GET /api/incidents/stats).
 * Computes global counts across all statuses for control room dashboard without document pagination.
 * Roles: OPERATOR, ADMIN
 */
export async function getIncidentStats(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Incident statistics are temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const aggregation = await Incident.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const byStatus = {};
    let totalIncidents = 0;

    for (const group of aggregation) {
      if (group && group._id) {
        byStatus[group._id] = group.count;
        totalIncidents += group.count;
      }
    }

    const pendingReported = byStatus.REPORTED || 0;
    const verifiedCount = byStatus.VERIFIED || 0;
    const rejectedCount = byStatus.REJECTED || 0;
    const allocatedCount = byStatus.ALLOCATED || 0;
    const dispatchedCount = byStatus.DISPATCHED || 0;
    const onSceneCount = byStatus.ON_SCENE || 0;
    const resolvedCount = byStatus.RESOLVED || 0;
    const cancelledCount = byStatus.CANCELLED || 0;

    const activeIncidents = pendingReported + verifiedCount + allocatedCount + dispatchedCount + onSceneCount;

    return res.status(200).json({
      success: true,
      message: 'Incident statistics retrieved successfully',
      data: {
        totalIncidents,
        pendingReported,
        verifiedCount,
        rejectedCount,
        allocatedCount,
        dispatchedCount,
        onSceneCount,
        resolvedCount,
        cancelledCount,
        activeIncidents,
        byStatus
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Mark emergency units (or a specific resource) as arrived on scene (PATCH /api/incidents/:incidentId/arrive).
 * Supports individual per-resource arrival and verification methods (RADIO, PHONE, MANUAL).
 * Roles: OPERATOR, ADMIN
 */
export async function arriveIncident(req, res, next) {
  try {
    const rawNotes = req.body ? (req.body.notes || req.body.arrivalNotes || '') : '';
    const resourceId = req.params.resourceId || (req.body ? req.body.resourceId : undefined);
    const verificationMethod = req.body ? req.body.verificationMethod : undefined;

    const result = await markSceneArrival(req.params.incidentId, req.user, {
      resourceId,
      verificationMethod,
      notes: rawNotes
    });

    return res.status(200).json({
      success: true,
      message: resourceId
        ? `Resource #${resourceId} marked arrived on scene successfully`
        : 'Emergency response units marked arrived on scene successfully',
      data: result
    });
  } catch (err) {
    if (err instanceof IncidentTrackingError) {
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message,
        error: {
          code: err.code,
          details: err.details
        }
      });
    }
    next(err);
  }
}

/**
 * Controller: Record a manual call attempt to reporter (POST /api/incidents/:incidentId/call-attempts).
 * Roles: OPERATOR, ADMIN
 */
export async function recordCallAttemptController(req, res, next) {
  try {
    const result = await executeRecordCallAttempt(req.params.incidentId, req.user, req.body || {});
    return res.status(201).json({
      success: true,
      message: 'Call attempt recorded successfully',
      callAttempt: result.callAttempt,
      data: result
    });
  } catch (err) {
    if (err instanceof IncidentTrackingError) {
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message,
        error: {
          code: err.code,
          details: err.details
        }
      });
    }
    next(err);
  }
}

/**
 * Controller: Retrieve manual call attempts for an incident (GET /api/incidents/:incidentId/call-attempts).
 * Roles: OPERATOR, ADMIN
 */
export async function getCallAttemptsController(req, res, next) {
  try {
    const result = await executeGetCallAttempts(req.params.incidentId);
    return res.status(200).json({
      success: true,
      message: 'Call attempts retrieved successfully',
      callAttempts: result.callAttempts || [],
      data: result
    });
  } catch (err) {
    if (err instanceof IncidentTrackingError) {
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message,
        error: {
          code: err.code,
          details: err.details
        }
      });
    }
    next(err);
  }
}

/**
 * Controller: Resolve an active incident (PATCH /api/incidents/:incidentId/resolve).
 * Restricts transition strictly to ON_SCENE -> RESOLVED.
 * Atomically releases assigned resources back to AVAILABLE and restores reserved hospital beds.
 * Roles: OPERATOR, ADMIN
 */
export async function resolveIncidentController(req, res, next) {
  try {
    const rawNotes = req.body ? req.body.resolutionNotes : '';
    const result = await executeResolveIncident(req.params.incidentId, req.user, {
      resolutionNotes: rawNotes
    });

    return res.status(200).json({
      success: true,
      message: 'Incident resolved and assigned resources released successfully',
      data: result
    });
  } catch (err) {
    if (err instanceof IncidentTrackingError) {
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message,
        error: {
          code: err.code,
          details: err.details
        }
      });
    }
    next(err);
  }
}

export const resolveIncident = resolveIncidentController;

/**
 * Controller: Retrieve active dispatched and on-scene incidents (GET /api/incidents/active).
 * Roles: OPERATOR, ADMIN
 */
export async function getActiveIncidentsController(req, res, next) {
  try {
    const result = await fetchActiveIncidents(req.query);

    return res.status(200).json({
      success: true,
      message: 'Active incidents retrieved successfully',
      data: result
    });
  } catch (err) {
    if (err instanceof IncidentTrackingError) {
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message,
        error: {
          code: err.code,
          details: err.details
        }
      });
    }
    next(err);
  }
}

export const getActiveIncidents = getActiveIncidentsController;
export const recordCallAttempt = recordCallAttemptController;
export const getCallAttempts = getCallAttemptsController;

export default {
  createIncident,
  getIncidentById,
  verifyIncident,
  rejectIncident,
  getMyIncidents,
  listIncidents,
  getIncidentStats,
  arriveIncident,
  resolveIncident: resolveIncidentController,
  resolveIncidentController,
  getActiveIncidents: getActiveIncidentsController,
  getActiveIncidentsController,
  recordCallAttempt: recordCallAttemptController,
  getCallAttempts: getCallAttemptsController
};
