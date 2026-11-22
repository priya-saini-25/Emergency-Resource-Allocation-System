/**
 * 404 Not Found Middleware.
 * Catches all unmatched routes and returns standard JSON error structure.
 */
export const notFoundHandler = (req, res, next) => {
  const message = `Endpoint ${req.method} ${req.originalUrl} does not exist`;
  res.status(404).json({
    success: false,
    message,
    error: {
      status: 404,
      code: 'ROUTE_NOT_FOUND',
      message,
      timestamp: new Date().toISOString()
    }
  });
};

export default notFoundHandler;

