import React from 'react';

export function PageHeader({
  title,
  subtitle,
  actions = null,
  badge = null,
  className = '',
}) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-theme-border/60 ${className}`}>
      <div>
        <div className="flex items-center space-x-3">
          <h1 className="text-xl font-bold tracking-tight text-theme-heading">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center space-x-2.5 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon = null,
  indicatorColor = '#789CB8',
  trend = null,
  className = '',
}) {
  return (
    <div
      className={`bg-white border border-theme-border rounded-xl p-5 shadow-sm hover:border-theme-primary/40 transition-colors flex flex-col justify-between ${className}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 block">
            {title}
          </span>
          <p className="text-2xl font-bold text-theme-heading mt-1">{value}</p>
        </div>
        {Icon && (
          <div
            className="p-2.5 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${indicatorColor}15`, color: indicatorColor }}
          >
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
      {(subtitle || trend) && (
        <div className="mt-3 pt-2.5 border-t border-theme-border/50 flex items-center justify-between text-xs text-gray-500">
          <span>{subtitle}</span>
          {trend && <span className="font-medium text-emerald-600">{trend}</span>}
        </div>
      )}
    </div>
  );
}

export default PageHeader;

