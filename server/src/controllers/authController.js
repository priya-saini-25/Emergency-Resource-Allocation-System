import User from '../models/User.js';
import { generateToken } from '../utils/jwt.js';
import { getConnectionStatus } from '../config/database.js';

const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Validates password complexity: minimum 8 characters, at least one letter and one number.
 */
function isStrongPassword(password) {
  if (typeof password !== 'string' || password.length < 8) return false;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return hasLetter && hasNumber;
}

/**
 * Public Citizen Registration Endpoint (POST /api/auth/register).
 * Always registers accounts under the CITIZEN role.
 */
export async function register(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Registration is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const { name, email, password } = req.body || {};

    // Input Validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Name is required and must be at least 2 characters long',
        error: { code: 'INVALID_NAME' }
      });
    }

    if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required',
        error: { code: 'INVALID_EMAIL' }
      });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long and contain at least one letter and one number',
        error: { code: 'WEAK_PASSWORD' }
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check for duplicate account
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email address is already registered',
        error: { code: 'DUPLICATE_EMAIL' }
      });
    }

    // Hash password with bcrypt
    const passwordHash = await User.hashPassword(password);

    // Create user strictly with CITIZEN role (mass-assignment protection)
    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: 'CITIZEN',
      isActive: true
    });

    return res.status(201).json({
      success: true,
      message: 'Citizen account registered successfully',
      data: {
        user: newUser.toSafeObject()
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Public Login Endpoint (POST /api/auth/login).
 * Authenticates user credentials and issues signed JWT.
 */
export async function login(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Authentication is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
        error: { code: 'MISSING_CREDENTIALS' }
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Query user and explicitly select passwordHash
    const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

    // Generic invalid-credentials response prevents user enumeration
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        error: { code: 'INVALID_CREDENTIALS' }
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        error: { code: 'INVALID_CREDENTIALS' }
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Contact system administrator.',
        error: { code: 'ACCOUNT_DEACTIVATED' }
      });
    }

    // Update lastLoginAt
    user.lastLoginAt = new Date();
    await user.save();

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: user.toSafeObject()
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Current Authenticated User Endpoint (GET /api/auth/me).
 */
export async function getMe(req, res, next) {
  try {
    return res.status(200).json({
      success: true,
      message: 'Current user profile retrieved successfully',
      data: {
        user: req.user.toSafeObject()
      }
    });
  } catch (error) {
    next(error);
  }
}

export default {
  register,
  login,
  getMe
};

