import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { TOAST_TYPES, DEFAULT_TOAST_DURATION, DEDUPE_WINDOW_MS } from '../utils/notificationConstants.js';

export const NotificationContext = createContext(null);
export { TOAST_TYPES };

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [operatorPopups, setOperatorPopups] = useState([]);
  const recentDedupeRef = useRef(new Map());
  const sseRef = useRef(null);

  const auth = useAuth() || {};
  const { user, token, role, isAuthenticated } = auth;

  // Cleanup expired dedupe keys periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of recentDedupeRef.current.entries()) {
        if (now - timestamp > DEDUPE_WINDOW_MS * 2) {
          recentDedupeRef.current.delete(key);
        }
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  /**
   * Dismiss a toast by id
   */
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * Dismiss an operator popup by id
   */
  const dismissPopup = useCallback((id) => {
    setOperatorPopups((prev) => prev.filter((p) => p.id !== id));
  }, []);

  /**
   * Adds a toast notification with deduplication & auto-dismissal
   */
  const showToast = useCallback(
    ({ type = TOAST_TYPES.INFO, title = '', message = '', duration = DEFAULT_TOAST_DURATION, dedupeKey = null }) => {
      if (!message && !title) return null;

      const effectiveKey = dedupeKey || `${type}:${title}:${message}`;
      const now = Date.now();
      const lastSeen = recentDedupeRef.current.get(effectiveKey);

      if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) {
        return null; // Suppress duplicate
      }
      recentDedupeRef.current.set(effectiveKey, now);

      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newToast = {
        id,
        type,
        title,
        message,
        duration,
        createdAt: now,
      };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, duration);
      }

      return id;
    },
    [dismissToast]
  );

  // Convenience toast methods
  const success = useCallback((message, options = {}) => showToast({ ...options, message, type: TOAST_TYPES.SUCCESS }), [showToast]);
  const error = useCallback((message, options = {}) => showToast({ ...options, message, type: TOAST_TYPES.ERROR }), [showToast]);
  const warning = useCallback((message, options = {}) => showToast({ ...options, message, type: TOAST_TYPES.WARNING }), [showToast]);
  const info = useCallback((message, options = {}) => showToast({ ...options, message, type: TOAST_TYPES.INFO }), [showToast]);

  /**
   * Adds an urgent operator popup for incoming emergency reports
   */
  const showOperatorEmergencyPopup = useCallback((incidentData) => {
    if (!incidentData || !incidentData.incidentId) return null;

    const dedupeKey = `popup:${incidentData.incidentId}`;
    const now = Date.now();
    const lastSeen = recentDedupeRef.current.get(dedupeKey);
    if (lastSeen && now - lastSeen < 10000) {
      return null;
    }
    recentDedupeRef.current.set(dedupeKey, now);

    const id = `popup-${incidentData.incidentId}-${Date.now()}`;
    const popup = {
      id,
      incidentId: incidentData.incidentId,
      category: incidentData.category || 'EMERGENCY',
      subcategory: incidentData.subcategory || '',
      severity: incidentData.severity || 3,
      victimCount: incidentData.victimCount || 0,
      location: incidentData.location || {},
      address: incidentData.address || incidentData.locationName || '',
      landmark: incidentData.landmark || '',
      reportedAt: incidentData.reportedAt || new Date().toISOString(),
      createdAt: now,
    };

    setOperatorPopups((prev) => [popup, ...prev.slice(0, 4)]); // Keep maximum 5 active
    return id;
  }, []);

  // Connect to SSE stream for OPERATOR and ADMIN roles
  useEffect(() => {
    // Only connect if in browser, authenticated, and role is OPERATOR or ADMIN
    if (typeof window === 'undefined' || !window.EventSource) return;
    if (!isAuthenticated || !token || (role !== 'OPERATOR' && role !== 'ADMIN')) {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      return;
    }

    const sseUrl = `/api/notifications/stream?token=${encodeURIComponent(token)}`;
    const eventSource = new window.EventSource(sseUrl);
    sseRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'NEW_EMERGENCY_REPORT') {
          showOperatorEmergencyPopup(parsed.data);
          info('New emergency report received.', { dedupeKey: `toast-new-${parsed.data?.incidentId}` });
        }
      } catch (err) {
        console.warn('[Notification SSE] Failed to parse event payload:', err);
      }
    };

    eventSource.onerror = () => {
      // EventSource automatically retries connections
      console.warn('[Notification SSE] Stream connection error; reconnecting...');
    };

    return () => {
      eventSource.close();
      if (sseRef.current === eventSource) {
        sseRef.current = null;
      }
    };
  }, [isAuthenticated, token, role, showOperatorEmergencyPopup, info]);

  const value = {
    toasts,
    operatorPopups,
    showToast,
    dismissToast,
    dismissPopup,
    showOperatorEmergencyPopup,
    success,
    error,
    warning,
    info,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    // Graceful fallback for non-provider renders or isolated tests
    return {
      toasts: [],
      operatorPopups: [],
      showToast: () => null,
      dismissToast: () => {},
      dismissPopup: () => {},
      showOperatorEmergencyPopup: () => null,
      success: () => null,
      error: () => null,
      warning: () => null,
      info: () => null,
    };
  }
  return context;
}

export default NotificationContext;
