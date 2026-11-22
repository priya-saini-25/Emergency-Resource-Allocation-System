/**
 * Canonical Toast Notification Types
 */
export const TOAST_TYPES = {
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  INFO: 'INFO',
};

/**
 * Standard toast display duration in milliseconds
 */
export const DEFAULT_TOAST_DURATION = 5000;

/**
 * Throttling / deduplication window in milliseconds
 */
export const DEDUPE_WINDOW_MS = 3000;

export default {
  TOAST_TYPES,
  DEFAULT_TOAST_DURATION,
  DEDUPE_WINDOW_MS
};
