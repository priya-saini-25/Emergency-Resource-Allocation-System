import apiClient from './apiClient.js';

/**
 * Dispatch Recommendation & Execution Service Module
 */
export const dispatchService = {
  /**
   * Request C++ decision engine recommendations for verified incidents.
   * @param {number[]} incidentIds
   */
  async generateRecommendations(incidentIds = []) {
    const res = await apiClient.post('/dispatch/recommendations', { incidentIds });
    return res.data?.recommendation;
  },

  /**
   * Retrieve historical recommendation snapshot by batch ID.
   * @param {string} batchId
   */
  async getRecommendation(batchId) {
    const res = await apiClient.get(`/dispatch/recommendations/${batchId}`);
    return res.data?.recommendation;
  },

  /**
   * List recommendation snapshots.
   * @param {object} params
   */
  async listRecommendations(params = {}) {
    const res = await apiClient.get('/dispatch/recommendations', { params });
    const payload = res.data || res;
    return {
      recommendations: payload.recommendations || [],
      pagination: payload.pagination || null,
      ...payload
    };
  },

  /**
   * Atomically confirm and execute dispatch recommendation with idempotency key.
   * @param {string} batchId
   * @param {object} payload - { idempotencyKey, allowPartialDispatch, confirmationNotes }
   * @param {string} [idempotencyKey]
   */
  async confirmDispatch(batchId, payload = {}, idempotencyKey = null) {
    const key = idempotencyKey || payload.idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null);
    const headers = key ? { 'Idempotency-Key': key } : {};

    const res = await apiClient.post(
      `/dispatch/recommendations/${batchId}/confirm`,
      { ...payload, idempotencyKey: key },
      { headers }
    );
    return res.data?.dispatch || res.dispatch || res;
  },

  /**
   * Retrieve details of a confirmed dispatch operation.
   * @param {string} dispatchId
   */
  async getDispatch(dispatchId) {
    const res = await apiClient.get(`/dispatch/${dispatchId}`);
    return res.data?.dispatch || res.dispatch || res;
  },

  /**
   * List confirmed dispatches.
   * @param {object} params
   */
  async listDispatches(params = {}) {
    const res = await apiClient.get('/dispatch', { params });
    const payload = res.data || res;
    return {
      dispatches: payload.dispatches || [],
      pagination: payload.pagination || null,
      ...payload
    };
  },
};

export default dispatchService;

