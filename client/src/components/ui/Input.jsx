import React, { forwardRef } from 'react';

export const Input = forwardRef(function Input(
  {
    label,
    error,
    helperText,
    id,
    type = 'text',
    className = '',
    containerClassName = '',
    required = false,
    icon: Icon = null,
    rightElement = null,
    ...props
  },
  ref
) {
  const inputId = id || props.name || undefined;

  return (
    <div className={`w-full flex flex-col space-y-1 ${containerClassName}`}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-theme-heading flex items-center justify-between">
          <span>
            {label}
            {required && <span className="text-emergency-critical ml-1">*</span>}
          </span>
        </label>
      )}
      <div className="relative rounded-lg shadow-sm">
        {Icon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
            <Icon className="w-4 h-4" />
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          required={required}
          className={`block w-full rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
            Icon ? 'pl-9' : 'pl-3.5'
          } ${rightElement ? 'pr-10' : 'pr-3.5'} py-2 ${
            error
              ? 'border-emergency-critical text-theme-heading focus:ring-emergency-critical focus:border-emergency-critical'
              : 'border-theme-border bg-white text-theme-heading focus:ring-theme-primary focus:border-theme-primary'
          } disabled:bg-theme-bg-secondary disabled:text-gray-400 disabled:cursor-not-allowed ${className}`}
          {...props}
        />
        {rightElement && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
            {rightElement}
          </div>
        )}
      </div>
      {error && <span className="text-xs text-emergency-critical font-medium">{error}</span>}
      {!error && helperText && <span className="text-xs text-gray-500">{helperText}</span>}
    </div>
  );
});

export default Input;

