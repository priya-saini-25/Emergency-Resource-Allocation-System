import apiClient from './apiClient.js';

/**
 * Emergency Hospital Capacity Service Module
 */
export const hospitalService = {
  /**
   * List emergency hospitals with filtering, pagination, and sorting.
   * @param {object} params - { status, capability, search, page, limit, sortBy, sortOrder }
   * @returns {Promise<{ hospitals: Array, pagination: object }>}
   */
  async listHospitals(params = {}) {
    const res = await apiClient.get('/hospitals', { params });
    const payload = res.data || res;
    return {
      hospitals: payload.hospitals || [],
      pagination: payload.pagination || null,
      ...payload
    };
  },

  /**
   * Get aggregate hospital network bed statistics.
   * @returns {Promise<object>}
   */
  async getHospitalStats() {
    const res = await apiClient.get('/hospitals/stats');
    return res.data || res || {};
  },

  /**
   * Get single hospital detail by ID.
   * @param {number|string} hospitalId
   * @returns {Promise<object>}
   */
  async getHospitalById(hospitalId) {
    const res = await apiClient.get(`/hospitals/${hospitalId}`);
    return res.data?.hospital || res.hospital || null;
  },
};

export default hospitalService;
