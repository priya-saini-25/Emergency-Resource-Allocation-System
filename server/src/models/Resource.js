import mongoose from 'mongoose';

const { Schema } = mongoose;

export const RESOURCE_TYPES = [
  'ALS_AMBULANCE',
  'BLS_AMBULANCE',
  'FIRE_ENGINE',
  'FIRE_TENDER',
  'RESCUE_VEHICLE'
];

export const RESOURCE_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'DISPATCHED',
  'ON_SCENE',
  'OUT_OF_SERVICE'
];

const resourceSchema = new Schema(
  {
    resourceId: {
      type: Number,
      required: [true, 'Resource ID is required'],
      unique: true,
      min: [1, 'Resource ID must be a positive integer']
    },
    name: {
      type: String,
      trim: true,
      default: function () {
        return `Resource-${this.resourceId}`;
      }
    },
    resourceType: {
      type: String,
      required: [true, 'Resource type is required'],
      enum: {
        values: RESOURCE_TYPES,
        message: '{VALUE} is not a supported resource type'
      }
    },
    status: {
      type: String,
      enum: {
        values: RESOURCE_STATUSES,
        message: '{VALUE} is not a valid resource status'
      },
      default: 'AVAILABLE'
    },
    capacity: {
      type: Number,
      default: 1,
      min: [1, 'Capacity must be at least 1']
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
    currentNodeOsmId: {
      type: Number,
      default: null
    },
    assignedIncidentId: {
      type: Number,
      default: null
    },
    assignedBatchId: {
      type: String,
      trim: true,
      default: null
    },
    assignedDispatchId: {
      type: String,
      trim: true,
      default: null
    },
    reservedAt: {
      type: Date,
      default: null
    },
    dispatchedAt: {
      type: Date,
      default: null
    },
    // Phase 8.2: Scene Arrival Tracking
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
      enum: ['RADIO', 'PHONE', 'MANUAL', null],
      default: null
    },
    arrivalNotes: {
      type: String,
      trim: true,
      default: ''
    },
    stationId: {
      type: String,
      trim: true,
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for geographic & availability queries
resourceSchema.index({ status: 1, resourceType: 1 });
resourceSchema.index({ latitude: 1, longitude: 1 });
resourceSchema.index({ assignedIncidentId: 1 });
resourceSchema.index({ assignedDispatchId: 1 });

/**
 * Transforms Mongoose document to C++ engine JSON protocol representation.
 */
resourceSchema.methods.toEngineProtocol = function () {
  return {
    resource_id: this.resourceId,
    resource_type: this.resourceType,
    status: this.status,
    capacity: this.capacity,
    latitude: this.latitude,
    longitude: this.longitude,
    current_node_osm_id: this.currentNodeOsmId || 0
  };
};

export const Resource = mongoose.model('Resource', resourceSchema);
export default Resource;

