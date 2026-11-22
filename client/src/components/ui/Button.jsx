import React from 'react';
import LoadingSpinner from './LoadingSpinner.jsx';

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled = false,
  loading = false,
  icon: Icon = null,
  iconPosition = 'left',
  className = '',
  onClick,
  ...props
}) {
  const baseClasses =
    'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none';

  const variantClasses = {
    primary:
      'bg-theme-sidebar text-white hover:bg-slate-800 focus:ring-theme-primary border border-transparent shadow-sm',
    secondary:
      'bg-theme-bg-secondary text-theme-heading hover:bg-slate-200 focus:ring-theme-secondary border border-theme-border',
    accent:
      'bg-theme-primary text-white hover:bg-slate-600 focus:ring-theme-secondary shadow-sm',
    danger:
      'bg-emergency-critical text-white hover:bg-red-700 focus:ring-red-500 shadow-sm',
    outline:
      'bg-transparent text-theme-heading border border-theme-border hover:bg-theme-bg focus:ring-theme-primary',
    ghost:
      'bg-transparent text-theme-heading hover:bg-theme-bg-secondary focus:ring-theme-secondary',
  }[variant] || 'bg-theme-sidebar text-white';

  const sizeClasses = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5',
    md: 'text-sm px-4 py-2 gap-2',
    lg: 'text-base px-5 py-2.5 gap-2.5',
  }[size] || 'text-sm px-4 py-2 gap-2';

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${baseClasses} ${variantClasses} ${sizeClasses} ${className}`}
      onClick={onClick}
      {...props}
    >
      {loading && <LoadingSpinner size="sm" color={variant === 'primary' || variant === 'danger' || variant === 'accent' ? 'white' : 'slate'} />}
      {!loading && Icon && iconPosition === 'left' && <Icon className="w-4 h-4 flex-shrink-0" />}
      <span>{children}</span>
      {!loading && Icon && iconPosition === 'right' && <Icon className="w-4 h-4 flex-shrink-0" />}
    </button>
  );
}

export default Button;

