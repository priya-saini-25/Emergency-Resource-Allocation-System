import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import ToastContainer from './components/ui/ToastContainer.jsx';
import OperatorEmergencyPopup from './components/ui/OperatorEmergencyPopup.jsx';
import ProtectedRoute from './components/common/ProtectedRoute.jsx';
import PublicOnlyRoute from './components/common/PublicOnlyRoute.jsx';
import LoadingSpinner from './components/ui/LoadingSpinner.jsx';

// Layouts
import PublicLayout from './layouts/PublicLayout.jsx';
import CitizenLayout from './layouts/CitizenLayout.jsx';
import ControlRoomLayout from './layouts/ControlRoomLayout.jsx';

// Public Pages
import LoginPage from './pages/auth/LoginPage.jsx';
import RegisterPage from './pages/auth/RegisterPage.jsx';

// Citizen Pages
import CitizenDashboard from './pages/citizen/CitizenDashboard.jsx';
import CitizenReportEmergency from './pages/citizen/CitizenReportEmergency.jsx';
import CitizenMyIncidents from './pages/citizen/CitizenMyIncidents.jsx';
import CitizenIncidentDetail from './pages/citizen/CitizenIncidentDetail.jsx';

// Control Room Pages
import ControlRoomDashboard from './pages/control-room/ControlRoomDashboard.jsx';
import IncidentQueuePage from './pages/control-room/IncidentQueuePage.jsx';
import ControlRoomIncidentDetailPage from './pages/control-room/ControlRoomIncidentDetailPage.jsx';
import DispatchPlannerPage from './pages/control-room/DispatchPlannerPage.jsx';
import ActiveOperationsPage from './pages/control-room/ActiveOperationsPage.jsx';
import ResourceFleetPage from './pages/control-room/ResourceFleetPage.jsx';
import HospitalNetworkPage from './pages/control-room/HospitalNetworkPage.jsx';
import TacticalMapPage from './pages/control-room/TacticalMapPage.jsx';

/**
 * Root index redirector based on authenticated role
 */
function RootRedirect() {
  const { isAuthenticated, role, isInitializing } = useAuth();

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-theme-bg flex flex-col items-center justify-center p-4">
        <LoadingSpinner size="lg" />
        <p className="text-xs text-gray-500 font-medium mt-3">Initializing emergency management system...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (role === 'CITIZEN') {
    return <Navigate to="/citizen/dashboard" replace />;
  }

  return <Navigate to="/control-room/dashboard" replace />;
}

export function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <BrowserRouter>
          <ToastContainer />
          <OperatorEmergencyPopup />
          <Routes>
          {/* Root Redirect */}
          <Route path="/" element={<RootRedirect />} />

          {/* Public Authentication Routes (Redirects authenticated users away) */}
          <Route
            element={
              <PublicOnlyRoute>
                <PublicLayout />
              </PublicOnlyRoute>
            }
          >
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>

          {/* Citizen Protected Routes */}
          <Route
            element={
              <ProtectedRoute allowedRoles={['CITIZEN', 'ADMIN']}>
                <CitizenLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/citizen/dashboard" element={<CitizenDashboard />} />
            <Route path="/citizen/report-emergency" element={<CitizenReportEmergency />} />
            <Route path="/citizen/my-incidents" element={<CitizenMyIncidents />} />
            <Route path="/citizen/incidents/:incidentId" element={<CitizenIncidentDetail />} />
          </Route>

          {/* Control Room Protected Routes */}
          <Route
            element={
              <ProtectedRoute allowedRoles={['OPERATOR', 'ADMIN']}>
                <ControlRoomLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/control-room/dashboard" element={<ControlRoomDashboard />} />
            <Route path="/control-room/incidents" element={<IncidentQueuePage />} />
            <Route path="/control-room/incidents/:incidentId" element={<ControlRoomIncidentDetailPage />} />
            <Route path="/control-room/dispatch" element={<DispatchPlannerPage />} />
            <Route path="/control-room/active-incidents" element={<ActiveOperationsPage />} />
            <Route path="/control-room/resources" element={<ResourceFleetPage />} />
            <Route path="/control-room/hospitals" element={<HospitalNetworkPage />} />
            <Route path="/control-room/map" element={<TacticalMapPage />} />
          </Route>

          {/* Catch-all fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </NotificationProvider>
  </AuthProvider>
  );
}

export default App;
