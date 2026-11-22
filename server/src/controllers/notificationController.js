import { registerSSEClient } from '../services/realtimeNotificationService.js';

/**
 * SSE Notification Stream endpoint (GET /api/notifications/stream).
 * Restricted to OPERATOR and ADMIN roles.
 */
export function streamNotifications(req, res) {
  const role = req.user?.role;
  if (role !== 'OPERATOR' && role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Real-time operator notifications are restricted to control-room personnel.',
      error: { code: 'FORBIDDEN' }
    });
  }

  const userId = req.userId || (req.user?._id ? req.user._id.toString() : 'unknown');
  registerSSEClient(userId, role, res);
}

export default {
  streamNotifications
};
