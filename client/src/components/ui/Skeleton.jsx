import React from 'react';

export function Skeleton({ className = '', variant = 'text', count = 1 }) {
  const variantClasses = {
    text: 'h-4 w-full rounded',
    title: 'h-6 w-3/4 rounded-md',
    avatar: 'h-10 w-10 rounded-full',
    card: 'h-36 w-full rounded-xl',
    tableRow: 'h-12 w-full rounded',
  }[variant] || 'h-4 w-full rounded';

  return (
    <>
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className={`animate-pulse bg-gray-200/80 ${variantClasses} ${className}`}
        />
      ))}
    </>
  );
}

export default Skeleton;

