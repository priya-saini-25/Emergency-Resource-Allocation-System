import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import StatusBadge, { SeverityBadge } from '../../components/ui/StatusBadge.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Input from '../../components/ui/Input.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { ErrorState } from '../../components/ui/EmptyState.jsx';
import MapContainer from '../../components/map/MapContainer.jsx';
import incidentService from '../../services/incidentService.js';
import { useControlRoomIncidentDetail } from '../../hooks/useControlRoomIncidentDetail.js';
import { useIncidentVerification } from '../../hooks/useIncidentVerification.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { PROGRESSION_STAGES, getStageTimestamp } from '../../utils/incidentLifecycle.js';
import {
  ArrowLeft,
  Clock,
  MapPin,
  ShieldAlert,
  RotateCw,
  CheckCircle2,
  XCircle,
  User,
  Mail,
  AlertTriangle,
  History,
  Radio,
  Truck,
  Check,
  Ban,
  FileText,
  Phone,
  PhoneCall,
  PhoneOff,
  Copy,
  HelpCircle,
  ShieldCheck,
  Navigation,
} from 'lucide-react';

export function ControlRoomIncidentDetailPage() {
  const { incidentId } = useParams();
  const { incident, isLoading, error, refetch } = useControlRoomIncidentDetail(incidentId);
  const { success, warning, error: toastError } = useNotification();
  const {
    verify,
    reject,
    recordVerification,
    isActionPending,
    actionError,
    actionSuccess,
    resetActionState,
  } = useIncidentVerification();

  // Structured Verification Modal States
  const [verificationModalOpen, setVerificationModalOpen] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState('CONFIRMED');
  const [verificationNotes, setVerificationNotes] = useState('');
  const [duplicateOfIncidentId, setDuplicateOfIncidentId] = useState('');
  const [proceedWithDispatch, setProceedWithDispatch] = useState(false);
  const [modalClientError, setModalClientError] = useState(null);

  // Manual Call Attempt Modal State
  const [callAttemptModalOpen, setCallAttemptModalOpen] = useState(false);
  const [callOutcome, setCallOutcome] = useState('ANSWERED');
  const [callNotes, setCallNotes] = useState('');
  const [isSubmittingCall, setIsSubmittingCall] = useState(false);
  const [callModalError, setCallModalError] = useState(null);
  const [callActionSuccess, setCallActionSuccess] = useState(null);

  const handleOpenCallAttemptModal = () => {
    setCallOutcome('ANSWERED');
    setCallNotes('');
    setCallModalError(null);
    setCallAttemptModalOpen(true);
  };

  const handleSubmitCallAttempt = async () => {
    setIsSubmittingCall(true);
    setCallModalError(null);
    try {
      await incidentService.recordCallAttempt(incidentId, {
        outcome: callOutcome,
        notes: callNotes.trim(),
      });
      setCallAttemptModalOpen(false);
      setCallActionSuccess(`Manual call attempt logged (${callOutcome}). Incident verification status was strictly preserved.`);
      refetch();
    } catch (err) {
      setCallModalError(err.message || 'Failed to record call attempt');
    } finally {
      setIsSubmittingCall(false);
    }
  };

  // Per-Resource Arrival Modal State
  const [resourceArrivalModalOpen, setResourceArrivalModalOpen] = useState(false);
  const [selectedUnitForArrival, setSelectedUnitForArrival] = useState(null);
  const [arrivalVerificationMethod, setArrivalVerificationMethod] = useState('RADIO');
  const [unitArrivalNotes, setUnitArrivalNotes] = useState('');
  const [isSubmittingArrival, setIsSubmittingArrival] = useState(false);
  const [unitArrivalError, setUnitArrivalError] = useState(null);

  const handleOpenUnitArrival = (unit) => {
    setSelectedUnitForArrival(unit);
    setArrivalVerificationMethod('RADIO');
    setUnitArrivalNotes('');
    setUnitArrivalError(null);
    setResourceArrivalModalOpen(true);
  };

  const handleSubmitUnitArrival = async () => {
    if (!selectedUnitForArrival) return;
    setIsSubmittingArrival(true);
    setUnitArrivalError(null);
    try {
      await incidentService.markResourceArrived(incidentId, selectedUnitForArrival.resourceId, {
        verificationMethod: arrivalVerificationMethod,
        arrivalNotes: unitArrivalNotes.trim(),
      });
      setResourceArrivalModalOpen(false);
      refetch();
    } catch (err) {
      setUnitArrivalError(err.message || 'Failed to record unit arrival');
    } finally {
      setIsSubmittingArrival(false);
    }
  };

  const handleOpenVerificationModal = (initialOutcome = 'CONFIRMED') => {
    resetActionState();
    setSelectedOutcome(initialOutcome);
    setVerificationNotes('');
    setDuplicateOfIncidentId('');
    setProceedWithDispatch(false);
    setModalClientError(null);
    setVerificationModalOpen(true);
  };

  const handleConfirmStructuredVerification = async () => {
    if (selectedOutcome === 'REJECTED') {
      if (!verificationNotes.trim() || verificationNotes.trim().length < 3) {
        setModalClientError('Rejection reason must be at least 3 characters');
        return;
      }
    }
    if (selectedOutcome === 'DUPLICATE') {
      const dupNum = Number(duplicateOfIncidentId);
      if (!Number.isInteger(dupNum) || dupNum < 1) {
        setModalClientError('A valid positive integer is required for Duplicate Incident ID');
        return;
      }
      if (dupNum === Number(incident.incidentId)) {
        setModalClientError('An incident cannot be marked as duplicate of itself');
        return;
      }
    }

    try {
      await recordVerification(incidentId, {
        outcome: selectedOutcome,
        notes: verificationNotes,
        duplicateOfIncidentId: selectedOutcome === 'DUPLICATE' ? Number(duplicateOfIncidentId) : undefined,
        proceedWithDispatch,
      });
      if (selectedOutcome === 'REJECTED') {
        warning('Emergency report rejected.');
      } else {
        success('Incident verified successfully.');
      }
      setVerificationModalOpen(false);
      refetch();
    } catch (err) {
      toastError(err.message || 'Verification action failed');
      setModalClientError(err.message || 'Verification action failed');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center space-x-2">
          <Link to="/control-room/incidents">
            <Button variant="ghost" size="sm" icon={ArrowLeft}>
              Back to Incident Queue
            </Button>
          </Link>
        </div>
        <Skeleton variant="title" className="w-1/3" />
        <Skeleton variant="text" className="w-1/2" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
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
    const isNotFound = error.status === 404 || error.code === 'INCIDENT_NOT_FOUND';
    return (
      <div className="space-y-6 max-w-3xl mx-auto py-8">
        <Link to="/control-room/incidents">
          <Button variant="ghost" size="sm" icon={ArrowLeft}>
            Back to Incident Queue
          </Button>
        </Link>
        <ErrorState
          icon={AlertTriangle}
          title={isNotFound ? `Incident #${incidentId} Not Found` : 'Failed to Load Incident Detail'}
          message={
            isNotFound
              ? `No emergency incident matching #${incidentId} exists in the control room registry.`
              : error.message || 'Error communicating with control-room API.'
          }
          onRetry={!isNotFound ? refetch : undefined}
        />
      </div>
    );
  }

  if (!incident) return null;

  const coordinates = incident.location
    ? [incident.location.latitude, incident.location.longitude]
    : null;

  const currentStatus = incident.status;
  const isReported = currentStatus === 'REPORTED';
  const isRejected = currentStatus === 'REJECTED';
  const isCancelled = currentStatus === 'CANCELLED';

  const activeIndex = PROGRESSION_STAGES.indexOf(currentStatus);

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

  const timelineSteps = [
    {
      id: 'REPORTED',
      label: 'Incident Reported',
      sublabel: 'Citizen intake recorded',
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
      sublabel: incident.dispatchedBatchId
        ? `Batch: ${incident.dispatchedBatchId}`
        : 'Recommendation computed',
      timestamp: getStageTimestamp(incident, 'ALLOCATED'),
      icon: CheckCircle2,
    },
    {
      id: 'DISPATCHED',
      label: 'Units Dispatched',
      sublabel: incident.dispatchId ? `Dispatch #${incident.dispatchId}` : 'Units mobilized',
      timestamp: getStageTimestamp(incident, 'DISPATCHED'),
      icon: Truck,
    },
    {
      id: 'ON_SCENE',
      label: 'Units On Scene',
      sublabel: 'Responders arrived on scene',
      timestamp: getStageTimestamp(incident, 'ON_SCENE'),
      icon: MapPin,
    },
    {
      id: 'RESOLVED',
      label: 'Incident Resolved',
      sublabel: 'Scene cleared and hospital handover',
      timestamp: getStageTimestamp(incident, 'RESOLVED'),
      icon: Check,
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Navigation & Status Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/control-room/incidents">
          <Button variant="ghost" size="sm" icon={ArrowLeft}>
            Back to Queue
          </Button>
        </Link>

        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" icon={RotateCw} onClick={refetch}>
            Refresh
          </Button>

          {/* Actionable Operators Controls (REPORTED only) */}
          {isReported && (
            <div className="flex items-center space-x-2">
              <Button
                variant="primary"
                size="sm"
                icon={CheckCircle2}
                onClick={() => handleOpenVerificationModal('CONFIRMED')}
                disabled={isActionPending}
              >
                Verify Incident
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={PhoneOff}
                onClick={() => handleOpenVerificationModal('UNABLE_TO_CONTACT')}
                disabled={isActionPending}
              >
                Log Contact Attempt
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={XCircle}
                onClick={() => handleOpenVerificationModal('REJECTED')}
                disabled={isActionPending}
              >
                Reject Incident
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Action Notification Banners */}
      {callActionSuccess && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <span className="font-semibold">{callActionSuccess}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setCallActionSuccess(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span className="font-semibold">{actionSuccess.message}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={resetActionState}>
            Dismiss
          </Button>
        </div>
      )}

      {actionError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 flex items-start space-x-2">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <strong className="block font-semibold">Action Failed:</strong>
            <span>
              {actionError.code === 'INCIDENT_STATE_CONFLICT'
                ? `Conflict: Incident #${incidentId} is in status '${actionError.currentStatus || incident.status}', but only REPORTED incidents can be modified.`
                : actionError.message || 'An error occurred during verification.'}
            </span>
          </div>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title={`Incident #${incident.incidentId}`}
        subtitle="Operator Incident Review & Verification View · Jodhpur Urban Service Area"
        badge={
          <div className="flex items-center space-x-2">
            <StatusBadge status={incident.status} size="lg" />
            {incident.priorityTier && (
              <Badge variant="primary" size="lg">
                Tier: {incident.priorityTier}
              </Badge>
            )}
          </div>
        }
      />

      {/* Academic Simulation Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-center space-x-2">
        <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
        <span>
          <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> Control-room incident assessment prototype within the Jodhpur Urban Service Area proxy.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Incident Details Card */}
          <Card>
            <Card.Header
              title="Incident Specifications"
              subtitle="Authenticated citizen intake data"
            />
            <Card.Body className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-3.5 bg-theme-bg rounded-lg border border-theme-border text-xs">
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-semibold block">Category</span>
                  <p className="text-sm font-bold text-theme-heading mt-0.5 uppercase tracking-wide">
                    {incident.category?.replace(/_/g, ' ')}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-semibold block">Severity</span>
                  <div className="mt-1">
                    <SeverityBadge severity={incident.severity} />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-semibold block">Casualties</span>
                  <p className="text-sm font-bold text-theme-heading mt-0.5">
                    {incident.victimCount ?? 0} Reported
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-semibold block">Priority Score</span>
                  <p className="text-sm font-bold text-theme-heading mt-0.5">
                    {incident.priorityScore !== null && incident.priorityScore !== undefined
                      ? `${incident.priorityScore.toFixed(1)} / 100`
                      : 'Pending Evaluation'}
                  </p>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-gray-500 uppercase font-semibold block mb-1">
                  Reported Situation Description
                </span>
                <p className="text-xs text-gray-800 leading-relaxed bg-white p-3.5 rounded-lg border border-theme-border font-sans">
                  {incident.description || 'No descriptive details provided by reporting citizen.'}
                </p>
              </div>

              {/* Location Name (if provided via search) */}
              {incident.locationName && (
                <div className="pt-3 border-t border-theme-border/60">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold block mb-1">
                    Citizen Place-Name Reference
                  </span>
                  <div className="flex items-center space-x-2 text-xs text-theme-heading font-semibold bg-theme-bg/60 p-2.5 rounded-lg border border-theme-border">
                    <MapPin className="w-4 h-4 text-theme-primary flex-shrink-0" />
                    <span>{incident.locationName}</span>
                  </div>
                </div>
              )}

              {/* Coordinates and Timestamps */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-theme-border/60 text-xs text-gray-600">
                <div className="flex items-center space-x-2">
                  <MapPin className="w-4 h-4 text-theme-primary flex-shrink-0" />
                  <span className="font-mono">
                    {coordinates ? `${coordinates[0].toFixed(5)}° N, ${coordinates[1].toFixed(5)}° E` : 'Coordinates missing'}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-theme-primary flex-shrink-0" />
                  <span>Reported: {formatTime(incident.reportedAt) || 'Timestamp missing'}</span>
                </div>
              </div>
            </Card.Body>
          </Card>

          {/* Citizen Reporter Information Card */}
          <Card>
            <Card.Header
              title="Citizen Reporter Information"
              subtitle="Contact details for incident verification and first-responder briefing"
              action={
                incident.latestVerificationOutcome && (
                  <Badge
                    variant={
                      incident.latestVerificationOutcome === 'CONFIRMED'
                        ? 'success'
                        : incident.latestVerificationOutcome === 'UNABLE_TO_CONTACT'
                        ? 'warning'
                        : incident.latestVerificationOutcome === 'INFORMATION_REQUIRED'
                        ? 'primary'
                        : 'danger'
                    }
                    size="sm"
                  >
                    Outcome: {incident.latestVerificationOutcome.replace(/_/g, ' ')}
                  </Badge>
                )
              }
            />
            <Card.Body className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 bg-theme-bg rounded-lg border border-theme-border flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 uppercase font-semibold block">Reporter Full Name</span>
                    <span className="text-sm font-bold text-theme-heading">
                      {incident.reporterName || incident.reportedBy?.name || 'Anonymous / Walk-in'}
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-theme-bg rounded-lg border border-theme-border flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
                      <Phone className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-500 uppercase font-semibold block">Primary Mobile</span>
                      {incident.reporterPhone ? (
                        <a
                          href={`tel:${incident.reporterPhone}`}
                          className="text-sm font-mono font-bold text-emerald-700 hover:text-emerald-900 hover:underline flex items-center space-x-1"
                          title="Click to dial reporter"
                        >
                          <span>{incident.reporterPhone}</span>
                          <PhoneCall className="w-3.5 h-3.5 ml-1" />
                        </a>
                      ) : (
                        <span className="inline-block px-2 py-0.5 mt-0.5 text-[11px] font-medium bg-gray-100 text-gray-600 rounded">
                          Reporter Contact Unavailable (Legacy Record)
                        </span>
                      )}
                    </div>
                  </div>
                  {incident.reporterPhone && (
                    <div className="flex items-center space-x-1.5">
                      <a
                        href={`tel:${incident.reporterPhone}`}
                        className="px-2.5 py-1 text-xs font-semibold bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors shadow-sm flex items-center space-x-1"
                        title="Open device phone dialer"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                        <span>Call</span>
                      </a>
                      <button
                        type="button"
                        onClick={handleOpenCallAttemptModal}
                        className="px-2.5 py-1 text-xs font-semibold bg-theme-sidebar text-white rounded-md hover:bg-theme-sidebar/90 transition-colors shadow-sm flex items-center space-x-1"
                        title="Record a manual operator call attempt"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Log Attempt</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Alternate Contact & Registered Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {incident.alternatePhone ? (
                  <div className="p-2.5 bg-gray-50 rounded-lg border border-theme-border flex items-center space-x-2">
                    <Phone className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <span>
                      Alternate Number:{' '}
                      <a href={`tel:${incident.alternatePhone}`} className="font-mono font-bold text-theme-primary hover:underline">
                        {incident.alternatePhone}
                      </a>
                    </span>
                  </div>
                ) : null}

                {incident.reportedBy?.email ? (
                  <div className="p-2.5 bg-gray-50 rounded-lg border border-theme-border flex items-center space-x-2">
                    <Mail className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <span>
                      Registered Account: <strong className="font-mono text-gray-700">{incident.reportedBy.email}</strong>
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Verification Attempt Action Banner inside Card */}
              {isReported && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
                    <span>
                      Incident awaiting verification. Contact the reporting citizen to confirm on-scene conditions.
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={CheckCircle2}
                    onClick={() => handleOpenVerificationModal('CONFIRMED')}
                    disabled={isActionPending}
                  >
                    Perform Verification
                  </Button>
                </div>
              )}
            </Card.Body>
          </Card>

          {/* Reporter Call Attempt History Card */}
          <Card>
            <Card.Header
              title="Reporter Call Attempt History"
              subtitle="Manual log of telephony attempts to contact citizen reporter"
              action={
                <div className="flex items-center space-x-2">
                  <Badge variant="primary" size="sm">
                    {incident.callAttempts?.length || 0} Attempts
                  </Badge>
                  {incident.reporterPhone && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={PhoneCall}
                      onClick={handleOpenCallAttemptModal}
                    >
                      Log Call Attempt
                    </Button>
                  )}
                </div>
              }
            />
            <Card.Body className="p-0">
              {incident.callAttempts && incident.callAttempts.length > 0 ? (
                <div className="divide-y divide-theme-border">
                  {incident.callAttempts.map((att, idx) => {
                    const outcomeVariant =
                      att.outcome === 'ANSWERED'
                        ? 'success'
                        : att.outcome === 'NO_ANSWER'
                        ? 'warning'
                        : att.outcome === 'BUSY'
                        ? 'secondary'
                        : 'danger';

                    return (
                      <div key={idx} className="p-3.5 space-y-1.5 hover:bg-slate-50/50 transition-colors text-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Badge variant={outcomeVariant} size="sm">
                              {att.outcome}
                            </Badge>
                            <span className="font-semibold text-theme-heading">
                              {att.operator?.name ? `Operator: ${att.operator.name}` : 'Operator Action'}
                            </span>
                            <span className="font-mono text-gray-500 text-[11px]">
                              Called: {att.phoneCalled}
                            </span>
                          </div>
                          <span className="text-[11px] text-gray-500 font-mono">
                            {formatTime(att.attemptedAt)}
                          </span>
                        </div>
                        {att.notes && (
                          <p className="text-xs text-gray-700 bg-gray-50 p-2 rounded border border-gray-100">
                            "{att.notes}"
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-gray-500">
                  No manual call attempts recorded yet for this incident. Use "Log Call Attempt" to document contact attempts.
                </div>
              )}
            </Card.Body>
          </Card>

          {/* Assigned Fleet Units & Arrival Tracking Card */}
          {((incident.assignedResourceArrivals && incident.assignedResourceArrivals.length > 0) || (incident.assignedResources && incident.assignedResources.length > 0) || incident.status === 'DISPATCHED' || incident.status === 'ON_SCENE' || incident.status === 'RESOLVED') && (
            <Card>
              <Card.Header
                title="Assigned Emergency Fleet Units & Arrival Tracking"
                subtitle="Individual unit status, verification methods, and on-scene timestamps"
                action={
                  <div>
                    {incident.allResourcesOnScene ? (
                      <Badge variant="success" size="sm">
                        All Units On Scene ({incident.onSceneResourceCount ?? incident.assignedResourceArrivals?.length ?? 1}/{incident.totalAssignedResourceCount ?? incident.assignedResourceArrivals?.length ?? 1})
                      </Badge>
                    ) : incident.onSceneResourceCount > 0 ? (
                      <Badge variant="warning" size="sm">
                        Partial Arrival ({incident.onSceneResourceCount}/{incident.totalAssignedResourceCount} On Scene)
                      </Badge>
                    ) : (
                      <Badge variant="primary" size="sm">
                        Dispatched — En Route
                      </Badge>
                    )}
                  </div>
                }
              />
              <Card.Body className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-theme-bg border-b border-theme-border text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        <th className="px-4 py-2.5">Unit</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5">Dispatched At</th>
                        <th className="px-4 py-2.5">Arrived At</th>
                        <th className="px-4 py-2.5">Method</th>
                        <th className="px-4 py-2.5">Operator & Notes</th>
                        <th className="px-4 py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border text-gray-700">
                      {incident.assignedResourceArrivals && incident.assignedResourceArrivals.length > 0 ? (
                        incident.assignedResourceArrivals.map((unit, idx) => (
                          <tr key={idx} className="hover:bg-theme-bg/40">
                            <td className="px-4 py-2.5 font-semibold text-theme-heading">
                              <div className="flex items-center space-x-1.5">
                                <Truck className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                <span>{unit.resourceType ? `${unit.resourceType} #${unit.resourceId}` : `Unit #${unit.resourceId}`}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              {unit.status === 'ON_SCENE' ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  ON SCENE
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800">
                                  <Clock className="w-3 h-3 mr-1" />
                                  DISPATCHED
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-gray-500">
                              {unit.dispatchedAt ? formatTime(unit.dispatchedAt) : '—'}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-indigo-700">
                              {unit.arrivedAt ? formatTime(unit.arrivedAt) : '—'}
                            </td>
                            <td className="px-4 py-2.5">
                              {unit.verificationMethod ? (
                                <Badge variant="primary" size="sm">
                                  {unit.verificationMethod}
                                </Badge>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-[11px]">
                              {unit.arrivedBy?.name && (
                                <span className="block font-medium text-gray-800">
                                  By: {unit.arrivedBy.name}
                                </span>
                              )}
                              {unit.notes && (
                                <span className="text-gray-500 italic block truncate max-w-xs">
                                  "{unit.notes}"
                                </span>
                              )}
                              {!unit.arrivedBy?.name && !unit.notes && '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {unit.status === 'DISPATCHED' ? (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  icon={Navigation}
                                  onClick={() => handleOpenUnitArrival(unit)}
                                >
                                  Mark Arrived
                                </Button>
                              ) : (
                                <span className="text-emerald-700 font-bold text-xs inline-flex items-center">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Arrived
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="px-4 py-3 text-center text-gray-400 italic">
                            No individual arrival records available for this incident.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card.Body>
            </Card>
          )}

          {/* Location Map Preview */}
          {coordinates && (
            <Card>
              <Card.Header
                title="Geographic Location & Boundary Verification"
                subtitle="Location within the Jodhpur Urban Service Area (OSM Way 31725312 academic proxy)"
              />
              <div className="p-4 space-y-3">
                <MapContainer
                  height="280px"
                  center={coordinates}
                  selectedLocation={coordinates}
                  locationName={incident.locationName || `Incident #${incident.incidentId}`}
                  showDefaultMarker={false}
                  showBoundaryPolygon={true}
                  zoom={14}
                  markerTitle={`Incident #${incident.incidentId}`}
                />

                {/* Road Snapping Diagnostic Transparency */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-gray-700">
                      C++ Engine Road-Network Snap Diagnostic:
                    </span>
                    <span className="font-mono text-theme-primary font-bold">
                      {incident.incidentNodeOsmId ? `OSM Node #${incident.incidentNodeOsmId}` : 'Evaluated on Dispatch'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 italic">
                    Note: Snapped road node represents the nearest topological navigation point on the directed road network used for vehicle routing and Dijkstra ETA computation, not the reporting citizen's physical device position.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Verification History Log */}
          {incident.verificationHistory && incident.verificationHistory.length > 0 && (
            <Card>
              <Card.Header
                title="Reporter Verification History"
                subtitle="Chronological log of operator verification calls and outcome assessments"
                action={
                  <Badge variant="primary" size="sm">
                    {incident.verificationHistory.length} Attempts
                  </Badge>
                }
              />
              <Card.Body className="p-0">
                <div className="divide-y divide-theme-border">
                  {incident.verificationHistory.map((item, idx) => (
                    <div key={idx} className="p-3.5 space-y-2 hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2">
                          <Badge
                            variant={
                              item.outcome === 'CONFIRMED'
                                ? 'success'
                                : item.outcome === 'UNABLE_TO_CONTACT'
                                ? 'warning'
                                : item.outcome === 'INFORMATION_REQUIRED'
                                ? 'primary'
                                : 'danger'
                            }
                            size="sm"
                          >
                            {item.outcome}
                          </Badge>
                          <span className="font-semibold text-theme-heading">
                            {item.performedBy?.name ? `Operator: ${item.performedBy.name}` : 'Operator Action'}
                          </span>
                        </div>
                        <span className="text-[11px] text-gray-500 font-mono">
                          {formatTime(item.performedAt)}
                        </span>
                      </div>
                      {item.notes && (
                        <p className="text-xs text-gray-700 bg-gray-50 p-2.5 rounded border border-gray-100">
                          "{item.notes}"
                        </p>
                      )}
                      {item.relatedIncidentId && (
                        <p className="text-[11px] text-purple-700 font-medium">
                          Related Incident ID: #{item.relatedIncidentId}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Card.Body>
            </Card>
          )}

          {/* Audit History Log (Operator Authorized View) */}
          <Card>
            <Card.Header
              title="Audit & Transition Log"
              subtitle="Full immutable lifecycle history recorded in backend database"
              action={
                <Badge variant="primary" size="sm">
                  {incident.auditHistory?.length || 0} Records
                </Badge>
              }
            />
            <div className="overflow-x-auto">
              {incident.auditHistory && incident.auditHistory.length > 0 ? (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-theme-bg border-b border-theme-border text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                      <th className="px-4 py-2.5">Action</th>
                      <th className="px-4 py-2.5">Performed By</th>
                      <th className="px-4 py-2.5">Timestamp</th>
                      <th className="px-4 py-2.5">Transition</th>
                      <th className="px-4 py-2.5">Notes / Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-border text-gray-700">
                    {incident.auditHistory.map((entry, idx) => (
                      <tr key={idx} className="hover:bg-theme-bg/40">
                        <td className="px-4 py-2.5 font-semibold text-theme-heading font-mono">
                          {entry.action}
                        </td>
                        <td className="px-4 py-2.5">
                          {entry.performedBy ? (
                            <div>
                              <span className="font-medium text-theme-heading block">
                                {entry.performedBy.name || 'System Operator'}
                              </span>
                              {entry.performedBy.role && (
                                <span className="text-[10px] text-gray-400 font-mono">
                                  {entry.performedBy.role}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">System</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-gray-500">
                          {formatTime(entry.performedAt) || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-[11px]">
                          <span className="text-gray-400">{entry.previousStatus || 'INIT'}</span>
                          <span className="mx-1 text-gray-400">→</span>
                          <span className="font-semibold text-theme-heading">{entry.newStatus}</span>
                        </td>
                        <td className="px-4 py-2.5 italic text-gray-600 max-w-xs truncate">
                          {entry.notes || entry.reason || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-6 text-center text-xs text-gray-500">
                  No explicit audit records attached to this incident.
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Sidebar Column: Operational Status & Verification Info */}
        <div className="space-y-6">
          <Card>
            <Card.Header
              title="Operational Progression"
              subtitle="Current lifecycle milestone"
            />
            <Card.Body>
              {isRejected ? (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-2 text-xs">
                  <div className="flex items-center space-x-2 text-red-700 font-bold">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    <span>Incident Rejected (False Alarm / Duplicate)</span>
                  </div>
                  <p className="text-red-600">
                    This incident was evaluated by control-room operations and marked as rejected.
                  </p>
                  {incident.rejectionReason && (
                    <div className="pt-2 border-t border-red-200">
                      <span className="font-semibold block text-[10px] uppercase text-red-800">
                        Reason:
                      </span>
                      <p className="italic text-red-700 mt-0.5">{incident.rejectionReason}</p>
                    </div>
                  )}
                  {incident.rejectedBy && (
                    <div className="pt-1 text-[11px] text-red-700">
                      <span>Rejected by: <strong>{incident.rejectedBy.name || 'Operator'}</strong></span>
                    </div>
                  )}
                  {incident.rejectedAt && (
                    <span className="text-[11px] text-red-500 block">
                      Rejected at: {formatTime(incident.rejectedAt)}
                    </span>
                  )}
                </div>
              ) : isCancelled ? (
                <div className="p-4 bg-gray-50 border border-gray-300 rounded-lg space-y-2 text-xs">
                  <div className="flex items-center space-x-2 text-gray-700 font-bold">
                    <Ban className="w-4 h-4 flex-shrink-0" />
                    <span>Incident Cancelled</span>
                  </div>
                  <p className="text-gray-600">
                    This incident was cancelled prior to responder deployment.
                  </p>
                  {incident.cancelledAt && (
                    <span className="text-[11px] text-gray-500 block">
                      Cancelled at: {formatTime(incident.cancelledAt)}
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
                        {isStepPast ? (
                          <span className="absolute -left-6 top-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-white flex items-center justify-center text-white text-[8px]" />
                        ) : isStepCurrent ? (
                          <span className="absolute -left-6 top-0.5 w-3 h-3 rounded-full bg-blue-500 ring-4 ring-blue-100 animate-pulse" />
                        ) : (
                          <span className="absolute -left-6 top-0.5 w-3 h-3 rounded-full bg-gray-300 ring-4 ring-white" />
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
                          {formattedStepTime ? (
                            <span className="text-[10px] text-gray-400 font-mono block">
                              {formattedStepTime}
                            </span>
                          ) : (
                            isStepCurrent && (
                              <span className="text-[10px] text-blue-500 font-medium block">
                                Current Active Stage
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card.Body>
          </Card>

          {/* Verification Operator Info (if verified) */}
          {incident.verifiedAt && (
            <Card>
              <Card.Header title="Verification Record" />
              <Card.Body className="space-y-2 text-xs">
                <div>
                  <span className="text-gray-500 block text-[10px] uppercase font-semibold">Verified By</span>
                  <p className="font-semibold text-theme-heading">
                    {incident.verifiedBy?.name || 'Operator'} ({incident.verifiedBy?.email || 'N/A'})
                  </p>
                </div>
                <div>
                  <span className="text-gray-500 block text-[10px] uppercase font-semibold">Verified At</span>
                  <p className="font-mono text-gray-700">{formatTime(incident.verifiedAt)}</p>
                </div>
                {incident.verificationNotes && (
                  <div>
                    <span className="text-gray-500 block text-[10px] uppercase font-semibold">Verification Notes</span>
                    <p className="italic bg-theme-bg p-2 rounded border border-theme-border mt-0.5">
                      "{incident.verificationNotes}"
                    </p>
                  </div>
                )}
              </Card.Body>
            </Card>
          )}
        </div>
      </div>

      {/* STRUCTURED OPERATOR VERIFICATION MODAL */}
      <Modal
        isOpen={verificationModalOpen}
        onClose={() => setVerificationModalOpen(false)}
        title={`Incident #${incident.incidentId} Verification`}
        subtitle="Document contact verification outcome and update operational lifecycle"
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          {/* Incident Category & Reported Phone Header */}
          <div className="p-3 bg-theme-bg rounded-lg border border-theme-border flex items-center justify-between text-xs">
            <div>
              <span className="text-gray-500 uppercase font-semibold text-[10px] block">Category & Severity</span>
              <span className="font-bold text-theme-heading">
                {incident.category?.replace(/_/g, ' ')} · Level {incident.severity}
              </span>
            </div>
            <div>
              <span className="text-gray-500 uppercase font-semibold text-[10px] block">Reporter Phone</span>
              {incident.reporterPhone ? (
                <a
                  href={`tel:${incident.reporterPhone}`}
                  className="font-mono font-bold text-emerald-700 hover:underline flex items-center space-x-1"
                >
                  <span>{incident.reporterPhone}</span>
                  <PhoneCall className="w-3.5 h-3.5 ml-1" />
                </a>
              ) : (
                <span className="text-gray-500 font-mono">None Provided</span>
              )}
            </div>
          </div>

          {/* Outcome Radio / Selection Tabs */}
          <div>
            <label className="text-xs font-semibold text-theme-heading block mb-1.5">
              Select Verification Outcome:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSelectedOutcome('CONFIRMED')}
                className={`p-2.5 rounded-lg border text-left flex items-start space-x-2 transition-all ${
                  selectedOutcome === 'CONFIRMED'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-500'
                    : 'border-theme-border hover:bg-theme-bg text-gray-700'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">CONFIRMED</span>
                  <span className="text-[11px] text-gray-500">Emergency verified; ready for dispatch</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedOutcome('UNABLE_TO_CONTACT')}
                className={`p-2.5 rounded-lg border text-left flex items-start space-x-2 transition-all ${
                  selectedOutcome === 'UNABLE_TO_CONTACT'
                    ? 'border-amber-500 bg-amber-50 text-amber-900 ring-1 ring-amber-500'
                    : 'border-theme-border hover:bg-theme-bg text-gray-700'
                }`}
              >
                <PhoneOff className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">UNABLE TO CONTACT</span>
                  <span className="text-[11px] text-gray-500">Unanswered; not a false alarm</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedOutcome('INFORMATION_REQUIRED')}
                className={`p-2.5 rounded-lg border text-left flex items-start space-x-2 transition-all ${
                  selectedOutcome === 'INFORMATION_REQUIRED'
                    ? 'border-blue-500 bg-blue-50 text-blue-900 ring-1 ring-blue-500'
                    : 'border-theme-border hover:bg-theme-bg text-gray-700'
                }`}
              >
                <HelpCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">INFO REQUIRED</span>
                  <span className="text-[11px] text-gray-500">Callback needed / more details</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedOutcome('DUPLICATE')}
                className={`p-2.5 rounded-lg border text-left flex items-start space-x-2 transition-all ${
                  selectedOutcome === 'DUPLICATE'
                    ? 'border-purple-500 bg-purple-50 text-purple-900 ring-1 ring-purple-500'
                    : 'border-theme-border hover:bg-theme-bg text-gray-700'
                }`}
              >
                <Copy className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">DUPLICATE</span>
                  <span className="text-[11px] text-gray-500">Covered by another incident</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedOutcome('REJECTED')}
                className={`p-2.5 rounded-lg border text-left flex items-start space-x-2 transition-all sm:col-span-2 ${
                  selectedOutcome === 'REJECTED'
                    ? 'border-red-500 bg-red-50 text-red-900 ring-1 ring-red-500'
                    : 'border-theme-border hover:bg-theme-bg text-gray-700'
                }`}
              >
                <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">REJECT INCIDENT</span>
                  <span className="text-[11px] text-gray-500">Confirmed false alarm, hoax, or prank call</span>
                </div>
              </button>
            </div>
          </div>

          {/* Outcome Context Guidance */}
          {selectedOutcome === 'CONFIRMED' && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 space-y-1">
              <p className="font-semibold">Lifecycle Transition: REPORTED → VERIFIED</p>
              <p>
                Confirms incident authenticity. Incident will immediately become eligible for automated C++ fleet recommendation and dispatch execution.
              </p>
            </div>
          )}

          {selectedOutcome === 'UNABLE_TO_CONTACT' && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-2">
              <div className="flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Safety Policy: Not Marked as False Alarm</p>
                  <p className="text-amber-800">
                    Per emergency response protocols, an uncontactable reporter does NOT cancel emergency response. Status remains <strong className="font-bold">REPORTED</strong> so operators can retry or dispatch units based on severity.
                  </p>
                </div>
              </div>

              <label className="flex items-center space-x-2 pt-2 border-t border-amber-200/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={proceedWithDispatch}
                  onChange={(e) => setProceedWithDispatch(e.target.checked)}
                  className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                />
                <span className="font-semibold text-amber-900">
                  Proceed with dispatch anyway (verified via secondary source / CCTV / visual confirmation)
                </span>
              </label>
            </div>
          )}

          {selectedOutcome === 'INFORMATION_REQUIRED' && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 space-y-1">
              <p className="font-semibold">Status Retained: REPORTED</p>
              <p>
                Records operator inquiry notes into audit history. Does not lock out dispatch or terminate the incident.
              </p>
            </div>
          )}

          {selectedOutcome === 'DUPLICATE' && (
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-900 space-y-2">
              <p className="font-semibold">Lifecycle Transition: REPORTED → REJECTED (Duplicate)</p>
              <Input
                label="Primary Incident ID"
                type="number"
                required
                placeholder="Enter original Incident ID (e.g. 1795091024)"
                value={duplicateOfIncidentId}
                onChange={(e) => setDuplicateOfIncidentId(e.target.value)}
              />
            </div>
          )}

          {selectedOutcome === 'REJECTED' && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 space-y-1">
              <p className="font-bold">Lifecycle Transition: REPORTED → REJECTED (Irreversible)</p>
              <p>
                Terminates incident lifecycle. No units will be recommended or dispatched. Requires a detailed reason.
              </p>
            </div>
          )}

          {/* Verification Notes */}
          <div>
            <Textarea
              label={selectedOutcome === 'REJECTED' ? 'Rejection Reason (Required)' : 'Verification Notes (Optional)'}
              required={selectedOutcome === 'REJECTED'}
              rows={3}
              placeholder={
                selectedOutcome === 'CONFIRMED'
                  ? 'e.g., Spoke with reporter on mobile; caller confirmed structural fire on 2nd floor...'
                  : selectedOutcome === 'UNABLE_TO_CONTACT'
                  ? 'e.g., Called twice; no answer. Call forwarded to voicemail...'
                  : selectedOutcome === 'DUPLICATE'
                  ? 'e.g., Incident already reported under primary ID; same scene location...'
                  : 'Enter operational assessment details...'
              }
              value={verificationNotes}
              onChange={(e) => setVerificationNotes(e.target.value)}
            />
            <div className="flex justify-between text-[11px] text-gray-500 mt-1">
              <span>{selectedOutcome === 'REJECTED' ? 'Minimum 3 characters required.' : 'Logged in permanent verification history.'}</span>
              <span className={verificationNotes.length > 1000 ? 'text-red-600 font-bold' : ''}>
                {verificationNotes.length} / 1000
              </span>
            </div>
          </div>

          {modalClientError && (
            <p className="text-xs text-red-600 font-medium">{modalClientError}</p>
          )}

          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-theme-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVerificationModalOpen(false)}
              disabled={isActionPending}
            >
              Cancel
            </Button>
            <Button
              variant={
                selectedOutcome === 'CONFIRMED' || proceedWithDispatch
                  ? 'primary'
                  : selectedOutcome === 'REJECTED'
                  ? 'danger'
                  : selectedOutcome === 'DUPLICATE'
                  ? 'secondary'
                  : 'accent'
              }
              size="sm"
              icon={
                selectedOutcome === 'CONFIRMED' || proceedWithDispatch
                  ? CheckCircle2
                  : selectedOutcome === 'REJECTED'
                  ? XCircle
                  : PhoneOff
              }
              onClick={handleConfirmStructuredVerification}
              loading={isActionPending}
              disabled={isActionPending}
            >
              {selectedOutcome === 'CONFIRMED'
                ? 'Confirm & Verify Incident'
                : selectedOutcome === 'UNABLE_TO_CONTACT'
                ? proceedWithDispatch
                  ? 'Verify with Dispatch Override'
                  : 'Record Uncontactable Attempt'
                : selectedOutcome === 'INFORMATION_REQUIRED'
                ? 'Save Information Request'
                : selectedOutcome === 'DUPLICATE'
                ? 'Mark as Duplicate'
                : 'Confirm Incident Rejection'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* RECORD MANUAL CALL ATTEMPT MODAL */}
      <Modal
        isOpen={callAttemptModalOpen}
        onClose={() => {
          if (!isSubmittingCall) setCallAttemptModalOpen(false);
        }}
        title={`Log Manual Call Attempt: Incident #${incident.incidentId}`}
        subtitle={`Document telephony inquiry with citizen reporter · ${incident.reporterPhone || 'No Phone'}`}
        maxWidth="max-w-lg"
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 leading-relaxed">
            <p className="font-semibold">Telephony Audit Documentation:</p>
            <p className="mt-1">
              Logging a call attempt documents the manual phone attempt without altering incident status. An uncontactable reporter (e.g., <strong>NO_ANSWER</strong>) does NOT cancel or reject the emergency response.
            </p>
          </div>

          {callModalError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold">Error Logging Attempt:</strong>
                <span>{callModalError}</span>
              </div>
            </div>
          )}

          {/* Outcome Radio Options */}
          <div className="space-y-2">
            <label className="font-semibold text-gray-700 block">Select Call Outcome:</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                {
                  id: 'ANSWERED',
                  label: 'ANSWERED',
                  desc: 'Call connected; spoke directly with reporter',
                  color: 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-emerald-500',
                  icon: CheckCircle2,
                },
                {
                  id: 'NO_ANSWER',
                  label: 'NO ANSWER',
                  desc: 'Ringing timed out; no pickup',
                  color: 'border-amber-500 bg-amber-50 text-amber-900 ring-amber-500',
                  icon: PhoneOff,
                },
                {
                  id: 'BUSY',
                  label: 'BUSY',
                  desc: 'Line engaged or caller rejected',
                  color: 'border-orange-500 bg-orange-50 text-orange-900 ring-orange-500',
                  icon: PhoneOff,
                },
                {
                  id: 'UNREACHABLE',
                  label: 'UNREACHABLE',
                  desc: 'Subscriber switched off / out of coverage',
                  color: 'border-red-500 bg-red-50 text-red-900 ring-red-500',
                  icon: Ban,
                },
                {
                  id: 'INVALID_NUMBER',
                  label: 'INVALID NUMBER',
                  desc: 'Number does not exist or disconnected',
                  color: 'border-red-600 bg-red-50 text-red-950 ring-red-600',
                  icon: XCircle,
                },
              ].map((item) => {
                const IconComponent = item.icon;
                const isSelected = callOutcome === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCallOutcome(item.id)}
                    className={`p-2.5 rounded-lg border text-left flex items-start space-x-2 transition-all ${
                      isSelected
                        ? `${item.color} ring-1 font-semibold`
                        : 'border-theme-border bg-white hover:bg-theme-bg text-gray-700'
                    }`}
                  >
                    <IconComponent className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block text-xs">{item.label}</span>
                      <span className="text-[10px] text-gray-500 block leading-tight">{item.desc}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Textarea
              label="Call Notes (Optional)"
              placeholder="e.g., Reporter answered and confirmed smoke rising from 2nd floor, no casualties trapped..."
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              maxLength={1000}
              rows={3}
            />
            <span className="text-[10px] text-gray-400 block text-right">{callNotes.length} / 1000</span>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-theme-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCallAttemptModalOpen(false)}
              disabled={isSubmittingCall}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={PhoneCall}
              onClick={handleSubmitCallAttempt}
              loading={isSubmittingCall}
              disabled={isSubmittingCall}
            >
              Record Call Attempt
            </Button>
          </div>
        </div>
      </Modal>

      {/* PER-RESOURCE ARRIVAL VERIFICATION MODAL */}
      <Modal
        isOpen={resourceArrivalModalOpen}
        onClose={() => {
          if (!isSubmittingArrival) setResourceArrivalModalOpen(false);
        }}
        title={`Confirm Unit Arrival: ${selectedUnitForArrival?.resourceType || 'Unit'} #${selectedUnitForArrival?.resourceId}`}
        subtitle={`Incident #${incident.incidentId} · Verify on-scene arrival`}
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-900 leading-relaxed">
            <p className="font-semibold">Independent Resource Arrival Verification:</p>
            <p className="mt-1">
              Marking this individual unit arrived records its independent arrival milestone and verification method. The overall incident enters <strong>ON_SCENE</strong> upon the first unit's arrival.
            </p>
          </div>

          {unitArrivalError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold">Arrival Update Failed:</strong>
                <span>{unitArrivalError}</span>
              </div>
            </div>
          )}

          {/* Verification Method Selector */}
          <div className="space-y-1.5">
            <label className="font-semibold text-gray-700 block">Verification Method:</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'RADIO', label: 'Radio Dispatch', desc: 'VHF/UHF Voice Check' },
                { id: 'PHONE', label: 'Cellular Call', desc: 'Direct Phone Report' },
                { id: 'MANUAL', label: 'Manual Log', desc: 'Control-room Operator' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setArrivalVerificationMethod(m.id)}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    arrivalVerificationMethod === m.id
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-bold ring-1 ring-indigo-600'
                      : 'border-theme-border bg-white text-gray-600 hover:bg-theme-bg'
                  }`}
                >
                  <span className="block text-xs">{m.label}</span>
                  <span className="block text-[10px] text-gray-400 font-normal">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Textarea
              label="Arrival Notes (Optional)"
              placeholder="e.g., Ambulance parked near main gate; paramedics triaging casualties..."
              value={unitArrivalNotes}
              onChange={(e) => setUnitArrivalNotes(e.target.value)}
              maxLength={1000}
              rows={3}
            />
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-theme-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResourceArrivalModalOpen(false)}
              disabled={isSubmittingArrival}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Navigation}
              onClick={handleSubmitUnitArrival}
              loading={isSubmittingArrival}
              disabled={isSubmittingArrival}
            >
              Confirm Unit Arrival
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default ControlRoomIncidentDetailPage;

