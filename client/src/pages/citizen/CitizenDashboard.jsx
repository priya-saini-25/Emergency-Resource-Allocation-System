import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { useMyIncidents } from '../../hooks/useMyIncidents.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState.jsx';
import {
  AlertTriangle,
  FileText,
  Activity,
  CheckCircle2,
  Clock,
  MapPin,
  ChevronRight,
  ShieldAlert,
  PlusCircle,
  RotateCw,
  Inbox,
  ExternalLink,
} from 'lucide-react';

export function CitizenDashboard() {
  const { user } = useAuth();
  const { incidents, pagination, isLoading, error, refetch } = useMyIncidents({ page: 1, limit: 5 });

  // Calculate live statistics from backend incident records
  // Non-terminal active lifecycle states include ALLOCATED alongside REPORTED, VERIFIED, DISPATCHED, ON_SCENE.
  // Note: QUEUED was audited and verified to be a schema-level enum rather than an implemented transition.
  // Explicitly excludes terminal statuses: RESOLVED, REJECTED, CANCELLED.
  const ACTIVE_LIFECYCLE_STATUSES = ['REPORTED', 'VERIFIED', 'ALLOCATED', 'DISPATCHED', 'ON_SCENE'];
  const TERMINAL_STATUSES = ['RESOLVED', 'REJECTED', 'CANCELLED'];

  const totalReportsCount = pagination ? pagination.totalCount : incidents.length;
  const activeEmergenciesCount = incidents.filter(
    (inc) =>
      inc &&
      inc.status &&
      ACTIVE_LIFECYCLE_STATUSES.includes(inc.status) &&
      !TERMINAL_STATUSES.includes(inc.status)
  ).length;
  const resolvedCount = incidents.filter((inc) => inc && inc.status === 'RESOLVED').length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title={`Welcome, ${user?.name || 'Citizen'}`}
        subtitle="Citizen Emergency Dispatch Service Portal · Jodhpur Urban Service Area"
        badge={<Badge variant="primary">Real-Time Intake</Badge>}
        actions={
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              icon={RotateCw}
              onClick={() => refetch()}
              disabled={isLoading}
            >
              Refresh
            </Button>
            <Link to="/citizen/report-emergency">
              <Button variant="danger" icon={AlertTriangle} size="md">
                Report Emergency Incident
              </Button>
            </Link>
          </div>
        }
      />

      {/* Mandatory Academic Disclaimer Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
          <span>
            <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> This system is an academic research prototype. In actual life-threatening situations, dial local emergency services (112, 101, 108).
          </span>
        </div>
        <Badge variant="warning" size="sm">Academic Prototype</Badge>
      </div>

      {/* Dynamic Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Reports Submitted"
          value={isLoading ? '...' : totalReportsCount.toString()}
          subtitle="Lifetime citizen reports registered"
          icon={FileText}
          indicatorColor="#789CB8"
        />
        <StatCard
          title="Active Emergencies"
          value={isLoading ? '...' : activeEmergenciesCount.toString()}
          subtitle="Currently reported, dispatched, or on-scene"
          icon={Activity}
          indicatorColor="#E89543"
          trend={activeEmergenciesCount > 0 ? `${activeEmergenciesCount} Active` : undefined}
        />
        <StatCard
          title="Resolved Incidents"
          value={isLoading ? '...' : resolvedCount.toString()}
          subtitle="Successfully de-escalated and closed"
          icon={CheckCircle2}
          indicatorColor="#56866B"
        />
      </div>

      {/* Main Content Grid: Recent Reports + Civic Advisory */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Incident Feed */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <Card.Header
              title="Your Recent Emergency Reports"
              subtitle="Live chronological feed of incidents registered under your account"
              action={
                <Link
                  to="/citizen/my-incidents"
                  className="text-xs font-semibold text-theme-heading hover:underline flex items-center"
                >
                  <span>View All Reports</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Link>
              }
            />

            {isLoading ? (
              <div className="p-6 space-y-4">
                <Skeleton count={3} variant="card" className="h-20" />
              </div>
            ) : error ? (
              <div className="p-6">
                <ErrorState
                  title="Unable to load recent reports"
                  message={error.message || 'Error communicating with incident service.'}
                  onRetry={refetch}
                />
              </div>
            ) : incidents.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Inbox}
                  title="No Emergency Reports Registered"
                  description="You have not submitted any emergency incidents yet. Once reported, your incidents will appear here with live dispatch updates."
                  action={
                    <Link to="/citizen/report-emergency">
                      <Button variant="primary" size="sm" icon={PlusCircle}>
                        Report Emergency Incident
                      </Button>
                    </Link>
                  }
                />
              </div>
            ) : (
              <div className="divide-y divide-theme-border">
                {incidents.map((report) => (
                  <div
                    key={report.incidentId}
                    className="p-4 hover:bg-theme-bg/50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center space-x-2">
                        <Link
                          to={`/citizen/incidents/${report.incidentId}`}
                          className="font-bold text-xs text-theme-heading hover:underline font-mono"
                        >
                          Incident #{report.incidentId}
                        </Link>
                        <span className="text-[10px] font-semibold text-gray-600 uppercase px-1.5 py-0.5 bg-gray-100 rounded">
                          {report.category ? report.category.replace(/_/g, ' ') : 'EMERGENCY'}
                        </span>
                      </div>
                      <StatusBadge status={report.status} />
                    </div>

                    <p className="text-xs text-gray-700 leading-relaxed line-clamp-2 mb-2 font-sans">
                      {report.description || 'No descriptive details provided.'}
                    </p>

                    <div className="flex flex-wrap items-center justify-between text-[11px] text-gray-500 gap-2">
                      <div className="flex items-center space-x-1.5 font-mono">
                        <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <span>
                          {report.location
                            ? `${report.location.latitude?.toFixed(4)}° N, ${report.location.longitude?.toFixed(4)}° E`
                            : 'Coordinates logged'}
                        </span>
                      </div>

                      <div className="flex items-center space-x-3">
                        <div className="flex items-center space-x-1">
                          <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <span>
                            {report.reportedAt
                              ? new Date(report.reportedAt).toLocaleString('en-IN', {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })
                              : 'Recently'}
                          </span>
                        </div>
                        <Link
                          to={`/citizen/incidents/${report.incidentId}`}
                          className="text-theme-primary font-semibold hover:underline inline-flex items-center"
                        >
                          <span>Track</span>
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Civic Advisory & Boundaries Guide */}
        <div className="space-y-4">
          <Card>
            <Card.Header title="Urban Jurisdiction Scope" />
            <Card.Body className="space-y-3 text-xs text-gray-600">
              <p>
                Emergency dispatch services are bounded to the <strong>Jodhpur Urban Service Area</strong> (OSM Settlement Boundary Way 31725312).
              </p>
              <div className="p-3 bg-theme-bg rounded-lg border border-theme-border space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-500">Service Perimeter:</span>
                  <span className="font-medium text-theme-heading">117.68 km²</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Geographic Center:</span>
                  <span className="font-medium text-theme-heading">26.2918° N, 73.0168° E</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Response Hub:</span>
                  <span className="font-medium text-theme-heading">Jodhpur Central</span>
                </div>
              </div>
              <p className="text-[11px] text-gray-500">
                Incidents reported outside the settlement polygon will be rejected by the spatial validation engine.
              </p>
            </Card.Body>
          </Card>

          <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-slate-700">
            <Card.Body className="space-y-2">
              <div className="flex items-center space-x-2 text-theme-secondary">
                <AlertTriangle className="w-4 h-4 text-emergency-high" />
                <span className="font-bold text-xs uppercase tracking-wider">Life-Threatening Emergency?</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                In a real crisis, always contact local emergency services immediately (Police: 112, Fire: 101, Ambulance: 108).
              </p>
            </Card.Body>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default CitizenDashboard;
