import mongoose from 'mongoose';

const { Schema } = mongoose;

export const HOSPITAL_STATUSES = [
  'OPERATIONAL',
  'TEMPORARILY_UNAVAILABLE',
  'CLOSED'
];

export const HOSPITAL_CAPABILITIES = [
  'GENERAL_EMERGENCY',
  'TRAUMA',
  'ICU',
  'OXYGEN_SUPPORT',
  'BURN_TREATMENT',
  'SURGICAL_SUPPORT'
];

const bedCategorySchema = new Schema(
  {
    total: {
      type: Number,
      default: 0,
      min: [0, 'Total beds cannot be negative']
    },
    available: {
      type: Number,
      default: 0,
      min: [0, 'Available beds cannot be negative'],
      validate: {
        validator: function (val) {
          return val <= this.total;
        },
        message: 'Available beds ({VALUE}) cannot exceed total beds'
      }
    }
  },
  { _id: false }
);

const hospitalSchema = new Schema(
  {
    hospitalId: {
      type: Number,
      required: [true, 'Hospital ID is required'],
      unique: true,
      min: [1, 'Hospital ID must be a positive integer']
    },
    name: {
      type: String,
      required: [true, 'Hospital name is required'],
      trim: true
    },
    status: {
      type: String,
      enum: {
        values: HOSPITAL_STATUSES,
        message: '{VALUE} is not a valid hospital status'
      },
      default: 'OPERATIONAL'
    },
    capabilities: [
      {
        type: String,
        enum: {
          values: HOSPITAL_CAPABILITIES,
          message: '{VALUE} is not a recognized hospital capability'
        }
      }
    ],
    icuBeds: {
      type: bedCategorySchema,
      default: () => ({ total: 10, available: 5 })
    },
    generalBeds: {
      type: bedCategorySchema,
      default: () => ({ total: 50, available: 20 })
    },
    oxygenBeds: {
      type: bedCategorySchema,
      default: () => ({ total: 20, available: 10 })
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
    nodeOsmId: {
      type: Number,
      default: null
    },
    contactPhone: {
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

hospitalSchema.index({ status: 1 });
hospitalSchema.index({ latitude: 1, longitude: 1 });

/**
 * Transforms Mongoose hospital document to C++ engine JSON protocol representation.
 */
hospitalSchema.methods.toEngineProtocol = function () {
  return {
    hospital_id: this.hospitalId,
    hospital_name: this.name,
    status: this.status,
    capabilities: this.capabilities,
    icu_beds_total: this.icuBeds?.total || 0,
    icu_beds_available: this.icuBeds?.available || 0,
    available_icu_beds: this.icuBeds?.available || 0,
    general_beds_total: this.generalBeds?.total || 0,
    general_beds_available: this.generalBeds?.available || 0,
    available_general_beds: this.generalBeds?.available || 0,
    oxygen_beds_total: this.oxygenBeds?.total || 0,
    oxygen_beds_available: this.oxygenBeds?.available || 0,
    available_oxygen_beds: this.oxygenBeds?.available || 0,
    oxygen_supported_beds_available: this.oxygenBeds?.available || 0,
    latitude: this.latitude,
    longitude: this.longitude,
    node_osm_id: this.nodeOsmId || 0
  };
};

export const Hospital = mongoose.model('Hospital', hospitalSchema);
export default Hospital;

