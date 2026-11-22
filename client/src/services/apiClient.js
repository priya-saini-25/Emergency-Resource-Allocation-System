import axios from 'axios';

const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ||
  (typeof process !== 'undefined' && process.env && process.env.VITE_API_URL) ||
  '/api';

/**
 * Centralized Axios HTTP Client
 * Configured with JWT Bearer attachment, standardized error normalization,
 * and session invalidation handling.
 */
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000, // 15s timeout aligns with C++ engine subprocess 10s ceiling
});

// Request Interceptor: Attach JWT Bearer Token to outgoing requests if available
apiClient.interceptors.request.use(
  (config) => {
    // Only attempt localStorage in browser environments
    if (typeof window !== 'undefined' && window.localStorage) {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Unwrap standardized envelope and normalize API errors
apiClient.interceptors.response.use(
  (response) => {
    // Return standard backend data envelope payload
    return response.data;
  },
  (error) => {
    const errorData = error.response?.data;
    const status = error.response?.status;

    // Build standardized normalized error object conforming to Phase 4.7 standard
    const normalizedError = {
      status: status || 0,
      code: errorData?.error?.code || (status ? `HTTP_${status}` : 'NETWORK_ERROR'),
      message:
        errorData?.message ||
        errorData?.error?.message ||
        (status === 0
          ? 'Unable to connect to the emergency server. Please check backend connection.'
          : error.message || 'An unexpected network error occurred'),
      details: errorData?.error?.details || null,
      raw: errorData || null,
    };

    // Global session expiration handler:
    // Only invalidate session for token-bearing authenticated requests that fail with 401
    // (Do not trigger session purge on normal bad login attempts returning INVALID_CREDENTIALS)
    if (status === 401 && typeof window !== 'undefined') {
      const sessionInvalidatingCodes = [
        'TOKEN_EXPIRED',
        'UNAUTHORIZED',
        'ACCOUNT_INACTIVE',
        'INVALID_TOKEN',
        'USER_NOT_FOUND',
      ];

      if (sessionInvalidatingCodes.includes(normalizedError.code)) {
        if (window.localStorage) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
        window.dispatchEvent(new CustomEvent('auth:unauthorized', { detail: normalizedError }));
      }
    }

    return Promise.reject(normalizedError);
  }
);

export default apiClient;
