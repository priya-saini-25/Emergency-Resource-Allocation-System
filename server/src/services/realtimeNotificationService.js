import { randomUUID } from 'crypto';

/**
 * In-memory registry of active Server-Sent Events (SSE) connections.
 * Maps clientId -> { id, userId, role, res }
 */
const clients = new Map();

let heartbeatInterval = null;

/**
 * Initializes heartbeat keep-alive for active SSE streams.
 */
function ensureHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    for (const [clientId, client] of clients.entries()) {
      try {
        client.res.write(': heartbeat\n\n');
      } catch (err) {
        removeClient(clientId);
      }
    }
  }, 25000);

  // Allow Node process to exit cleanly if heartbeat is the only timer
  if (heartbeatInterval.unref) {
    heartbeatInterval.unref();
  }
}

/**
 * Registers an authenticated SSE connection.
 * Restricted to OPERATOR and ADMIN roles.
 *
 * @param {string} userId - User identifier
 * @param {string} role - User role (OPERATOR or ADMIN)
 * @param {object} res - Express response stream
 * @returns {string} Assigned clientId
 */
export function registerSSEClient(userId, role, res) {
  const clientId = `sse-${randomUUID()}`;

  // Configure response headers for Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Flush headers if supported
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const clientInfo = {
    id: clientId,
    userId,
    role,
    res,
    connectedAt: new Date()
  };

  clients.set(clientId, clientInfo);
  ensureHeartbeat();

  // Send initial handshake event
  const handshake = {
    type: 'CONNECTED',
    message: 'Real-time notification stream established',
    clientId,
    timestamp: new Date().toISOString()
  };
  res.write(`data: ${JSON.stringify(handshake)}\n\n`);

  // Handle client disconnect
  res.on('close', () => {
    removeClient(clientId);
  });

  return clientId;
}

/**
 * Deregisters a client connection.
 * @param {string} clientId
 */
export function removeClient(clientId) {
  if (clients.has(clientId)) {
    const client = clients.get(clientId);
    try {
      client.res.end();
    } catch (_) {
      // Ignored if already closed
    }
    clients.delete(clientId);
  }

  if (clients.size === 0 && heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

/**
 * Emits a real-time event to all active OPERATOR and ADMIN clients.
 * Citizen connections (if any) are strictly excluded.
 *
 * @param {string} eventType - Canonical event identifier (e.g. 'NEW_EMERGENCY_REPORT')
 * @param {object} payload - Sanitized event data
 * @returns {number} Count of clients that received the event
 */
export function emitControlRoomNotification(eventType, payload = {}) {
  const message = {
    notificationId: `notif-${randomUUID()}`,
    type: eventType,
    data: payload,
    timestamp: new Date().toISOString()
  };

  const payloadString = `data: ${JSON.stringify(message)}\n\n`;
  let deliveredCount = 0;

  for (const [clientId, client] of clients.entries()) {
    if (client.role === 'OPERATOR' || client.role === 'ADMIN') {
      try {
        client.res.write(payloadString);
        deliveredCount++;
      } catch (err) {
        removeClient(clientId);
      }
    }
  }

  return deliveredCount;
}

/**
 * Returns count of currently connected control-room SSE clients.
 */
export function getActiveClientCount() {
  return clients.size;
}

/**
 * Test isolation helper: clears all active clients and resets timers.
 */
export function __resetNotificationClients() {
  for (const [clientId] of clients.entries()) {
    removeClient(clientId);
  }
  clients.clear();
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

export default {
  registerSSEClient,
  removeClient,
  emitControlRoomNotification,
  getActiveClientCount,
  __resetNotificationClients
};
