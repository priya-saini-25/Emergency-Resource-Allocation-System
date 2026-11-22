import geocodingService from '../services/geocodingService.js';

/**
 * Handles place-name search requests (GET /api/location/search?q=<query>).
 */
export async function searchLocation(req, res, next) {
  try {
    const rawQuery = req.query.q || req.query.query;

    if (!rawQuery || typeof rawQuery !== 'string' || rawQuery.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search query 'q' is required and must be at least 2 characters long",
        error: { code: 'INVALID_QUERY' }
      });
    }

    if (rawQuery.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: "Search query 'q' cannot exceed 100 characters",
        error: { code: 'QUERY_TOO_LONG' }
      });
    }

    const results = await geocodingService.searchPlaces(rawQuery);

    return res.status(200).json({
      success: true,
      count: results.length,
      data: {
        query: rawQuery.trim(),
        results
      }
    });
  } catch (error) {
    next(error);
  }
}

export default {
  searchLocation
};
