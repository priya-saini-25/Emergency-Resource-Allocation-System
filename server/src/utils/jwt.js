import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Generates a signed JSON Web Token (JWT) containing safe user identity claims.
 *
 * @param {object} user - User document or safe object
 * @param {object} [options] - Additional jwt.sign options
 * @returns {string} Signed JWT token string
 */
export function generateToken(user, options = {}) {
  const userId = user._id ? user._id.toString() : user.id;
  if (!userId) {
    throw new Error('[JWT_ERROR] Cannot generate token without valid user ID');
  }

  const payload = {
    id: userId,
    role: user.role
  };

  const signOptions = {
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: 'HS256',
    ...options
  };

  return jwt.sign(payload, env.JWT_SECRET, signOptions);
}

/**
 * Verifies a JWT token signature and expiration.
 *
 * @param {string} token - Bearer JWT token string
 * @returns {object} Decoded token payload
 * @throws {Error} If token is invalid, malformed, or expired
 */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token must be a non-empty string');
  }

  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
}

export default {
  generateToken,
  verifyToken
};

