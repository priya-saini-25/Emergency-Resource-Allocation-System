import {
  confirmDispatch,
  getDispatchById,
  listDispatches,
  DispatchConfirmationError
} from '../services/dispatchExecutionService.js';

/**
 * Controller: Confirm an existing dispatch recommendation and atomically mobilize units.
 * POST /api/dispatch/recommendations/:batchId/confirm
 * Roles: OPERATOR, ADMIN
 */
export async function confirmDispatchController(req, res, next) {
  try {
    const { batchId } = req.params;
    const headerIdempotencyKey = req.headers['idempotency-key'];
    const bodyIdempotencyKey = req.body ? req.body.idempotencyKey : null;
    const idempotencyKey = headerIdempotencyKey || bodyIdempotencyKey;

    const allowPartialDispatch = req.body ? Boolean(req.body.allowPartialDispatch) : false;
    const confirmationNotes = req.body ? req.body.confirmationNotes : '';

    const dispatch = await confirmDispatch(
      batchId,
      {
        idempotencyKey,
        allowPartialDispatch,
        confirmationNotes
      },
      req.user
    );

    const statusCode = dispatch.isIdempotentReplay ? 200 : 201;
    const message = dispatch.isIdempotentReplay
      ? 'Idempotent replay: dispatch operation already confirmed'
      : 'Dispatch confirmed and units mobilized successfully';

    return res.status(statusCode).json({
      success: true,
      message,
      data: {
        dispatch
      }
    });
  } catch (err) {
    if (err instanceof DispatchConfirmationError) {
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
 * Controller: Retrieve details of a confirmed dispatch operation.
 * GET /api/dispatch/:dispatchId
 * Roles: OPERATOR, ADMIN
 */
export async function getDispatchByIdController(req, res, next) {
  try {
    const { dispatchId } = req.params;
    const dispatch = await getDispatchById(dispatchId);

    if (!dispatch) {
      return res.status(404).json({
        success: false,
        message: `Dispatch operation '${dispatchId}' not found`,
        error: {
          code: 'DISPATCH_NOT_FOUND',
          dispatchId
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Dispatch details retrieved successfully',
      data: {
        dispatch
      }
    });
  } catch (err) {
    if (err instanceof DispatchConfirmationError) {
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
 * Controller: List historical confirmed dispatch operations.
 * GET /api/dispatch
 * Roles: OPERATOR, ADMIN
 */
export async function listDispatchesController(req, res, next) {
  try {
    const result = await listDispatches(req.query);

    return res.status(200).json({
      success: true,
      message: 'Dispatch operations retrieved successfully',
      data: {
        dispatches: result.dispatches,
        pagination: result.pagination
      }
    });
  } catch (err) {
    if (err instanceof DispatchConfirmationError) {
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
  confirmDispatchController,
  getDispatchByIdController,
  listDispatchesController
};

