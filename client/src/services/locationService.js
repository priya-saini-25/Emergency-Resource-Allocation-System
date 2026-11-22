import apiClient from './apiClient.js';

/**
 * Location and Geocoding Service
 * Interacts with the backend geocoding proxy (/api/location/search).
 */
export const locationService = {
  /**
   * Search for places and landmarks within the Jodhpur Urban Service Area.
   *
   * @param {string} query - The search string (e.g., "Sojati Gate", "AIIMS")
   * @returns {Promise<Array<object>>} - List of search results
   */
  async searchPlaces(query) {
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return [];
    }

    const res = await apiClient.get('/location/search', {
      params: { q: query.trim() },
    });

    return res.data?.results || [];
  },
};

export default locationService;
