import {
  EngineValidationError,
  EngineDatasetError,
  EngineExecutionError,
  EngineTimeoutError,
  EngineBufferOverflowError,
  EngineError
} from '../services/cppEngineService.js';

/**
 * Maps error instances to standard HTTP status codes and error categories.
 */
function mapErrorToResponse(err) {
  // Syntax error from express.json() bad body parsing
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return {
      statusCode: 400,
      code: 'INVALID_JSON_BODY',
      message: 'Malformed JSON payload in request body',
      details: err.message
    };
  }

  // C++ Decision Engine Validation rejection (Exit code 1)
  if (err instanceof EngineValidationError) {
    return {
      statusCode: 400,
      code: 'ENGINE_VALIDATION_ERROR',
      message: err.message,
      details: err.details
    };
  }

  // C++ Decision Engine Dataset / Graph loading failure (Exit code 2)
  if (err instanceof EngineDatasetError) {
    return {
      statusCode: 503,
      code: 'ENGINE_DATASET_UNAVAILABLE',
      message: err.message,
      details: err.details
    };
  }

  // C++ Decision Engine Internal execution fault (Exit code 3)
  if (err instanceof EngineExecutionError) {
    return {
      statusCode: 500,
      code: 'ENGINE_EXECUTION_FAILURE',
      message: err.message,
      details: err.details
    };
  }

  // C++ Decision Engine execution timeout
  if (err instanceof EngineTimeoutError) {
    return {
      statusCode: 504,
      code: 'ENGINE_GATEWAY_TIMEOUT',
      message: err.message,
      details: err.details
    };
  }

  // C++ Decision Engine buffer overflow
  if (err instanceof EngineBufferOverflowError) {
    return {
      statusCode: 500,
      code: 'ENGINE_BUFFER_OVERFLOW',
      message: err.message,
      details: err.details
    };
  }

  // Other Engine Errors
  if (err instanceof EngineError) {
    return {
      statusCode: err.statusCode || 500,
      code: 'ENGINE_BRIDGE_ERROR',
      message: err.message,
      details: err.details
    };
  }

  // Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const fieldErrors = Object.keys(err.errors || {}).reduce((acc, key) => {
      acc[key] = err.errors[key].message;
      return acc;
    }, {});
    return {
      statusCode: 400,
      code: 'SCHEMA_VALIDATION_ERROR',
      message: 'Database schema validation constraint violation',
      details: fieldErrors
    };
  }

  // Mongoose Cast Error (e.g. invalid ObjectId or number)
  if (err.name === 'CastError') {
    return {
      statusCode: 400,
      code: 'INVALID_FIELD_TYPE',
      message: `Invalid format for field ${err.path}`,
      details: err.message
    };
  }

  // Default Fallback Server Error
  const statusCode = err.statusCode || err.status || 500;
  return {
    statusCode,
    code: err.code || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR'),
    message: err.message || 'An unexpected internal server error occurred',
    details: err.details !== undefined ? err.details : (process.env.NODE_ENV === 'development' ? err.stack : undefined)
  };
}

/**
 * Centralized Application Error Handling Middleware.
 */
export const errorHandler = (err, req, res, next) => {
  const { statusCode, code, message, details } = mapErrorToResponse(err);

  if (statusCode >= 500 && process.env.NODE_ENV !== 'test') {
    console.error(`[CRITICAL_SERVER_ERROR] [${code}] ${err.stack || err.message}`);
  }

  res.status(statusCode).json({
    success: false,
    message,
    error: {
      status: statusCode,
      code,
      message,
      details: details !== undefined ? details : null,
      timestamp: new Date().toISOString()
    }
  });
};

export default errorHandler;
