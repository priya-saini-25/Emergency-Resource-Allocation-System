import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import LoadingSpinner from '../ui/LoadingSpinner.jsx';

/**
 * Route guard that redirects already authenticated users away from public auth pages (/login, /register)
 * to their respective role-authorized dashboard.
 */
export function PublicOnlyRoute({ children }) {
  const { isAuthenticated, role, isInitializing } = useAuth();

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-theme-bg flex flex-col items-center justify-center p-4">
        <LoadingSpinner size="lg" />
        <p className="text-xs text-gray-500 font-medium mt-3">Checking authentication state...</p>
      </div>
    );
  }

  if (isAuthenticated && role) {
    if (role === 'CITIZEN') {
      return <Navigate to="/citizen/dashboard" replace />;
    }
    return <Navigate to="/control-room/dashboard" replace />;
  }

  return children;
}

export default PublicOnlyRoute;

