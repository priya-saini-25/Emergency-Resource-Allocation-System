import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import LoadingSpinner from '../ui/LoadingSpinner.jsx';

/**
 * Route protection guard ensuring authentication and role-based authorization.
 *
 * @param {React.ReactNode} children - Protected component
 * @param {string[]} [allowedRoles] - Roles permitted on this route
 */
export function ProtectedRoute({ children, allowedRoles = [] }) {
  const { isAuthenticated, role, isInitializing } = useAuth();
  const location = useLocation();

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-theme-bg flex flex-col items-center justify-center p-4">
        <LoadingSpinner size="lg" />
        <p className="text-xs text-gray-500 font-medium mt-3">Verifying authentication session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login preserving intended target in state.from
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    // User is authenticated but lacks required role -> redirect to their authorized home
    if (role === 'CITIZEN') {
      return <Navigate to="/citizen/dashboard" replace />;
    }
    return <Navigate to="/control-room/dashboard" replace />;
  }

  return children;
}

export default ProtectedRoute;
