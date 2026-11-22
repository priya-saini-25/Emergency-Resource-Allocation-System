import React from 'react';
import { INCIDENT_STATUSES, SEVERITY_LEVELS } from '../../styles/tokens.js';

export function StatusBadge({ status, className = '' }) {
  const meta = INCIDENT_STATUSES[status] || {
    label: status || 'Unknown',
    bg: '#F4F6F8',
    textColor: '#27313D',
    border: '#D9E0E7',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${className}`}
      style={{
        backgroundColor: meta.bg,
        color: meta.textColor,
        borderColor: meta.border,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full mr-1.5"
        style={{ backgroundColor: meta.color || meta.textColor }}
      />
      {meta.label}
    </span>
  );
}

export function SeverityBadge({ severity, className = '' }) {
  const meta = SEVERITY_LEVELS[severity] || {
    label: `Tier ${severity}`,
    bg: '#F4F6F8',
    text: '#27313D',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold tracking-wide uppercase border ${className}`}
      style={{
        backgroundColor: meta.bg,
        color: meta.text,
        borderColor: meta.color || '#D9E0E7',
      }}
    >
      P{severity} · {meta.label}
    </span>
  );
}

export default StatusBadge;

