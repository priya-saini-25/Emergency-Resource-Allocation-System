import apiClient from './apiClient.js';

/**
 * Authentication Service Module
 * Connects directly to Phase 4.2 / 4.7 Express backend authentication endpoints.
 */
export const authService = {
  /**
   * Log in user with credentials.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{ token: string, user: object }>}
   */
  async login(email, password) {
    const res = await apiClient.post('/auth/login', { email, password });
    return res.data; // { token, user }
  },

  /**
   * Register a new citizen account.
   * Note: The backend strictly creates accounts under the CITIZEN role and does NOT return a JWT.
   * @param {string} name
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{ user: object }>}
   */
  async register(name, email, password) {
    const res = await apiClient.post('/auth/register', { name, email, password });
    return res.data; // { user }
  },

  /**
   * Fetch current authenticated user profile using active JWT Bearer header.
   * @returns {Promise<object>}
   */
  async getMe() {
    const res = await apiClient.get('/auth/me');
    return res.data?.user;
  },
};

export default authService;
