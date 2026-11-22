import apiClient from './apiClient.js';

/**
 * Emergency Resources (Vehicles / Fleet Units) Service Module
 */
export const resourceService = {
  /**
   * List emergency resources with filtering, pagination, and sorting.
   * @param {object} params - { status, resourceType, stationId, search, page, limit, sortBy, sortOrder }
   * @returns {Promise<{ resources: Array, pagination: object }>}
   */
  async listResources(params = {}) {
    const res = await apiClient.get('/resources', { params });
    const payload = res.data || res;
    return {
      resources: payload.resources || [],
      pagination: payload.pagination || null,
      ...payload
    };
  },

  /**
   * Get resource inventory status counts and breakdown.
   * @returns {Promise<object>}
   */
  async getResourceStats() {
    const res = await apiClient.get('/resources/stats');
    return res.data || res || {};
  },

  /**
   * Get single resource detail by ID.
   * @param {number|string} resourceId
   * @returns {Promise<object>}
   */
  async getResourceById(resourceId) {
    const res = await apiClient.get(`/resources/${resourceId}`);
    return res.data?.resource || res.resource || null;
  },
};

export default resourceService;
