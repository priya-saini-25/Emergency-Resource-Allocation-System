import { verifyToken } from '../utils/jwt.js';
import User from '../models/User.js';
import { getConnectionStatus } from '../config/database.js';

/**
 * Middleware ensuring database connection is active for persistence-dependent routes.
 */
export function requireDatabase(req, res, next) {
  const dbStatus = getConnectionStatus();
  if (!dbStatus.connected) {
    return res.status(503).json({
      success: false,
      message: 'Database persistence is temporarily unavailable. Operating in degraded mode.',
      error: {
        code: 'DATABASE_UNAVAILABLE',
        state: dbStatus.state
      }
    });
  }
  next();
}

/**
 * Authentication Middleware: Verifies Bearer JWT token and attaches authenticated user to req.user.
 */
export async function authenticate(req, res, next) {
  let authHeader = req.headers.authorization;
  if (!authHeader && req.query?.token && typeof req.query.token === 'string') {
    authHeader = `Bearer ${req.query.token}`;
  }

  if (!authHeader || typeof authHeader !== 'string') {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Missing Authorization header.',
      error: { code: 'UNAUTHORIZED' }
    });
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json({
      success: false,
      message: 'Authentication failed. Malformed Authorization header. Expected "Bearer <token>".',
      error: { code: 'MALFORMED_AUTH_HEADER' }
    });
  }

  const token = parts[1];
  let decoded = null;

  try {
    decoded = verifyToken(token);
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      message: isExpired ? 'Authentication token has expired' : 'Invalid or corrupted authentication token',
      error: {
        code: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        details: err.message
      }
    });
  }

  if (!decoded || !decoded.id) {
    return res.status(401).json({
      success: false,
      message: 'Token payload missing user identifier',
      error: { code: 'INVALID_TOKEN_PAYLOAD' }
    });
  }

  // Load user from database if DB is connected
  const dbStatus = getConnectionStatus();
  if (dbStatus.connected) {
    try {
      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Authenticated user account no longer exists',
          error: { code: 'USER_NOT_FOUND' }
        });
      }

      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated. Contact system administrator.',
          error: { code: 'ACCOUNT_INACTIVE' }
        });
      }

      req.user = user;
      req.userId = user._id.toString();
      return next();
    } catch (dbErr) {
      return res.status(503).json({
        success: false,
        message: 'Error verifying user authentication against database',
        error: { code: 'DATABASE_ERROR', details: dbErr.message }
      });
    }
  } else {
    // If DB is disconnected, fail gracefully for routes requiring authenticated user lookups
    return res.status(503).json({
      success: false,
      message: 'Database persistence is unavailable. Cannot verify authentication state.',
      error: { code: 'DATABASE_UNAVAILABLE' }
    });
  }
}

/**
 * Role-based Authorization Middleware Factory.
 * Verifies that the authenticated user possesses one of the authorized roles.
 *
 * @param {...string} allowedRoles - List of authorized role strings (e.g. 'CITIZEN', 'OPERATOR', 'ADMIN')
 */
export function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required before authorization verification',
        error: { code: 'UNAUTHORIZED' }
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. You do not have permission to access this resource.',
        error: {
          code: 'FORBIDDEN',
          requiredRoles: allowedRoles,
          currentRole: req.user.role
        }
      });
    }

    next();
  };
}

export default {
  authenticate,
  authorizeRoles,
  requireDatabase
};

