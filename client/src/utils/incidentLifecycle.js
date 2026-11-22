/**
 * Incident Lifecycle Progression Utilities
 *
 * Implements the 6-stage operational progression:
 * REPORTED → VERIFIED → ALLOCATED → DISPATCHED → ON_SCENE → RESOLVED
 *
 * Terminal alternatives: REJECTED, CANCELLED
 */

export const PROGRESSION_STAGES = [
  'REPORTED',
  'VERIFIED',
  'ALLOCATED',
  'DISPATCHED',
  'ON_SCENE',
  'RESOLVED',
];

export const ACTIVE_LIFECYCLE_STATUSES = [
  'REPORTED',
  'VERIFIED',
  'ALLOCATED',
  'DISPATCHED',
  'ON_SCENE',
];

export const TERMINAL_STATUSES = [
  'RESOLVED',
  'REJECTED',
  'CANCELLED',
];

/**
 * Extracts a genuine stage timestamp from direct schema fields or statusHistory.
 * NEVER fabricates or guesses dates for missing values.
 *
 * @param {object} incident - Incident data object
 * @param {string} stageKey - Status identifier
 * @returns {Date|string|null} The genuine ISO/Date timestamp or null if unavailable
 */
export function getStageTimestamp(incident, stageKey) {
  if (!incident) return null;

  const directMap = {
    REPORTED: incident.reportedAt,
    VERIFIED: incident.verifiedAt,
    ALLOCATED: incident.allocatedAt,
    DISPATCHED: incident.dispatchedAt,
    ON_SCENE: incident.arrivedAt,
    RESOLVED: incident.resolvedAt,
    REJECTED: incident.rejectedAt,
    CANCELLED: incident.cancelledAt,
  };

  if (directMap[stageKey]) return directMap[stageKey];

  if (Array.isArray(incident.statusHistory)) {
    const entry = incident.statusHistory.find((s) => s && s.status === stageKey);
    if (entry && entry.timestamp) return entry.timestamp;
  }

  return null;
}

/**
 * Evaluates operational lifecycle progression for a given incident status.
 *
 * @param {string} currentStatus - The current status of the incident
 * @returns {{ isTerminalAlternative: boolean, isRejected: boolean, isCancelled: boolean, activeIndex: number, stages: Array }}
 */
export function evaluateLifecycleProgression(currentStatus) {
  const isRejected = currentStatus === 'REJECTED';
  const isCancelled = currentStatus === 'CANCELLED';
  const isTerminalAlternative = isRejected || isCancelled;

  const activeIndex = PROGRESSION_STAGES.indexOf(currentStatus);

  const stages = PROGRESSION_STAGES.map((stage, idx) => ({
    stage,
    isCompleted: !isTerminalAlternative && activeIndex > idx,
    isCurrent: !isTerminalAlternative && activeIndex === idx,
    isPending: isTerminalAlternative || activeIndex < idx,
  }));

  return {
    isTerminalAlternative,
    isRejected,
    isCancelled,
    activeIndex,
    stages,
  };
}

export default {
  PROGRESSION_STAGES,
  ACTIVE_LIFECYCLE_STATUSES,
  TERMINAL_STATUSES,
  getStageTimestamp,
  evaluateLifecycleProgression,
};

