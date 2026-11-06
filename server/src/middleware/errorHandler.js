/**
 * Centralized Error Handling Middleware
 */
export const errorHandler = (err, req, res, next) => {
  console.error(`[SERVER_ERROR] ${err.stack || err.message}`);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    error: {
      status: statusCode,
      message: message,
      timestamp: new Date().toISOString()
    }
  });
};

/**
 * 404 Not Found Middleware
 */
export const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    success: false,
    error: {
      status: 404,
      message: `Endpoint ${req.originalUrl} not found`,
      timestamp: new Date().toISOString()
    }
  });
};
