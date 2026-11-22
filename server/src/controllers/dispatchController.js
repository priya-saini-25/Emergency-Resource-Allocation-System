import {
  generateDispatchRecommendations,
  getRecommendationByBatchId,
  listRecommendations as listRecommendationsService,
  RecommendationValidationError,
  EngineResponseValidationError
} from '../services/dispatchRecommendationService.js';

/**
 * Controller: Generate dispatch recommendations for verified incidents.
 * POST /api/dispatch/recommendations
 * Roles: OPERATOR, ADMIN
 */
export async function createRecommendation(req, res, next) {
  try {
    const recommendation = await generateDispatchRecommendations(req.body, req.user);

    return res.status(201).json({
      success: true,
      message: 'Dispatch recommendations generated successfully',
      data: {
        recommendation
      }
    });
  } catch (err) {
    if (err instanceof RecommendationValidationError) {
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message,
        error: {
          code: err.code,
          details: err.details
        }
      });
    }

    if (err instanceof EngineResponseValidationError) {
      return res.status(err.statusCode || 502).json({
        success: false,
        message: err.message,
        error: {
          code: err.code,
          details: err.details
        }
      });
    }

    next(err);
  }
}

/**
 * Controller: Retrieve historical dispatch recommendation snapshot by batch ID.
 * GET /api/dispatch/recommendations/:batchId
 * Roles: OPERATOR, ADMIN
 */
export async function getRecommendation(req, res, next) {
  try {
    const { batchId } = req.params;
    const recommendation = await getRecommendationByBatchId(batchId);

    if (!recommendation) {
      return res.status(404).json({
        success: false,
        message: `Dispatch recommendation batch '${batchId}' not found`,
        error: {
          code: 'BATCH_NOT_FOUND',
          batchId
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Dispatch recommendation retrieved successfully',
      data: {
        recommendation
      }
    });
  } catch (err) {
    if (err instanceof RecommendationValidationError) {
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message,
        error: {
          code: err.code,
          details: err.details
        }
      });
    }

    next(err);
  }
}

/**
 * Controller: List historical recommendations with filtering and pagination.
 * GET /api/dispatch/recommendations
 * Roles: OPERATOR, ADMIN
 */
export async function listRecommendations(req, res, next) {
  try {
    const result = await listRecommendationsService(req.query);

    return res.status(200).json({
      success: true,
      message: 'Dispatch recommendations retrieved successfully',
      data: {
        recommendations: result.recommendations,
        pagination: result.pagination
      }
    });
  } catch (err) {
    if (err instanceof RecommendationValidationError) {
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message,
        error: {
          code: err.code,
          details: err.details
        }
      });
    }

    next(err);
  }
}

export default {
  createRecommendation,
  getRecommendation,
  listRecommendations
};

