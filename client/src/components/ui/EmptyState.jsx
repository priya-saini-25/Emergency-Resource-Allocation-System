import React from 'react';
import { Inbox, AlertCircle } from 'lucide-react';
import Button from './Button.jsx';

export function EmptyState({
  icon: Icon = Inbox,
  title = 'No records found',
  description = 'There are no active items to display at this time.',
  action = null,
  className = '',
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center bg-white rounded-xl border border-dashed border-theme-border ${className}`}
    >
      <div className="p-3 bg-theme-bg-secondary rounded-full text-theme-primary mb-3">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-sm font-semibold text-theme-heading">{title}</h3>
      <p className="text-xs text-gray-500 max-w-sm mt-1 mb-4">{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  icon: Icon = AlertCircle,
  title = 'Failed to load data',
  message = 'An unexpected error occurred while communicating with the emergency services backend.',
  onRetry = null,
  className = '',
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center bg-red-50/50 rounded-xl border border-red-200 ${className}`}
    >
      <div className="p-3 bg-red-100 rounded-full text-emergency-critical mb-3">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-xs text-red-600 max-w-sm mt-1 mb-4">{message}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try Again
        </Button>
      )}
    </div>
  );
}

export default EmptyState;

