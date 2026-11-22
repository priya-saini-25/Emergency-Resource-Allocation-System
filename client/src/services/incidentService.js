import apiClient from './apiClient.js';

/**
 * Emergency Incident Management Service Module
 */
export const incidentService = {
  /**
   * Citizen report emergency intake.
   * @param {object} payload - { category, severity, victimCount, description, location: { latitude, longitude } }
   */
  async createIncident(payload) {
    const res = await apiClient.post('/incidents', payload);
    return res.data?.incident;
  },

  /**
   * Fetch current citizen's reported incident history.
   * @param {object} params - Optional pagination query params { page, limit }
   * @returns {Promise<{ incidents: Array, pagination: object }>}
   */
  async getMyIncidents(params = {}) {
    const res = await apiClient.get('/incidents/my', { params });
    return {
      incidents: res.data?.incidents || [],
      pagination: res.data?.pagination || null,
    };
  },

  /**
   * Control-room list and filter incidents.
   * @param {object} params - { status, category, severity, page, limit }
   */
  async listIncidents(params = {}) {
    const res = await apiClient.get('/incidents', { params });
    return {
      incidents: res.data?.incidents || [],
      pagination: res.data?.pagination || null,
      ...(res.data || {}),
    };
  },

  /**
   * Control-room retrieve global incident statistics and status aggregations.
   * @returns {Promise<{ totalIncidents: number, pendingReported: number, verifiedCount: number, rejectedCount: number, activeIncidents: number, byStatus: object }>}
   */
  async getIncidentStats() {
    const res = await apiClient.get('/incidents/stats');
    return res.data || res || {};
  },

  /**
   * Retrieve incident details by ID.
   * @param {number|string} incidentId
   */
  async getIncidentById(incidentId) {
    const res = await apiClient.get(`/incidents/${incidentId}`);
    return res.data?.incident;
  },

  /**
   * Control-room verify an incoming incident.
   * @param {number|string} incidentId
   * @param {string|object} [options=''] - verificationNotes or options object
   */
  async verifyIncident(incidentId, options = '') {
    const payload = typeof options === 'string'
      ? { verificationNotes: options, outcome: 'CONFIRMED' }
      : { outcome: 'CONFIRMED', ...options };
    const res = await apiClient.patch(`/incidents/${incidentId}/verify`, payload);
    return res.data?.incident;
  },

  /**
   * Record a structured verification outcome for an incoming incident.
   * @param {number|string} incidentId
   * @param {object} payload - { outcome, verificationNotes, duplicateOfIncidentId, proceedWithDispatch }
   */
  async recordVerification(incidentId, payload) {
    const res = await apiClient.patch(`/incidents/${incidentId}/verify`, payload);
    return res.data?.incident;
  },

  /**
   * Control-room reject a false alarm incident.
   * @param {number|string} incidentId
   * @param {string} rejectionReason
   */
  async rejectIncident(incidentId, rejectionReason = '') {
    const res = await apiClient.patch(`/incidents/${incidentId}/reject`, { rejectionReason });
    return res.data?.incident;
  },

  /**
   * Fetch all active operational incidents (DISPATCHED and ON_SCENE).
   * @param {object} params - Optional filters
   */
  async getActiveIncidents(params = {}) {
    const res = await apiClient.get('/incidents/active', { params });
    const payload = res.data || res;
    return {
      incidents: payload.incidents || [],
      pagination: payload.pagination || null,
      ...payload
    };
  },

  /**
   * Record a manual reporter call attempt.
   * @param {number|string} incidentId
   * @param {object} payload - { outcome: 'ANSWERED'|'NO_ANSWER'|'BUSY'|'UNREACHABLE'|'INVALID_NUMBER', notes?: string }
   */
  async recordCallAttempt(incidentId, payload) {
    const res = await apiClient.post(`/incidents/${incidentId}/call-attempts`, payload);
    return res.data;
  },

  /**
   * Fetch chronological call attempt history for an incident.
   * @param {number|string} incidentId
   * @returns {Promise<Array>}
   */
  async getCallAttempts(incidentId) {
    const res = await apiClient.get(`/incidents/${incidentId}/call-attempts`);
    return res.data?.callAttempts || [];
  },

  /**
   * Mark first responder arrival on scene (all assigned resources or specific resource).
   * @param {number|string} incidentId
   * @param {string|object} [options=''] - arrivalNotes string or options { resourceId, verificationMethod, arrivalNotes }
   */
  async markArrived(incidentId, options = '') {
    const payload = typeof options === 'string'
      ? { arrivalNotes: options }
      : options;
    const res = await apiClient.patch(`/incidents/${incidentId}/arrive`, payload);
    return res.data?.incident;
  },

  /**
   * Mark an individual assigned resource as arrived on scene.
   * @param {number|string} incidentId
   * @param {number|string} resourceId
   * @param {object} [options={}] - { verificationMethod: 'RADIO'|'PHONE'|'MANUAL', arrivalNotes?: string }
   */
  async markResourceArrived(incidentId, resourceId, options = {}) {
    const res = await apiClient.patch(
      `/incidents/${incidentId}/resources/${resourceId}/arrive`,
      options
    );
    return res.data?.incident;
  },

  /**
   * Resolve an on-scene incident and de-allocate resources.
   * @param {number|string} incidentId
   * @param {string} resolutionNotes
   */
  async resolveIncident(incidentId, resolutionNotes = '') {
    const res = await apiClient.patch(`/incidents/${incidentId}/resolve`, { resolutionNotes });
    return res.data; // { incident, releasedResources, hospitalCapacityRestored }
  },
};

export default incidentService;

