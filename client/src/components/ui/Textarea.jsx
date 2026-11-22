import React, { forwardRef } from 'react';

export const Textarea = forwardRef(function Textarea(
  {
    label,
    error,
    helperText,
    id,
    rows = 3,
    className = '',
    containerClassName = '',
    required = false,
    ...props
  },
  ref
) {
  const textareaId = id || props.name || undefined;

  return (
    <div className={`w-full flex flex-col space-y-1 ${containerClassName}`}>
      {label && (
        <label htmlFor={textareaId} className="text-xs font-semibold text-theme-heading flex items-center justify-between">
          <span>
            {label}
            {required && <span className="text-emergency-critical ml-1">*</span>}
          </span>
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        required={required}
        className={`block w-full rounded-lg border text-sm px-3.5 py-2 transition-colors bg-white focus:outline-none focus:ring-2 focus:ring-offset-1 resize-y ${
          error
            ? 'border-emergency-critical text-theme-heading focus:ring-emergency-critical'
            : 'border-theme-border text-theme-heading focus:ring-theme-primary focus:border-theme-primary'
        } disabled:bg-theme-bg-secondary disabled:text-gray-400 disabled:cursor-not-allowed ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-emergency-critical font-medium">{error}</span>}
      {!error && helperText && <span className="text-xs text-gray-500">{helperText}</span>}
    </div>
  );
});

export default Textarea;

