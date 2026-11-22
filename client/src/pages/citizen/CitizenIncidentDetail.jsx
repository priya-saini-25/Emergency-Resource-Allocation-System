import React from 'react';
import { useParams, Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import StatusBadge, { SeverityBadge } from '../../components/ui/StatusBadge.jsx';
import Button from '../../components/ui/Button.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { ErrorState } from '../../components/ui/EmptyState.jsx';
import MapContainer from '../../components/map/MapContainer.jsx';
import { useIncidentDetail } from '../../hooks/useIncidentDetail.js';
import {
  ArrowLeft,
  Clock,
  MapPin,
  ShieldAlert,
  RotateCw,
  CheckCircle2,
  Radio,
  Truck,
  Check,
  XCircle,
  AlertTriangle,
  Info,
  Ban,
} from 'lucide-react';

import {
  PROGRESSION_STAGES,
  getStageTimestamp,
} from '../../utils/incidentLifecycle.js';

export function CitizenIncidentDetail() {
  const { incidentId } = useParams();
  const { incident, isLoading, error, refetch } = useIncidentDetail(incidentId);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center space-x-2">
          <Link to="/citizen/my-incidents">
            <Button variant="ghost" size="sm" icon={ArrowLeft}>
              Back to My Reports
            </Button>
          </Link>
        </div>
        <div className="space-y-3">
          <Skeleton variant="title" className="w-1/3" />
          <Skeleton variant="text" className="w-1/2" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-4">
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </div>
          <div>
            <Skeleton variant="card" className="h-64" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    const isForbidden = error.status === 403 || error.code === 'FORBIDDEN';
    const isNotFound = error.status === 404 || error.code === 'INCIDENT_NOT_FOUND';

    return (
      <div className="space-y-6 max-w-2xl mx-auto py-8">
        <div className="flex items-center space-x-2">
          <Link to="/citizen/my-incidents">
            <Button variant="ghost" size="sm" icon={ArrowLeft}>
              Back to My Reports
            </Button>
          </Link>
        </div>

        <ErrorState
          icon={isForbidden ? ShieldAlert : isNotFound ? AlertTriangle : undefined}
          title={
            isForbidden
              ? 'Access Forbidden (Unauthorized Report)'
              : isNotFound
              ? `Incident #${incidentId} Not Found`
              : 'Unable to Load Incident Details'
          }
          message={
            isForbidden
              ? 'You do not have permission to inspect this incident report. In accordance with privacy and access controls, citizen tracking is strictly limited to the reporting account.'
              : isNotFound
              ? `No emergency incident matching ID #${incidentId} was located in the Jodhpur Urban Service Area database.`
              : error.message || 'An unexpected error occurred while communicating with the backend.'
          }
          onRetry={!isForbidden && !isNotFound ? refetch : undefined}
        />
      </div>
    );
  }

  if (!incident) {
    return null;
  }

  // Format timestamps without fabricating
  const formatTime = (ts) => {
    if (!ts) return null;
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleString('en-IN', {
        dateStyle: 'short',
        timeStyle: 'medium',
      });
    } catch {
      return null;
    }
  };

  const coordinates = incident.location
    ? [incident.location.latitude, incident.location.longitude]
    : null;

  // Lifecycle progression state calculation
  const currentStatus = incident.status;
  const isRejected = currentStatus === 'REJECTED';
  const isCancelled = currentStatus === 'CANCELLED';

  const timelineSteps = [
    {
      id: 'REPORTED',
      label: 'Incident Reported',
      sublabel: 'Logged in intake database',
      timestamp: getStageTimestamp(incident, 'REPORTED'),
      icon: Radio,
    },
    {
      id: 'VERIFIED',
      label: 'Control Room Verified',
      sublabel: incident.verificationNotes
        ? `Notes: ${incident.verificationNotes}`
        : 'Confirmed by operator',
      timestamp: getStageTimestamp(incident, 'VERIFIED'),
      icon: CheckCircle2,
    },
    {
      id: 'ALLOCATED',
      label: 'Resources Allocated',
      sublabel: 'Decision engine recommendation assigned',
      timestamp: getStageTimestamp(incident, 'ALLOCATED'),
      icon: CheckCircle2,
    },
    {
      id: 'DISPATCHED',
      label: 'Emergency Units Dispatched',
      sublabel: 'First responders mobilized in transit',
      timestamp: getStageTimestamp(incident, 'DISPATCHED'),
      icon: Truck,
    },
    {
      id: 'ON_SCENE',
      label: 'Units On Scene',
      sublabel: 'Responders arrived at incident location',
      timestamp: getStageTimestamp(incident, 'ON_SCENE'),
      icon: MapPin,
    },
    {
      id: 'RESOLVED',
      label: 'Incident Resolved',
      sublabel: 'Situation de-escalated and closed',
      timestamp: getStageTimestamp(incident, 'RESOLVED'),
      icon: Check,
    },
  ];

  const activeIndex = PROGRESSION_STAGES.indexOf(currentStatus);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link to="/citizen/my-incidents">
          <Button variant="ghost" size="sm" icon={ArrowLeft}>
            Back to My Reports
          </Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          icon={RotateCw}
          onClick={refetch}
        >
          Refresh Status
        </Button>
      </div>

      {/* Page Header */}
      <PageHeader
        title={`Incident #${incident.incidentId}`}
        subtitle="Citizen Tracking View · Role-Sanitized Operational Progression"
        badge={<StatusBadge status={incident.status} size="lg" />}
      />

      {/* Academic Disclaimer Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-center space-x-2">
        <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
        <span>
          <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> Displaying simulated operational state within the Jodhpur Urban Service Area academic proxy.
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Incident Summary Panel */}
        <div className="md:col-span-2 space-y-6">
          <Card>
            <Card.Header
              title="Incident Summary"
              subtitle="User-reported incident details registered with control room"
            />
            <Card.Body className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-semibold block">
                    Category
                  </span>
                  <p className="text-sm font-bold text-theme-heading mt-0.5 uppercase tracking-wide">
                    {incident.category ? incident.category.replace(/_/g, ' ') : '—'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-semibold block">
                    Reported Severity
                  </span>
                  <div className="mt-1">
                    <SeverityBadge severity={incident.severity} />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-semibold block">
                    Estimated Victims
                  </span>
                  <p className="text-sm font-bold text-theme-heading mt-0.5">
                    {incident.victimCount ?? 0} Reported
                  </p>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-gray-500 uppercase font-semibold block mb-1">
                  Reported Situation Description
                </span>
                <p className="text-xs text-gray-700 leading-relaxed bg-theme-bg p-3.5 rounded-lg border border-theme-border font-sans">
                  {incident.description || 'No descriptive details provided.'}
                </p>
              </div>

              {/* Coordinates and Timestamps */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-theme-border/60 text-xs text-gray-600">
                <div className="flex items-center space-x-2">
                  <MapPin className="w-4 h-4 text-theme-primary flex-shrink-0" />
                  <span className="font-mono">
                    {incident.location
                      ? `${incident.location.latitude?.toFixed(5)}° N, ${incident.location.longitude?.toFixed(5)}° E`
                      : 'Coordinates not recorded'}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-theme-primary flex-shrink-0" />
                  <span>Reported: {formatTime(incident.reportedAt) || 'Timestamp pending'}</span>
                </div>
              </div>
            </Card.Body>
          </Card>

          {/* Incident Location Map Preview */}
          {coordinates && (
            <Card>
              <Card.Header
                title="Location Map"
                subtitle="Incident location inside Jodhpur Urban Service Area"
              />
              <div className="p-4">
                <MapContainer
                  height="260px"
                  center={coordinates}
                  selectedLocation={coordinates}
                  showDefaultMarker={false}
                  showBoundaryPolygon={true}
                  zoom={14}
                  markerTitle={`Incident #${incident.incidentId}`}
                />
              </div>
            </Card>
          )}
        </div>

        {/* Operational Timeline Progression */}
        <div>
          <Card>
            <Card.Header
              title="Dispatch Progression"
              subtitle="Operational milestone lifecycle"
            />
            <Card.Body>
              {isRejected ? (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-2 text-xs">
                  <div className="flex items-center space-x-2 text-red-700 font-bold">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    <span>Report Rejected / False Alarm</span>
                  </div>
                  <p className="text-red-600">
                    This incident was evaluated by control room operators and marked as rejected.
                  </p>
                  {incident.rejectionReason && (
                    <div className="pt-2 border-t border-red-200">
                      <span className="font-semibold block text-[10px] uppercase text-red-800">
                        Reason:
                      </span>
                      <p className="italic text-red-700 mt-0.5">{incident.rejectionReason}</p>
                    </div>
                  )}
                  {getStageTimestamp(incident, 'REJECTED') && (
                    <span className="text-[11px] text-red-500 block pt-1">
                      Rejected at: {formatTime(getStageTimestamp(incident, 'REJECTED'))}
                    </span>
                  )}
                </div>
              ) : isCancelled ? (
                <div className="p-4 bg-gray-50 border border-gray-300 rounded-lg space-y-2 text-xs">
                  <div className="flex items-center space-x-2 text-gray-700 font-bold">
                    <Ban className="w-4 h-4 flex-shrink-0" />
                    <span>Report Cancelled</span>
                  </div>
                  <p className="text-gray-600">
                    This emergency report was cancelled prior to on-scene responder deployment.
                  </p>
                  {incident.cancellationReason && (
                    <div className="pt-2 border-t border-gray-200">
                      <span className="font-semibold block text-[10px] uppercase text-gray-700">
                        Reason:
                      </span>
                      <p className="italic text-gray-600 mt-0.5">{incident.cancellationReason}</p>
                    </div>
                  )}
                  {getStageTimestamp(incident, 'CANCELLED') && (
                    <span className="text-[11px] text-gray-500 block pt-1">
                      Cancelled at: {formatTime(getStageTimestamp(incident, 'CANCELLED'))}
                    </span>
                  )}
                </div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-theme-border">
                  {timelineSteps.map((step, idx) => {
                    const isStepPast = activeIndex > idx;
                    const isStepCurrent = activeIndex === idx;
                    const isStepFuture = activeIndex < idx;
                    const formattedStepTime = formatTime(step.timestamp);

                    return (
                      <div key={step.id} className={`relative ${isStepFuture ? 'opacity-40' : ''}`}>
                        {/* Milestone Indicator Dot */}
                        {isStepPast ? (
                          <span
                            data-testid={`stage-${step.id}-completed`}
                            className="absolute -left-6 top-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-white flex items-center justify-center text-white text-[8px]"
                          />
                        ) : isStepCurrent ? (
                          <span
                            data-testid={`stage-${step.id}-current`}
                            className="absolute -left-6 top-0.5 w-3 h-3 rounded-full bg-blue-500 ring-4 ring-blue-100 animate-pulse"
                          />
                        ) : (
                          <span
                            data-testid={`stage-${step.id}-pending`}
                            className="absolute -left-6 top-0.5 w-3 h-3 rounded-full bg-gray-300 ring-4 ring-white"
                          />
                        )}

                        <div className="space-y-0.5">
                          <span
                            className={`text-xs font-bold block ${
                              isStepCurrent
                                ? 'text-blue-700'
                                : isStepPast
                                ? 'text-theme-heading'
                                : 'text-gray-400'
                            }`}
                          >
                            {step.label}
                          </span>
                          <span className="text-[11px] text-gray-500 block">
                            {step.sublabel}
                          </span>
                          {/* Never fabricate dates: render only when timestamp is genuinely available */}
                          {formattedStepTime ? (
                            <span className="text-[10px] text-gray-400 font-mono block">
                              {formattedStepTime}
                            </span>
                          ) : (
                            isStepCurrent && (
                              <span className="text-[10px] text-blue-500 font-medium block">
                                In Progress
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-theme-border/60 text-[11px] text-gray-400 flex items-center space-x-1">
                <Info className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Internal operator details and triage metrics are masked for citizen privacy.</span>
              </div>
            </Card.Body>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default CitizenIncidentDetail;
