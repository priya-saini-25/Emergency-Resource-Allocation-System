import React from 'react';

export function Card({ children, className = '', ...props }) {
  return (
    <div
      className={`bg-theme-card border border-theme-border rounded-xl shadow-sm overflow-hidden ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '', title, subtitle, action, ...props }) {
  return (
    <div
      className={`px-6 py-4 border-b border-theme-border flex items-center justify-between ${className}`}
      {...props}
    >
      {title ? (
        <div>
          <h3 className="text-base font-semibold text-theme-heading">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      ) : (
        children
      )}
      {action && <div className="flex items-center space-x-2">{action}</div>}
    </div>
  );
}

export function CardBody({ children, className = '', ...props }) {
  return (
    <div className={`p-6 ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className = '', ...props }) {
  return (
    <div
      className={`px-6 py-3.5 bg-theme-bg/60 border-t border-theme-border flex items-center justify-between ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;

export default Card;

