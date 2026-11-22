import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

const { Schema } = mongoose;

export const USER_ROLES = ['CITIZEN', 'OPERATOR', 'ADMIN'];

const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long'],
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (val) {
          return emailRegex.test(val);
        },
        message: 'Invalid email address format'
      }
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false // Never return password hash in normal queries
    },
    role: {
      type: String,
      enum: {
        values: USER_ROLES,
        message: '{VALUE} is not a valid user role'
      },
      default: 'CITIZEN',
      required: [true, 'Role is required']
    },
    isActive: {
      type: Boolean,
      default: true
    },
    lastLoginAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id ? ret._id.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        return ret;
      }
    },
    toObject: {
      transform: function (doc, ret) {
        ret.id = ret._id ? ret._id.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        return ret;
      }
    }
  }
);

userSchema.index({ email: 1 });
userSchema.index({ role: 1 });

/**
 * Hashes a plaintext password using bcryptjs.
 */
userSchema.statics.hashPassword = async function (plaintext) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return await bcrypt.hash(plaintext, env.BCRYPT_SALT_ROUNDS);
};

/**
 * Validates a plaintext password against the stored password hash.
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.passwordHash) {
    throw new Error('User record does not include passwordHash. Use .select("+passwordHash") when querying for login.');
  }
  return await bcrypt.compare(candidatePassword, this.passwordHash);
};

/**
 * Returns a safe, serialized user object suitable for client responses.
 */
userSchema.methods.toSafeObject = function () {
  return {
    id: this._id ? this._id.toString() : undefined,
    name: this.name,
    email: this.email,
    role: this.role,
    isActive: this.isActive,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

export const User = mongoose.model('User', userSchema);
export default User;

