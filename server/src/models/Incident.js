import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

const { Schema } = mongoose;

export const EMERGENCY_CATEGORIES = [
  'MEDICAL',
  'MEDICAL_EMERGENCY',
  'FIRE',
  'ROAD_ACCIDENT',
  'INDUSTRIAL',
  'STRUCTURAL_COLLAPSE',
  'HAZMAT',
  'NATURAL_DISASTER',
  'CIVIL_DISTURBANCE',
  'OTHER'
];

export const INCIDENT_STATUSES = [
  'REPORTED',
  'VERIFIED',
  'QUEUED',
  'ALLOCATED',
  'DISPATCHED',
  'ON_SCENE',
  'RESOLVED',
  'REJECTED',
  'CANCELLED'
];

export const PRIORITY_TIERS = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'UNKNOWN'
];

export const VERIFICATION_OUTCOMES = [
  'CONFIRMED',
  'UNABLE_TO_CONTACT',
  'INFORMATION_REQUIRED',
  'REJECTED',
  'DUPLICATE'
];

export const CALL_ATTEMPT_OUTCOMES = [
  'ANSWERED',
  'NO_ANSWER',
  'BUSY',
  'UNREACHABLE',
  'INVALID_NUMBER'
];

export const ARRIVAL_VERIFICATION_METHODS = ['RADIO', 'PHONE', 'MANUAL'];

const callAttemptSchema = new Schema(
  {
    attemptId: {
      type: String,
      default: () => `CALL-${Date.now()}-${randomUUID().slice(0, 8)}`
    },
    incidentId: {
      type: Number,
      required: true
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    attemptedAt: {
      type: Date,
      default: Date.now
    },
    phoneCalled: {
      type: String,
      trim: true,
      default: ''
    },
    outcome: {
      type: String,
      required: true,
      enum: CALL_ATTEMPT_OUTCOMES
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    }
  },
  { _id: false }
);

const resourceArrivalTrackingSchema = new Schema(
  {
    resourceId: {
      type: Number,
      required: true
    },
    resourceType: {
      type: String,
      required: true
    },
    incidentId: {
      type: Number,
      required: true
    },
    status: {
      type: String,
      enum: ['DISPATCHED', 'ON_SCENE'],
      default: 'DISPATCHED'
    },
    dispatchedAt: {
      type: Date,
      default: null
    },
    arrivedAt: {
      type: Date,
      default: null
    },
    arrivedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    verificationMethod: {
      type: String,
      enum: [...ARRIVAL_VERIFICATION_METHODS, null],
      default: null
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    }
  },
  { _id: false }
);

const verificationEntrySchema = new Schema(
  {
    outcome: {
      type: String,
      required: true,
      enum: VERIFICATION_OUTCOMES
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    performedAt: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    relatedIncidentId: {
      type: Number,
      default: null
    },
    previousStatus: {
      type: String,
      default: null
    },
    resultingStatus: {
      type: String,
      default: null
    }
  },
  { _id: false }
);

const auditEntrySchema = new Schema(
  {
    action: {
      type: String,
      required: true,
      enum: INCIDENT_STATUSES
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    performedAt: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    reason: {
      type: String,
      trim: true,
      default: ''
    },
    previousStatus: {
      type: String,
      default: null
    },
    newStatus: {
      type: String,
      default: null
    }
  },
  { _id: false }
);

const incidentSchema = new Schema(
  {
    incidentId: {
      type: Number,
      required: [true, 'Incident ID is required'],
      unique: true,
      min: [1, 'Incident ID must be a positive integer']
    },
    category: {
      type: String,
      required: [true, 'Emergency category is required'],
      enum: {
        values: EMERGENCY_CATEGORIES,
        message: '{VALUE} is not a valid emergency category'
      }
    },
    subcategory: {
      type: String,
      trim: true,
      default: ''
    },
    severity: {
      type: Number,
      required: [true, 'Severity is required'],
      min: [1, 'Severity must be at least 1'],
      max: [5, 'Severity cannot exceed 5'],
      validate: {
        validator: Number.isInteger,
        message: 'Severity must be an integer between 1 and 5'
      }
    },
    victimCount: {
      type: Number,
      default: 0,
      min: [0, 'Victim count cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Victim count must be an integer'
      }
    },
    status: {
      type: String,
      enum: {
        values: INCIDENT_STATUSES,
        message: '{VALUE} is not a valid incident status'
      },
      default: 'REPORTED'
    },
    latitude: {
      type: Number,
      required: [true, 'Latitude is required'],
      min: [-90, 'Latitude cannot be less than -90'],
      max: [90, 'Latitude cannot be greater than 90'],
      validate: {
        validator: Number.isFinite,
        message: 'Latitude must be a finite number'
      }
    },
    longitude: {
      type: Number,
      required: [true, 'Longitude is required'],
      min: [-180, 'Longitude cannot be less than -180'],
      max: [180, 'Longitude cannot be greater than 180'],
      validate: {
        validator: Number.isFinite,
        message: 'Longitude must be a finite number'
      }
    },
    incidentNodeOsmId: {
      type: Number,
      default: null
    },
    locationName: {
      type: String,
      trim: true,
      default: ''
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    callerContact: {
      type: String,
      trim: true,
      default: ''
    },
    // Phase 8.1: Citizen Reporter Information
    reporterName: {
      type: String,
      trim: true,
      default: ''
    },
    reporterPhone: {
      type: String,
      trim: true,
      default: ''
    },
    alternatePhone: {
      type: String,
      trim: true,
      default: ''
    },
    reportedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    reportedAt: {
      type: Date,
      default: Date.now
    },
    // Verification Metadata
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    verifiedAt: {
      type: Date,
      default: null
    },
    verificationNotes: {
      type: String,
      trim: true,
      default: ''
    },
    // Phase 8.1: Structured Verification Tracking
    latestVerificationOutcome: {
      type: String,
      enum: [...VERIFICATION_OUTCOMES, null],
      default: null
    },
    duplicateOfIncidentId: {
      type: Number,
      default: null
    },
    verificationHistory: [verificationEntrySchema],
    // Phase 8.2: Call Attempt Logging History
    callAttempts: [callAttemptSchema],
    // Rejection Metadata
    rejectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    rejectedAt: {
      type: Date,
      default: null
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: ''
    },
    // Dispatch Confirmation Metadata
    dispatchedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    dispatchedAt: {
      type: Date,
      default: null
    },
    dispatchedBatchId: {
      type: String,
      trim: true,
      default: null
    },
    dispatchId: {
      type: String,
      trim: true,
      default: null
    },
    assignedResourceIds: [
      {
        type: Number
      }
    ],
    assignedHospitalId: {
      type: Number,
      default: null
    },
    // Phase 8.2: Per-Resource Arrival Tracking
    assignedResourceArrivals: [resourceArrivalTrackingSchema],
    arrivalVerificationMethod: {
      type: String,
      enum: [...ARRIVAL_VERIFICATION_METHODS, null],
      default: null
    },
    arrivalNotes: {
      type: String,
      trim: true,
      default: ''
    },
    // Phase 4.6 Scene Arrival & Resolution Metadata
    arrivedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    arrivedAt: {
      type: Date,
      default: null
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    resolvedAt: {
      type: Date,
      default: null
    },
    resolutionNotes: {
      type: String,
      trim: true,
      default: ''
    },
    // Audit History Trail
    auditHistory: [auditEntrySchema],
    priorityScore: {
      type: Number,
      default: null
    },
    priorityTier: {
      type: String,
      enum: PRIORITY_TIERS,
      default: 'UNKNOWN'
    },
    resourceDemands: [
      {
        type: {
          type: String,
          required: true
        },
        quantity: {
          type: Number,
          required: true,
          min: 1
        }
      }
    ],
    hospitalRequirements: {
      requiredCapabilities: [{ type: String }],
      requiredIcuBeds: { type: Number, default: 0, min: 0 },
      requiredGeneralBeds: { type: Number, default: 0, min: 0 },
      requiredOxygenBeds: { type: Number, default: 0, min: 0 }
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Database Indexes for Fast Operator and Citizen Queries
incidentSchema.index({ status: 1, createdAt: -1 });
incidentSchema.index({ category: 1, status: 1, severity: 1 });
incidentSchema.index({ reportedBy: 1, createdAt: -1 });
incidentSchema.index({ priorityTier: 1 });
incidentSchema.index({ latitude: 1, longitude: 1 });
incidentSchema.index({ createdAt: -1 });

/**
 * Virtual location getter and setter to support GeoJSON-like { location: { latitude, longitude, locationName } } structures.
 */
incidentSchema.virtual('location').get(function () {
  return {
    latitude: this.latitude,
    longitude: this.longitude,
    locationName: this.locationName || ''
  };
}).set(function (loc) {
  if (loc && typeof loc === 'object') {
    if (loc.latitude !== undefined) this.latitude = loc.latitude;
    if (loc.longitude !== undefined) this.longitude = loc.longitude;
    if (loc.locationName !== undefined) this.locationName = loc.locationName;
    else if (loc.name !== undefined) this.locationName = loc.name;
  }
});

/**
 * Transforms Mongoose incident document to C++ engine JSON protocol representation.
 */
incidentSchema.methods.toEngineProtocol = function () {
  const payload = {
    incident_id: this.incidentId,
    category: this.category === 'MEDICAL_EMERGENCY' ? 'MEDICAL' : this.category,
    severity: this.severity,
    victim_count: this.victimCount,
    created_at_ms: this.reportedAt ? new Date(this.reportedAt).getTime() : Date.now(),
    latitude: this.latitude,
    longitude: this.longitude,
    incident_node_osm_id: this.incidentNodeOsmId || 0
  };

  if (this.resourceDemands && this.resourceDemands.length > 0) {
    payload.resource_demands = this.resourceDemands.map((d) => ({
      type: d.type,
      quantity: d.quantity
    }));
  }

  if (this.hospitalRequirements && (
    (this.hospitalRequirements.requiredCapabilities && this.hospitalRequirements.requiredCapabilities.length > 0) ||
    this.hospitalRequirements.requiredIcuBeds > 0 ||
    this.hospitalRequirements.requiredGeneralBeds > 0 ||
    this.hospitalRequirements.requiredOxygenBeds > 0
  )) {
    payload.hospital_requirements = {
      required_capabilities: this.hospitalRequirements.requiredCapabilities || [],
      required_icu_beds: this.hospitalRequirements.requiredIcuBeds || 0,
      required_general_beds: this.hospitalRequirements.requiredGeneralBeds || 0,
      required_oxygen_beds: this.hospitalRequirements.requiredOxygenBeds || 0
    };
  }

  return payload;
};

export const Incident = mongoose.model('Incident', incidentSchema);
export default Incident;
