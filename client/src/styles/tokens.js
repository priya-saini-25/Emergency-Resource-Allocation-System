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
  REPORTED: { label: 'Reported', color: '#B6CAD9', textColor: '#27313D', bg: '#F4F6F8', border: '#D9E0E7' },
  VERIFIED: { label: 'Verified', color: '#789CB8', textColor: '#1E293B', bg: '#E8EDF2', border: '#B6CAD9' },
  DISPATCHED: { label: 'Dispatched', color: '#5685B5', textColor: '#1E3A8A', bg: '#DBEAFE', border: '#93C5FD' },
  ON_SCENE: { label: 'On Scene', color: '#E89543', textColor: '#9A3412', bg: '#FFEDD5', border: '#FDBA74' },
  RESOLVED: { label: 'Resolved', color: '#56866B', textColor: '#065F46', bg: '#D1FAE5', border: '#6EE7B7' },
  REJECTED: { label: 'Rejected', color: '#DC4545', textColor: '#991B1B', bg: '#FEE2E2', border: '#FCA5A5' },
};

export const SEVERITY_LEVELS = {
  1: { label: 'Low', color: '#56866B', bg: '#D1FAE5', text: '#065F46' },
  2: { label: 'Moderate', color: '#789CB8', bg: '#E8EDF2', text: '#1E293B' },
  3: { label: 'Medium', color: '#D5B34F', bg: '#FEF9C3', text: '#854D0E' },
  4: { label: 'High', color: '#E89543', bg: '#FFEDD5', text: '#9A3412' },
  5: { label: 'Critical', color: '#DC4545', bg: '#FEE2E2', text: '#991B1B' },
};

export const USER_ROLES = {
  CITIZEN: 'CITIZEN',
  OPERATOR: 'OPERATOR',
  ADMIN: 'ADMIN',
};

export default {
  THEME_COLORS,
  EMERGENCY_COLORS,
  INCIDENT_STATUSES,
  SEVERITY_LEVELS,
  USER_ROLES,
};
