import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import StatusBadge, { SeverityBadge } from '../../components/ui/StatusBadge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import EmptyState, { ErrorState } from '../../components/ui/EmptyState.jsx';
import incidentService from '../../services/incidentService.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import {
  Radio,
  MapPin,
  CheckCircle,
  Navigation,
  Clock,
  RotateCw,
  Truck,
  Building2,
  Shield,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Filter,
} from 'lucide-react';

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All Active (Dispatched & On Scene)' },
  { value: 'DISPATCHED', label: 'Dispatched (En Route)' },
  { value: 'ON_SCENE', label: 'On Scene' },
];

export function ActiveOperationsPage() {
  const { success, info, error: toastError } = useNotification();
  const [activeIncidents, setActiveIncidents] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  // Arrival Modal State
  const [arrivalModalOpen, setArrivalModalOpen] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [selectedResourceId, setSelectedResourceId] = useState('ALL');
  const [verificationMethod, setVerificationMethod] = useState('RADIO');
  const [arrivalNotes, setArrivalNotes] = useState('');
  const [isActionPending, setIsActionPending] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  // Resolution Modal State
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const fetchActive = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      const res = await incidentService.getActiveIncidents(params);
      setActiveIncidents(res.incidents || res || []);
      setPagination(res.pagination || null);
      setIsLoading(false);
    } catch (err) {
      setError(err);
      setIsLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchActive();
  }, [fetchActive]);

  // Open Arrival Modal (supports incident-wide or individual resource)
  const handleOpenArrival = (inc, targetResourceId = 'ALL') => {
    setSelectedIncident(inc);
    setSelectedResourceId(targetResourceId);
    setVerificationMethod('RADIO');
    setArrivalNotes('');
    setActionError(null);
    setArrivalModalOpen(true);
  };

  // Open Resolution Modal
  const handleOpenResolve = (inc) => {
    setSelectedIncident(inc);
    setResolutionNotes('');
    setActionError(null);
    setResolveModalOpen(true);
  };

  // Confirm Arrival (supports individual resource or all assigned)
  const handleConfirmArrival = async () => {
    if (!selectedIncident) return;
    setIsActionPending(true);
    setActionError(null);
    try {
      if (selectedResourceId && selectedResourceId !== 'ALL') {
        await incidentService.markResourceArrived(selectedIncident.incidentId, selectedResourceId, {
          verificationMethod,
          arrivalNotes: arrivalNotes.trim(),
        });
        setActionSuccess({
          type: 'ARRIVED',
          message: `Unit #${selectedResourceId} marked ON_SCENE via ${verificationMethod} for Incident #${selectedIncident.incidentId}.`,
        });

        const currentOnScene = (selectedIncident.assignedResourceArrivals || []).filter(ra => ra.status === 'ON_SCENE' || ra.arrivedAt).length;
        const total = selectedIncident.totalAssignedResourceCount || (selectedIncident.assignedResourceIds || []).length || 1;
        const newOnScene = currentOnScene + 1;

        if (newOnScene === 1 && total > 1) {
          info('First response resource has arrived.');
        } else if (newOnScene < total) {
          info(`${newOnScene} of ${total} resources have arrived.`);
        } else {
          success('All assigned resources have arrived.');
        }
      } else {
        await incidentService.markArrived(selectedIncident.incidentId, {
          verificationMethod,
          arrivalNotes: arrivalNotes.trim(),
        });
        setActionSuccess({
          type: 'ARRIVED',
          message: `Responders marked arrived on scene via ${verificationMethod} for Incident #${selectedIncident.incidentId}.`,
        });
        success('All assigned resources have arrived.');
      }
      setArrivalModalOpen(false);
      setSelectedIncident(null);
      setIsActionPending(false);
      fetchActive();
    } catch (err) {
      setActionError(err.message || 'Failed to record scene arrival.');
      toastError(err.message || 'Failed to record scene arrival.');
      setIsActionPending(false);
    }
  };

  // Confirm Resolution (ON_SCENE -> RESOLVED)
  const handleConfirmResolve = async () => {
    if (!selectedIncident) return;
    setIsActionPending(true);
    setActionError(null);
    try {
      const result = await incidentService.resolveIncident(
        selectedIncident.incidentId,
        resolutionNotes.trim()
      );

      const releasedUnits = result?.releasedResources?.length || 0;
      const releasedHosp = result?.releasedHospitalCapacities?.length || 0;

      setActionSuccess({
        type: 'RESOLVED',
        message: `Incident #${selectedIncident.incidentId} successfully resolved! ${releasedUnits} unit(s) released to AVAILABLE and ${releasedHosp} hospital reservation(s) restored.`,
      });
      success('Incident resolved successfully.');
      info('Resources are now available for new incidents.');

      setResolveModalOpen(false);
      setSelectedIncident(null);
      setIsActionPending(false);
      fetchActive();
    } catch (err) {
      setActionError(err.message || 'Failed to resolve incident.');
      toastError(err.message || 'Failed to resolve incident.');
      setIsActionPending(false);
    }
  };

  const columns = [
    {
      key: 'incidentId',
      header: 'Incident ID',
      render: (val) => (
        <Link
          to={`/control-room/incidents/${val}`}
          className="font-mono font-bold text-theme-primary hover:underline flex items-center space-x-1"
        >
          <span>#{val}</span>
          <ExternalLink className="w-3 h-3 text-gray-400" />
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Operational Status',
      render: (val, row) => (
        <div className="space-y-1">
          <StatusBadge status={val} size="md" />
          {row.status === 'ON_SCENE' && (
            <div>
              {row.allResourcesOnScene ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                  All On Scene ({row.onSceneResourceCount ?? row.assignedResources?.length ?? 1}/{row.totalAssignedResourceCount ?? row.assignedResources?.length ?? 1})
                </span>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                  <Clock className="w-2.5 h-2.5 mr-0.5" />
                  Partial ({row.onSceneResourceCount || 1}/{row.totalAssignedResourceCount || row.assignedResources?.length || 1})
                </span>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category / Severity',
      render: (val, row) => (
        <div>
          <span className="font-semibold uppercase block text-theme-heading text-xs">
            {val?.replace(/_/g, ' ')}
          </span>
          <SeverityBadge severity={row.severity} />
        </div>
      ),
    },
    {
      key: 'assignedResources',
      header: 'Assigned Fleet Units',
      render: (units, row) => {
        const arrivals = row.assignedResourceArrivals;
        if (Array.isArray(arrivals) && arrivals.length > 0) {
          return (
            <div className="space-y-1.5 max-w-[260px]">
              {arrivals.map((arr, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-1.5 rounded-lg bg-theme-bg/60 border border-theme-border text-[11px]"
                >
                  <div className="flex items-center space-x-1.5 truncate">
                    <Truck className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                    <span className="font-semibold text-theme-heading truncate">
                      {arr.resourceType ? `${arr.resourceType} #${arr.resourceId}` : `Unit #${arr.resourceId}`}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1 ml-2 flex-shrink-0">
                    {arr.status === 'ON_SCENE' ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                        {arr.verificationMethod || 'ON SCENE'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenArrival(row, arr.resourceId)}
                        className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                        title="Mark this unit arrived"
                      >
                        Mark Arrived
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        }

        return (
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {Array.isArray(units) && units.length > 0 ? (
              units.map((u, idx) => (
                <Badge key={idx} variant="primary" size="sm">
                  {u.resourceType ? `${u.resourceType} #${u.resourceId}` : `Unit #${u.resourceId || u}`}
                </Badge>
              ))
            ) : (
              <span className="text-gray-400 text-xs">None recorded</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'assignedHospital',
      header: 'Assigned Hospital',
      render: (hosp) => {
        const hospitalName = hosp?.hospitalName || hosp?.name;
        return (
          <div className="text-xs text-gray-600 max-w-[160px] truncate" title={hospitalName || 'None assigned'}>
            {hospitalName ? (
              <span className="font-medium text-theme-heading flex items-center space-x-1">
                <Building2 className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
                <span>{hospitalName}</span>
              </span>
            ) : (
              <span className="text-gray-400">None assigned</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'timestamps',
      header: 'Field Milestones',
      render: (_, row) => (
        <div className="text-[11px] text-gray-500 space-y-0.5">
          {row.dispatchedAt && (
            <div>Dispatched: {new Date(row.dispatchedAt).toLocaleTimeString()}</div>
          )}
          {row.arrivedAt && (
            <div className="text-indigo-700 font-semibold">
              Arrived: {new Date(row.arrivedAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Operator Action',
      render: (_, row) => {
        const hasPendingArrivals = row.assignedResourceArrivals
          ? row.assignedResourceArrivals.some((a) => a.status === 'DISPATCHED')
          : row.status === 'DISPATCHED';

        return (
          <div className="flex items-center space-x-1.5">
            {hasPendingArrivals && (
              <Button
                variant="primary"
                size="sm"
                icon={Navigation}
                onClick={() => handleOpenArrival(row, 'ALL')}
              >
                Mark Arrived
              </Button>
            )}
            {row.status === 'ON_SCENE' && (
              <Button
                variant="outline"
                size="sm"
                icon={CheckCircle}
                onClick={() => handleOpenResolve(row)}
              >
                Resolve Incident
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Active Field Operations & Incident Tracking"
        subtitle="Monitor dispatched emergency units, record scene arrivals, and resolve incidents with atomic resource release · Jodhpur"
        badge={<Badge variant="primary">Field Tracking</Badge>}
        actions={
          <Button variant="secondary" size="sm" icon={RotateCw} onClick={fetchActive} disabled={isLoading}>
            Refresh
          </Button>
        }
      />

      {/* Simulation Notice Banner */}
      <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-900">
        <div className="flex items-center space-x-2.5">
          <Shield className="w-4 h-4 text-amber-700 flex-shrink-0" />
          <span>
            <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> Scene arrival and incident resolution are simulated control room events triggering automated fleet and hospital capacity restoration.
          </span>
        </div>
        <Badge variant="warning" size="sm">Academic Simulation</Badge>
      </div>

      {/* Action Notification Banners */}
      {actionSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span className="font-semibold">{actionSuccess.message}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setActionSuccess(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-white border border-theme-border rounded-xl shadow-xs">
        {STATUS_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              setStatusFilter(opt.value);
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              statusFilter === opt.value
                ? 'bg-theme-sidebar text-white shadow-xs'
                : 'text-gray-600 hover:text-theme-heading hover:bg-theme-bg'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Active Incidents Table */}
      {error ? (
        <ErrorState
          icon={AlertTriangle}
          title="Failed to Load Active Operations"
          message={error.message}
          onRetry={fetchActive}
        />
      ) : (
        <Card className="p-0 overflow-hidden border border-theme-border shadow-xs">
          <DataTable
            columns={columns}
            data={activeIncidents}
            keyField="incidentId"
            loading={isLoading}
            emptyMessage="No active dispatched or on-scene emergencies found in Jodhpur."
          />

          {/* Pagination */}
          {!isLoading && pagination && pagination.totalPages > 1 && (
            <div className="px-4 py-3 bg-white border-t border-theme-border flex items-center justify-between text-xs text-gray-600">
              <span>
                Page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} active incidents)
              </span>
              <div className="flex space-x-1">
                <Button
                  variant="outline"
                  size="sm"
                  icon={ChevronLeft}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon={ChevronRight}
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* SCENE ARRIVAL MODAL */}
      <Modal
        isOpen={arrivalModalOpen}
        onClose={() => {
          if (!isActionPending) setArrivalModalOpen(false);
        }}
        title={`Confirm Scene Arrival: Incident #${selectedIncident?.incidentId}`}
        subtitle="Record on-scene arrival and verification method"
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-900 leading-relaxed">
            <p className="font-semibold">Scene Arrival Verification Event:</p>
            <p className="mt-1">
              Marking scene arrival confirms units have arrived at incident coordinates. The incident transitions to <strong>ON_SCENE</strong> upon the first unit's arrival, with individual unit timestamps recorded.
            </p>
          </div>

          {actionError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold">Arrival Update Failed:</strong>
                <span>{actionError}</span>
              </div>
            </div>
          )}

          {/* Unit Target Selection (if multiple dispatched units) */}
          {selectedIncident?.assignedResourceArrivals && selectedIncident.assignedResourceArrivals.length > 1 && (
            <div className="space-y-1.5">
              <label className="font-semibold text-gray-700 block">Select Arriving Unit:</label>
              <select
                value={selectedResourceId}
                onChange={(e) => setSelectedResourceId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                className="w-full px-3 py-2 border border-theme-border rounded-lg bg-white text-xs text-theme-heading font-medium focus:ring-2 focus:ring-theme-primary focus:outline-none"
              >
                <option value="ALL">All Dispatched Units</option>
                {selectedIncident.assignedResourceArrivals.map((arr) => (
                  <option
                    key={arr.resourceId}
                    value={arr.resourceId}
                    disabled={arr.status === 'ON_SCENE'}
                  >
                    {arr.resourceType ? `${arr.resourceType} #${arr.resourceId}` : `Unit #${arr.resourceId}`}
                    {arr.status === 'ON_SCENE' ? ' (Already On Scene)' : ' (Dispatched / En Route)'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Verification Method Selection */}
          <div className="space-y-1.5">
            <label className="font-semibold text-gray-700 block">Verification Method:</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'RADIO', label: 'Radio Dispatch', desc: 'VHF/UHF Call' },
                { id: 'PHONE', label: 'Cellular Call', desc: 'Direct Phone' },
                { id: 'MANUAL', label: 'Manual Check', desc: 'On-scene Log' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setVerificationMethod(m.id)}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    verificationMethod === m.id
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
              placeholder="e.g., Team established command post; perimeter secured..."
              value={arrivalNotes}
              onChange={(e) => setArrivalNotes(e.target.value)}
              maxLength={1000}
              rows={3}
            />
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-theme-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArrivalModalOpen(false)}
              disabled={isActionPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Navigation}
              onClick={handleConfirmArrival}
              loading={isActionPending}
              disabled={isActionPending}
            >
              Confirm Scene Arrival
            </Button>
          </div>
        </div>
      </Modal>

      {/* INCIDENT RESOLUTION MODAL */}
      <Modal
        isOpen={resolveModalOpen}
        onClose={() => {
          if (!isActionPending) setResolveModalOpen(false);
        }}
        title={`Resolve Incident #${selectedIncident?.incidentId}`}
        subtitle="Clear incident, release mobilized fleet units, and restore hospital capacities"
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 leading-relaxed">
            <p className="font-semibold">Terminal Resolution & Resource De-allocation:</p>
            <p className="mt-1">
              Resolving this incident marks it as <strong>RESOLVED</strong>. All assigned vehicles are atomically released back to <strong>AVAILABLE</strong> status, and reserved hospital beds are restored to general availability.
            </p>
          </div>

          {actionError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold">Resolution Error:</strong>
                <span>{actionError}</span>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Textarea
              label="Resolution Summary Notes (Optional)"
              placeholder="e.g., Scene cleared, casualties transferred to trauma bay, all fires extinguished..."
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              maxLength={1000}
              rows={3}
            />
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-theme-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResolveModalOpen(false)}
              disabled={isActionPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={CheckCircle}
              onClick={handleConfirmResolve}
              loading={isActionPending}
              disabled={isActionPending}
            >
              Resolve Incident & Release Fleet
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default ActiveOperationsPage;
