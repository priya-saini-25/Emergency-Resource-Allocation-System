/**
 * Centralized Design System Tokens
 * Palette: Slate × Ice Blue
 */

export const THEME_COLORS = {
  mainBg: '#F4F6F8',
  sidebar: '#252F3B',
  cards: '#FFFFFF',
  secondaryBg: '#E8EDF2',
  primaryAccent: '#789CB8',
  secondaryAccent: '#B6CAD9',
  headings: '#27313D',
  borders: '#D9E0E7',
};

export const EMERGENCY_COLORS = {
  critical: '#DC4545',
  high: '#E89543',
  medium: '#D5B34F',
  available: '#56866B',
  dispatched: '#5685B5',
};

export const INCIDENT_STATUSES = {
  REPORTED: { label: 'Reported', color: '#B6CAD9', bg: '#F4F6F8' },
  VERIFIED: { label: 'Verified', color: '#789CB8', bg: '#E8EDF2' },
  ALLOCATED: { label: 'Allocated', color: '#D5B34F', bg: '#FEF9C3' },
  DISPATCHED: { label: 'Dispatched', color: '#5685B5', bg: '#E0F2FE' },
  ON_SCENE: { label: 'On Scene', color: '#E89543', bg: '#FFEDD5' },
  RESOLVED: { label: 'Resolved', color: '#56866B', bg: '#DCFCE7' },
  CANCELLED: { label: 'Cancelled', color: '#94A3B8', bg: '#F1F5F9' },
  REJECTED: { label: 'Rejected', color: '#DC4545', bg: '#FEE2E2' },
};

export default {
  THEME_COLORS,
  EMERGENCY_COLORS,
  INCIDENT_STATUSES,
};
