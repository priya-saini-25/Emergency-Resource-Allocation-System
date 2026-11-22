import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Modal from '../../components/ui/Modal.jsx';
import StatusBadge, { SeverityBadge } from '../../components/ui/StatusBadge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState, { ErrorState } from '../../components/ui/EmptyState.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { useControlRoomIncidents } from '../../hooks/useControlRoomIncidents.js';
import { useIncidentVerification } from '../../hooks/useIncidentVerification.js';
import {
  AlertOctagon,
  CheckCircle2,
  XCircle,
  Filter,
  RotateCw,
  Search,
  ExternalLink,
  Clock,
  MapPin,
  User,
  Shield,
  AlertTriangle,
  RotateCcw,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const STATUS_TABS = [
  { value: 'REPORTED', label: 'Actionable Queue (REPORTED)' },
  { value: '', label: 'All Incidents' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'ALLOCATED', label: 'Allocated' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'ON_SCENE', label: 'On Scene' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'REJECTED', label: 'Rejected' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: 'All Categories' },
  { value: 'FIRE', label: 'Structure / Vehicle Fire' },
  { value: 'ROAD_ACCIDENT', label: 'Traffic Collision / Road Accident' },
  { value: 'MEDICAL_EMERGENCY', label: 'Severe Medical Crisis / Trauma' },
  { value: 'MEDICAL', label: 'Medical (General)' },
  { value: 'HAZMAT', label: 'Hazardous Chemical / Gas Release' },
  { value: 'STRUCTURAL_COLLAPSE', label: 'Building / Infrastructure Collapse' },
  { value: 'NATURAL_DISASTER', label: 'Severe Weather / Flood Inundation' },
  { value: 'CIVIL_DISTURBANCE', label: 'Public Safety Disturbance' },
  { value: 'INDUSTRIAL', label: 'Industrial Incident' },
  { value: 'OTHER', label: 'Other Critical Emergency' },
];

const SEVERITY_OPTIONS = [
  { value: '', label: 'All Severities' },
  { value: '5', label: 'Severity 5 (Critical)' },
  { value: '4', label: 'Severity 4 (High)' },
  { value: '3', label: 'Severity 3 (Medium)' },
  { value: '2', label: 'Severity 2 (Moderate)' },
  { value: '1', label: 'Severity 1 (Low)' },
];

const SORT_BY_OPTIONS = [
  { value: 'createdAt', label: 'Creation Time' },
  { value: 'severity', label: 'Severity Level' },
  { value: 'incidentId', label: 'Incident ID' },
  { value: 'reportedAt', label: 'Report Time' },
];

const SORT_ORDER_OPTIONS = [
  { value: 'desc', label: 'Descending (Newest / Highest first)' },
  { value: 'asc', label: 'Ascending (Oldest / Lowest first)' },
];

export function IncidentQueuePage() {
  const {
    incidents,
    pagination,
    isLoading,
    error,
    filters,
    setFilter,
    setFilters,
    resetFilters,
    changePage,
    refetch,
  } = useControlRoomIncidents({ status: 'REPORTED' });

  const {
    verify,
    reject,
    isActionPending,
    actionError,
    actionSuccess,
    resetActionState,
  } = useIncidentVerification();

  // Action Modals State
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [verificationNotes, setVerificationNotes] = useState('');
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [modalClientError, setModalClientError] = useState(null);
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  // Search input local state for smooth typing
  const [searchIdInput, setSearchIdInput] = useState(filters.incidentId || '');

  const handleOpenVerify = (incident) => {
    resetActionState();
    setSelectedIncident(incident);
    setVerificationNotes('');
    setModalClientError(null);
    setVerifyModalOpen(true);
  };

  const handleOpenReject = (incident) => {
    resetActionState();
    setSelectedIncident(incident);
    setRejectionReason('');
    setModalClientError(null);
    setRejectModalOpen(true);
  };

  const handleConfirmVerify = async () => {
    if (!selectedIncident) return;
    try {
      await verify(selectedIncident.incidentId, verificationNotes);
      setVerifyModalOpen(false);
      setSelectedIncident(null);
      refetch();
    } catch (err) {
      setModalClientError(err.message || 'Verification failed');
    }
  };

  const handleConfirmReject = async () => {
    if (!selectedIncident) return;
    if (!rejectionReason.trim() || rejectionReason.trim().length < 3) {
      setModalClientError('Rejection reason must be at least 3 characters');
      return;
    }
    try {
      await reject(selectedIncident.incidentId, rejectionReason);
      setRejectModalOpen(false);
      setSelectedIncident(null);
      refetch();
    } catch (err) {
      setModalClientError(err.message || 'Rejection failed');
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setFilter('incidentId', searchIdInput.trim());
  };

  const handleSearchReset = () => {
    setSearchIdInput('');
    setFilter('incidentId', '');
  };

  const columns = [
    {
      key: 'incidentId',
      header: 'Incident ID',
      render: (val, row) => (
        <Link
          to={`/control-room/incidents/${val}`}
          className="font-mono font-semibold text-theme-primary hover:underline hover:text-slate-800 transition-colors flex items-center space-x-1"
        >
          <span>#{val}</span>
          <ExternalLink className="w-3 h-3 text-gray-400 inline" />
        </Link>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (val) => (
        <span className="font-semibold text-xs tracking-wide text-theme-heading uppercase">
          {val ? val.replace(/_/g, ' ') : 'UNKNOWN'}
        </span>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      render: (val) => <SeverityBadge severity={val} />,
    },
    {
      key: 'reportedBy',
      header: 'Citizen Reporter',
      render: (val) => (
        <div className="flex items-center space-x-1.5 text-xs text-gray-600">
          <User className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <span className="truncate max-w-[140px]">{val?.name || 'Anonymous Report'}</span>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location (Lat, Lng)',
      render: (val) => (
        <div className="flex items-center space-x-1.5 text-xs text-gray-600 font-mono">
          <MapPin className="w-3.5 h-3.5 text-theme-primary flex-shrink-0" />
          <span>
            {val ? `${val.latitude.toFixed(4)}, ${val.longitude.toFixed(4)}` : 'Coordinates N/A'}
          </span>
        </div>
      ),
    },
    {
      key: 'reportedAt',
      header: 'Reported At',
      render: (val) => (
        <div className="flex items-center space-x-1.5 text-xs text-gray-500">
          <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <span>{val ? new Date(val).toLocaleString() : 'N/A'}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (val) => <StatusBadge status={val} size="sm" />,
    },
    {
      key: 'actions',
      header: 'Operator Actions',
      render: (_, row) => (
        <div className="flex items-center space-x-1.5">
          {row.status === 'REPORTED' ? (
            <>
              <Button
                variant="primary"
                size="sm"
                icon={CheckCircle2}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenVerify(row);
                }}
                disabled={isActionPending}
              >
                Verify
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={XCircle}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenReject(row);
                }}
                disabled={isActionPending}
              >
                Reject
              </Button>
            </>
          ) : (
            <Link to={`/control-room/incidents/${row.incidentId}`}>
              <Button variant="outline" size="sm" icon={ExternalLink}>
                Inspect
              </Button>
            </Link>
          )}
        </div>
      ),
    },
  ];

  // Calculate pagination boundaries
  const totalCount = pagination?.totalCount || 0;
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 20;
  const totalPages = pagination?.totalPages || 1;
  const fromRecord = totalCount > 0 ? (page - 1) * limit + 1 : 0;
  const toRecord = totalCount > 0 ? Math.min(page * limit, totalCount) : 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Incident Verification Queue"
        subtitle="Review reported emergencies, perform phone verification, and approve for fleet dispatch · Jodhpur Urban Area"
        badge={
          <Badge variant="primary" size="md">
            Authoritative Registry
          </Badge>
        }
        actions={
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              icon={SlidersHorizontal}
              onClick={() => setIsFilterExpanded(!isFilterExpanded)}
            >
              {isFilterExpanded ? 'Hide Filters' : 'Filter Queue'}
            </Button>
            <Button variant="secondary" size="sm" icon={RotateCw} onClick={refetch} disabled={isLoading}>
              Refresh
            </Button>
          </div>
        }
      />

      {/* Simulation Disclaimer Banner */}
      <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-900">
        <div className="flex items-center space-x-2.5">
          <Shield className="w-4 h-4 text-amber-700 flex-shrink-0" />
          <span>
            <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> Control room operators review incoming reports before initiating C++ dispatch engine optimization.
          </span>
        </div>
        <Badge variant="warning" size="sm">Academic Simulation</Badge>
      </div>

      {/* Action Success / Error Banners */}
      {actionSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span className="font-semibold">{actionSuccess.message}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={resetActionState}>
            Dismiss
          </Button>
        </div>
      )}

      {actionError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 flex items-start space-x-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong className="block font-semibold">Action Conflict or Error:</strong>
            <span>
              {actionError.code === 'INCIDENT_STATE_CONFLICT'
                ? `Conflict: Incident #${actionError.incidentId || ''} current status is '${actionError.currentStatus || 'UNKNOWN'}'. Only REPORTED incidents can be modified.`
                : actionError.message || 'Operation failed.'}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={resetActionState}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Primary Status Tabs (Actionable queue vs others) */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-white border border-theme-border rounded-xl shadow-xs">
        {STATUS_TABS.map((tab) => {
          const isActive = filters.status === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter('status', tab.value)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                isActive
                  ? 'bg-theme-sidebar text-white shadow-xs'
                  : 'text-gray-600 hover:text-theme-heading hover:bg-theme-bg'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Expanded Filter Panel */}
      {isFilterExpanded && (
        <Card className="p-4 bg-white border border-theme-border shadow-xs animate-in fade-in duration-150">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search by ID */}
            <form onSubmit={handleSearchSubmit} className="space-y-1">
              <label className="text-xs font-semibold text-theme-heading">Incident ID Search</label>
              <div className="flex space-x-1.5">
                <Input
                  type="number"
                  placeholder="e.g. 1731895..."
                  value={searchIdInput}
                  onChange={(e) => setSearchIdInput(e.target.value)}
                  icon={Search}
                  className="text-xs"
                />
                <Button type="submit" variant="primary" size="sm">
                  Find
                </Button>
                {filters.incidentId && (
                  <Button type="button" variant="outline" size="sm" onClick={handleSearchReset}>
                    Clear
                  </Button>
                )}
              </div>
            </form>

            {/* Category Filter */}
            <div>
              <Select
                label="Emergency Category"
                value={filters.category || ''}
                onChange={(e) => setFilter('category', e.target.value)}
                options={CATEGORY_OPTIONS}
                className="text-xs"
              />
            </div>

            {/* Severity Filter */}
            <div>
              <Select
                label="Severity Level"
                value={filters.severity || ''}
                onChange={(e) => setFilter('severity', e.target.value)}
                options={SEVERITY_OPTIONS}
                className="text-xs"
              />
            </div>

            {/* Sort Controls */}
            <div>
              <Select
                label="Sort Order"
                value={filters.sortBy || 'createdAt'}
                onChange={(e) => setFilter('sortBy', e.target.value)}
                options={SORT_BY_OPTIONS}
                className="text-xs"
              />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-theme-border flex items-center justify-between text-xs">
            <span className="text-gray-500">
              Active Filters: Status (<strong>{filters.status || 'ALL'}</strong>)
              {filters.category ? `, Category (${filters.category})` : ''}
              {filters.severity ? `, Severity (${filters.severity})` : ''}
              {filters.incidentId ? `, ID (#${filters.incidentId})` : ''}
            </span>
            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={resetFilters}>
              Reset All Filters
            </Button>
          </div>
        </Card>
      )}

      {/* Main Table View */}
      {error ? (
        <ErrorState
          icon={AlertTriangle}
          title="Failed to Load Incident Queue"
          message={error.message || 'Error communicating with control-room incident service.'}
          onRetry={refetch}
        />
      ) : (
        <Card className="p-0 overflow-hidden border border-theme-border shadow-xs">
          <DataTable
            columns={columns}
            data={incidents}
            keyField="incidentId"
            loading={isLoading}
            emptyMessage={
              filters.status === 'REPORTED'
                ? 'No actionable reported incidents in the queue. All emergencies are verified or resolved.'
                : 'No incidents found matching the selected filter criteria.'
            }
          />

          {/* Pagination Footer */}
          {!isLoading && incidents.length > 0 && (
            <div className="px-4 py-3 bg-white border-t border-theme-border flex flex-wrap items-center justify-between gap-3 text-xs text-gray-600">
              <div>
                Showing <span className="font-semibold text-theme-heading">{fromRecord}</span> to{' '}
                <span className="font-semibold text-theme-heading">{toRecord}</span> of{' '}
                <span className="font-semibold text-theme-heading">{totalCount}</span> incidents
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-gray-500">
                  Page <strong className="text-theme-heading">{page}</strong> of{' '}
                  <strong className="text-theme-heading">{totalPages}</strong>
                </span>

                <div className="flex space-x-1">
                  <Button
                    variant="outline"
                    size="sm"
                    icon={ChevronLeft}
                    onClick={() => changePage(page - 1)}
                    disabled={page <= 1}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={ChevronRight}
                    onClick={() => changePage(page + 1)}
                    disabled={page >= totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* VERIFICATION MODAL */}
      <Modal
        isOpen={verifyModalOpen}
        onClose={() => {
          if (!isActionPending) {
            setVerifyModalOpen(false);
            setSelectedIncident(null);
          }
        }}
        title={`Verify Incident #${selectedIncident?.incidentId}`}
        subtitle="Confirm incident validity and release for fleet dispatch recommendation"
      >
        <div className="space-y-4">
          <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-lg text-xs text-blue-900 leading-relaxed">
            <p className="font-semibold">Operator Verification Protocol:</p>
            <p className="mt-1">
              Verifying this incident transitions its operational status to <strong>VERIFIED</strong> and marks it as ready for C++ resource allocation.
            </p>
          </div>

          {selectedIncident && (
            <div className="p-3 bg-gray-50 rounded-lg text-xs space-y-1.5 border border-gray-200">
              <div className="flex justify-between">
                <span className="text-gray-500">Category:</span>
                <span className="font-semibold uppercase">{selectedIncident.category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Reported Severity:</span>
                <SeverityBadge severity={selectedIncident.severity} />
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Reporter:</span>
                <span className="font-medium">{selectedIncident.reportedBy?.name || 'Anonymous'}</span>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Textarea
              label="Verification Notes (Optional)"
              placeholder="e.g., Confirmed with caller. 2 vehicles involved with moderate damage..."
              value={verificationNotes}
              onChange={(e) => setVerificationNotes(e.target.value)}
              maxLength={1000}
              rows={3}
              helperText={`${verificationNotes.length} / 1000 characters`}
              error={modalClientError}
            />
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-theme-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setVerifyModalOpen(false);
                setSelectedIncident(null);
              }}
              disabled={isActionPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={CheckCircle2}
              onClick={handleConfirmVerify}
              loading={isActionPending}
            >
              Confirm Verification
            </Button>
          </div>
        </div>
      </Modal>

      {/* REJECTION MODAL */}
      <Modal
        isOpen={rejectModalOpen}
        onClose={() => {
          if (!isActionPending) {
            setRejectModalOpen(false);
            setSelectedIncident(null);
          }
        }}
        title={`Reject Incident #${selectedIncident?.incidentId}`}
        subtitle="Mark report as false alarm, test transmission, or duplicate"
      >
        <div className="space-y-4">
          <div className="p-3 bg-red-50/80 border border-red-200 rounded-lg text-xs text-red-900 leading-relaxed">
            <p className="font-semibold">Terminal Rejection Warning:</p>
            <p className="mt-1">
              Rejecting transitions this incident to <strong>REJECTED</strong>. A valid operational reason (minimum 3 characters) is mandatory for regulatory audit compliance.
            </p>
          </div>

          {selectedIncident && (
            <div className="p-3 bg-gray-50 rounded-lg text-xs space-y-1.5 border border-gray-200">
              <div className="flex justify-between">
                <span className="text-gray-500">Category:</span>
                <span className="font-semibold uppercase">{selectedIncident.category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Reported Time:</span>
                <span className="font-medium">{new Date(selectedIncident.reportedAt).toLocaleTimeString()}</span>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Textarea
              label="Rejection Reason"
              required
              placeholder="e.g., Caller reported duplicate event; false alarm confirmed by patrol unit..."
              value={rejectionReason}
              onChange={(e) => {
                setRejectionReason(e.target.value);
                if (modalClientError) setModalClientError(null);
              }}
              maxLength={1000}
              rows={3}
              helperText={`${rejectionReason.length} / 1000 characters (min 3)`}
              error={modalClientError}
            />
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-theme-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRejectModalOpen(false);
                setSelectedIncident(null);
              }}
              disabled={isActionPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={XCircle}
              onClick={handleConfirmReject}
              loading={isActionPending}
              disabled={rejectionReason.trim().length < 3 || isActionPending}
            >
              Confirm Rejection
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default IncidentQueuePage;
